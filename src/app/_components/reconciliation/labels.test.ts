import { describe, expect, it } from "vitest";
import {
  continueText,
  finishConfirmText,
  inputValue,
  lastReconciledText,
  progressText,
  reconciliationErrorMessage,
  rowName,
  rowValueText,
  statusText,
} from "./labels";

describe("reconciliation labels", () => {
  it("names rows and formats their values", () => {
    expect(rowName({ securityId: null, security: null })).toBe("Cash-Konto");
    expect(rowName({ securityId: "s1", security: { id: "s1", name: "Synthetic Alpha AG", isin: "DE000SYNCA09", cryptoSymbol: null, assetType: "STOCK" } })).toBe(
      "Synthetic Alpha AG",
    );
    expect(rowValueText(false, "12.5")).toBe("12,5 Stück");
    expect(rowValueText(true, "1234.5")).toBe("1.234,50 €");
    expect(inputValue("100.25")).toBe("100,25");
    expect(inputValue(null)).toBe("");
  });

  it("shows the status as text: abgeglichen, signed difference or offen", () => {
    expect(statusText({ securityId: "s1", status: "reconciled", difference: "0" })).toBe("abgeglichen");
    expect(statusText({ securityId: "s1", status: "difference", difference: "2" })).toBe("Differenz +2 Stück");
    expect(statusText({ securityId: null, status: "difference", difference: "-12.34" })).toBe("Differenz -12,34 €");
    expect(statusText({ securityId: null, status: "open", difference: null })).toBe("offen");
  });

  it("phrases progress, finish confirmation and the Depot status lines", () => {
    expect(progressText({ reconciled: 2, total: 5 })).toBe("2 von 5 abgeglichen");
    expect(finishConfirmText(3)).toBe("Noch 3 Zeilen offen. Trotzdem abschließen?");
    expect(finishConfirmText(1)).toBe("Noch 1 Zeile offen. Trotzdem abschließen?");
    expect(lastReconciledText("2026-10-20")).toBe("Zuletzt abgeglichen am 20.10.2026");
    expect(continueText("2026-10-20")).toBe("Abgleich fortsetzen (Stichtag 20.10.2026)");
  });

  it("explains failures, using the correction wording for a holding overrun", () => {
    expect(reconciliationErrorMessage({ reason: "run-open" })).toBe("Für dieses Depot läuft bereits ein Abgleich.");
    expect(reconciliationErrorMessage({ reason: "value-invalid" }, true)).toBe("Bitte einen gültigen Betrag eingeben.");
    expect(reconciliationErrorMessage({ reason: "value-invalid" })).toMatch(/^Bitte einen gültigen Wert eingeben \(Stück/);
    expect(reconciliationErrorMessage({ reason: "date-in-future" })).toBe("Der Stichtag darf nicht in der Zukunft liegen.");
    expect(reconciliationErrorMessage({ reason: "sell-exceeds-holding", available: "2" } as { reason: string })).toBe(
      "Korrektur übersteigt den verfügbaren Bestand (höchstens 2 Stück, spätere Verkäufe eingerechnet).",
    );
  });
});
