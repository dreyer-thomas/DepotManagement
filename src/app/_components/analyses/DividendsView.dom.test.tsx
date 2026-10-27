// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import { type DividendAnalysis, dividendAnalysis } from "@/core/dividend-analysis";
import type { GainsRow } from "@/core/gains-analysis";
import { theme } from "@/theme/theme";
import type { BarsChartProps } from "../charts/BarsChart";
import type { DividendYearLinesChartProps } from "./DividendYearLinesChart";
import { DividendsView } from "./DividendsView";

// Record the props each chart receives; render only its text alternative.
const barsCalls = vi.hoisted(() => [] as BarsChartProps[]);
vi.mock("../charts/BarsChart", () => ({
  BarsChart: (props: BarsChartProps) => {
    barsCalls.push(props);
    return <div role="figure" aria-label={props.ariaLabel} />;
  },
}));
const lineCalls = vi.hoisted(() => [] as DividendYearLinesChartProps[]);
vi.mock("./DividendYearLinesChart", () => ({
  DividendYearLinesChart: (props: DividendYearLinesChartProps) => {
    lineCalls.push(props);
    return <div role="figure" aria-label={props.ariaLabel} />;
  },
}));

registerDomCleanup();

const NBSP = "\u00a0";
const TODAY = "2026-10-27";

let sequence = 0;
function row(type: string, date: string, input: Partial<GainsRow> = {}): GainsRow {
  return { securityId: null, type, date, sequence: ++sequence, quantity: null, price: null, amount: "0", fee: "0", tax: "0", ...input };
}

const ROWS: GainsRow[] = [
  row("BUY", "2025-01-02", { securityId: "sap", quantity: "10", price: "50", amount: "500" }),
  row("DIVIDEND", "2025-11-15", { securityId: "sap", amount: "20", tax: "5", fee: "0.5" }),
  row("BUY", "2026-03-01", { securityId: "sap", quantity: "10", price: "60", amount: "600" }),
  row("DIVIDEND", "2026-05-10", { securityId: "sap", amount: "40", tax: "10" }),
];
const ANALYSIS = dividendAnalysis([{ depotId: "d1", rows: ROWS, positions: [{ securityId: "sap", quantity: "20", value: "2000", costBasis: "1100" }] }], NO_CORPORATE_ACTIONS, TODAY);
const NAMES = { sap: "SAP SE", alv: "Allianz SE" };
const META = {
  sap: { name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" as const },
  alv: { name: "Allianz SE", isin: "DE0008404005", cryptoSymbol: null, assetType: "STOCK" as const },
};
// SAP as above plus Allianz: bought, paid 10 in March 2026 alongside a SAP payment of 5, then sold.
const TWO = dividendAnalysis(
  [
    {
      depotId: "d1",
      rows: [
        ...ROWS,
        row("BUY", "2026-01-05", { securityId: "alv", quantity: "5", price: "200", amount: "1000" }),
        row("DIVIDEND", "2026-03-10", { securityId: "alv", amount: "10" }),
        row("DIVIDEND", "2026-03-20", { securityId: "sap", amount: "5" }),
        row("SELL", "2026-06-01", { securityId: "alv", quantity: "5", price: "210", amount: "1050" }),
      ],
      positions: [{ securityId: "sap", quantity: "20", value: "2000", costBasis: "1100" }],
    },
  ],
  NO_CORPORATE_ACTIONS,
  TODAY,
);

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
  lineCalls.length = 0;
});

function renderView(analysis: DividendAnalysis = ANALYSIS, depotId: string | null = null) {
  return render(
    <ThemeProvider theme={theme}>
      <DividendsView analysis={analysis} securityNames={NAMES} today={TODAY} depotId={depotId} securities={META} />
    </ThemeProvider>,
  );
}

const lastChart = () => barsCalls[barsCalls.length - 1];
const kpi = (label: string) => within(screen.getByRole("region", { name: "Kennzahlen" })).getByText(label).nextElementSibling?.textContent;
const summaryValue = (container: HTMLElement, term: string) =>
  within(container).getAllByText(term).find((element) => element.tagName === "DT")?.nextElementSibling?.textContent;

describe("DividendsView", () => {
  it("shows the KPI row and the months of today's year by default, gross", () => {
    renderView();
    expect(kpi("Einkommen 12 Monate")).toBe(`60,00${NBSP}€`);
    expect(kpi("Dividendenrendite 12 Monate")).toBe(`3,00${NBSP}%`);
    expect(kpi("Erwartet 12 Monate (Schätzung)")).toBe(`80,00${NBSP}€`);

    const chart = screen.getByRole("region", { name: "Dividenden pro Monat" });
    const rows = within(chart).getAllByRole("row");
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual([
      "Zeitraum",
      ...["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober"].map((m) => `${m} 2026`),
    ]);
    expect(rows[5].querySelector("td")?.textContent).toBe(`40,00${NBSP}€`);
    expect(summaryValue(chart, "Summe (Brutto)")).toBe(`40,00${NBSP}€`);
    expect(lastChart().categories[4]).toBe("Mai");
    expect(lastChart().series.map((s) => s.values)).toEqual([[null, null, null, null, 40, null, null, null, null, null]]);
    expect(lastChart().series[0].label).toBe("SAP SE");
    expect(lastChart().series[0].barLabel?.(4)).toBe(`40,00${NBSP}€`);
    expect(lastChart().series[0].barLabel?.(3)).toBeNull();
    expect(lastChart().series[0].text(4)).toBe(`40,00${NBSP}€`);
    expect(screen.getByRole("figure").getAttribute("aria-label")).toContain(`Dividenden pro Monat (Brutto): Januar 2026 0,00${NBSP}€;`);
  });

  it("switches year, Netto, Jahre and Kumuliert", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("combobox", { name: "Jahr" }));
    await user.click(screen.getByRole("option", { name: "2025" }));
    expect(summaryValue(screen.getByRole("region", { name: "Dividenden pro Monat" }), "Summe (Brutto)")).toBe(`20,00${NBSP}€`);

    await user.click(screen.getByRole("button", { name: "Netto" }));
    expect(summaryValue(screen.getByRole("region", { name: "Dividenden pro Monat" }), "Summe (Netto)")).toBe(`14,50${NBSP}€`);
    expect(kpi("Einkommen 12 Monate")).toBe(`44,50${NBSP}€`);
    expect(kpi("Dividendenrendite 12 Monate")).toBe(`2,23${NBSP}%`);
    expect(kpi("Erwartet 12 Monate (Schätzung)")).toBe(`59,00${NBSP}€`);

    await user.click(screen.getByRole("button", { name: "Jahre" }));
    expect(screen.queryByRole("combobox", { name: "Jahr" })).toBeNull();
    let chart = screen.getByRole("region", { name: "Dividenden pro Jahr" });
    expect(within(chart).getAllByRole("row").map((r) => r.textContent)).toEqual(["ZeitraumNetto", `202514,50${NBSP}€`, `202630,00${NBSP}€`]);
    expect(summaryValue(chart, "Summe (Netto)")).toBe(`44,50${NBSP}€`);

    await user.click(screen.getByRole("button", { name: "Akkumuliert" }));
    chart = screen.getByRole("region", { name: "Dividenden kumuliert" });
    expect(lastChart().series[0].values).toEqual([14.5, 44.5]);
    expect(summaryValue(chart, "Gesamt (Netto)")).toBe(`44,50${NBSP}€`);
    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe(`Dividenden kumuliert (Netto): 2025 14,50${NBSP}€; 2026 44,50${NBSP}€`);
  });

  it("lists the Securities with count, last date and amount", async () => {
    const user = userEvent.setup();
    renderView(ANALYSIS, "d1");
    await user.click(screen.getByRole("button", { name: "Wertpapiere" }));
    const list = screen.getByRole("list", { name: "Dividenden nach Wertpapier" });
    const [item] = within(list).getAllByRole("listitem");
    expect(item.textContent).toContain("SAP SE");
    expect(item.textContent).toContain("2 Zahlungen · zuletzt 10.05.2026");
    expect(item.textContent).toContain(`60,00${NBSP}€`);
    expect(within(item).getByRole("link", { name: "SAP SE" }).getAttribute("href")).toContain("sap");
    expect(lastChart().categories).toEqual(["SAP SE"]);
    await user.click(screen.getByRole("button", { name: "Netto" }));
    expect(within(screen.getByRole("list", { name: "Dividenden nach Wertpapier" })).getByRole("listitem").textContent).toContain(`44,50${NBSP}€`);
  });

  it("labels the Erwartet view as an estimate and lists the expected payments", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "Erwartet" }));
    const chart = screen.getByRole("region", { name: "Erwartete Dividenden (Schätzung)" });
    expect(within(chart).getByText("Schätzung: Zahlungen der letzten 12 Monate in denselben Monaten, mit aktuellem Bestand.")).toBeTruthy();
    expect(summaryValue(chart, "Summe (Brutto)")).toBe(`80,00${NBSP}€`);
    const categories = lastChart().categories;
    expect(categories).toHaveLength(13);
    expect(new Set(categories).size).toBe(13);
    expect([categories[0], categories[12]]).toEqual(["Okt 26", "Okt 27"]);
    const items = within(screen.getByRole("list", { name: "Erwartete Zahlungen" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("15.11.2026 · aus Zahlung vom 15.11.2025");
    expect(items[0].textContent).toContain(`40,00${NBSP}€`);
    expect(items[1].textContent).toContain("10.05.2027 · aus Zahlung vom 10.05.2026");
    expect(items[1].textContent).toContain(`40,00${NBSP}€`);
    await user.click(screen.getByRole("button", { name: "Netto" }));
    expect(within(screen.getByRole("list", { name: "Erwartete Zahlungen" })).getAllByRole("listitem")[0].textContent).toContain(`29,00${NBSP}€`);
  });

  it("shows empty lists, 0 and – without dividends", async () => {
    const user = userEvent.setup();
    renderView(dividendAnalysis([{ depotId: "d1", rows: [row("DEPOSIT", "2026-09-01", { amount: "100" })], positions: [] }], NO_CORPORATE_ACTIONS, TODAY));
    expect(kpi("Einkommen 12 Monate")).toBe(`0,00${NBSP}€`);
    expect(kpi("Dividendenrendite 12 Monate")).toBe("–");
    await user.click(screen.getByRole("button", { name: "Wertpapiere" }));
    expect(screen.getByText("Noch keine Dividenden.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Erwartet" }));
    expect(screen.getByText("Keine erwarteten Zahlungen.")).toBeTruthy();
  });

  it("shows the empty text without Transactions", () => {
    renderView(dividendAnalysis([], NO_CORPORATE_ACTIONS, TODAY));
    expect(screen.getByText("Noch keine Transaktionen.")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });
  describe("story 7.7 charts", () => {
    const breakdownKpi = (label: string) =>
      within(screen.getByRole("region", { name: /^Kennzahlen / })).getByText(label).nextElementSibling?.textContent;

    it("stacks the months by Security in stable colours with the total above the topmost segment", async () => {
      const user = userEvent.setup();
      renderView(TWO);
      let chart = lastChart();
      expect(chart.series.map((s) => s.id)).toEqual(["sap", "alv"]);
      expect(chart.series.map((s) => s.stack)).toEqual(["dividends", "dividends"]);
      expect(chart.series[0].color).not.toBe(chart.series[1].color);
      const colors = chart.series.map((s) => s.color);
      // March 2026: SAP 5 below, Allianz 10 on top; the total label sits on Allianz.
      expect(chart.series.map((s) => s.values[2])).toEqual([5, 10]);
      expect(chart.series[0].barLabel?.(2)).toBeNull();
      expect(chart.series[1].barLabel?.(2)).toBe(`15,00${NBSP}€`);
      expect(chart.series[0].barLabel?.(4)).toBe(`40,00${NBSP}€`);
      expect(chart.series[1].barLabel?.(4)).toBeNull();
      expect(screen.getByRole("figure").getAttribute("aria-label")).toContain(
        `März 2026 15,00${NBSP}€ (SAP SE 5,00${NBSP}€, Allianz SE 10,00${NBSP}€)`,
      );

      // Item tooltip: logo, name, amount and month total.
      const tooltip = render(<ThemeProvider theme={theme}>{chart.itemTooltip?.({ seriesId: "alv", dataIndex: 2 })}</ThemeProvider>);
      expect(tooltip.container.textContent).toContain("Allianz SE");
      expect(tooltip.container.textContent).toContain(`10,00${NBSP}€`);
      expect(tooltip.container.textContent).toContain(`Summe März 2026: 15,00${NBSP}€`);
      tooltip.unmount();

      await user.click(screen.getByRole("button", { name: "Monatlich (fortl.)" }));
      chart = lastChart();
      expect(screen.getByRole("region", { name: "Dividenden pro Monat (fortlaufend)" })).toBeTruthy();
      expect(chart.categories[0]).toBe("Nov 25");
      expect(chart.categories.at(-1)).toBe("Okt 26");
      expect(chart.series.map((s) => s.color)).toEqual(colors);

      await user.click(screen.getByRole("button", { name: "Netto" }));
      expect(lastChart().series[0].values[0]).toBe(14.5);
    });

    it("shows the year lines and the dashed forecast labelled as an estimate", async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(screen.getByRole("button", { name: "Akkumuliert (pro Jahr)" }));
      const card = screen.getByRole("region", { name: "Dividenden akkumuliert pro Jahr" });
      const switchInput = within(card).getByRole("switch", { name: "Prognose" });
      expect((switchInput as HTMLInputElement).checked).toBe(false);
      let chart = lineCalls[lineCalls.length - 1];
      expect(chart.lines.map((l) => l.year)).toEqual(["2025", "2026"]);
      expect(chart.forecast).toBeNull();
      expect(within(card).queryByText("Schätzung: erwartete Zahlungen bis Dezember (siehe Erwartet).")).toBeNull();
      expect(chart.ariaLabel).toContain(`2025: Jan 0,00${NBSP}€,`);
      expect(chart.ariaLabel).toContain(`Nov 20,00${NBSP}€, Dez 20,00${NBSP}€; 2026:`);
      expect(chart.ariaLabel).toContain(`Mai 40,00${NBSP}€`);
      expect(chart.ariaLabel.endsWith(`Okt 40,00${NBSP}€`)).toBe(true);
      expect(chart.ariaLabel).not.toContain("Prognose");

      await user.click(switchInput);
      chart = lineCalls[lineCalls.length - 1];
      expect(chart.forecast).toEqual(ANALYSIS.forecast);
      expect(within(card).getByText("Schätzung: erwartete Zahlungen bis Dezember (siehe Erwartet).")).toBeTruthy();
      expect(chart.ariaLabel).toContain(`Prognose 2026 (Schätzung): Okt 40,00${NBSP}€, Nov 80,00${NBSP}€, Dez 80,00${NBSP}€`);
      expect(summaryValue(card, "Prognose 2026 (Schätzung) Dez.")).toBe(`80,00${NBSP}€`);

      await user.click(screen.getByRole("button", { name: "Netto" }));
      expect(lineCalls[lineCalls.length - 1].mode).toBe("net");
      expect(summaryValue(screen.getByRole("region", { name: "Dividenden akkumuliert pro Jahr" }), "Prognose 2026 (Schätzung) Dez.")).toBe(`59,00${NBSP}€`);
    });

    it("breaks down one Security: default, stepping, month choice, dimming and KPIs", async () => {
      const user = userEvent.setup();
      renderView(TWO);
      await user.click(screen.getByRole("button", { name: "Breakdown" }));
      const card = () => screen.getByRole("region", { name: "Dividenden-Breakdown" });
      expect(within(card()).getByRole("combobox", { name: "Wertpapier" }).textContent).toContain("SAP SE");
      expect(card().textContent).toContain("WKN716460");
      expect(card().textContent).toContain("ISINDE0007164600");
      expect(card().textContent).toContain("TypAktie");
      await user.click(within(card()).getByRole("combobox", { name: "Wertpapier" }));
      expect(screen.getByRole("option", { name: /SAP SE/ }).textContent).toContain("Aktie · DE0007164600 · WKN 716460");
      expect(screen.getByRole("option", { name: /Allianz SE/ }).textContent).toContain("Aktie · DE0008404005 · WKN 840400");
      await user.keyboard("{Escape}");
      expect(within(card()).getByRole("combobox", { name: "Monat" }).textContent).toBe("Mai 2026");
      expect(breakdownKpi("Im Mai 2026")).toBe(`40,00${NBSP}€`);
      expect(breakdownKpi("Seit Jan. 2026")).toBe(`45,00${NBSP}€`);
      expect(breakdownKpi("Pers. Div-Rendite")).toBe(`5,91${NBSP}%`);
      expect(lastChart().series.map((s) => [s.id, s.opacity])).toEqual([
        ["sap", 1],
        ["alv", 0.25],
      ]);
      expect(lastChart().categories[0]).toBe("Nov 25");
      expect((screen.getByRole("button", { name: "Vorheriges" }) as HTMLButtonElement).disabled).toBe(true);

      await user.click(screen.getByRole("button", { name: "Nächstes" }));
      expect(within(card()).getByRole("combobox", { name: "Wertpapier" }).textContent).toContain("Allianz SE");
      expect(within(card()).getByRole("combobox", { name: "Monat" }).textContent).toBe("März 2026");
      expect(breakdownKpi("Im März 2026")).toBe(`10,00${NBSP}€`);
      expect(breakdownKpi("Seit Jan. 2026")).toBe(`10,00${NBSP}€`);
      expect(breakdownKpi("Pers. Div-Rendite")).toBe("–");
      expect(lastChart().series.map((s) => s.opacity)).toEqual([0.25, 1]);
      expect((screen.getByRole("button", { name: "Nächstes" }) as HTMLButtonElement).disabled).toBe(true);

      await user.click(screen.getByRole("button", { name: "Vorheriges" }));
      expect(within(card()).getByRole("combobox", { name: "Monat" }).textContent).toBe("Mai 2026");
      await user.click(within(card()).getByRole("combobox", { name: "Monat" }));
      await user.click(screen.getByRole("option", { name: "November 2025" }));
      expect(breakdownKpi("Im November 2025")).toBe(`20,00${NBSP}€`);
      expect(breakdownKpi("Seit Jan. 2025")).toBe(`20,00${NBSP}€`);

      // Clicking a bar picks its month (index 4 = März 2026).
      act(() => lastChart().onBarClick?.(4));
      expect(breakdownKpi("Im März 2026")).toBe(`5,00${NBSP}€`);
      expect(breakdownKpi("Seit Jan. 2026")).toBe(`5,00${NBSP}€`);

      await user.click(screen.getByRole("button", { name: "Netto" }));
      expect(breakdownKpi("Pers. Div-Rendite")).toBe(`4,50${NBSP}%`);
    });

    it("matches the reference Breakdown KPIs", async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(screen.getByRole("button", { name: "Breakdown" }));
      expect(breakdownKpi("Im Mai 2026")).toBe(`40,00${NBSP}€`);
      expect(breakdownKpi("Seit Jan. 2026")).toBe(`40,00${NBSP}€`);
      expect(breakdownKpi("Pers. Div-Rendite")).toBe(`5,45${NBSP}%`);
      await user.click(screen.getByRole("button", { name: "Netto" }));
      expect(breakdownKpi("Pers. Div-Rendite")).toBe(`4,05${NBSP}%`);
    });

    it("shows no-dividend texts in the stacked views and Breakdown", async () => {
      const user = userEvent.setup();
      renderView(dividendAnalysis([{ depotId: "d1", rows: [row("DEPOSIT", "2026-09-01", { amount: "100" })], positions: [] }], NO_CORPORATE_ACTIONS, TODAY));
      expect(screen.getByText("Noch keine Dividenden.")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Monatlich (fortl.)" }));
      expect(screen.getByText("Noch keine Dividenden.")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Breakdown" }));
      expect(screen.getByText("Noch keine Dividenden.")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Akkumuliert (pro Jahr)" }));
      expect(lineCalls[lineCalls.length - 1].lines[0].points.slice(0, 10).every((p) => p?.gross === "0")).toBe(true);
    });
  });
});
