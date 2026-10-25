import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { checkAuthConfigOrExit } from "./instrumentation-node";

const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const SECRET = "test-secret-with-at-least-32-characters";
const savedEnv = { ...process.env };
let exit: MockInstance<typeof process.exit>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

const output = () => error.mock.calls.map((call) => call.join(" ")).join("\n");

describe("checkAuthConfigOrExit", () => {
  it("exits with 1 and names SESSION_SECRET when it is empty", () => {
    process.env.SESSION_SECRET = "";
    checkAuthConfigOrExit();
    expect(exit).toHaveBeenCalledWith(1);
    expect(output()).toMatch(/SESSION_SECRET is missing or empty/);
    expect(output()).toMatch(/README/);
  });

  it("names an invalid hash and a short secret with their rules, without values", () => {
    process.env.AUTH_PASSWORD_HASH = "abc";
    process.env.SESSION_SECRET = "tenchars10";
    checkAuthConfigOrExit();
    expect(exit).toHaveBeenCalledWith(1);
    expect(output()).toMatch(/AUTH_PASSWORD_HASH is not a bcrypt hash/);
    expect(output()).toMatch(/SESSION_SECRET must be at least 32 characters/);
    expect(output()).not.toContain("tenchars10");
  });

  it("does not exit with a valid configuration", () => {
    checkAuthConfigOrExit();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
