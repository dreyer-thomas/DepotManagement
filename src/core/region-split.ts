/**
 * Region split of global funds (story 8.4, AD-20). Pure: no lookups, no clock. A global equity ETF/fund
 * is spread over six split regions by approximate index weights from a dated rules table (no look-through,
 * nothing fetched); the user can store a manual split that always wins. Weights are canonical percent
 * decimal strings (`"72"`, `"2.5"`): each > 0 and ≤ 100, at most two decimals, summing to exactly 100;
 * zero regions are omitted. The allocation's "Region" dimension distributes a fund's value by its split.
 */
import { termPattern } from "./asset-type";
import { type ClassifiedAssetType, EXCLUSION, fundRules } from "./classification";
import { ExactDecimal, canonicalDecimal } from "./decimal";
import { parseDecimalInput } from "./decimal-input";

/** Split regions in display order (distinct from the single-region `REGIONS`). */
export const SPLIT_REGIONS = ["USA", "Europa", "Japan", "Pazifik ohne Japan", "Schwellenländer", "Sonstige"] as const;
export type SplitRegion = (typeof SPLIT_REGIONS)[number];

/** One region's weight in percent (canonical decimal string). */
export type RegionWeight = { region: SplitRegion; weight: string };
/** Non-zero weights in `SPLIT_REGIONS` order, summing to 100. */
export type RegionWeights = RegionWeight[];

/** A rule-table split: the index it approximates and the date of the weights. */
export type RuleRegionSplit = { index: string; asOf: string; weights: RegionWeights };

export type RegionSplitRule = RuleRegionSplit & { pattern: RegExp };

/** Date of the weights in the rules table (shown to the user). */
export const REGION_SPLIT_AS_OF = "2026-09-30";

function weights(percent: Partial<Record<SplitRegion, string>>): RegionWeights {
  return SPLIT_REGIONS.filter((region) => percent[region] !== undefined).map((region) => ({ region, weight: percent[region] as string }));
}

function rule(terms: readonly string[], index: string, percent: Partial<Record<SplitRegion, string>>): RegionSplitRule {
  return { pattern: termPattern(terms), index, asOf: REGION_SPLIT_AS_OF, weights: weights(percent) };
}

/** Pacific ex Japan is checked before the general `ex …` exclusion (its name contains one). */
const PACIFIC_EX_JAPAN = rule(["Pacific ex Japan", "Pazifik ex Japan"], "MSCI Pacific ex Japan", { "Pazifik ohne Japan": "100" });

/**
 * Single-region rules first (so "FTSE Developed Europe" is Europe and "MSCI Emerging Europe" is EM), then
 * the global ones; the first match wins (after Pacific ex Japan and the exclusion check). Each alias has its
 * own entry so the card names the index truthfully.
 */
export const REGION_SPLIT_RULES: readonly RegionSplitRule[] = [
  PACIFIC_EX_JAPAN,
  rule(["Emerging Markets", "Emerging Market", "Emerging", "EM"], "MSCI Emerging Markets", { Schwellenländer: "100" }),
  rule(["STOXX Europe 600"], "STOXX Europe 600", { Europa: "100" }),
  rule(["MSCI Europe"], "MSCI Europe", { Europa: "100" }),
  rule(["Europe"], "Europa-Index", { Europa: "100" }),
  rule(["S&P 500", "S&P500"], "S&P 500", { USA: "100" }),
  rule(["MSCI USA"], "MSCI USA", { USA: "100" }),
  rule(["MSCI Japan"], "MSCI Japan", { Japan: "100" }),
  rule(["Nikkei"], "Nikkei 225", { Japan: "100" }),
  rule(["TOPIX"], "TOPIX", { Japan: "100" }),
  rule(["ACWI", "All Country World", "All Country", "AC World"], "MSCI ACWI", {
    USA: "64",
    Europa: "13",
    Japan: "5",
    "Pazifik ohne Japan": "3",
    Schwellenländer: "11",
    Sonstige: "4",
  }),
  rule(["All-World", "All World"], "FTSE All-World", {
    USA: "62",
    Europa: "14",
    Japan: "6",
    "Pazifik ohne Japan": "3",
    Schwellenländer: "11",
    Sonstige: "4",
  }),
  rule(["FTSE Developed", "Developed World", "Developed Markets"], "FTSE Developed", {
    USA: "71",
    Europa: "15",
    Japan: "7",
    "Pazifik ohne Japan": "4",
    Sonstige: "3",
  }),
  rule(["MSCI World", "Core World"], "MSCI World", { USA: "72", Europa: "15", Japan: "6", "Pazifik ohne Japan": "4", Sonstige: "3" }),
];

const ANY_EXCLUSION = new RegExp(EXCLUSION.source, "iu");

/**
 * The rule split of an ETF/fund named `name`, or null. Only equity funds match (the name's asset-class rule
 * must give "Aktien", so bond, gold or money-market funds stay unmatched); a name with an `ex …` exclusion
 * other than Pacific ex Japan ("MSCI World ex USA") matches nothing.
 */
export function regionSplitRule(name: string): RuleRegionSplit | null {
  if (fundRules(name).assetClass !== "Aktien") return null;
  const match = PACIFIC_EX_JAPAN.pattern.test(name)
    ? PACIFIC_EX_JAPAN
    : ANY_EXCLUSION.test(name)
      ? undefined
      : REGION_SPLIT_RULES.find((candidate) => candidate.pattern.test(name));
  if (!match) return null;
  return { index: match.index, asOf: match.asOf, weights: match.weights.map((weight) => ({ ...weight })) };
}

// ---- Validation and storage ----

export type RegionSplitParseResult =
  | { ok: true; weights: RegionWeights | null }
  | { ok: false; reason: "split-invalid" | "split-sum" };

const HUNDRED = new ExactDecimal(100);

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Validates a split per region (German input such as `"2,5"` or canonical `"2.5"`; empty/absent = 0).
 * All empty → `weights: null` (no manual split). A non-string, non-numeric, negative, > 100 or more than
 * two decimals value is `split-invalid`; non-zero weights not summing to exactly 100 are `split-sum`.
 */
export function parseRegionSplit(input: Readonly<Partial<Record<SplitRegion, unknown>>>): RegionSplitParseResult {
  if (SPLIT_REGIONS.every((region) => isEmpty(input[region]))) return { ok: true, weights: null };
  const result: RegionWeights = [];
  let sum = new ExactDecimal(0);
  for (const region of SPLIT_REGIONS) {
    const raw = input[region];
    if (isEmpty(raw)) continue;
    if (typeof raw !== "string") return { ok: false, reason: "split-invalid" };
    const parsed = parseDecimalInput(raw);
    if (!parsed.ok || parsed.value === "") return { ok: false, reason: "split-invalid" };
    const weight = new ExactDecimal(parsed.value);
    if (weight.isNegative() || weight.gt(HUNDRED) || weight.decimalPlaces() > 2) return { ok: false, reason: "split-invalid" };
    if (weight.isZero()) continue;
    sum = sum.plus(weight);
    result.push({ region, weight: canonicalDecimal(weight) });
  }
  if (!sum.eq(HUNDRED)) return { ok: false, reason: "split-sum" };
  return { ok: true, weights: result };
}

/** Weights as a plain object in `SPLIT_REGIONS` order (export record / JSON column). */
export function regionSplitRecord(weights: readonly RegionWeight[]): Partial<Record<SplitRegion, string>> {
  const record: Partial<Record<SplitRegion, string>> = {};
  for (const region of SPLIT_REGIONS) {
    const found = weights.find((weight) => weight.region === region);
    if (found) record[region] = found.weight;
  }
  return record;
}

/** JSON column value of a split: `{"USA":"72","Europa":"15",…}` in `SPLIT_REGIONS` order. */
export function serializeRegionSplit(weights: readonly RegionWeight[]): string {
  return JSON.stringify(regionSplitRecord(weights));
}

/** Weights of a split record (only `SPLIT_REGIONS` keys, canonical values summing to 100), else null. */
export function regionSplitFromRecord(record: unknown): RegionWeights | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const entries = Object.entries(record);
  if (entries.some(([key, value]) => !(SPLIT_REGIONS as readonly string[]).includes(key) || typeof value !== "string")) return null;
  const parsed = parseRegionSplit(record as Partial<Record<SplitRegion, unknown>>);
  if (!parsed.ok || parsed.weights === null) return null;
  const canonical = parsed.weights.every((weight) => (record as Record<string, string>)[weight.region] === weight.weight);
  return canonical && parsed.weights.length === entries.length ? parsed.weights : null;
}

/** Weights of a stored JSON column; null for null, malformed JSON or an invalid split. */
export function deserializeRegionSplit(json: string | null): RegionWeights | null {
  if (json === null) return null;
  try {
    return regionSplitFromRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---- Effective split and distribution ----

export type EffectiveRegionSplit = {
  weights: RegionWeights;
  source: "manual" | "rule";
  /** Index label of a rule split; null for a manual one. */
  index: string | null;
  /** Date of the rule weights (`YYYY-MM-DD`); null for a manual one. */
  asOf: string | null;
};

/**
 * The split a fund's value is distributed by: only for ETF/FUND; manual split ?? (none when the region
 * dimension has a manual value: the user's single region wins) ?? rule split ?? none.
 */
export function effectiveRegionSplit(input: {
  assetType: ClassifiedAssetType | string;
  manual: RegionWeights | null;
  manualRegion: string | null;
  rule: RuleRegionSplit | null;
}): EffectiveRegionSplit | null {
  if (input.assetType !== "ETF" && input.assetType !== "FUND") return null;
  if (input.manual) return { weights: input.manual, source: "manual", index: null, asOf: null };
  if (input.manualRegion !== null) return null;
  if (input.rule) return { weights: input.rule.weights, source: "rule", index: input.rule.index, asOf: input.rule.asOf };
  return null;
}

/** One region's part of a holding: `value` (decimal string) and `weight` (fraction of the holding). */
export type RegionSlice = { region: SplitRegion; value: string; weight: string };

/**
 * Distributes `value` by `weights` (percent): each slice is `value × weight / 100`, the last slice takes the
 * remainder so the slices sum exactly to `value`. `weight` is the fraction (`"72"` → `"0.72"`).
 */
export function distributeByRegion(value: string, weights: readonly RegionWeight[]): RegionSlice[] {
  const total = new ExactDecimal(value);
  let rest = total;
  return weights.map((weight, index) => {
    const fraction = new ExactDecimal(weight.weight).div(HUNDRED);
    const slice = index === weights.length - 1 ? rest : total.times(fraction);
    rest = rest.minus(slice);
    return { region: weight.region, value: canonicalDecimal(slice), weight: canonicalDecimal(fraction) };
  });
}
