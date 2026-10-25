import { describe, expect, it } from "vitest";
import { cashEffect, type CashRow } from "./cash";
import { ExactDecimal } from "./decimal";
import { fundingShortfalls } from "./funding";

let nextSequence = 1;
const row = (type: string, date: string, fields: Partial<CashRow> = {}): CashRow => ({
  type,
  date,
  sequence: nextSequence++,
  amount: "0",
  fee: "0",
  tax: "0",
  ...fields,
});

/** Inserts the funding deposits and returns the running balances (in ledger order). */
function fundedBalances(rows: CashRow[]): string[] {
  const funding = new Map(fundingShortfalls(rows).map(({ row: funded, amount }) => [funded, amount]));
  let balance = new ExactDecimal(0);
  const balances: string[] = [];
  for (const current of [...rows].sort((a, b) => (a.date === b.date ? a.sequence - b.sequence : a.date < b.date ? -1 : 1))) {
    const deposit = funding.get(current);
    if (deposit) {
      balance = balance.plus(deposit);
      balances.push(balance.toFixed());
    }
    balance = balance.plus(cashEffect(current));
    balances.push(balance.toFixed());
  }
  return balances;
}

function minPrefix(rows: CashRow[]): InstanceType<typeof ExactDecimal> {
  let balance = new ExactDecimal(0);
  let min = new ExactDecimal(0);
  for (const current of rows) {
    balance = balance.plus(cashEffect(current));
    if (balance.lessThan(min)) min = balance;
  }
  return min;
}

describe("fundingShortfalls", () => {
  it("funds the first buy with amount plus fee", () => {
    const buy = row("BUY", "2024-01-10", { amount: "1000", fee: "5" });
    expect(fundingShortfalls([buy])).toEqual([{ row: buy, amount: "1005" }]);
  });

  it("lets proceeds fund a later buy and deposits only a partial shortfall", () => {
    const rows = [
      row("BUY", "2024-01-10", { amount: "1000", fee: "5" }),
      row("SELL", "2024-02-10", { amount: "213", fee: "5" }), // balance 208
      row("BUY", "2024-03-10", { amount: "200", fee: "2" }), // 6 left, no funding
      row("BUY", "2024-04-10", { amount: "398" }), // shortfall 392
    ];
    expect(fundingShortfalls(rows).map(({ row: funded, amount }) => [funded.date, amount])).toEqual([
      ["2024-01-10", "1005"],
      ["2024-04-10", "392"],
    ]);
  });

  it("never funds positive effects (sell, dividend, TAX refund, deposit)", () => {
    const rows = [
      row("SELL", "2024-01-01", { amount: "100", fee: "1" }),
      row("DIVIDEND", "2024-01-02", { amount: "30", tax: "5" }),
      row("TAX", "2024-01-03", { tax: "-3" }),
      row("DEPOSIT", "2024-01-04", { amount: "10" }),
    ];
    expect(fundingShortfalls(rows)).toEqual([]);
  });

  it("funds a FEE or TAX row larger than the balance", () => {
    const rows = [
      row("DIVIDEND", "2024-01-01", { amount: "3" }),
      row("FEE", "2024-01-02", { fee: "4.9" }),
      row("TAX", "2024-01-03", { tax: "0.25" }),
    ];
    expect(fundingShortfalls(rows).map(({ row: funded, amount }) => [funded.type, amount])).toEqual([
      ["FEE", "1.9"],
      ["TAX", "0.25"],
    ]);
  });

  it("does not fund a delivery BUY preceded by its DEPOSIT", () => {
    const rows = [row("DEPOSIT", "2024-01-01", { amount: "500" }), row("BUY", "2024-01-01", { amount: "500" })];
    expect(fundingShortfalls(rows)).toEqual([]);
  });

  it("walks in (date, sequence) order regardless of input order", () => {
    const sell = row("SELL", "2024-01-01", { amount: "50" });
    const buy = row("BUY", "2024-01-01", { amount: "80" });
    expect(fundingShortfalls([buy, sell])).toEqual([{ row: buy, amount: "30" }]);
  });

  it("keeps every running balance ≥ 0 and deposits exactly −min prefix balance in total", () => {
    const rows = [
      row("BUY", "2024-01-10", { amount: "1000", fee: "5" }),
      row("BUY", "2024-02-15", { amount: "1000" }),
      row("DIVIDEND", "2024-03-20", { amount: "30", tax: "5" }),
      row("SELL", "2024-04-10", { amount: "600", fee: "5", tax: "10" }),
      row("FEE", "2024-04-11", { fee: "1.5" }),
      row("TAX", "2024-04-12", { tax: "-2.5" }),
      row("BUY", "2024-05-05", { amount: "400", fee: "2" }),
      row("BUY", "2024-06-01", { amount: "600" }),
    ];
    const shortfalls = fundingShortfalls(rows);
    expect(fundedBalances(rows).every((balance) => !new ExactDecimal(balance).isNegative())).toBe(true);
    const total = shortfalls.reduce((sum, { amount }) => sum.plus(amount), new ExactDecimal(0));
    expect(total.toFixed()).toBe(minPrefix(rows).negated().toFixed());
    for (const { amount } of shortfalls) expect(new ExactDecimal(amount).greaterThan(0)).toBe(true);
  });
});
