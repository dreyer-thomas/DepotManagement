import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

// process.exit is mocked, so register() continues: never start a real scheduler here.
const startPriceScheduler = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/modules/prices", () => ({ startPriceScheduler, refreshPrices: vi.fn() }));
// Nor a real DB backup: it would copy the home-dir database into the home-dir backup directory.
const startBackupScheduler = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/modules/backup", () => ({ startBackupScheduler }));

import { register } from "./instrumentation";

const savedEnv = { ...process.env };
let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
  // Invalid auth env: every variable missing.
  delete process.env.AUTH_USERNAME;
  delete process.env.AUTH_PASSWORD_HASH;
  delete process.env.SESSION_SECRET;
  startPriceScheduler.mockClear();
  startBackupScheduler.mockClear();
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

  it("starts the price scheduler on the Node.js runtime outside next build", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    await register();
    expect(startPriceScheduler).toHaveBeenCalledTimes(1);
    expect(startBackupScheduler).toHaveBeenCalledTimes(1);
  });

  it("does not start the price scheduler during next build", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    await register();
    expect(startPriceScheduler).not.toHaveBeenCalled();
    expect(startBackupScheduler).not.toHaveBeenCalled();
  });

  it.each([undefined, "edge"])("does not exit when NEXT_RUNTIME is %s", async (runtime) => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = runtime;
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(startPriceScheduler).not.toHaveBeenCalled();
  });
});
