---
title: 'Card "Technische Lage"'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_revision: '201b28d9452d8b184a248a262115c32b22f619f6'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 11.2 computes the technical signals (`technicalPosition` in `src/core/technical.ts`), but nothing shows them; Tommy cannot see a Security's trend and momentum on its detail page.

**Approach:** `securityDetail` adds `technical = technicalPosition(tradingDayCloses(...), today)` (same closes as the 52-week figures); a new client card "Technische Lage" (a `CollapsibleCard`) renders right after "Kennzahlen" in both layouts: closed one row per signal, opened plus an indicator chart (TSI · RSI · MACD toggle, choice in a cookie) over the page Period.

## Boundaries & Constraints

**Always:** the card computes nothing — every value and key comes from `technicalPosition` (AD-23); `Number(...)` only for plot coordinates, display texts formatted from the decimal strings; row form "Signal · Wert · Einordnung" with the German label from core; tone pill (soft token background + main text colour) is a secondary cue next to the words, never alone; chart x-axis is a `utc` scale from the Period's `from` to `to` (same range and `tickDates`/`tickLabel` style as the price chart), plotting the series points dated `from..to`; chart has an axis-triggered crosshair tooltip and `role="figure"` with an `aria-label` text alternative; toggle buttons ≥ 44 px; colours only from existing tokens (`primary`, `chart.invested`, gain/loss/stale soft, divider/text.secondary); `@mui/x-charts` as the other charts; the choice is stored like the other chart preferences (client-written cookie, server reads initial value), default `tsi`.

**Never:** no combined verdict, score or recommendation text; no new core indicator logic or changes to `technical.ts` results; no storage/caching/export of indicators; no MCP change (Story 11.4); no new design tokens; no page reload on toggle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full history, closed | all five signals with values | 5 rows, e.g. "Trend · +8,2 % zum 200-Tage-Schnitt · Aufwärtstrend", "RSI · 64,3 · neutral", "MACD · 1,23 (Signal 0,98) · positiv, dreht nach oben", "TSI · 12,4 (Signal 9,1) · Schwung positiv", "52 Wochen · -3,1 % zum 52-Wochen-Hoch · nahe Hoch"; source line "berechnet aus Schlusskursen, Stand 04.11.2026" (last close date); no chart | — |
| Opened | same | rows + source line + toggle "TSI · RSI · MACD" + chart of the selected indicator | — |
| Toggle | click "RSI" | chart switches without reload; cookie `dm_technical_indicator=rsi` written; next render starts on RSI | invalid/missing cookie → `tsi` |
| Partial history | 50 closes | Trend row "Trend · zu wenig Kursdaten" (no tone pill); others with values | — |
| No closes | Security without stored Prices | card shows only "zu wenig Kursdaten" (no rows, no source line, no chart, also when opened) | — |
| Small values | MACD/histogram with |value| < 1 | 4 decimals (e.g. "0,0123"), otherwise 2 | — |
| No series in Period | Period has no close (e.g. 1T on a weekend) | opened: "Kein Indikatorverlauf im Zeitraum." instead of the chart | — |

</intent-contract>

## Code Map

- `src/core/technical.ts` -- `technicalPosition`, `TechnicalPosition`, signal types (value/date/key/label + details; `InsufficientHistory`), `TechnicalSeriesPoint` (`rsi`, `macd`, `macdSignal`, `macdHistogram`, `tsi`, `tsiSignal` strings or `null`), `TECHNICAL_PARAMETERS.rsi.overbought/oversold` (zones 70/30). Read-only.
- `src/core/key-figures.ts:123-191` -- `tradingDayCloses`, `fiftyTwoWeekFromCloses`, `fiftyTwoWeekFigures` (composition).
- `src/modules/ledger/security-detail.ts:52-96,261` -- `SecurityDetail` type and return; `observations` loaded as of `max(to, today)` with the full stored history; `fiftyTwoWeek` computed at line 261 — compute closes once and derive both.
- `src/app/(app)/securities/[id]/page.tsx` -- renders `keyFiguresCard` in both layouts (booked: after `SecurityTotal`; watch: after `WatchlistCard`); reads `readSecurityChartMode()`/`readMovingAverage()` in the `Promise.all`.
- `src/app/_components/security-detail/CollapsibleCard.tsx` -- chevron card (`collapsed`/`expanded`, 44 px button); reuse unchanged.
- `src/app/_components/security-detail/KeyFiguresCard.tsx` -- style reference: `RowList` (dl grid), stale pill sx (`bgcolor: "stale.soft", color: "stale.main"`, radius 999).
- `src/app/_components/charts/DrawdownChart.tsx` + `drawdown-chart.ts` -- pattern for an `@mui/x-charts` `LineChart` with utc x-axis, `tickDates`, custom axis tooltip via `ChartsTooltipContainer`/`useAxesTooltip`, `ChartsReferenceLine`, `role="figure"` + aria-label, colours via `theme.vars ?? theme`.
- `src/app/_components/charts/value-chart.ts:37,79-130` -- `utcDate`, `tickLabel`, `spanDays`, `tickDates`.
- `src/app/_components/charts/chart-preference.ts` + `src/app/_actions/chart-preference-cookie.ts` -- cookie names, `parse*` functions, `storeChartPreference` name union, server `read*` functions.
- `src/core/format.ts:56,132` -- `formatPercent` (signed, 2 dp), `formatFigure` (2 dp); `formatDate`.
- `src/app/(app)/securities/[id]/page.test.tsx:206-290` -- card-order tests via `html.indexOf('id="…"')`; `src/app/_components/security-detail/KeyFiguresCard.dom.test.tsx` -- DOM test setup (happy-dom, `registerDomCleanup`, `ThemeProvider`).

## Tasks & Acceptance

**Execution:**
- `src/core/format.ts` (+ test) -- add optional `decimals` parameter (default 2) to `formatPercent` and `formatFigure`; existing outputs unchanged -- one-decimal percent/figures for the rows.
- `src/modules/ledger/security-detail.ts` (+ test) -- `technical: TechnicalPosition` on `SecurityDetail`, from `tradingDayCloses(observations, securityId, actions, today)`; `fiftyTwoWeek` = `fiftyTwoWeekFromCloses` of the same closes (identical result) -- one source, computed on read.
- `src/app/_components/charts/chart-preference.ts`, `src/app/_actions/chart-preference-cookie.ts` (+ test) -- `TECHNICAL_INDICATOR_COOKIE = "dm_technical_indicator"`, `TECHNICAL_INDICATORS = ["tsi","rsi","macd"]`, `parseTechnicalIndicator` (default `tsi`), add to `storeChartPreference` union, `readTechnicalIndicator()` -- remembered per browser.
- `src/app/_components/security-detail/technical-labels.ts` (new, + test) -- pure presentation: row texts per signal (formats from the I/O matrix; insufficient → "zu wenig Kursdaten"), tone per key (gain: trend `up`, MACD `positive*`, TSI `positive`, 52W `near-high`; loss: trend `down`, MACD `negative*`, TSI `negative`, 52W `near-low`; stale: RSI `overbought`/`oversold`, TSI `fading`/`turning`; none: `sideways`, RSI `neutral`, `between`), source line, plot data (`utcDate` dates + `Number` values per indicator), tooltip lines, aria label (e.g. "RSI 01.01.2026 – 04.11.2026: von 48,2 auf 64,3, Zonen 30 und 70").
- `src/app/_components/security-detail/TechnicalChart.tsx` (new) -- `LineChart` per indicator: TSI = TSI (`primary`) + signal (`chart.invested`) + zero reference line; RSI = RSI line + shaded bands 0–30 and 70–100 (soft tokens, e.g. `ChartsReferenceLine` at 30/70 plus band rects or areas), y 0..100; MACD = MACD + signal lines + histogram (bars or area; positive gain-soft/negative loss-soft) + zero line; x-axis utc `min`=`from`, `max`=`to`; axis tooltip with date and the indicator's values.
- `src/app/_components/security-detail/TechnicalCard.tsx` (new, + `TechnicalCard.dom.test.tsx`) -- `CollapsibleCard id="security-technical" heading="Technische Lage"`; props `position` (signals), `series` (Period points), `asOf` (last close date or `null`), `from`, `to`, `initialIndicator`; closed: source line + rows; opened: + `ToggleButtonGroup aria-label="Indikator"` + `TechnicalChart`; DOM tests: closed rows/pills, opened toggle + chart switch + cookie written, insufficient row, no-closes single line.
- `src/app/(app)/securities/[id]/page.tsx` (+ `page.test.tsx`) -- read the indicator cookie; render `TechnicalCard` directly after `keyFiguresCard` in both layouts, passing `detail.technical` signals, its series filtered to `detail.from..detail.to`, `asOf = detail.technical.series.at(-1)?.date ?? null`; page test asserts `security-key-figures` < `security-technical` < next card in both layouts; update the page JSDoc.

**Acceptance Criteria:**
- Given the Security detail page in the held and the watch-only layout, when it renders, then "Technische Lage" follows "Kennzahlen", closed, with the rows of the I/O matrix and the source line.
- Given the opened card, when the user switches TSI · RSI · MACD, then the chart shows that indicator over the page Period with tooltip and text alternative, and a reload starts on the last choice.
- Given a stock, ETF, fund, certificate or crypto Security with Prices, when the page renders, then the card shows signals the same way (no asset-type branching).
- Given the full suite, when `npm run lint && npm run typecheck && npm test && npm run build` runs, then it passes.

## Spec Change Log

## Review Triage Log

### 2026-11-05 — Review pass
- verdicts: 20 findings — high 0, medium 0, low 15, false 5, maybe-false 0
- findings:
  - `low` `patch` (blind) MACD histogram with `stepAfter` gives the newest value zero width — fixed: both histogram areas use `stepBefore`.
  - `low` `patch` (blind) tooltip histogram uses its own decimals — fixed: histogram, MACD and signal share the MACD value's precision.
  - `low` `patch` (blind) MACD text alternative mixes precisions — fixed: one precision (last MACD value) per sentence; test expectation updated.
  - `low` `reject` (blind) no-closes card keeps a chevron that reveals nothing — the spec deliberately keeps the card with only that line in both states; a separate card variant adds surface for a rare state.
  - `low` `patch` (blind) chart tooltip untested — fixed: DOM keyboard tooltip test for TSI and MACD (same root as the verification-gap finding).
  - `low` `reject` (blind) split/ISIN not tested for `technical` — `tradingDayCloses` (split, ISIN, current-security mapping) is covered by Story 11.2 tests and is the same input as the unchanged 52-week figures; the mapping to today's Security is the 52-week rule, not a mismatch.
  - `false` `reject` (blind) no per-asset-type test — the card and `securityDetail` have no asset-type branch; there is no path that could differ.
  - `low` `reject` (blind) booked layout without Prices untested — the same `technicalCard` element is rendered in both layouts; the watch-layout test covers the branch.
  - `low` `patch` (blind) default indicator hard-coded in two places — fixed: `DEFAULT_TECHNICAL_INDICATOR` used.
  - `low` `reject` (blind) neutral labels have no pill surface — design choice: no tone means plain text; the words carry the meaning.
  - `false` `reject` (blind) `macdDecimals` uses `ReturnDecimal` — style only; no harm named.
  - `low` `patch` (blind) test title claims 44 px targets without asserting — fixed: claim dropped from the title.
  - `low` `reject` (blind) full 3-year series computed every render — ~750 points, negligible; Story 11.4's payload excludes series by spec.
  - `low` `reject` (edge) stepAfter last bar — same as blind row 1 (patched).
  - `low` `patch` (edge) one valued point in the Period draws nothing — fixed: marks shown when a line has at most one value.
  - `low` `reject` (edge) RSI zones stop at the first/last close, not the axis edges — at most a weekend of unshaded edge; zones over the full domain need separate x data.
  - `low` `reject` (edge) MACD aria mixed precision — same as blind row 3 (patched).
  - `false` `reject` (edge) y ticks below 1e-8 read "0" — MACD values below 1e-8 need prices far below any held Security; not reachable in practice.
  - `low` `patch` (verification-gap) axis tooltip never exercised — fixed: tooltip DOM test (see blind row 5).
  - `false` `reject` (intent) visual/pointer aspects verified only at HTML/happy-dom level — descriptive; the diff implements the main reading and no defect was named.

## Design Notes

The x-axis shares the price chart's range (`from..to`) while plotting only trading-day points, so weekends show no fake values and the time positions match the price chart. Tones never carry meaning alone: the label text is always shown inside the pill. RSI zone shading uses the soft tokens (loss-soft above 70, gain-soft below 30 is acceptable as a pure background cue; the 30/70 lines are labelled in the aria text).

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.

## Auto Run Result

Status: done

**Summary:** Card "Technische Lage" on the Security detail page (both layouts, right after "Kennzahlen", closed by default): source line "berechnet aus Schlusskursen, Stand <letzter Schlusskurs>" and one row per signal (Trend, RSI, MACD, TSI, 52 Wochen) with value, German label and a soft-token pill as secondary cue; "zu wenig Kursdaten" per signal or as the only line without any close. Opened it adds a TSI · RSI · MACD toggle (cookie `dm_technical_indicator`, default TSI, no reload) and an `@mui/x-charts` indicator chart over the page Period (TSI + signal + zero line; RSI 0–100 with 30/70 zones; MACD + signal + histogram + zero line) with axis tooltip and text alternative. `securityDetail` computes `technical` from the same trading-day closes as the 52-week figures; the card computes nothing.

**Files changed:**
- `src/core/format.ts` (+ test) -- optional `decimals` for `formatPercent`/`formatFigure`.
- `src/modules/ledger/security-detail.ts` (+ test) -- `technical` on `SecurityDetail`; closes computed once for 52W and signals.
- `src/app/_components/charts/chart-preference.ts`, `src/app/_actions/chart-preference-cookie.ts` (+ test) -- indicator cookie.
- `src/app/_components/security-detail/technical-labels.ts` (new, + test) -- rows, tones, source line, plot data, tooltip, aria label.
- `src/app/_components/security-detail/TechnicalChart.tsx` (new) -- indicator chart.
- `src/app/_components/security-detail/TechnicalCard.tsx` (new, + DOM test) -- the card.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) -- card placement in both layouts, cookie read.
- `test/architecture/chart-imports.test.ts` -- `TechnicalChart.tsx` allowed to import the chart library.

**Review:** 20 findings — 8 patched (all low), 0 deferred, 12 rejected (reasons in the triage log).

**Follow-up review recommended:** false (patched: high 0, medium 0, low 8).

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (268 files, 3736 tests), `npm run build` — all passed after the patches; every I/O matrix row covered by passing tests.

**Residual risks:** not checked in a real browser (light/dark colours, narrow layout, chart look); RSI zone shading spans first..last plotted close rather than the full axis.
