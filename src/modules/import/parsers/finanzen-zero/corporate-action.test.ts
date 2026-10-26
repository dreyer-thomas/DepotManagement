import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, UNRECOGNIZED_REASON } from "../registry";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/finanzen-zero", name), "utf8");
}

const REASON = "Kapitalmaßnahme bitte in der Position unter „Corporate Action“ erfassen.";
const parse = (text: string) => parseDocument("FINANZEN_ZERO", text);
const corporateAction = { status: "FAILED", reason: REASON, corporateAction: true };
const NOTICE = fixture("isin-change.txt");

describe("finanzen.net zero ISIN change", () => {
  it("reads an Obligatorischer Umtausch as an ISIN change dated by the per date", () => {
    expect(parse(NOTICE)).toEqual({
      status: "CORPORATE_ACTION",
      documentType: "corporate-action",
      isinChange: {
        kind: "isin-change",
        date: "2026-08-13",
        oldIsin: "DE0007236101",
        oldName: "Siemens AG",
        oldQuantity: "12",
        newIsin: "DE000ENER6Y0",
        newName: "Siemens Energy AG",
        newQuantity: "12",
      },
    });
  });

  it("reads different quantities and Windows line endings", () => {
    const text = NOTICE.replace("Stück 12 Siemens Energy AG", "Stück 1.234,5 Siemens Energy AG").replaceAll("\n", "\r\n");
    expect(parse(text)).toMatchObject({ status: "CORPORATE_ACTION", isinChange: { oldQuantity: "12", newQuantity: "1234.5" } });
  });
});

describe("finanzen.net zero unreadable corporate action", () => {
  it.each(["Aktiensplit", "Reverse Split", "Kapitalerhöhung", "Spin-off", "Verschmelzung"])("fails a %s notice without depot postings", (title) => {
    const text = NOTICE.replaceAll("Obligatorischer Umtausch", title).replace(/(Ein|Aus)buchung (in|aus) Depot/g, "Buchung");
    expect(parse(text)).toEqual(corporateAction);
  });

  it.each([
    ["the Einbuchung block is missing", (text: string) => text.replace(/Einbuchung\nStück[^\n]*\nISIN: [^\n]*\n/, "")],
    ["the Ausbuchung block lacks its ISIN", (text: string) => text.replace("Stück 12 Siemens AG\nISIN: DE0007236101", "Stück 12 Siemens AG")],
    ["page 2 is missing", (text: string) => text.slice(0, text.indexOf("Seite 1/2"))],
    ["the dates differ", (text: string) => text.replace("Einbuchung in Depot 1234567001 per 13.08.2026", "Einbuchung in Depot 1234567001 per 14.08.2026")],
    ["the date is not a real day", (text: string) => text.replaceAll("per 13.08.2026", "per 31.02.2026")],
    ["there is a Barausgleich", (text: string) => text.replace("Verhältnis: 1 : 1", "Verhältnis: 1 : 1\nBarausgleich EUR 3,50")],
    ["there is a Spitze", (text: string) => text.replace("Verhältnis: 1 : 1", "Verhältnis: 1 : 1\nSpitze 0,5")],
    ["cash is posted", (text: string) => text.replace("Verhältnis: 1 : 1", "Verhältnis: 1 : 1\nZu Gunsten Konto 1234567006 EUR 3,50")],
    ["two Einbuchungen are posted", (text: string) => `${text}\nEinbuchung in Depot 1234567001 per 13.08.2026`],
    ["a second Einbuchung block follows", (text: string) => `${text}\nEinbuchung\nStück 1 Muster AG\nISIN: DE0007164600`],
    ["both ISINs are equal", (text: string) => text.replace("ISIN: DE000ENER6Y0\nBerücksichtigte", "ISIN: DE0007236101\nBerücksichtigte")],
    ["an ISIN has a wrong check digit", (text: string) => text.replace("ISIN: DE000ENER6Y0\nBerücksichtigte", "ISIN: DE000ENER6Y1\nBerücksichtigte")],
    ["a quantity is zero", (text: string) => text.replace("Stück 12 Siemens Energy AG", "Stück 0 Siemens Energy AG")],
  ])("fails with the Corporate Action hint when %s", (_label, change) => {
    expect(parse(change(NOTICE))).toEqual(corporateAction);
  });

  it("fails any document with a depot posting, even under a trade title", () => {
    const text = fixture("buy.txt").replace("Die Wertpapiere buchen wir zu Gunsten Ihres Depots.", "Einbuchung in Depot 1234567001 per 15.04.2026");
    expect(parse(text)).toEqual(corporateAction);
  });

  it("leaves Baader text without a known title unrecognized and keeps the manual-entry hint there", () => {
    expect(parse("Baader Bank AG\nKontoauszug")).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
  });
});
