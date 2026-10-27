// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  chartPreferenceCookie,
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
    expect(parseSecurityChartMode("performance")).toBe("price");
    expect(parseSecurityChartMode(null)).toBe("price");
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
  });

  it("writes the cookie in the browser", () => {
    storeChartPreference(VALUE_CHART_TAB_COOKIE, "drawdown");
    storeChartPreference(SECURITY_CHART_COOKIE, "value");
    expect(document.cookie).toContain("dm_chart_tab=drawdown");
    expect(document.cookie).toContain("dm_security_chart=value");
  });
});
