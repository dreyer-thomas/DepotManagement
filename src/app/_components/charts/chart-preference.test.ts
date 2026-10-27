// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  chartPreferenceCookie,
  MOVING_AVERAGE_COOKIE,
  parseMovingAverage,
  parseSecurityChartMode,
  parseValueChartTab,
  SECURITY_CHART_COOKIE,
  storeChartPreference,
  VALUE_CHART_TAB_COOKIE,
} from "./chart-preference";

describe("parseValueChartTab / parseSecurityChartMode", () => {
  it("accepts the known values and falls back to the default otherwise", () => {
    expect(parseValueChartTab("drawdown")).toBe("drawdown");
    expect(parseValueChartTab("performance")).toBe("performance");
    expect(parseValueChartTab("DRAWDOWN")).toBe("performance");
    expect(parseValueChartTab(undefined)).toBe("performance");
    expect(parseSecurityChartMode("value")).toBe("value");
    expect(parseSecurityChartMode("drawdown")).toBe("drawdown");
    expect(parseSecurityChartMode("price")).toBe("price");
    expect(parseSecurityChartMode("performance")).toBe("performance");
    expect(parseSecurityChartMode("Performance")).toBe("price");
    expect(parseSecurityChartMode(null)).toBe("price");
  });
});

describe("parseMovingAverage", () => {
  it("accepts off, 200 and 38; anything else is off", () => {
    expect(parseMovingAverage("38")).toBe("38");
    expect(parseMovingAverage("200")).toBe("200");
    expect(parseMovingAverage("off")).toBe("off");
    expect(parseMovingAverage("x")).toBe("off");
    expect(parseMovingAverage(undefined)).toBe("off");
  });
});

describe("chartPreferenceCookie", () => {
  it("sets path, one year, SameSite=Lax and Secure only on https", () => {
    expect(chartPreferenceCookie("dm_chart_tab", "drawdown", false)).toBe(
      "dm_chart_tab=drawdown; path=/; max-age=31536000; SameSite=Lax",
    );
    expect(chartPreferenceCookie("dm_security_chart", "value", true)).toBe(
      "dm_security_chart=value; path=/; max-age=31536000; SameSite=Lax; Secure",
    );
  });
});

describe("storeChartPreference", () => {
  afterEach(() => {
    document.cookie = `${VALUE_CHART_TAB_COOKIE}=; path=/; max-age=0`;
    document.cookie = `${SECURITY_CHART_COOKIE}=; path=/; max-age=0`;
    document.cookie = `${MOVING_AVERAGE_COOKIE}=; path=/; max-age=0`;
  });

  it("writes the cookie in the browser", () => {
    storeChartPreference(VALUE_CHART_TAB_COOKIE, "drawdown");
    storeChartPreference(SECURITY_CHART_COOKIE, "value");
    storeChartPreference(MOVING_AVERAGE_COOKIE, "38");
    expect(document.cookie).toContain("dm_moving_average=38");
    expect(document.cookie).toContain("dm_chart_tab=drawdown");
    expect(document.cookie).toContain("dm_security_chart=value");
  });
});
