import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/start.sh", import.meta.url));
const dirs: string[] = [];

/** A fake checkout: scripts/start.sh plus logging `prisma` and `next` in node_modules/.bin. */
function fakeCheckout(prismaExit = 0, nextExit = 0) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "depot-start-")));
  dirs.push(root);
  mkdirSync(join(root, "scripts"));
  copyFileSync(script, join(root, "scripts", "start.sh"));
  const bin = join(root, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const log = join(root, "calls.log");
  for (const [name, exit] of [["prisma", prismaExit], ["next", nextExit]] as const) {
    const path = join(bin, name);
    writeFileSync(
      path,
      `#!/bin/sh\necho "${name} $* | cwd=$(pwd) | telemetry=\${NEXT_TELEMETRY_DISABLED:-unset}" >> "${log}"\nexit ${exit}\n`,
    );
    chmodSync(path, 0o755);
  }
  return { root, log };
}

function run(root: string, env: Record<string, string | undefined> = {}) {
  // Started from another directory, as systemd or `npm start` might.
  return spawnSync("sh", [join(root, "scripts", "start.sh")], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH, ...env },
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/start.sh", () => {
  it("migrates, then starts next on 127.0.0.1:3000 with telemetry off, from the repo root", () => {
    const { root, log } = fakeCheckout(0, 7);
    const result = run(root);
    expect(result.status).toBe(7);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      `prisma migrate deploy | cwd=${root} | telemetry=1`,
      `next start --hostname 127.0.0.1 --port 3000 | cwd=${root} | telemetry=1`,
    ]);
  });

  it("uses PORT for the port", () => {
    const { root, log } = fakeCheckout();
    expect(run(root, { PORT: "3100" }).status).toBe(0);
    expect(readFileSync(log, "utf8")).toContain("next start --hostname 127.0.0.1 --port 3100 |");
  });

  it("does not start next when the migration fails", () => {
    const { root, log } = fakeCheckout(1);
    const result = run(root);
    expect(result.status).not.toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^prisma migrate deploy /);
  });

  it("never binds to all interfaces", () => {
    expect(readFileSync(script, "utf8")).not.toContain("0.0.0.0");
  });
});
