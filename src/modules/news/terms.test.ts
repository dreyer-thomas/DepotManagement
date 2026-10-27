import { describe, expect, it } from "vitest";
import { mentionsSecurity, newsTerm, yahooSymbol } from "./terms";

describe("newsTerm", () => {
  it.each([
    ["SAP SE", "SAP"],
    ["Siemens AG", "Siemens"],
    ["Henkel AG & Co. KGaA", "Henkel"],
    ["Apple Inc.", "Apple"],
    ["Microsoft Corporation", "Microsoft"],
    ["NVIDIA Corp", "NVIDIA"],
    ["Unilever PLC", "Unilever"],
    ["ASML Holding N.V.", "ASML"],
    ["Airbus SE", "Airbus"],
    ["Banco Santander, S.A.", "Banco Santander"],
    ["Muster GmbH & Co. KG", "Muster"],
    ["Novo Nordisk A/S", "Novo Nordisk"],
    ["Equinor ASA", "Equinor"],
    ["Volvo AB", "Volvo"],
    ["Nokia Oyj", "Nokia"],
    ["Ferrari S.p.A.", "Ferrari"],
    ["Beispiel LLC", "Beispiel"],
    ["Muster Aktiengesellschaft", "Muster"],
    ["Example Limited", "Example"],
    ["Beispiel Holdings Ltd.", "Beispiel"],
    ["  Deutsche   Telekom  AG ", "Deutsche Telekom"],
    ["iShares Core MSCI World UCITS ETF USD (Acc)", "iShares Core MSCI World UCITS ETF USD (Acc)"],
    ["Bitcoin", "Bitcoin"],
    ["AG", "AG"],
    ["Holding SE", "Holding SE"],
  ])("%s → %s", (name, term) => {
    expect(newsTerm(name)).toBe(term);
  });
});

describe("yahooSymbol", () => {
  const yahoo = (symbol: string) => ({ provider: "YAHOO", symbol });
  it.each([
    ["STOCK with a Yahoo mapping", { assetType: "STOCK", cryptoSymbol: null, mapping: yahoo("SAP.DE") }, "SAP.DE"],
    ["UNCLASSIFIED with a Yahoo mapping", { assetType: "UNCLASSIFIED", cryptoSymbol: null, mapping: yahoo("ABC.F") }, "ABC.F"],
    ["STOCK without a mapping", { assetType: "STOCK", cryptoSymbol: null, mapping: null }, undefined],
    ["STOCK with an onvista mapping", { assetType: "STOCK", cryptoSymbol: null, mapping: { provider: "ONVISTA", symbol: "123" } }, undefined],
    ["ETF with a Yahoo mapping", { assetType: "ETF", cryptoSymbol: null, mapping: yahoo("EUNL.DE") }, undefined],
    ["FUND with a Yahoo mapping", { assetType: "FUND", cryptoSymbol: null, mapping: yahoo("FND.DE") }, undefined],
    ["CERTIFICATE with a Yahoo mapping", { assetType: "CERTIFICATE", cryptoSymbol: null, mapping: yahoo("CRT.DE") }, undefined],
    ["CRYPTO with a CoinGecko mapping", { assetType: "CRYPTO", cryptoSymbol: "btc", mapping: { provider: "COINGECKO", symbol: "bitcoin" } }, "BTC-EUR"],
    ["CRYPTO with a Yahoo mapping", { assetType: "CRYPTO", cryptoSymbol: "BTC", mapping: yahoo("BTC-USD") }, "BTC-USD"],
    ["CRYPTO without a symbol", { assetType: "CRYPTO", cryptoSymbol: null, mapping: null }, undefined],
  ])("%s", (_, security, symbol) => {
    expect(yahooSymbol(security)).toBe(symbol);
  });
});

describe("mentionsSecurity", () => {
  it("matches the name term case-insensitively as a whole word", () => {
    expect(mentionsSecurity("Analysten loben sap und Partner", "SAP SE", "SAP.DE")).toBe(true);
    expect(mentionsSecurity("Deutsche Telekom erhöht Dividende", "Deutsche Telekom AG", "DTE.DE")).toBe(true);
    expect(mentionsSecurity("Ausblick für Bayer-Aktie", "Bayer AG", "BAYN.DE")).toBe(true);
    expect(mentionsSecurity("Ölpreis steigt; Münchener Rück im Plus", "Münchener Rück AG", "MUV2.DE")).toBe(true);
  });

  it("matches the symbol base case-sensitively as a whole word", () => {
    expect(mentionsSecurity("BTC steigt über Marke", "Bitcoin", "BTC-EUR")).toBe(true);
    expect(mentionsSecurity("btc steigt", "Bitcoin", "BTC-EUR")).toBe(false);
    expect(mentionsSecurity("DTE meldet Zahlen", "Deutsche Telekom AG", "DTE.DE")).toBe(true);
  });

  it("rejects text without the term or symbol, and partial words", () => {
    expect(mentionsSecurity("Märkte schließen im Minus", "SAP SE", "SAP.DE")).toBe(false);
    expect(mentionsSecurity("Sapporo-Brauerei wächst", "SAP SE", "SAP.DE")).toBe(false);
    expect(mentionsSecurity("Bitcoins gefragt", "Bitcoin", "XBT-EUR")).toBe(false);
    expect(mentionsSecurity("Ölmühle Ülm", "Öl", "")).toBe(false);
  });
});
