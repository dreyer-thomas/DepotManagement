import { describe, expect, it } from "vitest";
import type { TransactionRecord, TransactionType } from "@/modules/ledger";
import type { TransactionField } from "./labels";
import {
  deleteConfirmText,
  duplicateWarning,
  errorPlacement,
  formDataKey,
  FORM_SECTIONS,
  type FormSection,
  initialValues,
  securityKey,
  securityMode,
  type SubmittedValues,
  submitDecision,
  valuesKey,
  visibleFields,
} from "./transaction-form";

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

const apple = { id: "s1", name: "Beispiel AG", isin: "DE0000000001", cryptoSymbol: null, assetType: "STOCK" as const };

function record(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: "t1",
    depotId: "d1",
    type: "BUY",
    date: "2026-10-15",
    sequence: 1,
    quantity: "10",
    price: "123.45",
    amount: "1234.5",
    fee: "4.9",
    tax: "0",
    security: apple,
    ...overrides,
  };
}

describe("initialValues", () => {
  it("prefills a trade with decimal commas and the Security", () => {
    expect(initialValues(record({ quantity: "0.00012345", tax: "-1.5" }))).toEqual({
      type: "BUY",
      security: apple,
      date: "2026-10-15",
      quantity: "0,00012345",
      price: "123,45",
      fee: "4,9",
      tax: "-1,5",
      amount: "",
    });
  });

  it("prefills a DIVIDEND's gross amount and tax", () => {
    expect(initialValues(record({ type: "DIVIDEND", quantity: null, price: null, amount: "50", fee: "0", tax: "12.5" }))).toMatchObject({
      type: "DIVIDEND",
      amount: "50",
      tax: "12,5",
      quantity: "",
      price: "",
    });
  });

  it.each<[TransactionType, Partial<TransactionRecord>, string]>([
    ["FEE", { fee: "4.9", amount: "0", security: null }, "4,9"],
    ["TAX", { tax: "-3.5", amount: "0", fee: "0" }, "-3,5"],
    ["DEPOSIT", { amount: "2000", fee: "0", security: null }, "2000"],
    ["WITHDRAWAL", { amount: "300.25", fee: "0", security: null }, "300,25"],
  ])("puts a %s's value into Betrag", (type, overrides, amount) => {
    const values = initialValues(record({ type, quantity: null, price: null, ...overrides }));
    expect(values).toMatchObject({ type, amount, quantity: "", price: "", fee: "" });
  });
});

describe("deleteConfirmText", () => {
  it("names type, Security, date and Depot", () => {
    expect(deleteConfirmText(record(), "Hauptdepot")).toBe("Kauf „Beispiel AG“ vom 15.10.2026 aus Depot „Hauptdepot“ löschen?");
  });

  it("leaves out a missing Security", () => {
    expect(deleteConfirmText(record({ type: "DEPOSIT", security: null }), "Hauptdepot")).toBe(
      "Einzahlung vom 15.10.2026 aus Depot „Hauptdepot“ löschen?",
    );
  });
});

describe("duplicateWarning", () => {
  it("describes the existing Transaction", () => {
    expect(duplicateWarning({ status: "duplicate", matches: [record()] })).toBe(
      "Mögliche Doppelbuchung: Diese Buchung gibt es bereits (Kauf „Beispiel AG“ vom 15.10.2026, 10 Stück, 1.234,50 €).",
    );
  });

  it("lists every match when ambiguous, and a FEE by its fee", () => {
    const fee = record({ type: "FEE", security: null, quantity: null, price: null, amount: "0", fee: "4.9" });
    expect(duplicateWarning({ status: "ambiguous", matches: [fee, { ...fee, id: "t2" }] })).toBe(
      "Mögliche Doppelbuchung: 2 gleiche Buchungen gibt es bereits (Gebühr vom 15.10.2026, 4,90 €; Gebühr vom 15.10.2026, 4,90 €).",
    );
  });
});

describe("submit keys", () => {
  const values: SubmittedValues = {
    type: "BUY",
    date: "2026-10-15",
    quantity: "10",
    price: "100",
    fee: "",
    tax: "",
    amount: "",
    security: securityKey({ id: "s1" }),
  };

  it("matches the key of the same values submitted as FormData, ignoring hidden fields", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ type: "BUY", date: "2026-10-15", quantity: "10", price: "100", fee: "", tax: "", securityId: "s1" })) {
      data.set(key, value);
    }
    expect(formDataKey(data)).toBe(valuesKey(values));
    expect(valuesKey({ ...values, amount: "5" })).toBe(valuesKey(values));
  });

  it.each<[string, Partial<SubmittedValues>]>([
    ["type", { type: "SELL" }],
    ["date", { date: "2026-10-16" }],
    ["quantity", { quantity: "11" }],
    ["price", { price: "99" }],
    ["fee", { fee: "1" }],
    ["tax", { tax: "1" }],
    ["Security", { security: securityKey({ id: "s2" }) }],
    ["new Security", { security: securityKey({ identifier: "US0378331005", name: "Beispiel AG", assetType: "STOCK" }) }],
  ])("changes with the %s", (_label, change) => {
    expect(valuesKey({ ...values, ...change })).not.toBe(valuesKey(values));
  });

  it("keys a new Security from the FormData fields", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ type: "DIVIDEND", date: "2026-10-15", amount: "5", newSecurity: "1", securityIdentifier: "X", securityName: "N", assetType: "ETF" })) {
      data.set(key, value);
    }
    expect(formDataKey(data)).toBe(
      valuesKey({ ...values, type: "DIVIDEND", quantity: "", price: "", amount: "5", security: securityKey({ identifier: "X", name: "N", assetType: "ETF" }) }),
    );
  });
});

describe("submitDecision", () => {
  const key = valuesKey({ type: "BUY", date: "2026-10-15", quantity: "10", price: "100", fee: "", tax: "", amount: "", security: "id:s1" });
  const changed = valuesKey({ type: "BUY", date: "2026-10-16", quantity: "10", price: "100", fee: "", tax: "", amount: "", security: "id:s1" });
  const otherType = valuesKey({ type: "SELL", date: "2026-10-15", quantity: "10", price: "100", fee: "", tax: "", amount: "", security: "id:s1" });

  it.each<[string, boolean, string | null, string, boolean, string]>([
    ["new, no warning", false, null, key, false, "Buchen"],
    ["edit, no warning", true, null, key, false, "Speichern"],
    ["new, warning for unchanged values", false, key, key, true, "Trotzdem buchen"],
    ["edit, warning for unchanged values", true, key, key, true, "Trotzdem buchen"],
    ["new, a value changed after the warning", false, key, changed, false, "Buchen"],
    ["edit, a value changed after the warning", true, key, changed, false, "Speichern"],
    ["new, the type changed after the warning", false, key, otherType, false, "Buchen"],
  ])("%s", (_label, editing, warnedKey, currentKey, active, label) => {
    expect(submitDecision({ editing, warnedKey, currentKey })).toEqual({
      duplicateActive: active,
      allowDuplicate: active,
      sendTransactionId: editing,
      label,
    });
  });
});
