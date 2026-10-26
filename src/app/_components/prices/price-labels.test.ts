import { describe, expect, it } from "vitest";
import { fetchErrorText, priceDateText, priceSourceText, providerLabel, refreshResultText } from "./price-labels";

describe("price labels", () => {
  it("formats the date line, stale with an en dash", () => {
    expect(priceDateText("2026-10-24", false)).toBe("Kurs vom 24.10.2026");
    expect(priceDateText("2026-10-22", true)).toBe("Kurs vom 22.10.2026 – veraltet");
  });

  it("names the source and the Berlin fetch time", () => {
    const fetchedAt = "2026-10-23T18:05:00.000Z";
    expect(priceSourceText({ source: "provider", fetchedAt, provider: "YAHOO" })).toBe("Yahoo Finance · abgerufen 23.10.2026, 20:05");
    expect(priceSourceText({ source: "provider", fetchedAt, provider: "ONVISTA" })).toBe("onvista · abgerufen 23.10.2026, 20:05");
    expect(priceSourceText({ source: "provider", fetchedAt, provider: "COINGECKO" })).toBe("CoinGecko · abgerufen 23.10.2026, 20:05");
    expect(priceSourceText({ source: "manual", fetchedAt, provider: null })).toBe("Manuell eingetragen · 23.10.2026, 20:05");
    expect(priceSourceText({ source: "transaction", fetchedAt: null, provider: null })).toBe("Buchungskurs");
  });

  it("names the provider in the fetch error and the failed Securities in the refresh result", () => {
    expect(providerLabel("YAHOO")).toBe("Yahoo Finance");
    expect(fetchErrorText("YAHOO")).toBe("Kurs konnte nicht von Yahoo Finance geladen werden.");
    expect(refreshResultText([])).toBe("Kurse aktualisiert.");
    expect(refreshResultText(["SAP SE", "NVIDIA"])).toBe("Kurse aktualisiert. Fehlgeschlagen: SAP SE, NVIDIA");
  });
});
