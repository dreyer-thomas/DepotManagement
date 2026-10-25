import { describe, expect, it } from "vitest";
import { type ArchiveRow, canArchive, heldSecurities, isFlat } from "./archive";

const TODAY = "2026-10-25";

let sequence = 0;
function row(type: string, date: string, fields: Partial<ArchiveRow> = {}): ArchiveRow {
  sequence += 1;
  return { type, date, sequence, securityId: null, quantity: null, amount: "0", fee: "0", tax: "0", ...fields };
}
const deposit = (amount: string, date = "2026-01-01") => row("DEPOSIT", date, { amount });
const withdrawal = (amount: string, date = "2026-01-01") => row("WITHDRAWAL", date, { amount });
const buy = (securityId: string, quantity: string, amount: string, date = "2026-01-02") =>
  row("BUY", date, { securityId, quantity, amount });
const sell = (securityId: string, quantity: string, amount: string, date = "2026-01-03") =>
  row("SELL", date, { securityId, quantity, amount });

describe("isFlat / canArchive", () => {
  it("allows an empty Depot", () => {
    expect(isFlat([], TODAY)).toBe(true);
    expect(canArchive([], TODAY)).toBe(true);
  });

  it("allows a flat Depot", () => {
    const rows = [deposit("1000"), buy("s1", "10", "1000"), sell("s1", "10", "1000"), withdrawal("1000", "2026-01-04")];
    expect(isFlat(rows, TODAY)).toBe(true);
    expect(canArchive(rows, TODAY)).toBe(true);
  });

  it("blocks an open Position even with zero cash", () => {
    const rows = [deposit("1000"), buy("s1", "10", "1000")];
    expect(isFlat(rows, TODAY)).toBe(false);
    expect(canArchive(rows, TODAY)).toBe(false);
  });

  it("blocks cash left over", () => {
    expect(canArchive([deposit("0.01")], TODAY)).toBe(false);
  });

  it("blocks half a cent of cash, which rounds to 0,01 € / -0,01 €", () => {
    expect(canArchive([deposit("0.005")], TODAY)).toBe(false);
    expect(canArchive([withdrawal("0.005")], TODAY)).toBe(false);
  });

  it("allows a sub-cent residual from unrounded BUY/SELL amounts", () => {
    const rows = [
      deposit("200"),
      buy("s1", "3.412871", "149.99568045"),
      sell("s1", "3.412871", "149.99568045"),
      withdrawal("199.9957", "2026-01-04"),
    ];
    expect(isFlat(rows, TODAY)).toBe(true);
    expect(canArchive(rows, TODAY)).toBe(true);
    expect(canArchive([deposit("1"), withdrawal("1.0043")], TODAY)).toBe(true);
  });

  it("blocks a sub-unit quantity left over (quantities are exact)", () => {
    const rows = [buy("s1", "1", "0"), sell("s1", "0.99999999", "0")];
    expect(canArchive(rows, TODAY)).toBe(false);
  });

  it("compares exactly, without floats", () => {
    const rows = [deposit("0.1"), deposit("0.2"), withdrawal("0.3"), buy("s1", "0.1", "0"), buy("s1", "0.2", "0"), sell("s1", "0.3", "0")];
    expect(canArchive(rows, TODAY)).toBe(true);
  });

  it("blocks a future-dated buy on a Depot flat today", () => {
    const rows = [deposit("1000"), withdrawal("1000"), deposit("100", "2099-01-01"), buy("s1", "1", "100", "2099-01-02")];
    expect(isFlat(rows, TODAY)).toBe(true);
    expect(canArchive(rows, TODAY)).toBe(false);
  });

  it("blocks a Depot closed only by a future sell", () => {
    const rows = [buy("s1", "1", "0"), sell("s1", "1", "0", "2099-01-01")];
    expect(isFlat(rows, "2099-01-01")).toBe(true);
    expect(canArchive(rows, TODAY)).toBe(false);
  });
});

describe("heldSecurities", () => {
  const trade = (depotId: string, type: string, securityId: string, quantity: string, date = "2026-01-01") => ({
    depotId,
    type,
    securityId,
    quantity,
    date,
  });

  it("counts only open Positions as of today in non-archived Depots", () => {
    const ledger = {
      depots: [
        { id: "A", archived: false },
        { id: "B", archived: true },
      ],
      trades: [
        trade("A", "BUY", "s1", "5"),
        trade("B", "BUY", "s2", "5"),
        trade("A", "BUY", "s3", "2"),
        trade("A", "SELL", "s3", "2", "2026-02-01"),
        trade("A", "BUY", "s4", "1", "2099-01-01"),
        trade("X", "BUY", "s5", "1"),
      ],
    };
    expect(heldSecurities(ledger, TODAY)).toEqual(["s1"]);
  });

  it("evaluates each Depot on its own", () => {
    const ledger = {
      depots: [
        { id: "A", archived: false },
        { id: "B", archived: false },
      ],
      trades: [trade("A", "BUY", "s1", "5"), trade("B", "BUY", "s1", "5"), trade("B", "SELL", "s1", "5")],
    };
    expect(heldSecurities(ledger, TODAY)).toEqual(["s1"]);
  });

  it("never lets a negative net in one Depot cancel a holding in another, and sorts the ids", () => {
    const ledger = {
      depots: [
        { id: "A", archived: false },
        { id: "B", archived: false },
      ],
      trades: [trade("A", "BUY", "s9", "1"), trade("A", "BUY", "s1", "1"), trade("B", "SELL", "s1", "3"), trade("A", "BUY", "s1", "1")],
    };
    expect(heldSecurities(ledger, TODAY)).toEqual(["s1", "s9"]);
  });
});
