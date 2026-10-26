import { describe, expect, it } from "vitest";
import { mappingLabel, resolveFailedMessage, typeOptions } from "./labels";

describe("mappingLabel", () => {
  it("names provider and symbol, the not-found marker, or the pending state", () => {
    expect(mappingLabel({ provider: "YAHOO", symbol: "SAP.DE", origin: "AUTO", fetchError: null })).toBe("Yahoo Finance · SAP.DE");
    expect(mappingLabel({ provider: "COINGECKO", symbol: "bitcoin", origin: "MANUAL", fetchError: null })).toBe("CoinGecko · bitcoin");
    expect(mappingLabel({ provider: null, symbol: null, origin: "AUTO", fetchError: null })).toBe("Keine Kursquelle gefunden");
    expect(mappingLabel(null)).toBe("Kursquelle noch nicht ermittelt");
  });
});

describe("typeOptions", () => {
  it("never offers UNCLASSIFIED", () => {
    expect(typeOptions(["STOCK", "UNCLASSIFIED", "CRYPTO"])).toEqual([
      { value: "STOCK", label: "Aktie" },
      { value: "CRYPTO", label: "Krypto" },
    ]);
  });
});

describe("resolveFailedMessage", () => {
  it("names one or several Securities", () => {
    expect(resolveFailedMessage(["SAP"])).toBe("Für SAP konnte die Kursquelle gerade nicht ermittelt werden.");
    expect(resolveFailedMessage(["SAP", "Bitcoin"])).toBe(
      "Für 2 Wertpapiere konnte die Kursquelle gerade nicht ermittelt werden: SAP, Bitcoin.",
    );
  });
});
