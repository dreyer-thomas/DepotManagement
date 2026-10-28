import { describe, expect, it } from "vitest";
import { assetTypeFromFigi, matchSecurities } from "./tools";

describe("assetTypeFromFigi", () => {
  it.each([
    ["ETP", "Mutual Fund", "ETF"],
    ["Mutual Fund", "ETP", "ETF"],
    ["Common Stock", "Common Stock", "STOCK"],
    ["ADR", null, "STOCK"],
    ["GDR", null, "STOCK"],
    ["REIT", "Common Stock", "STOCK"],
    ["Preference", null, "STOCK"],
    ["Open-End Fund", "Mutual Fund", "FUND"],
    ["closed-end fund", null, "FUND"],
    ["Fund of Funds", null, "FUND"],
    [null, "Mutual Fund", "FUND"],
    ["Warrant", null, "CERTIFICATE"],
    ["Index Warrant", null, "CERTIFICATE"],
    ["Structured Product", null, "CERTIFICATE"],
    ["Certificate", null, "CERTIFICATE"],
    ["Unknown thing", "Common Stock", "STOCK"],
    ["Common Stock", "Warrant", "STOCK"],
    ["Corp Bond", null, null],
    [null, null, null],
  ] as const)("maps %j / %j to %j", (securityType, securityType2, expected) => {
    expect(assetTypeFromFigi({ securityType, securityType2 })).toBe(expected);
  });
});

describe("matchSecurities", () => {
  const securities = Array.from({ length: 25 }, (_, i) => ({ name: `Fonds ${String(i).padStart(2, "0")}`, isin: null, cryptoSymbol: null }));

  it("matches name, ISIN and crypto symbol case-insensitively as substrings", () => {
    const list = [
      { name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null },
      { name: "Bitcoin", isin: null, cryptoSymbol: "BTC" },
      { name: "Äpfel AG", isin: "US0378331005", cryptoSymbol: null },
    ];
    expect(matchSecurities(list, "sap").map((s) => s.name)).toEqual(["SAP SE"]);
    expect(matchSecurities(list, "de000716").map((s) => s.name)).toEqual(["SAP SE"]);
    expect(matchSecurities(list, " btc ").map((s) => s.name)).toEqual(["Bitcoin"]);
    expect(matchSecurities(list, "äPFEL").map((s) => s.name)).toEqual(["Äpfel AG"]);
    expect(matchSecurities(list, "xyz")).toEqual([]);
  });

  it("returns at most 20 in the given order", () => {
    const found = matchSecurities(securities, "fonds");
    expect(found).toHaveLength(20);
    expect(found[0].name).toBe("Fonds 00");
  });
});
