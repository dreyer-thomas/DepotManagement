import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { classifyGainDifference, saleFees } from "./fee-attribution";
import type { FifoRow } from "./fifo";

const row = (
  type: string,
  date: string,
  sequence: number,
  quantity: string,
  amount: string,
  fee = "0",
  securityId: string | null = "s1",
): FifoRow => ({ securityId, type, date, sequence, quantity, amount, fee });

describe("saleFees", () => {
  it("attributes the sell fee and the consumed share of a partial lot's buy fee", () => {
    const rows = [row("BUY", "2024-01-10", 1, "10", "1000", "2"), row("SELL", "2024-02-01", 1, "2", "220", "1")];
    expect(saleFees(rows, "2024-12-31", NONE)).toEqual(new Map([["2024-02-01|1", "1.4"]]));
  });

  it("attributes the whole buy fee of a fully consumed lot", () => {
    const rows = [row("BUY", "2024-01-10", 1, "5", "500", "3"), row("SELL", "2024-02-01", 1, "5", "600", "2")];
    expect(saleFees(rows, "2024-12-31", NONE).get("2024-02-01|1")).toBe("5");
  });

  it("attributes buy fees across several lots and later sales", () => {
    const rows = [
      row("BUY", "2024-01-10", 1, "10", "1000", "5"),
      row("BUY", "2024-02-10", 1, "5", "600", "2"),
      row("SELL", "2024-03-10", 1, "12", "1560", "3"),
      row("SELL", "2024-04-10", 1, "3", "400", "0"),
    ];
    const fees = saleFees(rows, "2024-12-31", NONE);
    // 3 + 5 (whole first lot) + 2 × 2/5
    expect(fees.get("2024-03-10|1")).toBe("8.8");
    // 2 × 3/5
    expect(fees.get("2024-04-10|1")).toBe("1.2");
  });

  it("keeps buy fees through a split", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2024-03-01", ratioOld: "1", ratioNew: "4" }], isinChanges: [] };
    const rows = [row("BUY", "2024-01-10", 1, "10", "1000", "4"), row("SELL", "2024-04-01", 1, "10", "300", "1")];
    // 10 of 40 split-adjusted units: 4 × 1/4 + 1
    expect(saleFees(rows, "2024-12-31", actions).get("2024-04-01|1")).toBe("2");
  });

  it("keeps buy fees through an ISIN change", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "A", newSecurityId: "B", date: "2024-03-01", oldQuantity: "10", newQuantity: "5" }],
    };
    const rows = [row("BUY", "2024-01-10", 1, "10", "1000", "6", "A"), row("SELL", "2024-04-01", 1, "1", "250", "0.5", "B")];
    // 1 of 5 new units: 6 × 1/5 + 0.5
    expect(saleFees(rows, "2024-12-31", actions).get("2024-04-01|1")).toBe("1.7");
  });

  it("gives a fee-free sale zero fees", () => {
    const rows = [row("BUY", "2024-01-10", 1, "1", "100"), row("SELL", "2024-02-01", 2, "1", "110")];
    expect(saleFees(rows, "2024-12-31", NONE).get("2024-02-01|2")).toBe("0");
  });
});

describe("classifyGainDifference", () => {
  it("treats a fee-only difference as fees", () => {
    expect(classifyGainDifference("18.6", "20", "1.4")).toBe("fees");
  });

  it("treats other differences as a deviation", () => {
    expect(classifyGainDifference("20", "30", "0")).toBe("deviation");
    expect(classifyGainDifference("18.6", "20", "1")).toBe("deviation");
  });

  it("treats a difference within the tolerance as equal", () => {
    expect(classifyGainDifference("20", "20.01", "1.4")).toBe("equal");
    expect(classifyGainDifference("18.59", "20", "1.4")).toBe("fees");
  });
});
