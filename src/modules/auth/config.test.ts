import { describe, expect, it } from "vitest";
import { assertAuthConfig, readAuthConfig } from "./config";

const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const SECRET = "s".repeat(32);
const valid = { AUTH_USERNAME: "tester", AUTH_PASSWORD_HASH: HASH, SESSION_SECRET: SECRET };

describe("readAuthConfig", () => {
  it("accepts a valid configuration", () => {
    expect(readAuthConfig(valid)).toEqual({
      ok: true,
      config: { username: "tester", passwordHash: HASH, secret: SECRET },
    });
  });

  it.each(["$2a$", "$2y$"])("accepts the %s prefix", (prefix) => {
    expect(readAuthConfig({ ...valid, AUTH_PASSWORD_HASH: prefix + HASH.slice(4) }).ok).toBe(true);
  });

  it("reports every missing variable, treating empty as missing", () => {
    const result = readAuthConfig({ AUTH_USERNAME: "", SESSION_SECRET: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(3);
    expect(result.problems.join("\n")).toMatch(/AUTH_USERNAME/);
    expect(result.problems.join("\n")).toMatch(/AUTH_PASSWORD_HASH/);
    expect(result.problems.join("\n")).toMatch(/SESSION_SECRET/);
  });

  it("names invalid variables with the broken rule but never their values", () => {
    const result = readAuthConfig({ ...valid, AUTH_PASSWORD_HASH: "abc", SESSION_SECRET: "tenchars10" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.problems.join("\n");
    expect(text).toMatch(/AUTH_PASSWORD_HASH is not a bcrypt hash/);
    expect(text).toMatch(/SESSION_SECRET must be at least 32 characters/);
    expect(text).not.toContain("tenchars10");
    expect(text).not.toContain("abc");
  });

  it("rejects a hash with a wrong length or prefix", () => {
    expect(readAuthConfig({ ...valid, AUTH_PASSWORD_HASH: HASH.slice(0, -1) }).ok).toBe(false);
    expect(readAuthConfig({ ...valid, AUTH_PASSWORD_HASH: "$2x$" + HASH.slice(4) }).ok).toBe(false);
  });

  it.each(["03", "32", "00", "99"])("rejects the cost %s that bcrypt does not accept", (cost) => {
    expect(readAuthConfig({ ...valid, AUTH_PASSWORD_HASH: `$2b$${cost}$` + HASH.slice(7) }).ok).toBe(false);
  });

  it.each(["04", "10", "31"])("accepts the cost %s", (cost) => {
    expect(readAuthConfig({ ...valid, AUTH_PASSWORD_HASH: `$2b$${cost}$` + HASH.slice(7) }).ok).toBe(true);
  });

  it("accepts a secret of exactly 32 characters and rejects 31", () => {
    expect(readAuthConfig({ ...valid, SESSION_SECRET: "x".repeat(31) }).ok).toBe(false);
  });
});

describe("assertAuthConfig", () => {
  it("returns the config when valid", () => {
    expect(assertAuthConfig(valid).username).toBe("tester");
  });

  it("throws listing all problems and pointing to the hash script and README", () => {
    expect(() => assertAuthConfig({})).toThrow(/SESSION_SECRET[\s\S]*npm run hash-password[\s\S]*README/);
  });
});
