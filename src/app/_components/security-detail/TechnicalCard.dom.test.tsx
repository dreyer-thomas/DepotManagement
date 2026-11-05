// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDomCleanup } from "../../../../test/helpers/dom";
import { TECHNICAL_INDICATOR_COOKIE } from "@/app/_components/charts/chart-preference";
import type { TechnicalSeriesPoint } from "@/core/technical";
import { theme } from "@/theme/theme";
import { TechnicalCard } from "./TechnicalCard";
import type { TechnicalSignals } from "./technical-labels";

registerDomCleanup();

const NBSP = " ";
const DATE = "2026-11-04";
const INSUFFICIENT = { value: null, reason: "insufficient-history" } as const;

const FULL: TechnicalSignals = {
  trend: { value: "0.0821", date: DATE, key: "up", label: "Aufwärtstrend", sma200: "100" },
  rsi: { value: "64.27", date: DATE, key: "neutral", label: "neutral" },
  macd: { value: "1.2312", date: DATE, key: "positive-turning-up", label: "positiv, dreht nach oben", signal: "0.9812", histogram: "0.25" },
  tsi: { value: "12.43", date: DATE, key: "positive", label: "Schwung positiv", signal: "9.08" },
  fiftyTwoWeeks: {
    value: "-0.031",
    date: DATE,
    key: "near-high",
    label: "nahe Hoch",
    high: { price: "120", date: "2026-10-01" },
    low: { price: "80", date: "2026-03-01" },
  },
};

const SERIES: TechnicalSeriesPoint[] = [
  { date: "2026-11-02", rsi: "48.21", macd: "1", macdSignal: "1.1", macdHistogram: "-0.1", tsi: "8", tsiSignal: "7" },
  { date: "2026-11-03", rsi: "55", macd: "1.1", macdSignal: "1.05", macdHistogram: "0.05", tsi: "10", tsiSignal: "8" },
  { date: "2026-11-04", rsi: "64.27", macd: "1.2312", macdSignal: "0.9812", macdHistogram: "0.25", tsi: "12.43", tsiSignal: "9.08" },
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
  document.cookie = `${TECHNICAL_INDICATOR_COOKIE}=; path=/; max-age=0`;
});

function renderCard(props: Partial<Parameters<typeof TechnicalCard>[0]> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <TechnicalCard position={FULL} series={SERIES} asOf={DATE} from="2026-10-31" to="2026-11-04" {...props} />
    </ThemeProvider>,
  );
}

const rowText = (signal: string) => document.querySelector(`[data-signal="${signal}"]`)?.textContent;
const open = () => userEvent.click(screen.getByRole("button", { name: "Technische Lage ausklappen" }));

describe("TechnicalCard", () => {
  it("closed: source line and one row per signal with tone pills, no chart or toggle", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Technische Lage" })).toBeTruthy();
    expect(screen.getByText("berechnet aus Schlusskursen, Stand 04.11.2026")).toBeTruthy();
    expect(rowText("Trend")).toBe(`Trend+8,2${NBSP}% zum 200-Tage-SchnittAufwärtstrend`);
    expect(rowText("RSI")).toBe("RSI64,3neutral");
    expect(rowText("MACD")).toBe("MACD1,23 (Signal 0,98)positiv, dreht nach oben");
    expect(rowText("TSI")).toBe("TSI12,4 (Signal 9,1)Schwung positiv");
    expect(rowText("52 Wochen")).toBe(`52 Wochen-3,1${NBSP}% zum 52-Wochen-Hochnahe Hoch`);
    expect(screen.getByText("Aufwärtstrend").getAttribute("data-tone")).toBe("gain");
    expect(screen.getByText("neutral").getAttribute("data-tone")).toBe("none");
    expect(screen.queryByRole("group", { name: "Indikator" })).toBeNull();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("opened: toggle TSI · RSI · MACD; switching changes the chart and writes the cookie", async () => {
    renderCard();
    await open();
    const group = screen.getByRole("group", { name: "Indikator" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["TSI", "RSI", "MACD"]);
    expect(within(group).getByRole("button", { name: "TSI" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe(
      "TSI 02.11.2026 – 04.11.2026: von 8,0 auf 12,4, Signallinie zuletzt 9,1, Nulllinie",
    );
    expect(rowText("RSI")).toBe("RSI64,3neutral");

    await userEvent.click(within(group).getByRole("button", { name: "RSI" }));
    expect(screen.getByRole("figure").getAttribute("aria-label")).toBe("RSI 02.11.2026 – 04.11.2026: von 48,2 auf 64,3, Zonen 30 und 70");
    expect(document.cookie).toContain(`${TECHNICAL_INDICATOR_COOKIE}=rsi`);
    await waitFor(() => {
      if (!document.querySelector('.MuiLineChart-area[data-series="zone-overbought"]')) throw new Error("not drawn yet");
    });

    await userEvent.click(within(group).getByRole("button", { name: "MACD" }));
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/^MACD 02\.11\.2026 – 04\.11\.2026/);
    expect(document.cookie).toContain(`${TECHNICAL_INDICATOR_COOKIE}=macd`);
    await waitFor(() => {
      if (!document.querySelector('.MuiLineChart-area[data-series="histogram-positive"]')) throw new Error("not drawn yet");
    });
  });

  it("shows date and the indicator's values in the axis tooltip on arrow keys (TSI and MACD)", async () => {
    const user = userEvent.setup({ delay: null });
    const tooltipText = (expected: string) =>
      waitFor(() => expect(document.querySelector("[role='tooltip']")?.textContent ?? "").toBe(expected));
    const focusChart = () => screen.getByRole("figure").querySelector<SVGElement>("svg")!.focus();

    const tsi = renderCard();
    await open();
    focusChart();
    await user.keyboard("{ArrowRight}");
    await tooltipText("02.11.2026TSI8,0Signal7,0");
    await user.keyboard("{ArrowRight}");
    await tooltipText("03.11.2026TSI10,0Signal8,0");
    tsi.unmount();

    renderCard({ initialIndicator: "macd" });
    await open();
    focusChart();
    await user.keyboard("{ArrowRight}");
    await tooltipText("02.11.2026MACD1,00Signal1,10Histogramm-0,10");
    await user.keyboard("{ArrowRight}");
    await tooltipText("03.11.2026MACD1,10Signal1,05Histogramm0,05");
  });

  it("starts on the stored indicator", async () => {
    renderCard({ initialIndicator: "macd" });
    await open();
    expect(screen.getByRole("button", { name: "MACD" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("figure").getAttribute("aria-label")).toMatch(/^MACD/);
  });

  it("partial history: the row says 'zu wenig Kursdaten' without a pill", () => {
    renderCard({ position: { ...FULL, trend: { ...INSUFFICIENT } } });
    expect(rowText("Trend")).toBe("Trendzu wenig Kursdaten");
    expect(document.querySelector('[data-signal="Trend"] [data-tone]')).toBeNull();
    expect(rowText("RSI")).toBe("RSI64,3neutral");
  });

  it("no series in the Period: opened shows a note instead of the chart", async () => {
    renderCard({ series: [] });
    await open();
    expect(screen.getByText("Kein Indikatorverlauf im Zeitraum.")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("no closes: only 'zu wenig Kursdaten', also when opened", async () => {
    const none: TechnicalSignals = {
      trend: { ...INSUFFICIENT },
      rsi: { ...INSUFFICIENT },
      macd: { ...INSUFFICIENT },
      tsi: { ...INSUFFICIENT },
      fiftyTwoWeeks: { ...INSUFFICIENT },
    };
    renderCard({ position: none, series: [], asOf: null });
    const content = () => document.getElementById("security-technical-content")!.textContent;
    expect(content()).toBe("zu wenig Kursdaten");
    await open();
    expect(content()).toBe("zu wenig Kursdaten");
    expect(screen.queryByRole("group", { name: "Indikator" })).toBeNull();
    expect(screen.queryByRole("figure")).toBeNull();
  });
});
