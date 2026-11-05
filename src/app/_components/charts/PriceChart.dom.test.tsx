// @vitest-environment happy-dom
import { ThemeProvider } from "@mui/material/styles";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { theme } from "@/theme/theme";
import { PriceChart } from "./PriceChart";
import type { PriceChartAverageOverlay, PriceChartPivotOverlay, PriceChartPoint, PriceChartTrade } from "./price-chart";

registerDomCleanup();

const POINTS: PriceChartPoint[] = [
  { date: "2026-10-20", price: "50" },
  { date: "2026-10-21", price: "51" },
  { date: "2026-10-22", price: "52.5" },
];

const TRADES: PriceChartTrade[] = [
  { depotName: "Alpha", type: "BUY", date: "2026-10-20", quantity: "20", price: "50", adjusted: true },
  { depotName: "Beta", type: "SELL", date: "2026-10-22", quantity: "4", price: "52.4", adjusted: false },
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

function renderChart(
  points: PriceChartPoint[] = POINTS,
  trades: PriceChartTrade[] = TRADES,
  average?: PriceChartAverageOverlay,
  pivots?: PriceChartPivotOverlay,
) {
  return render(
    <ThemeProvider theme={theme}>
      <PriceChart points={points} trades={trades} average={average} pivots={pivots} />
    </ThemeProvider>,
  );
}

async function tooltipText(): Promise<string> {
  return waitFor(() => {
    const text = document.querySelector("[role='tooltip']")?.textContent ?? "";
    if (!text.includes("Kurs")) throw new Error("no tooltip yet");
    return text;
  });
}

const LABEL = "Kursverlauf 20.10.2026 – 22.10.2026: Kurs von 50,00 € auf 52,50 €, 1 Kauf, 1 Verkauf";

describe("PriceChart", () => {
  it("has an accessible name with Period, first/last price and trade counts", () => {
    renderChart();
    expect(screen.getByRole("figure", { name: LABEL })).toBeTruthy();
  });

  it("draws the price line without area and one triangle buy and one diamond sell marker", async () => {
    renderChart();
    const svg = await waitFor(() => {
      const element = document.querySelector("svg.MuiChartsSvgLayer-root");
      if (!element?.querySelector('.MuiLineChart-line[data-series="price"]')) throw new Error("not drawn yet");
      return element;
    });
    expect(svg.querySelectorAll(".MuiLineChart-area")).toHaveLength(0);
    expect(svg.querySelectorAll('.MuiLineChart-mark[data-series="price"]')).toHaveLength(0);
    const buys = svg.querySelectorAll('.MuiLineChart-mark[data-series="buy"]');
    const sells = svg.querySelectorAll('.MuiLineChart-mark[data-series="sell"]');
    expect(buys).toHaveLength(1);
    expect(sells).toHaveLength(1);
    expect(buys[0].getAttribute("data-index")).toBe("0");
    expect(sells[0].getAttribute("data-index")).toBe("2");
    // Triangle and diamond are different symbol paths.
    expect(buys[0].getAttribute("d")).not.toBe(sells[0].getAttribute("d"));
    const css = [...document.querySelectorAll("style")].map((style) => style.textContent).join("");
    expect(css).toContain('.MuiLineChart-line[data-series="buy"]');
    expect(css).toContain("display:none");
  });

  it("shows date, price and the day's trades on arrow keys", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(await tooltipText()).toBe("20.10.2026Kurs50,00 €Kauf · Alpha · 20 Stück à 50,00 € (split-bereinigt)");
    await user.keyboard("{ArrowRight}");
    await waitFor(async () => expect(await tooltipText()).toBe("21.10.2026Kurs51,00 €"));
    await user.keyboard("{ArrowRight}");
    await waitFor(async () => expect(await tooltipText()).toBe("22.10.2026Kurs52,50 €Verkauf · Beta · 4 Stück à 52,40 €"));
  });

  it("draws a dashed moving average with its tooltip line and names it in the aria-label", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart(POINTS, TRADES, {
      window: "38",
      points: [
        { date: "2026-10-20", average: null },
        { date: "2026-10-21", average: "50.5" },
        { date: "2026-10-22", average: "51" },
      ],
    });
    expect(screen.getByRole("figure", { name: `${LABEL}, mit gleitendem Durchschnitt 38 Tage` })).toBeTruthy();
    expect(screen.queryByText(/Zu wenig gespeicherte Kurse/)).toBeNull();
    await waitFor(() => {
      if (!document.querySelector('.MuiLineChart-line[data-series="average"]')) throw new Error("not drawn yet");
    });
    const css = [...document.querySelectorAll("style")].map((style) => style.textContent).join("");
    expect(css).toContain("stroke-dasharray:6 4");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(await tooltipText()).toBe("20.10.2026Kurs50,00\u00a0€GD 38–Kauf · Alpha · 20 Stück à 50,00\u00a0€ (split-bereinigt)");
    await user.keyboard("{ArrowRight}");
    await waitFor(async () => expect(await tooltipText()).toBe("21.10.2026Kurs51,00\u00a0€GD 3850,50\u00a0€"));
  });

  it("overlay on without any average: no aria suffix and a caption", () => {
    renderChart(POINTS, TRADES, { window: "200", points: POINTS.map((p) => ({ date: p.date, average: null })) });
    expect(screen.getByRole("figure", { name: LABEL })).toBeTruthy();
    expect(screen.getByText("Zu wenig gespeicherte Kurse für GD 200.")).toBeTruthy();
  });

  it("without an overlay draws no average line", async () => {
    renderChart();
    await waitFor(() => {
      if (!document.querySelector('.MuiLineChart-line[data-series="price"]')) throw new Error("not drawn yet");
    });
    expect(document.querySelector('.MuiLineChart-line[data-series="average"]')).toBeNull();
  });

  const SWING_POINTS: PriceChartPoint[] = ["100", "110", "120", "108", "100", "112", "115"].map((price, index) => ({
    date: `2026-01-0${index + 1}`,
    price,
  }));
  const SWING: PriceChartPivotOverlay = {
    threshold: "8",
    pivots: [
      { date: "2026-01-01", price: "100", kind: "low" },
      { date: "2026-01-03", price: "120", kind: "high" },
      { date: "2026-01-05", price: "100", kind: "low" },
    ],
    retracements: [
      { ratio: "0.382", price: "107.64" },
      { ratio: "0.5", price: "110" },
      { ratio: "0.618", price: "112.36" },
    ],
    extension: { ratio: "1.618", price: "87.64" },
  };

  it("pivots overlay: draws the ZigZag through the pivots and four labelled level lines, no wave count", async () => {
    const user = userEvent.setup({ delay: null });
    renderChart(SWING_POINTS, [], undefined, SWING);
    expect(
      screen.getByRole("figure", {
        name:
          "Kursverlauf 01.01.2026 – 07.01.2026: Kurs von 100,00\u00a0€ auf 115,00\u00a0€, 0 Käufe, 0 Verkäufe, " +
          "mit Wendepunkten ab 8\u00a0%: 3 Wendepunkte, Fibonacci 38,2\u00a0% 107,64\u00a0€, 50\u00a0% 110,00\u00a0€, " +
          "61,8\u00a0% 112,36\u00a0€, 161,8\u00a0% 87,64\u00a0€",
      }),
    ).toBeTruthy();
    const svg = await waitFor(() => {
      const element = document.querySelector("svg.MuiChartsSvgLayer-root");
      if (!element?.querySelector('.MuiLineChart-line[data-series="zigzag"]')) throw new Error("not drawn yet");
      return element;
    });
    const marks = [...svg.querySelectorAll('.MuiLineChart-mark[data-series="zigzag"]')].map((mark) => mark.getAttribute("data-index"));
    expect(marks).toEqual(["0", "2", "4"]);
    const lines = svg.querySelectorAll(".MuiChartsReferenceLine-line");
    expect(lines).toHaveLength(4);
    const labels = [...svg.querySelectorAll(".MuiChartsReferenceLine-label")].map((label) => label.textContent);
    expect(labels).toEqual([
      "38,2\u00a0% · 107,64\u00a0€",
      "50\u00a0% · 110,00\u00a0€",
      "61,8\u00a0% · 112,36\u00a0€",
      "161,8\u00a0% · 87,64\u00a0€",
    ]);
    const css = [...document.querySelectorAll("style")].map((style) => style.textContent).join("");
    expect(css).toContain("stroke-dasharray:2 3");
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    await waitFor(async () => expect(await tooltipText()).toBe("03.01.2026Kurs120,00\u00a0€WendepunktHoch"));
    expect(document.body.textContent).not.toMatch(/Welle|Elliott|\b[1-5ABC]\)|\(\s*[1-5ABC]\s*\)/);
    expect(screen.queryByText(/Keine (Wendepunkte|abgeschlossene)/)).toBeNull();
  });

  it("pivots overlay: captions without pivots or with a single one, no level lines", async () => {
    const { unmount } = renderChart(SWING_POINTS, [], undefined, { threshold: "12", pivots: [], retracements: [], extension: null });
    expect(screen.getByText("Keine Wendepunkte ab 12 % im Zeitraum.")).toBeTruthy();
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/mit Wendepunkten ab 12\u00a0%: 0 Wendepunkte$/);
    unmount();
    renderChart(SWING_POINTS, [], undefined, { threshold: "8", pivots: [SWING.pivots[0]], retracements: [], extension: null });
    expect(screen.getByText("Keine abgeschlossene Bewegung ab 8 % im Zeitraum.")).toBeTruthy();
    await waitFor(() => {
      if (!document.querySelector('.MuiLineChart-mark[data-series="zigzag"]')) throw new Error("not drawn yet");
    });
    expect(document.querySelectorAll(".MuiChartsReferenceLine-line")).toHaveLength(0);
  });

  it("says so instead of drawing when no day has a price", () => {
    renderChart([{ date: "2026-10-20", price: null }], []);
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText("Kein Kursverlauf vorhanden.")).toBeTruthy();
  });
});
