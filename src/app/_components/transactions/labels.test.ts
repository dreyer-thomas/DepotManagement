import { describe, expect, it } from "vitest";
import {
  ASSET_TYPE_LABELS,
  failureDetail,
  NEW_SECURITY_ASSET_TYPES,
  TRANSACTION_TYPE_ORDER,
  transactionErrorField,
  transactionErrorMessage,
  type TransactionErrorReason,
  type TransactionField,
  transactionTypeLabel,
} from "./labels";
import type { TransactionType } from "@/modules/ledger";

describe("transaction labels", () => {
  it("offers Fonds as an asset type for a new Security, in selection order", () => {
    expect(NEW_SECURITY_ASSET_TYPES.map((type) => ASSET_TYPE_LABELS[type])).toEqual(["Aktie", "ETF", "Fonds", "Zertifikat", "Krypto"]);
  });

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

  it("explains a write to an archived Depot", () => {
    expect(transactionErrorMessage("depot-archived")).toBe("Depot ist archiviert. Bitte zuerst reaktivieren.");
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
    ["depot-archived", undefined],
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

  it("formats the later-sell message with the SELL's date, and the unknown-Transaction message", () => {
    expect(transactionErrorMessage("later-sell-exceeds-holding", "2026-10-20")).toBe(
      "Nicht möglich: Der Verkauf am 20.10.2026 würde den Bestand übersteigen.",
    );
    expect(transactionErrorField("later-sell-exceeds-holding")).toBeUndefined();
    expect(transactionErrorMessage("transaction-not-found")).toBe("Buchung nicht gefunden.");
    expect(transactionErrorField("transaction-not-found")).toBeUndefined();
  });

  it("picks the failure detail", () => {
    expect(failureDetail({ ok: false, reason: "sell-exceeds-holding", available: "10" })).toBe("10");
    expect(failureDetail({ ok: false, reason: "later-sell-exceeds-holding", date: "2026-10-20" })).toBe("2026-10-20");
    expect(failureDetail({ ok: false, reason: "date-invalid" })).toBeUndefined();
  });

  it("shows the session message", () => {
    expect(transactionErrorMessage("unauthorized")).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
  });
});
