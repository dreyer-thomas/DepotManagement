import { describe, expect, it } from "vitest";
import type { TransactionType } from "@/modules/ledger";
import type { TransactionField } from "./labels";
import { errorPlacement, FORM_SECTIONS, type FormSection, securityMode, visibleFields } from "./transaction-form";

const SECURITY_FIELDS: TransactionField[] = ["security", "securityIdentifier", "securityName", "assetType"];

describe("transaction form layout", () => {
  it.each<[TransactionType, FormSection[], TransactionField[], "required" | "optional" | "none"]>([
    ["BUY", ["security", "date", "quantityPrice", "feeTax"], ["type", ...SECURITY_FIELDS, "date", "quantity", "price", "fee", "tax"], "required"],
    ["SELL", ["security", "date", "quantityPrice", "feeTax"], ["type", ...SECURITY_FIELDS, "date", "quantity", "price", "fee", "tax"], "required"],
    ["DIVIDEND", ["security", "date", "amount", "tax"], ["type", ...SECURITY_FIELDS, "date", "amount", "tax"], "required"],
    ["FEE", ["amount", "security", "date"], ["type", "amount", ...SECURITY_FIELDS, "date"], "optional"],
    ["TAX", ["amount", "security", "date"], ["type", "amount", ...SECURITY_FIELDS, "date"], "optional"],
    ["DEPOSIT", ["amount", "date"], ["type", "amount", "date"], "none"],
    ["WITHDRAWAL", ["amount", "date"], ["type", "amount", "date"], "none"],
  ])("%s shows its sections and fields only", (type, sections, fields, security) => {
    expect(FORM_SECTIONS[type]).toEqual(sections);
    expect([...visibleFields(type)]).toEqual(fields);
    expect(securityMode(type)).toBe(security);
  });
});

describe("errorPlacement", () => {
  it.each<[TransactionType, TransactionField]>([
    ["BUY", "quantity"],
    ["SELL", "price"],
    ["DIVIDEND", "amount"],
    ["DIVIDEND", "security"],
    ["FEE", "amount"],
    ["TAX", "security"],
    ["DEPOSIT", "amount"],
    ["WITHDRAWAL", "date"],
  ])("routes a %s error to its visible field %s", (type, field) => {
    expect(errorPlacement(type, type, field)).toEqual({ kind: "field", field });
  });

  it.each<[TransactionType, TransactionField | undefined]>([
    ["DEPOSIT", "security"],
    ["WITHDRAWAL", "fee"],
    ["DIVIDEND", "quantity"],
    ["FEE", "tax"],
    ["TAX", "price"],
    ["BUY", "amount"],
    ["SELL", undefined],
  ])("shows a %s error on hidden field %s as an Alert", (type, field) => {
    expect(errorPlacement(type, type, field)).toEqual({ kind: "alert" });
  });

  it.each<[TransactionType, TransactionType, TransactionField | undefined]>([
    ["DEPOSIT", "BUY", "quantity"],
    ["BUY", "DEPOSIT", "amount"],
    ["FEE", "TAX", undefined],
  ])("shows nothing on %s after a %s submit failed", (type, submitted, field) => {
    expect(errorPlacement(type, submitted, field)).toEqual({ kind: "none" });
  });
});
