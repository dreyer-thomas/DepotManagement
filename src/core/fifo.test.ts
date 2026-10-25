import { describe, expect, it } from "vitest";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo, type FifoRow } from "./fifo";

const row = (
  type: string,
  date: string,
  sequence: number,
  quantity: string,
  amount: string,
  fee = "0",
  securityId: string | null = "s1",
): FifoRow => ({ securityId, type, date, sequence, quantity, amount, fee });

describe("fifo", () => {
  it("sells across several lots with fees in the Cost Basis", () => {
    const rows = [
      row("BUY", "2026-01-10", 1, "10", "1000", "5"),
      row("BUY", "2026-02-10", 1, "5", "600", "2"),
      row("SELL", "2026-03-10", 1, "12", "1560", "3"),
    ];
    expect(fifo(rows, "2026-10-25", [])).toEqual([
      {
        securityId: "s1",
        lots: [{ date: "2026-02-10", sequence: 1, quantity: "3", costBasis: "361.2" }],
        sales: [{ date: "2026-03-10", sequence: 1, quantity: "12", proceeds: "1557", costBasis: "1245.8", gain: "311.2" }],
      },
    ]);
  });

  it("takes proportional cost from the same lot across partial sells and leaves no residue", () => {
    const rows = [
      row("BUY", "2026-01-10", 1, "3", "10", "0"),
      row("SELL", "2026-01-11", 1, "1", "4"),
      row("SELL", "2026-01-12", 1, "1", "4"),
      row("SELL", "2026-01-13", 1, "1", "4"),
    ];
    const [result] = fifo(rows, "2026-10-25", []);
    expect(result.lots).toEqual([]);
    const total = result.sales.reduce((sum, sale) => sum.plus(sale.costBasis), new ExactDecimal(0));
    expect(canonicalDecimal(total)).toBe("10");
  });

  it("handles fractional quantities exactly", () => {
    const [result] = fifo([row("BUY", "2026-01-10", 1, "0.00012345", "6.1725", "0.5")], "2026-10-25", []);
    expect(result.lots).toEqual([{ date: "2026-01-10", sequence: 1, quantity: "0.00012345", costBasis: "6.6725" }]);
  });

  it("orders a same-day buy before the sell regardless of input order", () => {
    const rows = [row("SELL", "2026-05-05", 2, "1", "110"), row("BUY", "2026-05-05", 1, "1", "100", "1")];
    const [result] = fifo(rows, "2026-10-25", []);
    expect(result.lots).toEqual([]);
    expect(result.sales).toEqual([
      { date: "2026-05-05", sequence: 2, quantity: "1", proceeds: "110", costBasis: "101", gain: "9" },
    ]);
  });

  it("gives units sold beyond the open lots zero cost and never a negative lot", () => {
    const rows = [row("BUY", "2026-01-10", 1, "2", "20"), row("SELL", "2026-01-11", 1, "5", "60", "1")];
    const [result] = fifo(rows, "2026-10-25", []);
    expect(result.lots).toEqual([]);
    expect(result.sales[0]).toMatchObject({ quantity: "5", proceeds: "59", costBasis: "20", gain: "39" });
  });

  it("ignores rows after asOf, other types and rows without a Security", () => {
    const rows = [
      row("BUY", "2026-01-10", 1, "2", "20"),
      row("SELL", "2026-11-01", 1, "2", "30"),
      row("DIVIDEND", "2026-02-01", 1, "0", "5"),
      row("FEE", "2026-02-02", 1, "0", "0", "3", null),
    ];
    expect(fifo(rows, "2026-10-25", [])).toEqual([
      { securityId: "s1", lots: [{ date: "2026-01-10", sequence: 1, quantity: "2", costBasis: "20" }], sales: [] },
    ]);
  });

  it("keeps Securities apart and returns decimal strings, not floats", () => {
    const rows = [
      row("BUY", "2026-01-10", 1, "0.1", "0.1", "0.2", "a"),
      row("BUY", "2026-01-10", 2, "0.3", "0.3", "0", "b"),
    ];
    const result = fifo(rows, "2026-10-25", []);
    expect(result.map((r) => [r.securityId, r.lots[0].costBasis])).toEqual([
      ["a", "0.3"],
      ["b", "0.3"],
    ]);
  });
});

describe("fifo with splits", () => {
  const split = { securityId: "s1", date: "2024-03-01", ratioOld: "1", ratioNew: "4" };

  it("adjusts lots before a split between two buys and realizes a partial sell", () => {
    const rows = [
      row("BUY", "2024-01-02", 1, "10", "1000"),
      row("BUY", "2024-04-01", 1, "20", "600"),
      row("SELL", "2024-05-01", 1, "30", "1050"),
    ];
    expect(fifo(rows, "2024-06-01", [split])).toEqual([
      {
        securityId: "s1",
        lots: [
          { date: "2024-01-02", sequence: 1, quantity: "10", costBasis: "250" },
          { date: "2024-04-01", sequence: 1, quantity: "20", costBasis: "600" },
        ],
        sales: [{ date: "2024-05-01", sequence: 1, quantity: "30", proceeds: "1050", costBasis: "750", gain: "300" }],
      },
    ]);
  });

  it("does not adjust a BUY on the split date and ignores splits after asOf", () => {
    const [sameDay] = fifo([row("BUY", "2024-03-01", 1, "5", "500")], "2024-06-01", [{ ...split, ratioNew: "2" }]);
    expect(sameDay.lots[0].quantity).toBe("5");
    const [before] = fifo([row("BUY", "2024-01-02", 1, "10", "1000")], "2024-02-01", [split]);
    expect(before.lots[0].quantity).toBe("10");
  });
});

describe("fifo with a non-terminating reverse split", () => {
  it("closes every lot when the adjusted total is sold (no residue)", () => {
    const split = { securityId: "s1", date: "2024-03-01", ratioOld: "3", ratioNew: "1" };
    const rows = [
      row("BUY", "2024-01-02", 1, "10", "100"),
      row("BUY", "2024-01-03", 1, "2", "20"),
      row("SELL", "2024-05-01", 1, "4", "150"),
    ];
    const [result] = fifo(rows, "2024-06-01", [split]);
    expect(result.lots).toEqual([]);
    expect(result.sales).toEqual([
      { date: "2024-05-01", sequence: 1, quantity: "4", proceeds: "150", costBasis: "120", gain: "30" },
    ]);
  });
});
