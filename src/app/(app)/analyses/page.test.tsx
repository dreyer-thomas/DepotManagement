import { beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../../../test/helpers/next-mocks";
import { renderText } from "../../../../test/helpers/render-text";

const listDepots = vi.hoisted(() => vi.fn());
const listPositions = vi.hoisted(() => vi.fn());
const listClassifications = vi.hoisted(() => vi.fn());
const listRegionSplits = vi.hoisted(() => vi.fn());
const latestStoredPrices = vi.hoisted(() => vi.fn());
const storedPriceHistory = vi.hoisted(() => vi.fn());
const returnSeries = vi.hoisted(() => vi.fn());
const gainsInput = vi.hoisted(() => vi.fn());
const taxPreviewInput = vi.hoisted(() => vi.fn());
const getTargetAllocation = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/modules/ledger", () => ({ gainsInput, listDepots, listPositions, returnSeries }));
vi.mock("@/modules/classification", () => ({ listClassifications, listRegionSplits }));
vi.mock("@/modules/prices", () => ({ latestStoredPrices, storedPriceHistory }));
vi.mock("@/modules/tax", () => ({ taxPreviewInput }));
vi.mock("@/modules/rebalancing", () => ({ getTargetAllocation }));

import { DIMENSIONS } from "@/core/classification";
import { AllocationView, type AllocationViewProps } from "@/app/_components/analyses/AllocationView";
import { AnalysisFilters } from "@/app/_components/analyses/AnalysisFilters";
import { AnalysisTabs } from "@/app/_components/analyses/AnalysisTabs";
import { ReturnHeatmap, type ReturnHeatmapProps } from "@/app/_components/analyses/ReturnHeatmap";
import { GainsView, type GainsViewProps } from "@/app/_components/analyses/GainsView";
import { DividendsView, type DividendsViewProps } from "@/app/_components/analyses/DividendsView";
import { dividendAnalysis } from "@/core/dividend-analysis";
import { NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import { gainsAnalysis } from "@/core/gains-analysis";
import { returnHeatmap } from "@/core/return-heatmap";
import { taxPreview } from "@/core/tax";
import { TaxView } from "@/app/_components/tax/TaxView";
import { TargetAllocationView, type TargetAllocationViewProps } from "@/app/_components/rebalancing/TargetAllocationView";
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
  listRegionSplits.mockReset();
  listRegionSplits.mockResolvedValue({});
  returnSeries.mockReset();
  gainsInput.mockReset();
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

  it("distributes a fund with a region split over its regions by Region only", async () => {
    listRegionSplits.mockResolvedValue({
      etf: {
        effective: {
          weights: [
            { region: "USA", weight: "60" },
            { region: "Europa", weight: "40" },
          ],
          source: "manual",
          index: null,
          asOf: null,
        },
      },
    });
    const props = viewProps(await page({ scope: "a", dimension: "region" }));
    expect(brief(props)).toEqual([
      ["Welt", "600", "0.600"],
      ["USA", "180", "0.180"],
      ["Europa", "120", "0.120"],
      ["Guthaben", "100", "0.100"],
    ]);
    expect(props.positions["group:USA"]).toEqual([expect.objectContaining({ securityId: "etf", value: "180", weight: "0.6" })]);
    expect(listRegionSplits).toHaveBeenCalledTimes(1);

    listRegionSplits.mockClear();
    await page({ scope: "a", dimension: "sector" });
    expect(listRegionSplits).not.toHaveBeenCalled();
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
  describe("Gewinne tab", () => {
    const row = (type: string, date: string, input: Record<string, string | null> = {}) => ({
      securityId: null,
      type,
      date,
      sequence: 1,
      quantity: null,
      price: null,
      amount: "0",
      fee: "0",
      tax: "0",
      ...input,
    });
    const INPUT = {
      depots: [
        {
          depotId: "b",
          rows: [
            row("DEPOSIT", "2026-01-10", { amount: "2000" }),
            { ...row("BUY", "2026-01-10", { securityId: "sap", quantity: "10", price: "100", amount: "1000", fee: "1" }), sequence: 2 },
            row("SELL", "2026-03-05", { securityId: "sap", quantity: "4", price: "120", amount: "480", fee: "2", tax: "5" }),
          ],
        },
      ],
      actions: NO_CORPORATE_ACTIONS,
      securityNames: { sap: "SAP SE" },
    };

    it("loads the scope's ledger input and renders the gains view without other tab data", async () => {
      gainsInput.mockResolvedValue(INPUT);
      const tree = await page({ tab: "gains", scope: "b", dimension: "sector" });
      expect(gainsInput).toHaveBeenCalledWith({ depotId: "b" });
      expect(listPositions).not.toHaveBeenCalled();
      expect(returnSeries).not.toHaveBeenCalled();
      const props = findElement(tree, GainsView)?.props as unknown as GainsViewProps;
      expect(props.analysis).toEqual(gainsAnalysis(INPUT.depots, INPUT.actions, TODAY));
      expect(props.analysis.years[0]).toMatchObject({ realized: "77.6", deposits: "2000" });
      expect(props).toMatchObject({ securityNames: { sap: "SAP SE" }, today: TODAY });
      expect(findElement(tree, AnalysisFilters)?.props).toMatchObject({ tab: "gains", scope: "b", dimension: "sector" });
      expect(findElement(tree, AnalysisTabs)?.props).toMatchObject({ value: "gains", scope: "b", dimension: "sector" });
      const html = renderHtml(tree);
      expect(html).toContain('role="tabpanel" id="analysis-tabpanel-gains"');
      expect(html).toContain('href="/analyses?tab=returns&amp;scope=b&amp;dimension=sector"');
      expect(html).not.toContain(">Dimension<");
    });

    it("uses the Portfolio scope by default and shows the empty text without Transactions", async () => {
      gainsInput.mockResolvedValue({ depots: [], actions: NO_CORPORATE_ACTIONS, securityNames: {} });
      const tree = await page({ tab: "gains" });
      expect(gainsInput).toHaveBeenCalledWith("portfolio");
      expect(renderText(tree)).toContain("Noch keine Transaktionen.");
    });
  });
  describe("Dividenden tab", () => {
    const row = (type: string, date: string, sequence: number, input: Record<string, string | null> = {}) => ({
      securityId: null,
      type,
      date,
      sequence,
      quantity: null,
      price: null,
      amount: "0",
      fee: "0",
      tax: "0",
      ...input,
    });
    const INPUT = {
      depots: [
        {
          depotId: "a",
          rows: [
            row("BUY", "2025-01-02", 1, { securityId: "sap", quantity: "10", price: "50", amount: "500" }),
            row("DIVIDEND", "2025-11-15", 1, { securityId: "sap", amount: "20", tax: "5", fee: "0.5" }),
            row("BUY", "2026-03-01", 1, { securityId: "sap", quantity: "10", price: "60", amount: "600" }),
            row("DIVIDEND", "2026-05-10", 1, { securityId: "sap", amount: "40", tax: "10" }),
          ],
        },
        { depotId: "b", rows: [] },
      ],
      actions: NO_CORPORATE_ACTIONS,
      securityNames: { sap: "SAP SE" },
    };

    it("loads the scope's ledger and today's Positions with stored Prices and renders the dividends view", async () => {
      gainsInput.mockResolvedValue(INPUT);
      listPositions.mockImplementation(async (depotId: string) =>
        depotId === "a" ? [{ security: { id: "sap", name: "SAP SE", assetType: "STOCK" }, quantity: "20", value: "2000", costBasis: "1100" }] : [],
      );
      const tree = await page({ tab: "dividends", dimension: "sector" });
      expect(gainsInput).toHaveBeenCalledWith("portfolio");
      expect(listPositions.mock.calls.map((call) => call[0])).toEqual(["a", "b"]);
      expect(listPositions).toHaveBeenCalledWith("a", TODAY, undefined, { storedPrices: latestStoredPrices });
      expect(listClassifications).not.toHaveBeenCalled();
      expect(returnSeries).not.toHaveBeenCalled();
      const props = findElement(tree, DividendsView)?.props as unknown as DividendsViewProps;
      const expected = dividendAnalysis(
        [
          { ...INPUT.depots[0], positions: [{ securityId: "sap", quantity: "20", value: "2000", costBasis: "1100" }] },
          { ...INPUT.depots[1], positions: [] },
        ],
        INPUT.actions,
        TODAY,
      );
      expect(props.analysis).toEqual(expected);
      expect(props.analysis.trailing).toMatchObject({ gross: "60", net: "44.5", payingValue: "2000", grossYield: "0.03" });
      expect(props).toMatchObject({ securityNames: { sap: "SAP SE" }, today: TODAY, depotId: null });
      expect(props.analysis.bySecurity[0]).toMatchObject({ costBasis: "1100", grossYieldOnCost: "0.05454545454545454545" });
      expect(props).not.toHaveProperty("securities");
      expect(findElement(tree, AnalysisFilters)?.props).toMatchObject({ tab: "dividends", scope: "portfolio", dimension: "sector" });
      expect(findElement(tree, GainsView)).toBeFalsy();
      const html = renderHtml(tree);
      expect(html).toContain('role="tabpanel" id="analysis-tabpanel-dividends"');
      expect(html).toContain('href="/analyses?tab=dividends&amp;scope=portfolio&amp;dimension=sector"');
      expect(html).not.toContain(">Dimension<");
    });

    it("limits the scope to one Depot and shows the empty text without Transactions", async () => {
      gainsInput.mockResolvedValue({ depots: [{ depotId: "b", rows: [] }], actions: NO_CORPORATE_ACTIONS, securityNames: {} });
      listPositions.mockResolvedValue([]);
      const tree = await page({ tab: "dividends", scope: "b" });
      expect(gainsInput).toHaveBeenCalledWith({ depotId: "b" });
      expect(listPositions.mock.calls.map((call) => call[0])).toEqual(["b"]);
      expect((findElement(tree, DividendsView)?.props as unknown as DividendsViewProps).depotId).toBe("b");
      expect(renderText(tree)).toContain("Noch keine Transaktionen.");
    });
  });

  describe("Steuern tab", () => {
    const row = (type: string, date: string, sequence: number, input: Record<string, string | null> = {}) => ({
      securityId: null,
      type,
      date,
      sequence,
      quantity: null,
      price: null,
      amount: "0",
      fee: "0",
      tax: "0",
      ...input,
    });
    const INPUT = {
      depots: [
        {
          broker: "COMDIRECT",
          rows: [
            row("BUY", "2025-01-02", 1, { securityId: "etf", quantity: "1", amount: "1000" }),
            row("SELL", "2026-03-01", 1, { securityId: "etf", quantity: "1", amount: "2000", tax: "190" }),
          ],
        },
      ],
      actions: NO_CORPORATE_ACTIONS,
      securities: { etf: { category: "fund", teilfreistellung: "0.3" } },
      allowances: [{ broker: "COMDIRECT", year: 2026, amount: "1001" }],
      brokers: ["COMDIRECT"],
    };

    it("renders the tax view from the tax module's input without the scope filter", async () => {
      taxPreviewInput.mockResolvedValue(INPUT);
      const tree = await page({ tab: "taxes", scope: "b" });
      expect(taxPreviewInput).toHaveBeenCalledTimes(1);
      expect(gainsInput).not.toHaveBeenCalled();
      const props = findElement(tree, TaxView)?.props as unknown as { years: ReturnType<typeof taxPreview>; today: string };
      expect(props.today).toBe(TODAY);
      expect(props.years).toEqual(taxPreview({ ...(INPUT as Omit<Parameters<typeof taxPreview>[0], "today">), today: TODAY }));
      expect(props.years[0].brokers[0]).toMatchObject({ fund: "700", taxable: "700", allowanceUsed: "700", estimated: "0", withheld: "190" });
      expect(findElement(tree, AnalysisFilters)?.props).toMatchObject({ tab: "taxes" });
      const html = renderHtml(tree);
      expect(html).toContain('role="tabpanel" id="analysis-tabpanel-taxes"');
      expect(html).not.toContain(">Bereich<");
      const text = renderText(tree);
      expect(text).toContain("Steuern");
      expect(text).toContain("Nicht berücksichtigt: Kirchensteuer");
      expect(text).toContain("übersteigt 1.000");
    });
  });
  describe("Zielallokation tab", () => {
    const TARGETS = {
      equityUsa: "40",
      equityEurope: "40",
      equityJapan: "0",
      equityPacificExJapan: "0",
      equityEmerging: "0",
      bonds: "0",
      commodities: "0",
      realEstate: "0",
      crypto: "0",
      cash: "20",
    };
    const TAX = {
      depots: [
        {
          depotId: "a",
          broker: "COMDIRECT",
          rows: [
            { securityId: "us", type: "BUY", date: "2026-01-02", sequence: 1, quantity: "10", price: "50", amount: "500", fee: "0", tax: "0" },
            { securityId: "world", type: "BUY", date: "2026-01-02", sequence: 2, quantity: "10", price: "100", amount: "1000", fee: "0", tax: "0" },
          ],
        },
        { depotId: "b", broker: "FINANZEN_ZERO", rows: [] },
      ],
      actions: NO_CORPORATE_ACTIONS,
      securities: { us: { category: "stock", teilfreistellung: "0" }, world: { category: "fund", teilfreistellung: "0.3" } },
      allowances: [{ broker: "COMDIRECT", year: 2026, amount: "1000" }],
      brokers: ["COMDIRECT", "FINANZEN_ZERO"],
    };
    const priced = (id: string, name: string, assetType: string, quantity: string, price: string) => ({
      security: { id, name, assetType },
      quantity,
      price,
      value: String(Number(quantity) * Number(price)),
    });

    beforeEach(() => {
      listPositions.mockImplementation(async (depotId: string) =>
        depotId === "a" ? [priced("us", "US Stock", "STOCK", "10", "70"), priced("world", "Welt ETF", "ETF", "10", "100"), position("np", "Ohne Kurs", "STOCK", null)] : [],
      );
      listClassifications.mockResolvedValue({
        us: classification("STOCK", { assetClass: { value: "Aktien" }, region: { value: "USA" }, country: { value: "USA" } }),
        world: classification("ETF", { assetClass: { value: "Aktien" }, region: { value: "Welt" } }),
      });
      listRegionSplits.mockResolvedValue({ world: { effective: { weights: [{ region: "USA", weight: "50" }, { region: "Europa", weight: "40" }, { region: "Sonstige", weight: "10" }] } } });
      taxPreviewInput.mockResolvedValue(TAX);
      getTargetAllocation.mockReset();
    });

    const viewOf = (tree: unknown) => findElement(tree, TargetAllocationView)?.props as unknown as TargetAllocationViewProps;

    it("maps the scope's priced Positions and cash to segments and shows the proposal for a deposit", async () => {
      getTargetAllocation.mockResolvedValue({ targets: TARGETS, threshold: "2" });
      const tree = await page({ tab: "targets", scope: "a", deposit: "300" });
      expect(getTargetAllocation).toHaveBeenCalledWith("a");
      expect(listPositions).toHaveBeenCalledWith("a", TODAY, undefined, { storedPrices: latestStoredPrices });
      const props = viewOf(tree);
      expect(props.scope).toBe("a");
      expect(props.depositText).toBe("300");
      expect(props.depositInvalid).toBe(false);
      // US stock 700 + 50 % of the ETF 500 = 1.200 USA; Europa 400; Sonstige 100 unassigned; cash 100.
      expect(props.result).toMatchObject({ total: "1800", assignable: "1700", unassigned: { value: "100", holdings: [{ securityId: "world", depotId: "a", value: "100" }] } });
      expect(props.result.segments.map((row) => [row.segment, row.value]).filter(([, value]) => value !== "0")).toEqual([
        ["equityUsa", "1200"],
        ["equityEurope", "400"],
        ["cash", "100"],
      ]);
      // Base 2.000: USA 800 (sell 400), Europa 800 (buy 400), cash 400 (buy 300).
      expect(props.result.proposal).toMatchObject({
        deposit: "300",
        buys: [
          { segment: "equityEurope", amount: "400", instrument: { kind: "security", securityId: "world" } },
          { segment: "cash", amount: "300", instrument: { kind: "cash" } },
        ],
        totalSells: "400",
        cashLeft: "0",
      });
      expect(props.securityNames).toMatchObject({ us: "US Stock", world: "Welt ETF" });
      expect(props.depotNames).toMatchObject({ a: "Hauptdepot", z: "Altdepot" });
      const html = renderHtml(tree);
      expect(html).toContain('role="tabpanel" id="analysis-tabpanel-targets"');
      expect(html).toContain(">Bereich<");
      const text = renderText(tree);
      expect(text).toContain("Rebalancing-Vorschlag");
      expect(text).toContain("Vorschlag – es wird nichts gebucht.");
    });

    it("shows actual values only without stored targets and treats an invalid deposit as 0", async () => {
      getTargetAllocation.mockResolvedValue(null);
      const tree = await page({ tab: "targets", deposit: "abc" });
      expect(getTargetAllocation).toHaveBeenCalledWith("portfolio");
      const props = viewOf(tree);
      expect(props.result.proposal).toBeNull();
      expect(props.depositInvalid).toBe(true);
      // Portfolio: cash of both non-archived Depots (100 + 0).
      expect(props.result.total).toBe("1800");
      expect(renderText(tree)).toContain("Noch keine Zielallokation gespeichert.");
    });
  });
});
