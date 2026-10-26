import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHtml, renderText } from "../../../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

class NotFoundError extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { prisma } from "@/db";
import {
  archiveDepot,
  createDepot,
  ensureSecurity,
  finishReconciliation,
  openReconciliation,
  recordTransaction,
  saveReconciliationRow,
} from "@/modules/ledger";
import ReconcilePage, { generateMetadata } from "./page";

beforeEach(async () => {
  await prisma.reconciliationRun.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const props = (id: string) => ({ params: Promise.resolve({ id }) });

async function depot() {
  const result = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
  if (!result.ok) throw new Error("setup failed");
  return result.depot.id;
}

describe("Reconcile page", () => {
  it("calls notFound() for an unknown id", async () => {
    await expect(ReconcilePage(props("xyz"))).rejects.toBeInstanceOf(NotFoundError);
    expect(await generateMetadata(props("xyz"))).toEqual({ title: "Depot nicht gefunden" });
  });

  it("without an open run offers the Stichtag (default today, at most today) and Abgleich starten", async () => {
    const id = await depot();
    const tree = await ReconcilePage(props(id));
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(text).toContain("Depot abgleichen");
    expect(text).toContain("Abgleich starten");
    expect(html).toMatch(/<input[^>]*type="date"[^>]*>/);
    expect(html).toMatch(/name="statementDate"/);
    expect(html).toContain(`href="/depots/${id}"`);
    expect(await generateMetadata(props(id))).toEqual({ title: "Hauptdepot abgleichen" });
  });

  it("with an open run lists every Position held on the Stichtag plus the Cash Account, with entries", async () => {
    const id = await depot();
    const alpha = await ensureSecurity({ isin: "DE000SYNCA09" }, { name: "Synthetic Alpha AG", assetType: "STOCK" });
    if (!alpha.ok) throw new Error("setup failed");
    await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2026-01-01", amount: "1000" });
    await recordTransaction({ depotId: id, type: "BUY", date: "2026-01-02", quantity: "10", price: "50", security: { id: alpha.security.id } });
    const opened = await openReconciliation(id, "2026-02-01", "2026-10-26");
    if (!opened.ok) throw new Error("setup failed");
    await saveReconciliationRow(opened.runId, alpha.security.id, { statementValue: "12" });
    await saveReconciliationRow(opened.runId, null, { checked: true });
    const text = renderText(await ReconcilePage(props(id)));
    expect(text).toContain("Stichtag 01.02.2026");
    expect(text).toContain("1 von 2 abgeglichen");
    expect(text).toMatch(/Synthetic Alpha AG 10 Stück .*Differenz \+2 Stück .*Buchungen ansehen .*Korrektur buchen/);
    expect(text).toMatch(/Cash-Konto 500,00\s€ .*abgeglichen/);
    expect(text).toContain("Abgleich abschließen");
  });

  it("shows the last finished run and is read-only for an archived Depot", async () => {
    const id = await depot();
    const opened = await openReconciliation(id, "2026-02-01", "2026-10-26");
    if (!opened.ok) throw new Error("setup failed");
    await finishReconciliation(opened.runId, "2026-10-26T10:00:00.000Z");
    await archiveDepot(id);
    const text = renderText(await ReconcilePage(props(id)));
    expect(text).toContain("Zuletzt abgeglichen am 01.02.2026");
    expect(text).toContain("Archiviertes Depot – nur lesbar.");
    expect(text).not.toContain("Abgleich starten");
  });
});
