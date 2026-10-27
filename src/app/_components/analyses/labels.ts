import type { AllocationHolding, AllocationLabels } from "@/core/allocation";
import type { CompositionHolding, CompositionSegment } from "@/core/composition";
import Decimal from "decimal.js";
import { formatDate, formatMoney, formatMonth, formatPercent, formatShare } from "@/core/format";
import type { DividendAnalysis, DividendBucket, DividendSecurity } from "@/core/dividend-analysis";
import type { GainsBucket, GainsSale } from "@/core/gains-analysis";
import type { AssetType } from "@/modules/ledger";
import type { Classification } from "@/modules/classification";
import { ratioTone } from "../security-detail/labels";
import { ASSET_TYPE_LABELS } from "../transactions/labels";

/** Analysen tabs, driven by `?tab=`. */
export const ANALYSIS_TABS = [
  { value: "allocation", label: "Aufteilung" },
  { value: "returns", label: "Rendite" },
  { value: "gains", label: "Gewinne" },
  { value: "dividends", label: "Dividenden" },
] as const;

export type AnalysisTab = (typeof ANALYSIS_TABS)[number]["value"];

export const DEFAULT_ANALYSIS_TAB: AnalysisTab = "allocation";

/** The tab named by a `?tab=` value; unknown or missing values give the default. */
export function analysisTab(value: string | string[] | undefined): AnalysisTab {
  const raw = first(value);
  return ANALYSIS_TABS.find((tab) => tab.value === raw)?.value ?? DEFAULT_ANALYSIS_TAB;
}

export const analysisTabId = (tab: AnalysisTab) => `analysis-tab-${tab}`;
export const analysisTabPanelId = (tab: AnalysisTab) => `analysis-tabpanel-${tab}`;

/** Allocation dimensions with their German labels, in selector order. */
export const ALLOCATION_DIMENSIONS = {
  assetClass: "Anlageklasse",
  type: "Wertpapiertyp",
  sector: "Sektor",
  industry: "Branche",
  region: "Region",
  country: "Land",
  companySize: "Unternehmensgröße",
  currency: "Währung",
} as const;

export type AllocationDimension = keyof typeof ALLOCATION_DIMENSIONS;

export const DEFAULT_ALLOCATION_DIMENSION: AllocationDimension = "assetClass";

/** Scope value of the whole Portfolio (all non-archived Depots); otherwise the scope is a Depot id. */
export const PORTFOLIO_SCOPE = "portfolio";
export const PORTFOLIO_LABEL = "Portfolio";

export const ALLOCATION_LABELS: AllocationLabels = { cash: "Guthaben", unknown: "Unbekannt" };

export const NOT_APPLICABLE_LABEL = "Nicht zutreffend";

export const ALLOCATION_EMPTY_TEXT = "Keine Werte vorhanden.";
export const ALLOCATION_CASH_TEXT = "Guthaben der Cash-Konten – keine Positionen.";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?scope=`: a known (non-archived) Depot id, else the Portfolio. */
export function analysisScope(value: string | string[] | undefined, depotIds: readonly string[]): string {
  const raw = first(value);
  return raw !== undefined && depotIds.includes(raw) ? raw : PORTFOLIO_SCOPE;
}

/** `?dimension=`: a known dimension, else Anlageklasse. */
export function allocationDimension(value: string | string[] | undefined): AllocationDimension {
  const raw = first(value);
  return raw !== undefined && Object.hasOwn(ALLOCATION_DIMENSIONS, raw) ? (raw as AllocationDimension) : DEFAULT_ALLOCATION_DIMENSION;
}

/** URL of an Analysen tab; scope and dimension stay in the URL on every tab, so switching keeps them. */
export function analysisHref(tab: AnalysisTab, scope: string, dimension: AllocationDimension): string {
  const params = new URLSearchParams({ tab, scope, dimension });
  return `/analyses?${params.toString()}`;
}

/** URL of the allocation tab with the given scope and dimension. */
export function allocationHref(scope: string, dimension: AllocationDimension): string {
  return analysisHref("allocation", scope, dimension);
}

/**
 * Group label of a Security in a dimension (effective value, manual wins); `null` = "Unbekannt".
 * Wertpapiertyp uses the ledger's asset type; company size "–" means "Nicht zutreffend".
 */
export function groupOf(classification: Classification | undefined, dimension: AllocationDimension): string | null {
  if (!classification) return null;
  if (dimension === "type") {
    return classification.type === "UNCLASSIFIED" ? null : (ASSET_TYPE_LABELS[classification.type as AssetType] ?? classification.type);
  }
  const value = classification[dimension].value;
  if (value === null) return null;
  if (dimension === "companySize" && value === "–") return NOT_APPLICABLE_LABEL;
  return value;
}

/** Composition holdings with their group in the dimension. */
export function allocationHoldings(
  holdings: readonly CompositionHolding[],
  classifications: Readonly<Record<string, Classification>>,
  dimension: AllocationDimension,
): AllocationHolding[] {
  return holdings.map((holding) => ({ ...holding, group: groupOf(classifications[holding.securityId], dimension) }));
}

/** Text alternative of the donut: `Aufteilung nach Sektor: Technologie 60,0 % (600,00 €), …`. */
export function allocationAriaLabel(dimensionLabel: string, segments: readonly CompositionSegment[]): string {
  const parts = segments.map((s) => `${s.label} ${formatShare(s.displayShare)} (${formatMoney(s.amount)})`);
  return `Aufteilung nach ${dimensionLabel}: ${parts.join(", ")}`;
}

/** Column labels of the return heatmap. */
export const HEATMAP_MONTH_LABELS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"] as const;
export const HEATMAP_QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"] as const;
export const HEATMAP_YEAR_LABEL = "Jahr";
export const HEATMAP_RUNNING_LABEL = "laufend";
export const HEATMAP_EMPTY_TEXT = "Noch keine Transaktionen.";

/** |r| at which a heatmap cell reaches full intensity. */
export const HEATMAP_INTENSITY_CAP = "0.1";

export type HeatmapTone = { tone: "gain" | "loss" | "neutral"; intensity: number };

/**
 * Tint of a heatmap cell by its value as displayed (`ratioTone`): gain above, loss below 0,00 %, neutral
 * when it shows as 0,00 % or `null`; intensity = |r| / 10 %,
 * capped at 1. The cell always shows the signed value too, so colour is never the only cue.
 */
export function heatmapCellTone(ratio: string | null): HeatmapTone {
  const tone = ratioTone(ratio);
  if (ratio === null || tone === null) return { tone: "neutral", intensity: 0 };
  const intensity = Decimal.min(new Decimal(ratio).abs().dividedBy(HEATMAP_INTENSITY_CAP), 1).toNumber();
  return { tone, intensity };
}

/**
 * Opacity of the gain/loss tint over the card surface for an intensity: 0.12 + 0.48·i in light mode;
 * dark mode tops out lower (0.12 + 0.28·i) so the light text keeps WCAG AA contrast on the brighter tints.
 */
export function heatmapTintAlpha(intensity: number, mode: "light" | "dark"): number {
  return 0.12 + (mode === "light" ? 0.48 : 0.28) * intensity;
}

/** Gewinne tab: views, layers, headings and texts. */
export const GAINS_VIEWS = [
  { value: "months", label: "Monate" },
  { value: "years", label: "Jahre" },
] as const;

export type GainsView = (typeof GAINS_VIEWS)[number]["value"];

export const GAINS_LABELS = {
  view: "Ansicht",
  year: "Jahr",
  dividendsLayer: "Dividenden",
  feesLayer: "Gebühren",
  gainsHeading: "Realisierte Gewinne",
  cashFlowHeading: "Kapitalfluss",
  realized: "Realisiert",
  dividends: "Dividenden",
  fees: "Gebühren",
  taxes: "Steuern gezahlt",
  deposits: "Einzahlungen",
  withdrawals: "Auszahlungen",
  net: "Netto",
  period: "Zeitraum",
  sales: "Verkäufe",
  bestHeading: "Beste Verkäufe",
  worstHeading: "Schlechteste Verkäufe",
} as const;

export const GAINS_EMPTY_TEXT = "Noch keine Transaktionen.";
export const GAINS_NO_BEST_TEXT = "Keine Verkäufe mit Gewinn.";
export const GAINS_NO_WORST_TEXT = "Keine Verkäufe mit Verlust.";
export const GAINS_NO_SALES_TEXT = "Keine Verkäufe im Zeitraum.";

/** `-value` as a decimal string (`"0"` for zero): fees and withdrawals shown as money going out. */
export function negateAmount(value: string): string {
  const negated = new Decimal(value).negated();
  return negated.isZero() ? "0" : negated.toFixed();
}

/** Years of the analysis, newest first (the "Jahr" select). */
export function gainsYears(years: readonly { period: string }[]): string[] {
  return years.map((year) => year.period).reverse();
}

/** The buckets a view shows: the months of `year` (Monate) or every year (Jahre). */
export function gainsBuckets(months: readonly GainsBucket[], years: readonly GainsBucket[], view: GainsView, year: string): GainsBucket[] {
  return view === "years" ? [...years] : months.filter((month) => month.period.startsWith(`${year}-`));
}

/** The sales a view covers: those dated in `year` (Monate) or all (Jahre). */
export function gainsSalesInRange(sales: readonly GainsSale[], view: GainsView, year: string): GainsSale[] {
  return view === "years" ? [...sales] : sales.filter((sale) => sale.date.startsWith(`${year}-`));
}

/** Short axis/table label of a bucket: `Jan` for a month, `2026` for a year. */
export function gainsBucketShortLabel(period: string): string {
  return period.length === 7 ? HEATMAP_MONTH_LABELS[Number(period.slice(5, 7)) - 1] : period;
}

/** Full label of a bucket: `Januar 2026` for a month, `2026` for a year. */
export function gainsBucketLabel(period: string): string {
  return period.length === 7 ? formatMonth(`${period}-01`) : period;
}

type BucketAmount = Exclude<keyof GainsBucket, "period">;

/** Σ of each amount over `buckets` (the summary of the selected range). */
export function sumGainsBuckets(buckets: readonly GainsBucket[]): Omit<GainsBucket, "period"> {
  const keys: BucketAmount[] = ["realized", "dividends", "fees", "taxes", "deposits", "withdrawals", "netCashFlow"];
  return Object.fromEntries(
    keys.map((key) => {
      const sum = buckets.reduce((total, bucket) => total.plus(bucket[key]), new Decimal(0));
      return [key, sum.isZero() ? "0" : sum.toFixed()];
    }),
  ) as Omit<GainsBucket, "period">;
}

/**
 * Text alternative of the gains chart: `Realisierte Gewinne: Januar 2026 Realisiert +77,60 €, Dividenden
 * +30,00 €, Gebühren -0,50 €; …` (fees as their negative contribution; only switched-on layers).
 */
export function gainsChartAriaLabel(buckets: readonly GainsBucket[], layers: { dividends: boolean; fees: boolean }): string {
  const parts = buckets.map((bucket) => {
    const values = [`${GAINS_LABELS.realized} ${formatMoney(bucket.realized, { sign: true })}`];
    if (layers.dividends) values.push(`${GAINS_LABELS.dividends} ${formatMoney(bucket.dividends, { sign: true })}`);
    if (layers.fees) values.push(`${GAINS_LABELS.fees} ${formatMoney(negateAmount(bucket.fees), { sign: true })}`);
    return `${gainsBucketLabel(bucket.period)} ${values.join(", ")}`;
  });
  return `${GAINS_LABELS.gainsHeading}: ${parts.join("; ")}`;
}

/** Text alternative of the Kapitalfluss chart: `Kapitalfluss (netto): Januar 2026 +2.000,00 €; …`. */
export function cashFlowAriaLabel(buckets: readonly GainsBucket[]): string {
  const parts = buckets.map((bucket) => `${gainsBucketLabel(bucket.period)} ${formatMoney(bucket.netCashFlow, { sign: true })}`);
  return `${GAINS_LABELS.cashFlowHeading} (netto): ${parts.join("; ")}`;
}

/** Dividenden tab: views, amount modes, headings and texts. */
export const DIVIDEND_VIEWS = [
  { value: "months", label: "Monate" },
  { value: "years", label: "Jahre" },
  { value: "cumulative", label: "Kumuliert" },
  { value: "securities", label: "Wertpapiere" },
  { value: "expected", label: "Erwartet" },
] as const;

export type DividendView = (typeof DIVIDEND_VIEWS)[number]["value"];

export const DIVIDEND_MODES = [
  { value: "gross", label: "Brutto" },
  { value: "net", label: "Netto" },
] as const;

export type DividendMode = (typeof DIVIDEND_MODES)[number]["value"];

export const DIVIDEND_LABELS = {
  view: "Ansicht",
  year: "Jahr",
  mode: "Betrag",
  kpis: "Kennzahlen",
  income: "Einkommen 12 Monate",
  yield: "Dividendenrendite 12 Monate",
  expectedKpi: "Erwartet 12 Monate (Schätzung)",
  monthsHeading: "Dividenden pro Monat",
  yearsHeading: "Dividenden pro Jahr",
  cumulativeHeading: "Dividenden kumuliert",
  securitiesHeading: "Dividenden nach Wertpapier",
  expectedHeading: "Erwartete Dividenden (Schätzung)",
  expectedList: "Erwartete Zahlungen",
  total: "Summe",
} as const;

export const DIVIDEND_EMPTY_TEXT = "Noch keine Transaktionen.";
export const DIVIDEND_NONE_TEXT = "Noch keine Dividenden.";
export const DIVIDEND_NO_EXPECTED_TEXT = "Keine erwarteten Zahlungen.";
export const DIVIDEND_ESTIMATE_NOTE = "Schätzung: Zahlungen der letzten 12 Monate in denselben Monaten, mit aktuellem Bestand.";
export const DIVIDEND_MISSING = "–";

/** The bucket views with their chart headings. */
export type DividendBucketView = Exclude<DividendView, "securities">;

export const DIVIDEND_BUCKET_HEADINGS: Record<DividendBucketView, string> = {
  months: DIVIDEND_LABELS.monthsHeading,
  years: DIVIDEND_LABELS.yearsHeading,
  cumulative: DIVIDEND_LABELS.cumulativeHeading,
  expected: DIVIDEND_LABELS.expectedHeading,
};

/** The gross or net amount of a bucket, Security total or expected payment. */
export function dividendAmount(item: { gross: string; net: string }, mode: DividendMode): string {
  return mode === "net" ? item.net : item.gross;
}

/** Σ of the mode's amount over `items` (decimal string). */
export function sumDividendAmounts(items: readonly { gross: string; net: string }[], mode: DividendMode): string {
  const sum = items.reduce((total, item) => total.plus(dividendAmount(item, mode)), new Decimal(0));
  return sum.isZero() ? "0" : sum.toFixed();
}

/** The buckets a view shows: months of `year`, years, the running total per year or the expected months. */
export function dividendBuckets(analysis: DividendAnalysis, view: DividendBucketView, year: string): DividendBucket[] {
  switch (view) {
    case "months":
      return analysis.months.filter((month) => month.period.startsWith(`${year}-`));
    case "years":
      return [...analysis.years];
    case "cumulative":
      return [...analysis.cumulative];
    case "expected":
      return [...analysis.expectedMonths];
  }
}

/** The total under a bucket chart: Σ of the shown buckets, or the last running total (Kumuliert). */
export function dividendRangeTotal(buckets: readonly DividendBucket[], view: DividendBucketView, mode: DividendMode): string {
  if (view === "cumulative") return buckets.length === 0 ? "0" : dividendAmount(buckets[buckets.length - 1], mode);
  return sumDividendAmounts(buckets, mode);
}

/** `Brutto` / `Netto`. */
export function dividendModeLabel(mode: DividendMode): string {
  return mode === "net" ? "Netto" : "Brutto";
}

/** Yield as an unsigned percentage with two decimals (`3,00 %`), `–` without one. */
export function dividendYieldText(ratio: string | null): string {
  return ratio === null ? DIVIDEND_MISSING : formatPercent(ratio).replace(/^\+/, "");
}

/** Text alternative of a bucket chart: `Dividenden pro Monat (Brutto): Januar 2026 0,00 €; …`. */
export function dividendChartAriaLabel(heading: string, buckets: readonly DividendBucket[], mode: DividendMode): string {
  const parts = buckets.map((bucket) => `${gainsBucketLabel(bucket.period)} ${formatMoney(dividendAmount(bucket, mode))}`);
  return `${heading} (${dividendModeLabel(mode)}): ${parts.join("; ")}`;
}

/** Text alternative of the per-Security chart: `Dividenden nach Wertpapier (Netto): SAP SE 44,50 €; …`. */
export function dividendSecuritiesAriaLabel(securities: readonly DividendSecurity[], names: Readonly<Record<string, string>>, mode: DividendMode): string {
  const parts = securities.map((security) => `${names[security.securityId] ?? security.securityId} ${formatMoney(dividendAmount(security, mode))}`);
  return `${DIVIDEND_LABELS.securitiesHeading} (${dividendModeLabel(mode)}): ${parts.join("; ")}`;
}

/** `2 Zahlungen · zuletzt 10.05.2026`. */
export function dividendCountText(count: number, lastDate: string): string {
  return `${count} ${count === 1 ? "Zahlung" : "Zahlungen"} · zuletzt ${formatDate(lastDate)}`;
}

/** `15.11.2026 · aus Zahlung vom 15.11.2025`. */
export function expectedDividendText(date: string, basedOn: string): string {
  return `${formatDate(date)} · aus Zahlung vom ${formatDate(basedOn)}`;
}
