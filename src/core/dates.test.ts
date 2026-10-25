import { describe, expect, it } from "vitest";
import { businessDate, isBusinessDate } from "./dates";

describe("isBusinessDate", () => {
  it.each(["2026-10-25", "2024-02-29", "2000-02-29", "2026-12-31"])("accepts %s", (value) => {
    expect(isBusinessDate(value)).toBe(true);
  });

  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-10-00", "26-10-25", "2026-1-5", "", " 2026-10-25", 20261025, null])(
    "rejects %j",
    (value) => {
      expect(isBusinessDate(value)).toBe(false);
    },
  );
});

// Fixed instants, not the clock: the purity rule targets reading "now" in production core code.
// eslint-disable-next-line no-restricted-syntax
const at = (iso: string) => new Date(iso);

describe("businessDate", () => {
  it("uses Europe/Berlin, not UTC", () => {
    expect(businessDate(at("2026-10-25T21:59:59Z"))).toBe("2026-10-25");
    expect(businessDate(at("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
    expect(businessDate(at("2026-07-01T22:00:00Z"))).toBe("2026-07-02");
    expect(businessDate(at("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
  });
});
