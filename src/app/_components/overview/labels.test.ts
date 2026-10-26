import { describe, expect, it } from "vitest";
import type { PositionRecord } from "@/modules/ledger";
import { positionCaption, quantityText, ratioTone, staleAlertText, topPositions } from "./labels";

function position(name: string, value: string | null, extra: Partial<PositionRecord["security"]> = {}, quantity = "310"): PositionRecord {
  return {
    quantity,
    costBasis: "100",
    averagePrice: "1",
    price: value,
    priceDate: value === null ? null : "2026-10-26",
    priceSource: value === null ? null : "transaction",
    priceFetchedAt: null,
    priceProvider: null,
    value,
    gain: null,
    gainRatio: null,
    security: { id: name, name, isin: null, cryptoSymbol: null, assetType: "ETF", ...extra },
  };
}

describe("staleAlertText", () => {
  it("counts the stale Securities, singular for one", () => {
    expect(staleAlertText(1)).toBe("Kurs für 1 Wertpapier veraltet.");
    expect(staleAlertText(2)).toBe("Kurse für 2 Wertpapiere veraltet.");
  });
});

describe("topPositions", () => {
  it("ranks by value descending, Positions without a price last, and keeps the top five", () => {
    const entries = [
      { depotId: "A", depotName: "A", position: position("none", null) },
      { depotId: "A", depotName: "A", position: position("p10", "10") },
      { depotId: "B", depotName: "B", position: position("p9.99", "9.99") },
      { depotId: "B", depotName: "B", position: position("p100", "100") },
      { depotId: "A", depotName: "A", position: position("p2", "2") },
      { depotId: "A", depotName: "A", position: position("p1", "1") },
    ];
    expect(topPositions(entries).map((entry) => entry.position.security.name)).toEqual(["p100", "p10", "p9.99", "p2", "p1"]);
    expect(topPositions(entries, 10).at(-1)!.position.security.name).toBe("none");
  });
});

describe("positionCaption", () => {
  it("shows asset type, Depot and quantity; crypto in its symbol", () => {
    expect(positionCaption({ depotId: "comdirect", depotName: "comdirect", position: position("ETF", "1") })).toBe("ETF · comdirect · 310 Stück");
    const btc = position("Bitcoin", "1", { assetType: "CRYPTO", cryptoSymbol: "BTC" }, "0.06512");
    expect(quantityText(btc)).toBe("0,06512 BTC");
    expect(positionCaption({ depotId: "ZERO", depotName: "ZERO", position: btc })).toBe("Krypto · ZERO · 0,06512 BTC");
  });
});

describe("ratioTone", () => {
  it("follows the displayed percentage", () => {
    expect(ratioTone("0.1142")).toBe("gain");
    expect(ratioTone("-0.0102")).toBe("loss");
    expect(ratioTone("0.00004")).toBeNull();
    expect(ratioTone("-0.00004")).toBeNull();
  });
});
