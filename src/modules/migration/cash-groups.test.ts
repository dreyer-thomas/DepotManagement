import { describe, expect, it } from "vitest";
import { cashEffect } from "@/core/cash";
import { reconcileCashGroup, type GroupTrade } from "./cash-groups";

type Row = { name: string; type: string; amount: string; fee?: string; tax?: string; securityKey: string | null };

const trade = (row: Row): GroupTrade<Row> => ({
  trade: row,
  effect: cashEffect({ type: row.type, amount: row.amount, fee: row.fee ?? "0", tax: row.tax ?? "0" }),
  securityKey: row.securityKey,
});

const A = "DE000SYNCA09";
const B = "DE000SYNCB08";
const C = "DE000SYNCC07";

describe("reconcileCashGroup", () => {
  it("books an omitted fee as a DEPOSIT, never a negative TAX", () => {
    const buy = trade({ name: "buy", type: "BUY", amount: "1000", fee: "5", securityKey: A });
    expect(reconcileCashGroup([buy], [{ direction: "out", amount: "1000" }])).toEqual({ kind: "deposit", amount: "5" });
  });

  it("books a contribution invested in a rebalancing instant as one DEPOSIT", () => {
    const trades = [
      trade({ name: "a", type: "SELL", amount: "220", fee: "1", securityKey: A }),
      trade({ name: "b", type: "BUY", amount: "300", securityKey: B }),
    ];
    expect(reconcileCashGroup(trades, [{ direction: "in", amount: "19" }])).toEqual({ kind: "deposit", amount: "100" });
  });

  it("aligns a group difference of exactly 0.01", () => {
    const sell = trade({ name: "sell", type: "SELL", amount: "100", securityKey: A });
    expect(reconcileCashGroup([sell], [{ direction: "in", amount: "100.01" }])).toEqual({ kind: "align", trade: sell.trade, effect: "100.01" });
    expect(reconcileCashGroup([sell], [{ direction: "in", amount: "99.99" }])).toEqual({ kind: "align", trade: sell.trade, effect: "99.99" });
  });

  it("books withheld tax on a SELL as TAX", () => {
    const sell = trade({ name: "sell", type: "SELL", amount: "440", securityKey: A });
    expect(reconcileCashGroup([sell], [{ direction: "in", amount: "418" }])).toEqual({ kind: "tax", tax: "22", securityKey: A });
  });

  it("books a dividend difference as TAX", () => {
    const dividend = trade({ name: "div", type: "DIVIDEND", amount: "20", tax: "3", securityKey: A });
    expect(reconcileCashGroup([dividend], [{ direction: "in", amount: "15" }])).toEqual({ kind: "tax", tax: "2", securityKey: A });
  });

  it("books a rebalancing instant's net difference as one Security-less TAX", () => {
    const trades = [
      trade({ name: "b", type: "BUY", amount: "250", securityKey: B }),
      trade({ name: "c", type: "BUY", amount: "200", securityKey: C }),
      trade({ name: "a", type: "SELL", amount: "360", securityKey: A }),
    ];
    expect(reconcileCashGroup(trades, [{ direction: "out", amount: "92" }])).toEqual({ kind: "tax", tax: "2", securityKey: null });
  });

  it("aligns the largest trade when the group differs by at most 0.01", () => {
    const trades = [
      trade({ name: "b", type: "BUY", amount: "250", securityKey: B }),
      trade({ name: "c", type: "BUY", amount: "200", securityKey: C }),
      trade({ name: "a", type: "SELL", amount: "360", securityKey: A }),
    ];
    const result = reconcileCashGroup(trades, [{ direction: "out", amount: "90.01" }]);
    expect(result).toEqual({ kind: "align", trade: trades[2].trade, effect: "359.99" });
  });

  it("aligns a single trade within 0.01 like a 1:1 pair", () => {
    const buy = trade({ name: "buy", type: "BUY", amount: "123.456", fee: "1", securityKey: A });
    expect(reconcileCashGroup([buy], [{ direction: "out", amount: "124.46" }])).toEqual({ kind: "align", trade: buy.trade, effect: "-124.46" });
  });

  it("nets cash rows of both directions and picks the chronologically first of equal-sized trades", () => {
    const first = trade({ name: "first", type: "BUY", amount: "100", securityKey: A });
    const second = trade({ name: "second", type: "SELL", amount: "100", securityKey: A });
    const result = reconcileCashGroup([first, second], [
      { direction: "in", amount: "100" },
      { direction: "out", amount: "100.005" },
    ]);
    expect(result).toEqual({ kind: "align", trade: first.trade, effect: "-100.005" });
  });

  it("keeps the Security of a TAX only when every trade shares it", () => {
    const trades = [
      trade({ name: "a1", type: "BUY", amount: "100", securityKey: A }),
      trade({ name: "a2", type: "BUY", amount: "50", securityKey: A }),
    ];
    expect(reconcileCashGroup(trades, [{ direction: "out", amount: "160" }])).toEqual({ kind: "tax", tax: "10", securityKey: A });
    const keyless = [trade({ name: "t", type: "TAX", amount: "0", tax: "5", securityKey: null })];
    expect(reconcileCashGroup(keyless, [{ direction: "out", amount: "7" }])).toEqual({ kind: "tax", tax: "2", securityKey: null });
    expect(reconcileCashGroup(keyless, [{ direction: "out", amount: "3" }])).toEqual({ kind: "deposit", amount: "2" });
  });
});
