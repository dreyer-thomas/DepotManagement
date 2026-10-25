/**
 * Architecture guard: `src/core` is pure. Its files may import only `decimal.js`
 * or relative paths that stay inside `src/core` (AD dependency direction app → modules → core).
 * Colocated unit tests (`*.test.ts`) may additionally import `vitest`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CORE_DIR = resolve(__dirname, "../../src/core");
const ALLOWED_PACKAGES = new Set(["decimal.js"]);
const ALLOWED_IN_TESTS = new Set(["vitest"]);
const TEST_FILE = /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

interface Violation {
  file: string;
  specifier: string;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

/** All module specifiers: static import/export-from, `import()`, `require()`, import-equals. */
function specifiersOf(source: string): string[] {
  const info = ts.preProcessFile(source, true, true);
  return [...info.importedFiles, ...info.referencedFiles, ...info.typeReferenceDirectives].map((ref) => ref.fileName);
}

function isAllowed(specifier: string, file: string, coreDir: string): boolean {
  if (ALLOWED_PACKAGES.has(specifier)) return true;
  if (TEST_FILE.test(file) && ALLOWED_IN_TESTS.has(specifier)) return true;
  const relative = specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
  if (!relative) return false;
  const target = resolve(dirname(file), specifier);
  return target === coreDir || target.startsWith(coreDir + sep);
}

function findViolations(files: { path: string; source: string }[], coreDir: string): Violation[] {
  return files.flatMap(({ path, source }) =>
    specifiersOf(source)
      .filter((specifier) => !isAllowed(specifier, path, coreDir))
      .map((specifier) => ({ file: relative(process.cwd(), path), specifier })),
  );
}

describe("src/core import guard", () => {
  it("src/core imports only decimal.js and files inside src/core", () => {
    const files = listSourceFiles(CORE_DIR).map((path) => ({ path, source: readFileSync(path, "utf8") }));
    expect(files.length).toBeGreaterThan(0);
    const violations = findViolations(files, CORE_DIR);
    const report = violations.map((v) => `${v.file} imports "${v.specifier}"`).join("\n");
    expect(violations, `Forbidden imports in src/core:\n${report}`).toEqual([]);
  });

  it("allows vitest only in test files", () => {
    const source = 'import { it } from "vitest";';
    expect(findViolations([{ path: join(CORE_DIR, "x.test.ts"), source }], CORE_DIR)).toEqual([]);
    expect(findViolations([{ path: join(CORE_DIR, "x.ts"), source }], CORE_DIR).map((v) => v.specifier)).toEqual([
      "vitest",
    ]);
  });

  it("treats . and .. as relative, allowed only while inside src/core", () => {
    const nested = join(CORE_DIR, "fifo", "lots.ts");
    const source = 'import { a } from ".";\nimport { b } from "..";';
    expect(findViolations([{ path: nested, source }], CORE_DIR)).toEqual([]);
    const top = join(CORE_DIR, "format.ts");
    expect(findViolations([{ path: top, source: 'import { x } from "..";' }], CORE_DIR).map((v) => v.specifier)).toEqual([
      "..",
    ]);
  });

  it("detects forbidden specifiers in every import form", () => {
    const path = join(CORE_DIR, "sample.ts");
    const source = [
      'import Decimal from "decimal.js";',
      'import { a } from "./fifo";',
      'import { b } from "./nested/../cash";',
      'import { c } from ".";',
      'import { prisma } from "@/db";',
      'export * from "../modules/x";',
      'import type { Z } from "zod";',
      'const fs = require("node:fs");',
      'const later = await import("../db/index");',
      'import "../core-other/file";',
    ].join("\n");
    expect(findViolations([{ path, source }], CORE_DIR).map((v) => v.specifier)).toEqual([
      "@/db",
      "../modules/x",
      "zod",
      "node:fs",
      "../db/index",
      "../core-other/file",
    ]);
  });
});
