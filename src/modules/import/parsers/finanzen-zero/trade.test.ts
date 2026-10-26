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
const TOTAL_REASON = `Abrechnungsbetrag stimmt nicht mit Kurswert, Gebühren und Steuern überein. ${MANUAL}`;

describe("finanzen.net zero settlement", () => {
  it("reads a buy: the Gutschrift offsets the fees (fee 0)", () => {
    expect(parse(fixture("buy.txt"))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        { type: "BUY", date: "2026-04-15", isin: "DE0007236101", name: "Siemens AG", quantity: "12", price: "180.5", amount: "2166", fee: "0", tax: "0" },
      ],
    });
  });

  it("reads a sell with taxes, ignoring the Steuerbeträge page", () => {
    expect(parse(fixture("sell.txt"))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        {
          type: "SELL",
          date: "2026-05-15",
          isin: "DE0005557508",
          name: "Deutsche Telekom AG",
          quantity: "30",
          price: "25.4",
          amount: "762",
          fee: "1",
          tax: "42.73",
        },
      ],
    });
  });

  it("books a buy with net fees and Kirchensteuer", () => {
    const text = fixture("buy.txt")
      .replace("Handelsplatzabhängige Gutschrift Baader 2,60 -EUR", "Handelsplatzabhängige Gutschrift Baader 0,60 -EUR\nKirchensteuer 1,00EUR")
      .replace("Zu Lasten Konto 1234567006 EUR 2.166,00", "Zu Lasten Konto 1234567006 EUR 2.169,00");
    expect(parse(text)).toMatchObject({ status: "PARSED", proposals: [{ type: "BUY", amount: "2166", fee: "2", tax: "1" }] });
  });

  it("reads a loss sale where Baader refunds tax (unsigned tax lines → negative tax)", () => {
    const text = fixture("sell.txt")
      .replace("Kapitalertragsteuer 40,50 -EUR", "Kapitalertragsteuer 10,00EUR")
      .replace("Solidaritätszuschlag 2,23 -EUR", "Solidaritätszuschlag 0,55EUR")
      .replace("Zu Gunsten Konto 1234567006 EUR 718,27", "Zu Gunsten Konto 1234567006 EUR 771,55");
    expect(parse(text)).toMatchObject({ status: "PARSED", proposals: [{ type: "SELL", amount: "762", fee: "1", tax: "-10.55" }] });
  });

  it("reads a fractional quantity exactly", () => {
    const text = fixture("buy.txt")
      .replace("STK 12 Siemens AG", "STK 0,4321 Siemens AG")
      .replace("15.04.2026STK 12 EUR", "15.04.2026STK 0,4321 EUR")
      .replace("EURKurswert 2.166,00", "EURKurswert 77,99")
      .replace("Zu Lasten Konto 1234567006 EUR 2.166,00", "Zu Lasten Konto 1234567006 EUR 77,99");
    expect(parse(text)).toMatchObject({
      status: "PARSED",
      proposals: [{ type: "BUY", quantity: "0.4321", price: "180.5", amount: "77.99", fee: "0", tax: "0" }],
    });
  });

  it("drops an over-long name", () => {
    const text = fixture("buy.txt").replace("STK 12 Siemens AG", `STK 12 ${"S".repeat(300)}`);
    const result = parse(text);
    expect(result).toMatchObject({ status: "PARSED" });
    expect(result.status === "PARSED" && result.proposals[0]).not.toHaveProperty("name");
  });

  it.each([
    ["buy total", "buy.txt", "Zu Lasten Konto 1234567006 EUR 2.166,00", "Zu Lasten Konto 1234567006 EUR 2.166,01"],
    ["sell total", "sell.txt", "Zu Gunsten Konto 1234567006 EUR 718,27", "Zu Gunsten Konto 1234567006 EUR 718,28"],
    ["buy marked Zu Gunsten", "buy.txt", "Zu Lasten Konto 1234567006", "Zu Gunsten Konto 1234567006"],
    ["sell marked Zu Lasten", "sell.txt", "Zu Gunsten Konto 1234567006", "Zu Lasten Konto 1234567006"],
  ])("fails a wrong %s", (_label, name, from, to) => {
    expect(parse(fixture(name).replace(from, to))).toEqual(failed(TOTAL_REASON));
  });

  it("fails when the Gutschrift exceeds the fees (net fee credit)", () => {
    const text = fixture("buy.txt")
      .replace("Handelsplatzabhängige Gutschrift Baader 2,60 -EUR", "Handelsplatzabhängige Gutschrift Baader 3,60 -EUR")
      .replace("Zu Lasten Konto 1234567006 EUR 2.166,00", "Zu Lasten Konto 1234567006 EUR 2.165,00");
    expect(parse(text)).toEqual(failed(`Gutschriften übersteigen die Gebühren. ${MANUAL}`));
  });

  it("fails an unknown position line", () => {
    const text = fixture("buy.txt").replace("Finanzkommission Baader 0,50EUR", "Fremde Spesen 0,50EUR");
    expect(parse(text)).toEqual(failed(`Position „Fremde Spesen“ wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails a foreign-currency Kurswert", () => {
    const text = fixture("buy.txt").replace("EURKurswert 2.166,00", "USDKurswert 2.166,00");
    expect(parse(text)).toEqual(failed(`Abrechnung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails a foreign-currency execution", () => {
    const text = fixture("buy.txt").replace("15.04.2026STK 12 EUR 180,50", "15.04.2026STK 12 USD 180,50");
    expect(parse(text)).toEqual(failed(`Abrechnung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails two executions (partial fills)", () => {
    const text = fixture("buy.txt").replace(
      "GETTEX - MM Munich 15.04.2026STK 12 EUR 180,50 09:12:30:415",
      "GETTEX - MM Munich 15.04.2026STK 5 EUR 180,50 09:12:30:415\nGETTEX - MM Munich 15.04.2026STK 7 EUR 180,50 09:12:31:002",
    );
    expect(parse(text)).toEqual(failed(`Mehrere Teilausführungen werden nicht unterstützt. ${MANUAL}`));
  });

  it("fails when the executed quantity differs from the Nominale", () => {
    const text = fixture("buy.txt").replace("15.04.2026STK 12 EUR", "15.04.2026STK 11 EUR");
    expect(parse(text)).toEqual(failed(`Stückzahl der Ausführung passt nicht zur Nominale. ${MANUAL}`));
  });

  it("fails when quantity × price differs from the Kurswert", () => {
    const text = fixture("buy.txt").replace("15.04.2026STK 12 EUR 180,50", "15.04.2026STK 12 EUR 180,60");
    expect(parse(text)).toEqual(failed(`Kurswert passt nicht zu Stückzahl und Kurs. ${MANUAL}`));
  });

  it("fails a Storno", () => {
    const text = fixture("buy.txt").replace("Wertpapierabrechnung: Kauf", "Wertpapierabrechnung: Kauf\nStorno");
    expect(parse(text)).toEqual(failed(`Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`));
  });

  it("fails without ISIN", () => {
    const text = fixture("buy.txt").replace("ISIN: DE0007236101", "ISIN:");
    expect(parse(text)).toEqual(failed(`ISIN nicht lesbar. ${MANUAL}`));
  });

  it("fails without execution line or Kurswert", () => {
    expect(parse(fixture("buy.txt").replace("15.04.2026STK 12 EUR 180,50 09:12:30:415", ""))).toEqual(failed(`Ausführung nicht lesbar. ${MANUAL}`));
    expect(parse(fixture("buy.txt").replace("EURKurswert 2.166,00", "Kurswert"))).toEqual(failed(`Kurswert nicht lesbar. ${MANUAL}`));
  });

  it("leaves other documents unrecognized", () => {
    expect(parse(fixture("buy.txt").replaceAll("Baader Bank", "Musterbank"))).toEqual(failed(UNRECOGNIZED_REASON));
    expect(parse(fixture("buy.txt").replace("Wertpapierabrechnung: Kauf", "Kontoauszug"))).toEqual(failed(UNRECOGNIZED_REASON));
    expect(parse("Wertpapierabrechnung: Kauf")).toEqual(failed(UNRECOGNIZED_REASON));
  });
});
