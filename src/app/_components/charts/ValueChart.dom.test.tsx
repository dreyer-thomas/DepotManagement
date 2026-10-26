// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { formatDate, formatMoney } from "@/core/format";
import { theme } from "@/theme/theme";
import { ValueChart } from "./ValueChart";
import type { ChartPoint } from "./value-chart";

registerDomCleanup();

const POINTS: ChartPoint[] = [
  { date: "2026-10-20", value: "10000", invested: "9000" },
  { date: "2026-10-21", value: "10100.5", invested: "9000" },
  { date: "2026-10-22", value: "12345.675", invested: "9500" },
];

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

function renderChart(points: ChartPoint[] = POINTS) {
  return render(
    <ThemeProvider theme={theme}>
      <ValueChart points={points} />
    </ThemeProvider>,
  );
}

async function tooltipText(): Promise<string> {
  return waitFor(() => {
    const text = document.querySelector("[role='tooltip']")?.textContent ?? "";
    if (!text.includes("Wert")) throw new Error("no tooltip yet");
    return text;
  });
}

const LABEL =
  "Wertentwicklung 20.10.2026 – 22.10.2026: Wert von 10.000,00 € auf 12.345,68 €, " +
  "investiertes Kapital von 9.000,00 € auf 9.500,00 €";

describe("ValueChart", () => {
  it("has an accessible name with the Period and the first/last value and invested capital", () => {
    renderChart();
    expect(screen.getByRole("figure", { name: LABEL })).toBeTruthy();
  });

  it("is focusable by keyboard", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart();
    const figure = screen.getByRole("figure", { name: LABEL });
    await user.tab();
    expect(figure.contains(document.activeElement)).toBe(true);
  });

  it("shows a tooltip with date, Wert and Investiert of a series point on arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(await tooltipText()).toBe(`${formatDate("2026-10-20")}Wert${formatMoney("10000")}Investiert${formatMoney("9000")}`);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    // Formatted from the decimal string, exactly like the KPI: 12345.675 → 12.345,68 €.
    await waitFor(async () => expect(await tooltipText()).toBe("22.10.2026Wert12.345,68\u00a0€Investiert9.500,00\u00a0€"));
  });

  it("draws the DESIGN.md area chart: gradient value area, dashed invested line, no marks, no vertical grid", async () => {
    renderChart();
    const svg = await waitFor(() => {
      const element = document.querySelector("svg.MuiChartsSvgLayer-root");
      if (!element?.querySelector('.MuiLineChart-area[data-series="value"]')) throw new Error("not drawn yet");
      return element;
    });
    const gradient = svg.querySelector("linearGradient");
    expect(gradient?.id).toMatch(/^value-chart-gradient-/);
    expect(svg.querySelectorAll('.MuiLineChart-area[data-series="value"]')).toHaveLength(1);
    expect(svg.querySelectorAll(".MuiLineChart-area")).toHaveLength(1);
    expect(svg.querySelectorAll('.MuiLineChart-line[data-series="invested"]')).toHaveLength(1);
    expect(svg.querySelectorAll(".MuiChartsGrid-verticalLine")).toHaveLength(0);
    expect(svg.querySelectorAll(".MuiChartsGrid-horizontalLine").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".MuiLineChart-mark")).toHaveLength(0);
    // The value area is filled with that gradient (sx rule of the chart's figure).
    const css = [...document.querySelectorAll("style")].map((style) => style.textContent).join("");
    expect(css).toContain(`.MuiLineChart-area[data-series="value"]{fill:url(#${gradient!.id});`);
  });

  it("renders a single point without throwing", () => {
    renderChart([POINTS[0]]);
    expect(screen.getByRole("figure").getAttribute("aria-label")).toContain("20.10.2026 – 20.10.2026");
  });
});
