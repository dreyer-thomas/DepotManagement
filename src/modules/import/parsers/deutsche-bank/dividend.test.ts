import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "../registry";
import { parseDeutscheBankDividend } from "./dividend";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/deutsche-bank", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";

describe("parseDeutscheBankDividend", () => {
  it("reads an EUR distribution: amount = Bruttoertrag, tax = gross − credit", () => {
    expect(parseDeutscheBankDividend(fixture("dividend-eur.txt"))).toEqual([
      {
        type: "DIVIDEND",
        date: "2026-10-15",
        isin: "LU00MUST0044",
        name: "BEISPIEL EURO DIVIDEND UCITS ETF DIS",
        amount: "50",
        tax: "13.19",
      },
    ]);
  });

  it("uses the EUR column when a foreign column precedes it", () => {
    expect(parseDeutscheBankDividend(fixture("dividend-foreign-eur.txt"))).toEqual([
      {
        type: "DIVIDEND",
        date: "2026-10-16",
        isin: "US00MUST0054",
        name: "MUSTER TECHNOLOGIES INC. REGISTERED SHARES DL -,01",
        amount: "87.13",
        tax: "21.25",
      },
    ]);
  });

  it("reads the EUR column wrapped onto the next line", () => {
    const text = fixture("dividend-foreign-eur.txt")
      .replace("Bruttoertrag 98,80 USD 87,13 EUR", "Bruttoertrag 98,80 USD\n87,13 EUR")
      .replace("16.10.2026 65,88 EUR", "16.10.2026 74,70 USD\n65,88 EUR");
    expect(parseDeutscheBankDividend(text)).toEqual([expect.objectContaining({ amount: "87.13", tax: "21.25" })]);
  });

  it("omits the name when the name line is missing", () => {
    const text = fixture("dividend-eur.txt").replace("BEISPIEL EURO DIVIDEND UCITS ETF DIS\nDepot-Nr. 100 1234567 00\nEx-Tag 08.10.2026\n", "");
    const result = parseDeutscheBankDividend(text);
    expect(result).toEqual([{ type: "DIVIDEND", date: "2026-10-15", isin: "LU00MUST0044", amount: "50", tax: "13.19" }]);
  });

  it("rejects a credit stated only in a foreign currency", () => {
    expect(parseDeutscheBankDividend(fixture("dividend-foreign-only.txt"))).toEqual({
      error: "invalid",
      message: `Gutschrift in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`,
    });
  });

  it("rejects a gross amount stated only in a foreign currency", () => {
    const text = fixture("dividend-foreign-eur.txt").replace("Bruttoertrag 98,80 USD 87,13 EUR", "Bruttoertrag 98,80 USD");
    expect(parseDeutscheBankDividend(text)).toEqual({ error: "invalid", message: `Gutschrift in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}` });
  });

  it("returns a negative tax (refund) when the credit exceeds the gross amount", () => {
    const text = fixture("dividend-eur.txt").replace("15.10.2026 36,81 EUR", "15.10.2026 51,20 EUR");
    expect(parseDeutscheBankDividend(text)).toEqual([expect.objectContaining({ amount: "50", tax: "-1.2" })]);
  });

  it("tolerates the value on the following line", () => {
    const text = fixture("dividend-eur.txt").replace("Bruttoertrag 50,00 EUR", "Bruttoertrag\n50,00 EUR").replace("Zahlbar 15.10.2026", "Zahlbar\n15.10.2026");
    expect(parseDeutscheBankDividend(text)).toEqual([expect.objectContaining({ date: "2026-10-15", amount: "50", tax: "13.19" })]);
  });

  it("names the missing field", () => {
    const text = fixture("dividend-eur.txt");
    expect(parseDeutscheBankDividend(text.replace("Zahlbar 15.10.2026", ""))).toEqual({ error: "invalid", message: `Zahltag nicht lesbar. ${MANUAL}` });
    expect(parseDeutscheBankDividend(text.replace("40 MUS004 LU00MUST0044", "40 MUS004"))).toEqual({ error: "invalid", message: `ISIN nicht lesbar. ${MANUAL}` });
    expect(parseDeutscheBankDividend(text.replace("Bruttoertrag 50,00 EUR", "Bruttoertrag"))).toEqual({
      error: "invalid",
      message: `Bruttoertrag nicht lesbar. ${MANUAL}`,
    });
    expect(parseDeutscheBankDividend(text.replace("Gutschrift mit Wert 15.10.2026 36,81 EUR", ""))).toEqual({
      error: "invalid",
      message: `Gutschriftsbetrag nicht lesbar. ${MANUAL}`,
    });
  });

  it("rejects a Storno", () => {
    const text = fixture("dividend-eur.txt").replace("Ertragsgutschrift", "Storno Ertragsgutschrift");
    expect(parseDeutscheBankDividend(text)).toEqual({ error: "invalid", message: `Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}` });
  });

  it.each(["buy.txt", "vorabpauschale.txt"])("does not claim %s", (name) => {
    expect(parseDeutscheBankDividend(fixture(name))).toEqual({ error: "unrecognized" });
  });
});

describe("parseDocument(DEUTSCHE_BANK) for dividends", () => {
  it("parses a dividend end to end with document type dividend", () => {
    expect(parseDocument("DEUTSCHE_BANK", fixture("dividend-foreign-eur.txt"))).toEqual({
      status: "PARSED",
      documentType: "dividend",
      proposals: [
        {
          type: "DIVIDEND",
          date: "2026-10-16",
          isin: "US00MUST0054",
          name: "MUSTER TECHNOLOGIES INC. REGISTERED SHARES DL -,01",
          amount: "87.13",
          fee: "0",
          tax: "21.25",
        },
      ],
    });
  });

  it("fails a foreign-only credit with its reason", () => {
    expect(parseDocument("DEUTSCHE_BANK", fixture("dividend-foreign-only.txt"))).toEqual({
      status: "FAILED",
      reason: `Gutschrift in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`,
    });
  });
});
