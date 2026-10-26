import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/deploy.sh", import.meta.url));
const dirs: string[] = [];

/** A fake checkout with scripts/deploy.sh and fake `sudo`, `systemctl` and `npm` on a bin dir. */
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "depot-deploy-")));
  dirs.push(root);
  mkdirSync(join(root, "scripts"));
  copyFileSync(script, join(root, "scripts", "deploy.sh"));
  const bin = join(root, "fake-bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const fakes: Record<string, string> = {
    sudo: `#!/bin/sh\n[ "$1" = "-n" ] && shift\nexec "$@"\n`,
    // FAIL_CALL names one call ("systemctl stop x", "npm run build", ...) that exits 1.
    systemctl: `#!/bin/sh\necho "systemctl $* | cwd=$(pwd)" >> "${log}"\n[ "systemctl $*" != "\${FAIL_CALL:-}" ]\n`,
    npm: `#!/bin/sh\necho "npm $* | cwd=$(pwd)" >> "${log}"\n[ "npm $*" != "\${FAIL_CALL:-}" ]\n`,
  };
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const run = (env: Record<string, string> = {}) =>
    spawnSync("sh", [join(root, "scripts", "deploy.sh")], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: `${bin}:${process.env.PATH}`, ...env },
    });
  const calls = () => readFileSync(log, "utf8").trim().split("\n");
  return { root, run, calls };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/deploy.sh", () => {
  it("stops the service, installs, builds and starts the service, from the repo root", () => {
    const { root, run, calls } = setup();
    const result = run();
    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      `systemctl stop depotmanagement | cwd=${root}`,
      `npm ci | cwd=${root}`,
      `npm run build | cwd=${root}`,
      `systemctl start depotmanagement | cwd=${root}`,
    ]);
    expect(result.stdout).toContain("journalctl -u depotmanagement");
  });

  it("does not start the service when the build fails", () => {
    const { run, calls } = setup();
    const result = run({ FAIL_CALL: "npm run build" });
    expect(result.status).not.toBe(0);
    expect(calls().map((line) => line.split(" | ")[0])).toEqual([
      "systemctl stop depotmanagement",
      "npm ci",
      "npm run build",
    ]);
    expect(result.stderr).toContain("step failed: Build");
  });

  it("stops before installing when the service cannot be stopped", () => {
    const { run, calls } = setup();
    const result = run({ FAIL_CALL: "systemctl stop depotmanagement" });
    expect(result.status).not.toBe(0);
    expect(calls()).toHaveLength(1);
  });

  it("targets DEPOT_SERVICE", () => {
    const { run, calls } = setup();
    expect(run({ DEPOT_SERVICE: "depot-test" }).status).toBe(0);
    const systemctl = calls().filter((line) => line.startsWith("systemctl"));
    expect(systemctl.map((line) => line.split(" | ")[0])).toEqual([
      "systemctl stop depot-test",
      "systemctl start depot-test",
    ]);
  });
});
