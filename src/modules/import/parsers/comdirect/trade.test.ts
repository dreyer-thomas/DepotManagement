import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, UNRECOGNIZED_REASON } from "../registry";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/comdirect", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";
const NO_NOTICE_NOTE = "Keine Steuermitteilung im Dokument: Steuern sind nicht enthalten. Bitte prüfen.";

const parse = (text: string) => parseDocument("COMDIRECT", text);
const failed = (reason: string) => ({ status: "FAILED", reason });

/** The settlement part of a fixture (everything before its Steuermitteilung page). */
function withoutNotice(text: string): string {
  return text.slice(0, text.indexOf("Kundennr. /BLZ Bezeichnung"));
}

describe("comdirect trade", () => {
  it("reads a buy: fee 0 and tax 0 from its Steuermitteilung", () => {
    expect(parse(fixture("buy.txt"))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        {
          type: "BUY",
          date: "2026-04-07",
          isin: "DE0005933931",
          name: "iShares Core DAX UCITS ETF DE",
          quantity: "2.5",
          price: "180.12345",
          amount: "450.31",
          fee: "0",
          tax: "0",
        },
      ],
    });
  });

  it("reads a sell with tax from its Steuermitteilung (abgeführte Steuern −3,32 → tax 3.32)", () => {
    expect(parse(fixture("sell.txt"))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        {
          type: "SELL",
          date: "2026-05-06",
          isin: "LU0274209740",
          name: "Xtrackers MSCI Japan UCITS ETF",
          quantity: "3.2",
          price: "52.5",
          amount: "168",
          fee: "0",
          tax: "3.32",
        },
      ],
    });
  });

  it("derives the fee from the amount vor Steuern (Provision + Börsenplatzgebühr)", () => {
    expect(parse(fixture("buy-fees.txt"))).toMatchObject({
      status: "PARSED",
      proposals: [{ type: "BUY", amount: "450.31", fee: "6.4", tax: "0" }],
    });
  });

  it("fails when the amount vor Steuern is below the Kurswert on a buy (negative fee)", () => {
    const text = fixture("buy-fees.txt").replace("EUR 09.04.2026 EUR 456,71", "EUR 09.04.2026 EUR 449,00");
    expect(parse(text)).toEqual(failed(`Gebühren der Abrechnung nicht plausibel. ${MANUAL}`));
  });

  it("reads a fractional savings-plan quantity with 8 decimals", () => {
    expect(parse(fixture("savings-plan.txt"))).toMatchObject({
      status: "PARSED",
      proposals: [{ type: "BUY", date: "2026-04-15", quantity: "0.27762354", price: "180.1", amount: "50", fee: "0", tax: "0" }],
    });
  });

  it("fails a quantity with more than 8 decimals", () => {
    const text = fixture("savings-plan.txt").replace("St. 0,27762354", "St. 0,277623541");
    expect(parse(text)).toEqual(failed(`Stückzahl nicht lesbar. ${MANUAL}`));
  });

  it("yields one proposal per settlement, each with its own notice's tax", () => {
    const result = parse(`${fixture("buy.txt")}\n${fixture("sell.txt")}`);
    expect(result).toMatchObject({
      status: "PARSED",
      proposals: [
        { type: "BUY", isin: "DE0005933931", tax: "0" },
        { type: "SELL", isin: "LU0274209740", tax: "3.32" },
      ],
    });
    expect(result).not.toHaveProperty("note");
  });

  it("pairs notices by Geschäftsnummer, not by order", () => {
    const buy = fixture("buy.txt");
    const sell = fixture("sell.txt");
    const notices = `${buy.slice(buy.indexOf("Kundennr."))}\n${sell.slice(sell.indexOf("Kundennr."))}`;
    const text = `${withoutNotice(sell)}\n${withoutNotice(buy)}\n${notices}`;
    expect(parse(text)).toMatchObject({
      status: "PARSED",
      proposals: [
        { type: "SELL", tax: "3.32" },
        { type: "BUY", tax: "0" },
      ],
    });
  });

  it("proposes the settlement without notice with tax 0 and a note next to one with its notice", () => {
    expect(parse(`${fixture("buy.txt")}\n${withoutNotice(fixture("sell.txt"))}`)).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        expect.objectContaining({ type: "BUY", tax: "0" }),
        expect.objectContaining({ type: "SELL", amount: "168", tax: "0" }),
      ],
      note: NO_NOTICE_NOTE,
    });
  });

  it("fails a second notice for the same Geschäftsnummer", () => {
    const sell = fixture("sell.txt");
    expect(parse(`${sell}\n${sell.slice(sell.indexOf("Steuerliche Behandlung:"))}`)).toEqual(
      failed(`Steuermitteilung passt zu keiner Abrechnung im Dokument. ${MANUAL}`),
    );
  });

  it("names the notice in multi-execution notice failures", () => {
    const text = `${fixture("buy.txt")}\n${fixture("sell.txt").replace("abgeführte Steuern EUR -3,32", "abgeführte Steuern EUR")}`;
    expect(parse(text)).toEqual(failed(`Abgeführte Steuern nicht lesbar (Steuermitteilung 2). ${MANUAL}`));
  });

  it("fails a notice that matches no settlement of the document", () => {
    const text = `${fixture("buy.txt")}\n${fixture("sell.txt").replace("Nr. 91000002", "Nr. 91000099")}`;
    expect(parse(text)).toEqual(failed(`Steuermitteilung passt zu keiner Abrechnung im Dokument. ${MANUAL}`));
  });

  it("pairs a single notice without number with a single settlement", () => {
    const text = fixture("sell.txt").replace("Verkauf Investmentfonds Nr. 91000002 vom", "Verkauf Investmentfonds vom");
    expect(parse(text)).toMatchObject({ status: "PARSED", proposals: [{ type: "SELL", tax: "3.32" }] });
  });

  it("proposes a settlement without notice with tax 0 and a review note", () => {
    expect(parse(withoutNotice(fixture("sell.txt")))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [expect.objectContaining({ type: "SELL", amount: "168", fee: "0", tax: "0" })],
      note: NO_NOTICE_NOTE,
    });
  });

  it.each([
    ["ISIN", (text: string) => text.replace("WKN / ISIN: DBX0NH / LU0274209740", "WKN / ISIN: DBX0NH / DE0005933931")],
    ["vor Steuern", (text: string) => text.replace("Zu Ihren Gunsten vor Steuern: EUR 168,00", "Zu Ihren Gunsten vor Steuern: EUR 167,00").replace("nach Steuern: EUR 164,68", "nach Steuern: EUR 163,68")],
  ])("fails when the notice's %s differs from the settlement", (_label, change) => {
    expect(parse(change(fixture("sell.txt")))).toEqual(failed(`Steuermitteilung passt nicht zur Abrechnung. ${MANUAL}`));
  });

  it("fails when vor Steuern + abgeführte Steuern ≠ nach Steuern", () => {
    const text = fixture("sell.txt").replace("Zu Ihren Gunsten nach Steuern: EUR 164,68", "Zu Ihren Gunsten nach Steuern: EUR 165,68");
    expect(parse(text)).toEqual(failed(`Beträge der Steuermitteilung gehen nicht auf. ${MANUAL}`));
  });

  it("fails a sell whose total stands under Zu Ihren Lasten (wrong direction)", () => {
    const text = fixture("sell.txt").replace("IBAN Valuta Zu Ihren Gunsten vor Steuern", "IBAN Valuta Zu Ihren Lasten vor Steuern");
    expect(parse(text)).toEqual(failed(`Buchungsrichtung passt nicht zur Geschäftsart. ${MANUAL}`));
  });

  it("fails a foreign-currency settlement", () => {
    const text = fixture("buy.txt").replace("St. 2,5 EUR 180,12345", "St. 2,5 USD 180,12345");
    expect(parse(text)).toEqual(failed(`Abrechnung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails a foreign-currency notice", () => {
    const text = fixture("sell.txt").replace("abgeführte Steuern EUR -3,32", "abgeführte Steuern USD -3,32");
    expect(parse(text)).toEqual(failed(`Steuermitteilung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`));
  });

  it("fails a Storno", () => {
    const text = fixture("buy.txt").replace("Wertpapierkauf\n", "Storno Wertpapierkauf\n");
    expect(parse(text)).toEqual(failed(`Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`));
  });

  it("fails a settlement without ISIN", () => {
    const text = withoutNotice(fixture("buy.txt")).replace("o.N. DE0005933931", "o.N.");
    expect(parse(text)).toEqual(failed(`ISIN nicht lesbar. ${MANUAL}`));
  });

  it("fails a Kurswert that does not fit quantity × price", () => {
    const text = fixture("buy.txt").replace("St. 2,5 EUR 180,12345", "St. 2,5 EUR 190,12345");
    expect(parse(text)).toEqual(failed(`Kurswert passt nicht zu Stückzahl und Kurs. ${MANUAL}`));
  });

  it("names the settlement in multi-execution failures", () => {
    const text = `${fixture("buy.txt")}\n${fixture("sell.txt").replace("Kurswert : EUR 168,00", "Kurswert : EUR")}`;
    expect(parse(text)).toEqual(failed(`Kurswert nicht lesbar (Abrechnung 2). ${MANUAL}`));
  });

  it("leaves other comdirect texts unrecognized", () => {
    expect(parse("Kontoauszug\nAlter Saldo EUR 1.000,00\nNeuer Saldo EUR 1.200,00")).toEqual(failed(UNRECOGNIZED_REASON));
  });
});
