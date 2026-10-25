import { describe, expect, it } from "vitest";
import { compareLedgerOrder } from "./ledger-order";

describe("compareLedgerOrder", () => {
  it("orders by date, then sequence", () => {
    const rows = [
      { date: "2026-10-02", sequence: 1 },
      { date: "2026-10-01", sequence: 2 },
      { date: "2026-10-01", sequence: 1 },
    ];
    expect([...rows].sort(compareLedgerOrder)).toEqual([
      { date: "2026-10-01", sequence: 1 },
      { date: "2026-10-01", sequence: 2 },
      { date: "2026-10-02", sequence: 1 },
    ]);
  });

  it("is zero for equal keys", () => {
    expect(compareLedgerOrder({ date: "2026-10-01", sequence: 3 }, { date: "2026-10-01", sequence: 3 })).toBe(0);
  });
});
