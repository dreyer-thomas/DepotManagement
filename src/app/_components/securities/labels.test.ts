import { describe, expect, it } from "vitest";
import { effective, emptyLayer, emptyManual } from "@/core/classification";
import {
  automaticLabel,
  classificationErrorField,
  classificationErrorMessage,
  classificationSummary,
  mappingLabel,
  resolveFailedMessage,
  typeOptions,
} from "./labels";

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

describe("classification labels", () => {
  const automatic = emptyLayer();
  automatic.assetClass = { value: "Aktien", source: "RULE" };
  automatic.sector = { value: "Technologie", source: "PROVIDER" };
  const classification = effective({ automatic, manual: { ...emptyManual(), country: "Deutschland" } }, "STOCK");

  it("summarises asset class, sector, region, country, company size and currency", () => {
    expect(classificationSummary(classification)).toBe("Aktien · Technologie · Unbekannt · Deutschland · Unbekannt · Unbekannt");
    expect(classificationSummary(undefined)).toBe("Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt · Unbekannt");
  });

  it("names the automatic value and its source", () => {
    expect(automaticLabel(classification.sector)).toBe("Automatisch: Technologie (Yahoo)");
    expect(automaticLabel(classification.assetClass)).toBe("Automatisch: Aktien (Regel)");
    expect(automaticLabel(classification.country)).toBe("Automatisch: Unbekannt");
  });

  it("maps failure reasons to fields and German messages", () => {
    expect(classificationErrorField("region-invalid")).toBe("region");
    expect(classificationErrorField("not-found")).toBeNull();
    expect(classificationErrorMessage("region-invalid")).toBe("Bitte eine Region aus der Liste wählen.");
  });
});
