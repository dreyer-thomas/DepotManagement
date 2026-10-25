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
import { createDepot, ensureSecurity, listIsinChanges, listSplits, recordTransaction } from "@/modules/ledger";
import { deleteIsinChangeAction, deleteSplitAction, saveIsinChangeAction, saveSplitAction } from "./corporate-actions";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let depotId: string;
let securityId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.corporateAction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  const security = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" });
  if (!depot.ok || !security.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  securityId = security.security.id;
  revalidatePath.mockClear();
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
  for (const [key, value] of Object.entries({ securityId, date: "2024-03-01", ratio: "1:4", ...fields })) data.set(key, value);
  return data;
}

describe("saveSplitAction", () => {
  it("records a split and revalidates the layout", async () => {
    const result = await saveSplitAction(null, form({}));
    expect(result).toMatchObject({ ok: true, split: { date: "2024-03-01", ratioOld: "1", ratioNew: "4" } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await listSplits()).toHaveLength(1);
  });

  it("edits a split when splitId is given", async () => {
    const created = await saveSplitAction(null, form({}));
    if (!created?.ok) throw new Error("setup failed");
    const result = await saveSplitAction(null, form({ splitId: created.split.id, date: "2024-04-01", ratio: "1 : 2" }));
    expect(result).toMatchObject({ ok: true, split: { id: created.split.id, date: "2024-04-01", ratioNew: "2" } });
  });

  it("returns the ledger reason without revalidating", async () => {
    expect(await saveSplitAction(null, form({ ratio: "abc" }))).toEqual({ ok: false, reason: "ratio-invalid" });
    expect(await saveSplitAction(null, form({ securityId: "" }))).toEqual({ ok: false, reason: "security-not-found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns unauthorized without a session and writes nothing", async () => {
    fakes.current.state.incoming.clear();
    expect(await saveSplitAction(null, form({}))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await deleteSplitAction("x")).toEqual({ ok: false, reason: "unauthorized" });
    expect(await listSplits()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteSplitAction", () => {
  it("deletes a split, or refuses when a later SELL depends on it", async () => {
    const created = await saveSplitAction(null, form({}));
    if (!created?.ok) throw new Error("setup failed");
    const base = { depotId, security: { id: securityId }, price: "1" };
    await recordTransaction({ ...base, type: "BUY", date: "2024-01-02", quantity: "10" });
    await recordTransaction({ ...base, type: "SELL", date: "2024-05-01", quantity: "40" });
    revalidatePath.mockClear();
    expect(await deleteSplitAction(created.split.id)).toEqual({
      ok: false,
      reason: "later-sell-exceeds-holding",
      date: "2024-05-01",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    await prisma.transaction.deleteMany();
    expect(await deleteSplitAction(created.split.id)).toMatchObject({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await listSplits()).toEqual([]);
  });
});

function isinForm(fields: Record<string, string>) {
  const data = new FormData();
  const defaults = {
    oldSecurityId: securityId,
    newSecurity: "1",
    securityIdentifier: "US5949181045",
    securityName: "Neu AG",
    assetType: "STOCK",
    date: "2024-03-01",
    oldQuantity: "10",
    newQuantity: "2,5",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) data.set(key, value);
  return data;
}

describe("saveIsinChangeAction", () => {
  it("records a change to a new Security (German decimals) and revalidates the layout", async () => {
    const result = await saveIsinChangeAction(null, isinForm({}));
    expect(result).toMatchObject({
      ok: true,
      isinChange: { date: "2024-03-01", oldQuantity: "10", newQuantity: "2.5", newSecurity: { isin: "US5949181045" } },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await listIsinChanges()).toHaveLength(1);
  });

  it("records a change to an existing Security and edits it when isinChangeId is given", async () => {
    const other = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
    if (!other.ok) throw new Error("setup failed");
    const created = await saveIsinChangeAction(null, isinForm({ newSecurity: "", newSecurityId: other.security.id }));
    if (!created?.ok) throw new Error("setup failed");
    expect(created.isinChange.newSecurity.id).toBe(other.security.id);
    const edited = await saveIsinChangeAction(
      null,
      isinForm({ isinChangeId: created.isinChange.id, date: "2024-04-01", oldQuantity: "1", newQuantity: "1.000,5" }),
    );
    expect(edited).toMatchObject({ ok: true, isinChange: { id: created.isinChange.id, date: "2024-04-01", newQuantity: "1000.5" } });
  });

  it("maps unparseable quantities and returns ledger reasons without revalidating", async () => {
    expect(await saveIsinChangeAction(null, isinForm({ oldQuantity: "1,2,3" }))).toEqual({ ok: false, reason: "old-quantity-invalid" });
    expect(await saveIsinChangeAction(null, isinForm({ newQuantity: "abc" }))).toEqual({ ok: false, reason: "new-quantity-invalid" });
    expect(await saveIsinChangeAction(null, isinForm({ newQuantity: "" }))).toEqual({ ok: false, reason: "new-quantity-invalid" });
    expect(await saveIsinChangeAction(null, isinForm({ securityIdentifier: "XX" }))).toEqual({ ok: false, reason: "isin-invalid" });
    expect(await saveIsinChangeAction(null, isinForm({ newSecurity: "", newSecurityId: "" }))).toEqual({
      ok: false,
      reason: "security-not-found",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns unauthorized without a session and writes nothing", async () => {
    fakes.current.state.incoming.clear();
    expect(await saveIsinChangeAction(null, isinForm({}))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await deleteIsinChangeAction("x")).toEqual({ ok: false, reason: "unauthorized" });
    expect(await listIsinChanges()).toEqual([]);
  });
});

describe("deleteIsinChangeAction", () => {
  it("deletes a change, or refuses when a later SELL of the new Security depends on it", async () => {
    const created = await saveIsinChangeAction(null, isinForm({ oldQuantity: "1", newQuantity: "1" }));
    if (!created?.ok) throw new Error("setup failed");
    await recordTransaction({ depotId, security: { id: securityId }, price: "1", type: "BUY", date: "2024-01-02", quantity: "10" });
    await recordTransaction({
      depotId,
      security: { id: created.isinChange.newSecurity.id },
      price: "1",
      type: "SELL",
      date: "2024-05-01",
      quantity: "10",
    });
    revalidatePath.mockClear();
    expect(await deleteIsinChangeAction(created.isinChange.id)).toEqual({
      ok: false,
      reason: "later-sell-exceeds-holding",
      date: "2024-05-01",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    await prisma.transaction.deleteMany();
    expect(await deleteIsinChangeAction(created.isinChange.id)).toMatchObject({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await listIsinChanges()).toEqual([]);
  });
});
