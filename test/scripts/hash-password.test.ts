import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { describe, expect, it } from "vitest";
import { readAuthConfig } from "@/modules/auth/config";

const script = fileURLToPath(new URL("../../scripts/hash-password.mjs", import.meta.url));

describe("hash-password script", () => {
  it("prints one escaped AUTH_PASSWORD_HASH line for the first stdin line", async () => {
    const stdout = execFileSync(process.execPath, [script], {
      input: "pw-synthetic\nignored second line\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = stdout.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^AUTH_PASSWORD_HASH=\\\$2b\\\$12\\\$[./A-Za-z0-9]{53}$/);

    const hash = lines[0].slice("AUTH_PASSWORD_HASH=".length).replaceAll("\\$", "$");
    const config = readAuthConfig({ AUTH_USERNAME: "tester", AUTH_PASSWORD_HASH: hash, SESSION_SECRET: "s".repeat(32) });
    expect(config.ok).toBe(true);
    expect(await bcrypt.compare("pw-synthetic", hash)).toBe(true);
    expect(await bcrypt.compare("ignored second line", hash)).toBe(false);
  });

  it("fails without a password", () => {
    expect(() =>
      execFileSync(process.execPath, [script], { input: "\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }),
    ).toThrow();
  });
});
