import { describe, expect, it } from "vitest";
import {
  TRANSACTION_TYPE_ORDER,
  transactionErrorField,
  transactionErrorMessage,
  type TransactionErrorReason,
  type TransactionField,
  transactionTypeLabel,
} from "./labels";
import type { TransactionType } from "@/modules/ledger";

describe("transaction labels", () => {
  it("names every type in German, in selection order", () => {
    expect(TRANSACTION_TYPE_ORDER.map(transactionTypeLabel)).toEqual([
      "Kauf",
      "Verkauf",
      "Dividende",
      "Gebühr",
      "Steuer",
      "Einzahlung",
      "Auszahlung",
    ]);
  });

  it("formats the oversell message with the available quantity", () => {
    expect(transactionErrorMessage("sell-exceeds-holding", "10")).toBe("Verkauf übersteigt Bestand (10 Stück).");
    expect(transactionErrorMessage("sell-exceeds-holding", "1234.5")).toBe("Verkauf übersteigt Bestand (1.234,5 Stück).");
    expect(transactionErrorMessage("sell-exceeds-holding", "0")).toBe("Verkauf übersteigt Bestand (0 Stück).");
  });

  it.each<[TransactionErrorReason, TransactionField | undefined]>([
    ["type-invalid", "type"],
    ["date-invalid", "date"],
    ["quantity-invalid", "quantity"],
    ["sell-exceeds-holding", "quantity"],
    ["price-invalid", "price"],
    ["amount-invalid", "price"],
    ["fee-invalid", "fee"],
    ["tax-invalid", "tax"],
    ["security-required", "security"],
    ["security-not-found", "security"],
    ["security-not-allowed", "security"],
    ["isin-invalid", "securityIdentifier"],
    ["crypto-symbol-invalid", "securityIdentifier"],
    ["security-name-invalid", "securityName"],
    ["asset-type-invalid", "assetType"],
    ["depot-not-found", undefined],
    ["unauthorized", undefined],
  ])("%s shows on field %s with a German message", (reason, field) => {
    expect(transactionErrorField(reason)).toBe(field);
    expect(transactionErrorMessage(reason, "1")).toMatch(/\.$/);
  });

  it.each<[TransactionErrorReason, TransactionType, TransactionField, string]>([
    ["amount-invalid", "BUY", "price", "Der Betrag darf nicht negativ sein."],
    ["amount-invalid", "DIVIDEND", "amount", "Bitte einen Betrag größer 0 eingeben."],
    ["amount-invalid", "DEPOSIT", "amount", "Bitte einen Betrag größer 0 eingeben."],
    ["amount-invalid", "WITHDRAWAL", "amount", "Bitte einen Betrag größer 0 eingeben."],
    ["fee-invalid", "FEE", "amount", "Bitte einen Betrag größer 0 eingeben."],
    ["fee-invalid", "BUY", "fee", "Gebühren dürfen nicht negativ sein."],
    ["fee-invalid", "DEPOSIT", "fee", "Gebühren dürfen nicht negativ sein."],
    ["tax-invalid", "TAX", "amount", "Bitte einen Betrag ungleich 0 eingeben."],
    ["tax-invalid", "DIVIDEND", "tax", "Bitte einen gültigen Steuerbetrag eingeben."],
    ["security-required", "DIVIDEND", "security", "Bitte eine Security wählen."],
    ["security-not-allowed", "DEPOSIT", "security", "Ein- und Auszahlungen haben keine Security."],
  ])("%s for %s shows on %s", (reason, type, field, message) => {
    expect(transactionErrorField(reason, type)).toBe(field);
    expect(transactionErrorMessage(reason, undefined, type)).toBe(message);
  });

  it("shows the session message", () => {
    expect(transactionErrorMessage("unauthorized")).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
  });
});
