import { describe, expect, it } from "vitest";
import type { TransactionType } from "@/modules/ledger";
import { cashPreview, type CashPreviewInputs } from "./cash-preview";

const inputs = (fields: Partial<CashPreviewInputs>): CashPreviewInputs => ({
  quantity: "",
  price: "",
  fee: "",
  tax: "",
  amount: "",
  ...fields,
});

describe("cashPreview", () => {
  it("shows a BUY's effect from Stück × Kurs plus costs", () => {
    expect(cashPreview("BUY", inputs({ quantity: "10", price: "100", fee: "4,90" }))).toBe("-1.004,90 €");
    expect(cashPreview("BUY", inputs({ quantity: "", price: "100", fee: "4,90" }))).toBe("–");
  });

  it.each<[TransactionType, Partial<CashPreviewInputs>, string]>([
    ["SELL", { quantity: "12", price: "130", fee: "3", tax: "10" }, "+1.547,00 €"],
    ["DIVIDEND", { amount: "50", tax: "12,50" }, "+37,50 €"],
    ["DIVIDEND", { amount: "50", tax: "-2" }, "+52,00 €"],
    ["DIVIDEND", { amount: "50" }, "+50,00 €"],
    ["FEE", { amount: "4,90" }, "-4,90 €"],
    ["TAX", { amount: "7" }, "-7,00 €"],
    ["TAX", { amount: "-3,5" }, "+3,50 €"],
    ["DEPOSIT", { amount: "2.000" }, "+2.000,00 €"],
    ["WITHDRAWAL", { amount: "300" }, "-300,00 €"],
    ["DEPOSIT", { amount: "0" }, "0,00 €"],
  ])("%s %j → %s", (type, fields, expected) => {
    expect(cashPreview(type, inputs(fields))).toBe(expected);
  });

  it.each<[TransactionType, Partial<CashPreviewInputs>]>([
    ["SELL", { quantity: "1", price: "" }],
    ["BUY", { quantity: "1", price: "1", fee: "x" }],
    ["DIVIDEND", { tax: "1" }],
    ["DIVIDEND", { amount: "5", tax: "1,2,3" }],
    ["FEE", { fee: "4" }],
    ["TAX", { amount: "abc" }],
    ["DEPOSIT", {}],
    ["WITHDRAWAL", { amount: "1,2,3" }],
  ])("shows – for %s %j", (type, fields) => {
    expect(cashPreview(type, inputs(fields))).toBe("–");
  });
});
