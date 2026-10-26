import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logos = vi.hoisted(() => ({ fetchMissingLogos: vi.fn() }));
vi.mock("@/modules/logos", () => logos);

import { runLogoFetch } from "./logo-fetch";

beforeEach(() => {
  logos.fetchMissingLogos.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runLogoFetch", () => {
  it("runs the logo fetch", async () => {
    logos.fetchMissingLogos.mockResolvedValue({ stored: 1, notFound: 0, failed: 0 });
    await runLogoFetch();
    expect(logos.fetchMissingLogos).toHaveBeenCalledTimes(1);
  });

  it("logs a failing fetch instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logos.fetchMissingLogos.mockRejectedValue(new TypeError("fetch failed"));
    await expect(runLogoFetch()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Logos: fetch failed (TypeError)");
  });
});
