import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "../registry";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/finanzen-zero", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";
const parse = (text: string) => parseDocument("FINANZEN_ZERO", text);
const failed = (reason: string) => ({ status: "FAILED", reason });

describe("finanzen.net zero dividend", () => {
  it("reads a dividend with withholding tax and an external fee", () => {
    expect(parse(fixture("dividend.txt"))).toEqual({
      status: "PARSED",
      documentType: "dividend",
      proposals: [
        {
          type: "DIVIDEND",
          date: "2026-07-10",
          isin: "US8740391003",
          name: "Taiwan Semiconductor Manufacturing Co. Ltd.",
          amount: "6.1",
          fee: "0.05",
          tax: "1.53",
        },
      ],
    });
  });

  it("reads a fund distribution", () => {
    expect(parse(fixture("fund-distribution.txt"))).toEqual({
      status: "PARSED",
      documentType: "dividend",
      proposals: [
        { type: "DIVIDEND", date: "2026-07-29", isin: "US7561091049", name: "Realty Income Corp.", amount: "4.74", fee: "0", tax: "1.26" },
      ],
    });
  });

  it("books a refunded (unsigned) tax line as negative tax", () => {
    const text = fixture("dividend.txt").replace("Quellensteuer 1,28 -EUR", "Quellensteuer 1,28EUR").replace("4,52EURValuta", "7,08EURValuta");
    expect(parse(text)).toMatchObject({ status: "PARSED", proposals: [{ type: "DIVIDEND", amount: "6.1", fee: "0.05", tax: "-1.03" }] });
  });

  it("fails a wrong credited amount", () => {
    const text = fixture("dividend.txt").replace("4,52EURValuta", "4,53EURValuta");
    expect(parse(text)).toEqual(failed(`Gutschriftsbetrag stimmt nicht mit Bruttobetrag, Gebühren und Steuern überein. ${MANUAL}`));
  });

  it("fails a foreign-currency gross amount without EUR value", () => {
    const text = fixture("dividend.txt").replace("Bruttobetrag EUR 6,10\n", "");
    expect(parse(text)).toEqual(failed(`Gutschrift in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails an unknown position line", () => {
    const text = fixture("dividend.txt").replace("Gebühren extern ADR 0,05 -EUR", "Spesen 0,05 -EUR");
    expect(parse(text)).toEqual(failed(`Position „Spesen“ wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails a net fee credit", () => {
    const text = fixture("dividend.txt").replace("Gebühren extern ADR 0,05 -EUR", "Gebühren extern ADR 0,05EUR").replace("4,52EURValuta", "4,62EURValuta");
    expect(parse(text)).toEqual(failed(`Gutschriften übersteigen die Gebühren. ${MANUAL}`));
  });

  it("fails a Storno and a missing ISIN or Zahltag", () => {
    expect(parse(fixture("dividend.txt").replace("Dividendenabrechnung\nSTK", "Storno Dividendenabrechnung\nDividendenabrechnung\nSTK"))).toEqual(
      failed(`Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`),
    );
    expect(parse(fixture("dividend.txt").replace("ISIN: US8740391003", "ISIN:"))).toEqual(failed(`ISIN nicht lesbar. ${MANUAL}`));
    expect(parse(fixture("dividend.txt").replace("Zahltag: 10.07.2026", "Zahltag:"))).toEqual(failed(`Zahltag nicht lesbar. ${MANUAL}`));
  });
});
