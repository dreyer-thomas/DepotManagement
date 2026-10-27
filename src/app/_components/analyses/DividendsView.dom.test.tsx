// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import { type DividendAnalysis, dividendAnalysis } from "@/core/dividend-analysis";
import type { GainsRow } from "@/core/gains-analysis";
import { theme } from "@/theme/theme";
import type { BarsChartProps } from "../charts/BarsChart";
import { DividendsView } from "./DividendsView";

// Record the props each chart receives; render only its text alternative.
const barsCalls = vi.hoisted(() => [] as BarsChartProps[]);
vi.mock("../charts/BarsChart", () => ({
  BarsChart: (props: BarsChartProps) => {
    barsCalls.push(props);
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
const ANALYSIS = dividendAnalysis([{ depotId: "d1", rows: ROWS, positions: [{ securityId: "sap", quantity: "20", value: "2000" }] }], NO_CORPORATE_ACTIONS, TODAY);
const NAMES = { sap: "SAP SE" };

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

function renderView(analysis: DividendAnalysis = ANALYSIS, depotId: string | null = null) {
  return render(
    <ThemeProvider theme={theme}>
      <DividendsView analysis={analysis} securityNames={NAMES} today={TODAY} depotId={depotId} />
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
    expect(lastChart().series.map((s) => s.values)).toEqual([[0, 0, 0, 0, 40, 0, 0, 0, 0, 0]]);
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

    await user.click(screen.getByRole("button", { name: "Kumuliert" }));
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
});
