import { describe, expect, it } from "vitest";
import { ExactDecimal } from "./decimal";
import type { FifoRow } from "./fifo";
import { computePositions } from "./positions";
import type { PriceObservation } from "./prices";

type Trade = FifoRow & { id: string; price: string };

let counter = 0;
function trade(type: "BUY" | "SELL", date: string, sequence: number, quantity: string, price: string, fee = "0", securityId = "s1"): Trade {
  const amount = new ExactDecimal(quantity).times(price).toFixed();
  return { id: `t${++counter}`, securityId, type, date, sequence, quantity, price, amount, fee };
}

const observationsOf = (trades: Trade[]): PriceObservation[] =>
  trades.map(({ id, securityId, date, sequence, price }) => ({ id, securityId: securityId!, date, sequence, price }));

const TODAY = "2026-10-25";

describe("computePositions", () => {
  it("values a partially sold Position with the latest Transaction price", () => {
    const trades = [
      trade("BUY", "2026-01-10", 1, "10", "100", "5"),
      trade("BUY", "2026-02-10", 1, "5", "120", "2"),
      trade("SELL", "2026-03-10", 1, "12", "130", "3"),
    ];
    const [position] = computePositions(trades, observationsOf(trades), TODAY);
    expect(position).toMatchObject({
      securityId: "s1",
      quantity: "3",
      costBasis: "361.2",
      averagePrice: "120.4",
      price: "130",
      priceDate: "2026-03-10",
      value: "390",
      gain: "28.8",
    });
    expect(position.gainRatio!.startsWith("0.07973421926910299")).toBe(true);
  });

  it("handles fractional quantities", () => {
    const trades = [trade("BUY", "2026-01-10", 1, "0.00012345", "50000", "0.5")];
    const [position] = computePositions(trades, observationsOf(trades), TODAY);
    expect(position).toMatchObject({ quantity: "0.00012345", costBasis: "6.6725", value: "6.1725", gain: "-0.5" });
  });

  it("drops fully sold Securities, including a same-day buy then sell in reversed input", () => {
    const trades = [trade("SELL", "2026-05-05", 2, "1", "110"), trade("BUY", "2026-05-05", 1, "1", "100")];
    expect(computePositions(trades, observationsOf(trades), TODAY)).toEqual([]);
  });

  it("uses a price from another Depot and ignores future-dated rows", () => {
    const own = [trade("BUY", "2026-10-01", 1, "2", "100")];
    const other = [
      trade("BUY", "2026-10-20", 1, "1", "150"),
      trade("BUY", "2026-11-02", 1, "1", "999"),
      trade("BUY", "2026-10-21", 1, "1", "77", "0", "s2"),
    ];
    const ownFuture = trade("BUY", "2026-10-30", 1, "5", "500");
    const [position] = computePositions([...own, ownFuture], observationsOf([...own, ...other, ownFuture]), TODAY);
    expect(position).toMatchObject({ quantity: "2", costBasis: "200", price: "150", priceDate: "2026-10-20", value: "300", gain: "100", gainRatio: "0.5" });
  });

  it("leaves price fields null without a price on or before today", () => {
    const trades = [trade("BUY", "2026-10-01", 1, "2", "100")];
    const [position] = computePositions(trades, [], TODAY);
    expect(position).toMatchObject({ quantity: "2", costBasis: "200", averagePrice: "100", price: null, priceDate: null, value: null, gain: null, gainRatio: null });
  });

  it("has a null ratio for a zero Cost Basis", () => {
    const trades = [trade("BUY", "2026-10-01", 1, "2", "0")];
    const [position] = computePositions(trades, observationsOf(trades), TODAY);
    expect(position).toMatchObject({ costBasis: "0", averagePrice: "0", value: "0", gain: "0", gainRatio: null });
  });
});
