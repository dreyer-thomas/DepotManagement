import { describe, expect, it } from "vitest";
import { firstOversell, sellableAt, sellableQuantity, type TradeRow } from "./holdings";

let sequence = 0;
const row = (type: string, date: string, quantity: string, securityId = "s1"): TradeRow => ({
  securityId,
  type,
  date,
  sequence: ++sequence,
  quantity,
});

describe("sellableQuantity", () => {
  it("is zero without trades", () => {
    expect(sellableQuantity([], "s1", "2026-10-25")).toBe("0");
  });

  it("is the held quantity for a sell dated after every trade", () => {
    const trades = [row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-05", "2.5"), row("BUY", "2026-10-06", "0.00012345")];
    expect(sellableQuantity(trades, "s1", "2026-10-25")).toBe("7.50012345");
  });

  it("includes trades on the same date (appended at the end of the date)", () => {
    expect(sellableQuantity([row("BUY", "2026-10-25", "10")], "s1", "2026-10-25")).toBe("10");
  });

  it("ignores later buys and other Securities", () => {
    const trades = [row("BUY", "2026-10-01", "10", "other"), row("BUY", "2026-10-20", "5")];
    expect(sellableQuantity(trades, "s1", "2026-10-10")).toBe("0");
  });

  it("takes the minimum running quantity from the insertion point onward", () => {
    const trades = [row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-20", "10")];
    expect(sellableQuantity(trades, "s1", "2026-10-10")).toBe("0");
    const partial = [row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-20", "4"), row("BUY", "2026-10-21", "4")];
    expect(sellableQuantity(partial, "s1", "2026-10-10")).toBe("6");
  });

  it("orders by date then sequence regardless of input order", () => {
    const trades: TradeRow[] = [
      { securityId: "s1", type: "SELL", date: "2026-10-02", sequence: 2, quantity: "3" },
      { securityId: "s1", type: "BUY", date: "2026-10-02", sequence: 1, quantity: "5" },
      { securityId: "s1", type: "DIVIDEND", date: "2026-10-03", sequence: 1, quantity: null },
    ];
    expect(sellableQuantity(trades, "s1", "2026-10-02")).toBe("2");
  });
});

describe("sellableAt", () => {
  const at = (date: string, sequence: number) => ({ date, sequence });
  const trades: TradeRow[] = [
    { securityId: "s1", type: "BUY", date: "2026-10-01", sequence: 1, quantity: "10" },
    { securityId: "s1", type: "SELL", date: "2026-10-01", sequence: 3, quantity: "2" },
    { securityId: "s1", type: "SELL", date: "2026-10-20", sequence: 1, quantity: "5" },
    { securityId: "s2", type: "BUY", date: "2026-09-01", sequence: 1, quantity: "100" },
  ];

  it("counts rows before the position as held and later rows as constraints", () => {
    expect(sellableAt(trades, "s1", at("2026-10-01", 2))).toBe("3");
    expect(sellableAt(trades, "s1", at("2026-10-25", 1))).toBe("3");
  });

  it("treats a row at the position itself as later", () => {
    expect(sellableAt(trades, "s1", at("2026-10-01", 1))).toBe("0");
  });

  it("is zero for an unknown Security and never negative", () => {
    expect(sellableAt(trades, "s3", at("2026-10-25", 1))).toBe("0");
    expect(sellableAt([{ securityId: "s1", type: "SELL", date: "2026-10-01", sequence: 1, quantity: "1" }], "s1", at("2026-10-02", 1))).toBe("0");
  });
});

describe("firstOversell", () => {
  it("is null while the held quantity never goes negative", () => {
    expect(firstOversell([], "s1")).toBeNull();
    expect(firstOversell([row("BUY", "2026-10-01", "10"), row("SELL", "2026-10-02", "10")], "s1")).toBeNull();
  });

  it("finds the first SELL in ledger order that oversells", () => {
    const early: TradeRow = { securityId: "s1", type: "SELL", date: "2026-10-05", sequence: 1, quantity: "6" };
    const later: TradeRow = { securityId: "s1", type: "SELL", date: "2026-10-20", sequence: 1, quantity: "6" };
    const buy: TradeRow = { securityId: "s1", type: "BUY", date: "2026-10-01", sequence: 1, quantity: "10" };
    expect(firstOversell([later, early, buy], "s1")).toBe(later);
    expect(firstOversell([later, buy], "s2")).toBeNull();
    expect(firstOversell([early], "s1")).toBe(early);
  });
});
