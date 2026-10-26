import { describe, expect, it } from "vitest";
import { germanAmount, germanDate } from "./german";

describe("germanAmount", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["0,5", "0.5"],
    ["2,2450", "2.245"],
    ["1,23456789", "1.23456789"],
    ["-7,90", "-7.9"],
    ["- 7,90", "-7.9"],
    [" 1.005,00 ", "1005"],
    ["12", "12"],
    ["1.000", "1000"],
  ])("reads %s as %s", (text, expected) => {
    expect(germanAmount(text)).toBe(expected);
  });

  it.each(["", " ", "abc", "1,2,3", "12.34,5", "EUR 1,00", "1,00-"])("rejects %j", (text) => {
    expect(germanAmount(text)).toBeNull();
  });
});

describe("germanDate", () => {
  it("converts dd.mm.yyyy to a business date", () => {
    expect(germanDate("08.10.2026")).toBe("2026-10-08");
    expect(germanDate(" 29.02.2024 ")).toBe("2024-02-29");
  });

  it.each(["31.02.2026", "8.10.2026", "2026-10-08", "08.13.2026", ""])("rejects %j", (text) => {
    expect(germanDate(text)).toBeNull();
  });
});
