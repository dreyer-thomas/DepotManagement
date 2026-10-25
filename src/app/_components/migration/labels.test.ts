import { describe, expect, it } from "vitest";
import {
  countRows,
  flagReasonLabel,
  previewFailureMessage,
  type PreviewFailureReason,
  recordsLabel,
  securityTypeLabel,
} from "./labels";

describe("migration labels", () => {
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
    [{ reason: "unpaired-security-transfer" }, "Wertpapier-Übertrag ohne passendes Gegenstück"],
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
  });
});
