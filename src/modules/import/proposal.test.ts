import { describe, expect, it } from "vitest";
import { proposalListSchema, transactionProposalSchema } from "./proposal";

const ISIN = "DE0007164600";
const buy = { type: "BUY", date: "2026-10-08", isin: ISIN, quantity: "12.000000", price: "123.53", amount: "1482.36", fee: "1.50" };

describe("transactionProposalSchema", () => {
  it("accepts a BUY and returns canonical decimals with fee and tax defaults", () => {
    expect(transactionProposalSchema.parse({ ...buy, fee: undefined, name: "  Beispiel AG " })).toEqual({
      type: "BUY",
      date: "2026-10-08",
      isin: ISIN,
      name: "Beispiel AG",
      quantity: "12",
      price: "123.53",
      amount: "1482.36",
      fee: "0",
      tax: "0",
    });
  });

  it("accepts a dividend with signed tax and no quantity or price", () => {
    const dividend = { type: "DIVIDEND", date: "2026-10-01", isin: ISIN, amount: "84.12", tax: "-2.5" };
    expect(transactionProposalSchema.parse(dividend)).toMatchObject({ amount: "84.12", tax: "-2.5", fee: "0" });
  });

  it("accepts standalone FEE and TAX with amount 0, with or without an ISIN", () => {
    expect(transactionProposalSchema.safeParse({ type: "FEE", date: "2026-10-01", isin: ISIN, amount: "0", fee: "4.9" }).success).toBe(true);
    expect(transactionProposalSchema.safeParse({ type: "TAX", date: "2026-10-01", isin: ISIN, amount: "0", tax: "-1" }).success).toBe(true);
    expect(transactionProposalSchema.parse({ type: "FEE", date: "2026-10-01", amount: "0", fee: "4.9" })).not.toHaveProperty("isin");
    expect(transactionProposalSchema.safeParse({ type: "TAX", date: "2026-10-01", amount: "0", tax: "1.5" }).success).toBe(true);
  });

  it.each([
    ["an unknown type", { ...buy, type: "DEPOSIT" }],
    ["an invalid date", { ...buy, date: "2026-02-30" }],
    ["a timestamp", { ...buy, date: "2026-10-08T00:00:00Z" }],
    ["an invalid ISIN check digit", { ...buy, isin: "DE0007164601" }],
    ["a BUY without quantity", { ...buy, quantity: undefined }],
    ["a SELL without price", { ...buy, type: "SELL", price: undefined }],
    ["a zero quantity", { ...buy, quantity: "0" }],
    ["more than 8 quantity decimals", { ...buy, quantity: "1.123456789" }],
    ["a negative price", { ...buy, price: "-1" }],
    ["a negative amount", { ...buy, amount: "-1482.36" }],
    ["a negative fee", { ...buy, fee: "-1.5" }],
    ["a German decimal", { ...buy, amount: "1.482,36" }],
    ["an exponent", { ...buy, amount: "1e3" }],
    ["a number instead of a string", { ...buy, amount: 1482.36 }],
    ["a dividend with quantity", { type: "DIVIDEND", date: "2026-10-01", isin: ISIN, amount: "1", quantity: "1" }],
    ["a dividend with price", { type: "DIVIDEND", date: "2026-10-01", isin: ISIN, amount: "1", price: "1" }],
    ["an unknown field", { ...buy, securityId: "s1" }],
    ["an empty name", { ...buy, name: " " }],
    ["a BUY without ISIN", { ...buy, isin: undefined }],
    ["a dividend without ISIN", { type: "DIVIDEND", date: "2026-10-01", amount: "1" }],
    ["a zero dividend", { type: "DIVIDEND", date: "2026-10-01", isin: ISIN, amount: "0" }],
    ["a FEE with a non-zero amount", { type: "FEE", date: "2026-10-01", amount: "5", fee: "4.9" }],
    ["a FEE with a zero fee", { type: "FEE", date: "2026-10-01", amount: "0", fee: "0" }],
    ["a FEE with tax", { type: "FEE", date: "2026-10-01", amount: "0", fee: "4.9", tax: "1" }],
    ["a TAX with a zero tax", { type: "TAX", date: "2026-10-01", amount: "0", tax: "0" }],
    ["a TAX with a non-zero amount", { type: "TAX", date: "2026-10-01", amount: "5", tax: "1" }],
    ["a TAX with a fee", { type: "TAX", date: "2026-10-01", amount: "0", fee: "1", tax: "1" }],
  ])("rejects %s", (_label, value) => {
    expect(transactionProposalSchema.safeParse(value).success).toBe(false);
  });
});

describe("proposalListSchema", () => {
  it("fails the whole list when one proposal is invalid", () => {
    expect(proposalListSchema.safeParse([buy, { ...buy, amount: "-1" }]).success).toBe(false);
    expect(proposalListSchema.safeParse([buy, buy]).success).toBe(true);
  });
});
