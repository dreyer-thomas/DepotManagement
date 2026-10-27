// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { PerformanceChart, type PerformanceChartProps } from "./PerformanceChart";

registerDomCleanup();

const POINTS = [
  { date: "2026-02-01", performance: "0" },
  { date: "2026-02-02", performance: "0.1" },
  { date: "2026-02-03", performance: "0.2" },
  { date: "2026-02-04", performance: "0" },
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

function renderChart(props: Partial<PerformanceChartProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <PerformanceChart points={POINTS} {...props} />
    </ThemeProvider>,
  );
}

async function tooltipText(): Promise<string> {
  return waitFor(() => {
    const text = document.querySelector("[role='tooltip']")?.textContent ?? "";
    if (!text.includes("Performance")) throw new Error("no tooltip yet");
    return text;
  });
}

describe("PerformanceChart", () => {
  it("has an accessible name with the Period and the last performance, a line and a 0 % reference line", async () => {
    renderChart();
    expect(screen.getByRole("figure", { name: "Performance 01.02.2026 – 04.02.2026: 0,00 %" })).toBeTruthy();
    const svg = await waitFor(() => {
      const element = document.querySelector("svg.MuiChartsSvgLayer-root");
      if (!element?.querySelector('.MuiLineChart-line[data-series="performance"]')) throw new Error("not drawn yet");
      return element;
    });
    expect(svg.querySelectorAll(".MuiLineChart-area")).toHaveLength(0);
    expect(svg.querySelectorAll(".MuiChartsReferenceLine-root").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".MuiLineChart-mark")).toHaveLength(0);
    expect(svg.textContent).toContain("%");
  });

  it("shows date, signed performance and the day's trades and dividends in the tooltip on arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart({
      trades: [{ depotName: "Depot A", type: "SELL", date: "2026-02-03", quantity: "5", price: "12", adjusted: false }],
      dividends: [{ depotName: "Depot A", date: "2026-02-03", amount: "3" }],
    });
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(await tooltipText()).toBe("01.02.2026Performance0,00 %");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await waitFor(async () =>
      expect(await tooltipText()).toBe(
        "03.02.2026Performance+20,00 %Verkauf · Depot A · 5 Stück à 12,00 €Dividende · Depot A · 3,00 €",
      ),
    );
    const svg = document.querySelector("svg.MuiChartsSvgLayer-root")!;
    await waitFor(() => expect(svg.querySelectorAll(".MuiLineChart-mark").length).toBeGreaterThanOrEqual(2));
  });

  it("draws the 0 % reference line for an all-positive series", async () => {
    renderChart({ points: POINTS.map((p, i) => ({ ...p, performance: String(0.05 * (i + 1)) })) });
    const svg = await waitFor(() => {
      const element = document.querySelector("svg.MuiChartsSvgLayer-root");
      if (!element?.querySelector('.MuiLineChart-line[data-series="performance"]')) throw new Error("not drawn yet");
      return element;
    });
    const line = svg.querySelector(".MuiChartsReferenceLine-root line, .MuiChartsReferenceLine-root path");
    expect(line).not.toBeNull();
    expect(svg.textContent).toContain("0,00\u00a0%");
  });

  it("renders nothing without points", () => {
    const { container } = renderChart({ points: [] });
    expect(container.textContent).toBe("");
  });
});
