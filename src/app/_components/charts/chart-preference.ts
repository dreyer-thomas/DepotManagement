/**
 * Chart choices that persist per browser like the global Period (story 7-6): the value-chart tab of
 * Overview and Depot detail (one shared cookie), the Security chart mode and (story 7-8) the "Kurs"
 * moving-average overlay. Written client-side on
 * change (no server action, so switching never refreshes the page) and read by the server page for the
 * initial state. Not httpOnly: the cookies hold only a UI choice.
 */

export const VALUE_CHART_TAB_COOKIE = "dm_chart_tab";
export const SECURITY_CHART_COOKIE = "dm_security_chart";
export const MOVING_AVERAGE_COOKIE = "dm_moving_average";

/** About one year, as the Period cookie. */
export const CHART_PREFERENCE_MAX_AGE = 365 * 24 * 60 * 60;

export const VALUE_CHART_TABS = ["performance", "drawdown"] as const;
export type ValueChartTab = (typeof VALUE_CHART_TABS)[number];
export const DEFAULT_VALUE_CHART_TAB: ValueChartTab = "performance";

export const SECURITY_CHART_MODES = ["price", "value", "performance", "drawdown"] as const;
export type SecurityChartMode = (typeof SECURITY_CHART_MODES)[number];
export const DEFAULT_SECURITY_CHART_MODE: SecurityChartMode = "price";

/** The stored value-chart tab; a missing or invalid value gives `performance`. */
export function parseValueChartTab(value: string | undefined | null): ValueChartTab {
  return VALUE_CHART_TABS.find((tab) => tab === value) ?? DEFAULT_VALUE_CHART_TAB;
}

/** The stored Security chart mode; a missing or invalid value gives `price`. */
export function parseSecurityChartMode(value: string | undefined | null): SecurityChartMode {
  return SECURITY_CHART_MODES.find((mode) => mode === value) ?? DEFAULT_SECURITY_CHART_MODE;
}

/** Moving-average overlay of the "Kurs" chart (story 7-8): off, or on with 200 / 38 stored closes. */
export const MOVING_AVERAGE_CHOICES = ["off", "200", "38"] as const;
export type MovingAverageChoice = (typeof MOVING_AVERAGE_CHOICES)[number];
export const DEFAULT_MOVING_AVERAGE: MovingAverageChoice = "off";

/** The stored moving-average choice; a missing or invalid value gives `off`. */
export function parseMovingAverage(value: string | undefined | null): MovingAverageChoice {
  return MOVING_AVERAGE_CHOICES.find((choice) => choice === value) ?? DEFAULT_MOVING_AVERAGE;
}

/** The `document.cookie` assignment for a choice: `path=/`, `SameSite=Lax`, one year, `Secure` on https. */
export function chartPreferenceCookie(name: string, value: string, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "path=/", `max-age=${CHART_PREFERENCE_MAX_AGE}`, "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Stores a chart choice in the browser (client components only); never reloads the page. */
export function storeChartPreference(
  name: typeof VALUE_CHART_TAB_COOKIE | typeof SECURITY_CHART_COOKIE | typeof MOVING_AVERAGE_COOKIE,
  value: string,
): void {
  if (typeof document === "undefined") return;
  document.cookie = chartPreferenceCookie(name, value, window.location.protocol === "https:");
}
