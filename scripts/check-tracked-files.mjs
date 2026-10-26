#!/usr/bin/env node
// Fails when the git repository in the current directory tracks files that must never be public:
// env files (`.env`, `.env.*`, `*.env`, any case; except `.env.example`), SQLite databases and their side files, CSV exports
// (fixtures are `*.csv.txt`) and PDFs, anywhere in the repo (also when run from a subdirectory).
// Prints each offending path and exits 1; exits 2 if git fails.
import { spawnSync } from "node:child_process";

const FORBIDDEN = [
  {
    reason: "env file",
    test: (name) => {
      const lower = name.toLowerCase();
      return lower !== ".env.example" && (lower === ".env" || lower.startsWith(".env.") || lower.endsWith(".env"));
    },
  },
  { reason: "SQLite file", test: (name) => /\.(db|sqlite|sqlite3)(-(wal|shm|journal))?$/i.test(name) },
  { reason: "CSV file", test: (name) => /\.csv$/i.test(name) },
  { reason: "PDF file", test: (name) => /\.pdf$/i.test(name) },
];

const result = spawnSync("git", ["ls-files", "-z", "--full-name", "--", ":/"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  const detail = result.error ? result.error.message : result.stderr.trim();
  console.error(`check-tracked-files: git ls-files failed${detail ? `: ${detail}` : ""}`);
  process.exit(2);
}

const offending = [];
for (const path of result.stdout.split("\0")) {
  if (path === "") continue;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const rule = FORBIDDEN.find((candidate) => candidate.test(name));
  if (rule) offending.push(`${path} (${rule.reason})`);
}

if (offending.length > 0) {
  console.error("These tracked files must not be committed (public repo):");
  for (const line of offending) console.error(`  ${line}`);
  process.exit(1);
}
