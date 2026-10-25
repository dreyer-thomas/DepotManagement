import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS } from "./corporate-actions";
import { clampRoundingOversells } from "./rounding";

type Row = { securityId: string | null; type: string; date: string; sequence: number; quantity: string | null };

let nextSequence = 1;
const row = (type: string, date: string, quantity: string, securityId: string | null = "A"): Row => ({
  type,
  date,
  sequence: nextSequence++,
  quantity,
  securityId,
});

/** The adjusted quantity of each row (unchanged rows keep theirs). */
function quantities(rows: Row[], actions: CorporateActions = NO_CORPORATE_ACTIONS): (string | null)[] {
  const clamped = clampRoundingOversells(rows, actions);
  return rows.map((current) => clamped.get(current) ?? current.quantity);
}

describe("clampRoundingOversells", () => {
  it("clamps a rounding oversell and subtracts the shortfall from the next BUY", () => {
    const rows = [
      row("BUY", "2024-05-02", "1"),
      row("SELL", "2024-06-03", "1.0008"),
      row("BUY", "2024-07-01", "0.0016"),
      row("SELL", "2024-07-02", "0.0008"),
    ];
    const clamped = clampRoundingOversells(rows, NO_CORPORATE_ACTIONS);
    expect([...clamped.entries()].map(([current, quantity]) => [current.sequence, quantity])).toEqual([
      [rows[1].sequence, "1"],
      [rows[2].sequence, "0.0008"],
    ]);
  });

  it("leaves an oversell above the tolerance untouched", () => {
    expect(quantities([row("BUY", "2024-01-01", "1"), row("SELL", "2024-02-01", "1.002")])).toEqual(["1", "1.002"]);
  });

  it("clamps at exactly the tolerance", () => {
    expect(quantities([row("BUY", "2024-01-01", "1"), row("SELL", "2024-02-01", "1.001")])).toEqual(["1", "1"]);
  });

  it("never clamps without a holding", () => {
    expect(quantities([row("SELL", "2024-02-01", "0.0005")])).toEqual(["0.0005"]);
  });

  it("keeps a BUY not greater than the carry and lets the carry move on", () => {
    const rows = [
      row("BUY", "2024-01-01", "1"),
      row("SELL", "2024-02-01", "1.0008"),
      row("BUY", "2024-03-01", "0.0005"),
      row("BUY", "2024-04-01", "1"),
    ];
    expect(quantities(rows)).toEqual(["1", "1", "0.0005", "0.9992"]);
  });

  it("scales the carry by a later split", () => {
    const rows = [row("BUY", "2024-01-01", "1"), row("SELL", "2024-02-01", "1.0008"), row("BUY", "2024-04-01", "3")];
    const actions: CorporateActions = { splits: [{ securityId: "A", date: "2024-03-01", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    expect(quantities(rows, actions)).toEqual(["1", "1", "2.9984"]);
  });

  it("drops a carry that a split makes unrepresentable", () => {
    const rows = [
      row("BUY", "2024-01-01", "1"),
      row("SELL", "2024-02-01", "1.00000001"),
      row("BUY", "2024-04-01", "3"),
    ];
    const actions: CorporateActions = { splits: [{ securityId: "A", date: "2024-03-01", ratioOld: "2", ratioNew: "1" }], isinChanges: [] };
    expect(quantities(rows, actions)).toEqual(["1", "1", "3"]);
  });

  it("moves the carry to the new Security of an ISIN change", () => {
    const rows = [
      row("BUY", "2024-01-01", "1"),
      row("SELL", "2024-02-01", "1.0008"),
      row("BUY", "2024-04-01", "1", "B"),
    ];
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "A", newSecurityId: "B", date: "2024-03-01", oldQuantity: "1", newQuantity: "2" }],
    };
    expect(quantities(rows, actions)).toEqual(["1", "1", "0.9984"]);
  });

  it("carries per Security independently", () => {
    const rows = [
      row("BUY", "2024-01-01", "1", "A"),
      row("BUY", "2024-01-01", "2", "B"),
      row("SELL", "2024-02-01", "1.0008", "A"),
      row("BUY", "2024-03-01", "1", "B"),
      row("BUY", "2024-04-01", "1", "A"),
    ];
    expect(quantities(rows)).toEqual(["1", "2", "1", "1", "0.9992"]);
  });

  it("clamps against the held quantity after earlier sells and a split", () => {
    const rows = [row("BUY", "2024-01-01", "1"), row("SELL", "2024-01-05", "0.5"), row("SELL", "2024-04-01", "1.0005")];
    const actions: CorporateActions = { splits: [{ securityId: "A", date: "2024-03-01", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    expect(quantities(rows, actions)).toEqual(["1", "0.5", "1"]);
  });
});
