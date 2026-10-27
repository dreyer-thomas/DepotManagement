// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { DrawdownChart, type DrawdownChartProps } from "./DrawdownChart";

registerDomCleanup();

const POINTS = [
  { date: "2026-02-01", drawdown: "0" },
  { date: "2026-02-02", drawdown: "-0.1" },
  { date: "2026-02-03", drawdown: "-0.19" },
  { date: "2026-02-04", drawdown: "-0.1" },
];
const SUMMARY = { current: "-0.1", max: "-0.19", phase: { peak: "2026-02-01", end: "2026-02-04", recovered: false, days: 3 } };

// happy-dom has no layout: give the chart container a size through its computed style.
const realGetComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
    const style = realGetComputedStyle(element, pseudo);
    return new Proxy(style, {
      get(target, key) {
        if (key === "width") return "600px";
        if (key === "height") return "200px";
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderChart(props: Partial<DrawdownChartProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <DrawdownChart points={POINTS} summary={SUMMARY} {...props} />
    </ThemeProvider>,
  );
}

const LABEL = "Drawdown 01.02.2026 – 04.02.2026: maximaler Drawdown -19,00\u00a0%";

async function tooltipText(): Promise<string> {
  return waitFor(() => {
    const text = document.querySelector("[role='tooltip']")?.textContent ?? "";
    if (!text.includes("Drawdown")) throw new Error("no tooltip yet");
    return text;
  });
}

describe("DrawdownChart", () => {
  it("has an accessible name with the Period and the maximum drawdown, and the KPI row", () => {
    renderChart();
    expect(screen.getByRole("figure", { name: LABEL })).toBeTruthy();
    const kpi = (label: string) => screen.getByText(label).closest(".MuiCard-root")?.textContent;
    expect(kpi("Aktueller Drawdown")).toBe("Aktueller Drawdown-10,00\u00a0%");
    expect(kpi("Maximaler Drawdown")).toBe("Maximaler Drawdown-19,00\u00a0%");
    expect(kpi("Dauer")).toBe("Dauer3 Tagenicht erholt");
    expect(kpi("Periode")).toBe("Periode01.02.2026 – 04.02.2026");
  });

  it("draws a loss-colored area to the 0 % baseline with a reference line", async () => {
    renderChart();
    const svg = await waitFor(() => {
      const element = document.querySelector("svg.MuiChartsSvgLayer-root");
      if (!element?.querySelector('.MuiLineChart-area[data-series="drawdown"]')) throw new Error("not drawn yet");
      return element;
    });
    expect(svg.querySelectorAll(".MuiLineChart-area")).toHaveLength(1);
    expect(svg.querySelectorAll(".MuiChartsReferenceLine-root").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".MuiLineChart-mark")).toHaveLength(0);
    const css = [...document.querySelectorAll("style")].map((style) => style.textContent).join("");
    expect(css).toContain("--mui-palette-loss-main");
    // The y-axis shows percents.
    expect(svg.textContent).toContain("%");
  });

  it("shows date and signed drawdown plus the day's events in the tooltip on arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart({
      trades: [{ depotName: "Depot A", type: "BUY", date: "2026-02-02", quantity: "10", price: "50", adjusted: false }],
      dividends: [{ depotName: "Depot A", date: "2026-02-02", amount: "12" }],
    });
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(await tooltipText()).toBe("01.02.2026Drawdown0,00\u00a0%");
    await user.keyboard("{ArrowRight}");
    await waitFor(async () =>
      expect(await tooltipText()).toBe(
        "02.02.2026Drawdown-10,00\u00a0%Kauf · Depot A · 10 Stück à 50,00\u00a0€Dividende · Depot A · 12,00\u00a0€",
      ),
    );
    const svg = document.querySelector("svg.MuiChartsSvgLayer-root")!;
    await waitFor(() => expect(svg.querySelectorAll(".MuiLineChart-mark").length).toBeGreaterThanOrEqual(2));
  });

  it("without any level: no figure, a text and dashes in the KPIs", () => {
    renderChart({ points: POINTS.map((p) => ({ ...p, drawdown: null })), summary: { current: null, max: null, phase: null } });
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText("Kein Drawdown-Verlauf vorhanden.")).toBeTruthy();
    expect(screen.getAllByText("–")).toHaveLength(4);
  });

  it("renders nothing without points", () => {
    const { container } = renderChart({ points: [], summary: { current: null, max: null, phase: null } });
    expect(container.textContent).toBe("");
  });
});
