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
});
