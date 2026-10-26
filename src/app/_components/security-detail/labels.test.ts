import { describe, expect, it } from "vitest";
import { depotLabel, heroLabel, percentOrMissing, ratioTone, securityCaption, securityHref, signedMoneyOrMissing } from "./labels";

describe("security detail labels", () => {
  it("builds the Security page URL with an optional Depot", () => {
    expect(securityHref("s1")).toBe("/securities/s1");
    expect(securityHref("s1", "d 1")).toBe("/securities/s1?depot=d%201");
    expect(securityHref("s1", null)).toBe("/securities/s1");
  });

  it("captions ISIN or crypto symbol with the asset type", () => {
    expect(securityCaption({ isin: "IE00B4L5Y983", cryptoSymbol: null, assetType: "ETF" })).toBe("IE00B4L5Y983 · ETF");
    expect(securityCaption({ isin: null, cryptoSymbol: "BTC", assetType: "CRYPTO" })).toBe("BTC · Krypto");
  });

  it("labels the hero with quantity and price", () => {
    expect(heroLabel("310", "112.46")).toBe("Wert · 310 Stück à 112,46 €");
    expect(heroLabel("0", null)).toBe("Wert · 0 Stück");
  });

  it("marks archived Depots", () => {
    expect(depotLabel({ name: "Alt", archived: true })).toBe("Alt (archiviert)");
    expect(depotLabel({ name: "Neu", archived: false })).toBe("Neu");
  });

  it("formats all-time figures or –", () => {
    expect(signedMoneyOrMissing("198")).toBe("+198,00\u00a0€");
    expect(signedMoneyOrMissing(null)).toBe("–");
    expect(percentOrMissing("-0.05")).toBe("-5,00\u00a0%");
    expect(percentOrMissing(null)).toBe("–");
  });

  it("gives a ratio its tone as displayed", () => {
    expect(ratioTone("0.1978")).toBe("gain");
    expect(ratioTone("-0.01")).toBe("loss");
    expect(ratioTone("0.00004")).toBeNull();
    expect(ratioTone(null)).toBeNull();
  });
});
