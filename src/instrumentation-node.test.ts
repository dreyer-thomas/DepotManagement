import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

// The real scheduler runs with a fake price run: no provider call and no database in this test.
const refreshPrices = vi.hoisted(() => vi.fn(async () => ({ updated: 0, failed: [] })));
vi.mock("@/modules/prices/prices", () => ({ refreshPrices }));
// The start-up logo run is a fake too: no provider call, no database, no file.
const fetchMissingLogos = vi.hoisted(() => vi.fn(async () => ({ stored: 0, notFound: 0, failed: 0 })));
vi.mock("@/modules/logos", () => ({ fetchMissingLogos }));

const LOGO_START = Symbol.for("depotmanagement.logoStartupRun");

import { stopPriceScheduler } from "@/modules/prices";
import { checkAuthConfigOrExit, startBackgroundJobs } from "./instrumentation-node";

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
  stopPriceScheduler();
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

describe("startBackgroundJobs", () => {
  beforeEach(() => {
    refreshPrices.mockClear();
    fetchMissingLogos.mockClear();
    delete (globalThis as Record<symbol, unknown>)[LOGO_START];
  });

  it("starts one price scheduler with one immediate run, even when called twice", async () => {
    delete process.env.NEXT_PHASE;
    await startBackgroundJobs();
    await startBackgroundJobs();
    await vi.waitFor(() => expect(refreshPrices).toHaveBeenCalledTimes(1));
    expect(refreshPrices.mock.calls[0]).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
  });

  it("starts one logo fetch run, even when called twice", async () => {
    delete process.env.NEXT_PHASE;
    await startBackgroundJobs();
    await startBackgroundJobs();
    await vi.waitFor(() => expect(fetchMissingLogos).toHaveBeenCalledTimes(1));
  });

  it("logs a failing start-up logo run without throwing", async () => {
    delete process.env.NEXT_PHASE;
    fetchMissingLogos.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(startBackgroundJobs()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Logos: start-up fetch failed (TypeError)"));
  });

  it("starts nothing during next build", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    await startBackgroundJobs();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshPrices).not.toHaveBeenCalled();
    expect(fetchMissingLogos).not.toHaveBeenCalled();
  });
});
