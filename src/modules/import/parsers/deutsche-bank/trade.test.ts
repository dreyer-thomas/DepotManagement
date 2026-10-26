import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, UNRECOGNIZED_REASON } from "../registry";
import { parseDeutscheBankTrade } from "./trade";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../../test/fixtures/import/deutsche-bank", name), "utf8");
}

const MANUAL = "Buchung bitte manuell erfassen.";

describe("parseDeutscheBankTrade", () => {
  it("reads a buy: fee = booked total − Kurswert", () => {
    expect(parseDeutscheBankTrade(fixture("buy.txt"))).toEqual([
      {
        type: "BUY",
        date: "2026-10-08",
        isin: "IE00MUST0015",
        name: "MUSTER WORLD EQUITY UCITS ETF",
        quantity: "12.5",
        price: "80.4",
        amount: "1005",
        fee: "7.9",
        tax: "0",
      },
    ]);
  });

  it("nets a rebate (Ausgekehrte Zuwendungen) into the fee", () => {
    expect(parseDeutscheBankTrade(fixture("buy-rebate.txt"))).toEqual([
      expect.objectContaining({ type: "BUY", isin: "LU00MUST0044", quantity: "3.1415", price: "159.15", amount: "499.97", fee: "3.75", tax: "0" }),
    ]);
  });

  it("fails when the rebate exceeds the fees (negative net fee)", () => {
    const text = fixture("buy-rebate.txt").replace("EUR 503,72", "EUR 499,00");
    expect(parseDeutscheBankTrade(text)).toEqual({
      error: "invalid",
      message: `Gebühren der Abrechnung nicht plausibel (Gutschriften übersteigen Gebühren). ${MANUAL}`,
    });
  });

  it("reads a sell with taxes: printed negative taxes are paid, fee is the remaining difference", () => {
    expect(parseDeutscheBankTrade(fixture("sell-tax.txt"))).toEqual([
      {
        type: "SELL",
        date: "2026-10-05",
        isin: "DE000MUST034",
        name: "MUSTER INDUSTRIE AG NAMENS-AKTIEN O.N.",
        quantity: "20",
        price: "50",
        amount: "1000",
        fee: "7.9",
        tax: "14.01",
      },
    ]);
  });

  it("takes tax lines on a buy as printed", () => {
    const text = fixture("buy.txt").replace(
      "Buchung auf Kontonummer 1234567 40 mit Wertstellung 12.10.2026 EUR 1.012,90",
      "Kapitalertragsteuer EUR 2,00\nBuchung auf Kontonummer 1234567 40 mit Wertstellung 12.10.2026 EUR 1.014,90",
    );
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ type: "BUY", amount: "1005", fee: "7.9", tax: "2" })]);
  });

  it("returns a negative tax for a positive (refund) tax line on a sell", () => {
    const text = fixture("sell-tax.txt")
      .replace(
        "Kapitalertragsteuer EUR -12,34\nSolidaritätszuschlag auf Kapitalertragsteuer EUR -0,67\nKirchensteuer auf Kapitalertragsteuer EUR -1,00",
        "Kapitalertragsteuer EUR 5,00",
      )
      .replace("EUR 978,09", "EUR 997,10");
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ type: "SELL", amount: "1000", fee: "7.9", tax: "-5" })]);
  });

  it("fails on a tax line whose amount cannot be read instead of moving the tax into the fee", () => {
    const text = fixture("sell-tax.txt").replace("Kapitalertragsteuer EUR -12,34", "Kapitalertragsteuer - 12,34 EUR");
    expect(parseDeutscheBankTrade(text)).toEqual({ error: "invalid", message: `Steuerbetrag nicht lesbar. ${MANUAL}` });
  });

  it("reads a mandate sell with plain Schlusstag and the total on the next line", () => {
    expect(parseDeutscheBankTrade(fixture("sell-mandate.txt"))).toEqual([
      {
        type: "SELL",
        date: "2026-10-12",
        isin: "IE00MUST0023",
        name: "MUSTER GLOBAL BOND UCITS ETF",
        quantity: "2.245",
        price: "45.1",
        amount: "101.25",
        fee: "0",
        tax: "0",
      },
    ]);
  });

  it("returns one proposal per Abrechnung section in document order", () => {
    const result = parseDeutscheBankTrade(fixture("multi-execution.txt"));
    expect(result).toEqual([
      expect.objectContaining({ type: "BUY", date: "2026-10-01", isin: "IE00MUST0015", quantity: "1.23456789", price: "81", amount: "100", fee: "0", tax: "0" }),
      expect.objectContaining({ type: "BUY", date: "2026-10-01", isin: "LU00MUST0044", quantity: "0.5", price: "120", amount: "60", fee: "0", tax: "0" }),
      expect.objectContaining({ type: "SELL", date: "2026-10-01", isin: "DE000MUST034", quantity: "1.5", price: "30", amount: "45", fee: "0.5", tax: "0" }),
    ]);
  });

  it("fails the whole multi-execution document when one section is unreadable", () => {
    const text = fixture("multi-execution.txt").replace("MUS004 LU00MUST0044", "MUS004");
    expect(parseDeutscheBankTrade(text)).toEqual({ error: "invalid", message: `ISIN nicht lesbar (Abrechnung 2). ${MANUAL}` });
  });

  it("names the section of a foreign-currency execution in a multi-execution document", () => {
    const text = fixture("multi-execution.txt").replace("Kurs EUR 120,00\nKurswert EUR 60,00", "Kurs USD 120,00\nKurswert USD 60,00");
    expect(parseDeutscheBankTrade(text)).toEqual({
      error: "invalid",
      message: `Abrechnung in Fremdwährung (USD) wird nicht unterstützt (Abrechnung 2). ${MANUAL}`,
    });
  });

  it("rejects a foreign-currency settlement", () => {
    expect(parseDeutscheBankTrade(fixture("trade-foreign.txt"))).toEqual({
      error: "invalid",
      message: `Abrechnung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`,
    });
  });

  it("names the missing field", () => {
    expect(parseDeutscheBankTrade(fixture("trade-missing-isin.txt"))).toEqual({ error: "invalid", message: `ISIN nicht lesbar. ${MANUAL}` });
    const buy = fixture("buy.txt");
    expect(parseDeutscheBankTrade(buy.replace("Nominal ST 12,5", "Nominal"))).toEqual({ error: "invalid", message: `Stückzahl nicht lesbar. ${MANUAL}` });
    expect(parseDeutscheBankTrade(buy.replace("Kurswert EUR 1.005,00", ""))).toEqual({ error: "invalid", message: `Kurswert nicht lesbar. ${MANUAL}` });
    expect(parseDeutscheBankTrade(buy.replace("Schlusstag/-zeit MEZ 08.10.2026", "Schlusstag/-zeit MEZ 32.10.2026"))).toEqual({
      error: "invalid",
      message: `Schlusstag nicht lesbar. ${MANUAL}`,
    });
    expect(parseDeutscheBankTrade(buy.replace("EUR 1.012,90", ""))).toEqual({ error: "invalid", message: `Buchungsbetrag nicht lesbar. ${MANUAL}` });
  });

  it("rejects a quantity with more than 8 decimals and an implausible Kurswert", () => {
    const buy = fixture("buy.txt");
    expect(parseDeutscheBankTrade(buy.replace("Nominal ST 12,5", "Nominal ST 12,500000001"))).toEqual({
      error: "invalid",
      message: `Stückzahl nicht lesbar. ${MANUAL}`,
    });
    expect(parseDeutscheBankTrade(buy.replace("Kurs EUR 80,40", "Kurs EUR 8,04"))).toEqual({
      error: "invalid",
      message: `Kurswert passt nicht zu Stückzahl und Kurs. ${MANUAL}`,
    });
  });

  it("tolerates other extractors' whitespace and line breaks between label, currency and value", () => {
    const text = fixture("buy.txt")
      .replace("Kurs EUR 80,40", "Kurs   EUR\n80,40")
      .replace("Kurswert EUR 1.005,00", "Kurswert\tEUR  1.005,00")
      .replace("Nominal ST 12,5", "Nominal\nST\n12,5");
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ quantity: "12.5", price: "80.4", amount: "1005", fee: "7.9" })]);
  });

  it("rejects a Storno", () => {
    expect(parseDeutscheBankTrade(fixture("storno.txt"))).toEqual({
      error: "invalid",
      message: `Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`,
    });
  });

  it.each(["dividend-eur.txt", "vorabpauschale.txt"])("does not claim %s", (name) => {
    expect(parseDeutscheBankTrade(fixture(name))).toEqual({ error: "unrecognized" });
  });
});

describe("parseDocument(DEUTSCHE_BANK) for settlements", () => {
  it("parses a buy end to end with document type trade", () => {
    expect(parseDocument("DEUTSCHE_BANK", fixture("buy.txt"))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        {
          type: "BUY",
          date: "2026-10-08",
          isin: "IE00MUST0015",
          name: "MUSTER WORLD EQUITY UCITS ETF",
          quantity: "12.5",
          price: "80.4",
          amount: "1005",
          fee: "7.9",
          tax: "0",
        },
      ],
    });
  });

  it("parses every execution of a multi-execution document", () => {
    const result = parseDocument("DEUTSCHE_BANK", fixture("multi-execution.txt"));
    expect(result).toMatchObject({ status: "PARSED", documentType: "trade" });
    expect(result.status === "PARSED" && result.proposals.map((p) => p.type)).toEqual(["BUY", "BUY", "SELL"]);
  });

  it.each([
    ["trade-foreign.txt", `Abrechnung in Fremdwährung (USD) wird nicht unterstützt. ${MANUAL}`],
    ["trade-missing-isin.txt", `ISIN nicht lesbar. ${MANUAL}`],
    ["storno.txt", `Stornierte Abrechnung wird nicht automatisch übernommen. ${MANUAL}`],
    ["vorabpauschale.txt", UNRECOGNIZED_REASON],
  ])("fails %s with its reason", (name, reason) => {
    expect(parseDocument("DEUTSCHE_BANK", fixture(name))).toEqual({ status: "FAILED", reason });
  });

  it("leaves a DVAG savings-plan statement (WKN only) unrecognized", () => {
    const text = [
      "Deutsche Bank AG",
      "Ihr db AnsparPlan - Abrechnung für den Zeitraum 01.10.2026 bis 31.10.2026",
      "WKN MUS001 MUSTER WORLD EQUITY UCITS ETF",
      "Kauf 01.10.2026 Anteile 1,2345 Kurs 81,00 EUR Betrag 100,00 EUR",
    ].join("\n");
    expect(parseDocument("DEUTSCHE_BANK", text)).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
  });

  it("leaves a Kontoauszug unrecognized", () => {
    const text = "Deutsche Bank AG\nKontoauszug vom 01.10.2026 bis 31.10.2026\nAlter Saldo EUR 1.000,00\nNeuer Saldo EUR 1.100,00\n";
    expect(parseDocument("DEUTSCHE_BANK", text)).toEqual({ status: "FAILED", reason: UNRECOGNIZED_REASON });
  });
});

describe("parseDeutscheBankTrade on the real (value-first) unpdf layout", () => {
  it("reads a real buy", () => {
    expect(parseDocument("DEUTSCHE_BANK", fixture("real-buy.txt"))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [
        {
          type: "BUY",
          date: "2026-03-16",
          isin: "IE00BK5BQT80",
          name: "VANGUARD FTSE ALL-WORLD U.ETF REG.SHS USD ACC",
          quantity: "3.1415",
          price: "98.765432",
          amount: "310.27",
          fee: "0",
          tax: "0",
        },
      ],
    });
  });

  it.each([
    ["real-sell-loss.txt", "IE00B4L5Y983", "ISHSIII-CORE MSCI WORLD USD(ACC) FUNDS", "4.2", "61.25", "257.25"],
    ["real-sell-gain.txt", "IE00BJ0KDQ92", "XTR.(IE)-MSCI WORLD 1C FUNDS", "1.75", "112.4", "196.7"],
  ])("reads a real sell (%s); informational tax lines are not taxes", (file, isin, name, quantity, price, amount) => {
    expect(parseDocument("DEUTSCHE_BANK", fixture(file))).toEqual({
      status: "PARSED",
      documentType: "trade",
      proposals: [{ type: "SELL", date: "2026-03-16", isin, name, quantity, price, amount, fee: "0", tax: "0" }],
    });
  });

  it("derives a fee from a booked total above the Kurswert", () => {
    const text = fixture("real-buy.txt").replace("Belastung\n310,27EUR", "Belastung\n312,27EUR");
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ type: "BUY", amount: "310.27", fee: "2", tax: "0" })]);
  });

  it("keeps names with leading or trailing digits", () => {
    const text = fixture("real-buy.txt").replace(
      "1/1VANGUARD FTSE ALL-WORLD U.ETF REG.SHS USD ACC1234567 10010",
      "1/13M CO. ANL. 2030 FUNDS 20301234567 10010",
    );
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ name: "3M CO. ANL. 2030 FUNDS 2030" })]);
  });

  it("does not read a compound of a tax label as tax", () => {
    const text = fixture("real-sell-gain.txt").replace("- keine Steuerbescheinigung -", "17,22EURKapitalertragsteuerpflichtiger Gewinn");
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ type: "SELL", fee: "0", tax: "0" })]);
  });

  it("reads value-first withheld taxes as tax paid", () => {
    const text = fixture("real-sell-gain.txt")
      .replace("Gutschrift\n196,70EUR", "Gutschrift\n191,49EUR")
      .replace("- keine Steuerbescheinigung -", "4,94EURKapitalertragsteuer\n0,27EURSolidaritätszuschlag");
    expect(parseDeutscheBankTrade(text)).toEqual([expect.objectContaining({ type: "SELL", amount: "196.7", fee: "0", tax: "5.21" })]);
  });

  it("fails rather than booking an unreadable value-first tax line as a fee", () => {
    const text = fixture("real-sell-gain.txt").replace("- keine Steuerbescheinigung -", "4,94EUR auf Kapitalertragsteuer");
    expect(parseDeutscheBankTrade(text)).toEqual({ error: "invalid", message: expect.stringContaining("Steuerbetrag") });
  });

  it("fails a foreign-currency value-first tax line", () => {
    const text = fixture("real-sell-gain.txt").replace("- keine Steuerbescheinigung -", "4,94USDKapitalertragsteuer");
    expect(parseDeutscheBankTrade(text)).toEqual({ error: "invalid", message: expect.stringContaining("Fremdwährung") });
  });
});
