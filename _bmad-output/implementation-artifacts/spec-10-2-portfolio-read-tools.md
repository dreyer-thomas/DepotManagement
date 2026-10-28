---
title: 'Portfolio read tools (story 10.2)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '9132a9ab3e9995a76080403d2ee8b7c1f646a09a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** With story 10.1 a grant can hold `portfolio:read`, but the only portfolio tool is `list_depots`; Claude cannot read Positions, Transactions, performance, allocation, income or Security details, so Tommy cannot run risk/strategy analyses with Claude instead of Parqet.

**Approach:** Add eight read-only MCP tools in `src/modules/mcp/portfolio-tools.ts`, each behind the 10.1 `requirePortfolioRead` gate and each a thin adapter over the same module services and core functions the pages use. Glue that today lives in `src/app` (allocation grouping, composition holdings, asset-type labels, dividend inputs, summary end-point) moves into modules so pages and tools call one function. Watchlist entries gain `held` when the grant has `portfolio:read`.

## Boundaries & Constraints

**Always:**
- Every tool: `annotations.readOnlyHint: true`, wrapped `guarded(name, requirePortfolioRead(ctx, body))`, registered for every grant (10.1 pattern), zod input schema, `ctx.db` passed to every service, price loaders bound to `ctx.db` (`(ids, asOf) => storedPriceHistory(ids, asOf, ctx.db)`, as `watchlistView` does). Valuations/benchmarks/security detail use `storedPriceHistory`; positions/allocation/dividends use `latestStoredPrices` — exactly as the pages.
- Payload: snake_case, amounts/quantities/ratios as decimal strings (or `null` where the service gives `null`), EUR, dates `YYYY-MM-DD`; never JS numbers for money; no ids/data of OAuth clients, grants, tokens, sessions.
- Optional `period` argument (string) parsed with `parsePeriod(period, ctx.today)`; absent → `DEFAULT_PERIOD` (1J); invalid → refusal `period-invalid`. Payload echoes `period` (serialized) plus resolved `from`/`to`.
- "Portfolio" = non-archived Depots (the services already do this); an explicit `depot_id` may name an archived Depot (pages show archived Depots read-only). Unknown `depot_id` → refusal `depot-not-found`; unknown `security_id` → `security-not-found`.
- Tools never compute financial figures: any arithmetic needed (position share, monthly sampling) is a new pure `src/core` function with unit tests.
- Logs never contain payload values.

**Never:**
- No tool that writes anything except the existing nine watchlist tools; no Prisma migration; no new UI; no change of displayed figures on any page (refactors must keep page tests green unchanged in expectations).
- `mcp` imports only `@/core/*` and `@/modules/{ledger,prices,classification,watchlist,auth}` index exports (AD-2/AD-22); never `src/app`.
- Do not touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Summary default | `get_portfolio_summary {}` | figures for 1J: `from,to,value,invested_capital,cash,gain,realized,unrealized,dividends,fees,taxes,ttwror,xirr,has_transactions,depots[{id,name,value,gain,ttwror,xirr}]` equal to the Overview's | — |
| Custom period | `period: "custom:2026-01-01:2026-06-30"` | `from`/`to` = those dates | `to > today` or bad text → `period-invalid` |
| Depot | `get_depot {depot_id}` | `list_depots` fields + same summary figures via `depotValuation`; Depot without Transactions → figures `null`, `has_transactions:false` | unknown id → `depot-not-found` |
| Positions | `list_positions {}` / `{depot_id}` | one row per Depot Position (`depot_id, depot_name, security{…}, quantity, price, price_date, stale, value, cost_basis, average_price, gain, gain_ratio, share`) + `positions_value`, `cash`; unpriced rows keep `null` value/share | archived Depot via id allowed |
| Transactions | filters `depot_id, from, to, types[], security_id, cursor, limit` | rows (date desc, sequence desc, id desc), each with `depot_id`; `next_cursor` or `null`; default all Depots incl. archived, limit 100 | `limit` > 500 → zod error; bad cursor → `cursor-invalid` |
| Performance | `get_performance {depot_id?, period?, interval?, benchmark?}` | `points[{date,value,invested_capital,ttwror}]` from start + daily series (monthly = last point per month); `benchmark {key,label,ttwror,points[{date,performance}]}` or `null` without stored prices | unknown benchmark → zod error |
| Allocation | `get_allocation {dimension?, depot_id?}` | segments `{key,kind,label,amount,share}` + positions per segment as Analysen › Aufteilung (German labels, "Unbekannt", "Guthaben", region split) | — |
| Income | `get_income {depot_id?, granularity: "month"\|"year"}` | `dividends[{period,gross,net}]` and `gains[{period,realized,dividends,fees,taxes,deposits,withdrawals,net_cash_flow}]` from `dividendAnalysis` / `gainsAnalysis` | — |
| Security | `get_security {security_id, depot_id?, period?}` | security, `held`, `booked`, price/stale, period performance, snapshot, `all_time` (realized, unrealized, dividends, fees, taxes_paid, total, total_invested, return_ratio, xirr, value), effective `classification`, `key_figures` incl. `analysts`; works without holding | unknown → `security-not-found` |
| No scope | any new tool without `portfolio:read` | 10.1 refusal, service untouched | — |
| Watchlist held | `get_watchlist` with / without `portfolio:read` | entries carry `held` only with the scope | — |

</intent-contract>

## Code Map

- `src/modules/mcp/portfolio-tools.ts` -- 10.1 gate `requirePortfolioRead`, `denied()`, `list_depots`, `PORTFOLIO_TOOL_NAMES`. All new tools go here.
- `src/modules/mcp/tools.ts` -- `result`, `guarded`, private `refusal`/`MESSAGES` (export `refusal`, add messages), `keyFiguresPayload(entry, info)` (only reads `entry.fiftyTwoWeek`; change first param to `FiftyTwoWeekFigures` so `get_security` reuses it with `detail.fiftyTwoWeek`), `entryPayload` (omits `held`; `WatchlistEntryView.held` already exists, `watchlist/entries.ts:212`).
- `src/modules/ledger/valuation.ts:120,160,234` -- `depotValuation`, `portfolioValuation`, `benchmarkLines(start, to, db, opts)` → `Record<BenchmarkKey, PerformancePoint[]|null>`; `performanceLine` = `"0"` at `start.date` then one point per series day. Pages pick `end = series.at(-1) ?? start` (`(overview)/page.tsx:157`, `depots/[id]/page.tsx:146`).
- `src/modules/ledger/positions.ts:106` -- `listPositions(depotId, today, db, {storedPrices})` → `PositionRecord`. `isStale(priceDate, today)` in `src/core/prices.ts:83` (as `PositionsTable.tsx:61`).
- `src/modules/ledger/transactions.ts` -- `listTransactions(depotId, db)` (`TransactionRecord`, `TRANSACTION_TYPES`, order date desc, sequence desc). No filter/paging yet.
- `src/modules/ledger/gains.ts:23` -- `gainsInput(scope, db)`; `src/core/gains-analysis.ts:110` `gainsAnalysis`; `src/core/dividend-analysis.ts:189` `dividendAnalysis`.
- `src/modules/ledger/security-detail.ts:113` -- `securityDetail(id, depotId|undefined, selection, today, db, opts)` → `SecurityDetail|null` (`total`, `snapshot`, `performance`, `fiftyTwoWeek`, `depots`).
- `src/core/period.ts` -- `parsePeriod`, `serializePeriod`, `DEFAULT_PERIOD`. `src/core/benchmarks.ts:22` `BENCHMARKS` (keys msci-world, msci-acwi, dax, sp500, with labels).
- `src/core/composition.ts`, `src/core/allocation.ts` -- `allocation(holdings, cash, labels)`; `AllocationPosition.share` = value / scope total incl. cash.
- `src/app/(app)/analyses/page.tsx:51,103` -- `allocationPanel`, `dividendsPanel` glue to move.
- `src/app/_components/analyses/labels.ts:38-130` -- `ALLOCATION_DIMENSIONS`, `ALLOCATION_LABELS`, `NOT_APPLICABLE_LABEL`, `groupOf`, `RegionSplits`, `allocationHoldings` (to move; keep re-exports).
- `src/app/_components/composition/labels.ts:27` -- `compositionHoldings` (to move); `src/app/_components/transactions/labels.ts:33` `ASSET_TYPE_LABELS` (to move).
- `src/modules/classification` -- `listClassifications`, `listRegionSplits`, `listKeyFigures`; already imports `@/modules/ledger` and `@/modules/prices`. `effective(null, assetType)` in `@/core/classification` as fallback (`securities/[id]/page.tsx:84`).
- Fixtures: `src/modules/ledger/valuation.test.ts` (`createDepot`, `ensureSecurity`, `book()`, `TODAY`), `test/helpers/test-db.ts` `createTestDatabase()`, `src/modules/mcp/http.test.ts` (`connect()` helper, real MCP client, tool-list assertion).

## Tasks & Acceptance

**Execution:**
- `src/modules/ledger` -- move `ASSET_TYPE_LABELS` and `compositionHoldings` here (export from index; the app label files re-export them unchanged); add `valuationSummary(valuation)` returning `{from,to,value,investedCapital,cash,performance,dividends,taxesPaid}` with `end = series.at(-1) ?? start`, used by the Overview page; add `dividendAnalysisInput(scope, today, db?, {storedPrices}?)` (the `dividendsPanel` mapping) used by the page; add `queryTransactions({depotId?, from?, to?, types?, securityId?, cursor?, limit}, db?)` → `{ok:true, rows: TransactionRecord[], nextCursor: string|null} | {ok:false, reason:"cursor-invalid"}` with keyset cursor on (date, sequence, id) desc, opaque base64url.
- `src/modules/classification/allocation.ts` (new, exported) -- move `ALLOCATION_DIMENSIONS`, `ALLOCATION_LABELS`, `NOT_APPLICABLE_LABEL`, `groupOf`, `RegionSplits`, `allocationHoldings`; add `allocationAnalysis(scope: "portfolio"|{depotId}, dimension, today, db?, {storedPrices}?)` → `Allocation` (the `allocationPanel` logic); `analyses/page.tsx` and `labels.ts` use / re-export them.
- `src/core/composition.ts` -- add pure `holdingShares(values: (string|null)[], cash: CompositionCash): (string|null)[]` (value / (Σ non-null values + cash), 30 dp, `null` for null value or non-positive total). `src/core/valuation.ts` (or `dates.ts`) -- add pure `lastPerMonth(points)` keeping each month's last point. Unit tests for both.
- `src/modules/mcp/tools.ts` -- export `refusal`; add messages `depot-not-found` "Dieses Depot gibt es nicht.", `period-invalid` "Der Zeitraum ist ungültig. Erlaubt: 1T, 1W, 1M, YTD, 1J, 3J, MAX oder custom:JJJJ-MM-TT:JJJJ-MM-TT.", `cursor-invalid` "Der Cursor ist ungültig."; `keyFiguresPayload(fiftyTwoWeek, info)`; `entryPayload(entry, keyFigures?, withHeld?)` adds `held` when `ctx.scopes` has `portfolio:read` (all watchlist tools returning entries).
- `src/modules/mcp/portfolio-tools.ts` -- add `get_portfolio_summary`, `get_depot`, `list_positions`, `list_transactions`, `get_performance`, `get_allocation`, `get_income`, `get_security` per the matrix; `PORTFOLIO_TOOL_NAMES` lists all nine; descriptions state units (EUR decimal strings, ratios as decimals, TTWROR not annualised, XIRR annualised).
- `src/modules/mcp/server.ts` -- INSTRUCTIONS mention the read tools and the period syntax.
- Tests -- `src/core/*.test.ts` for the new pure functions; `src/modules/ledger/*.test.ts` for `queryTransactions` (filters, order, cursor round trip over > limit rows, bad cursor), `valuationSummary`, `dividendAnalysisInput`; `src/modules/classification/allocation.test.ts`; `src/modules/mcp/portfolio-tools.test.ts`: on one fixture ledger (2 Depots, one archived; buys, sell, dividend, fee, tax, deposit; stored prices; a classification and region split; a benchmark price) call each tool and assert its parsed payload equals the mapping of the page's service call (`valuationSummary(portfolioValuation(...))`, `listPositions`, `allocationAnalysis`, `gainsAnalysis(gainsInput)`, `dividendAnalysis(dividendAnalysisInput)`, `securityDetail`, `listTransactions` concatenation) plus every refusal row; `http.test.ts`: tool list = 9 watchlist + 9 portfolio tools, every tool without `readOnlyHint` is one of the watchlist write tools (`create/rename/delete_watchlist`, `add/update/remove_watchlist_entry`), `held` present only with the scope, one portfolio tool end-to-end with and without scope. Existing page tests stay green.

**Acceptance Criteria:**
- Given a grant with `portfolio:read`, when Claude lists tools via `/api/mcp`, then `get_portfolio_summary`, `list_depots`, `get_depot`, `list_positions`, `list_transactions`, `get_performance`, `get_allocation`, `get_income`, `get_security` exist and all are `readOnlyHint: true`, and no tool outside the six watchlist write tools lacks `readOnlyHint`.
- Given the fixture ledger, when each tool is called, then its figures equal those produced by the same module/core call the corresponding page makes (test per tool).
- Given more than 500 matching Transactions, when `list_transactions` is paged with `limit: 500`, then each page has ≤ 500 rows, rows do not repeat and the last page has `next_cursor: null`.
- Given a watchlist entry of a held Security, when `get_watchlist` is called with `portfolio:read`, then the entry has `held: true`; without the scope it has no `held` key.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 31 findings — high 0, medium 0, low 22, false 9, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `get_portfolio_summary` has no null-figures branch for an empty ledger, unlike `get_depot` — `has_transactions: false` is in the payload and the figures are what `portfolioValuation` returns (the Overview still renders its Depot rows from them); unlikely and not wrong.
  - `[low]` `[reject]` (blind) Depot page still uses `series.at(-1)` without the `?? start` fallback of `valuationSummary` — only differs when a Depot with Transactions has an empty series, which the period resolution does not produce; refactoring the page is beyond a direct correction.
  - `[low]` `[reject]` (blind) Per-Depot rows in `get_portfolio_summary` copy the Overview's `?? "0"` mapping by hand — identical to the page line it mirrors; divergence from `get_depot` only with an empty series.
  - `[false]` `[reject]` (blind) Benchmark return labelled `ttwror` although it is a price return — the benchmark line is flow-free, so its TTWROR equals its price return, and the UI's comparison uses the same `ttwror` field.
  - `[low]` `[patch]` (blind) `list_transactions` accepts impossible dates like `2026-13-45` — `dateArg` now refines with `isBusinessDate`; test added. (`from > to` and `types: []` returning nothing are correct empty results — not changed.)
  - `[low]` `[patch]` (blind) Cursor not tied to its filters — description now says to pass `cursor` with the same filters.
  - `[low]` `[reject]` (blind) `getDepot` existence checks load rows twice — single-user, small ledgers; a separate existence service would add public surface.
  - `[low]` `[patch]` (blind) Unpriced Position path untested at the tool — fixture gained an ADJUSTMENT-only holding without price; test asserts null price/value/gain/share and `stale: false`.
  - `[low]` `[patch]` (blind) >500-row AC tested only on `queryTransactions` — tool-level test pages 1,103 extra rows with `limit: 500`, no repeats, last cursor null.
  - `[false]` `[reject]` (blind) Removed tests lose the refusal text and body pass-through — the literal "Keine Berechtigung für Depotdaten" is asserted in `http.test.ts`, and every scoped tool test passes arguments through `requirePortfolioRead`.
  - `[low]` `[patch]` (blind) Analysen page test mocks re-implement the moved functions — the page test now runs the real `allocationAnalysis` / `dividendAnalysisInput` (moved to `ledger/dividends.ts` so it can be mocked around) over the mocked reads; expectations unchanged.
  - `[low]` `[patch]` (blind) `list_depots` description lacks the units sentence — appended.
  - `[low]` `[patch]` (blind) `price_security` undocumented — explained in the `get_security` description.
  - `[false]` `[reject]` (blind) Spec out of date with the implementation — fix would edit this build's spec.
  - `[low]` `[patch]` (edge) `get_security` with a `depot_id` that never booked the Security silently falls back to all Depots — now refuses `security-not-in-depot` ("Dieses Wertpapier wurde in diesem Depot nicht gebucht."); tested.
  - `[low]` `[patch]` (edge) Impossible `from`/`to` dates — same fix as the blind date finding.
  - `[false]` `[reject]` (edge) `from > to` returns an empty page — an empty date range correctly has no rows.
  - `[false]` `[reject]` (edge) `types: []` matches nothing — filtering by no types correctly matches no rows; the schema documents the filter.
  - `[false]` `[reject]` (edge) NaN `limit` reaches Prisma — the only caller passes a zod-validated integer or the default.
  - `[low]` `[reject]` (edge) Empty Portfolio zero vs null figures — same as the first blind finding.
  - `[low]` `[reject]` (edge) Depot value `"0"` vs `start` fallback — same as the blind per-Depot finding.
  - `[false]` `[reject]` (edge) `entryById` fallback `{ id }` lacks `held` — the entry was just written in the same request; the fallback is unreachable in practice and predates this story.
  - `[low]` `[patch]` (verification-gap) `allocationAnalysis` never tested with `storedPrices` — new case with a stored price differing from the Transaction price and literal segment amounts.
  - `[low]` `[patch]` (verification-gap) `get_security` key figures / analysts never populated — fixture seeds a key-figures row with analyst data; payload asserted.
  - `[low]` `[patch]` (verification-gap) Monthly benchmark sampling never exercised — monthly `msci-world` call asserts `lastPerMonth(line)`.
  - `[low]` `[patch]` (verification-gap) Test title claims a 500 cap it never checks — test now asserts `limit: 0` → 1 row and `limit: 10000` → 500 rows.
  - `[low]` `[patch]` (intent) No test spans page and tool; page test mocked the moved glue — grouped with the page-test mock finding: the page test now runs the real shared functions the tool test compares against.
  - `[low]` `[reject]` (intent) `list_transactions` quantities not split-adjusted unlike the UI list — booked values are the ledger truth, the description states it, and `list_positions` gives split-adjusted holdings; adding adjusted fields is new surface.
  - `[false]` `[reject]` (intent) "No writes" checked by annotation only — the AC asks for a tool-list test, which asserts that only the six watchlist write tools lack `readOnlyHint`.
  - `[low]` `[patch]` (intent) 500 limit only tested below the tool — same as the blind >500 finding.
  - `[false]` `[reject]` (intent) No test aimed at credentials/session data — every tool payload is matched exactly with `toEqual`, which fails on any extra field.

## Design Notes

Moving glue into modules (with re-exports from the old app paths) is what makes "same function as the UI" literally true and lets the comparison test call one function. Keyset cursor sketch: `base64url(JSON.stringify([date, sequence, id]))`; next page = rows strictly after that key in (date desc, sequence desc, id desc) order; filter in SQL on depot/security/type/date, compare the tuple in the query.

`list_transactions` returns quantities as booked (no split adjustment, unlike the UI list's display); the description says so.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass

## Auto Run Result

Status: done

**Summary:** Eight new read-only MCP tools (`get_portfolio_summary`, `get_depot`, `list_positions`, `list_transactions`, `get_performance`, `get_allocation`, `get_income`, `get_security`) join `list_depots`, each behind the 10.1 `portfolio:read` gate and each calling the same module/core functions as the pages. Page glue moved into modules (`valuationSummary`, `dividendAnalysisInput`, `compositionHoldings`, `ASSET_TYPE_LABELS`, `allocationAnalysis` + allocation groups) so pages and tools share one function; new pure core helpers `holdingShares`, `holdingTotals`, `lastPerMonth`; `queryTransactions` adds filtered keyset paging (≤ 500). Watchlist entries carry `held` only with `portfolio:read`.

**Files changed:**
- `src/modules/mcp/portfolio-tools.ts` — the nine read tools, period/depot/security/cursor refusals.
- `src/modules/mcp/tools.ts` — exported `refusal`, new messages, `keyFiguresPayload(fiftyTwoWeek, info)`, `held` with the scope.
- `src/modules/mcp/server.ts` — instructions for the read tools and period syntax.
- `src/modules/ledger/{valuation,transactions,dividends,gains,composition,labels,index}.ts` — `valuationSummary`, `queryTransactions`, `dividendAnalysisInput`, moved holdings/labels.
- `src/modules/classification/{allocation,allocation-groups,index}.ts` — `allocationAnalysis` and the moved dimension/grouping code.
- `src/core/composition.ts`, `src/core/dates.ts` — `holdingShares`, `holdingTotals`, `lastPerMonth`.
- `src/app/(app)/(overview)/page.tsx`, `src/app/(app)/analyses/page.tsx`, `src/app/_components/{analyses,composition,transactions}/labels.ts` — use / re-export the moved functions.
- Tests: `portfolio-tools.test.ts`, `http.test.ts`, `allocation.test.ts`, `transactions.test.ts`, `gains.test.ts`, `valuation.test.ts`, `composition.test.ts`, `dates.test.ts`, `analyses/page.test.tsx`.

**Review findings:** 31 total — 15 patched (all low; 3 of them duplicates grouped with another patch), 0 deferred, 16 rejected (9 false, 7 low not worth the complexity or unreachable); reasons in the Review Triage Log.

**Follow-up review recommendation:** false — patched counts: high 0, medium 0, low 15.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass after the patches (261 test files, 3620 tests). Every I/O-matrix row is covered by a passing test.

**Residual risks:** Not exercised against a live Claude client; `dividendAnalysisInput` calls `gainsInput(scope)` without a db argument when none is given (kept so the page test's call expectation matches); Depot page keeps its own `series.at(-1)` end point.
