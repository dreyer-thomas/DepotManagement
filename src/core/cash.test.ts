import { describe, expect, it } from "vitest";
import { cashBalance, cashBookings, cashEffect, type CashRow } from "./cash";

const row = (type: string, fields: Partial<CashRow> = {}): CashRow => ({
  type,
  date: "2026-01-01",
  sequence: 1,
  amount: "0",
  fee: "0",
  tax: "0",
  ...fields,
});

describe("cashEffect", () => {
  it.each<[string, Partial<CashRow>, string]>([
    ["BUY", { amount: "1000", fee: "5", tax: "0" }, "-1005"],
    ["BUY with tax", { amount: "1000", fee: "5", tax: "1.5" }, "-1006.5"],
    ["SELL", { amount: "1560", fee: "3", tax: "10" }, "1547"],
    ["DIVIDEND", { amount: "50", tax: "12.5" }, "37.5"],
    ["DIVIDEND refund", { amount: "50", tax: "-2" }, "52"],
    ["FEE", { fee: "4.9" }, "-4.9"],
    ["TAX", { tax: "7" }, "-7"],
    ["TAX refund", { tax: "-3.5" }, "3.5"],
    ["DEPOSIT", { amount: "2000" }, "2000"],
    ["WITHDRAWAL", { amount: "300" }, "-300"],
  ])("%s", (label, fields, expected) => {
    expect(cashEffect(row(label.split(" ")[0], fields))).toBe(expected);
  });

  it("keeps exact decimals and canonical zero", () => {
    expect(cashEffect(row("BUY", { amount: "0.1", fee: "0.2" }))).toBe("-0.3");
    expect(cashEffect(row("SELL", { amount: "5", fee: "5" }))).toBe("0");
  });

  it("rejects an unknown type", () => {
    expect(() => cashEffect(row("SPLIT"))).toThrow(TypeError);
  });
});

const ledger: CashRow[] = [
  row("DEPOSIT", { date: "2026-01-05", amount: "2000" }),
  row("BUY", { date: "2026-01-10", amount: "1000", fee: "5" }),
  row("DIVIDEND", { date: "2026-03-01", amount: "50", tax: "12.5" }),
  row("FEE", { date: "2026-03-02", fee: "4.9" }),
  row("TAX", { date: "2026-03-03", tax: "-3.5" }),
  row("WITHDRAWAL", { date: "2026-03-04", amount: "300" }),
];
const shuffled = [ledger[3], ledger[0], ledger[5], ledger[2], ledger[4], ledger[1]];

describe("cashBookings", () => {
  it("orders by (date, sequence) with a running balance", () => {
    const bookings = cashBookings(shuffled);
    expect(bookings.map((b) => b.type)).toEqual(["DEPOSIT", "BUY", "DIVIDEND", "FEE", "TAX", "WITHDRAWAL"]);
    expect(bookings.map((b) => b.cashEffect)).toEqual(["2000", "-1005", "37.5", "-4.9", "3.5", "-300"]);
    expect(bookings.map((b) => b.balance)).toEqual(["2000", "995", "1032.5", "1027.6", "1031.1", "731.1"]);
  });

  it("uses the sequence within a date and keeps extra fields", () => {
    const rows = [
      { ...row("WITHDRAWAL", { amount: "10", sequence: 2 }), id: "b" },
      { ...row("DEPOSIT", { amount: "5", sequence: 1 }), id: "a" },
    ];
    expect(cashBookings(rows).map((b) => [b.id, b.balance])).toEqual([
      ["a", "5"],
      ["b", "-5"],
    ]);
  });

  it("lists future-dated rows", () => {
    const bookings = cashBookings([...shuffled, row("DEPOSIT", { date: "2099-01-01", amount: "100" })]);
    expect(bookings.at(-1)?.balance).toBe("831.1");
  });
});

describe("cashBalance", () => {
  it("sums effects up to and including asOf", () => {
    expect(cashBalance(shuffled, "2026-10-25")).toBe("731.1");
    expect(cashBalance(shuffled, "2026-01-10")).toBe("995");
    expect(cashBalance(shuffled, "2026-01-04")).toBe("0");
    expect(cashBalance([], "2026-10-25")).toBe("0");
  });

  it("excludes future-dated rows", () => {
    expect(cashBalance([...shuffled, row("DEPOSIT", { date: "2026-10-26", amount: "100" })], "2026-10-25")).toBe("731.1");
  });

  it("may go negative", () => {
    expect(cashBalance([row("WITHDRAWAL", { amount: "50" })], "2026-10-25")).toBe("-50");
  });
});
