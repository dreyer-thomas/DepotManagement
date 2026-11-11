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
import { getPriceMarks } from "@/modules/marks";
import { setPriceMarksAction } from "./price-marks";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
const TODAY = "2026-11-11";

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  vi.useFakeTimers({ now: new Date("2026-11-11T10:00:00.000Z"), toFake: ["Date"] });
  await prisma.priceMark.deleteMany();
  await prisma.security.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
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

async function sap() {
  const result = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
  if (!result.ok) throw new Error("setup failed");
  return result.security.id;
}

const EMPTY = { stopType: "", stopValue: "", stopSource: "", stopSetDate: "", targetPrice: "", targetSource: "", targetSetDate: "" };

describe("setPriceMarksAction", () => {
  it("refuses without a session", async () => {
    fakes.current.state.incoming.delete(SESSION_COOKIE);
    expect(await setPriceMarksAction(null, form({ securityId: "x", ...EMPTY, targetPrice: "10" }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await prisma.priceMark.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sets German-formatted marks and revalidates every page showing them", async () => {
    const security = await sap();
    const result = await setPriceMarksAction(
      null,
      form({ securityId: security, ...EMPTY, stopType: "FIXED", stopValue: "1.234,50", stopSetDate: "2026-11-01", targetPrice: "245,00", targetSource: " Analyst " }),
    );
    expect(result).toEqual({
      ok: true,
      marks: {
        securityId: security,
        stop: { type: "FIXED", value: "1234.5", source: null, setDate: "2026-11-01" },
        target: { price: "245", source: "Analyst", setDate: TODAY },
      },
    });
    expect(await getPriceMarks(security, TODAY)).toEqual(result && result.ok ? result.marks : null);
    for (const call of [["/"], ["/securities"], ["/securities/[id]", "page"], ["/watchlists"]]) expect(revalidatePath).toHaveBeenCalledWith(...call);
  });

  it("clears both marks and deletes the row", async () => {
    const security = await sap();
    await setPriceMarksAction(null, form({ securityId: security, ...EMPTY, stopType: "TRAILING", stopValue: "10" }));
    expect(await setPriceMarksAction(null, form({ securityId: security, ...EMPTY }))).toEqual({ ok: true, marks: null });
    expect(await prisma.priceMark.count()).toBe(0);
  });

  it("returns the refused field and writes nothing", async () => {
    const security = await sap();
    expect(await setPriceMarksAction(null, form({ securityId: security, ...EMPTY, targetPrice: "abc" }))).toEqual({
      ok: false,
      reason: "price-marks-invalid",
      field: "targetPrice",
      problem: "invalid",
    });
    expect(await setPriceMarksAction(null, form({ securityId: security, ...EMPTY, targetPrice: "10", targetSetDate: "2026-11-12" }))).toMatchObject({
      field: "targetSetDate",
      problem: "future-date",
    });
    expect(await prisma.priceMark.count()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports an unknown Security", async () => {
    expect(await setPriceMarksAction(null, form({ securityId: "missing", ...EMPTY, targetPrice: "10" }))).toEqual({ ok: false, reason: "not-found" });
  });
});
