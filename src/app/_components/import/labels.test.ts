import { describe, expect, it } from "vitest";
import {
  batchSummary,
  bookButtonLabel,
  bookedMessage,
  discardErrorMessage,
  editErrorMessage,
  fileCountLabel,
  formatMegabytes,
  ITEM_STATUS_LABELS,
  ledgerMatchText,
  ledgerRejectedMessage,
  proposalNotes,
  reviewErrorMessage,
  reviewSummary,
  uploadErrorMessage,
} from "./labels";

describe("import labels", () => {
  it("summarises a batch", () => {
    expect(batchSummary({ fileCount: 3, parsedCount: 1, failedCount: 2 })).toBe("3 Dateien · 1 erkannt · 2 fehlgeschlagen");
    expect(batchSummary({ fileCount: 2, parsedCount: 1, failedCount: 0 })).toBe("2 Dateien · 1 erkannt · 1 ohne Buchung · 0 fehlgeschlagen");
    expect(fileCountLabel(0)).toBe("0 Dateien");
  });

  it("has a German message for every failure", () => {
    expect(uploadErrorMessage("depot-archived")).toBe("Depot ist archiviert. Bitte zuerst reaktivieren.");
    expect(uploadErrorMessage("files-missing")).toBe("Bitte mindestens eine PDF-Datei auswählen.");
    expect(discardErrorMessage("not-found")).toBe("Import nicht gefunden.");
  });

  it("formats megabytes in German", () => {
    expect(formatMegabytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(formatMegabytes(120 * 1024)).toBe("0,1 MB");
    expect(formatMegabytes(30 * 1024)).toBe("< 0,1 MB");
  });

  it("summarises a review, leaving out zero counts except erkannt", () => {
    expect(reviewSummary(14, { PARSED: 11, AMBIGUOUS: 1, DUPLICATE: 1, NO_BOOKING: 0, FAILED: 1 }, 1)).toBe(
      "14 Dateien: 11 erkannt, 1 mehrdeutig, 1 Duplikat, 1 fehlgeschlagen · 1 Entscheidung offen",
    );
    expect(reviewSummary(3, { PARSED: 0, AMBIGUOUS: 0, DUPLICATE: 2, NO_BOOKING: 0, FAILED: 1 }, 0)).toBe("3 Dateien: 0 erkannt, 2 Duplikate, 1 fehlgeschlagen");
    expect(reviewSummary(2, { PARSED: 0, AMBIGUOUS: 2, DUPLICATE: 0, NO_BOOKING: 0, FAILED: 0 }, 2)).toBe("2 Dateien: 0 erkannt, 2 mehrdeutig · 2 Entscheidungen offen");
    expect(ITEM_STATUS_LABELS).toEqual({
      PARSED: "erkannt",
      AMBIGUOUS: "mehrdeutig",
      DUPLICATE: "Duplikat",
      NO_BOOKING: "keine Buchung",
      FAILED: "fehlgeschlagen",
    });
    expect(reviewSummary(3, { PARSED: 1, AMBIGUOUS: 0, DUPLICATE: 0, NO_BOOKING: 2, FAILED: 0 }, 0)).toBe("3 Dateien: 1 erkannt, 2 ohne Buchung");
  });

  it("counts bookings in singular and plural", () => {
    expect(bookButtonLabel(1)).toBe("1 Buchung buchen");
    expect(bookButtonLabel(12)).toBe("12 Buchungen buchen");
    expect(bookedMessage(1)).toBe("1 Buchung gebucht.");
    expect(bookedMessage(12)).toBe("12 Buchungen gebucht.");
  });

  it("explains duplicates and ambiguous matches", () => {
    const match = { type: "BUY", date: "2026-10-15", quantity: "3.412871", amount: "150", fee: "0", tax: "0" } as const;
    expect(ledgerMatchText(match)).toBe("Kauf 15.10.2026, 3,412871 Stück, 150,00\u00a0€");
    expect(ledgerMatchText({ ...match, type: "DIVIDEND", quantity: null, amount: "84.12" })).toBe("Dividende 15.10.2026, 84,12\u00a0€");
    expect(ledgerMatchText({ ...match, type: "FEE", quantity: null, amount: "0", fee: "2.5" })).toBe("Gebühr 15.10.2026, 2,50\u00a0€");
    const record = { ...match, id: "t", depotId: "d", sequence: 0, price: "1", security: null };
    expect(proposalNotes({ status: "duplicate", ledgerMatches: [record], siblingMatch: false })).toEqual([
      "Bereits gebucht am 15.10.2026. Wird nicht erneut gebucht.",
    ]);
    expect(proposalNotes({ status: "ambiguous", ledgerMatches: [record], siblingMatch: true })).toEqual([
      "Gleiche Buchung bereits vorhanden: Kauf 15.10.2026, 3,412871 Stück, 150,00\u00a0€.",
      "Gleiche Buchung mehrfach in diesem Import.",
      "Bitte entscheiden.",
    ]);
    expect(proposalNotes({ status: "unique", ledgerMatches: [], siblingMatch: false })).toEqual([]);
  });

  it("has German messages for edit, review and ledger failures", () => {
    expect(editErrorMessage("quantity", "BUY")).toBe("Bitte eine Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.");
    expect(editErrorMessage("date", "DIVIDEND")).toBe("Bitte ein gültiges Datum eingeben.");
    expect(editErrorMessage("fee", "FEE")).toBe("Bitte einen Betrag größer 0 eingeben.");
    expect(reviewErrorMessage("review-changed")).toBe("Der Import hat sich geändert. Bitte erneut prüfen.");
    expect(reviewErrorMessage("not-found")).toBe("Import nicht gefunden oder bereits gebucht.");
    expect(ledgerRejectedMessage({ fileName: "v.pdf", type: "SELL", failure: { reason: "sell-exceeds-holding", available: "2" } as never })).toBe(
      "v.pdf: Verkauf übersteigt Bestand (2 Stück). Es wurde nichts gebucht.",
    );
    expect(ledgerRejectedMessage({ fileName: null, type: null, failure: { reason: "depot-archived" } })).toBe(
      "Depot ist archiviert. Bitte zuerst reaktivieren. Es wurde nichts gebucht.",
    );
    expect(ledgerRejectedMessage({ fileName: "x.pdf", type: "BUY", failure: { reason: "security-ref-unknown" } })).toBe(
      "x.pdf: Buchung wurde abgelehnt. Es wurde nichts gebucht.",
    );
  });
});
