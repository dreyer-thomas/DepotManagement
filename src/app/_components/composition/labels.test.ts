import { describe, expect, it } from "vitest";
import type { CompositionSegment } from "@/core/composition";
import type { PositionRecord } from "@/modules/ledger";
import { COMPOSITION_LABELS, compositionAriaLabel, compositionHoldings, segmentColorKeys } from "./labels";

function segment(label: string, kind: CompositionSegment["kind"], amount: string, displayShare: string): CompositionSegment {
  return { key: label, kind, label, amount, share: displayShare, displayShare };
}

describe("COMPOSITION_LABELS", () => {
  it("labels Sonstige, Guthaben and every asset type, UNCLASSIFIED as Unklassifiziert", () => {
    expect(COMPOSITION_LABELS.other).toBe("Sonstige");
    expect(COMPOSITION_LABELS.cash).toBe("Guthaben");
    expect(["ETF", "FUND", "STOCK", "CERTIFICATE", "CRYPTO", "UNCLASSIFIED"].map(COMPOSITION_LABELS.assetType)).toEqual([
      "ETF",
      "Fonds",
      "Aktie",
      "Zertifikat",
      "Krypto",
      "Unklassifiziert",
    ]);
  });
});

describe("compositionAriaLabel", () => {
  it("lists every segment with display share and amount", () => {
    const label = compositionAriaLabel("Typ", [segment("ETF", "item", "600", "0.600"), segment("Guthaben", "cash", "50.5", "0.050")]);
    expect(label).toBe("Zusammensetzung nach Typ: ETF 60,0 % (600,00 €), Guthaben 5,0 % (50,50 €)");
  });
});

describe("segmentColorKeys", () => {
  it("cycles series 1–5 over non-cash segments and gives cash the cash color", () => {
    const segments = [...Array.from({ length: 6 }, (_, i) => segment(`s${i}`, "item", "1", "0.1")), segment("Sonstige", "other", "1", "0.1"), segment("Guthaben", "cash", "1", "0.1")];
    expect(segmentColorKeys(segments)).toEqual(["series1", "series2", "series3", "series4", "series5", "series1", "series2", "cash"]);
  });
});

describe("compositionHoldings", () => {
  it("maps priced Positions and leaves out those without a value", () => {
    const base = { quantity: "1", costBasis: "1", averagePrice: "1", priceDate: null, priceSource: null, priceFetchedAt: null, priceProvider: null, gain: null, gainRatio: null };
    const positions = [
      { ...base, price: "10", value: "10", security: { id: "x", name: "X AG", isin: null, cryptoSymbol: null, assetType: "STOCK" } },
      { ...base, price: null, value: null, security: { id: "y", name: "Y AG", isin: null, cryptoSymbol: null, assetType: "ETF" } },
    ] as PositionRecord[];
    expect(compositionHoldings({ id: "d", name: "Depot" }, positions)).toEqual([
      { securityId: "x", securityName: "X AG", assetType: "STOCK", depotId: "d", depotName: "Depot", value: "10" },
    ]);
  });
});
