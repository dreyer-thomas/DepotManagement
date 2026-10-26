import { describe, expect, it } from "vitest";
import { NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { type ReconciliationLedgerRow, reconciliationRows, reconciliationStatus } from "./reconciliation";

let sequence = 0;
function row(type: string, date: string, fields: Partial<ReconciliationLedgerRow> = {}): ReconciliationLedgerRow {
  return {
    securityId: null,
    type,
    date,
    sequence: ++sequence,
    quantity: null,
    price: null,
    amount: "0",
    fee: "0",
    tax: "0",
    ...fields,
  };
}

const names = new Map([
  ["a", "Zeta AG"],
  ["b", "Ärzte SE"],
  ["c", "Beta Corp"],
]);

describe("reconciliationStatus", () => {
  it("Position: exact match, difference or open; a check reconciles", () => {
    expect(reconciliationStatus(false, "5", "5", false)).toEqual({ status: "reconciled", difference: "0" });
    expect(reconciliationStatus(false, "5", "7", false)).toEqual({ status: "difference", difference: "2" });
    expect(reconciliationStatus(false, "5", "5.00000001", false)).toEqual({ status: "difference", difference: "0.00000001" });
    expect(reconciliationStatus(false, "5", null, false)).toEqual({ status: "open", difference: null });
    expect(reconciliationStatus(false, "5", null, true)).toEqual({ status: "reconciled", difference: null });
    expect(reconciliationStatus(false, "5", "7", true)).toEqual({ status: "reconciled", difference: "2" });
  });

  it("Cash: matches below half a cent", () => {
    expect(reconciliationStatus(true, "100.004", "100", false).status).toBe("reconciled");
    expect(reconciliationStatus(true, "100.005", "100", false)).toEqual({ status: "difference", difference: "-0.005" });
    expect(reconciliationStatus(true, "100", "112.34", false)).toEqual({ status: "difference", difference: "12.34" });
  });
});

describe("reconciliationRows", () => {
  const ledger = [
    row("DEPOSIT", "2026-01-01", { amount: "1000" }),
    row("BUY", "2026-01-02", { securityId: "a", quantity: "5", price: "10", amount: "50" }),
    row("BUY", "2026-01-02", { securityId: "b", quantity: "2", price: "10", amount: "20" }),
    row("BUY", "2026-01-03", { securityId: "c", quantity: "1", price: "10", amount: "10" }),
    row("SELL", "2026-01-04", { securityId: "c", quantity: "1", price: "10", amount: "10" }),
    row("BUY", "2026-03-01", { securityId: "c", quantity: "4", price: "10", amount: "40" }),
  ];

  it("lists the Positions held on the statement date by name (de-DE), then the Cash Account", () => {
    const { rows, progress } = reconciliationRows(ledger, NONE, "2026-02-01", [], names);
    expect(rows.map((r) => [r.securityId, r.appValue, r.status])).toEqual([
      ["b", "2", "open"],
      ["a", "5", "open"],
      [null, "930", "open"],
    ]);
    expect(progress).toEqual({ reconciled: 0, total: 3 });
  });

  it("merges saved entries; a saved Security no longer held stays with app quantity 0", () => {
    const saved = [
      { securityId: "a", statementValue: "7", checked: false },
      { securityId: "c", statementValue: "0", checked: false },
      { securityId: null, statementValue: "930.004", checked: false },
      { securityId: "b", statementValue: null, checked: true },
    ];
    const { rows, progress } = reconciliationRows(ledger, NONE, "2026-02-01", saved, names);
    expect(rows).toEqual([
      { securityId: "b", appValue: "2", statementValue: null, checked: true, status: "reconciled", difference: null, averagePrice: "10" },
      { securityId: "c", appValue: "0", statementValue: "0", checked: false, status: "reconciled", difference: "0", averagePrice: null },
      { securityId: "a", appValue: "5", statementValue: "7", checked: false, status: "difference", difference: "2", averagePrice: "10" },
      {
        securityId: null,
        appValue: "930",
        statementValue: "930.004",
        checked: false,
        status: "reconciled",
        difference: "0.004",
        averagePrice: null,
      },
    ]);
    expect(progress).toEqual({ reconciled: 3, total: 4 });
  });

  it("held position corrected to 0: the saved row stays and matches", () => {
    const corrected = [...ledger, row("ADJUSTMENT", "2026-02-01", { securityId: "a", quantity: "-5" })];
    const saved = [{ securityId: "a", statementValue: "0", checked: false }];
    const { rows } = reconciliationRows(corrected, NONE, "2026-02-01", saved, names);
    expect(rows.find((r) => r.securityId === "a")).toMatchObject({ appValue: "0", status: "reconciled" });
  });
});
