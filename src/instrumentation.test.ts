import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { register } from "./instrumentation";

const savedEnv = { ...process.env };
let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
  // Invalid auth env: every variable missing.
  delete process.env.AUTH_USERNAME;
  delete process.env.AUTH_PASSWORD_HASH;
  delete process.env.SESSION_SECRET;
  exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("register", () => {
  it("exits with 1 on the Node.js runtime when the auth env is invalid", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it.each([undefined, "edge"])("does not exit when NEXT_RUNTIME is %s", async (runtime) => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});
