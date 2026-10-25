import { describe, expect, it } from "vitest";
import { renderText } from "../../../../test/helpers/render-text";
import type { PositionRecord } from "@/modules/ledger";
import { PositionsTable } from "./PositionsTable";

const position = (name: string, fields: Partial<PositionRecord>): PositionRecord => ({
  security: { id: name, name, isin: null, cryptoSymbol: name.toUpperCase(), assetType: "CRYPTO" },
  quantity: "2",
  costBasis: "200",
  averagePrice: "100",
  price: null,
  priceDate: null,
  value: null,
  gain: null,
  gainRatio: null,
  ...fields,
});

describe("PositionsTable", () => {
  it("shows – for Kurs, Wert and G/V without a price and sorts it last", () => {
    const rows = [
      position("Ohnepreis", {}),
      position("Mitpreis", { price: "100", value: "200", gain: "0", gainRatio: "0" }),
    ];
    const text = renderText(<PositionsTable positions={rows} />);
    expect(text).toContain("Ohnepreis 2 200,00 € 100,00 € – – –");
    expect(text).toMatch(/Mitpreis .*Ohnepreis/);
  });

  it("shows a loss with its signed amount and percentage", () => {
    const rows = [position("X", { price: "90", value: "180", gain: "-20", gainRatio: "-0.1" })];
    expect(renderText(<PositionsTable positions={rows} />)).toContain("-20,00\u00a0€ · -10,00\u00a0%");
  });
});
