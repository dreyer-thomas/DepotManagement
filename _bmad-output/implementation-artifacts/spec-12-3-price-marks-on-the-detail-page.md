---
title: 'Price Marks on the Detail Page'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_revision: '31067347db45adc076df09ac71247494b5ec3486'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-2-set-stop-and-target.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 12.2 stores stop and target per Security and derives their state, but the detail page shows nothing of it: Tommy cannot see how far the price is from his marks or whether one is crossed.

**Approach:** A card "Kursmarken" right after the price chart (both layouts) shows each mark from the core state (`priceMarksView`), a breach pill and the "Kursmarken bearbeiten" button reusing `PriceMarksDialog`; the "Kurs" chart draws the stop and target as dashed labelled lines, the trailing stop as a line over time, computed by a new pure core function.

## Boundaries & Constraints

**Always:**
- Card "Kursmarken" in both layouts directly after the hero/price chart (booked: after `SecurityHero`; watch: after `WatchHeader`); always rendered (also without Price).
- Rows: fixed stop `Stopp · 92,40 € · −7,4 %`; trailing `Stopp nachlaufend 15 % · 92,40 € · −7,4 %` (percent via `formatFigure`-style de-DE without trailing zeros, e.g. `12,5 %`); target `Ziel · 245,00 € · +8,1 %`. Value = state's effective stop / target price (today's units), distance `formatPercent(distance, 1)`; distance omitted when `null`; trailing without any Price: `Stopp nachlaufend 15 % · noch kein Kurs`. Under each row: `Quelle: <source> · gesetzt am dd.mm.yyyy` (source part omitted when `null`).
- Breach pill on the breached row only: `Stopp unterschritten · Kurs vom dd.mm.yyyy` / `Ziel erreicht · Kurs vom dd.mm.yyyy` (state `priceDate`), text not colour alone, `bgcolor: stale.soft`, `color: stale.main`, pill shape like `StaleBadge`.
- No marks (`marks === null`): only `Keine Kursmarken` and the button. Note always shown when marks exist: `geprüft gegen den letzten Kurs, nicht im Tagesverlauf`.
- Button `Kursmarken bearbeiten` opens `PriceMarksDialog` with the same `PriceMarksEditInfo` the actions menu gets (new `formKey` per open); the menu item stays.
- Breach logic only from `core/price-marks` (`priceMarkState`); the UI never compares prices.
- Chart lines (new pure `priceMarkLines(marks, observations, actions, from, to)` in `src/core/price-marks.ts`): units as of `to` (same as `securityPriceSeries`). Fixed stop and target: `adjustedPrice(..., setDate, value, actions, to)`, drawn as horizontal reference lines only when `setDate ≤ to`. Trailing stop: per day `d` of `from..to` with `d ≥ setDate`: running high = max(resolved Price as of setDate, trading-day closes in `(setDate, d]`, resolved Price as of `d`) × (1 − p/100); `null` before the set date or without a Price. With `to = today` the last point equals `priceMarkState(...).stop.effective`.
- Lines only in "Kurs" mode; dashed; stop in `palette.loss`, target in `palette.gain`; labels `Stopp` / `Ziel` (trailing: label at its last value); y range covers the lines (like `pivotYRange`); the chart's aria label mentions the marks; no new design tokens.

**Never:** No dashboard card, list/watchlist icons or MCP (12.4/12.5). No stored derived state, no provider call, no schema change, no change to breach semantics or the dialog's fields.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No marks | `marks` null | card: `Keine Kursmarken` + button; chart without lines | — |
| Fixed stop | FIXED 92.4, latest 99.78 | `Stopp · 92,40 € · −7,4 %`; dashed `Stopp` line at 92.4 | — |
| Trailing | 15 %, set 2026-10-01, closes 100, 110, 105 | row `Stopp nachlaufend 15 % · 93,50 € · …`; line 85 → 93.5 from set date, null before | — |
| Breached stop | latest ≤ effective stop | pill `Stopp unterschritten · Kurs vom …` | — |
| Reached target | latest ≥ target | pill `Ziel erreicht · Kurs vom …` | — |
| Mark set after chart end | setDate > `to` | no line for that mark; card unchanged | — |
| Split in chart range | FIXED 90 set before 1:2 split, `to` after split | line at 45 | — |

</intent-contract>

## Code Map

- `src/core/price-marks.ts` -- `priceMarkState` (l.~250: trailing high logic to mirror), `PriceMarks`, `PriceMarkState`; add `priceMarkLines` + types here.
- `src/core/corporate-actions.ts:305` `adjustedPrice`; `src/core/key-figures.ts:123` `tradingDayCloses(obs, id, actions, asOf)`; `src/core/security.ts` `adjustedObservations`, `currentSecurityId`, `securityPriceSeries` (l.375, units as of `to`); `src/core/prices.ts` `resolvePrice`; `src/core/dates.ts` `addDays`.
- `src/modules/marks/marks.ts` -- `priceMarksView` (loads rows, actions, observations via `securityPriceObservations` + `storedPriceHistory`); add `priceMarkChartLines(securityId, from, to, today, db)` reusing `applicableRow`/`carryPriceMarks`; export from `index.ts`.
- `src/app/(app)/securities/[id]/page.tsx` -- loads `priceMarksView([id])` as `marks`, builds `priceMarks` edit info; `detail.from`/`detail.to`; both layouts' `SecurityChart`.
- `src/app/_components/security-detail/SecurityChart.tsx` -- passes overlays to `PriceChart` only in "price" mode; add `marks?` prop.
- `src/app/_components/charts/PriceChart.tsx`, `price-chart.ts` -- `ChartsReferenceLine` usage, sx per series, `pivotYRange`, `priceChartAriaLabel`, tooltip; `palette.gain`/`palette.loss` exist in theme.
- `src/app/_components/price-marks/{PriceMarksDialog.tsx,labels.ts,PriceMarkFields.tsx}` -- dialog + `PriceMarksEditInfo`; add card label helpers to `labels.ts`.
- `src/app/_components/security-detail/SecurityActions.tsx` -- dialog-session pattern (`session` counter as `formKey`).
- `src/app/_components/prices/StaleBadge.tsx` -- pill styling to mirror; `src/app/_components/overview/CardHeading.tsx`.
- Tests: `src/core/price-marks.test.ts`, `src/modules/marks/marks.test.ts`, `src/app/_components/price-marks/PriceMarksDialog.dom.test.tsx`, `src/app/_components/security-detail/SecurityDetail.dom.test.tsx` (SecurityChart cases), `src/app/(app)/securities/[id]/page.test.tsx` (uses `setPriceMarks`, `findElement`).

## Tasks & Acceptance

**Execution:**
- `src/core/price-marks.ts` (+ test) -- `priceMarkLines` returning `{ stop: { kind: "fixed"; value } | { kind: "trailing"; points: {date; value|null}[] } | null; target: string | null }` per the rules above; tests: fixed, trailing running high (never falls, null before set date), setDate > to, split in range, last trailing point = state effective when `to = today`.
- `src/modules/marks/marks.ts`, `index.ts` (+ test) -- `priceMarkChartLines` (null marks → `{stop:null,target:null}`); DB test with a trailing mark.
- `src/app/_components/price-marks/labels.ts` (+ test) -- `stopRowText`, `targetRowText`, `markMetaText`, `breachPillText`, constants `NO_PRICE_MARKS_TEXT`, `PRICE_MARKS_NOTE`.
- `src/app/_components/security-detail/PriceMarksCard.tsx` -- client card (heading "Kursmarken", rows, pill, note, button + `PriceMarksDialog`).
- `src/app/_components/charts/price-chart.ts`, `PriceChart.tsx`, `SecurityChart.tsx` -- `marks?: PriceChartMarks` overlay: reference lines (fixed stop, target), trailing series, y range, aria text, tooltip line `Stopp` for the trailing value.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) -- load chart lines for `detail.from`/`detail.to`, render card in both layouts after the chart, pass `marks` to both charts.
- `src/app/_components/security-detail/PriceMarksCard.dom.test.tsx` -- no marks, fixed stop, trailing stop, breached stop, reached target, button opens dialog; SecurityChart/PriceChart DOM case: lines labelled `Stopp`/`Ziel`.

**Acceptance Criteria:**
- Given a booked or watch-only Security, when the detail page renders, then the "Kursmarken" card follows the price chart and shows the marks per the rules, or only "Keine Kursmarken" and the button.
- Given a breached mark, when the page renders, then the pill names the breach and the Price date in words.
- Given marks, when "Kurs" is shown, then dashed labelled `Stopp`/`Ziel` lines appear, the trailing stop as a line over time from its set date.
- Given the card button, when clicked, then "Kursmarken bearbeiten" opens prefilled.

## Spec Change Log

## Review Triage Log

### 2026-11-11 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 15, false 6, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) Chart lines in wrong units for a predecessor mark when the Period ends before the ISIN change — `priceMarkChartLines` now passes the row's own (uncarried) marks to `priceMarkLines`, which carries from the set date to `to`; ISIN-change case added to marks.test.ts (to = today: 45/75 = view; to before change: 90/150).
  - `[low]` `[reject]` (blind) Trailing line can drop the day after a non-close (Transaction) Price above the high — spec-defined per-day evaluation that matches `priceMarkState`; folding it into the running high would break the last-point = card equality; rare.
  - `[low]` `[reject]` (blind) New chart helpers lack unit tests; `pivotYRange` only used in tests — helpers covered by the SecurityChart DOM case; the tooltip helper is patched under the verification-gap row; no defect.
  - `[low]` `[reject]` (blind) Marks rows/actions/observations loaded twice per render — single-user SQLite, negligible; merging needs a new module API.
  - `[false]` `[reject]` (blind) `trailingLast` and aria suffix can disagree — the line points come from `securityPriceSeries(from, to)`, the same daily dates as the chart's `priceSeries`; both scans see the same last value.
  - `[low]` `[reject]` (blind) Mark labels can overlap Fibonacci labels — cosmetic, only with Wendepunkte on and a level near a mark; fix needs label placement logic.
  - `[low]` `[reject]` (blind) Spec writes U+2212, code ASCII "-" — project-wide `formatPercent` output; the fix would edit this build's spec.
  - `[false]` `[reject]` (blind) Card shows an empty list when marks exist but state does not match — `priceMarksView` derives the state from the same marks (stop/target present together); rows with both null are deleted by the service.
  - `[low]` `[reject]` (blind) Page tests miss KPI/WatchlistCard ordering and the kept menu item — the menu item is asserted by the existing page test (SecurityActions priceMarks props); placement after the chart is asserted; test-only gap.
  - `[low]` `[reject]` (blind) Fresh `formKey` per open untested — same pattern as `SecurityActions`; no defect shown.
  - `[low]` `[reject]` (blind) Fixed lines span the chart before their set date unlike the trailing line — the AC asks for horizontal lines; deliberate.
  - `[low]` `[patch]` (edge) Predecessor chart gets successor units / null trailing line — same root cause as the first row; same fix.
  - `[low]` `[reject]` (edge) Trailing line can fall after a Transaction Price — same as the blind row.
  - `[false]` `[reject]` (edge) Percent via `formatQuantity` instead of `formatFigure` — the spec asks for no trailing zeros ("12,5 %"), which `formatQuantity` gives and fixed-decimal `formatFigure` does not.
  - `[low]` `[patch]` (verification-gap) Trailing-stop tooltip line untested — added `stopTooltipLine` unit tests in price-chart.test.ts.
  - `[low]` `[patch]` (verification-gap) Chart lines through an ISIN change untested — test added with the first row's fix.
  - `[low]` `[patch]` (verification-gap other) Carried predecessor values adjusted again for `to` before the change — same root cause as the first row; same fix.
  - `[false]` `[reject]` (intent B4) Lines only in "Kurs" mode — the AC names the price chart; the other modes are not price charts.
  - `[false]` `[reject]` (intent B2) ASCII minus vs AC glyph — same as the blind minus row; project formatter.
  - `[false]` `[reject]` (intent B3) Date numeric, not in words — "in words" qualifies the pill (text, not colour alone), as EXPERIENCE.md states.
  - `[low]` `[reject]` (intent surfaces) Page tests check chart props, not rendered lines — rendering is covered by the SecurityChart DOM test; test-surface only.

## Design Notes

The chart lines use the chart's units (as of `to`) while the card uses today's units, the same split as the chart and the hero figures already have; for the default Periods `to = today` and both agree. The trailing line includes the resolved Price of each day so its last point equals the card's effective stop.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Detail page card "Kursmarken" (both layouts, right after the price chart) showing stop/target from the core state with value, distance, source, set date, breach pill ("Stopp unterschritten" / "Ziel erreicht · Kurs vom …", stale colours), the note and the "Kursmarken bearbeiten" button reusing `PriceMarksDialog`; the "Kurs" chart draws dashed labelled "Stopp"/"Ziel" lines and the trailing stop as a line over time from its set date (new pure `priceMarkLines` in core).

**Files changed:**
- `src/core/price-marks.ts` (+ test) — `priceMarkLines`, shared trailing-stop helper.
- `src/modules/marks/{marks.ts,index.ts}` (+ test) — `priceMarkChartLines`.
- `src/app/_components/price-marks/labels.ts` (+ test) — card texts.
- `src/app/_components/security-detail/PriceMarksCard.tsx` (+ DOM test) — the card.
- `src/app/_components/charts/{price-chart.ts,PriceChart.tsx}` (+ test), `security-detail/SecurityChart.tsx` (+ DOM test) — marks overlay, y range, tooltip, aria text.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) — wiring in both layouts.

**Review findings:** 21 — high 0, medium 0, low 15, false 6. Patched: 1 low entry (ISIN-change chart units; 4 rows) and 1 low (tooltip test). Deferred: none. Rejected: all others — reasons per row in the Review Triage Log.

**Follow-up review recommended:** false — patched counts: high 0, medium 0, low 2.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — pass (276 files, 3900 tests; build compiled).

**Residual risks:** chart lines use the units as of the Period end, the card today's units (agree for Periods ending today); the trailing line can dip after a day priced only by a Transaction; mark labels may overlap Fibonacci labels.
