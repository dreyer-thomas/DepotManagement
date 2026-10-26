import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const refreshPrices = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// The price run never reaches a provider here; saving manual Prices uses the real service.
vi.mock("@/modules/prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/prices")>()),
  refreshPrices,
}));

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { refreshPricesAction, saveManualPriceAction } from "./prices";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  refreshPrices.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-25T23:30:00.000Z"), toFake: ["Date"] });
  await prisma.price.deleteMany();
  await prisma.providerMapping.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function signOut() {
  fakes.current.state.incoming.clear();
}

describe("refreshPricesAction", () => {
  it("awaits a run for today's Berlin date and returns its failures with provider", async () => {
    const failed = [{ securityId: "s1", name: "SAP SE", provider: "YAHOO", reason: "network" }];
    refreshPrices.mockResolvedValue({ updated: 1, failed });
    expect(await refreshPricesAction()).toEqual({ ok: true, updated: 1, failed });
    expect(refreshPrices).toHaveBeenCalledExactlyOnceWith("2026-10-26");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses without a session and runs nothing", async () => {
    signOut();
    expect(await refreshPricesAction()).toEqual({ ok: false, reason: "unauthorized" });
    expect(refreshPrices).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveManualPriceAction", () => {
  async function sap() {
    const result = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
    if (!result.ok) throw new Error("setup failed");
    return result.security.id;
  }

  it("stores a MANUAL Price and revalidates", async () => {
    const id = await sap();
    expect(await saveManualPriceAction(null, form({ securityId: id, date: "2026-10-26", price: "12,34" }))).toEqual({ ok: true });
    expect(await prisma.price.findMany({ select: { date: true, source: true, price: true } })).toEqual([
      { date: "2026-10-26", source: "MANUAL", price: "12.34" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("rejects a date after today (Berlin) and an invalid price without revalidating", async () => {
    const id = await sap();
    expect(await saveManualPriceAction(null, form({ securityId: id, date: "2026-10-27", price: "1" }))).toEqual({
      ok: false,
      reason: "date-invalid",
    });
    expect(await saveManualPriceAction(null, form({ securityId: id, date: "2026-10-26", price: "0" }))).toEqual({
      ok: false,
      reason: "price-invalid",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await prisma.price.count()).toBe(0);
  });

  it("refuses without a session", async () => {
    const id = await sap();
    signOut();
    expect(await saveManualPriceAction(null, form({ securityId: id, date: "2026-10-26", price: "1" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await prisma.price.count()).toBe(0);
  });
});
