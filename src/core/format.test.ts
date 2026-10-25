import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { formatDate, formatMonth, formatMoney, formatPercent, formatQuantity } from "./format";

const NBSP = " ";

describe("formatMoney", () => {
  it("formats with de-DE grouping, two decimals and NBSP before €", () => {
    expect(formatMoney("1234.5")).toBe(`1.234,50${NBSP}€`);
    expect(formatMoney("-1234567.891")).toBe(`-1.234.567,89${NBSP}€`);
    expect(formatMoney("0")).toBe(`0,00${NBSP}€`);
    expect(formatMoney("999.999")).toBe(`1.000,00${NBSP}€`);
  });

  it("rounds half-up", () => {
    expect(formatMoney("0.005")).toBe(`0,01${NBSP}€`);
    expect(formatMoney("-0.005")).toBe(`-0,01${NBSP}€`);
    expect(formatMoney("1.004999")).toBe(`1,00${NBSP}€`);
  });

  it("renders negative zero after rounding without a sign", () => {
    expect(formatMoney("-0.004")).toBe(`0,00${NBSP}€`);
    expect(formatMoney("-0")).toBe(`0,00${NBSP}€`);
  });

  it("adds + for positive values when sign is requested, never for zero", () => {
    expect(formatMoney("12.3", { sign: true })).toBe(`+12,30${NBSP}€`);
    expect(formatMoney("0", { sign: true })).toBe(`0,00${NBSP}€`);
    expect(formatMoney("-12.3", { sign: true })).toBe(`-12,30${NBSP}€`);
  });

  it("keeps precision beyond JS number range", () => {
    expect(formatMoney("12345678901234567890.125")).toBe(`12.345.678.901.234.567.890,13${NBSP}€`);
  });

  it("accepts Decimal instances", () => {
    expect(formatMoney(new Decimal("1.5"))).toBe(`1,50${NBSP}€`);
  });

  it("throws on invalid decimals", () => {
    expect(() => formatMoney("abc")).toThrow();
    expect(() => formatMoney("Infinity")).toThrow(TypeError);
    expect(() => formatMoney("NaN")).toThrow(TypeError);
  });
});

describe("formatPercent", () => {
  it("takes a ratio and is always signed", () => {
    expect(formatPercent("0.0321")).toBe(`+3,21${NBSP}%`);
    expect(formatPercent("-0.5")).toBe(`-50,00${NBSP}%`);
    expect(formatPercent("12.345")).toBe(`+1.234,50${NBSP}%`);
  });

  it("shows zero without a sign", () => {
    expect(formatPercent("0")).toBe(`0,00${NBSP}%`);
    expect(formatPercent("-0.00001")).toBe(`0,00${NBSP}%`);
  });
});

describe("formatQuantity", () => {
  it("trims trailing zeros and groups thousands", () => {
    expect(formatQuantity("10.50000000")).toBe("10,5");
    expect(formatQuantity("0.12345678")).toBe("0,12345678");
    expect(formatQuantity("1234")).toBe("1.234");
    expect(formatQuantity("1234.000")).toBe("1.234");
  });

  it("rounds half-up to at most 8 decimals", () => {
    expect(formatQuantity("0.123456785")).toBe("0,12345679");
    expect(formatQuantity("-2.5")).toBe("-2,5");
  });
});

describe("formatDate", () => {
  it("formats business dates as DD.MM.YYYY", () => {
    expect(formatDate("2026-10-25")).toBe("25.10.2026");
    expect(formatDate("2024-02-29")).toBe("29.02.2024");
  });

  it.each(["2026-1-5", "25.10.2026", "2026-10-25T00:00:00Z", "", "2026-13-01", "2026-00-10", "2026-02-29", "1900-02-29", "2026-04-31", "2026-10-00"])(
    "throws TypeError for %j",
    (input) => {
      expect(() => formatDate(input)).toThrow(TypeError);
    },
  );
});

describe("formatMonth", () => {
  it("renders the German month and year", () => {
    expect(formatMonth("2026-10-25")).toBe("Oktober 2026");
    expect(formatMonth("2026-03-01")).toBe("März 2026");
    expect(formatMonth("2027-01-31")).toBe("Januar 2027");
  });

  it("throws on an invalid date", () => {
    expect(() => formatMonth("2026-13-01")).toThrow(TypeError);
  });
});
