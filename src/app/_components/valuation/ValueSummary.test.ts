import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderHtml } from "../../../../test/helpers/render-text";
import type { PeriodPerformance } from "@/core/returns";
import { ValueSummary, type ValueSummaryProps, xirrText } from "./ValueSummary";

describe("xirrText", () => {
  it("shows the signed annualised rate, or a dash when there is none", () => {
    expect(xirrText("0.1087")).toBe("XIRR +10,87\u00a0%");
    expect(xirrText("-0.05")).toBe("XIRR -5,00\u00a0%");
    expect(xirrText(null)).toBe("XIRR –");
  });
});

const PERFORMANCE: PeriodPerformance = {
  gain: "100",
  realized: "0",
  unrealized: "100",
  dividends: "0",
  fees: "0",
  feesContribution: "0",
  taxesPaid: "0",
  netExternalFlows: "0",
  ttwror: "0.1",
  xirr: null,
};

const PROPS: ValueSummaryProps = {
  value: "1100",
  investedCapital: "1000",
  cash: "0",
  dividends: "0",
  taxesPaid: "0",
  periodLabel: "1M",
  to: "2026-10-26",
  today: "2026-10-26",
  performance: PERFORMANCE,
};

describe("ValueSummary", () => {
  it("labels the section Depotwert by default, or with the given label", () => {
    expect(renderHtml(createElement(ValueSummary, PROPS))).toContain('aria-label="Depotwert"');
    const html = renderHtml(createElement(ValueSummary, { ...PROPS, label: "Portfoliowert" }));
    expect(html).toContain('aria-label="Portfoliowert"');
    expect(html).not.toContain('aria-label="Depotwert"');
  });

  it("renders no chart without a series", () => {
    expect(renderHtml(createElement(ValueSummary, PROPS))).not.toContain('role="figure"');
  });

  it("renders the value chart in the hero card, before the breakdown", () => {
    const series = [
      { date: "2026-10-25", value: "1000", positionsValue: "1000", cash: "0", investedCapital: "1000" },
      { date: "2026-10-26", value: "1100", positionsValue: "1100", cash: "0", investedCapital: "1000" },
    ];
    const html = renderHtml(createElement(ValueSummary, { ...PROPS, series }));
    const figure = html.indexOf('role="figure"');
    expect(figure).toBeGreaterThan(html.indexOf("XIRR"));
    expect(figure).toBeLessThan(html.indexOf("Aufschlüsselung"));
    expect(html).toContain(
      "Wertentwicklung 25.10.2026 – 26.10.2026: Wert von 1.000,00\u00a0€ auf 1.100,00\u00a0€, investiertes Kapital von 1.000,00\u00a0€ auf 1.000,00\u00a0€",
    );
  });

  it("adds the tabs Wertentwicklung | Drawdown with a drawdown, opening the given tab; none without", () => {
    const series = [
      { date: "2026-10-25", value: "1000", positionsValue: "1000", cash: "0", investedCapital: "1000" },
      { date: "2026-10-26", value: "900", positionsValue: "900", cash: "0", investedCapital: "1000" },
    ];
    const drawdown = {
      points: [
        { date: "2026-10-25", drawdown: "0" },
        { date: "2026-10-26", drawdown: "-0.1" },
      ],
      current: "-0.1",
      max: "-0.1",
      phase: { peak: "2026-10-25", end: "2026-10-26", recovered: false, days: 1 },
    };
    expect(renderHtml(createElement(ValueSummary, { ...PROPS, series }))).not.toContain('role="tab"');
    const performance = renderHtml(createElement(ValueSummary, { ...PROPS, series, drawdown }));
    expect(performance).toContain('role="tab"');
    expect(performance).toContain("Wertentwicklung 25.10.2026");
    expect(performance).not.toContain("Maximaler Drawdown");
    const html = renderHtml(createElement(ValueSummary, { ...PROPS, series, drawdown, chartTab: "drawdown" }));
    expect(html).toContain("Drawdown 25.10.2026 – 26.10.2026: maximaler Drawdown -10,00\u00a0%");
    expect(html).toContain("Maximaler Drawdown");
    expect(html.indexOf("Maximaler Drawdown")).toBeLessThan(html.indexOf("Aufschlüsselung"));
  });
});
