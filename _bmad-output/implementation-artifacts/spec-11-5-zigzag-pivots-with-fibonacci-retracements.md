---
title: 'ZigZag Pivots with Fibonacci Retracements'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_revision: '79bfb07aed133810508484b997a899ead6377299'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tommy wants to read trend waves (Elliott-style) himself on a Security's price chart, but the chart shows no significant highs and lows and no Fibonacci levels; the app must not pretend to count waves.

**Approach:** a pure core function `zigzag(closes, threshold)` finds ZigZag pivots in the Period's trading-day closes and the Fibonacci levels of the last completed swing; `securityDetail` computes it for the three thresholds (5, 8, 12 %); the "Kurs" chart gets a "Wendepunkte" switch (like "Gleitender Durchschnitt") with a threshold toggle "5 % · 8 % · 12 %" (default 8 %, choice in a cookie) that draws the ZigZag line and labelled level lines.

## Boundaries & Constraints

**Always:** all arithmetic in `decimal.js` (`ExactDecimal`), results as canonical decimal strings; `Number(...)` only for plot coordinates; input closes = `tradingDayCloses(observations, priceSecurity.id, actions, to)` filtered to `from..to` (stored closes only, split-adjusted to the chart's units as of `to`, no carried-forward days) — so a split is never a pivot; a pivot is confirmed when the close reverses from the running extreme by at least the threshold (`(H − p) ÷ H ≥ t` downwards, `(p − L) ÷ L ≥ t` upwards); pivots alternate high/low; on equal extremes the earlier date stays the pivot; the running extreme after the last confirmed pivot is not a pivot; levels for the last completed swing A→B (the last two confirmed pivots): retracement `B − r·(B − A)` for r = 0.382, 0.5, 0.618 and extension `A + 1.618·(B − A)`, rounded like the moving averages (10 dp, half up); labels "38,2 %", "50 %", "61,8 %", "161,8 %" each with the level price in de-DE money format; the y-axis range includes every drawn level; switch and toggle ≥ 44 px; colours only from existing tokens (ZigZag line `chart.invested`, level lines `text.secondary` dotted, labels `text.secondary`); `@mui/x-charts` as the other charts; the switch is offered on "Kurs" in both layouts (held and watch-only); choice stored client-side in cookie `dm_pivots` (`off | 5 | 8 | 12`, default `off`), the server reads the initial value.

**Never:** no wave numbers, wave labels (1–5, A–C) or Elliott count anywhere (chart, tooltip, text alternative); no buy/sell verdict text; no storage, caching or export of pivots or levels; no MCP change; no change to `core/technical.ts`, the "Technische Lage" card or other chart modes; no new design tokens; no page reload when switching.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Up-down-up | closes 100, 110, 120, 108, 100, 112, 115 at 8 % | pivots low 100 (1st), high 120, low 100 (5th); last swing high 120 → low 100: 38,2 % = 107.64, 50 % = 110, 61,8 % = 112.36, 161,8 % = 87.64 | — |
| Threshold edge | high 100, then close 92 at 8 % | 92 confirms the high (exactly 8 % counts); close 92.01 does not | — |
| Flat series | all closes equal, or every move < threshold | no pivots, no levels | chart caption "Keine Wendepunkte ab 8 % im Zeitraum." |
| One pivot | only one confirmed pivot | pivot drawn, no levels | caption "Keine abgeschlossene Bewegung ab 8 % im Zeitraum." |
| Split | stored close 200, then 2:1 split, close 95 | adjusted closes 100, 95 → no pivot from the split | — |
| Extension ≤ 0 | down-swing 100 → 30 | extension `A + 1.618·(B − A)` = −13.26 → `extension: null`, not drawn; retracements drawn | — |
| Threshold switch | toggle "12 %" | chart redraws from the 12 % result without reload; cookie `dm_pivots=12`; next render starts with 12 % on | invalid/missing cookie → `off` |
| Switch off | switch off | no ZigZag, no levels; cookie `dm_pivots=off` | — |
| Text alternative | on, 8 %, 3 pivots, levels | aria-label appends ", mit Wendepunkten ab 8 %: 3 Wendepunkte, Fibonacci 38,2 % 107,64 €, 50 % 110,00 €, 61,8 % 112,36 €, 161,8 % 87,64 €" | no levels → only the pivot count |

</intent-contract>

## Code Map

- `src/core/key-figures.ts:123-150` -- `tradingDayCloses` (input), `DatedClose` type. Read-only.
- `src/core/security.ts:474,484-524` -- `AVERAGE_DECIMALS = 10` and rounding pattern of `securityMovingAverage` to mirror (`canonicalDecimal`, `ROUND_HALF_UP`).
- `src/core/decimal.ts` -- `ExactDecimal`, `canonicalDecimal`.
- `src/core/key-figures.test.ts:57,139` -- `CorporateActions` split fixture pattern for the split test.
- `src/modules/ledger/security-detail.ts:52-101,234-271` -- `SecurityDetail` type and return (`from`, `to`, `priceSecurity`, `movingAverages`, `observations`, `actions`); add `pivots` next to `movingAverages`.
- `src/app/_components/security-detail/SecurityChart.tsx` -- "Kurs" mode controls: moving-average `Switch` + `ToggleButtonGroup` pattern (`TOGGLE_SX`, `storeChartPreference`); add the "Wendepunkte" switch and threshold toggle the same way; passes overlays to `PriceChart`.
- `src/app/_components/charts/PriceChart.tsx` -- `LineChart` with series ids and `sx` per series; add a ZigZag series (index-aligned to `points`, values only on pivot dates, `connectNulls: true`) and `ChartsReferenceLine` per level (see `DrawdownChart.tsx:8,163,214` for import/styling); set `yAxis` min/max to cover levels when on.
- `src/app/_components/charts/price-chart.ts` (+ `price-chart.test.ts`) -- pure helpers: plot data (`toAveragePlotData` pattern), `priceChartAriaLabel` (append pivot text), tooltip.
- `src/app/_components/charts/chart-preference.ts` + `src/app/_actions/chart-preference-cookie.ts` (+ `chart-preference.test.ts`) -- `MOVING_AVERAGE_*` pattern for the new cookie, `storeChartPreference` name union, `readMovingAverage` pattern.
- `src/app/_components/security-detail/labels.ts:50-51` -- `MOVING_AVERAGE_LABEL` pattern for "Wendepunkte" and threshold labels.
- `src/app/(app)/securities/[id]/page.tsx` -- two `SecurityChart` usages (booked ~line 230, watch ~line 230 of the watch branch) and the `Promise.all` cookie reads.
- `src/app/_components/charts/PriceChart.dom.test.tsx`, `src/app/_components/security-detail/SecurityDetail.dom.test.tsx` -- DOM test setup for chart and switch tests.

## Tasks & Acceptance

**Execution:**
- `src/core/zigzag.ts` (new) -- `ZIGZAG_THRESHOLDS = ["5","8","12"]` (percent), `DEFAULT_ZIGZAG_THRESHOLD = "8"`, types `ZigzagPivot { date, price, kind: "high" | "low" }`, `FibonacciLevel { ratio: "0.382"|"0.5"|"0.618"|"1.618", price }`, `ZigzagResult { pivots, retracements: FibonacciLevel[] , extension: FibonacciLevel | null }` (retracements empty and extension null with < 2 pivots); `zigzag(closes: readonly DatedClose[], thresholdPercent)` per the Always rules; imports only `decimal.js`/core -- pure, one source.
- `src/core/zigzag.test.ts` (new) -- every I/O row of the core (up-down-up, threshold edge at exactly and just below t, flat, all moves below t, one pivot, split via `tradingDayCloses` + split action, extension ≤ 0, equal extremes keep the earlier date, start with a falling series) and the level calculation for an up- and a down-swing.
- `src/modules/ledger/security-detail.ts` (+ test) -- `pivots: Record<ZigzagThreshold, ZigzagResult>` from `tradingDayCloses(observations, priceSecurity.id, actions, to)` filtered to `from..to`; test: values for a seeded series and that the closes are in the chart's (split-adjusted as of `to`) units.
- `src/app/_components/charts/chart-preference.ts`, `src/app/_actions/chart-preference-cookie.ts` (+ test) -- `PIVOTS_COOKIE = "dm_pivots"`, `PIVOT_CHOICES = ["off","5","8","12"]`, `parsePivotChoice` (default `off`), union entry, `readPivotChoice()`.
- `src/app/_components/charts/price-chart.ts` (+ test) -- `PriceChartPivotOverlay { threshold, pivots, retracements, extension }`, `toPivotPlotData(points, pivots)`, `pivotLevelLabel(level)` ("38,2 % · 107,64 €"), caption texts from the matrix, aria-label suffix; test the texts and that no output contains wave numbers.
- `src/app/_components/charts/PriceChart.tsx` -- optional `pivots` prop: ZigZag series + labelled reference lines + y range; caption below the chart when no pivots/levels.
- `src/app/_components/security-detail/labels.ts`, `SecurityChart.tsx` -- props `pivots?: Record<ZigzagThreshold, ZigzagResult>` and `initialPivots?: PivotChoice`; on "Kurs" a `FormControlLabel` + `Switch` "Wendepunkte" and, when on, `ToggleButtonGroup aria-label="Schwelle"` with "5 %", "8 %", "12 %"; stores the cookie on change.
- `src/app/_components/charts/PriceChart.dom.test.tsx`, `src/app/_components/security-detail/SecurityDetail.dom.test.tsx` -- DOM: switch on draws ZigZag series + 4 reference lines with labels; toggle to 12 % changes the drawn result and writes the cookie; no element text matches a wave count.
- `src/app/(app)/securities/[id]/page.tsx` (+ `page.test.tsx` if a render case needs the new prop) -- read `readPivotChoice()`, pass `pivots={detail.pivots}` and `initialPivots` to both `SecurityChart` usages; update the page JSDoc.

**Acceptance Criteria:**
- Given the price chart of a held or watch-only Security, when I switch on "Wendepunkte", then a ZigZag line connects the pivots of the selected threshold (default 8 %, selectable 5 · 8 · 12 %) computed by `core/zigzag` from the Period's trading-day closes.
- Given a last completed swing, when the switch is on, then the 38,2 %, 50 % and 61,8 % retracement levels and the 161,8 % extension are drawn and labelled with their prices.
- Given any state of the chart, when it renders, then no wave numbers and no Elliott count appear.
- Given the full suite, when `npm run lint && npm run typecheck && npm test && npm run build` runs, then it passes.

## Spec Change Log

## Review Triage Log

### 2026-11-05 — Review pass
- verdicts: 20 findings — high 0, medium 0, low 11, false 9, maybe-false 0
- findings:
  - `low` `reject` (blind) the Period's first close can become the first pivot, so pivots/levels shift with the selected Period — the first close is then the extreme of the visible range, a legitimate pivot of the chart shown; computing on the Period is the documented design (Design Notes) so the last swing is always visible.
  - `low` `patch` (blind) the four level labels (all `labelAlign="start"`) stack on the 160–200 px chart — fixed: alignment alternates per level (38,2/61,8 % left, 50/161,8 % right).
  - `low` `reject` (blind) the 161,8 % extension disappears without a caption when ≤ 0 — needs a swing of more than 61,8 % between two pivots; an extra caption branch for a rare case; the aria text lists exactly the drawn levels.
  - `low` `reject` (blind) no hint that the move after the last pivot is unconfirmed — the price line itself shows the current move; the spec defines the running extreme as not a pivot.
  - `low` `reject` (blind) pivots ignore Transaction-only days that the price line shows — on a date with a stored close the provider/manual price wins (`compareObservations`, SOURCE_RANK), so vertices sit on the line; Transaction-only days are by definition not trading-day closes, and held Securities get a 3-year backfill (11.1).
  - `low` `reject` (blind) moving-average and Fibonacci lines share `text.secondary` — the levels carry their own labels; no new tokens allowed; distinguishing is by label and dash pattern.
  - `low` `reject` (blind) labels of sub-1-€ prices lose precision (`formatMoney` 2 dp) — consistent with the price tooltip and price line, which use the same formatter.
  - `low` `patch` (blind) page wiring of `pivots`/`initialPivots` untested — fixed together with the verification-gap finding (same root cause).
  - `false` `reject` (blind) non-null assertions in the `zigzag` state machine — `direction` only becomes non-null after `high`/`low` are set; no reachable null; style only.
  - `false` `reject` (blind) zero closes confirm spurious pivots — stored prices are positive decimals (same refutation as stories 11.2/11.4).
  - `low` `reject` (blind) `tradingDayCloses` runs a second time as of `to` — linear over ~750 closes, negligible; reusing needs a `to === today` branch.
  - `false` `reject` (edge) a trade-day Transaction price outranks the provider close in the line — refuted: on a date the provider Price wins (`src/core/prices.ts:41-53`), so pivot vertices are on the line.
  - `low` `patch` (edge) explicit y range omits trade markers placed at their trade price — fixed: `plot.buys`/`plot.sells` included in `pivotYRange` input.
  - `false` `reject` (edge) zero/negative closes — same as blind row 10.
  - `low` `patch` (verification-gap) page never checks that `pivots` and the `dm_pivots` cookie reach either `SecurityChart` — fixed: page test asserts `chart.props.pivots`, `initialPivots` off/12/invalid→off, and "Wendepunkte" in the watch header.
  - `false` `reject` (intent) "start only after Tommy decides" not recorded — the orchestrator dispatched the story (moved from backlog), which is the go-ahead; no human action outside the repo is owed.
  - `false` `reject` (intent) pivots depend on the selected Period — descriptive; same design choice as blind row 1.
  - `false` `reject` (intent) no visual browser check — descriptive; no defect named; noted as residual risk.
  - `false` `reject` (intent) page path covered only by typecheck — same root cause as the verification-gap row (patched).
  - `false` `reject` (intent) tooltip "Wendepunkt · Hoch/Tief" and pivot markers go beyond the spec — within the boundaries (no wave count); no harm named.

## Design Notes

Pivots use only the Period's closes, so the "last completed swing" is always visible on the chart. The extension continues the swing direction (`A + 1.618·(B − A)`, the next-wave target used in Elliott-style reading), while the retracements measure the pullback from B toward A. Example (up-swing A = 100, B = 150): 38,2 % = 130.9, 50 % = 125, 61,8 % = 119.1, 161,8 % = 180.9. The ZigZag series only carries values on pivot dates and relies on `connectNulls`, so no fake prices appear between pivots.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.

## Auto Run Result

Status: done

**Summary:** New pure core function `zigzag(closes, threshold)` (`src/core/zigzag.ts`) finds alternating ZigZag pivots (reversal ≥ threshold, earlier date on ties, running extreme not a pivot) and the Fibonacci levels of the last completed swing (38,2/50/61,8 % retracements, 161,8 % extension `A + 1.618·(B − A)`, `null` when ≤ 0; 10 dp half up). `securityDetail` computes it for 5/8/12 % from the Period's stored, split-adjusted trading-day closes (as of `to`). The "Kurs" chart in both layouts gets a "Wendepunkte" switch with a "Schwelle" toggle 5 · 8 · 12 % (default 8 %, cookie `dm_pivots`, no reload): ZigZag line (`chart.invested`) through the pivots and dotted, labelled level lines; the y-axis covers every level; captions when there are no pivots or only one; aria text lists pivots and levels. No wave numbers or Elliott count anywhere.

**Files changed:**
- `src/core/zigzag.ts` (new, + test) -- pivots and Fibonacci levels.
- `src/modules/ledger/security-detail.ts` (+ test) -- `pivots` per threshold from the Period's closes.
- `src/app/_components/charts/chart-preference.ts`, `src/app/_actions/chart-preference-cookie.ts` (+ test) -- `dm_pivots` cookie, `readPivotChoice()`.
- `src/app/_components/charts/price-chart.ts` (+ test) -- plot data, level labels, captions, y range, tooltip line, aria suffix.
- `src/app/_components/charts/PriceChart.tsx` (+ DOM test) -- ZigZag series, labelled reference lines, y range.
- `src/app/_components/security-detail/SecurityChart.tsx`, `labels.ts` (+ DOM test) -- switch and threshold toggle.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) -- cookie read, props for both layouts, JSDoc.

**Review:** 20 findings — 3 patched (all low: trade markers in the y range, alternating label alignment, page wiring tests), 0 deferred, 17 rejected (reasons in the triage log).

**Follow-up review recommended:** false (patched: high 0, medium 0, low 3).

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (269 files, 3770 tests), `npm run build` — all passed after the patches; every I/O matrix row covered by passing tests.

**Residual risks:** not checked in a real browser (label legibility when levels are close, light/dark colours, narrow layout); pivots depend on the selected Period by design.
