/**
 * The first date of a Security's provider price history (AD-9 amended), from its pricing roles: held or
 * formerly held (`firstActivity`, its first Transaction date), watched (`watchedFrom`, as given) and
 * benchmark (`firstLedger`, the earliest ledger date). Pure; `today` is passed in.
 */
import { benchmarkStartDate, bufferedPresetStart } from "./benchmarks";

export type PriceHistoryRoles = {
  /** First activity date (first Transaction or ISIN-change date); absent without ledger activity. */
  firstActivity?: string | null;
  /** Price-history start of a watched Security (absent when not watched). */
  watchedFrom?: string | null;
  /** Earliest ledger date, set only for a benchmark Security. */
  firstLedger?: string | null;
};

/**
 * The earliest of: held start = the earlier of `firstActivity` and the buffered `3J` start
 * (`bufferedPresetStart`), so a recently bought Security gets about 3 years of history while an older
 * holding keeps its first activity date; `watchedFrom` as given; benchmark start
 * `benchmarkStartDate(firstLedger, today)`. `null` when the Security has no role (not priced).
 */
export function priceHistoryStart(roles: PriceHistoryRoles, today: string): string | null {
  const starts: string[] = [];
  if (roles.firstActivity) {
    const preset = bufferedPresetStart(today);
    starts.push(roles.firstActivity < preset ? roles.firstActivity : preset);
  }
  if (roles.watchedFrom) starts.push(roles.watchedFrom);
  if (roles.firstLedger) starts.push(benchmarkStartDate(roles.firstLedger, today));
  if (starts.length === 0) return null;
  return starts.reduce((earliest, date) => (date < earliest ? date : earliest));
}
