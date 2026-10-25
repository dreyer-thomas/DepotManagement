import { describe, expect, it } from "vitest";
import { classifySecurityName } from "./asset-type";

describe("classifySecurityName", () => {
  it.each([
    "AB SICAV I Concentrated US Equity Portfolio",
    "BlackRock Global Funds European Special Situations Fund",
    "Fidelity Funds - USD Bond Fund",
    "DWS Fonds Konzept",
  ])("estimates %j as FUND", (name) => {
    expect(classifySecurityName(name)).toBe("FUND");
  });

  it.each([
    "iShares Developed Markets Property Yield UCITS ETF",
    "Xtrackers Physical Gold ETC",
    "Vanguard FTSE All-World",
    "WisdomTree Copper ETN",
    "Welt ETF",
    "Amundi Index Solutions - MSCI World Fund",
  ])("estimates %j as ETF", (name) => {
    expect(classifySecurityName(name)).toBe("ETF");
  });

  it.each(["Turbo Long Open End auf DAX", "Mini Future Short", "Knock-Out Call", "Knock Out Put", "Optionsschein auf Gold", "Open-End Turbo"])(
    "estimates %j as CERTIFICATE",
    (name) => {
      expect(classifySecurityName(name)).toBe("CERTIFICATE");
    },
  );

  it.each(["Apple Inc.", "Siemens AG", "Fletcher Building", "Etcetera Holdings", "Fundamenta AG", "Netflix", "", "DE0007164600"])(
    "estimates %j as STOCK",
    (name) => {
      expect(classifySecurityName(name)).toBe("STOCK");
    },
  );

  it("is case-insensitive", () => {
    expect(classifySecurityName("ishares core msci world ucits etf")).toBe("ETF");
    expect(classifySecurityName("TURBO LONG")).toBe("CERTIFICATE");
    expect(classifySecurityName("global FUNDS")).toBe("FUND");
  });
});
