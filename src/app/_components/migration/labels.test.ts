import { describe, expect, it } from "vitest";
import {
  ACTION_FAILED_MESSAGE,
  bookingFailureMessage,
  bookingItemLabel,
  CLASSIFICATION_OPTIONS,
  comparisonStatus,
  confirmFailureMessage,
  countRows,
  fundingNote,
  openDecisionsLabel,
  openingBalanceFailureMessage,
  openingBalanceSuccess,
  rawRowLabel,
  flagReasonLabel,
  previewFailureMessage,
  type PreviewFailureReason,
  recordsLabel,
  securityTypeLabel,
  skippedFlagLabel,
} from "./labels";

describe("migration labels", () => {
  it("announces funding DEPOSITs in singular and plural", () => {
    expect(fundingNote(0)).toBe("Export ohne Kontobewegungen: 0 Einzahlungen werden ergänzt");
    expect(fundingNote(1)).toBe("Export ohne Kontobewegungen: 1 Einzahlung wird ergänzt");
    expect(fundingNote(3)).toBe("Export ohne Kontobewegungen: 3 Einzahlungen werden ergänzt");
  });

  it.each<[PreviewFailureReason, string]>([
    ["unauthorized", "Sitzung abgelaufen. Bitte erneut anmelden."],
    ["file-missing", "Bitte eine CSV-Datei auswählen."],
    ["file-too-large", "Die Datei ist größer als 5 MB."],
    ["depot-not-found", "Depot nicht gefunden."],
    ["depot-archived", "Depot ist archiviert. Bitte zuerst reaktivieren."],
    ["empty-file", "Die Datei enthält keine Zeilen."],
  ])("%s → %j", (reason, message) => {
    expect(previewFailureMessage({ reason })).toBe(message);
  });

  it("names the missing columns", () => {
    expect(previewFailureMessage({ reason: "missing-columns", columns: ["amount", "fee"] })).toBe(
      "Das ist kein Parqet-Export: Es fehlen die Spalten amount, fee.",
    );
  });

  it.each([
    [{ reason: "unparseable", detail: "shares" }, "Nicht lesbar (Spalte „shares“)"],
    [{ reason: "unparseable" }, "Nicht lesbar (falsche Anzahl Felder)"],
    [{ reason: "non-eur", detail: "USD" }, "Keine Euro-Buchung (Währung USD)"],
    [{ reason: "non-eur", detail: "" }, "Keine Euro-Buchung (Währung leer)"],
    [{ reason: "unsupported-row", detail: "Buy/Cash" }, "Nicht unterstützte Zeile (Buy/Cash)"],
    [{ reason: "unpaired-security-transfer" }, "Ausgehender Wertpapier-Übertrag ohne passenden Eingang"],
    [{ reason: "unsupported-split" }, "Split-Verhältnis nicht darstellbar"],
    [{ reason: "cash-pair-mismatch" }, "Buchung und Barbuchung weichen um mehr als 0,01 € ab"],
  ] as const)("flag %j → %j", (flag, label) => {
    expect(flagReasonLabel(flag)).toBe(label);
  });

  it("labels record numbers", () => {
    expect(recordsLabel([5])).toBe("Zeile 5");
    expect(recordsLabel([4, 5])).toBe("Zeilen 4, 5");
  });

  it("lists every proposal type with its German label", () => {
    expect(countRows({ BUY: 3, SELL: 1, DIVIDEND: 0, TAX: 2, DEPOSIT: 1, WITHDRAWAL: 0 })).toEqual([
      { type: "BUY", label: "Kauf", count: 3 },
      { type: "SELL", label: "Verkauf", count: 1 },
      { type: "DIVIDEND", label: "Dividende", count: 0 },
      { type: "TAX", label: "Steuer", count: 2 },
      { type: "DEPOSIT", label: "Einzahlung", count: 1 },
      { type: "WITHDRAWAL", label: "Auszahlung", count: 0 },
    ]);
  });

  it("marks unknown types as 'Typ unbekannt'", () => {
    expect(securityTypeLabel("UNCLASSIFIED")).toBe("Typ unbekannt");
    expect(securityTypeLabel("CRYPTO")).toBe("Krypto");
    expect(securityTypeLabel("ETF")).toBe("ETF");
    expect(securityTypeLabel("FUND")).toBe("Fonds");
  });

  it("offers every ISIN asset type, Fonds included, in selection order", () => {
    expect(CLASSIFICATION_OPTIONS.map((option) => option.label)).toEqual(["Aktie", "ETF", "Fonds", "Zertifikat"]);
  });

  it("lists a skipped flag with its records and reason", () => {
    expect(skippedFlagLabel({ records: [8], reason: "non-eur", detail: "USD" })).toBe("Zeile 8: Keine Euro-Buchung (Währung USD)");
  });
});

describe("migration confirm labels", () => {
  const sell = { kind: "proposal", key: "2", records: [2], date: "2024-03-01", type: "SELL" } as const;

  it("names booking items", () => {
    expect(bookingItemLabel({ kind: "depot" })).toBe("Depot");
    expect(bookingItemLabel({ kind: "security", key: "US0378331005" })).toBe("Wertpapier US0378331005");
    expect(bookingItemLabel(sell)).toBe("Zeile 2 (Verkauf vom 01.03.2024)");
    expect(bookingItemLabel({ kind: "flag", key: "6", records: [6], date: "", type: "BUY" })).toBe("Markierte Zeile 6 (korrigiert als Kauf)");
    expect(bookingItemLabel({ kind: "flag", key: "6", records: [6], date: "2024-02-30", type: "BUY" })).toBe(
      "Markierte Zeile 6 (korrigiert als Kauf vom 2024-02-30)",
    );
    expect(
      bookingItemLabel({ kind: "isin-change", key: "12-13", records: [12, 13], date: "2024-05-02", oldKey: "A", newKey: "B" }),
    ).toBe("Zeilen 12, 13 (ISIN-Wechsel A → B vom 02.05.2024)");
    expect(
      bookingItemLabel({ kind: "split", key: "4-5", records: [4, 5], date: "2021-06-01", securityKey: "A", ratio: "1:4" }),
    ).toBe("Zeilen 4, 5 (Split 1:4 von A vom 01.06.2021)");
  });

  it("explains a booking failure with the ledger's message for that item", () => {
    expect(bookingFailureMessage(sell, { ok: false, reason: "sell-exceeds-holding", available: "0" })).toBe(
      "Nicht gebucht – Zeile 2 (Verkauf vom 01.03.2024): Verkauf übersteigt Bestand (0 Stück). Es wurde nichts übernommen.",
    );
    expect(bookingFailureMessage({ ...sell, kind: "flag", type: "BUY" }, { ok: false, reason: "amount-invalid" })).toContain(
      "Der Betrag darf nicht negativ sein.",
    );
    const change = { kind: "isin-change", key: "1-2", records: [1, 2], date: "2024-05-02", oldKey: "A", newKey: "B" } as const;
    expect(bookingFailureMessage(change, { ok: false, reason: "later-sell-exceeds-holding", date: "2024-06-01" })).toContain(
      "Der Verkauf am 01.06.2024 würde den Bestand übersteigen.",
    );
    expect(bookingFailureMessage({ kind: "security", key: "X" }, { ok: false, reason: "isin-invalid" })).toContain(
      "Bitte eine gültige ISIN eingeben.",
    );
    expect(bookingFailureMessage({ kind: "depot" }, { ok: false, reason: "security-ref-unknown" })).toContain("Wertpapier fehlt.");
    const split = { kind: "split", key: "4-5", records: [4, 5], date: "2021-06-01", securityKey: "A", ratio: "10:1" } as const;
    expect(bookingFailureMessage(split, { ok: false, reason: "later-sell-exceeds-holding", date: "2024-07-01" })).toContain(
      "Der Verkauf am 01.07.2024 würde den Bestand übersteigen.",
    );
    expect(bookingFailureMessage(split, { ok: false, reason: "split-exists" })).toContain("bereits ein Split erfasst");
  });

  it("explains confirm failures", () => {
    expect(confirmFailureMessage({ ok: false, reason: "depot-archived" })).toBe("Depot ist archiviert. Bitte zuerst reaktivieren.");
    expect(confirmFailureMessage({ ok: false, reason: "decisions-invalid" })).toContain("nicht gelesen");
    expect(confirmFailureMessage({ ok: false, reason: "missing-columns", columns: ["fee"] })).toContain("fee");
    expect(
      confirmFailureMessage({ ok: false, reason: "booking-failed", item: { kind: "depot" }, failure: { ok: false, reason: "depot-archived" } }),
    ).toContain("Depot: Depot ist archiviert.");
  });

  it("tells the user to check the Depot after a failed connection", () => {
    expect(ACTION_FAILED_MESSAGE).toBe("Verbindung fehlgeschlagen. Bitte das Depot prüfen, bevor du es erneut versuchst.");
  });

  it("labels decisions, raw rows and comparison status", () => {
    expect(openDecisionsLabel(2)).toBe("Offene Entscheidungen: 2");
    expect(
      rawRowLabel({
        datetime: "2024-07-03T06:00:00.000Z",
        type: "TransferIn",
        assettype: "Security",
        identifier: "IE00B4L5Y983",
        holdingname: "Welt ETF",
        shares: "3",
        price: "0",
        amount: "300",
        fee: "",
        tax: "",
        currency: "EUR",
      }),
    ).toBe("2024-07-03T06:00:00.000Z · TransferIn · Security · IE00B4L5Y983 · Welt ETF · Stück 3 · Kurs 0 · Betrag 300 · EUR");
    expect(comparisonStatus(true)).toBe("Abweichung");
    expect(comparisonStatus(false)).toBe("gleich");
  });

  it("explains the opening booking", () => {
    expect(openingBalanceFailureMessage({ ok: false, reason: "date-after-export" }, "2024-05-02")).toBe(
      "Das Buchungsdatum darf nicht nach dem 02.05.2024 liegen.",
    );
    expect(openingBalanceFailureMessage({ ok: false, reason: "balance-invalid" }, "2024-05-02")).toContain("Saldo");
    expect(openingBalanceFailureMessage({ ok: false, reason: "unauthorized" }, "2024-05-02")).toContain("Sitzung");
    expect(openingBalanceSuccess({ ok: true, transaction: null, balance: "300" }, "2024-05-02")).toBe(
      "Nichts zu buchen: Der Saldo am 02.05.2024 stimmt bereits (300,00\u00a0€).",
    );
    const transaction = {
      id: "t",
      depotId: "d",
      type: "DEPOSIT",
      date: "2024-02-01",
      sequence: 1,
      quantity: null,
      price: null,
      amount: "1500",
      fee: "0",
      tax: "0",
      security: null,
    } as const;
    expect(openingBalanceSuccess({ ok: true, transaction, balance: "300" }, "2024-05-02")).toBe(
      "Einzahlung über 1.500,00\u00a0€ am 01.02.2024 gebucht. Saldo am 02.05.2024: 300,00\u00a0€.",
    );
  });
});
