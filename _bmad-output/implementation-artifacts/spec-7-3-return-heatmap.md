---
title: 'Story 7.3: Return Heatmap'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: 'cc0e252f18444cd4101db15184a4833a7ea1498a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Analysen page (story 7.2) only has "Aufteilung"; Tommy cannot see which months and years were good or bad (FR-22, UX-DR21).

**Approach:** A second tab "Rendite" on `/analyses`: for the chosen scope (Portfolio or one non-archived Depot) a grid of years × months with each month's TTWROR plus chained quarter and year totals, computed by one pure core function over the same daily valuation series (from the first ledger date to today) and external flows the Depot/Portfolio return figures use. Tapping a month shows its start value, end value, return, net external flows and Transaction count.

## Boundaries & Constraints

**Always:**
- Inputs: one daily series `start` (end of the day before the first ledger date) + points first ledger date..today, exactly as `depotValuation`/`portfolioValuation` with `MAX` build it (`valuationSeries`, `storedPriceHistory`; Portfolio = pointwise sum of non-archived Depots, AD-17) and the scope's ledger rows.
- Month return = `ttwror(previousPoint, monthPoints, rows)` from `core/returns` (same inflow/outflow, ADJUSTMENT and skip rules); `previousPoint` = series point of the day before the month's first point (`start` for the first month). `null` when no day was multiplied.
- Quarter / year total = Π(1 + r) − 1 over that quarter's / year's months with non-null return; `null` when none. So the year total equals TTWROR over that calendar year's slice (to ~1e-18).
- Month detail: start value = `previousPoint.value`, end value = last point of the month (today for the running month), net external flows = Σ `externalFlow(row)` of rows dated in the month + Σ `adjustmentValue` of its points, Transactions = count of the scope's ledger rows dated in the month (all types).
- Years from the first ledger date's year to today's year, newest first. Months before the first ledger month or after today's month are empty (no value, not tappable). The month containing today is flagged `running`.
- Cell colour: green (gain) for r > 0, red (loss) for r < 0, neutral for 0 / null; intensity grows with |r| (capped); the value is always shown signed via `formatPercent` ("–" for null), so meaning never relies on colour (UX-DR21). Text stays readable (WCAG 2.2 AA).
- Money exact via `decimal.js` strings; `src/core` pure, "today" passed in; German UI; month cells keyboard-operable buttons with ≥ 44 px targets; grid scrolls horizontally inside its card, never the page.
- Scope in the URL as in 7.2; the "Rendite" tab hides the "Dimension" select; switching tabs keeps scope (and dimension).

**Never:** storing returns; a second TTWROR implementation; annualising monthly returns; tapping quarter/year cells; provider calls during render; other tabs (7.4–7.5); changing existing Overview/Depot performance behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hand reference | Deposit 1000 + buy 10 @100 on 2026-01-15; price 110 on 2026-01-31, 99 on 2026-02-28, 99 on 2026-03-31; today 2026-03-31 | Jan +10,00 %, Feb −10,00 %, Mar 0,00 %; Q1 −1,00 %; year −1,00 % | — |
| Mid-month deposit | value 1000 → 1100 on day 10, deposit 1100 on day 11, value 2200 → 2310 at month end | month r = (1100/1000)·(2310/2200) − 1 = +15,50 %; flows +1100; start 1000, end 2310 | — |
| Before first Transaction | first row 2025-03-05 | 2025 Jan–Feb empty; Mar has a value | — |
| Running month | today 2026-10-27 | Oct has value of 01.–27.10. flagged running; Nov–Dec empty | — |
| Nothing invested in a month | full withdrawal, value 0 all month | month return null → "–"; detail still shows values and count | — |
| Year total vs period | any series | chained year total = `ttwror` over that year's points (to 1e-15) | — |
| Portfolio | Depots A and B | series summed pointwise, flows and Transaction counts of both | — |
| Archived Depot | archived C | not in Portfolio, not a selectable scope | — |
| No Transactions in scope | Depot without rows | "Noch keine Transaktionen." | — |
| Month cell tapped | tap Feb 2026, tap again | detail card shows Februar 2026 figures; second tap closes it | — |

</intent-contract>

## Code Map

- `src/core/returns.ts:107-128` -- `ttwror(start, series, rows)`, `externalFlow(row)` (:39), `adjustmentValueOf(point)`, `FlowRow`; private `ReturnDecimal` (precision 40) and `ratioString` (:17-27) — reuse/export for chaining; no behaviour change.
- `src/core/valuation.ts` -- `ValuationPoint`, `ValuationRow`, `valuationSeries`, `sumValuationSeries`.
- `src/core/dates.ts` -- `addDays`, `addMonths`; `src/core/format.ts` -- `formatPercent` (signed ratio), `formatMoney`, `formatMonth` (`"Oktober 2026"`).
- `src/core/returns.test.ts:1-40` -- row/series fixture helpers and test style.
- `src/modules/ledger/valuation.ts` -- private `loadRows`, `firstDateOf`, `valuationOver` (series from `addDays(from,-1)`); `depotValuation`/`portfolioValuation` (non-archived, name-sorted) to mirror; exported through `src/modules/ledger/index.ts:80-81`.
- `src/modules/prices/index.ts` -- `storedPriceHistory` (full history, as Overview/Depot pages pass for valuation).
- `src/app/(app)/analyses/page.tsx` (+ `page.test.tsx` module-mocking style) -- current page: tab, scope, dimension parsing, allocation loading.
- `src/app/_components/analyses/labels.ts` -- `ANALYSIS_TABS`, `analysisTab`, `analysisScope`, `allocationHref`, `PORTFOLIO_SCOPE`.
- `src/app/_components/analyses/AnalysisTabs.tsx`, `AnalysisFilters.tsx` (+ dom test) -- tab links and filter selects (navigate via `allocationHref`).
- `src/app/_components/analyses/AllocationView.tsx` (+ dom test) -- card/selection pattern to copy.
- `src/theme/theme.ts:92-104` -- `palette.gain` / `palette.loss` (`main`, `soft`).

## Tasks & Acceptance

**Execution:**
- `src/core/returns.ts` -- export a `chainReturns(ratios: readonly (string | null)[]): string | null` (Π(1+r) − 1 over non-null, `ratioString`) -- one chaining rule shared by heatmap.
- `src/core/return-heatmap.ts` (+ `return-heatmap.test.ts`) -- `returnHeatmap(start, series, rows, today)` → `HeatmapYear[]` (`year`, `months: (HeatmapMonth | null)[12]`, `quarters: (string | null)[4]`, `total: string | null`); `HeatmapMonth` = `month` ("YYYY-MM"), `from`, `to`, `startValue`, `endValue`, `return: string | null`, `netExternalFlows`, `transactions`, `running`; `[]` when `rows` is empty -- tests cover every matrix row incl. the hand reference and year-total = `ttwror` equality.
- `src/modules/ledger/valuation.ts` + `index.ts` -- `returnSeries(scope: { depotId: string } | "portfolio", today, db?, { storedPrices }?)` → `{ start, series, rows }` over first ledger date..today (MAX), Portfolio summed over non-archived Depots via `sumValuationSeries` (shares `loadRows`/series building with `valuationOver`; no behaviour change) -- ledger stays the only DB reader.
- `src/app/_components/analyses/labels.ts` (+ test) -- add tab `{ value: "returns", label: "Rendite" }`; `analysisHref(tab, scope, dimension)` (keep `allocationHref` working); `heatmapCellTone(ratio)` → `{ tone: "gain" | "loss" | "neutral"; intensity: 0..1 }` (capped at |r| = 10 %); month column labels (Jan … Dez), quarter labels Q1–Q4, "Jahr".
- `src/app/_components/analyses/AnalysisTabs.tsx` -- hrefs via `analysisHref`.
- `src/app/_components/analyses/AnalysisFilters.tsx` (+ dom test) -- `tab` prop; "Dimension" only on allocation; navigation keeps the tab.
- `src/app/_components/analyses/ReturnHeatmap.tsx` (+ dom test) -- client card "Rendite je Monat": table (row header year; Jan–Dez buttons; Q1–Q4; Jahr), tinted cells with signed %, running month marked "laufend" (visible text), empty cells blank; tapping a month toggles a detail panel below ("Startwert", "Endwert", "Rendite", "Externe Zuflüsse (netto)", "Transaktionen"); month button `aria-label` e.g. "Oktober 2026: +3,21 %, laufend"; empty text "Noch keine Transaktionen."; selection resets on scope change.
- `src/app/(app)/analyses/page.tsx` (+ `page.test.tsx`) -- on tab `returns` load `returnSeries` (with `storedPriceHistory`) and render `ReturnHeatmap` with `returnHeatmap(...)`; allocation data loaded only on its tab.

**Acceptance Criteria:**
- Given `/analyses?tab=returns`, when I pick a scope, then the URL holds it and the grid shows years × months with signed % per month plus Q1–Q4 and year totals, green/red by sign.
- Given a Depot, then the year cell for the current year equals the Depot's YTD TTWROR and the chained product of all months equals its MAX TTWROR (to the displayed precision).
- Given the Aufteilung tab, then its behaviour is unchanged (scope + dimension in the URL, donut).
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 17, false 4, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: cells show only the sign, no arrow (UX-DR21 "sign + arrow", app convention in `GainLossPill`/`DepotPerformance`) — month, quarter and year cells now show an `aria-hidden` ArrowUpward/ArrowDownward by the displayed tone, none for neutral.
  - `[low]` `[reject]` Blind: partial quarters/years (running or first) are not marked — the AC only asks for the running month to be marked; marking totals is new UI; the month detail shows its date range.
  - `[low]` `[patch]` Blind: future-dated rows counted in the running month's flows and Transactions — `returnHeatmap` drops rows dated after `today` first; core test added.
  - `[low]` `[reject]` Blind: a scope with only future-dated rows shows "Noch keine Transaktionen." — as of today there are none; rare (future-dated-only Depot).
  - `[low]` `[reject]` Blind: `returnSeries` repeats `portfolioValuation`'s Depot loading — the ledger test pins `returnSeries` series equal to `portfolioValuation` MAX; a shared helper adds refactor risk to existing figures.
  - `[low]` `[reject]` Blind: corporate actions loaded once per Depot — same pattern as the existing `valuationOver`; single-user SQLite, few Depots.
  - `[low]` `[reject]` Blind: spec wording drifts from code (tint formula, 1e-15 vs 1e-18, `chainReturns` instead of exporting `ReturnDecimal`) — fix is a spec edit; the dark-mode alpha follows the contract's WCAG AA rule over the Design Note.
  - `[false]` `[reject]` Blind: contrast test blends over `surface` but cells sit on `background.paper` — `palette.background.paper` is `token("surface")` (`src/theme/theme.ts`), so they are the same colour.
  - `[low]` `[reject]` Blind: detail panel opens below the grid without focus move / live region / Esc — same disclosure pattern as `AllocationView`; tapping again closes; adding focus management is new behaviour.
  - `[low]` `[reject]` Blind: hard-coded heading ids, table shares the card's label — component renders once per page; the table is named by the card heading.
  - `[low]` `[reject]` Blind: weak tests for some matrix rows (`aria-pressed=false`, non-zero count on a null month, Dec→Jan boundary) — each matrix row has a passing test; the multi-year chaining test crosses year boundaries.
  - `[false]` `[reject]` Blind: page may pass different `today` to series and heatmap — `today` is computed once in the page and passed to `returnsPanel`, which uses it for both calls.
  - `[false]` `[reject]` Blind: sticky year column mismatches tinted cells in dark mode — `MuiPaper` elevation1 sets `backgroundImage: "none"`, so the Card shows exactly `background.paper`, the sticky column's colour.
  - `[low]` `[patch]` Edge: future-dated rows in today's month — same fix as above.
  - `[low]` `[reject]` Edge: all rows after today's month → empty text — same as above.
  - `[low]` `[patch]` Edge: ratio showing "+0,00 %" still tinted — `heatmapCellTone` now decides the tone as displayed via `ratioTone`; labels tests for 0.00003 / −0.00004 / 0.00005.
  - `[low]` `[patch]` Edge (claim): "neutral for 0" broken by tiny ratios — same fix as above.
  - `[low]` `[patch]` Verification gap: tint never checked where rendered — DOM test reads the emitted emotion CSS per cell: gain var on the positive month, loss var on the negative, none on "–"; arrows asserted; shown to fail with `tint()` returning `{}`.
  - `[low]` `[patch]` Verification gap (other): tone from raw ratio vs displayed value — same fix as the Edge tone finding.
  - `[low]` `[reject]` Intent: colour, phone-width scrolling and the real data path are not checked in a real browser — the default database holds real portfolio data (AGENTS.md policy); covered by DOM, page and ledger tests; residual risk recorded.
  - `[false]` `[reject]` Intent: spec stops at `in-review` without an Auto Run Result — the audited diff was the pre-finalization snapshot; finalization below.

## Design Notes

Monthly slices of the one MAX series (not 12 separate `depotValuation` calls) keep every month on the same price resolution and flow rules as the period figures, and chaining equals the period TTWROR because `ttwror` is itself a product of daily factors. A month whose start value is 0 and that gets money mid-month still has a return (inflows count at day start).

Tint: `alpha(palette.gain|loss.main, 0.12 + 0.48·intensity)` background with `text.primary`; `heatmapCellTone` is pure so the scale is unit-tested.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Story 7.3 adds the tab "Rendite" to `/analyses`: for the Portfolio (non-archived Depots) or one Depot, a years × months grid (newest year first) of monthly TTWRORs plus chained Q1–Q4 and year totals. The pure `core/return-heatmap` slices the one MAX daily valuation series (built by the new ledger `returnSeries`, same inputs as `depotValuation`/`portfolioValuation`) into months and calls the existing `ttwror` per month; `chainReturns` chains quarters and years, so a year equals the TTWROR over that year. Months before the first ledger month or after today are empty; the current month shows "laufend". Cells are tinted green/red by the displayed sign with intensity by magnitude, always with signed % and an arrow. Tapping a month shows Startwert, Endwert, Rendite, Externe Zuflüsse (netto) and Transaktionen. The "Dimension" select shows only on "Aufteilung"; tab links keep scope and dimension.

**Files changed:**
- `src/core/returns.ts` -- exports `chainReturns` (no behaviour change).
- `src/core/return-heatmap.ts` (+test) -- monthly/quarter/year heatmap over one series; hand reference and matrix tests.
- `src/modules/ledger/valuation.ts`, `index.ts` (+`valuation.test.ts`) -- `returnSeries` (Depot / Portfolio MAX series and rows); series building shared via `seriesOver`.
- `src/app/_components/analyses/labels.ts` (+test) -- "Rendite" tab, `analysisHref`, heatmap labels, `heatmapCellTone`, `heatmapTintAlpha`.
- `src/app/_components/analyses/ReturnHeatmap.tsx` (+dom test) -- grid, tint, arrows, month detail.
- `src/app/_components/analyses/AnalysisTabs.tsx`, `AnalysisFilters.tsx` (+dom test) -- tab-aware links and filters.
- `src/app/(app)/analyses/page.tsx` (+test) -- loads the series on "Rendite", allocation data only on "Aufteilung".

**Review findings:** 21 findings (high 0, medium 0, low 17, false 4, maybe-false 0).
- **Patched (4 entries, all low):** arrows in cells (UX-DR21); future-dated rows dropped before grouping; tone decided as displayed (`ratioTone`); DOM test of the rendered tint.
- **Deferred:** none.
- **Rejected:** partial-quarter marking, future-only scope text (×2), `returnSeries`/`portfolioValuation` duplication, per-Depot corporate-action loads, spec wording drift (spec edit), detail focus/Esc handling, hard-coded ids, extra matrix test depth, no real-browser check, and the false findings (paper vs surface contrast, differing `today`, dark-mode sticky stripe, spec not finalized). Reasons in the triage log.

**Follow-up review:** not recommended (`false`); patched: high 0, medium 0, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` all passed after the patches (196 test files, 2677 tests; build lists `/analyses`). Every I/O matrix row is covered by a passing core, ledger, DOM or page test; the ledger test confirms the current-year cell equals YTD TTWROR and the chained months equal MAX TTWROR for a Depot and the Portfolio.

**Residual risks:**
- Not checked in a real browser (colour strength, phone-width sideways scrolling).
- Dark-mode tints are paler than the Design Note's formula (0.12 + 0.28·i instead of 0.48) to keep WCAG AA contrast.
- Corporate actions are loaded once per Depot on the Portfolio Rendite tab (same as the existing valuation).
- No operator action is required.
