// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { ComparisonChart, type ComparisonChartProps } from "./ComparisonChart";

registerDomCleanup();

const LINE = [
  { date: "2026-01-31", performance: "0" },
  { date: "2026-02-01", performance: "0.1" },
  { date: "2026-02-02", performance: "0.134375" },
];
const WORLD = [
  { date: "2026-01-31", performance: "0" },
  { date: "2026-02-01", performance: "-0.02" },
  { date: "2026-02-02", performance: "0.03" },
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

function renderChart(props: Partial<ComparisonChartProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ComparisonChart line={LINE} scopeLabel="Portfolio" comparison={{ label: "MSCI World", line: WORLD }} {...props} />
    </ThemeProvider>,
  );
}

async function drawn(series: string) {
  return waitFor(() => {
    const element = document.querySelector("svg.MuiChartsSvgLayer-root");
    if (!element?.querySelector(`.MuiLineChart-line[data-series="${series}"]`)) throw new Error("not drawn yet");
    return element;
  });
}

describe("ComparisonChart", () => {
  it("draws the scope and the comparison line with a 0 % reference line", async () => {
    renderChart();
    const svg = await drawn("comparison");
    expect(svg.querySelector('.MuiLineChart-line[data-series="scope"]')).not.toBeNull();
    expect(svg.querySelectorAll(".MuiChartsReferenceLine-root").length).toBeGreaterThan(0);
    expect(svg.textContent).toContain("%");
  });

  it("shows the date and both values in the tooltip on arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart();
    await drawn("comparison");
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await waitFor(() =>
      expect(document.querySelector("[role='tooltip']")?.textContent).toBe("01.02.2026Portfolio+10,00\u00a0%MSCI World-2,00\u00a0%"),
    );
  });

  it("draws the scope line alone without a comparison", async () => {
    renderChart({ comparison: null });
    const svg = await drawn("scope");
    expect(svg.querySelector('.MuiLineChart-line[data-series="comparison"]')).toBeNull();
    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe("Performance 31.01.2026 – 02.02.2026: Portfolio +13,44 %");
  });

  it("renders nothing without points", () => {
    const { container } = renderChart({ line: [], comparison: null });
    expect(container.textContent).toBe("");
  });
});
