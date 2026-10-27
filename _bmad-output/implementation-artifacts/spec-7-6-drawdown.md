---
title: 'Story 7.6: Drawdown'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '6776996ba70a2b861ea302d0e39b9688ba588ba6'
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

**Problem:** Tommy sees value development and returns, but not how far his Portfolio, a Depot or a single Security fell below its previous peak in the chosen Period — the risk he carries (FR-22, CAP-22, Addendum I).

**Approach:** One pure core function turns a daily level series (the TTWROR index for Portfolio/Depot, the split-adjusted resolver price for a Security) into a per-day drawdown series and its KPIs. Overview and Depot detail get chart tabs "Wertentwicklung | Drawdown"; Security detail's chart toggle gains "Drawdown" with buy/sell/dividend markers. Each tab choice persists in a cookie like the Period.

## Boundaries & Constraints

**Always:**
- Level series: Portfolio/Depot = the TTWROR chain index per Period day over exactly the series, start point and rows that `periodPerformance` / `portfolioPerformance` use (same flow rules: inflows at day start, outflows at day end, ADJUSTMENT values as flows, skipped days carry the index forward). The base is the start point (index `1`, date `from − 1`). The last index − 1 equals the Period TTWROR whenever that is non-null. Security = `SecurityDetail.priceSeries` (the resolver price already carried to today's units as of `to`, so recorded splits are never a drop); `null` days (no price yet) have drawdown `null`; without a base the first non-null level seeds the running peak (its own drawdown 0).
- Drawdown of a day = `level / runningPeak − 1` (≤ 0, ratio string via the returns precision). The running peak is the highest level so far, starting with the base; its date is the **latest** date the level reached it (`level ≥ peak`).
- KPIs: `current` = drawdown of the last point with a level; `max` = the most negative drawdown (earliest on ties); phase = peak date before that trough → first later date with `level ≥ that peak` (`recovered: true`), else the last point's date (`recovered: false`); `days` = `daysBetween(peak, end)`. Without any decline `max` = `"0"` and phase `null`; without any level `current`/`max` `null`.
- UI: drawdown chart = red (theme `palette.loss`) area between a 0 % baseline and the line, y-axis showing %; axis tooltip with date and `formatPercent`; KPI row "Aktueller Drawdown", "Maximaler Drawdown", "Dauer" (`"4 Tage"`, `"1 Tag"`, caption "nicht erholt" when unrecovered) and "Periode" (`"01.02.2026 – 05.02.2026"`); null values and a null phase show `–`. `role="figure"` with aria-label naming the Period and the maximum drawdown. Money/percent via `core/format`; German labels; controls ≥ 44 px; gain/loss never by colour alone (sign shown).
- Persistence: value-chart tab (Overview + Depot detail, one shared cookie `dm_chart_tab`: `performance | drawdown`, default `performance`) and Security chart mode (cookie `dm_security_chart`: `price | value | drawdown`, default `price`). Written client-side on change (`path=/`, `SameSite=Lax`, max-age one year, `Secure` on https), read by the server page for the initial state; invalid values fall back to the default. Switching tabs never reloads the page; the Period change already reloads and recomputes.
- Security "Drawdown" shows the same buy/sell markers as "Kurs" plus dividend markers (DIVIDEND scope rows dated in the Period: Depot, date, gross amount), each at the day's drawdown; tooltip lists the day's trades (`tradeLine`) and dividends (`Dividende · <Depot> · <Betrag>`). Works for Securities no longer held (any booked Security with prices).
- `src/core` pure and imports only its own files and `decimal.js`; ledger stays the only DB reader; nothing stored; `Number(...)` only for plot coordinates.

**Never:** a second TTWROR or price-resolver definition; drawdown on raw values (flows must never count as losses); changing existing figures, the "Kurs"/"Wert" charts' content or the Analysen tabs; persisting the tab in the URL or via a server action that refreshes the page.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flow inside decline | start 2026-01-31 V 100; 02-01 V 110; 02-02 V 99; 02-03 DEPOSIT 99, V 178.2; 02-04 V 198; 02-05 V 220; 02-06 V 209 | index 1.1, 0.99, 0.891, 0.99, 1.1, 1.045; drawdown 0, −0.1, −0.19, −0.1, 0, −0.05; current −0.05; max −0.19; phase peak 02-01, end 02-05, recovered, 4 days | — |
| Unrecovered | levels 2026-03-01 100, 03-02 120, 03-03 90, 03-04 100, no base | max −0.25; phase peak 03-02, end 03-04, recovered false, 2 days; current −0.16666666666666666667 | — |
| Split in Period | stored price 100 on day 1, split 1:2 dated day 2, price 51 on day 2 (via `securityPriceSeries`) | levels 50, 51; drawdown 0, 0 | — |
| New peak | last level is the highest | current 0 | — |
| No decline | monotonic non-decreasing levels | all 0; max "0"; phase null → Dauer/Periode "–" | — |
| Nothing invested | days before the first Deposit in the Period (TTWROR skips them) | index stays 1, drawdown 0 | — |
| No price | Security levels all null | points with drawdown null; current/max null → all KPIs "–" | — |
| Empty | no points | points [], KPIs null/"–", chart hidden | — |
| Tie | two troughs with the same drawdown | the earlier one defines the phase | — |
| Parity | any Depot series | last index − 1 = `performance.ttwror` (non-null case) | — |

</intent-contract>

## Code Map

- `src/core/returns.ts:107-128` -- `ttwror(start, series, rows)`: daily factor loop (inflow/outflow per date via private `inOutByDate`, `adjustmentValueOf`, skip rule); private `ReturnDecimal` (precision 40) and `ratioString` (:17-27) — refactor the loop into an exported `ttwrorIndex`, keep `ttwror` results identical (`returns.test.ts` must stay green).
- `src/core/returns.ts:382` -- `portfolioPerformance(parts)`: Portfolio TTWROR over `sumValuationSeries` + all part rows — the Portfolio index uses the same inputs.
- `src/core/dates.ts:86` -- `daysBetween`; `src/core/format.ts:56` -- `formatPercent` (signed), `formatDate`, `formatMoney`.
- `src/core/security.ts:372` -- `securityPriceSeries` (split-adjusted levels for the Security); `:413` `securityTrades` / `SecurityTrade` — pattern for a new `securityDividends` marker helper.
- `src/core/return-heatmap.test.ts`, `src/core/returns.test.ts:1-40` -- fixture helpers and test style.
- `src/modules/ledger/valuation.ts:14-101` -- `DepotValuation`, `valuationOver` (rows, start, series, `periodPerformance`), `depotValuation`; `:105-156` `PortfolioValuation`, `portfolioValuation` (parts rows + summed series).
- `src/modules/ledger/security-detail.ts:41-69,166-198` -- `SecurityDetail` (`priceSeries`, `trades`, `scopeRows`, `names`) — add `drawdown` and `dividends`.
- `src/app/_actions/period-cookie.ts` -- cookie name/max-age/reader pattern (server-only `next/headers`).
- `src/app/_components/charts/value-chart.ts` -- `utcDate`, `tickDates`, `spanDays`, `tickLabel`, `chartFormatters` pattern; `ValueChart.tsx` -- LineChart setup, tooltip via `useAxesTooltip`, `colors(theme)`.
- `src/app/_components/charts/price-chart.ts`, `PriceChart.tsx` -- marker series (hidden line + marks per day), `tradesOn`, `tradeLine`, `TRADE_LABELS`, buy/sell colours.
- `src/app/_components/valuation/ValueSummary.tsx:155-199` -- hero card renders `ValueChart` from `series`; `Kpi` tile to reuse for the drawdown KPI row.
- `src/app/(app)/(overview)/page.tsx`, `src/app/(app)/depots/[id]/page.tsx:75-200` -- `readPeriod`, `ValueSummary` props; page tests mock modules.
- `src/app/_components/security-detail/SecurityChart.tsx`, `labels.ts:37` (`CHART_MODE_LABELS`, `ChartMode`), `SecurityDetail.dom.test.tsx`; `src/app/(app)/securities/[id]/page.tsx` -- chart props wiring.
- `src/theme/theme.ts:92-104` -- `palette.loss` (`main`, `soft`).

## Tasks & Acceptance

**Execution:**
- `src/core/returns.ts` -- export `ttwrorIndex(start, series, rows): { date: string; level: string }[]` (chain after each point, carried on skipped days) and base `ttwror` on it (null when no day multiplied); export the ratio precision helper needed by drawdown -- one daily-factor definition.
- `src/core/drawdown.ts` (+ `drawdown.test.ts`) -- `drawdown(levels: readonly { date; level: string | null }[], base?: { date; level: string })` → `{ points: { date; drawdown: string | null }[]; current: string | null; max: string | null; phase: { peak; end; recovered; days } | null }` -- tests cover every matrix row with exact strings (flow and parity rows via `ttwrorIndex`; split row via `securityPriceSeries`).
- `src/core/security.ts` (+ test) -- `securityDividends(rows: SecurityTradeRow[])` → `{ depotName; date; sequence; amount }[]` for DIVIDEND rows, ordered `(date, sequence)`.
- `src/modules/ledger/valuation.ts` (+ test) -- `drawdown: Drawdown` on `DepotValuation` and `PortfolioValuation` from `ttwrorIndex` with base `{ start.date, "1" }`.
- `src/modules/ledger/security-detail.ts` (+ test) -- `drawdown` over `priceSeries`; `dividends` from scope rows dated `from..to`.
- `src/app/_components/charts/chart-preference.ts` (+ test) -- cookie names, `parseValueChartTab`, `parseSecurityChartMode`, `storeChartPreference(name, value)` (document.cookie); `src/app/_actions/chart-preference-cookie.ts` -- server readers `readValueChartTab()`, `readSecurityChartMode()`.
- `src/app/_components/charts/drawdown-chart.ts` (+ test) -- plot data (incl. buy/sell/dividend marker arrays at the day's drawdown), tooltip lines, aria-label, KPI texts (`drawdownKpiTexts`).
- `src/app/_components/charts/DrawdownChart.tsx` (+ dom test) -- red area chart with 0 % baseline, optional trade/dividend markers, axis tooltip, KPI row below.
- `src/app/_components/valuation/ValueChartTabs.tsx` (+ dom test), `ValueSummary.tsx` -- tabs "Wertentwicklung | Drawdown" in the hero card when `drawdown` is given (`initialTab` prop, stores on change); without `drawdown` unchanged.
- `src/app/(app)/(overview)/page.tsx`, `src/app/(app)/depots/[id]/page.tsx` (+ page tests) -- pass `drawdown` and the stored tab.
- `src/app/_components/security-detail/labels.ts`, `SecurityChart.tsx` (+ dom test), `src/app/(app)/securities/[id]/page.tsx` (+ test) -- mode "Drawdown", `initialMode` from the cookie, stored on change; DrawdownChart with trades and dividends.

**Acceptance Criteria:**
- Given Overview or Depot detail with Transactions, when I pick "Drawdown", then the red drawdown chart and the four KPIs replace the value chart without reload; reloading keeps "Drawdown"; changing the Period recomputes it.
- Given Security detail (also for a Security no longer held), when I pick "Drawdown", then the split-neutral price drawdown with buy/sell/dividend markers and the KPIs show; the choice survives a reload.
- Given existing Kurs/Wert charts, value figures and Analysen tabs, then their behaviour is unchanged.
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 22 findings — high 0, medium 3, low 15, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: phase peak can be `from − 1` (the base) when the first Period day already declines, so "Periode" starts one day before the chart — the base on `start.date` is the spec's definition (Boundaries); changing it is a spec edit.
  - `[low]` `[reject]` Blind: "latest date at the peak" moves the peak date over carried (flat) days, e.g. a weekend before a drop — spec-defined peak-date rule (intent contract); changing it is a spec edit. Noted as residual risk.
  - `[low]` `[reject]` Blind: a sold Security's carried last price yields a long "nicht erholt" phase up to `to` — the resolver's carry-forward is the one price definition; the AC requires the view for Securities no longer held.
  - `[medium]` `[patch]` Blind: no Portfolio parity test across two Depots with flows — grouped with the verification-gap row; test added.
  - `[low]` `[reject]` Blind: a decline below display precision shows "-0,00 %" with a phase — the decline is real; a display-precision threshold would be a new rule, rare in practice.
  - `[low]` `[patch]` Blind: inactive Tab's `aria-controls` references an unrendered panel — `aria-controls` now only on the selected tab.
  - `[low]` `[reject]` Blind: marker shapes have no legend — same pattern as the "Kurs" chart (story 4-7): distinct shapes plus tooltip lines.
  - `[low]` `[patch]` Blind: leftover `export { Kpi }` re-export in `ValueSummary.tsx` — `SecurityKpis.tsx` and `DividendsView.tsx` import from `valuation/Kpi`; re-export deleted.
  - `[low]` `[patch]` Blind: duplicated constants/helpers — local `TABS` replaced by `VALUE_CHART_TABS`; per-chart `colors(theme)`, `MISSING` and the DOM-test style mock follow the existing per-file pattern (rejected parts).
  - `[low]` `[reject]` Blind: `storeChartPreference` accepts any string value per cookie — callers pass parsed values; a mapped type adds machinery for no observed bug.
  - `[false]` `[reject]` Blind: server cookie reader placed in `_actions` — mirrors `src/app/_actions/period-cookie.ts`, the established location for exactly this kind of reader.
  - `[low]` `[reject]` Blind: Depot page test compares against `businessDate(new Date())` and can flake around midnight — the page itself reads the wall clock; fixing needs fake timers, the window is seconds per day.
  - `[low]` `[reject]` Blind: missing DOM cases (SELL marker, dividend-only day, `initialMode` fallback without drawdown) — helpers are unit-tested in `drawdown-chart.test.ts`; fallback branch is one line.
  - `[low]` `[patch]` Blind: y-axis minimum equals the trough, clipping trough markers — `drawdownYMin` now adds 5 % of |min| below; test updated.
  - `[low]` `[patch]` Edge: inactive Tab's `aria-controls` points at a missing element — same fix as the Blind row.
  - `[medium]` `[patch]` Verification gap: Portfolio drawdown with flows in several Depots unverified (`parts[0].rows` would pass) — `valuation.test.ts` case with Deposits in both Depots asserting exact points, max, phase and `ttwror` parity.
  - `[false]` `[reject]` Intent: operator reading (browser checks as human actions) — the ACs name no off-repo action; nothing is owed to an operator.
  - `[low]` `[reject]` Intent: cookie round trip (client write → server read) only tested in halves — both halves tested; no browser e2e harness in the repo.
  - `[false]` `[reject]` Intent: "changing the Period recomputes" untested — drawdown is computed server-side from the same Period-resolved series on every render; a Period change reloads the page (existing PeriodSelector behaviour).
  - `[low]` `[reject]` Intent: hover tested via keyboard axis tooltip, not pointer — same tooltip mechanism as ValueChart/PriceChart tests.
  - `[medium]` `[patch]` Intent: Portfolio drawdown only tested with an empty second Depot — grouped with the verification-gap row.
  - `[false]` `[reject]` Intent: build surface not shown — lint, typecheck, test and build were run and passed (Verification).

## Design Notes

Flow reference: on 02-03 the raw value rises 99 → 178.2 because of a Deposit of 99, but the index factor is 178.2 / (99 + 99) = 0.9, so the drawdown deepens to 0.891 / 1.1 − 1 = −0.19 — the Deposit is not a gain, and a Withdrawal would not be a loss. Peak date = latest date at the peak, so after a recovery and a new dip the phase starts at the recovery date.

The tab cookies are not httpOnly (written by the client to avoid a server-action refresh); they hold only a UI choice.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Drawdown for Portfolio, Depot and Security. `core/returns` exposes `ttwrorIndex` (the one daily-factor loop behind `ttwror`); new pure `core/drawdown` turns a level series into per-day drawdown, current/max drawdown and the max phase. Ledger adds `drawdown` to Depot/Portfolio valuations (TTWROR index, base 1) and `drawdown` + `dividends` to Security detail (split-adjusted resolver prices). Overview and Depot detail get tabs "Wertentwicklung | Drawdown"; Security detail's toggle gains "Drawdown" with buy/sell/dividend markers. Choices persist in client-written cookies `dm_chart_tab` / `dm_security_chart`, read by the server pages.

**Files changed:**
- `src/core/returns.ts` -- `ttwrorIndex`, shared chain loop; exported ratio helpers.
- `src/core/drawdown.ts` (+ test) -- drawdown series, KPIs, phase; every matrix row tested.
- `src/core/security.ts` (+ test) -- `securityDividends` markers.
- `src/modules/ledger/valuation.ts` (+ test) -- `drawdown` on Depot/Portfolio valuation; multi-Depot flow test.
- `src/modules/ledger/security-detail.ts` (+ test) -- `drawdown`, `dividends`.
- `src/app/_components/charts/chart-preference.ts` (+ test), `src/app/_actions/chart-preference-cookie.ts` -- cookie names, parsing, client writer, server readers.
- `src/app/_components/charts/drawdown-chart.ts` (+ test), `DrawdownChart.tsx` (+ dom test) -- red area chart, markers, tooltip, KPI row.
- `src/app/_components/valuation/ValueChartTabs.tsx` (+ dom test), `Kpi.tsx`, `ValueSummary.tsx` (+ test) -- tabs in the hero card; `Kpi` moved.
- `src/app/_components/security-detail/SecurityChart.tsx`, `labels.ts`, `SecurityKpis.tsx`, `SecurityDetail.dom.test.tsx`; `src/app/_components/analyses/DividendsView.tsx` -- Drawdown mode; `Kpi` import path.
- `src/app/(app)/(overview)/page.tsx`, `depots/[id]/page.tsx`, `securities/[id]/page.tsx` (+ tests) -- wiring and stored tab/mode.
- `test/architecture/chart-imports.test.ts` -- allow `DrawdownChart.tsx` to import x-charts.

**Review findings:** 22 — patched 7 rows (5 entries: aria-controls, Kpi re-export, duplicated TABS, y-axis margin, Portfolio multi-Depot test; verdicts medium 1 entry, low 4 entries); deferred 0; rejected 15 (reasons in the Review Triage Log).

**Follow-up review recommended:** false -- one medium entry (test-only) and four low entries patched on a first pass.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` passed before and after the patches (206 test files, all green; build succeeded).

**Residual risks:** peak date is the latest date at the peak, so carried flat days (weekends, sparse prices) shift "Periode"/"Dauer" start to the last flat day; a sold Security's carried last price can show a long "nicht erholt" phase; chart look not checked in a real browser.

