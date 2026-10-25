import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { fakeFetch, json, recorded } from "../../../test/helpers/providers";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const yahooSearch = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// The real Yahoo client never runs in tests; its search answers with recorded responses.
vi.mock("yahoo-finance2", () => ({
  default: class {
    search = yahooSearch;
  },
}));

import { prisma } from "@/db";
import { ensureSecurity, listSecurities } from "@/modules/ledger";
import { listSecuritiesWithMappings } from "@/modules/prices";
import {
  changeSecurityTypeAction,
  resolveMappingAction,
  resolveMissingMappingsAction,
  setMappingAction,
} from "./securities";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

const SAP = "DE0007164600";
const MSCI_WORLD = "IE00B4L5Y983";

let network: ReturnType<typeof fakeFetch>;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.OPENFIGI_API_KEY = "";
  process.env.COINGECKO_API_KEY = "";
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  network = fakeFetch((call) =>
    call.url.includes("openfigi")
      ? json(JSON.parse(call.body!).map((job: { idValue: string }) => (recorded("openfigi-mapping-sap-msci-world-apple") as unknown[])[job.idValue === SAP ? 0 : 1]))
      : json(recorded("coingecko-search-btc")),
  );
  vi.stubGlobal("fetch", network.fetch);
  yahooSearch.mockReset();
  yahooSearch.mockResolvedValue(recorded("yahoo-search-ishares-core-msci-world"));
  await prisma.providerMapping.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.corporateAction.deleteMany();
  await prisma.security.deleteMany();
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function security(identifier: { isin: string } | { cryptoSymbol: string }, name: string, assetType: string) {
  const result = await ensureSecurity(identifier, { name, assetType });
  if (!result.ok) throw new Error("setup failed");
  return result.security;
}

function signOut() {
  fakes.current.state.incoming.clear();
}

describe("resolveMissingMappingsAction", () => {
  it("resolves Securities without a row via the default providers and revalidates", async () => {
    await security({ isin: SAP }, "SAP", "STOCK");
    await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    await security({ cryptoSymbol: "BTC" }, "Bitcoin", "CRYPTO");

    expect(await resolveMissingMappingsAction()).toEqual({ ok: true, mapped: 2, notFound: 1, failed: [] });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect((await listSecuritiesWithMappings()).map((s) => [s.name, s.mapping?.provider ?? null, s.mapping?.symbol ?? null])).toEqual([
      ["Bitcoin", "COINGECKO", "bitcoin"],
      ["iShares Core MSCI World", null, null],
      ["SAP", "YAHOO", "SAP.DE"],
    ]);
    expect(yahooSearch).toHaveBeenCalledTimes(1);
    expect(yahooSearch).toHaveBeenCalledWith(
      MSCI_WORLD,
      { quotesCount: 10, newsCount: 0 },
      { validateResult: false, fetchOptions: { signal: expect.any(AbortSignal) } },
    );

    // Second visit: no provider calls for those Securities.
    network.calls.length = 0;
    yahooSearch.mockClear();
    revalidatePath.mockClear();
    expect(await resolveMissingMappingsAction()).toEqual({ ok: true, mapped: 0, notFound: 0, failed: [] });
    expect(network.calls).toEqual([]);
    expect(yahooSearch).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reads the API keys from the environment", async () => {
    process.env.OPENFIGI_API_KEY = "figi-key";
    await security({ isin: SAP }, "SAP", "STOCK");
    await resolveMissingMappingsAction();
    expect(network.calls[0].headers["x-openfigi-apikey"]).toBe("figi-key");
  });

  it("returns unauthorized without a session and calls no provider", async () => {
    await security({ isin: SAP }, "SAP", "STOCK");
    signOut();
    expect(await resolveMissingMappingsAction()).toEqual({ ok: false, reason: "unauthorized" });
    expect(network.calls).toEqual([]);
    expect((await listSecuritiesWithMappings())[0].mapping).toBeNull();
  });
});

describe("resolveMappingAction", () => {
  it("retries one Security and revalidates", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    await resolveMissingMappingsAction();
    revalidatePath.mockClear();
    yahooSearch.mockResolvedValue(recorded("yahoo-search-xtrackers-msci-world"));
    expect(await resolveMappingAction(null, form({ securityId: msci.id }))).toEqual({ ok: true, status: "mapped" });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
  });

  it("revalidates when a mapping was saved meanwhile (already-mapped)", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    await setMappingAction(null, form({ securityId: msci.id, provider: "YAHOO", symbol: "EUNL.DE" }));
    revalidatePath.mockClear();
    expect(await resolveMappingAction(null, form({ securityId: msci.id }))).toEqual({ ok: false, reason: "already-mapped" });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
  });

  it("returns provider-failed without writing", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    yahooSearch.mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fakeFetch(new TypeError("fetch failed")).fetch);
    expect(await resolveMappingAction(null, form({ securityId: msci.id }))).toEqual({ ok: false, reason: "provider-failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await prisma.providerMapping.count()).toBe(0);
  });

  it("returns unauthorized without a session", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    signOut();
    expect(await resolveMappingAction(null, form({ securityId: msci.id }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await prisma.providerMapping.count()).toBe(0);
  });
});

describe("setMappingAction", () => {
  it("saves a MANUAL mapping and revalidates", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    expect(await setMappingAction(null, form({ securityId: msci.id, provider: "YAHOO", symbol: "EUNL.DE" }))).toEqual({
      ok: true,
      mapping: { provider: "YAHOO", symbol: "EUNL.DE", origin: "MANUAL" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect(await prisma.providerMapping.count()).toBe(1);
  });

  it.each([
    [{ provider: "", symbol: "EUNL.DE" }, "provider-invalid"],
    [{ provider: "YAHOO", symbol: "" }, "symbol-invalid"],
    [{ provider: "YAHOO" }, "symbol-invalid"],
  ])("returns the field error for %j without writing", async (fields, reason) => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    expect(await setMappingAction(null, form({ securityId: msci.id, ...fields }))).toEqual({ ok: false, reason });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns not-found for a missing id", async () => {
    expect(await setMappingAction(null, form({ provider: "YAHOO", symbol: "EUNL.DE" }))).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns unauthorized without a session and writes nothing", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "ETF");
    signOut();
    expect(await setMappingAction(null, form({ securityId: msci.id, provider: "YAHOO", symbol: "EUNL.DE" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await prisma.providerMapping.count()).toBe(0);
  });
});

describe("changeSecurityTypeAction", () => {
  it("stores the new type via the ledger and revalidates", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "STOCK");
    const result = await changeSecurityTypeAction(null, form({ securityId: msci.id, assetType: "ETF" }));
    expect(result).toEqual({ ok: true, security: { ...msci, assetType: "ETF" } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(["CRYPTO", "UNCLASSIFIED", ""])("rejects %j for an ISIN Security", async (assetType) => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "STOCK");
    expect(await changeSecurityTypeAction(null, form({ securityId: msci.id, assetType }))).toEqual({
      ok: false,
      reason: "asset-type-invalid",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns unauthorized without a session and writes nothing", async () => {
    const msci = await security({ isin: MSCI_WORLD }, "iShares Core MSCI World", "STOCK");
    signOut();
    expect(await changeSecurityTypeAction(null, form({ securityId: msci.id, assetType: "ETF" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect((await listSecurities())[0].assetType).toBe("STOCK");
  });
});
