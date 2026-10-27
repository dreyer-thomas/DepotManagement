import { ExactDecimal } from "@/core/decimal";
import { formatMoney, formatPercent, formatQuantity } from "@/core/format";
import type { SecuritySummary } from "@/modules/ledger";
import type { SecurityChartMode } from "../charts/chart-preference";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

export const NO_TRANSACTIONS_TEXT = "Noch keine Buchungen.";
export const NO_LOTS_TEXT = "Keine offenen Kaufposten.";
export const NO_PRICE_TEXT = "Kein Kurs vorhanden.";
export const STALE_HINT_TEXT = "Keine Kursquelle liefert aktuelle Kurse.";
export const ALL_DEPOTS_LABEL = "Alle Depots";
export const MISSING = "–";

/** The Security detail page, optionally with a Depot selected: `/securities/<id>?depot=<depotId>`. */
export function securityHref(securityId: string, depotId?: string | null): string {
  const base = `/securities/${encodeURIComponent(securityId)}`;
  return depotId ? `${base}?depot=${encodeURIComponent(depotId)}` : base;
}

/** Header caption: `IE00B4L5Y983 · ETF` (crypto: the symbol). */
export function securityCaption(security: Pick<SecuritySummary, "isin" | "cryptoSymbol" | "assetType">): string {
  return `${security.isin ?? security.cryptoSymbol ?? ""} · ${ASSET_TYPE_LABELS[security.assetType]}`;
}

/** Hero label: `Wert · 310 Stück à 112,46 €`, without a price `Wert · 310 Stück`. */
export function heroLabel(quantity: string, price: string | null): string {
  const base = `Wert · ${formatQuantity(quantity)} Stück`;
  return price === null ? base : `${base} à ${formatMoney(price)}`;
}

/** Depot switcher label: the name, `(archiviert)` appended for an archived Depot. */
export function depotLabel(depot: { name: string; archived: boolean }): string {
  return depot.archived ? `${depot.name} (archiviert)` : depot.name;
}

/**
 * Hero chart modes: "Kurs" (price with trades), "Wert" (value development), "Performance" (cumulative
 * TTWROR of the holding) and "Drawdown" (price drawdown).
 */
export type ChartMode = SecurityChartMode;
export const CHART_MODE_LABELS: Record<ChartMode, string> = {
  price: "Kurs",
  value: "Wert",
  performance: "Performance",
  drawdown: "Drawdown",
};

/** The "Kurs" overlay switch and its window toggle (story 7-8). */
export const MOVING_AVERAGE_LABEL = "Gleitender Durchschnitt";
export const MOVING_AVERAGE_WINDOW_LABELS = { "200": "200 Tage", "38": "38 Tage" } as const;

/** Heatmap card of the Security page (story 7-8). */
export const SECURITY_HEATMAP_HEADING = "Performance-Heatmap";
export const PORTFOLIO_HEATMAP_LINK_TEXT = "Zur Heatmap des gesamten Portfolios";

export const TOTAL_HEADING = "Gesamt seit Erstkauf";

/** Signed money or `–`: `+198,00 €`. */
export function signedMoneyOrMissing(amount: string | null): string {
  return amount === null ? MISSING : formatMoney(amount, { sign: true });
}

/** `+19,78 %` or `–`. */
export function percentOrMissing(ratio: string | null): string {
  return ratio === null ? MISSING : formatPercent(ratio);
}

/** Tone of a ratio as displayed (percent with two decimals): `null` when it shows as 0,00 %. */
export function ratioTone(ratio: string | null): "gain" | "loss" | null {
  if (ratio === null) return null;
  const shown = new ExactDecimal(ratio).times(100).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
  if (shown.isZero()) return null;
  return shown.isNegative() ? "loss" : "gain";
}
