---
title: 'Story 7.8: Security Analyses'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '7dc5b3de3599c25419ca6f35519dd3446c75f736'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-7-6-drawdown.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Security detail page shows price, value and drawdown, but not how one holding performed month by month, its time-weighted performance line, or the price against its trend — analyses Tommy has only for the Portfolio (FR-22, CAP-22, Addendum K).

**Approach:** Reuse the 7.3 core heatmap over the Position's all-time daily series for a "Performance-Heatmap" card; add two pure core functions (performance line from the TTWROR index of the Security's flows, moving average over split-adjusted stored Prices); the chart toggle gains "Performance" and the "Kurs" view a dashed "Gleitender Durchschnitt" overlay persisted in a cookie.

## Boundaries & Constraints

**Always:**
- Scope = the Depot switcher scope ("Alle Depots" or one Depot), Security chain as today; works for Securities no longer held.
- Heatmap: `returnHeatmap(start, series, securityFlowRows(scopeRows), today)` over the scope's Security series (`securitySeries`, per Depot summed with `sumValuationSeries`) from the day before the scope's first row to `today` — independent of the global Period. Years without any month return (total `null`) are dropped. Empty without rows.
- Card "Performance-Heatmap": toggle "Q | M" (default M, client state, ≥ 44 px): M = 12 month cells + "Gesamt" (year total); Q = Q1..Q4 + "Gesamt". Tint, signed value with arrow, "–" for a null return, empty cell for months outside the ledger range, running-month mark and tap-for-detail exactly as the 7.3 heatmap (shared component, the Portfolio tab's grid unchanged). Link "Zur Heatmap des gesamten Portfolios" → `analysisHref("returns", PORTFOLIO_SCOPE, DEFAULT_ALLOCATION_DIMENSION)`.
- Performance line (core `securityPerformanceLine(start, series, rows)`): per Period day `ttwrorIndex(start, series, securityFlowRows(rows)).level − 1` (ratio string; `"0"` before anything is invested). For "Alle Depots" over the summed series and all scope rows. Last point = `performance.ttwror` whenever that is non-null.
- Moving average (core `securityMovingAverage(observations, securityId, actions, from, to, window)`): stored Prices only (source `provider`/`manual`, never `transaction`), carried to the Security and units as of `to` like `securityPriceSeries`; one close per date = the resolver winner of that date (manual > provider); for each day `from..to` the arithmetic mean of the last `window` closes dated ≤ that day (history before `from` counts), rounded half-up to 10 decimal places (canonical string); `null` while fewer than `window` closes exist. Windows 200 and 38.
- Chart modes in order "Kurs", "Wert", "Performance", "Drawdown" (`SECURITY_CHART_MODES`, cookie `dm_security_chart` as 7.6). "Performance": line of the performance in %, 0 % reference line, axis tooltip (date, "Performance" signed %, the day's trade and dividend lines as Drawdown), buy/sell/dividend markers at the day's value, `role="figure"` aria-label `Performance <from> – <to>: <last signed %>`.
- "Kurs" overlay: switch "Gleitender Durchschnitt" (default off) and, when on, toggle "200 Tage | 38 Tage" (default 200); dashed line on the price chart, tooltip line "GD 200"/"GD 38" (`–` when null), aria-label mentions the overlay. Persisted in cookie `dm_moving_average` (`off | 200 | 38`, invalid → `off`), written client-side like 7.6, read by the page for the initial state.
- `src/core` pure; ledger stays the only DB reader; nothing stored; `Number(...)` only for plot coordinates; German labels; WCAG 2.2 AA (sign shown, keyboard-reachable tooltip, ≥ 44 px).

**Never:** a second TTWROR, flow or heatmap definition; moving average on transaction prices or the daily carried-forward series; changing the Portfolio/Depot heatmap, the "Wert"/"Drawdown" charts, existing figures or the other Analysen tabs; a server action or URL parameter for the chart choices.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sale in Period | start 2026-01-31 V 0; 02-01 BUY 10 amount 100, V 100; 02-02 V 110; 02-03 SELL 5 amount 60, V 60; 02-04 V 50 | performance "0", "0.1", "0.2", "0" | — |
| Split in Period | 02-01 BUY 10 @10 (V 100); split 1→2 dated 02-02, provider price 5.5 on 02-02 (series via `valuationSeries` + `securitySeries`) | 02-02 performance "0.1" (not −0.45) | — |
| Parity | any single-Depot and two-Depot fixture | last point = `performance.ttwror` | — |
| MA window 3 | provider X 01-01 10, 01-02 12, 01-05 14, 01-06 16; manual 01-05 15; transaction price 01-03 100; from 01-01 to 01-06 | 01-01..01-04 null; 01-05 "12.3333333333"; 01-06 "14.3333333333" | — |
| MA with split | same closes, split 1→2 dated 01-04 (as of 01-06) | 01-05 "8.6666666667"; 01-06 "12.3333333333" | — |
| MA lookback | window 3, closes 01-01..01-03, from 01-03 | 01-03 = mean of all three | — |
| Sold Security | bought 2024-03, all sold 2025-06, today 2026-10-27 | heatmap years 2025, 2024 (2026 dropped); months after the sale "–" | — |
| Heatmap parity | any fixture | a year's total = TTWROR of that year's Security series (via 7.3 chaining) | — |
| No prices | no stored Prices | MA all null, overlay draws nothing | — |
| MA cookie | `dm_moving_average=38` / `x` | initial overlay on with 38 / off | — |

</intent-contract>

## Code Map

- `src/core/return-heatmap.ts:48` -- `returnHeatmap(start, series, rows, today)`; first month from `rows`; `HeatmapYear`/`HeatmapMonth`. Read-only reuse.
- `src/core/returns.ts:150` -- `ttwrorIndex` (base of the performance line); `ratioString`, `ReturnDecimal`.
- `src/core/security.ts:61,83,169,239,372` -- `securitySeries`, `securityFlowRows`, `sumSecurityPerformance`, private `adjustedObservations`, `securityPriceSeries` (pattern for MA); add both new functions here (+ `security.test.ts`, fixture style there).
- `src/core/prices.ts:15,40` -- `PriceObservation.source`, `compareObservations` (same-date winner).
- `src/core/valuation.ts:245` -- `sumValuationSeries` for the all-time "Alle Depots" series.
- `src/modules/ledger/security-detail.ts:44-70,140-205` -- `SecurityDetail` type and `evaluate` closure; add `performanceLine`, `movingAverages: Record<"200"|"38", {date; average: string|null}[]>` (priceSecurity, `from..to`), `heatmap: HeatmapYear[]`; reuse the Period series when it already spans first row..today. Test: `security-detail.test.ts`.
- `src/app/_components/analyses/ReturnHeatmap.tsx` -- add optional props (`heading`, heading id, `granularityToggle`, `footer`) without changing the default render; labels in `analyses/labels.ts:118-123`; `analysisHref`, `PORTFOLIO_SCOPE`, `DEFAULT_ALLOCATION_DIMENSION` there too. Dom test `ReturnHeatmap.dom.test.tsx`.
- `src/app/_components/charts/drawdown-chart.ts`, `DrawdownChart.tsx` -- template for `performance-chart.ts` / `PerformanceChart.tsx` (markers, tooltip, formatters, `dividendsOn`, `dividendLine`, `DrawdownChartDividend`).
- `src/app/_components/charts/PriceChart.tsx`, `price-chart.ts` -- add optional `average` points + window label: dashed series, tooltip line, aria-label suffix.
- `src/app/_components/charts/chart-preference.ts`, `src/app/_actions/chart-preference-cookie.ts` -- add `performance` mode, `MOVING_AVERAGE_COOKIE`, parse/read helpers; widen `storeChartPreference`.
- `src/app/_components/security-detail/SecurityChart.tsx`, `labels.ts:52` (`CHART_MODE_LABELS`), `SecurityDetail.dom.test.tsx` -- new mode and overlay controls.
- `src/app/(app)/securities/[id]/page.tsx` (+ `page.test.tsx`) -- wire props, cookie, heatmap card after `SecurityTotal`.
- `test/architecture/chart-imports.test.ts` -- add `PerformanceChart.tsx` to the allow-list.

## Tasks & Acceptance

**Execution:**
- `src/core/security.ts` (+ test) -- `securityPerformanceLine`, `securityMovingAverage`; tests cover every core matrix row with exact strings.
- `src/modules/ledger/security-detail.ts` (+ test) -- new fields; tests for sold-Security heatmap, parity and MA wiring (stored prices loader).
- `src/app/_components/charts/chart-preference.ts` (+ test), `src/app/_actions/chart-preference-cookie.ts` -- mode and MA cookie.
- `src/app/_components/charts/performance-chart.ts` (+ test), `PerformanceChart.tsx` (+ dom test), `test/architecture/chart-imports.test.ts`.
- `src/app/_components/charts/price-chart.ts`, `PriceChart.tsx` (+ tests) -- dashed MA overlay.
- `src/app/_components/analyses/ReturnHeatmap.tsx` (+ dom test) -- Q|M variant, Gesamt column, footer; default unchanged.
- `src/app/_components/security-detail/labels.ts`, `SecurityChart.tsx` (+ dom test) -- Performance mode, overlay switch/window toggle, cookie writes.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) -- props, card, link.

**Acceptance Criteria:**
- Given Security detail with "Alle Depots" or one Depot, then the "Performance-Heatmap" card shows monthly returns with "Gesamt", switches with "Q | M", and its link opens Analysen › Rendite.
- Given "Performance", when I hover or move by keyboard, then date, signed % and the day's trades/dividends show; buys and sells never appear as gains.
- Given "Kurs", when I switch "Gleitender Durchschnitt" on and pick 38 Tage, then a dashed average appears; after reload it is still on with 38 Tage.
- Given the Portfolio Rendite tab, "Wert", "Drawdown" and existing figures, then they behave as before.
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 28 findings — high 0, medium 0, low 22, false 6, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: overlay on with every average `null` draws nothing, yet the aria-label says "mit gleitendem Durchschnitt" and no hint shows — aria suffix now only when an average exists; caption "Zu wenig gespeicherte Kurse für GD <n>." when none (helper + DOM tests).
  - `[false]` `[reject]` Blind: Q mode shows "–" for quarters outside the ledger range while M leaves months empty — identical to the 7.3 Portfolio grid, where out-of-range quarters also render through `TotalCell` as "–"; "as in Story 7.3" holds.
  - `[low]` `[patch]` Blind: heatmap rebuild branch (non-MAX Period) only checked by year numbers — grouped with the verification-gap entry below.
  - `[low]` `[reject]` Blind: heatmap parity test uses a `Number` tolerance (1e-15) instead of exact strings — each monthly ratio is rounded to 20 places, so chained totals differ from the yearly TTWROR in the last digits by construction; a test-only `Number`, negligible.
  - `[low]` `[reject]` Blind: performance line and both moving averages always sent to the client — same scale as the existing price, value and drawdown series already sent; no measured harm.
  - `[low]` `[reject]` Blind: overlay object rebuilt each render, `find` per tooltip move — recomputation only on parent state changes; negligible.
  - `[low]` `[reject]` Blind: the "200"/"38" window set appears in four places — windows are fixed by the AC; consolidating adds churn without a caller that diverges today.
  - `[false]` `[reject]` Blind: some German aria strings hard-coded instead of in `labels.ts` — no user- or developer-visible defect named; labels render correctly.
  - `[false]` `[reject]` Blind: `securityMovingAverage` does not validate `window` (negative throws, non-integer wrong) — only called with 200 and 38; failing loudly on unreachable input is correct.
  - `[low]` `[reject]` Blind: all-time heatmap series rebuilt on every non-MAX page load — the Analysen Rendite tab does the same MAX evaluation; caching is new design beyond the story.
  - `[low]` `[patch]` Blind: M → Q → M reopens the tapped month detail — selection now cleared on granularity change; Q/M DOM test extended.
  - `[low]` `[reject]` Blind: no page test that `dm_security_chart=performance` starts in Performance — the page passes the parsed mode through unchanged (tested for drawdown in 7.6) and the parser test covers `performance`.
  - `[low]` `[patch]` Blind: no two-Depot heatmap value test — grouped with the verification-gap entry below.
  - `[low]` `[reject]` Blind: no test with an ISIN change or split before the heatmap range — the series and flow rows are the existing, tested Security engine; rare.
  - `[low]` `[reject]` Blind: ledger `ma38` check for 05-07 is `not.toBeNull()` — exact values are asserted for 05-08 and 05-10 and in core tests.
  - `[low]` `[reject]` Blind: `SecurityHeatmap.tsx` marked `"use client"` unnecessarily — tiny bundle effect; wrapper passes a ReactNode footer either way.
  - `[low]` `[patch]` Edge: auto y-domain can exclude 0, so the 0 % reference line is not drawn when every value is positive or negative — `performanceYDomain` forces the domain to include 0 (helper + DOM test, failing without the fix).
  - `[low]` `[reject]` Edge: moving-average switch shown when the price chart has no price at all — needs a Security without any price (not even a trade price) in the Period; fix adds a guard branch.
  - `[false]` `[reject]` Edge: non-integer window throws — same as the Blind validation row; unreachable.
  - `[low]` `[patch]` Verification gap: the "Alle Depots" heatmap on a non-MAX Period (rebuild branch, `sumValuationSeries`) is never value-checked with two Depots — tests now assert the custom-Period two-Depot heatmap and the depotA custom-Period heatmap deep-equal their MAX counterparts.
  - `[low]` `[reject]` Intent: no real-browser surface (reload, link navigation, pointer hover) — the project verifies UI through DOM and page tests; no e2e harness exists; write-then-read of the cookie is covered in two halves.
  - `[low]` `[reject]` Intent: Q|M toggle tested on `ReturnHeatmap`, not through the `SecurityHeatmap` wrapper — the wrapper only passes fixed props; the page test renders it.
  - `[low]` `[reject]` Intent: tint colours not asserted for the Security variant — the tint code is shared and unchanged.
  - `[low]` `[reject]` Intent: one-Depot scope covered only at ledger level — the page passes `detail.heatmap` through unchanged; ledger tests cover both scopes.
  - `[false]` `[reject]` Intent: heatmap parity checked by near-equality — same as the Blind parity row (rounding by construction).
  - `[low]` `[reject]` Intent: split and sale tested in separate fixtures, not one — the AC lists both cases; each is exact-tested.
  - `[false]` `[reject]` Intent: "200 days" read as 200 stored closes — recorded design decision (Design Notes); fix would edit this spec.
  - `[low]` `[reject]` Intent: diff cannot show that the verification commands pass — they were run: lint, typecheck, 2829 tests and build pass.

## Design Notes

"200 Tage" = 200 stored closes (trading days), the usual meaning; calendar days would mix weekend carry-forwards in. Heatmap flows come from `securityFlowRows`, so the cell detail's "Transaktionen" counts BUY/SELL/DIVIDEND/FEE rows and a chain that starts with an ADJUSTMENT begins at its first such row (residual, rare). Sale reference: 02-03 factor (60 + 60) / 110, 02-04 50 / 60 → chain 1.2 × 5/6 = 1.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Story 7.8 brings the Portfolio analyses to the Security page. A "Performance-Heatmap" card shows the holding's monthly TTWROR (all-time, scope "Alle Depots" or one Depot) via the 7.3 core heatmap over the Security series and flows, with a "Q | M" toggle, a "Gesamt" column, years without holding dropped, and a link to Analysen › Rendite. The chart toggle gains "Performance" (cumulative TTWROR of the Security flows, so trades are flows, not gains; 0 % line, trade/dividend markers, tooltip). "Kurs" gains a dashed "Gleitender Durchschnitt" (200 / 38 stored closes, split-adjusted, stored Prices only), off by default and persisted in the `dm_moving_average` cookie.

**Files changed:**
- `src/core/security.ts` (+test) -- `securityPerformanceLine`, `securityMovingAverage`.
- `src/modules/ledger/security-detail.ts` (+test) -- `performanceLine`, `movingAverages`, all-time `heatmap`.
- `src/app/_components/charts/performance-chart.ts`, `PerformanceChart.tsx` (+tests) -- Performance chart.
- `src/app/_components/charts/price-chart.ts`, `PriceChart.tsx` (+tests) -- dashed moving-average overlay, hint when too few closes.
- `src/app/_components/charts/chart-preference.ts` (+test), `src/app/_actions/chart-preference-cookie.ts` -- `performance` mode, moving-average cookie.
- `src/app/_components/analyses/ReturnHeatmap.tsx` (+test), `labels.ts` -- optional heading, Q|M toggle, Gesamt, footer.
- `src/app/_components/security-detail/SecurityHeatmap.tsx`, `SecurityChart.tsx`, `labels.ts` (+DOM test) -- heatmap card, new mode and overlay controls.
- `src/app/(app)/securities/[id]/page.tsx` (+test) -- wiring and card placement.
- `test/architecture/chart-imports.test.ts` -- allows `PerformanceChart.tsx`.

**Review findings:** 28 (high 0, medium 0, low 22, false 6, maybe-false 0).
- **Patched (low):** 0 % line always in the Performance y-domain; overlay aria/hint when no average exists; Q/M clears the month detail; value tests for the heatmap rebuild branch (two Depots and one Depot).
- **Deferred:** none.
- **Rejected:** Q-mode "–" (false, as 7.3), parity tolerance (rounding by construction), payload size, overlay memo, window constant duplication, hard-coded aria strings (false), window validation (false, unreachable), heatmap recompute cost, performance-mode page test, ISIN/split-before-range test, `ma38` exactness, `"use client"` wrapper, switch without any price, no e2e surface, wrapper toggle test, tint test, one-Depot page test, combined split+sale fixture, "200 days" reading (false, design decision), verification evidence (commands run) — reasons in the triage log.

**Follow-up review:** not recommended (`false`); patched: high 0, medium 0, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` all passed after the patches (209 test files, 2829 tests). Every I/O matrix row is covered by a passing core, ledger, page or DOM test.

**Residual risks:**
- Not checked in a real browser (dashed line look, switch layout on phones, dark mode).
- Heatmap "Transaktionen" counts BUY/SELL/DIVIDEND/FEE rows; a chain starting with an ADJUSTMENT begins at its first such row (Design Notes).
- GD 200 needs 200 stored closes; Securities with short stored history show the hint instead.
- No operator action is required.
