import { describe, expect, it } from "vitest";
import { type CorporateActions, type IsinChange, NO_CORPORATE_ACTIONS as NONE, type Split } from "./corporate-actions";
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
    expect(isFlat([], TODAY, NONE)).toBe(true);
    expect(canArchive([], TODAY, NONE)).toBe(true);
  });

  it("allows a flat Depot", () => {
    const rows = [deposit("1000"), buy("s1", "10", "1000"), sell("s1", "10", "1000"), withdrawal("1000", "2026-01-04")];
    expect(isFlat(rows, TODAY, NONE)).toBe(true);
    expect(canArchive(rows, TODAY, NONE)).toBe(true);
  });

  it("blocks an open Position even with zero cash", () => {
    const rows = [deposit("1000"), buy("s1", "10", "1000")];
    expect(isFlat(rows, TODAY, NONE)).toBe(false);
    expect(canArchive(rows, TODAY, NONE)).toBe(false);
  });

  it("blocks cash left over", () => {
    expect(canArchive([deposit("0.01")], TODAY, NONE)).toBe(false);
  });

  it("blocks half a cent of cash, which rounds to 0,01 € / -0,01 €", () => {
    expect(canArchive([deposit("0.005")], TODAY, NONE)).toBe(false);
    expect(canArchive([withdrawal("0.005")], TODAY, NONE)).toBe(false);
  });

  it("allows a sub-cent residual from unrounded BUY/SELL amounts", () => {
    const rows = [
      deposit("200"),
      buy("s1", "3.412871", "149.99568045"),
      sell("s1", "3.412871", "149.99568045"),
      withdrawal("199.9957", "2026-01-04"),
    ];
    expect(isFlat(rows, TODAY, NONE)).toBe(true);
    expect(canArchive(rows, TODAY, NONE)).toBe(true);
    expect(canArchive([deposit("1"), withdrawal("1.0043")], TODAY, NONE)).toBe(true);
  });

  it("blocks a sub-unit quantity left over (quantities are exact)", () => {
    const rows = [buy("s1", "1", "0"), sell("s1", "0.99999999", "0")];
    expect(canArchive(rows, TODAY, NONE)).toBe(false);
  });

  it("compares exactly, without floats", () => {
    const rows = [deposit("0.1"), deposit("0.2"), withdrawal("0.3"), buy("s1", "0.1", "0"), buy("s1", "0.2", "0"), sell("s1", "0.3", "0")];
    expect(canArchive(rows, TODAY, NONE)).toBe(true);
  });

  it("blocks a future-dated buy on a Depot flat today", () => {
    const rows = [deposit("1000"), withdrawal("1000"), deposit("100", "2099-01-01"), buy("s1", "1", "100", "2099-01-02")];
    expect(isFlat(rows, TODAY, NONE)).toBe(true);
    expect(canArchive(rows, TODAY, NONE)).toBe(false);
  });

  it("blocks a Depot closed only by a future sell", () => {
    const rows = [buy("s1", "1", "0"), sell("s1", "1", "0", "2099-01-01")];
    expect(isFlat(rows, "2099-01-01", NONE)).toBe(true);
    expect(canArchive(rows, TODAY, NONE)).toBe(false);
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
    expect(heldSecurities(ledger, TODAY, NONE)).toEqual(["s1"]);
  });

  it("evaluates each Depot on its own", () => {
    const ledger = {
      depots: [
        { id: "A", archived: false },
        { id: "B", archived: false },
      ],
      trades: [trade("A", "BUY", "s1", "5"), trade("B", "BUY", "s1", "5"), trade("B", "SELL", "s1", "5")],
    };
    expect(heldSecurities(ledger, TODAY, NONE)).toEqual(["s1"]);
  });

  it("never lets a negative net in one Depot cancel a holding in another, and sorts the ids", () => {
    const ledger = {
      depots: [
        { id: "A", archived: false },
        { id: "B", archived: false },
      ],
      trades: [trade("A", "BUY", "s9", "1"), trade("A", "BUY", "s1", "1"), trade("B", "SELL", "s1", "3"), trade("A", "BUY", "s1", "1")],
    };
    expect(heldSecurities(ledger, TODAY, NONE)).toEqual(["s1", "s9"]);
  });
});

describe("archive and held with splits", () => {
  const split = { securityId: "s1", date: "2024-03-01", ratioOld: "1", ratioNew: "2" };

  it("treats BUY 10, split 1:2, SELL 20 as flat and not held", () => {
    const rows = [buy("s1", "10", "100", "2024-01-02"), sell("s1", "20", "100", "2024-05-01")];
    expect(isFlat(rows, TODAY, splitsOnly(split))).toBe(true);
    expect(canArchive(rows, TODAY, splitsOnly(split))).toBe(true);
    expect(isFlat(rows, TODAY, NONE)).toBe(false);
    const ledger = {
      depots: [{ id: "A", archived: false }],
      trades: rows.map((r) => ({ ...r, depotId: "A" })),
    };
    expect(heldSecurities(ledger, TODAY, splitsOnly(split))).toEqual([]);
  });
});

describe("archive with a non-terminating reverse split", () => {
  it("is flat after selling 10/3 + 2/3 = 4 units", () => {
    const split = { securityId: "s1", date: "2024-03-01", ratioOld: "3", ratioNew: "1" };
    const rows = [
      buy("s1", "10", "100", "2024-01-02"),
      buy("s1", "2", "20", "2024-01-03"),
      sell("s1", "4", "120", "2024-05-01"),
    ];
    expect(isFlat(rows, TODAY, splitsOnly(split))).toBe(true);
  });
});

function splitsOnly(...splits: Split[]): CorporateActions {
  return { splits, isinChanges: [] };
}

describe("archive and held with ISIN changes", () => {
  const actions: CorporateActions = {
    splits: [],
    isinChanges: [{ oldSecurityId: "s1", newSecurityId: "s2", date: "2024-03-01", oldQuantity: "1", newQuantity: "1" } satisfies IsinChange],
  };

  it("treats BUY A 10, change 1:1, SELL B 10 as flat; neither is held", () => {
    const rows = [buy("s1", "10", "100", "2024-01-02"), sell("s2", "10", "100", "2024-05-01")];
    expect(isFlat(rows, TODAY, actions)).toBe(true);
    expect(isFlat(rows, TODAY, NONE)).toBe(false);
    const ledger = { depots: [{ id: "A", archived: false }], trades: rows.map((r) => ({ ...r, depotId: "A" })) };
    expect(heldSecurities(ledger, TODAY, actions)).toEqual([]);
    expect(heldSecurities(ledger, "2024-04-01", actions)).toEqual(["s2"]);
  });
});
