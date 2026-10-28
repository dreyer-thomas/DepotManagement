import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
const scheduleClassificationRefresh = vi.hoisted(() => vi.fn());
vi.mock("./classification-refresh", () => ({ scheduleClassificationRefresh, runClassificationRefresh: vi.fn() }));

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { setAnalystSymbolAction, setClassificationAction, setRegionSplitAction } from "./classification";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let securityId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  scheduleClassificationRefresh.mockClear();
  await prisma.securityClassification.deleteMany();
  await prisma.security.deleteMany();
  const security = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
  if (!security.ok) throw new Error("setup failed");
  securityId = security.security.id;
});

afterEach(() => {
  process.env = { ...savedEnv };
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

const stored = () => prisma.securityClassification.findUnique({ where: { securityId } });

describe("setClassificationAction", () => {
  it("stores the overrides, clears empty fields and revalidates the Securities page", async () => {
    const result = await setClassificationAction(
      null,
      form({ securityId, assetClass: "", sector: "Halbleiter", industry: "", region: "Europa", country: "", companySize: "", currency: "" }),
    );
    expect(result).toMatchObject({ ok: true, classification: { sector: { value: "Halbleiter", source: "manual" }, type: "STOCK" } });
    expect(await stored()).toMatchObject({ sectorManual: "Halbleiter", regionManual: "Europa", currencyManual: null });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect(scheduleClassificationRefresh).toHaveBeenCalledTimes(1);
  });

  it("returns the field reason without writing", async () => {
    expect(await setClassificationAction(null, form({ securityId, region: "Mars" }))).toEqual({ ok: false, reason: "region-invalid" });
    expect(await setClassificationAction(null, form({ securityId, currency: "eur1" }))).toEqual({ ok: false, reason: "currency-invalid" });
    expect(await stored()).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(scheduleClassificationRefresh).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown Security", async () => {
    expect(await setClassificationAction(null, form({ securityId: "nope", sector: "x" }))).toEqual({ ok: false, reason: "not-found" });
  });

  it("writes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await setClassificationAction(null, form({ securityId, sector: "Halbleiter" }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await stored()).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setRegionSplitAction", () => {
  async function fund() {
    const result = await ensureSecurity({ isin: "IE00B4L5Y983" }, { name: "iShares Core MSCI World UCITS ETF", assetType: "ETF" });
    if (!result.ok) throw new Error("setup failed");
    return result.security.id;
  }
  const fields = (id: string, values: string[]) => form({ securityId: id, ...Object.fromEntries(values.map((v, i) => [`split-${i}`, v])) });
  const manualOf = async (id: string) => (await prisma.securityClassification.findUnique({ where: { securityId: id } }))?.regionSplitManual;

  it("stores the split from the indexed fields and revalidates Securities and Analysen", async () => {
    const id = await fund();
    expect(await setRegionSplitAction(null, fields(id, ["60", "37,5", "", "", "", "2,5"]))).toEqual({
      ok: true,
      manual: [
        { region: "USA", weight: "60" },
        { region: "Europa", weight: "37.5" },
        { region: "Sonstige", weight: "2.5" },
      ],
    });
    expect(await manualOf(id)).toBe('{"USA":"60","Europa":"37.5","Sonstige":"2.5"}');
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect(revalidatePath).toHaveBeenCalledWith("/analyses");

    // "Automatisch": all fields empty clears the manual split.
    expect(await setRegionSplitAction(null, fields(id, ["", "", "", "", "", ""]))).toEqual({ ok: true, manual: null });
    expect(await manualOf(id)).toBeNull();
  });

  it("returns the reason without writing", async () => {
    const id = await fund();
    expect(await setRegionSplitAction(null, fields(id, ["60", "39,5", "", "", "", ""]))).toEqual({ ok: false, reason: "split-sum" });
    expect(await setRegionSplitAction(null, fields(id, ["abc", "100", "", "", "", ""]))).toEqual({ ok: false, reason: "split-invalid" });
    expect(await setRegionSplitAction(null, fields(securityId, ["100", "", "", "", "", ""]))).toEqual({ ok: false, reason: "not-a-fund" });
    expect(await prisma.securityClassification.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes nothing without a session", async () => {
    const id = await fund();
    fakes.current.state.incoming.clear();
    expect(await setRegionSplitAction(null, fields(id, ["100", "", "", "", "", ""]))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await prisma.securityClassification.count()).toBe(0);
  });
});

describe("setAnalystSymbolAction", () => {
  it("stores a manual symbol, clears it with an empty input and revalidates Securities and the detail page", async () => {
    expect(await setAnalystSymbolAction(securityId, "nvda")).toEqual({ ok: true });
    expect(await prisma.securityClassification.findUnique({ where: { securityId } })).toMatchObject({ analystSymbol: "NVDA", analystSymbolManual: true });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect(revalidatePath).toHaveBeenCalledWith(`/securities/${securityId}`);
    expect(await setAnalystSymbolAction(securityId, "  ")).toEqual({ ok: true });
    expect(await prisma.securityClassification.findUnique({ where: { securityId } })).toMatchObject({ analystSymbol: null, analystSymbolManual: false });
  });

  it("returns the reason without writing", async () => {
    expect(await setAnalystSymbolAction(securityId, "bad symbol")).toEqual({ ok: false, reason: "symbol-invalid" });
    expect(await setAnalystSymbolAction("missing", "AAPL")).toEqual({ ok: false, reason: "not-found" });
    expect(await prisma.securityClassification.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await setAnalystSymbolAction(securityId, "AAPL")).toEqual({ ok: false, reason: "unauthorized" });
    expect(await prisma.securityClassification.count()).toBe(0);
  });
});
