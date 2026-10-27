---
title: 'Story 8.2: Benchmark Comparison'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
deferred: []
baseline_revision: 'ee33d308eea81cd1a8478810d72a38ef2f83e2c6'
---

<intent-contract>

## Intent

**Problem:** Tommy cannot tell whether his Portfolio or a Depot beat a simple index investment or another Depot: the value chart only shows Wertentwicklung and Drawdown.

**Approach:** Add a third value-chart tab "Performance" on Overview and Depot detail showing the scope's cumulative TTWROR over the global Period (0 % at the Period start) plus an optional dashed comparison line chosen in "Vergleich mit" (four index ETFs, Gesamtportfolio, other Depots), with a KPI row of both returns and the difference in percentage points. The four benchmark ETFs become Security rows priced by the normal price pipeline but never held.

## Boundaries & Constraints

**Always:**
- One pure reference table of benchmarks in `src/core/benchmarks.ts`: MSCI World IE00B4L5Y983, MSCI ACWI IE00B6R52259, DAX DE0005933931, S&P 500 IE00B5BMR087 (asset type ETF, accumulating EUR UCITS ETFs).
- Line points are ratio strings (decimal.js), one per day from the start point (`start.date`, the day before `from`, value `"0"`) through `to`; `Number(...)` only in chart presentation helpers.
- Scope and Depot/Portfolio comparison lines = `ttwrorIndex(start, series, rows)` level − 1 from the same valuation as the Depot pages (AD-10); the last point equals `performance.ttwror` whenever that is non-null.
- Benchmark line = price return: daily resolver price (manual > provider > Transaction price, carried forward, split-adjusted via `securityPriceSeries`) divided by the base price on `start.date` − 1.
- `heldSecurities()` / `listHeldSecurities()` stay unchanged and remain the only definition of held; benchmarks never appear in Positions, totals, news, composition or analyses.
- UI text German, de-DE formats; touch targets ≥ 44 px; the comparison is distinguishable without colour (dashed line + legend + KPI labels); gains/losses signed.
- The "Vergleich mit" choice persists per browser in a cookie (shared by Overview and Depot detail), written client-side like `dm_chart_tab`; switching never reloads the page.

**Never:**
- No new Prisma model or migration; no ledger writes besides `ensureSecurity` for the four benchmark Securities.
- No provider call during page render; tests never hit live providers.
- Do not rename or reinterpret the existing `dm_chart_tab` value `performance` (= Wertentwicklung); the new tab gets a new value.
- No benchmark ETFs on the Overview stale alert, news, Positions, composition or Analysen views.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deposit in Period | start V=1000; d1 V=1100; d2 DEPOSIT 500, V=1650 | line 0, 0.1, 0.134375 (d2 factor 1650/1600) | — |
| Benchmark over weekend | closes Fri 100, Mon 103; `start.date` = Sat | base 100; Sat/Sun 0, Mon 0.03 | — |
| No close on/before start | first stored close after `start.date`, or none | benchmark line `null` → "Keine Kurse für den Vergleich" instead of the second line, no comparison KPIs | no throw |
| Choice unavailable | cookie `depot:<own id>`, an archived/unknown Depot, or `portfolio` on Overview | treated as "keiner" | — |
| No ledger rows at all | price refresh | no benchmark Securities created | — |
| Benchmark ISIN also held | user holds IE00B4L5Y983 | same Security row; Position as before; backfill from the earlier of its own first activity and the benchmark start | — |

</intent-contract>

## Code Map

- `src/app/_components/valuation/ValueChartTabs.tsx` -- tabs "Wertentwicklung | Drawdown" (`VALUE_CHART_TAB_LABELS`); add the "Performance" tab between them.
- `src/app/_components/charts/chart-preference.ts` -- `VALUE_CHART_TABS = ["performance","drawdown"]` (`performance` = Wertentwicklung), cookies, `storeChartPreference`; add tab value `ttwror` and cookie `dm_benchmark` + `parseBenchmarkChoice`.
- `src/app/_actions/chart-preference-cookie.ts` -- server readers of chart cookies; add `readBenchmarkChoice()`.
- `src/app/_components/charts/PerformanceChart.tsx`, `performance-chart.ts` -- Security performance line (story 7-8): reuse `performanceFormatters`, `performanceYDomain`, `utcDate`/`tickDates` patterns for the new comparison chart.
- `src/app/_components/charts/DrawdownChart.tsx` -- reference for a chart + KPI row inside a tab panel.
- `src/app/_components/valuation/ValueSummary.tsx` -- renders `ValueChartTabs` from `series`/`drawdown`/`chartTab`; pass the comparison data through.
- `src/app/(app)/(overview)/page.tsx` -- `portfolioValuation(period, today, undefined, { storedPrices: storedPriceHistory })`; `portfolio.depots[].valuation` already covers every non-archived Depot over the same Period.
- `src/app/(app)/depots/[id]/page.tsx` -- `depotValuation(...)` (lines ~99-104); add a `portfolioValuation({kind:"custom", from: valuation.from, to: valuation.to}, ...)` for Gesamtportfolio and the other Depots.
- `src/modules/ledger/valuation.ts` -- `valuationOver`, `indexDrawdown` (already computes `ttwrorIndex`), `DepotValuation`, `PortfolioValuation`; add `performanceLine` to both.
- `src/core/returns.ts:150` `ttwrorIndex`, `ratioString`, `ReturnDecimal`; `src/core/security.ts:375` `securityPriceSeries(observations, securityId, actions, from, to)` (split-adjusted, carried forward); `:459` `securityPerformanceLine` as a model.
- `src/modules/ledger/positions.ts` `lineageObservations(ids, actions, to, db, storedPrices)`; `corporate-actions.ts` `loadCorporateActions`; `securities.ts:132` `ensureSecurity({isin},{name,assetType})`, `findSecurityByKey`, `:202` `firstActivityDates`.
- `src/modules/prices/prices.ts:95` `heldPlans` -- the only place choosing which Securities are fetched (held ids → `mappingsOf` → `firstActivityDates`); `refreshPrices`/`backfillHeldPrices` both use it; `resolveMissingMappings` already maps every Security (OpenFIGI → `.DE`, Yahoo search fallback). `securityPriceInfo` flags stale only for held ids (keep).
- `src/modules/prices/prices.test.ts` -- fakes `charts`, `deps`, `security`, `buy`, `mapTo`, `providerRows`; `test/helpers/providers.ts`.
- Read-only evidence: news (`modules/news`) uses `listHeldSecurities` only; the Securities page, pickers, classification, logos and backup list all Security rows, so benchmark ETFs appear there as normal reference Securities (accepted: lets Tommy fix their mapping).

## Tasks & Acceptance

**Execution:**
- `src/core/benchmarks.ts` (+ `benchmarks.test.ts`) -- `BENCHMARKS` table `{key: "msci-world"|"msci-acwi"|"dax"|"sp500", label, isin, name}`; `benchmarkStartDate(firstLedgerDate, today)` = the earlier of `firstLedgerDate` and `addMonths(today, -36)` (the `3J` preset start), minus 10 days, so every preset Period has a base close even on a young ledger; `performanceLine(start, series, rows)` → `[{date,performance}]` incl. start point "0"; `priceReturnLine(prices: PricePoint[])` → line or `null` when the first (base) price is null or zero; `returnDifference(scope, comparison)` → ratio or null. Unit tests with the hand-calculated references of the I/O matrix -- pure core per AD-10.
- `src/core/format.ts` (+ test) -- `formatPercentagePoints(ratio)`: `"0.0123"` → `"+1,23 Pp."` -- KPI difference.
- `src/modules/ledger/valuation.ts` (+ test) -- add `performanceLine` to `DepotValuation` and `PortfolioValuation` (one `ttwrorIndex` call shared with `indexDrawdown`); add `benchmarkLines(startDate, to, db, {storedPrices})` → `Record<BenchmarkKey, PerformancePoint[] | null>` (Security by ISIN via `findSecurityByKey`, `null` when absent; observations via `lineageObservations`; `securityPriceSeries` from `startDate` to `to`; `priceReturnLine`); export from `modules/ledger/index.ts`. Tests: last point = `performance.ttwror`; benchmark line from stored closes; `null` without prices.
- `src/modules/ledger/securities.ts` -- `firstLedgerDate(db)` (earliest Transaction date of any Depot or null); `ensureBenchmarkSecurities(db)` → ids via `ensureSecurity` per table row; export both.
- `src/modules/prices/prices.ts` (+ test) -- in `heldPlans`: when `firstLedgerDate` is non-null, call `ensureBenchmarkSecurities` before `resolveMissingMappings`; plan targets = held ids with first activity dates merged with benchmark ids at `benchmarkStartDate(firstLedgerDate, today)` (earlier date wins); keep the existing full/incremental/backfillOnly logic per target. Tests: benchmarks created and backfilled from that date with a fake chart (young ledger: from today − 36 months − 10 days); not in `listHeldSecurities`; no benchmarks without ledger rows; held benchmark ISIN uses the earlier date; stale flags/news unaffected.
- `src/app/_components/charts/chart-preference.ts` (+ test), `src/app/_actions/chart-preference-cookie.ts` -- tab value `ttwror` (order performance, ttwror, drawdown); `BENCHMARK_COOKIE = "dm_benchmark"`, `parseBenchmarkChoice(value, availableKeys)` → key or `"none"`; `readBenchmarkChoice()`.
- `src/app/_components/charts/comparison-chart.ts` (+ test), `ComparisonChart.tsx` -- plot data aligning the comparison by date, tooltip lines (date, scope label + value, comparison label + value), aria label; x-charts `LineChart` with scope line solid (primary) and comparison dashed (`chart.series2`), legend, 0 % reference line.
- `src/app/_components/valuation/PerformancePanel.tsx` (+ `.dom.test.tsx`) -- every line travels with its Period return (`ttwror: string | null`; Depot/Portfolio = their `performance.ttwror`, benchmark = last line point); KPIs show that return (`null` → "–") and "Differenz" only when both returns are non-null, so the scope KPI always equals the hero TTWROR; "Vergleich mit" select (keiner, MSCI World, MSCI ACWI, DAX, S&P 500, Gesamtportfolio when offered, other Depots), the chart, KPI row (scope "Performance", comparison label, "Differenz" in Pp.), "Keine Kurse für den Vergleich" for a `null` line; stores choice via `storeChartPreference`. Tests include an `initialChoice` that is no option (select reads "keiner", no Differenz) and a scope with `ttwror` null ("–", no Differenz).
- `src/app/_components/valuation/ValueChartTabs.tsx`, `ValueSummary.tsx` (+ existing dom tests) -- third tab "Performance" rendering `PerformancePanel` when comparison data is given.
- `src/app/(app)/(overview)/page.tsx`, `src/app/(app)/depots/[id]/page.tsx` (+ page tests) -- build options: benchmarks via `benchmarkLines(start.date, to)`; Overview: every non-archived Depot's `valuation.performanceLine`; Depot detail: Gesamtportfolio + other non-archived Depots from the custom-Period `portfolioValuation`; pass `readBenchmarkChoice()`. Depot page tests also cover Period `MAX` where another Depot started earlier (Gesamtportfolio and Depot lines start at "0" on the Depot's `start.date`, same dates as the scope line) and a priced benchmark (index line on the scope line's dates).

**Acceptance Criteria:**
- Given the Overview or a Depot detail with Transactions, when Tommy opens the tab "Performance", then a line shows the cumulative TTWROR of the scope over the global Period starting at 0 %, with hover/tap values, and the KPI row shows the scope's return equal to the hero TTWROR.
- Given the Performance tab, when he chooses "MSCI World" in "Vergleich mit" and stored closes exist, then a dashed second line with a legend appears and the KPI row shows both returns and the difference in percentage points.
- Given a Depot detail, when he opens "Vergleich mit", then it offers keiner, the four indices, Gesamtportfolio and every other non-archived Depot (not the Depot itself); on Overview Gesamtportfolio is absent.
- Given a chosen comparison, when he reloads or opens the other page, then the same choice is preselected (when available there).
- Given a scheduled or manual price refresh with at least one ledger row, when it runs, then the four benchmark Securities exist, are mapped and have provider history from 10 days before the earlier of the earliest ledger date and today − 36 months, yet appear in no Position, total, news, composition or stale count.

## Spec Change Log

### 2026-10-27 — Review loop 1 (bad_spec)
- **Trigger:** review found that benchmark history started only 10 days before the first ledger date, so the default `1J`/`3J` Periods on a ledger younger than the Period showed "Keine Kurse für den Vergleich" despite stored closes; and the Performance KPIs took returns from the line end, showing "+0,00 %" and a Differenz while the hero shows no TTWROR (Period TTWROR `null`, e.g. a Depot without investment in the Period).
- **Amended:** `benchmarkStartDate(firstLedgerDate, today)` reaches back to the `3J` preset start; every comparison option and the scope carry their Period return (`ttwror`), KPIs/Differenz use it null-aware; extra tests (PerformancePanel unknown choice and null scope return; Depot detail `MAX` with an earlier other Depot; Depot detail priced benchmark). AC 5 updated accordingly.
- **Known-bad state avoided:** index comparison missing on preset Periods; KPI contradicting the hero TTWROR; untested Depot-detail alignment.
- **KEEP:** the first implementation passed lint/typecheck/tests/build and its review found no other defect. Start by applying the saved patch `_bmad-output/implementation-artifacts/spec-8-2-benchmark-comparison.patch` (`git apply`), then make only the amendments above. Keep: tab value `ttwror`, `dm_benchmark` cookie and `parseBenchmarkChoice`, `core/benchmarks.ts` table/line functions, `indexFigures` sharing one `ttwrorIndex` call, `benchmarkLines` via `lineageObservations` + `securityPriceSeries`, `ensureBenchmarkSecurities`/`firstLedgerDate`, `comparison-options.ts`, `ComparisonChart`/`PerformancePanel`, the page wiring, and all existing tests (adjust only expected start dates).

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 21 findings — high 0, medium 5, low 11, false 5, maybe-false 0
- findings:
  - `[medium]` `[bad_spec]` Blind: benchmark history only from first ledger date − 10, so 1J/3J on a young ledger show "Keine Kurse" — real: `resolvePeriod` does not clamp presets; amended `benchmarkStartDate` to reach the 3J start (change log loop 1).
  - `[medium]` `[bad_spec]` Blind: Performance KPI uses line end, contradicting the hero when `ttwror` is null — real: hero hides TTWROR, panel shows +0,00 % and Differenz; amended: lines carry their Period return, KPIs null-aware.
  - `[low]` `[bad_spec]` Blind: Depots without activity offered as a flat 0 % comparison with a misleading Differenz — same root cause as the KPI finding (return taken from the line instead of the Period TTWROR); covered by the same amendment.
  - `[low]` `[reject]` Blind: benchmark fetch failures appear by name in the refresh failure list — real but informative (lets Tommy fix their mapping on the Securities page); hiding them adds branches for a rare event.
  - `[low]` `[reject]` Blind: Depot detail always computes the Portfolio valuation sequentially — real cost, but single-user app with few Depots; eager computation is the spec's design for instant switching.
  - `[low]` `[reject]` Blind: `benchmarkLines` reloads corporate actions and queries per benchmark — 8 small queries, negligible; batching adds code.
  - `[low]` `[reject]` Blind: manual-over-provider and split behaviour of `benchmarkLines` untested — it delegates to `lineageObservations` and `securityPriceSeries`, both covered by existing tests.
  - `[low]` `[bad_spec]` Blind: PerformancePanel test title claims an unknown choice but tests a known one — real; required test added to the spec amendment.
  - `[low]` `[reject]` Blind: `heldPlans`/`backfillHeldPrices` names no longer fit and ensure step sits outside try/catch — naming is cosmetic; a DB error already throws from `listHeldSecurities` in the same function, so no new failure mode.
  - `[low]` `[reject]` Blind: duplicated `getComputedStyle` mock and `comparisonOf` helper in tests — cosmetic test duplication, matches the existing per-file pattern.
  - `[false]` `[reject]` Blind: series `valueFormatter`s in `ComparisonChart` are dead — x-charts uses series value formatters for its accessibility/legend descriptions, as in the existing `PerformanceChart`; not dead.
  - `[medium]` `[bad_spec]` Edge: Period start earlier than first ledger date − 10 gives null benchmark line — duplicate of the history-depth finding; same amendment.
  - `[false]` `[reject]` Edge: `ensureBenchmarkSecurities` outside try/catch makes the run reject — the module only promises never to throw for fetch failures; DB errors already propagate from `listHeldSecurities`/`mappingsOf`.
  - `[false]` `[reject]` Edge: benchmark ETFs appear in pickers and the Securities page — intended: AD-17 excludes them only from Positions, totals, news and analyses; the Securities page is where their mapping is fixed.
  - `[false]` `[reject]` Edge: PerformancePanel keeps a stale client choice after a server re-render — the client choice is the one stored in the cookie the server reads, so both agree; an unavailable key falls back to keiner.
  - `[medium]` `[bad_spec]` Edge (claim): scope KPI ≠ hero TTWROR when null — duplicate of the KPI finding; same amendment.
  - `[medium]` `[bad_spec]` Edge (claim): "stored closes exist" yet no line for Periods before the backfilled history — duplicate of the history-depth finding.
  - `[low]` `[bad_spec]` Verification gap: Depot detail comparison tested only with a custom Period (MAX with an earlier other Depot unverified) — real gap; test added to the spec amendment.
  - `[low]` `[bad_spec]` Verification gap: Depot detail never tests a priced benchmark — real gap; test added to the spec amendment.
  - `[low]` `[bad_spec]` Verification gap: PerformancePanel unknown-choice fallback untested — duplicate of the test-title finding; same amendment.
  - `[false]` `[reject]` Intent alignment: live benchmark pricing only exercised with mocked providers and no operator state — by policy tests never hit live providers; the scheduler fetches automatically, no human-only action exists.

### 2026-10-27 — Review pass (loop 1)
- verdicts: 18 findings — high 0, medium 0, low 13, false 5, maybe-false 0
- findings:
  - `[false]` `[reject]` Blind: benchmark ETF splits produce a fake crash — without a recorded split the Yahoo adapter stores Yahoo's adjusted history unchanged, so no jump; a recorded split triggers the existing refetch, as for held Securities.
  - `[low]` `[reject]` Blind: custom Periods earlier than the benchmark history show "Keine Kurse für den Vergleich" — the specified hint for missing history; fetching arbitrary history adds complexity for a rare case.
  - `[low]` `[reject]` Blind: chart aria label uses the line end while KPIs use `ttwror` — only differs when the Period TTWROR is null (rare); fix needs a new parameter.
  - `[low]` `[reject]` Blind: comparisons identical to the scope (single Depot) or flat — harmless (Differenz 0 or "–"); filtering adds branches.
  - `[low]` `[patch]` Blind: tooltip rows keyed by label give duplicate React keys for a Depot named like the scope — fixed: rows keyed by series (`scope`/`comparison`).
  - `[low]` `[reject]` Blind: no hint how to fix an unmapped benchmark — benchmarks are on the Securities page with their mapping; extra UI not required by the intent.
  - `[low]` `[patch]` Blind: Overview test accepts any Differenz number — fixed: asserts the exact `formatPercentagePoints(returnDifference(...))` text.
  - `[low]` `[reject]` Blind: no tests for stale alert/news/composition/analyses exclusion — all derive from `listHeldSecurities`, which the prices tests check together with Positions and `securityPriceInfo` stale flags.
  - `[low]` `[patch]` Blind: date-merge branch in `heldPlans` is dead — fixed: simplified to `firstDates.set(securityId, benchmarkFrom)` with a comment.
  - `[low]` `[reject]` Blind: Differenz KPI has no gain/loss tone — the sign carries the direction (never colour alone); a design nicety.
  - `[low]` `[reject]` Blind: comparison colour defined with a dead fallback in the chart — theme always defines `chart.series2`; cosmetic.
  - `[false]` `[reject]` Edge: `ensureBenchmarkSecurities` outside try/catch — carried: DB errors already propagate from `listHeldSecurities`/`mappingsOf`; only fetch failures are promised not to throw.
  - `[low]` `[reject]` Edge: a weeks-old base close is used when benchmark fetches keep failing — rare; the fetch error is visible on the Securities page; a staleness guard adds a branch.
  - `[false]` `[reject]` Edge: benchmark ETFs listed on the Securities page — carried: intended per AD-17 and the spec.
  - `[false]` `[reject]` Edge: y-axis ticks fit only the scope line — the y formatter formats any ratio (`formatPercent(String(ratio))`) and the axis domain comes from both series; ticks are correct.
  - `[false]` `[reject]` Edge: aria label may report a comparison value from another date — all comparison lines share the scope's `start.date..to` dates by construction.
  - `[low]` `[patch]` Verification gap: mapping test cannot detect benchmarks missing same-run mapping resolution — fixed: SAP mapped beforehand, `search` asserted with the MSCI World ISIN.
  - `[low]` `[reject]` Intent alignment: "never appear" verified only via the held set; live pricing only mocked — by policy no live providers in tests; exclusion surfaces all read `listHeldSecurities`.

## Design Notes

"Period start" is read as the valuation start point (`start.date` = end of the day before `from`): the TTWROR chain is based there, so the benchmark base is "the last close on or before" that day too. Both lines then start at exactly 0 % and the scope's last point equals the Depot pages' TTWROR.

All comparison lines are computed server-side for the render (few Depots, four indices) so switching is instant; lines share the dates `start.date..to`.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Overview and Depot detail get a third value-chart tab "Performance": the scope's cumulative TTWROR over the global Period (0 % on the valuation start point), a "Vergleich mit" select (keiner, MSCI World, MSCI ACWI, DAX, S&P 500, Gesamtportfolio on Depot detail, other non-archived Depots) drawn as a dashed second line with legend, and KPIs for both Period returns and the difference in Pp. ("–"/no Differenz when a return is null; "Keine Kurse für den Vergleich" without a base close). The choice persists in the `dm_benchmark` cookie. The four index ETFs are ensured as Securities by price runs (once the ledger has a row), mapped and backfilled from 10 days before the earlier of the first ledger date and today − 36 months; `listHeldSecurities` is unchanged, so they never count as held.

**Files changed:**
- `src/core/benchmarks.ts` (+test) — reference table, start date, performance/price-return lines, difference.
- `src/core/format.ts` (+test) — `formatPercentagePoints`.
- `src/modules/ledger/valuation.ts` (+test) — `performanceLine` on Depot/Portfolio valuations, `benchmarkLines`.
- `src/modules/ledger/securities.ts`, `index.ts` — `firstLedgerDate`, `ensureBenchmarkSecurities`.
- `src/modules/prices/prices.ts` (+test) — benchmark targets in the price plans.
- `src/app/_components/charts/chart-preference.ts` (+test), `src/app/_actions/chart-preference-cookie.ts` — tab `ttwror`, `dm_benchmark` cookie.
- `src/app/_components/charts/ComparisonChart.tsx`, `comparison-chart.ts` (+tests) — two-line chart.
- `src/app/_components/valuation/PerformancePanel.tsx`, `comparison-options.ts`, `ValueChartTabs.tsx`, `ValueSummary.tsx` (+tests) — panel, options, tab.
- `src/app/(app)/(overview)/page.tsx`, `src/app/(app)/depots/[id]/page.tsx` (+tests) — wiring.
- `test/architecture/chart-imports.test.ts` — allow the new chart component.
- `_bmad-output/implementation-artifacts/spec-8-2-benchmark-comparison.patch` — first implementation, kept as the loop-1 starting point.

**Review findings:** pass 1: 21 findings → bad_spec loop (benchmark history depth, null-aware KPIs, missing tests), 9 rejected (5 false, 4 low with reasons in the triage log). Pass 2 (loop 1): 18 findings → 4 low patches applied (tooltip keys, exact Differenz assertion, dead merge branch removed, mapping-order test), 0 deferred, 14 rejected (5 false, 9 low; reasons in the triage log). Patched by verdict: high 0, medium 0, low 4.

**Follow-up review recommendation:** false — no high or medium patch in the final pass.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (215 test files, 2934 tests; build compiled). Every I/O matrix row has a passing test.

**Residual risks:** first refresh after deploy fetches about 3 years of history for four ETFs; benchmark ETFs appear as reference Securities on the Securities page, pickers, classification, logos and backups (intended); Depot detail now also computes the Portfolio valuation on each render; real auto-mapping of the four ISINs is only exercised with recorded/mocked providers.
