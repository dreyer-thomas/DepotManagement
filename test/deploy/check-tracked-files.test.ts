import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/check-tracked-files.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const dirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "depot-tracked-")));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** A temp git repo whose index tracks the given (empty) files. */
function repoTracking(paths: string[]): string {
  const dir = tempDir();
  git(dir, ["init", "--quiet"]);
  for (const path of paths) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), "");
  }
  // -f: global excludes must not hide the forbidden files.
  git(dir, ["add", "-f", "--", ...paths]);
  return dir;
}

/** Runs the check in `cwd`; git does not look for a repository above `ceiling`. */
function check(cwd: string, ceiling = dirname(cwd)) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CEILING_DIRECTORIES: ceiling };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return spawnSync(process.execPath, [script], { cwd, encoding: "utf8", env });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/check-tracked-files.mjs", () => {
  it("accepts a repo with only allowed files", () => {
    const result = check(repoTracking([".env.example", "test/fixtures/a.csv.txt", "x.txt", "README.md"]));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("fails and names every tracked env, SQLite, CSV and PDF file", () => {
    const forbidden = [
      ".env",
      "config/.env.local",
      // Nested: on a case-insensitive file system `.ENV` would be the same file as `.env`.
      "upper/.ENV",
      "deploy/production.env",
      "depot.db",
      "b.SQLITE",
      "x.sqlite3",
      "depot.db-wal",
      "y.db-shm",
      "z.db-journal",
      "export.csv",
      "data/Export.CSV",
      "doc.pdf",
      "docs/Statement.PDF",
    ];
    const result = check(repoTracking([...forbidden, "README.md", ".env.example"]));
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    for (const path of forbidden) expect(output).toContain(`${path} (`);
    expect(output).not.toContain("README.md");
    expect(output).not.toContain(".env.example");
  });

  it("checks the whole repository when run from a subdirectory", () => {
    const root = repoTracking(["depot.db", "sub/README.md"]);
    const result = check(join(root, "sub"), dirname(root));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("depot.db (");
  });

  it("exits 2 with a message outside a git repository", () => {
    const result = check(tempDir());
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git ls-files failed");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("passes for this repository", () => {
    const result = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
