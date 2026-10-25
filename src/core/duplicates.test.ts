import { describe, expect, it } from "vitest";
import { type DuplicateCandidate, matchDuplicates } from "./duplicates";

const buy = (overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  depotId: "d1",
  date: "2026-10-15",
  type: "BUY",
  securityId: "s1",
  quantity: "10",
  amount: "1000",
  fee: "0",
  tax: "0",
  ...overrides,
});

const row = (id: string, overrides: Partial<DuplicateCandidate> = {}) => ({ ...buy(overrides), id });

describe("matchDuplicates", () => {
  it("is unique without rows", () => {
    expect(matchDuplicates(buy(), [])).toEqual({ status: "unique", matches: [] });
  });

  it("finds an exact repeat", () => {
    const existing = row("t1");
    expect(matchDuplicates(buy(), [existing])).toEqual({ status: "duplicate", matches: [existing] });
  });

  it("matches event values within 0.01 only", () => {
    const existing = row("t1", { amount: "150.00" });
    expect(matchDuplicates(buy({ amount: "150.01" }), [existing]).status).toBe("duplicate");
    expect(matchDuplicates(buy({ amount: "149.99" }), [existing]).status).toBe("duplicate");
    expect(matchDuplicates(buy({ amount: "150.02" }), [existing]).status).toBe("unique");
    expect(matchDuplicates(buy({ amount: "150.010000001" }), [existing]).status).toBe("unique");
  });

  it("compares quantities as decimals", () => {
    expect(matchDuplicates(buy({ quantity: "10.00" }), [row("t1")]).status).toBe("duplicate");
  });

  it("is ambiguous for a repeated savings plan", () => {
    const plan = { quantity: "3.412871", amount: "150" };
    const rows = [row("t1", plan), row("t2", plan)];
    expect(matchDuplicates(buy(plan), rows)).toEqual({ status: "ambiguous", matches: rows });
  });

  it.each<[string, Partial<DuplicateCandidate>]>([
    ["date", { date: "2026-10-16" }],
    ["type", { type: "SELL" }],
    ["Security", { securityId: "s2" }],
    ["no Security", { securityId: null }],
    ["quantity", { quantity: "11" }],
    ["no quantity", { quantity: null }],
    ["Depot", { depotId: "d2" }],
  ])("is unique for another %s", (_label, overrides) => {
    expect(matchDuplicates(buy(overrides), [row("t1")]).status).toBe("unique");
  });

  it("matches rows without Security and quantity", () => {
    const deposit = { type: "DEPOSIT", securityId: null, quantity: null, amount: "500" };
    expect(matchDuplicates(buy(deposit), [row("t1", deposit)]).status).toBe("duplicate");
  });

  it("compares a FEE by its fee and a TAX by its tax, not the zero amount", () => {
    const fee = { type: "FEE", securityId: null, quantity: null, amount: "0", fee: "4.9" };
    expect(matchDuplicates(buy({ ...fee, fee: "5.9" }), [row("t1", fee)]).status).toBe("unique");
    expect(matchDuplicates(buy({ ...fee, fee: "4.90" }), [row("t1", fee)]).status).toBe("duplicate");
    const tax = { type: "TAX", securityId: null, quantity: null, amount: "0", tax: "-3.5" };
    expect(matchDuplicates(buy({ ...tax, tax: "3.5" }), [row("t1", tax)]).status).toBe("unique");
    expect(matchDuplicates(buy(tax), [row("t1", tax)]).status).toBe("duplicate");
  });

  it("never matches the candidate's own row", () => {
    expect(matchDuplicates({ ...buy(), id: "t1" }, [row("t1")])).toEqual({ status: "unique", matches: [] });
    expect(matchDuplicates({ ...buy(), id: "t1" }, [row("t1"), row("t2")]).status).toBe("duplicate");
  });
});
