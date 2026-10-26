import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteBatchDir, importsDir, isStoredFileName, writeImportFile } from "./storage";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "depot-import-storage-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("import storage", () => {
  it("resolves the imports directory below DATA_DIR", () => {
    expect(importsDir({ DATA_DIR: root })).toBe(join(root, "imports"));
  });

  it("writes generated names only and refuses traversal", () => {
    const dir = join(root, "imports");
    expect(writeImportFile(dir, "batch1", "item1", new Uint8Array([1]))).toBe("item1.pdf");
    expect(existsSync(join(dir, "batch1", "item1.pdf"))).toBe(true);
    expect(() => writeImportFile(dir, "..", "item1", new Uint8Array([1]))).toThrow();
    expect(() => writeImportFile(dir, "batch1", "../item1", new Uint8Array([1]))).toThrow();
    expect(isStoredFileName("../x.pdf")).toBe(false);
  });

  it("ignores an invalid batch id on delete instead of leaving the imports directory", () => {
    const dir = join(root, "imports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, "keep.txt"), "x");
    deleteBatchDir(dir, "..");
    expect(existsSync(join(root, "keep.txt"))).toBe(true);
  });
});
