import { describe, expect, it } from "vitest";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";
import type { PositionRecord } from "@/modules/ledger";
import { PositionsTable } from "./PositionsTable";
import { POSITION_SORT_KEYS, type PositionSort } from "./sort-positions";

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
    const text = renderText(<PositionsTable positions={rows} cashBalance="0" />);
    expect(text).toContain("Ohnepreis 2 200,00 € 100,00 € – – –");
    expect(text).toMatch(/Mitpreis .*Ohnepreis/);
  });

  it("shows a loss with its signed amount and percentage", () => {
    const rows = [position("X", { price: "90", value: "180", gain: "-20", gainRatio: "-0.1" })];
    expect(renderText(<PositionsTable positions={rows} cashBalance="0" />)).toContain("-20,00\u00a0€ · -10,00\u00a0%");
  });

  const sorts: PositionSort[] = POSITION_SORT_KEYS.flatMap((key) => [
    { key, direction: "asc" as const },
    { key, direction: "desc" as const },
  ]);

  it.each(sorts)("pins the Cash row last in both layouts when sorted by $key $direction", (sort) => {
    const rows = [
      position("Alpha", { price: "100", value: "200", gain: "0", gainRatio: "0" }),
      position("Zulu", { price: "1000", value: "2000", gain: "1800", gainRatio: "9" }),
    ];
    const tree = <PositionsTable positions={rows} cashBalance="-731.1" initialSort={sort} />;
    const text = renderText(tree);
    // Desktop: wallet + label, value in the Wert column, other cells empty; after both Positions.
    expect(text).toMatch(/(Alpha|Zulu) .*(Alpha|Zulu) .*Cash-Konto -731,10\u00a0€ Sortieren nach/);
    // Phone: the last stacked row.
    expect(text).toMatch(/Cash-Konto -731,10\u00a0€$/);
    const html = renderHtml(tree);
    expect(html.match(/data-cash-row/g)).toHaveLength(2);
    expect(html).toMatch(/<tr[^>]*data-cash-row[^>]*>(?:<td[^>]*>(?:(?!<\/td>).)*<\/td>){5}<td[^>]*>-731,10\u00a0€<\/td><td[^>]*><\/td><\/tr><\/tbody>/);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="AccountBalanceWalletOutlinedIcon"/);
  });

  it("shows Keine offenen Positionen. above the pinned Cash row in both layouts without Positions", () => {
    const tree = <PositionsTable positions={[]} cashBalance="2000" />;
    const text = renderText(tree);
    expect(text).toMatch(/G\/V Keine offenen Positionen\. Cash-Konto 2\.000,00\u00a0€ Sortieren nach/);
    expect(text).toMatch(/Keine offenen Positionen\. Cash-Konto 2\.000,00\u00a0€$/);
    const html = renderHtml(tree);
    expect(html).toMatch(/<td[^>]*colSpan="7"[^>]*>Keine offenen Positionen\.<\/td>/i);
    expect(html.match(/data-cash-row/g)).toHaveLength(2);
  });
});
