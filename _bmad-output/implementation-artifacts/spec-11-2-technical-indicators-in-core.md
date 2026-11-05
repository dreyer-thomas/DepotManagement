---
title: 'Technical Indicators in Core'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_revision: '3dfed8e11f04a672cad3ddc2fb4d57b6c068f34e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Stories 11.3 (card) and 11.4 (MCP) need trend and momentum signals (SMA200 trend, RSI, MACD, TSI, 52 Wochen) with a German interpretation, computed one way from stored closes; nothing computes them today.

**Approach:** A new pure module `src/core/technical.ts` with `technicalPosition(closes, today)` (AD-23) plus a core helper that turns Price observations into split-adjusted trading-day closes, shared with the existing 52-week figures (Story 9.6) so the 52 Wochen signal reuses exactly their high/low.

## Boundaries & Constraints

**Always:** pure core (imports only core files and `decimal.js`, no clock, `today` passed in); all arithmetic in `decimal.js`, values returned as decimal strings rounded to 20 decimal places (far below presentation); EMAs seeded with the SMA of their first window, k = 2/(n+1); RSI with Wilder smoothing (first average = SMA of the first 14 gains/losses, then `(prev·13 + x)/14`); every parameter, minimum and threshold in one exported `TECHNICAL_PARAMETERS` table; closes after `today` ignored; indicators are index-based over the closes given (dates never fill gaps); each signal is either `{ value, date (last close), key, label, …details }` or `{ value: null, reason: "insufficient-history" }`; existing `fiftyTwoWeekFigures` results stay identical.

**Never:** no verdict, score or recommendation combining signals (result holds exactly the five signals plus `series`); no storage, caching, export, schema or UI change; no MCP change (Story 11.4); no Stochastic/ATR/OBV or anything needing open/high/low/volume; no JS `number` arithmetic on prices.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reference series | fixture ≥ 250 closes | SMA200 trend, RSI, MACD/signal/histogram, TSI/signal and 52W equal the independent reference values (|diff| ≤ 1e-8) at the last close and at checkpoints of the series | — |
| Minimum edges | 219/220, 14/15, 34/35, 44/45 closes | trend, RSI, MACD, TSI flip from `insufficient-history` to a value exactly at the minimum | — |
| No closes / none in window | empty, or last close > 364 days before today | every signal `insufficient-history`; 52W only when no close in `today − 364 .. today` | — |
| Split inside the window | 1:2 split, closes before it twice as high | `tradingDayCloses` adjusts them; signals equal those of the unsplit series (no fake drop) | — |
| Gaps | trading-day closes with weekends/holidays missing; a `transaction` observation; two observations on one date | only stored provider/manual dates, one close per date (resolver winner); signals equal those of the same prices without dates in between | — |
| Ties | 52W within 5 % of both high and low | `near-high` wins | — |
| Ties | TSI = signal; TSI = 0; MACD = signal | "above" means strictly greater: TSI ≥ 0 and not above → `fading`; TSI < 0 and not above → `negative`; MACD not above → `negative` | — |
| MACD both crosses in last 5 closes | up then down cross | only the most recent cross counts (`negative-turning-down`) | — |
| Flat series | all closes equal | RSI 50 `neutral`; TSI 0 (zero smoothed absolute momentum → 0); trend 0 `sideways` | — |

</intent-contract>

## Code Map

- `src/core/key-figures.ts:96-170` -- `DatedClose`, `fiftyTwoWeekFigures(observations, securityId, actions, today)`: the closes extraction (non-transaction, `adjustedObservations` to today, `currentSecurityId`, last observation per date wins) and the window logic (`today − 364 .. today`, ties → later date, `distanceToHigh` via `ReturnDecimal`/`ratioString`). Extract both into exported `tradingDayCloses(...)` and `fiftyTwoWeekFromCloses(closes, today)`; `fiftyTwoWeekFigures` composes them unchanged.
- `src/core/key-figures.test.ts` -- existing fixtures (`provider()` helper, split action shape `{ splits: [{ securityId, date, ratioOld, ratioNew }], isinChanges: [] }`); must stay green.
- `src/core/returns.ts:17-28` -- `ReturnDecimal` (precision 40), `ratioString` (20 dp); reuse for indicator arithmetic and output strings.
- `src/core/decimal.ts` -- `canonicalDecimal`, `ExactDecimal`.
- `src/core/security.ts:484-524` -- `securityMovingAverage`: same closes rule, reference for style.
- `test/architecture/core-imports.test.ts` -- enforces core purity.

## Tasks & Acceptance

**Execution:**
- `src/core/key-figures.ts` -- export `tradingDayCloses(observations, securityId, actions, today): DatedClose[]` (ascending, canonical prices) and `fiftyTwoWeekFromCloses(closes, today): FiftyTwoWeekFigures`; reimplement `fiftyTwoWeekFigures` as their composition -- one 52-week source for 9.6 and 11.2.
- `src/core/technical.ts` (new) -- `TECHNICAL_PARAMETERS`, signal/key/label types, `technicalPosition(closes: readonly DatedClose[], today): TechnicalPosition` with `trend` (value = last close ÷ SMA200 − 1; details `sma200`), `rsi` (value 0..100), `macd` (value = MACD line; details `signal`, `histogram`), `tsi` (value; details `signal`), `fiftyTwoWeeks` (value = `distanceToHigh`; details `high`, `low` from `fiftyTwoWeekFromCloses`), and `series` (one entry per close: `date`, `rsi`, `macd`, `macdSignal`, `macdHistogram`, `tsi`, `tsiSignal`, each string or `null` before available). Keys/labels: trend `up`/`down`/`sideways` → "Aufwärtstrend"/"Abwärtstrend"/"Seitwärts"; rsi `overbought`/`oversold`/`neutral` → "überkauft"/"überverkauft"/"neutral"; macd `positive`/`positive-turning-up`/`negative`/`negative-turning-down` → "positiv"/"positiv, dreht nach oben"/"negativ"/"negativ, dreht nach unten"; tsi `positive`/`fading`/`negative`/`turning` → "Schwung positiv"/"Schwung lässt nach"/"Schwung negativ"/"Schwung dreht"; 52W `near-high`/`near-low`/`between` → "nahe Hoch"/"nahe Tief"/"dazwischen" -- AD-23.
- `test/fixtures/technical/reference.py` (new) + `test/fixtures/technical/reference-series.json` (new) -- a synthetic series of ≥ 260 business-day closes and reference values computed by an independent float implementation of the textbook formulas (documented in the script) -- reference AC.
- `src/core/technical.test.ts` (new) -- reference comparison, every I/O matrix row, interpretation thresholds per signal (at and around 70/30, ±5 %, SMA200 slope over 20 closes, MACD cross 5 vs 6 closes back), result has no extra keys -- AC tests.
- `src/core/key-figures.test.ts` -- add `tradingDayCloses` cases (transaction excluded, one close per date, split adjusted, after today excluded) -- shared helper coverage.

**Acceptance Criteria:**
- Given the fixture series, when `technicalPosition` runs, then every signal value and the series values at the checkpoints match the reference within 1e-8 and the interpretations match the thresholds.
- Given any series, when `technicalPosition` runs, then the result contains only `trend`, `rsi`, `macd`, `tsi`, `fiftyTwoWeeks` and `series` — no combined verdict.
- Given the full suite, when `npm run lint && npm run typecheck && npm test && npm run build` runs, then it passes, including `test/architecture/core-imports.test.ts` and the unchanged 52-week tests.

## Spec Change Log

## Review Triage Log

### 2026-11-05 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 13, false 12, maybe-false 0
- findings:
  - `false` `reject` (blind) TSI minimum 45 has no basis — the epic AC and AD-23 fix "needs 45 closes"; the Design Notes give the derivation.
  - `false` `reject` (blind) stale data presented as current — every signal returns its last close `date`; the AC defines `insufficient-history` by close count only; the 11.3 card shows "Stand <date>".
  - `low` `patch` (blind) classification on raw 40-digit values while values are returned rounded — a raw TSI ≈ −1e-25 returned "0" with key `negative`; fixed: series rounded once to 20 dp and every key (trend, MACD incl. crosses, TSI, RSI) classified on the returned values; test with a 1e-30 move added.
  - `low` `reject` (blind) zero SMA200 / zero 52-week high reported as `insufficient-history` — needs all-zero closes; stored Prices are positive, practically unreachable; a new reason would add surface.
  - `low` `reject` (blind) reference fixture does not cover every interpretation key — every key and threshold is covered by explicit threshold tests in `src/core/technical.test.ts`; the reference checks the values.
  - `low` `reject` (blind) no drift guard between `reference.py` and the JSON — the TS is checked against the committed values; editing the script without regenerating cannot make wrong TS pass.
  - `low` `reject` (blind) 52-week 365-day boundary untested — window logic unchanged from Story 9.6 and covered there; moving it adds no risk.
  - `low` `reject` (blind) `technicalPosition` trusts input order — documented precondition (`tradingDayCloses` output); a sort/guard adds complexity for a programmer error.
  - `false` `reject` (blind) two SMA implementations may disagree — both average the last N stored closes on or before a date (index-based); same rule.
  - `false` `reject` (blind) `tradingDayCloses` ISIN path untested — `key-figures.test.ts` "ISIN change …" exercises it through `fiftyTwoWeekFigures`, now a pure composition (tested equal).
  - `low` `reject` (blind) MACD cross window shorter near the minimum — no cross can be known before the signal exists; cosmetic.
  - `false` `reject` (blind) small simplifications (alias, double construction) — style only, no harm named.
  - `false` `reject` (blind) "no extra keys" check only top level — the AC (no combined verdict) is about the result shape; per-signal shapes are typed.
  - `low` `reject` (edge) unsorted/duplicate input to `technicalPosition` — same as blind row 8.
  - `low` `reject` (edge) `fiftyTwoWeekFromCloses` with unsorted input — same documented precondition; its only callers pass `tradingDayCloses` output.
  - `low` `reject` (edge) zero SMA200 — same as blind row 4.
  - `low` `reject` (edge) zero 52-week high — same as blind row 4.
  - `false` `reject` (edge) invalid decimal string throws — core throws on programmer errors by convention; callers pass canonical strings.
  - `low` `patch` (edge) 52-week window missing from `TECHNICAL_PARAMETERS` — fixed: `FIFTY_TWO_WEEK_WINDOW_DAYS` exported from key-figures and referenced as `fiftyTwoWeeks.windowDays`.
  - `false` `reject` (intent) no production caller yet — the epic orders 11.3/11.4 as the consumers; 11.2 is core only.
  - `false` `reject` (intent) reference from a Python script, not hand/spreadsheet — an independent float implementation of the textbook formulas is the spreadsheet equivalent and is committed with its generator.
  - `low` `reject` (intent) split and gaps not in the reference fixture — indicators are index-based; the invariance tests prove gaps/split give the reference-checked computation; a mid-week holiday is the same case as a weekend.
  - `false` `reject` (intent) minimum edges on a synthetic series — the AC asks for the edges, not on which series.
  - `false` `reject` (intent) trend as a fraction, not % — repo convention: ratios as plain decimals, % at presentation.
  - `false` `reject` (intent) tie rules decided in the spec — they resolve the 11.1 deferred item; no AC reading contradicts them.

## Design Notes

Minimums follow the first point where a previous value exists for comparisons: trend needs SMA200 now and 20 closes earlier (200 + 20); MACD's first signal value is at close 34 (26 + 9 − 1), the 35th gives one prior point for cross detection; TSI's first signal value is at close 44 (1 + 25 + 13 + 7 − 2), 45 likewise. A MACD "cross" at close i means the strict-above state differs between closes i−1 and i, for i among the last 5 closes. 52 Wochen: "within 5 %" = `close ≥ high · 0.95` (near-high) or `close ≤ low · 1.05` (near-low). These tie rules resolve the 11.1 deferred item.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.

## Auto Run Result

Status: done

**Summary:** New pure module `src/core/technical.ts` with `technicalPosition(closes, today)` (AD-23): Trend (distance to SMA200, slope over 20 closes), RSI(14, Wilder), MACD(12/26/9) with cross detection over the last 5 closes, TSI(25/13, signal 7) and 52 Wochen (reusing the Story 9.6 figures), each with key and German label or `insufficient-history`, plus the daily RSI/MACD/TSI series. All parameters and thresholds in `TECHNICAL_PARAMETERS`; `decimal.js` only; keys are classified on the returned 20-dp values. `tradingDayCloses` (stored, split-adjusted, one close per date) and `fiftyTwoWeekFromCloses` were extracted from `fiftyTwoWeekFigures`, which is now their composition with identical results. No signal combination, no storage, no UI or MCP change.

**Files changed:**
- `src/core/key-figures.ts` -- `tradingDayCloses`, `fiftyTwoWeekFromCloses`, exported `FIFTY_TWO_WEEK_WINDOW_DAYS`; `fiftyTwoWeekFigures` composes them.
- `src/core/key-figures.test.ts` -- `tradingDayCloses` cases and composition equality.
- `src/core/technical.ts` (new) -- parameters, types, labels, `technicalPosition`.
- `src/core/technical.test.ts` (new) -- matrix rows, minimum edges, thresholds, ties, crosses, gaps, split, rounding-tie test.
- `test/core/technical-reference.test.ts` (new) -- comparison with the reference values (outside `src/core`, which may not import `test/fixtures`).
- `test/fixtures/technical/reference.py` + `reference-series.json` (new) -- 300 synthetic weekday closes and independent float reference values.

**Review:** 25 findings — 2 patched (low: classification on returned rounded values; 52-week window in the parameter table), 0 deferred, 23 rejected (reasons in the triage log). Patches applied by the implementation subagent.

**Follow-up review recommended:** false (patched: high 0, medium 0, low 2).

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (266 files, 3713 tests), `npm run build` — all passed; all matrix rows covered by passing tests.

**Residual risks:** reference values come from an independent float implementation, not a spreadsheet; `technicalPosition` assumes sorted, one-per-date closes (as `tradingDayCloses` delivers) — Stories 11.3/11.4 must feed it that helper's output; signals carry their last close date but are not flagged stale.
