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
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/db";
import { createImportBatch, type Parser, UNRECOGNIZED_REASON } from "@/modules/import";
import { createDepot } from "@/modules/ledger";
import { ImportBatchView } from "../../../_components/import/ImportBatchView";
import ImportBatchPage from "./page";

let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "depot-import-batch-page-"));
  await prisma.importBatch.deleteMany();
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
    expect(text).toContain("Import prüfen ROBIN · Deutsche Bank · hochgeladen am 26.10.2026, 11:00");
    expect(text).toContain("3 Dateien · 2 erkannt · 1 fehlgeschlagen");
    expect(findElement(tree, ImportBatchView)?.props.batch).toMatchObject({ id: staged.batchId, status: "OPEN" });
    expect(html).toMatch(/<button[^>]*>Verwerfen<\/button>/);
    expect(text).toMatch(/kauf\.pdf erkannt .*Kauf 08\.10\.2026 Beispiel ETF IE00BK5BQT80 12 1\.482,36\s€ 1,50\s€ 0,00\s€/);
    expect(text).toContain(`auszug.pdf fehlgeschlagen ${UNRECOGNIZED_REASON}`);
    expect(text).toMatch(/kauf-kopie\.pdf erkannt Diese Datei wurde bereits hochgeladen\./);
    expect((text.match(/Diese Datei wurde bereits hochgeladen\./g) ?? []).length).toBe(1);
    expect(html).toContain('data-import-status="PARSED"');
    expect(html).toContain('data-import-status="FAILED"');
  });
});
