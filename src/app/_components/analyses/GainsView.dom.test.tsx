// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import { type GainsAnalysis, type GainsRow, gainsAnalysis } from "@/core/gains-analysis";
import { theme } from "@/theme/theme";
import type { BarsChartProps } from "../charts/BarsChart";
import { GainsView } from "./GainsView";

// Record the props each chart receives; render only its text alternative.
const barsCalls = vi.hoisted(() => [] as BarsChartProps[]);
vi.mock("../charts/BarsChart", () => ({
  BarsChart: (props: BarsChartProps) => {
    barsCalls.push(props);
    return <div role="figure" aria-label={props.ariaLabel} />;
  },
}));

registerDomCleanup();

/** Series ids and values of the last rendered gains (0) or Kapitalfluss (1) chart. */
const seriesOf = (chart: 0 | 1) => barsCalls.slice(-2)[chart].series.map((s) => [s.id, s.values]);
const textOf = (chart: 0 | 1, id: string, index: number) => barsCalls.slice(-2)[chart].series.find((s) => s.id === id)?.text(index);

const NBSP = " ";
const TODAY = "2026-04-30";

let sequence = 0;
function row(type: string, date: string, input: Partial<GainsRow> = {}): GainsRow {
  return { securityId: null, type, date, sequence: ++sequence, quantity: null, price: null, amount: "0", fee: "0", tax: "0", ...input };
}
const trade = (type: "BUY" | "SELL", date: string, securityId: string, quantity: string, amount: string, input: Partial<GainsRow> = {}) =>
  row(type, date, { securityId, quantity, amount, price: "1", ...input });

const ROWS: GainsRow[] = [
  row("DEPOSIT", "2025-06-01", { amount: "5000" }),
  trade("BUY", "2025-06-02", "sap", "10", "1000"),
  trade("SELL", "2025-07-01", "sap", "2", "160"),
  row("DEPOSIT", "2026-01-10", { amount: "2000" }),
  trade("BUY", "2026-01-10", "bmw", "10", "1000", { fee: "1" }),
  trade("SELL", "2026-03-05", "bmw", "4", "480", { fee: "2", tax: "5" }),
  row("DIVIDEND", "2026-03-20", { securityId: "bmw", amount: "30", fee: "0.5", tax: "7.5" }),
  row("WITHDRAWAL", "2026-04-02", { amount: "300" }),
];

const ANALYSIS = gainsAnalysis([{ depotId: "d1", rows: ROWS }], NO_CORPORATE_ACTIONS, TODAY);
const NAMES = { sap: "SAP SE", bmw: "BMW AG" };

// happy-dom has no layout: give the chart container a size through its computed style.
const realGetComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
    const style = realGetComputedStyle(element, pseudo);
    return new Proxy(style, {
      get(target, key) {
        if (key === "width") return "600px";
        if (key === "height") return "240px";
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  barsCalls.length = 0;
});

function renderView(analysis: GainsAnalysis = ANALYSIS) {
  return render(
    <ThemeProvider theme={theme}>
      <GainsView analysis={analysis} securityNames={NAMES} today={TODAY} />
    </ThemeProvider>,
  );
}

const section = (name: string) => screen.getByRole("region", { name });
const summaryValue = (container: HTMLElement, term: string) => {
  const dt = within(container).getAllByText(term).find((element) => element.tagName === "DT");
  return dt?.nextElementSibling?.textContent;
};
const figures = () => screen.getAllByRole("figure").map((figure) => figure.getAttribute("aria-label"));

describe("GainsView", () => {
  it("shows the months of today's year by default with summaries, tables and the year's sales", () => {
    renderView();
    const gains = section("Realisierte Gewinne");
    expect(summaryValue(gains, "Realisiert")).toBe(`+77,60${NBSP}€`);
    expect(summaryValue(gains, "Dividenden")).toBe(`+30,00${NBSP}€`);
    expect(summaryValue(gains, "Gebühren")).toBe(`-0,50${NBSP}€`);
    expect(summaryValue(gains, "Steuern gezahlt")).toBe(`12,50${NBSP}€`);
    const rows = within(gains).getAllByRole("row");
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["Zeitraum", "Januar 2026", "Februar 2026", "März 2026", "April 2026"]);
    expect([...rows[3].querySelectorAll("td")].map((td) => td.textContent)).toEqual([`+77,60${NBSP}€`, `+30,00${NBSP}€`, `-0,50${NBSP}€`, `12,50${NBSP}€`]);
    const flowRows = within(section("Kapitalfluss")).getAllByRole("row");
    expect([...flowRows[4].querySelectorAll("td")].map((td) => td.textContent)).toEqual([`0,00${NBSP}€`, `-300,00${NBSP}€`, `-300,00${NBSP}€`]);

    expect(seriesOf(0)).toEqual([
      ["gain", [null, null, 77.6, null]],
      ["loss", [null, null, null, null]],
    ]);
    expect(textOf(0, "gain", 2)).toBe(`+77,60${NBSP}€`);
    expect(seriesOf(1)).toEqual([
      ["inflow", [2000, null, null, null]],
      ["outflow", [null, null, null, -300]],
    ]);
    expect(textOf(1, "outflow", 3)).toBe(`-300,00${NBSP}€`);

    const [gainsLabel, flowLabel] = figures();
    expect(gainsLabel).toContain(`März 2026 Realisiert +77,60${NBSP}€`);
    expect(gainsLabel).not.toContain("Dividenden");
    expect(gainsLabel).not.toContain("Steuern");
    expect(flowLabel).toBe(`Kapitalfluss (netto): Januar 2026 +2.000,00${NBSP}€; Februar 2026 0,00${NBSP}€; März 2026 0,00${NBSP}€; April 2026 -300,00${NBSP}€`);

    const flow = section("Kapitalfluss");
    expect(summaryValue(flow, "Einzahlungen")).toBe(`+2.000,00${NBSP}€`);
    expect(summaryValue(flow, "Auszahlungen")).toBe(`-300,00${NBSP}€`);
    expect(summaryValue(flow, "Netto")).toBe(`+1.700,00${NBSP}€`);

    const best = screen.getByRole("list", { name: "Beste Verkäufe" });
    expect(within(best).getAllByRole("listitem")).toHaveLength(1);
    expect(best.textContent).toContain("BMW AG");
    expect(best.textContent).toContain("05.03.2026 · 4 Stk.");
    expect(best.textContent).toContain(`+77,60${NBSP}€ · +19,38${NBSP}%`);
    expect(screen.getByText("Keine Verkäufe mit Verlust.")).toBeTruthy();
    expect(screen.queryByText(/SAP SE/)).toBeNull();
  });

  it("switches the year and the Jahre view", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("combobox", { name: "Jahr" }));
    await user.click(screen.getByRole("option", { name: "2025" }));
    let gains = section("Realisierte Gewinne");
    expect(summaryValue(gains, "Realisiert")).toBe(`-40,00${NBSP}€`);
    expect(within(gains).getAllByRole("row")[1].querySelector("th")?.textContent).toBe("Juni 2025");
    expect(screen.getByRole("list", { name: "Schlechteste Verkäufe" }).textContent).toContain("SAP SE");
    expect(screen.getByText("Keine Verkäufe mit Gewinn.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Jahre" }));
    expect(screen.queryByRole("combobox", { name: "Jahr" })).toBeNull();
    gains = section("Realisierte Gewinne");
    expect(within(gains).getAllByRole("row").map((r) => r.querySelector("th")?.textContent)).toEqual(["Zeitraum", "2025", "2026"]);
    expect(summaryValue(gains, "Realisiert")).toBe(`+37,60${NBSP}€`);
    expect(summaryValue(section("Kapitalfluss"), "Netto")).toBe(`+6.700,00${NBSP}€`);
    expect(screen.getByRole("list", { name: "Beste Verkäufe" }).textContent).toContain("BMW AG");
    expect(screen.getByRole("list", { name: "Schlechteste Verkäufe" }).textContent).toContain("SAP SE");
    expect(figures()[0]).toBe(`Realisierte Gewinne: 2025 Realisiert -40,00${NBSP}€; 2026 Realisiert +77,60${NBSP}€`);
    expect(seriesOf(0)).toEqual([
      ["gain", [null, 77.6]],
      ["loss", [-40, null]],
    ]);
    expect(textOf(0, "loss", 0)).toBe(`-40,00${NBSP}€`);
    expect(seriesOf(1)).toEqual([
      ["inflow", [5000, 1700]],
      ["outflow", [null, null]],
    ]);
  });

  it("adds the dividend and fee layers to the chart, never taxes", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("switch", { name: "Dividenden" }));
    expect(figures()[0]).toContain(`März 2026 Realisiert +77,60${NBSP}€, Dividenden +30,00${NBSP}€`);
    expect(figures()[0]).not.toContain("Gebühren");
    expect(seriesOf(0).map(([id]) => id)).toEqual(["gain", "loss", "dividends"]);
    expect(seriesOf(0)[2]).toEqual(["dividends", [0, 0, 30, 0]]);
    await user.click(screen.getByRole("switch", { name: "Gebühren" }));
    expect(figures()[0]).toContain(`Dividenden +30,00${NBSP}€, Gebühren -0,50${NBSP}€`);
    expect(seriesOf(0).map(([id]) => id)).toEqual(["gain", "loss", "dividends", "fees"]);
    expect(seriesOf(0)[3]).toEqual(["fees", [-0, -0, -0.5, -0]]);
    expect(textOf(0, "fees", 2)).toBe(`-0,50${NBSP}€`);
    await user.click(screen.getByRole("switch", { name: "Dividenden" }));
    expect(seriesOf(0).map(([id]) => id)).toEqual(["gain", "loss", "fees"]);
    expect(figures()[0]).not.toContain("Steuern");
  });

  it("shows the empty text without Transactions", () => {
    renderView({ months: [], years: [], sales: [] });
    expect(screen.getByText("Noch keine Transaktionen.")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("says when the range has no sales", async () => {
    const analysis = gainsAnalysis([{ depotId: "d1", rows: [row("DEPOSIT", "2026-01-10", { amount: "10" })] }], NO_CORPORATE_ACTIONS, TODAY);
    renderView(analysis);
    expect(screen.getByText("Keine Verkäufe im Zeitraum.")).toBeTruthy();
    expect(within(section("Verkäufe")).getByRole("heading", { name: "Verkäufe" })).toBeTruthy();
  });
});
