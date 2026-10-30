import { describe, expect, it } from "vitest";
import {
  deleteManualPriceConfirmText,
  fetchErrorText,
  manualPriceErrorMessage,
  manualPriceInputText,
  manualPriceText,
  priceDateText,
  priceSourceText,
  providerLabel,
  refreshResultText,
} from "./price-labels";

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
    expect(fetchErrorText("YAHOO", "currency")).toBe(
      "Kurs konnte nicht von Yahoo Finance geladen werden. Keine Kurse in EUR für dieses Symbol. Bitte ein Symbol mit Börsenkürzel wählen, z. B. .DE (Xetra) oder .F (Frankfurt).",
    );
    expect(fetchErrorText("ONVISTA", "not-found")).toBe("Kurs konnte nicht von onvista geladen werden. Symbol unbekannt oder keine Kurse im Zeitraum.");
    expect(fetchErrorText("YAHOO", "network")).toBe(
      "Kurs konnte nicht von Yahoo Finance geladen werden. Anbieter nicht erreichbar, bitte später erneut versuchen.",
    );
    expect(fetchErrorText("YAHOO", "something-new")).toBe("Kurs konnte nicht von Yahoo Finance geladen werden.");
    expect(refreshResultText([])).toBe("Kurse aktualisiert.");
    expect(refreshResultText(["SAP SE", "NVIDIA"])).toBe("Kurse aktualisiert. Fehlgeschlagen: SAP SE, NVIDIA");
  });

  it("formats manual Prices with all stored decimals and the delete confirmation", () => {
    expect(manualPriceText("1234.5")).toBe("1.234,5\u00a0€");
    expect(manualPriceText("0.123456789")).toBe("0,123456789\u00a0€");
    expect(manualPriceText("1234567")).toBe("1.234.567\u00a0€");
    expect(manualPriceInputText("1234.5")).toBe("1234,5");
    expect(manualPriceInputText("12")).toBe("12");
    expect(deleteManualPriceConfirmText("2026-10-20", "SAP SE")).toBe("Manuellen Kurs vom 20.10.2026 für SAP SE löschen?");
    expect(manualPriceErrorMessage("date-taken")).toBe("Für dieses Datum gibt es bereits einen manuellen Kurs.");
  });
});
