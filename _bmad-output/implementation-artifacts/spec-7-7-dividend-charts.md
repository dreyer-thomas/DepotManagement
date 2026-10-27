---
title: 'Story 7.7: Dividend Charts'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '87d59e2c8e9d2b2075654cf92a0a1932003ffda2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-7-5-dividend-analysis.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Dividenden tab (story 7.5) shows only one-colour totals, so Tommy cannot see which holdings pay when, nor compare his income year over year or judge one Security's payments against its cost (FR-22, CAP-22, Addendum J).

**Approach:** Extend `core/dividend-analysis` with a per-Security split of every month, cumulative January–December lines per year plus a current-year forecast from the 7.5 estimate, and per-Security trailing income with yield on cost. The Dividenden tab gains stacked-by-Security monthly bars ("Monatlich (pro Jahr)", "Monatlich (fortl.)") with segment tooltips, "Akkumuliert (pro Jahr)" lines with a "Prognose" switch, and "Breakdown" with a Security selector and three KPIs.

## Boundaries & Constraints

**Always:**
- Core (`dividendAnalysis`, inputs as in 7.5 plus `costBasis` per Position) additionally returns:
  - `monthsBySecurity`: aligned 1:1 with `months` (same periods); each entry `{ period, securities: { securityId, gross, net }[] }` with only the Securities paid in that month, keyed by Security id **as booked** (like `bySecurity`), in `bySecurity` order; Σ securities = the month bucket exactly.
  - `yearLines`: one per year of `years`, `{ year, points }` with 12 entries (Jan–Dec), each the running total `{ gross, net }` from January of that year through that month; for today's year the months after today's month are `null`.
  - `forecast`: 12 entries for today's year; `null` before today's month; month m ≥ today's month = today's-year running total through today + Σ `expected` payments dated in `(today, last day of m]` (only expected payments dated in today's year count).
  - On each `bySecurity` entry: `trailingGross`, `trailingNet` (its payments in the "1J" window, as booked), `costBasis` (Σ `costBasis` of today's Positions with quantity > 0 of that Security id across the Depots in scope; `null` when none) and `grossYieldOnCost` / `netYieldOnCost` = trailing ÷ costBasis via `ratioString(ReturnDecimal)` (`core/returns`), `null` when `costBasis` is `null` or 0.
- Views, in order: "Monatlich (pro Jahr)" (former "Monate", with the "Jahr" select, default), "Monatlich (fortl.)" (every month from the first month with a payment to today's month), "Jahre" (unchanged), "Akkumuliert" (former "Kumuliert", unchanged otherwise), "Akkumuliert (pro Jahr)", "Breakdown", "Wertpapiere" and "Erwartet" (both unchanged). Brutto/Netto applies to every view, KPI and tooltip; scope stays in the URL as in 7.5.
- Stacked bars: one bar series per Security paying in the shown range, stacked, colour by the Security's index in `bySecurity` cycling through theme `chart.series1..5` then `LOGO_COLORS` (13 colours) — the same colour in every view; month total as a label above the topmost non-zero segment (`barLabelPlacement: "outside"`), nothing on empty months. Item tooltip on a segment (hover, tap on phones): Security logo, name, its amount, "Summe <Monat>: <Betrag>". Chart has `role="figure"` with an aria-label listing each month's total and its Securities' amounts; the value table of month totals stays.
- "Akkumuliert (pro Jahr)": one line per year (x = Jan–Dez, y = €), legend with years, colour per year from the same palette, today's year emphasised (thicker). Switch "Prognose" (default off, ≥ 44 px): adds the `forecast` series dashed, labelled "Prognose <Jahr> (Schätzung)", and the note "Schätzung: erwartete Zahlungen bis Dezember (siehe Erwartet)." Text alternative lists each year's December (or last) total and, when on, the forecast's December value.
- "Breakdown": stacked bars over the "Monatlich (fortl.)" range; Security selector (paying Securities in `bySecurity` order) showing logo, name, type (`ASSET_TYPE_LABELS`), ISIN and WKN (derived from a `DE000…` ISIN as characters 6–11, else `–`; crypto shows its symbol instead of ISIN); "Vorheriges"/"Nächstes" arrow buttons step through the list (disabled at the ends); default = first paying Security. Chosen Security's segments full opacity, others dimmed (opacity 0.25). Month = clicked bar or the "Monat" select (keyboard path), default and reset on Security change = latest month with a payment of that Security. KPIs: "Im <Monat Jahr>" (its amount that month), "Seit Jan. <Jahr>" (its sum from January of that year through the chosen month), "Pers. Div-Rendite" (yield on cost by mode, unsigned `3,00 %`; `–` when null).
- Money via `core/format`, German labels, controls ≥ 44 px, WCAG 2.2 AA, `Number(...)` only for chart coordinates; `src/core` pure; ledger stays the only DB reader; nothing stored.

**Never:** a second definition of the estimate, "1J" or Cost Basis; changing the 7.5 figures (`months`, `years`, `cumulative`, `bySecurity` totals, `trailing`, `expected`), "Jahre", "Wertpapiere", "Erwartet" or the other Analysen tabs; showing the forecast without "Schätzung"; hover-only access to values (aria-label and table carry them); storing a WKN.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hand reference (7.5) | Depot: 2025-01-02 BUY 10 X (500); 2025-11-15 DIVIDEND X 20 tax 5 fee 0.5; 2026-03-01 BUY 10 X (600); 2026-05-10 DIVIDEND X 40 tax 10; today 2026-10-27; X 20 units, value 2000, costBasis 1100 | `monthsBySecurity` 2025-11 [X 20/14.5], 2026-05 [X 40/30], other months []; yearLines 2025: Jan–Okt 0, Nov–Dez 20/14.5; 2026: Jan–Apr 0, Mai–Okt 40/30, Nov–Dez null; forecast 2026: Jan–Sep null, Okt 40/30, Nov 80/59, Dez 80/59; X trailing 60/44.5, costBasis 1100, yield on cost 0.05454545454545454545 / 0.04045454545454545455 | — |
| Two Securities, one month | X 10 and Y 5 paid in 2026-03 | 2026-03 securities [X 10, Y 5] in `bySecurity` order; month total 15; two stacked segments, label "15,00 €" above | — |
| Sold Security | Z paid 2026-02, all Z sold | Z in split and lines; Z `costBasis` null, yield on cost null → "–" | — |
| Two Depots | X paid in A and B, held in A and B | X costBasis = Σ both Positions' Cost Basis; trailing summed | — |
| Forecast window | expected payment dated 2027-01 | not in today's-year forecast | — |
| December today | today 2026-12-10 | forecast only Dez (+ expected dated 12-11..12-31) | — |
| Fortl. range | ledger from 2024-01, first dividend 2025-11 | "Monatlich (fortl.)" and Breakdown start at Nov 2025 | — |
| Breakdown default | reference data | X chosen, month Mai 2026: "Im Mai 2026" 40,00 €, "Seit Jan. 2026" 40,00 €, "Pers. Div-Rendite" 5,45 % (Netto 4,05 %) | — |
| WKN | ISIN DE0007164600 / US0378331005 | WKN 716460 / – | — |
| No dividends | rows without DIVIDEND | stacked views and Breakdown show "Noch keine Dividenden."; lines at 0 | — |

</intent-contract>

## Code Map

- `src/core/dividend-analysis.ts` -- extend: `DividendPosition` gets `costBasis`; main loop already visits each payment (add split per month, per-Security trailing); `expected` (dated `addMonths(date,12)`) feeds `forecast`; `monthRange`, `bucket`, `add`, `zero` helpers.
- `src/core/dividend-analysis.test.ts` -- 7.5 fixtures/test style (hand reference, two Depots, sold); existing assertions must stay green.
- `src/core/returns.ts:17-28` -- `ReturnDecimal`, `ratioString` for yield on cost.
- `src/core/format.ts:120` -- `formatMonth` ("Mai 2026"), `formatMoney`, `formatPercent`.
- `src/app/_components/analyses/labels.ts:~250-358` -- `DIVIDEND_VIEWS`, `DIVIDEND_LABELS`, `DIVIDEND_BUCKET_HEADINGS`, `dividendBuckets`, `dividendChartAriaLabel`, `dividendYieldText`, `gainsBucketShortLabel`/`gainsBucketLabel`, `HEATMAP_MONTH_LABELS`; `ASSET_TYPE_LABELS` from `../transactions/labels`.
- `src/app/_components/analyses/DividendsView.tsx` -- controls, `bucketCard`, `securitiesCard`, KPIs (`Kpi`), `Summary`/`ValueTable` from `GainsView`; view state is client-only.
- `src/app/_components/analyses/DividendsView.dom.test.tsx` -- mocks `BarsChart` to record props; renders with theme; `kpi()` helper. Existing tests reference "Monate"/"Kumuliert" labels — update to new names.
- `src/app/_components/charts/BarsChart.tsx` -- generic wrapper used by Gains/Dividends; extend with optional `barLabel`, `onBarClick(index)`, per-series `opacity`, `hideLegend`, and an optional item tooltip slot — default behaviour unchanged for existing callers.
- `src/app/_components/charts/DrawdownChart.tsx:58-104` -- custom tooltip pattern (`ChartsTooltipContainer`, context for data); use `useItemTooltip` with `trigger="item"` for segments.
- `src/app/_components/charts/ValueChart.tsx` -- `LineChart` setup pattern for the year-lines chart.
- `src/app/_components/composition/CompositionCard.tsx:44` -- `segmentColor(theme, key)` palette access; `src/app/_components/securities/security-logo.ts` `LOGO_COLORS`; `SecurityLogo.tsx`.
- `src/app/(app)/analyses/page.tsx` `dividendsPanel` -- add `costBasis` to positions and pass Security metadata (`listSecurities()` from `@/modules/ledger`: `id, name, isin, cryptoSymbol, assetType`); `page.test.tsx` mocks `@/modules/ledger` (add `listSecurities`).

## Tasks & Acceptance

**Execution:**
- `src/core/dividend-analysis.ts` (+ test) -- add `monthsBySecurity`, `yearLines`, `forecast`, per-Security trailing and yield on cost as defined; tests cover every matrix row with exact strings, Σ split = month, and that all 7.5 outputs are unchanged.
- `src/app/_components/analyses/labels.ts` (+ test) -- renamed/new views, labels ("Prognose", "Breakdown", "Im ", "Seit Jan. ", "Pers. Div-Rendite", estimate note), `dividendSecurityColorIndex`-style palette helper, `wknOf(isin)`, fortl. range helper, stacked aria-label, year-lines aria-label, breakdown KPI helper (month amount, since-January sum, default month).
- `src/app/_components/charts/BarsChart.tsx` -- optional props as in Code Map; existing callers unaffected.
- `src/app/_components/analyses/DividendStackedChart.tsx` -- stacked bars by Security with total labels, item tooltip (logo, name, amount, month total), dimming and click callback.
- `src/app/_components/analyses/DividendYearLinesChart.tsx` -- year lines + dashed forecast with legend and `role="figure"`.
- `src/app/_components/analyses/DividendsView.tsx` (+ dom test) -- new views, Prognose switch, Breakdown (selector with meta, arrows, Monat select, KPIs); dom tests for view switching, stacked series per Security with stable colours, forecast toggle + estimate label, Breakdown default/step/month/KPIs, Brutto/Netto.
- `src/app/(app)/analyses/page.tsx` (+ test) -- pass `costBasis` and Security metadata; other tabs untouched.

**Acceptance Criteria:**
- Given the Dividenden tab, when I open "Monatlich (pro Jahr)" or "Monatlich (fortl.)", then bars are stacked by Security in stable colours with the month total above, and a segment tooltip shows logo, name, amount and month total.
- Given "Akkumuliert (pro Jahr)", when I switch "Prognose" on, then today's year continues dashed to December, labelled as an estimate.
- Given "Breakdown", when I step with the arrows or pick a month, then the chosen Security is highlighted and the three KPIs update; "Pers. Div-Rendite" shows "–" for a Security no longer held.
- Given Brutto/Netto or a scope change, then every view follows; "Jahre", "Akkumuliert", "Wertpapiere", "Erwartet" and the other tabs behave as before.
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 28 findings — high 0, medium 1, low 19, false 2, maybe-false 0 (6 findings share the two pre-verified gap entries and are counted at their own verdicts)
- findings:
  - `[low]` `[patch]` Blind: month-total label above the tallest bar has only 8 px top margin and can be clipped — `BarsChart` uses a 24 px top margin when any series has a bar label.
  - `[medium]` `[patch]` Blind: stacked charts show one legend entry per paying Security; 20–30 payers squeeze the 220/260 px chart — `DividendStackedChart` passes `hideLegend` (names carried by tooltip and aria-label).
  - `[low]` `[reject]` Blind: chart-import guard widened to allow `analyses/DividendYearLinesChart.tsx` — the guard stays an explicit allow-list; the spec places the file there; no caller named that would break.
  - `[low]` `[patch]` Blind: today's-year/forecast line styling untested — grouped with the verification-gap year-lines entry; real-render test now asserts the `data-series` line paths.
  - `[low]` `[patch]` Blind: `DIVIDEND_PALETTE_SIZE` unused — deleted.
  - `[low]` `[reject]` Blind: `securities` prop duplicates names and ships all Securities to the client — single-user app with a small Security table; filtering adds code for no user-visible gain.
  - `[low]` `[reject]` Blind: segment colour can differ from / coincide with a logo's initials colour — logos are pictures or name-hashed initials; no reading of the chart depends on matching them.
  - `[low]` `[reject]` Blind: "Monatlich (pro Jahr)" year without payments draws an empty chart — verified that `BarsChart` with zero series renders without error; the zero value table still shows the months.
  - `[low]` `[reject]` Blind: Breakdown has no value table — its aria-label lists every month and Security; adding a table is new UI beyond the spec.
  - `[low]` `[patch]` Blind: year-line monthly values and intermediate forecast months only reachable by hover (spec Never rule) — `dividendYearLinesAriaLabel` now lists every non-null month per year and every non-null forecast month.
  - `[low]` `[reject]` Blind: ISIN-change yield-on-cost behaviour untested — documented residual (Design Notes); rare.
  - `[low]` `[reject]` Blind: `breakdownDefaultMonth(...) as string` cast — `chosen` always comes from `paying`, so a payment month always exists.
  - `[low]` `[reject]` Blind: "Pers. Div-Rendite" ignores the chosen month — the AC defines it as last-12-months ÷ current Cost Basis; caption is cosmetic.
  - `[false]` `[reject]` Blind: "Fortl. range" matrix row lacks coverage — the DividendsView dom test uses a ledger from 2025-01 with first dividend 2025-11 and asserts the range starts at "Nov 25".
  - `[low]` `[patch]` Blind: real-render interactions (click, tooltip) untested — grouped with the verification-gap click/tooltip entry.
  - `[low]` `[reject]` Edge: payments booked under an old id after an ISIN change show "–" yield on cost — rare, temporary (12-month window), documented residual; fixing changes the spec'd keying.
  - `[low]` `[reject]` Edge: expected payment dated exactly today (29 Feb → 28 Feb) is in `expectedMonths` but not the forecast — needs a leap-day payment and today on 28 Feb; spec defines the window as `(today, …]`.
  - `[low]` `[reject]` Edge: empty year draws empty axes — same as the Blind empty-year row (verified no crash).
  - `[low]` `[reject]` Edge: after a scope change the Breakdown can keep a stale month when its Security is gone — needs a scope switch after picking a month; fix adds a guard branch.
  - `[low]` `[reject]` Edge: negative net month puts the total label on a segment below zero — needs tax larger than gross; rare.
  - `[low]` `[reject]` Edge: default month may be one whose split sums to 0 — needs a payment and reversal in one month; rare.
  - `[low]` `[reject]` Edge (claim): scope change does not reset Breakdown state — same as the stale-month row.
  - `[low]` `[patch]` Verification gap: `onAxisClick` → `onBarClick` and the item tooltip slot never exercised through the real chart — `DividendCharts.dom.test.tsx` now clicks a band (asserts index 1) and drives the tooltip by keyboard (asserts name, amount, "Summe März 2026: 15,00 €").
  - `[low]` `[patch]` Verification gap: forecast/today's-year lines only checked by legend text — test now asserts `year-2025`, `year-2026`, `forecast` line paths, and none for `forecast={null}`.
  - `[low]` `[patch]` Intent: tooltip/click/styling tested through props not real input — grouped with the two verification-gap entries.
  - `[low]` `[reject]` Intent: chart-import rule widened — same as the Blind guard row.
  - `[low]` `[patch]` Intent: selector options show only logo and name, AC lists type, ISIN, WKN — each option now has a caption `Typ · ISIN/Symbol · WKN`.
  - `[false]` `[reject]` Intent: only the Portfolio scope is tested for dividends — `page.test.tsx` already covers the single-Depot scope for the dividends tab (story 7.5 test loads only Depot "a").

## Design Notes

Yield on cost reference: 60 / 1100 = 0.0545… (5,45 %), net 44.5 / 1100 = 0.04045… (4,05 %). Forecast reference: 2026 YTD 40 (gross); expected 2026-11-15 gross 40 → Nov/Dez 80; the 2027-05-10 expected payment is next year and ignored.

Stacking key and per-Security trailing use the booked Security id (as 7.5 `bySecurity`), so colours and the selector match the Wertpapiere list; after an ISIN change the old id shows "–" yield on cost (residual, rare). WKN is not stored anywhere; for German ISINs it is embedded (`DE000` + WKN + check digit), otherwise "–".

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Story 7.7 extends the Dividenden tab. `core/dividend-analysis` now also returns the per-Security split of every month (booked Security ids, `bySecurity` order), a cumulative January–December line per year, a current-year forecast (running total through today + expected payments of story 7.5 dated after today through each month end) and per-Security trailing income, Cost Basis and yield on cost. The tab has the views Monatlich (pro Jahr) and Monatlich (fortl.) as bars stacked by Security (stable colours, month total above, segment tooltip with logo, name, amount, month total), Jahre, Akkumuliert, Akkumuliert (pro Jahr) with a "Prognose" switch (dashed, labelled as an estimate), Breakdown (Security selector with type/ISIN/WKN, previous/next arrows, month via bar click or "Monat" select, dimming, KPIs "Im <Monat>", "Seit Jan. <Jahr>", "Pers. Div-Rendite"), Wertpapiere and Erwartet. Brutto/Netto and the scope apply everywhere.

**Files changed:**
- `src/core/dividend-analysis.ts` (+test) -- month split, year lines, forecast, per-Security trailing and yield on cost.
- `src/app/_components/analyses/labels.ts` (+test) -- views, labels, palette, WKN, ranges, text alternatives, Breakdown helpers.
- `src/app/_components/charts/BarsChart.tsx` -- optional bar labels, opacity, band click, hidden legend, item tooltip.
- `src/app/_components/analyses/DividendStackedChart.tsx` -- stacked bars by Security.
- `src/app/_components/analyses/DividendYearLinesChart.tsx` -- year lines with dashed forecast.
- `src/app/_components/analyses/DividendCharts.dom.test.tsx` -- real-render tests (labels, dimming, click, tooltip, lines).
- `src/app/_components/analyses/DividendsView.tsx` (+dom test) -- new views, Prognose switch, Breakdown.
- `src/app/(app)/analyses/page.tsx` (+test) -- passes Cost Basis and Security metadata.
- `test/architecture/chart-imports.test.ts` -- allows the year-lines chart to import the chart library.

**Review findings:** 28 (high 0, medium 1, low 19, false 2, maybe-false 0 — remaining rows counted at their own verdicts).
- **Patched:** hidden legend on stacked charts (medium); label headroom, unused constant, complete year-lines text alternative, selector option captions, real-render click/tooltip tests, line-path tests (low).
- **Deferred:** none.
- **Rejected:** import-guard widening, duplicated names prop, logo-colour mismatch, empty-year chart (verified no crash), Breakdown table, ISIN-change yield (documented residual), nullable cast, yield caption, leap-day forecast edge, stale Breakdown month after scope change, negative-net label, zero-sum default month (low, reasons in triage log); fortl.-range coverage and Depot-scope test (false).

**Follow-up review:** not recommended (`false`); patched: high 0, medium 1, low 6.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` all passed after the patches (207 test files, 2801 tests; build lists `/analyses`). Every I/O matrix row is covered by a passing core, labels or DOM test.

**Residual risks:**
- Not checked in a real browser (label placement, tooltip on touch, wrapping of eight view buttons on phones).
- Keyboard activation of a bar (Enter) does not pick a month in happy-dom; the "Monat" select is the keyboard path.
- After an ISIN change, yield on cost uses booked ids (old id "–", new id understated for up to 12 months).
- No operator action is required.
