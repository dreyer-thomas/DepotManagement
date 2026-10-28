import { describe, expect, it } from "vitest";
import { addDays, addMonths, businessDate, daysBetween, isBusinessDate, lastPerMonth } from "./dates";

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

describe("addDays", () => {
  it("adds and subtracts calendar days across month, year and leap boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-20", -7)).toBe("2026-10-13");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-25", 0)).toBe("2026-10-25");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
    expect(addDays("1900-02-28", 1)).toBe("1900-03-01");
    expect(addDays("1970-01-01", -1)).toBe("1969-12-31");
    expect(addDays("2024-03-04", 965)).toBe("2026-10-25");
  });

  it("rejects a non-business date", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("daysBetween", () => {
  it("counts calendar days across years and leap days, signed", () => {
    expect(daysBetween("2021-01-01", "2022-01-01")).toBe(365);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
    expect(daysBetween("2026-10-25", "2026-10-25")).toBe(0);
    expect(daysBetween("2026-10-26", "2026-10-25")).toBe(-1);
    expect(daysBetween("2024-03-04", "2026-10-25")).toBe(965);
  });

  it("rejects a non-business date", () => {
    expect(() => daysBetween("2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => daysBetween("2026-03-01", "x")).toThrow(RangeError);
  });
});

describe("addMonths", () => {
  it.each([
    ["2026-10-26", -1, "2026-09-26"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2024-03-31", -1, "2024-02-29"],
    ["2024-02-29", -12, "2023-02-28"],
    ["2026-01-15", -1, "2025-12-15"],
    ["2026-10-26", -36, "2023-10-26"],
    ["2026-12-31", 2, "2027-02-28"],
    ["2026-05-31", 0, "2026-05-31"],
  ] as const)("%s %+d → %s", (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it("rejects an invalid date", () => {
    expect(() => addMonths("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("lastPerMonth", () => {
  it("keeps the last point of every month in order", () => {
    const points = ["2025-12-31", "2026-01-01", "2026-01-15", "2026-01-31", "2026-02-01", "2026-03-10", "2026-03-11"].map((date, index) => ({ date, index }));
    expect(lastPerMonth(points)).toEqual([
      { date: "2025-12-31", index: 0 },
      { date: "2026-01-31", index: 3 },
      { date: "2026-02-01", index: 4 },
      { date: "2026-03-11", index: 6 },
    ]);
  });

  it("handles empty and single-point series", () => {
    expect(lastPerMonth([])).toEqual([]);
    expect(lastPerMonth([{ date: "2026-05-05" }])).toEqual([{ date: "2026-05-05" }]);
  });
});
