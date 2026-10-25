import { describe, expect, it } from "vitest";
import {
  transactionErrorField,
  transactionErrorMessage,
  type TransactionErrorReason,
  type TransactionField,
  transactionTypeLabel,
} from "./labels";

describe("transaction labels", () => {
  it("names the trade types in German", () => {
    expect(transactionTypeLabel("BUY")).toBe("Kauf");
    expect(transactionTypeLabel("SELL")).toBe("Verkauf");
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

  it("shows the session message", () => {
    expect(transactionErrorMessage("unauthorized")).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
  });
});
