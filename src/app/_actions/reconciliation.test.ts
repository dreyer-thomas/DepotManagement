import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const after = vi.hoisted(() => vi.fn());
const logos = vi.hoisted(() => ({ fetchMissingLogos: vi.fn() }));
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/modules/logos", () => logos);

import { prisma } from "@/db";
import { createDepot, ensureSecurity, getReconciliation, listTransactions, recordTransaction } from "@/modules/ledger";
import {
  bookReconciliationCorrectionAction,
  finishReconciliationAction,
  openReconciliationAction,
  saveReconciliationRowAction,
} from "./reconciliation";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let depotId: string;
let alphaId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.reconciliationRun.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  const alpha = await ensureSecurity({ isin: "DE000SYNCA09" }, { name: "Synthetic Alpha AG", assetType: "STOCK" });
  if (!depot.ok || !alpha.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  alphaId = alpha.security.id;
  await recordTransaction({ depotId, type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
  await recordTransaction({ depotId, type: "BUY", date: "2026-01-02", quantity: "10", price: "50", security: { id: alphaId } });
  revalidatePath.mockClear();
  after.mockClear();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function openForm(statementDate: string) {
  const data = new FormData();
  data.set("depotId", depotId);
  data.set("statementDate", statementDate);
  return data;
}

async function openRun() {
  const result = await openReconciliationAction(null, openForm("2026-02-01"));
  if (!result?.ok) throw new Error("setup failed");
  revalidatePath.mockClear();
  return result.runId;
}

describe("reconciliation actions", () => {
  it("opens a run, saves German values and checks, books corrections and finishes, revalidating each write", async () => {
    const runId = await openRun();
    expect(await saveReconciliationRowAction(runId, alphaId, { statementValue: "12" })).toEqual({ ok: true });
    expect(await saveReconciliationRowAction(runId, null, { statementValue: "512,34" })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await bookReconciliationCorrectionAction(runId, alphaId, "45,50")).toMatchObject({
      ok: true,
      transaction: { type: "ADJUSTMENT", quantity: "2", price: "45.5", date: "2026-02-01" },
    });
    expect(await bookReconciliationCorrectionAction(runId, null)).toMatchObject({
      ok: true,
      transaction: { type: "DEPOSIT", amount: "12.34", note: "Kontoabgleich" },
    });
    const { run } = await getReconciliation(depotId);
    expect(run!.progress).toEqual({ reconciled: 2, total: 2 });
    expect(await finishReconciliationAction(runId)).toEqual({ ok: true, statementDate: "2026-02-01" });
    expect(await getReconciliation(depotId)).toEqual({ run: null, lastReconciled: "2026-02-01" });
  });

  it("rejects a future Stichtag, a second run and unparseable input without revalidating", async () => {
    expect(await openReconciliationAction(null, openForm("2999-01-01"))).toEqual({ ok: false, reason: "date-in-future" });
    const runId = await openRun();
    expect(await openReconciliationAction(null, openForm("2026-01-15"))).toEqual({ ok: false, reason: "run-open" });
    expect(await saveReconciliationRowAction(runId, alphaId, { statementValue: "1,2,3" })).toEqual({ ok: false, reason: "value-invalid" });
    expect(await bookReconciliationCorrectionAction(runId, alphaId, "x")).toEqual({ ok: false, reason: "price-invalid" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listTransactions(depotId)).toHaveLength(2);
  });

  it("returns unauthorized without a session and writes nothing", async () => {
    const runId = await openRun();
    fakes.current.state.incoming.clear();
    expect(await openReconciliationAction(null, openForm("2026-02-01"))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await saveReconciliationRowAction(runId, null, { checked: true })).toEqual({ ok: false, reason: "unauthorized" });
    expect(await bookReconciliationCorrectionAction(runId, null)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await finishReconciliationAction(runId)).toEqual({ ok: false, reason: "unauthorized" });
    expect((await getReconciliation(depotId)).run!.rows.every((row) => !row.checked)).toBe(true);
  });
});
