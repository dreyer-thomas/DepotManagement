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

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { listTaxAllowances, listTeilfreistellungOverrides } from "@/modules/tax";
import { setTaxAllowancesAction, setTeilfreistellungAction } from "./tax";

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
  await prisma.taxAllowance.deleteMany();
  await prisma.teilfreistellungOverride.deleteMany();
  await prisma.security.deleteMany();
  const security = await ensureSecurity({ isin: "IE00B4L5Y983" }, { name: "iShares Core MSCI World", assetType: "ETF" });
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

describe("setTaxAllowancesAction", () => {
  it("stores the amounts per broker and revalidates Settings and Analysen", async () => {
    const result = await setTaxAllowancesAction(null, form({ year: "2026", "amount-COMDIRECT": "801", "amount-DEUTSCHE_BANK": "300", "amount-FINANZEN_ZERO": "" }));
    expect(result).toEqual({ ok: true });
    expect(await listTaxAllowances()).toEqual([
      { broker: "COMDIRECT", year: 2026, amount: "801" },
      { broker: "DEUTSCHE_BANK", year: 2026, amount: "300" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/analyses");
  });

  it("returns the broker's field error without writing", async () => {
    expect(await setTaxAllowancesAction(null, form({ year: "2026", "amount-COMDIRECT": "801", "amount-DEUTSCHE_BANK": "-5" }))).toEqual({
      ok: false,
      reason: "amount-invalid",
      broker: "DEUTSCHE_BANK",
    });
    expect(await listTaxAllowances()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await setTaxAllowancesAction(null, form({ year: "2026", "amount-COMDIRECT": "801" }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await listTaxAllowances()).toEqual([]);
  });
});

describe("setTeilfreistellungAction", () => {
  it("sets and clears the override and revalidates the Securities page and Analysen", async () => {
    expect(await setTeilfreistellungAction(null, form({ securityId, rate: "0" }))).toEqual({ ok: true });
    expect(await listTeilfreistellungOverrides()).toEqual({ [securityId]: "0" });
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect(revalidatePath).toHaveBeenCalledWith("/analyses");
    expect(await setTeilfreistellungAction(null, form({ securityId, rate: "" }))).toEqual({ ok: true });
    expect(await listTeilfreistellungOverrides()).toEqual({});
  });

  it("returns the reason for an invalid rate, an unknown Security and a missing session", async () => {
    expect(await setTeilfreistellungAction(null, form({ securityId, rate: "0.5" }))).toEqual({ ok: false, reason: "rate-invalid" });
    expect(await setTeilfreistellungAction(null, form({ securityId: "nope", rate: "0.3" }))).toEqual({ ok: false, reason: "security-not-found" });
    fakes.current.state.incoming.clear();
    expect(await setTeilfreistellungAction(null, form({ securityId, rate: "0.3" }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await listTeilfreistellungOverrides()).toEqual({});
  });
});
