import { describe, expect, it } from "vitest";
import { sellableQuantity, type TradeRow } from "./holdings";

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
