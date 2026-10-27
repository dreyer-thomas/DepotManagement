import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/deploy.sh", import.meta.url));
const dirs: string[] = [];
const PREVIOUS = "1111111111111111111111111111111111111111";
const GATE = "307 http://127.0.0.1:3000/login?next=%2F";

/**
 * A fake checkout with scripts/deploy.sh, a database and a backup dir, and fake `sudo`, `systemctl`,
 * `journalctl`, `npm`, `git`, `curl` and `sleep` on a bin dir. Every fake logs its call.
 */
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "depot-deploy-")));
  dirs.push(root);
  mkdirSync(join(root, "scripts"));
  copyFileSync(script, join(root, "scripts", "deploy.sh"));
  mkdirSync(join(root, ".next"));
  const data = join(root, "data");
  const backups = join(data, "backups");
  mkdirSync(backups, { recursive: true });
  const database = join(data, "depot.db");
  writeFileSync(database, "sqlite");
  const bin = join(root, "fake-bin");
  mkdirSync(bin);
  const log = join(root, "calls.log");
  const logged = (name: string, rest = "") =>
    `#!/bin/sh\necho "${name} $* | cwd=$(pwd)" >> "${log}"\n${rest}[ "${name} $*" != "\${FAIL_CALL:-}" ]\n`;
  const fakes: Record<string, string> = {
    sudo: `#!/bin/sh\n[ "$1" = "-n" ] && shift\nexec "$@"\n`,
    systemctl: logged("systemctl", `[ "$1" = "is-active" ] && exit "\${INACTIVE:-0}"\n`),
    journalctl: logged("journalctl"),
    npm: logged("npm"),
    git: logged(
      "git",
      `[ "$1" = "status" ] && { printf '%s' "\${DIRTY:-}"; exit 0; }\n` +
        `[ "$1 $2" = "rev-parse HEAD" ] && { echo ${PREVIOUS}; exit 0; }\n` +
        `[ "$1 $2" = "rev-parse --short" ] && { echo 1111111; exit 0; }\n`,
    ),
    curl: logged("curl", `printf '%s' "\${ANSWER-${GATE}}"\n`),
    sleep: `#!/bin/sh\nexit 0\n`,
  };
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const run = (env: Record<string, string> = {}) =>
    spawnSync("sh", [join(root, "scripts", "deploy.sh")], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: `${bin}:${process.env.PATH}`,
        DEPOT_DATABASE: database,
        DEPOT_BACKUP_DIR: backups,
        ...env,
      },
    });
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  const commands = () => calls().map((line) => line.split(" | ")[0]);
  const predeploys = () => readdirSync(backups).filter((name) => name.startsWith("predeploy-"));
  return { root, database, backups, run, calls, commands, predeploys };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scripts/deploy.sh", () => {
  it("fast-forwards, stops, copies the database, installs, rebuilds, starts and checks the login gate", () => {
    const { root, backups, run, calls, commands, predeploys } = setup();
    const result = run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(commands().filter((call) => !call.startsWith("git rev-parse"))).toEqual([
      "git status --porcelain",
      "git fetch origin main",
      "git merge --ff-only origin/main",
      "systemctl stop depotmanagement",
      "npm ci",
      "npm run build",
      "systemctl start depotmanagement",
      "systemctl is-active --quiet depotmanagement",
      "curl -s -o /dev/null --max-time 5 -w %{http_code} %{redirect_url} http://127.0.0.1:3000/",
    ]);
    expect(calls().every((line) => line.endsWith(`cwd=${root}`))).toBe(true);
    expect(existsSync(join(root, ".next"))).toBe(false);
    expect(predeploys()).toHaveLength(1);
    expect(readFileSync(join(backups, predeploys()[0]), "utf8")).toBe("sqlite");
    expect(result.stdout).toContain("Login gate live");
  });

  it("refuses a checkout with local changes before stopping anything", () => {
    const { run, commands } = setup();
    const result = run({ DIRTY: " M src/app.ts\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local changes");
    expect(commands().some((call) => call.startsWith("systemctl") || call.startsWith("npm"))).toBe(false);
  });

  it("does not stop the service when the fast-forward fails", () => {
    const { run, commands } = setup();
    const result = run({ FAIL_CALL: "git merge --ff-only origin/main" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("step failed: Fast-forward");
    expect(commands().some((call) => call.startsWith("systemctl"))).toBe(false);
  });

  it("keeps the service stopped when the build fails and names the rollback", () => {
    const { run, commands, predeploys } = setup();
    const result = run({ FAIL_CALL: "npm run build" });
    expect(result.status).toBe(1);
    expect(commands()).not.toContain("systemctl start depotmanagement");
    expect(commands()).toContain("journalctl -u depotmanagement -n 40 --no-pager");
    expect(result.stderr).toContain("step failed: Build");
    expect(result.stderr).toContain(`reset --hard ${PREVIOUS}, then rerun with DEPOT_NO_PULL=1`);
    expect(result.stderr).toContain(predeploys()[0]);
  });

  it("stops the service again when an anonymous request is not redirected to /login", () => {
    const { run, commands } = setup();
    const result = run({ ANSWER: "200 " });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LOGIN GATE NOT ACTIVE");
    const start = commands().indexOf("systemctl start depotmanagement");
    expect(commands().slice(start)).toContain("systemctl stop depotmanagement");
  });

  it("fails when the server never answers, after the timeout", () => {
    const { run } = setup();
    const result = run({ ANSWER: "000 ", DEPOT_START_TIMEOUT: "3" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no answer from http://127.0.0.1:3000 within 3s");
  });

  it("fails when the service does not stay up", () => {
    const { run } = setup();
    const result = run({ INACTIVE: "3" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("did not stay up");
  });

  it("refuses a missing database before stopping, unless DEPOT_FIRST_DEPLOY=1", () => {
    const { database, run, commands, predeploys } = setup();
    rmSync(database);
    const refused = run();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("not found");
    expect(commands().some((call) => call.startsWith("systemctl"))).toBe(false);
    const first = run({ DEPOT_FIRST_DEPLOY: "1" });
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("first deploy");
    expect(predeploys()).toHaveLength(0);
  });

  it("refuses an empty database", () => {
    const { database, run, commands } = setup();
    writeFileSync(database, "");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is empty");
    expect(commands().some((call) => call.startsWith("systemctl"))).toBe(false);
  });

  it("keeps only the newest DEPOT_PREDEPLOY_KEEP copies and never touches daily backups", () => {
    const { backups, run, predeploys } = setup();
    for (let i = 1; i <= 3; i += 1) {
      const old = join(backups, `predeploy-2026010${i}-000000.sqlite`);
      writeFileSync(old, "old");
      utimesSync(old, new Date(2026, 0, i), new Date(2026, 0, i));
    }
    writeFileSync(join(backups, "depot-2026-01-01.sqlite"), "daily");
    expect(run({ DEPOT_PREDEPLOY_KEEP: "2" }).status).toBe(0);
    expect(predeploys()).toHaveLength(2);
    expect(predeploys()).toContain("predeploy-20260103-000000.sqlite");
    expect(existsSync(join(backups, "depot-2026-01-01.sqlite"))).toBe(true);
  });

  it("skips the fetch with DEPOT_NO_PULL=1 and honours DEPOT_SERVICE and DEPOT_URL", () => {
    const { run, commands } = setup();
    const result = run({
      DEPOT_NO_PULL: "1",
      DEPOT_SERVICE: "depot-test",
      DEPOT_URL: "http://127.0.0.1:3002",
      ANSWER: "307 http://127.0.0.1:3002/login",
    });
    expect(result.status).toBe(0);
    expect(commands().some((call) => call.startsWith("git fetch") || call.startsWith("git merge"))).toBe(false);
    expect(commands()).toContain("systemctl stop depot-test");
    expect(commands()).toContain("systemctl start depot-test");
    expect(commands().filter((call) => call.startsWith("curl")).at(-1)).toContain("http://127.0.0.1:3002/");
  });
});
