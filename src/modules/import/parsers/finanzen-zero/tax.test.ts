import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, UNRECOGNIZED_REASON } from "../registry";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/finanzen-zero", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";
const parse = (text: string) => parseDocument("FINANZEN_ZERO", text);
const failed = (reason: string) => ({ status: "FAILED", reason });

describe("finanzen.net zero tax refund", () => {
  it("reads a Steuerausgleichsrechnung as a TAX refund dated by the document", () => {
    expect(parse(fixture("tax-refund.txt"))).toEqual({
      status: "PARSED",
      documentType: "tax-refund",
      proposals: [{ type: "TAX", date: "2026-08-29", amount: "0", fee: "0", tax: "-18.99" }],
    });
  });

  it("fails when the refunded taxes do not add up to the Erstattung", () => {
    const text = fixture("tax-refund.txt").replace("Kapitalertragsteuer EUR 4,00", "Kapitalertragsteuer EUR 4,01");
    expect(parse(text)).toEqual(failed(`Erstattete Steuern ergeben nicht den Erstattungsbetrag. ${MANUAL}`));
  });

  it("fails when the sentence states another amount", () => {
    const text = fixture("tax-refund.txt").replace("in Höhe von 18,99 EUR", "in Höhe von 19,99 EUR");
    expect(parse(text)).toEqual(failed(`Erstattungsbetrag im Text weicht ab. ${MANUAL}`));
  });

  it("fails a Storno", () => {
    const text = fixture("tax-refund.txt").replace("Steuerausgleichsrechnung\nBaader", "Steuerausgleichsrechnung\nStorno\nBaader");
    expect(parse(text)).toEqual(failed(`Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`));
  });

  it("fails without document date", () => {
    const text = fixture("tax-refund.txt").replace("Karlsruhe\n29.08.2026\n", "Karlsruhe\n");
    expect(parse(text)).toEqual(failed(`Belegdatum nicht lesbar. ${MANUAL}`));
  });

  it("fails without Erstattung", () => {
    const text = fixture("tax-refund.txt").replace("18,99EURErstattung", "18,99EURBelastung");
    expect(parse(text)).toEqual(failed(`Steuerausgleichsrechnung ohne Erstattung wird nicht unterstützt. ${MANUAL}`));
  });
});

describe("finanzen.net zero tax-pot notice", () => {
  it("needs no booking", () => {
    expect(parse(fixture("tax-pot-no-booking.txt"))).toEqual({
      status: "NO_BOOKING",
      documentType: "tax-pot",
      reason: "Keine Buchung erforderlich.",
    });
  });

  it("is recognised by the phrase without title", () => {
    const text = fixture("tax-pot-no-booking.txt").replace("Verlusttopfoptimierung\n", "");
    expect(parse(text)).toMatchObject({ status: "NO_BOOKING" });
  });

  it("fails a Storno", () => {
    const text = fixture("tax-pot-no-booking.txt").replace("Verlusttopfoptimierung\n", "Verlusttopfoptimierung\nStorno\n");
    expect(parse(text)).toEqual(failed(`Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`));
  });

  it("fails a notice with an account posting", () => {
    const text = fixture("tax-pot-no-booking.txt").replace(
      "Bitte prüfen Sie diese Mitteilung.",
      "Den Betrag in Höhe von 5,00 EUR erstatten wir dem Konto 1234567006.\nBitte prüfen Sie diese Mitteilung.",
    );
    expect(parse(text)).toEqual(failed(`Steuertopf-Mitteilung mit Kontobuchung wird nicht unterstützt. ${MANUAL}`));
  });

  it("leaves a non-Baader notice unrecognized", () => {
    expect(parse(fixture("tax-pot-no-booking.txt").replaceAll("Baader Bank", "Musterbank"))).toEqual(failed(UNRECOGNIZED_REASON));
  });
});

describe("finanzen.net zero corporate action", () => {
  const REASON = "Kapitalmaßnahme bitte als Corporate Action erfassen.";

  it("fails an ISIN change with the Corporate Action hint", () => {
    expect(parse(fixture("isin-change.txt"))).toEqual(failed(REASON));
  });

  it.each(["Aktiensplit", "Reverse Split", "Kapitalerhöhung", "Spin-off", "Verschmelzung"])("fails a %s notice", (title) => {
    const text = fixture("isin-change.txt").replaceAll("Obligatorischer Umtausch", title).replace(/(Ein|Aus)buchung (in|aus) Depot/g, "Buchung");
    expect(parse(text)).toEqual(failed(REASON));
  });

  it("fails any document with a depot posting, even under a trade title", () => {
    const text = fixture("buy.txt").replace("Die Wertpapiere buchen wir zu Gunsten Ihres Depots.", "Einbuchung in Depot 1234567001 per 15.04.2026");
    expect(parse(text)).toEqual(failed(REASON));
  });

  it("leaves Baader text without a known title unrecognized", () => {
    expect(parse("Baader Bank AG\nKontoauszug")).toEqual(failed(UNRECOGNIZED_REASON));
  });
});
