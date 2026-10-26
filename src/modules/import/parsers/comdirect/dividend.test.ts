import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, UNRECOGNIZED_REASON } from "../registry";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/comdirect", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";
const NOTE = "Steuermitteilung (Referenz-Nr. 3AAAAAAAAAA001AA) nicht im Import: Steuern sind nicht enthalten. Bitte prüfen oder zusammen hochladen.";

const parse = (text: string) => parseDocument("COMDIRECT", text);
const failed = (reason: string) => ({ status: "FAILED", reason });

describe("comdirect dividend credit", () => {
  it("reads a foreign-currency credit via its EUR value: tax 0 until the notice is merged", () => {
    expect(parse(fixture("dividend.txt"))).toEqual({
      status: "PARSED",
      documentType: "dividend",
      proposals: [
        {
          type: "DIVIDEND",
          date: "2026-06-21",
          isin: "IE00B3RBWM25",
          name: "Vanguard FTSE All-World UCITS ETF",
          amount: "25.57",
          fee: "0",
          tax: "0",
        },
      ],
      note: NOTE,
      link: { kind: "dividend-credit", reference: "3AAAAAAAAAA001AA", beforeTax: "25.57" },
    });
  });

  it("takes an EUR Bruttobetrag directly", () => {
    const text = fixture("dividend.txt")
      .replace("Bruttobetrag: USD 30,00", "Bruttobetrag: EUR 25,57")
      .replace("zum Devisenkurs: EUR/USD 1,173300 EUR 25,57\n", "");
    expect(parse(text)).toMatchObject({ status: "PARSED", proposals: [{ amount: "25.57", tax: "0" }] });
  });

  it("books foreign withholding tax deducted on the credit as tax (gross − vor Steuern)", () => {
    const text = fixture("dividend.txt").replace("EUR 23.06.2026 EUR 25,57", "EUR 23.06.2026 EUR 21,74");
    expect(parse(text)).toMatchObject({
      status: "PARSED",
      proposals: [{ amount: "25.57", tax: "3.83" }],
      link: { beforeTax: "21.74" },
    });
  });

  it("fails when vor Steuern exceeds the gross amount", () => {
    const text = fixture("dividend.txt").replace("EUR 23.06.2026 EUR 25,57", "EUR 23.06.2026 EUR 26,00");
    expect(parse(text)).toEqual(failed(`Bruttobetrag oder Betrag vor Steuern nicht plausibel. ${MANUAL}`));
  });

  it("fails a foreign-currency credit without EUR value", () => {
    const text = fixture("dividend.txt").replace("zum Devisenkurs: EUR/USD 1,173300 EUR 25,57\n", "");
    expect(parse(text)).toEqual(failed(`Gutschrift in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails a Storno", () => {
    const text = fixture("dividend.txt").replace("Ertragsgutschrift\nDepotbestand", "Storno Ertragsgutschrift\nDepotbestand");
    expect(parse(text)).toEqual(failed(`Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`));
  });

  it("fails without ISIN", () => {
    const text = fixture("dividend.txt").replace("STK 120 IE00B3RBWM25Registered", "STK 120 Registered");
    expect(parse(text)).toEqual(failed(`ISIN nicht lesbar. ${MANUAL}`));
  });

  it("fails without Referenz-Nr.", () => {
    const text = fixture("dividend.txt").replace("(Referenz-Nr. 3AAAAAAAAAA001AA).", ".");
    expect(parse(text)).toEqual(failed(`Referenz-Nr. nicht lesbar. ${MANUAL}`));
  });
});

describe("comdirect dividend Steuermitteilung", () => {
  it("returns only a link (no proposals)", () => {
    expect(parse(fixture("dividend-tax.txt"))).toEqual({
      status: "LINK_ONLY",
      documentType: "dividend-tax",
      link: { kind: "dividend-tax-notice", reference: "3AAAAAAAAAA001AA", isin: "IE00B3RBWM25", beforeTax: "25.57", afterTax: "20.84" },
    });
  });

  it("fails when vor Steuern + abgeführte Steuern ≠ nach Steuern", () => {
    const text = fixture("dividend-tax.txt").replace("abgeführte Steuern EUR -4,73", "abgeführte Steuern EUR -4,48");
    expect(parse(text)).toEqual(failed(`Beträge der Steuermitteilung gehen nicht auf. ${MANUAL}`));
  });

  it("fails a standalone trade notice", () => {
    const sell = fixture("sell.txt");
    expect(parse(sell.slice(sell.indexOf("Kundennr.")))).toEqual(
      failed("Steuermitteilung zu einem Wertpapiergeschäft ohne Abrechnung. Bitte mit der Abrechnung hochladen."),
    );
  });

  it("leaves a non-distribution notice (Vorabpauschale) unrecognized", () => {
    const text = fixture("dividend-tax.txt").replace(
      "Steuerliche Behandlung: Ausländische Investment-Ausschüttung vom 21.06.2026",
      "Steuerliche Behandlung: Vorabpauschale vom 02.01.2026",
    );
    expect(parse(text)).toEqual(failed(UNRECOGNIZED_REASON));
  });

  it("fails without Referenz-Nummer, ISIN or in a foreign currency", () => {
    const text = fixture("dividend-tax.txt");
    expect(parse(text.replace("Referenz-Nummer: 3AAAAAAAAAA001AA", ""))).toEqual(failed(`Referenz-Nummer nicht lesbar. ${MANUAL}`));
    expect(parse(text.replace("A1JX52 / IE00B3RBWM25", "A1JX52 /"))).toEqual(failed(`ISIN der Steuermitteilung nicht lesbar. ${MANUAL}`));
    expect(parse(text.replace("nach Steuern: EUR 20,84", "nach Steuern: USD 20,84"))).toEqual(
      failed(`Steuermitteilung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`),
    );
  });
});
