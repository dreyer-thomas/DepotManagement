import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

class NotFoundError extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/db";
import { createImportBatch, type Parser, UNRECOGNIZED_REASON } from "@/modules/import";
import { createDepot, ensureSecurity, recordTransaction } from "@/modules/ledger";
import { ImportBatchView } from "../../../_components/import/ImportBatchView";
import ImportBatchPage from "./page";

let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "depot-import-batch-page-"));
  await prisma.importBatch.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const BUY = { type: "BUY", date: "2026-10-08", isin: "IE00BK5BQT80", name: "Beispiel ETF", quantity: "12", price: "123.53", amount: "1482.36", fee: "1.5" } as const;
const stub: Parser = (text) => (text.includes("Kauf") ? [BUY] : { error: "unrecognized" });
const pdf = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(`%PDF-1.4 ${text}`) });

const page = (batchId: string) => ImportBatchPage({ params: Promise.resolve({ batchId }) });

describe("Import batch page", () => {
  it("calls notFound() for an unknown batch", async () => {
    await expect(page("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("shows Depot, Broker, the summary, Verwerfen and one card per file", async () => {
    const depot = await createDepot({ name: "ROBIN", broker: "DEUTSCHE_BANK" });
    if (!depot.ok) throw new Error("setup failed");
    const files = [pdf("kauf.pdf", "Kauf"), pdf("auszug.pdf", "Konto"), pdf("kauf-kopie.pdf", "Kauf")];
    const staged = await createImportBatch(depot.depot.id, files, {
      env: { DATA_DIR: dataDir },
      now: () => new Date("2026-10-26T10:00:00.000Z"),
      extract: async (bytes) => new TextDecoder().decode(bytes),
      registry: { COMDIRECT: [], DEUTSCHE_BANK: [{ documentType: "trade", parse: stub }], FINANZEN_ZERO: [] },
    });
    if (!staged.ok) throw new Error(staged.reason);
    const tree = await page(staged.batchId);
    const text = renderText(tree);
    const html = renderHtml(tree);
    expect(html).toMatch(/<a(?=[^>]*aria-label="Zurück zu Import")(?=[^>]*href="\/import")[^>]*>/);
    expect(text).toContain("Import prüfen ROBIN · Deutsche Bank · hochgeladen am 26.10.2026, 11:00");
    expect(text).toContain("3 Dateien: 0 erkannt, 2 mehrdeutig, 1 fehlgeschlagen · 2 Entscheidungen offen");
    expect(findElement(tree, ImportBatchView)?.props.batch).toMatchObject({ id: staged.batchId, status: "OPEN" });
    expect(html).toMatch(/<button[^>]*>Verwerfen<\/button>/);
    expect(text).toMatch(/kauf\.pdf mehrdeutig .*Kauf 08\.10\.2026 B?E? ?Beispiel ETF IE00BK5BQT80 12 1\.482,36\s€ 1,50\s€ 0,00\s€ Buchen Verwerfen Bearbeiten/);
    expect(text).toContain("Gleiche Buchung mehrfach in diesem Import. Bitte entscheiden.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>0 Buchungen buchen<\/button>/);
    expect(text).toContain("Manuell erfassen");
    expect(text).toContain(`auszug.pdf fehlgeschlagen ${UNRECOGNIZED_REASON}`);
    expect(text).toMatch(/kauf-kopie\.pdf mehrdeutig Diese Datei wurde bereits hochgeladen\./);
    expect((text.match(/Diese Datei wurde bereits hochgeladen\./g) ?? []).length).toBe(1);
    expect(html).toContain('data-import-status="AMBIGUOUS"');
    expect(html).toContain('data-import-status="FAILED"');
  });

  it("shows a re-imported booked document as Duplikat and books nothing", async () => {
    const depot = await createDepot({ name: "ROBIN", broker: "DEUTSCHE_BANK" });
    if (!depot.ok) throw new Error("setup failed");
    const security = await ensureSecurity({ isin: BUY.isin }, { name: "Beispiel ETF", assetType: "ETF" });
    if (!security.ok) throw new Error("setup failed");
    const recorded = await recordTransaction({ depotId: depot.depot.id, type: "BUY", date: BUY.date, quantity: BUY.quantity, price: BUY.price, amount: BUY.amount, fee: BUY.fee, security: { id: security.security.id } });
    expect(recorded.ok).toBe(true);
    const staged = await createImportBatch(depot.depot.id, [pdf("kauf.pdf", "Kauf")], {
      env: { DATA_DIR: dataDir },
      extract: async (bytes) => new TextDecoder().decode(bytes),
      registry: { COMDIRECT: [], DEUTSCHE_BANK: [{ documentType: "trade", parse: stub }], FINANZEN_ZERO: [] },
    });
    if (!staged.ok) throw new Error(staged.reason);
    const tree = await page(staged.batchId);
    const text = renderText(tree);
    expect(text).toContain("1 Datei: 0 erkannt, 1 Duplikat");
    expect(text).toContain("kauf.pdf Duplikat");
    expect(text).toContain("Bereits gebucht am 08.10.2026. Wird nicht erneut gebucht.");
    expect(renderHtml(tree)).toMatch(/<button[^>]*disabled=""[^>]*>0 Buchungen buchen<\/button>/);
  });

  it("shows a BOOKED batch read-only with a link to the Depot", async () => {
    const depot = await createDepot({ name: "ROBIN", broker: "DEUTSCHE_BANK" });
    if (!depot.ok) throw new Error("setup failed");
    const staged = await createImportBatch(depot.depot.id, [pdf("kauf.pdf", "Kauf")], {
      env: { DATA_DIR: dataDir },
      extract: async (bytes) => new TextDecoder().decode(bytes),
      registry: { COMDIRECT: [], DEUTSCHE_BANK: [{ documentType: "trade", parse: stub }], FINANZEN_ZERO: [] },
    });
    if (!staged.ok) throw new Error(staged.reason);
    await prisma.importBatch.update({ where: { id: staged.batchId }, data: { status: "BOOKED" } });
    const html = renderHtml(await page(staged.batchId));
    const text = renderText(await page(staged.batchId));
    expect(text).toContain("Dieser Import wurde gebucht. Zum Depot");
    expect(html).toContain(`href="/depots/${depot.depot.id}"`);
    expect(text).not.toContain("Buchungen buchen");
    expect(text).not.toContain("Verwerfen");
    expect(text).not.toContain("Bearbeiten");
  });
});
