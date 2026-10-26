import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";

const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/db";
import { createImportBatch } from "@/modules/import";
import { archiveDepot, createDepot } from "@/modules/ledger";
import { UploadDropzone } from "../../_components/import/UploadDropzone";
import ImportPage from "./page";

beforeEach(async () => {
  await prisma.importBatch.deleteMany();
  await prisma.depot.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

async function depot(name: string) {
  const result = await createDepot({ name, broker: "DEUTSCHE_BANK" });
  if (!result.ok) throw new Error("setup failed");
  return result.depot;
}

const page = (depot?: string) => ImportPage({ searchParams: Promise.resolve(depot ? { depot } : {}) });

describe("Import page", () => {
  it("offers the upload for non-archived Depots and shows that nothing is open", async () => {
    const robin = await depot("ROBIN");
    const old = await depot("Alt");
    expect((await archiveDepot(old.id)).ok).toBe(true);
    const tree = await page();
    const dropzone = findElement(tree, UploadDropzone);
    expect(dropzone?.props.depots).toEqual([{ id: robin.id, name: "ROBIN" }]);
    expect(dropzone?.props.defaultDepotId).toBeUndefined();
    const text = renderText(tree);
    expect(text).toContain("Dokumente hochladen");
    expect(text).toContain("Keine offenen Importe.");
  });

  it("preselects the Depot from ?depot=", async () => {
    await depot("A");
    const b = await depot("B");
    expect(findElement(await page(b.id), UploadDropzone)?.props.defaultDepotId).toBe(b.id);
    expect(renderHtml(await page(b.id))).toMatch(new RegExp(`<option[^>]*value="${b.id}"[^>]*selected`));
  });

  it("lists open batches with Depot, counts and a link to the batch view", async () => {
    const robin = await depot("ROBIN");
    const dataDir = mkdtempSync(join(tmpdir(), "depot-import-page-"));
    const staged = await createImportBatch(robin.id, [{ name: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.4") }], {
      env: { DATA_DIR: dataDir },
      extract: async () => "",
      now: () => new Date("2026-10-26T10:00:00.000Z"),
    });
    if (!staged.ok) throw new Error(staged.reason);
    try {
      const tree = await page();
      const text = renderText(tree);
      expect(text).not.toContain("Keine offenen Importe.");
      expect(text).toContain("ROBIN · Deutsche Bank");
      expect(text).toContain("1 Datei · 0 erkannt · 1 fehlgeschlagen · hochgeladen am 26.10.2026, 11:00");
      expect(renderHtml(tree)).toContain(`href="/import/${staged.batchId}"`);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
