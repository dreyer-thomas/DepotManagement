import { beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderText } from "../../../../test/helpers/render-text";

const listDepots = vi.hoisted(() => vi.fn());
const listPositions = vi.hoisted(() => vi.fn());
const listClassifications = vi.hoisted(() => vi.fn());
const latestStoredPrices = vi.hoisted(() => vi.fn());
const storedPriceHistory = vi.hoisted(() => vi.fn());
const returnSeries = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/modules/ledger", () => ({ listDepots, listPositions, returnSeries }));
vi.mock("@/modules/classification", () => ({ listClassifications }));
vi.mock("@/modules/prices", () => ({ latestStoredPrices, storedPriceHistory }));

import { DIMENSIONS } from "@/core/classification";
import { AllocationView, type AllocationViewProps } from "@/app/_components/analyses/AllocationView";
import { AnalysisFilters } from "@/app/_components/analyses/AnalysisFilters";
import { AnalysisTabs } from "@/app/_components/analyses/AnalysisTabs";
import { ReturnHeatmap, type ReturnHeatmapProps } from "@/app/_components/analyses/ReturnHeatmap";
import { returnHeatmap } from "@/core/return-heatmap";
import { renderHtml } from "../../../../test/helpers/render-text";
import AnalysesPage, { metadata } from "./page";

const TODAY = "2026-10-26";

type Depot = { id: string; name: string; archived: boolean; cashBalance: string };

function depot(id: string, name: string, cashBalance = "0", archived = false): Depot {
  return { id, name, archived, cashBalance };
}

function position(id: string, name: string, assetType: string, value: string | null) {
  return { security: { id, name, assetType }, value };
}

function classification(type: string, values: Partial<Record<(typeof DIMENSIONS)[number], { value: string | null; manual?: string }>>) {
  const base = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const entry = values[d];
      const value = entry?.manual ?? entry?.value ?? null;
      return [d, { value, source: null, manual: entry?.manual ?? null, automatic: { value: entry?.value ?? null, source: null } }];
    }),
  );
  return { ...base, type };
}

async function page(params: Record<string, string> = {}) {
  return AnalysesPage({ searchParams: Promise.resolve(params) });
}

function viewProps(tree: unknown): AllocationViewProps {
  const view = findElement(tree, AllocationView);
  if (!view) throw new Error("no AllocationView");
  return view.props as unknown as AllocationViewProps;
}

const brief = (props: AllocationViewProps) => props.segments.map((s) => [s.label, s.amount, s.displayShare]);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(`${TODAY}T10:00:00.000Z`), toFake: ["Date"] });
  listDepots.mockReset();
  listPositions.mockReset();
  listClassifications.mockReset();
  returnSeries.mockReset();
  listDepots.mockResolvedValue([depot("a", "Hauptdepot", "100"), depot("b", "Zweitdepot", "0"), depot("z", "Altdepot", "0", true)]);
  listPositions.mockImplementation(async (depotId: string) =>
    depotId === "a"
      ? [position("sap", "SAP SE", "STOCK", "600"), position("etf", "Welt ETF", "ETF", "300"), position("np", "Ohne Kurs", "STOCK", null)]
      : depotId === "b"
        ? [position("sap", "SAP SE", "STOCK", "200"), position("u", "Unbekannt AG", "UNCLASSIFIED", "100")]
        : [],
  );
  listClassifications.mockResolvedValue({
    sap: classification("STOCK", { assetClass: { value: "Aktien" }, sector: { value: "Technologie" }, region: { value: "Europa", manual: "Welt" }, companySize: { value: "Large Cap" } }),
    etf: classification("ETF", { assetClass: { value: "Gemischt" }, companySize: { value: "–" }, region: { value: "Welt" } }),
    u: classification("UNCLASSIFIED", {}),
    np: classification("STOCK", { sector: { value: "Energie" } }),
  });
});

describe("Analyses page", () => {
  it("is titled Analysen", () => {
    expect(metadata.title).toBe("Analysen");
  });

  it("defaults to the Portfolio by asset class and reads today's Positions with stored Prices of non-archived Depots", async () => {
    const tree = await page();
    expect(listPositions.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
    expect(listPositions).toHaveBeenCalledWith("a", TODAY, undefined, { storedPrices: latestStoredPrices });
    const props = viewProps(tree);
    expect(props).toMatchObject({ scope: "portfolio", dimensionLabel: "Anlageklasse", showDepot: true });
    expect(brief(props)).toEqual([
      ["Aktien", "800", "0.615"],
      ["Gemischt", "300", "0.231"],
      ["Unbekannt", "100", "0.077"],
      ["Guthaben", "100", "0.077"],
    ]);
    const filters = findElement(tree, AnalysisFilters);
    expect(filters?.props).toMatchObject({ tab: "allocation", scope: "portfolio", dimension: "assetClass" });
    expect(returnSeries).not.toHaveBeenCalled();
    expect((filters?.props.depots as { id: string }[]).map((d) => d.id)).toEqual(["a", "b"]);
    expect(renderText(tree)).toContain("Analysen");
  });

  it("renders the tab bar keeping scope and dimension, labelling the panel", async () => {
    const tree = await page({ scope: "b", dimension: "region" });
    expect(findElement(tree, AnalysisTabs)?.props).toMatchObject({ value: "allocation", scope: "b", dimension: "region" });
    const html = renderHtml(tree);
    expect(html).toContain('href="/analyses?tab=allocation&amp;scope=b&amp;dimension=region"');
    const tabId = /role="tab"[^>]*id="([^"]+)"|id="([^"]+)"[^>]*role="tab"/.exec(html);
    const id = tabId?.[1] ?? tabId?.[2];
    expect(id).toBe("analysis-tab-allocation");
    expect(html).toContain(`role="tabpanel" id="analysis-tabpanel-allocation" aria-labelledby="${id}"`);
  });

  it("merges a sector across Depots and leaves out unpriced Positions", async () => {
    const props = viewProps(await page({ dimension: "sector" }));
    expect(brief(props)).toEqual([
      ["Technologie", "800", "0.615"],
      ["Unbekannt", "400", "0.308"],
      ["Guthaben", "100", "0.077"],
    ]);
    expect(props.positions["group:Technologie"].map((p) => [p.depotName, p.value])).toEqual([
      ["Hauptdepot", "600"],
      ["Zweitdepot", "200"],
    ]);
    expect(Object.values(props.positions).flat().some((p) => p.securityId === "np")).toBe(false);
  });

  it("uses manual values, type labels and Nicht zutreffend", async () => {
    expect(brief(viewProps(await page({ dimension: "region" }))).map((s) => s[0])).toEqual(["Welt", "Unbekannt", "Guthaben"]);
    expect(brief(viewProps(await page({ dimension: "region" })))[0][1]).toBe("1100");
    expect(brief(viewProps(await page({ dimension: "type" }))).map((s) => s[0])).toEqual(["Aktie", "ETF", "Unbekannt", "Guthaben"]);
    expect(brief(viewProps(await page({ dimension: "companySize" }))).map((s) => s[0])).toEqual([
      "Large Cap",
      "Nicht zutreffend",
      "Unbekannt",
      "Guthaben",
    ]);
  });

  it("limits the scope to one Depot without Depot names", async () => {
    const tree = await page({ scope: "a", dimension: "sector" });
    expect(listPositions.mock.calls.map((call) => call[0])).toEqual(["a"]);
    const props = viewProps(tree);
    expect(props).toMatchObject({ scope: "a", showDepot: false });
    expect(brief(props)).toEqual([
      ["Technologie", "600", "0.600"],
      ["Unbekannt", "300", "0.300"],
      ["Guthaben", "100", "0.100"],
    ]);
  });

  it("falls back to the Portfolio and Anlageklasse on bad or archived parameters", async () => {
    for (const params of [{ scope: "unknown", dimension: "foo" }, { scope: "z" }] as Record<string, string>[]) {
      const tree = await page(params);
      expect(findElement(tree, AnalysisFilters)?.props).toMatchObject({ scope: "portfolio", dimension: "assetClass" });
    }
  });

  it("shows the empty text when nothing is held", async () => {
    listPositions.mockResolvedValue([]);
    listDepots.mockResolvedValue([depot("a", "Hauptdepot", "0")]);
    const tree = await page();
    expect(viewProps(tree).segments).toEqual([]);
    expect(renderText(tree)).toContain("Keine Werte vorhanden.");
  });

  it("links to the Depots without an active Depot", async () => {
    listDepots.mockResolvedValue([]);
    let text = renderText(await page());
    expect(text).toContain("Noch kein Depot.");
    expect(text).toContain("Zu den Depots");
    listDepots.mockResolvedValue([depot("z", "Altdepot", "0", true)]);
    text = renderText(await page());
    expect(text).toContain("Alle Depots sind archiviert.");
    expect(listPositions).not.toHaveBeenCalled();
  });
  describe("Rendite tab", () => {
    const point = (date: string, value: string) => ({ date, value, positionsValue: "0", cash: value, investedCapital: "0" });
    const row = (type: string, date: string, amount: string) => ({ securityId: null, type, date, sequence: 1, quantity: null, price: null, amount, fee: "0", tax: "0" });
    const SERIES = {
      start: point("2026-09-30", "0"),
      // 01.–26.10. (today), a gain on the last day.
      series: Array.from({ length: 26 }, (_, i) => point(`2026-10-${String(i + 1).padStart(2, "0")}`, i === 25 ? "1050" : "1000")),
      rows: [row("DEPOSIT", "2026-10-01", "1000")],
    };

    it("loads the scope's MAX series with the stored price history and renders the heatmap without allocation data", async () => {
      returnSeries.mockResolvedValue(SERIES);
      const tree = await page({ tab: "returns", scope: "b", dimension: "sector" });
      expect(returnSeries).toHaveBeenCalledWith({ depotId: "b" }, TODAY, undefined, { storedPrices: storedPriceHistory });
      expect(listPositions).not.toHaveBeenCalled();
      expect(listClassifications).not.toHaveBeenCalled();
      const props = findElement(tree, ReturnHeatmap)?.props as unknown as ReturnHeatmapProps;
      expect(props.scope).toBe("b");
      expect(props.years).toEqual(returnHeatmap(SERIES.start, SERIES.series, SERIES.rows, TODAY));
      expect(props.years[0].months[9]).toMatchObject({ month: "2026-10", running: true });
      expect(findElement(tree, AnalysisFilters)?.props).toMatchObject({ tab: "returns", scope: "b", dimension: "sector" });
      expect(findElement(tree, AnalysisTabs)?.props).toMatchObject({ value: "returns", scope: "b", dimension: "sector" });
      expect(findElement(tree, AllocationView)).toBeFalsy();
      const html = renderHtml(tree);
      expect(html).toContain('role="tabpanel" id="analysis-tabpanel-returns"');
      expect(html).toContain('href="/analyses?tab=allocation&amp;scope=b&amp;dimension=sector"');
      expect(html).not.toContain(">Dimension<");
    });

    it("uses the Portfolio scope by default", async () => {
      returnSeries.mockResolvedValue(SERIES);
      await page({ tab: "returns" });
      expect(returnSeries).toHaveBeenCalledWith("portfolio", TODAY, undefined, { storedPrices: storedPriceHistory });
    });

    it("shows the empty text without Transactions", async () => {
      returnSeries.mockResolvedValue({ start: point("2026-10-25", "0"), series: [point(TODAY, "0")], rows: [] });
      expect(renderText(await page({ tab: "returns" }))).toContain("Noch keine Transaktionen.");
    });
  });
});
