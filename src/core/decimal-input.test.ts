import { describe, expect, it } from "vitest";
import { parseDecimalInput } from "./decimal-input";

describe("parseDecimalInput", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["0,5", "0.5"],
    ["12.5", "12.5"],
    ["1.234", "1234"],
    ["1.234.567", "1234567"],
    ["1.234.567,891", "1234567.891"],
    ["1234,5", "1234.5"],
    ["123,450", "123.45"],
    ["1.2345", "1.2345"],
    ["  4,90 ", "4.9"],
    ["1 234,56", "1234.56"],
    ["-3,21", "-3.21"],
    ["-0", "0"],
    ["10", "10"],
    ["0.123", "0.123"],
    ["0.500", "0.5"],
    ["0,00012345", "0.00012345"],
    ["0.000000001", "0.000000001"],
    ["123456789012345678901234567890,123456789", "123456789012345678901234567890.123456789"],
  ])("%j → %j", (text, value) => {
    expect(parseDecimalInput(text)).toEqual({ ok: true, value });
  });

  it.each(["", "   "])("treats %j as empty", (text) => {
    expect(parseDecimalInput(text)).toEqual({ ok: true, value: "" });
  });

  it.each(["1,2,3", "12.34,5", "1.23,4", ",5", "5,", "1.2.3", "abc", "1e5", "+5", "--1", "-", "12,5€", "1.234.56", "0x10", "0.123,5"])(
    "rejects %j",
    (text) => {
      expect(parseDecimalInput(text)).toEqual({ ok: false });
    },
  );
});
