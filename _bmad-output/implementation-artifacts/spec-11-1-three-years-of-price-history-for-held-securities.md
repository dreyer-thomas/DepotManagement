---
title: 'Three Years of Price History for Held Securities'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_revision: 'cc129f97f1afa106d98ad803e1fcdae5f4d86af6'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      refetchPriceHistory derives the start from the held role only, ignoring the watched and benchmark starts that heldPlans uses.
    evidence: |-
      For a held Security that is also watched or a benchmark, whose first stored close is after its watched/benchmark start, the split refetch sets historyFrom later than heldPlans' start, so the next run does one extra full backfill. Pre-existing (the old code used firstActivity ?? earliest, which was worse); fixing it needs the watched loader passed into refetchPriceHistory by schedulePriceRefetch.
    location: >-
      src/modules/prices/prices.ts refetchPriceHistory
    severity: low
  - summary: >-
      Epic 11 context leaves tie rules open for Story 11.2 (52 Wochen near both high and low, TSI equal to signal or 0, MACD with both crosses in 5 closes).
    evidence: |-
      The interpretation rules in epics.md / epic-11-context.md do not cover these boundary cases; Story 11.2 must decide them.
    location: >-
      _bmad-output/implementation-artifacts/epic-11-context.md
    severity: low
---

<intent-contract>

## Intent

**Problem:** A held Security's provider history starts at its first activity date, so a stock bought two months ago has far too few closes for SMA200 (≥ 220 closes) or TSI; watched Securities already get about 3 years (`watchlistHistoryStart`).

**Approach:** One pure core function computes a Security's price-history start from its roles (held, watched, benchmark); for a held Security it is the earlier of its first activity date and the `3J` preset start minus the benchmark buffer (AD-9 amended). `prices` uses it for every plan, so existing mappings whose `historyFrom` is later get one full backfill and later runs refresh only the overlap window.

## Boundaries & Constraints

**Always:** "Held" comes only from `listHeldSecurities` (AD-17); outbound requests carry only provider symbols (AD-13); a provider delivering less history stores what it delivers, records `historyFrom = plan.from` and reports no error; the start function lives in `src/core` (pure, `today` passed in, imports only core files); existing benchmark and watched starts stay exactly as today.

**Never:** No change to valuation, positions, returns, Depot/Portfolio charts — Prices before the first Transaction must not enter values (quantity is 0 there); no schema change or migration; no new provider calls beyond the backfill/overlap plans; no change to `watchlistPriceTargets`' contract (`prices` must not import `watchlist`, AD-2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Recent holding | today 2026-10-23, first buy 2026-10-13 | start `2023-10-13` (2023-10-23 − 10 days) | — |
| Old holding | first buy 2020-05-04 | start `2020-05-04` (unchanged, no re-backfill) | — |
| Held and watched | first buy 2026-10-13, watched start 2020-01-01 | `2020-01-01` (earliest) | — |
| Benchmark | first ledger date 2026-10-13 | `benchmarkStartDate` = `2023-10-13` | — |
| No role | nothing given | `null` (not planned) | — |
| Existing mapping, `historyFrom` 2026-10-13 | recent holding, scheduler run | one full plan from 2023-10-13, `historyFrom` = 2023-10-13; next run incremental (overlap 7 days) | — |
| Short provider history | Yahoo returns closes only from 2025-01-02 | stored, `historyFrom` = plan.from, `fetchError` null, no failure in result | — |
| Split refetch of held Security | recent holding, split recorded | `refetchPriceHistory` fetches from the same start (not first activity), so no extra backfill on the next run | — |

</intent-contract>

## Code Map

- `src/core/benchmarks.ts:33-44` -- `BENCHMARK_HISTORY_DAYS`, private `LONGEST_PRESET_MONTHS`, `benchmarkStartDate(firstLedger, today)`; reuse for the `3J`-start-minus-buffer date.
- `src/core/watchlist.ts:152-158` -- `watchlistHistoryStart` (delegates to `benchmarkStartDate`); reference shape, leave unchanged.
- `src/core/dates.ts` -- `addDays`, `addMonths`.
- `src/modules/prices/prices.ts:98-152` -- `heldPlans`: builds `firstDates` from `firstActivityDates` (held), overrides benchmarks with `benchmarkStartDate(firstLedger)`, min-merges `deps.watched`; then full plan when `historyFrom === null || historyFrom > first`, else incremental. Replace the ad-hoc date merge with the core function.
- `src/modules/prices/prices.ts:330-357` -- `refetchPriceHistory`: currently `from = firstActivity ?? earliest stored`; must use the same held start.
- `src/modules/prices/prices.ts:288-303` -- doc comments of `refreshPrices` / `backfillHeldPrices` mention "first activity date"; update.
- `src/modules/ledger/securities.ts:225-251` -- `firstActivityDates` (Transactions + ISIN-change successor dates), `firstLedgerDate`; read-only.
- `src/modules/prices/prices.test.ts` -- many expectations encode held `period1`/`historyFrom` = first activity (e.g. lines ~113, 128, 639, 679-697, 1058); NOW = 2026-10-23 so the recent-holding start is `2023-10-13`. Fake `charts()` serves recorded fixtures regardless of period.
- `src/modules/ledger/valuation.ts:120-209` -- `depotValuation` / `portfolioValuation` / `returnSeries`; use for the "values unchanged" test.
- `src/modules/ledger/security-detail.ts:210-256` -- price chart, price change, drawdown, moving averages and 52-week figures are price-only and will show the longer history (intended, same as watched Securities); holding series/performance use quantities and stay unchanged.

## Tasks & Acceptance

**Execution:**
- `src/core/benchmarks.ts` -- export a helper for the `3J` preset start minus `BENCHMARK_HISTORY_DAYS` (and use it inside `benchmarkStartDate`) -- one definition of the buffered `3J` start.
- `src/core/price-history.ts` (new) -- `priceHistoryStart({ firstActivity?, watchedFrom?, firstLedger? }, today): string | null`: earliest of held start `min(firstActivity, buffered 3J start)`, `watchedFrom` as given, benchmark `benchmarkStartDate(firstLedger, today)`; `null` when no role -- the single pure history-start function (AC).
- `src/core/price-history.test.ts` (new) -- matrix rows 1–5 plus a holding exactly at / just before the buffered 3J start -- unit tests required by the AC.
- `src/modules/prices/prices.ts` -- `heldPlans`: compute each mapping's start via `priceHistoryStart` (held = in `listHeldSecurities` with a first activity date; benchmark only for `benchmarkIds`; watched from `deps.watched`); keep the full/incremental decision and the `first > today` guard. `refetchPriceHistory`: for a held Security use `priceHistoryStart({ firstActivity })`, taking the earlier of that and the earliest stored provider date when one exists; unheld keeps the earliest stored date. Update doc comments -- AD-9 amended.
- `src/modules/prices/prices.test.ts` -- update the held expectations to the new start; add: existing mapping with later `historyFrom` → one full backfill, then incremental; short provider history → stored without error; `backfillHeldPrices` after a new buy plans from the buffered 3J start; old holding (first buy before 3J start) not re-backfilled; held + watched uses the earlier start -- prove the planning behavior.
- `src/modules/prices/prices.test.ts` (or `src/modules/ledger/valuation.test.ts`) -- fixture Depot: buy 2026-10-13, store provider Prices from 2023 onward via the run; `portfolioValuation`/`depotValuation` over `3J` and `MAX` give the same series and performance as with only Prices from the first buy on (delete the earlier rows and compare) -- "values, charts and returns unchanged" AC.

**Acceptance Criteria:**
- Given a held Security first bought less than 3 years before today, when `refreshPrices` or `backfillHeldPrices` runs, then the provider is asked for history from the buffered `3J` start and `historyFrom` records it.
- Given an existing mapping whose `historyFrom` is later than that start, when the scheduler runs twice, then the first run is a full plan and the second an incremental overlap refresh.
- Given a fixture Depot with Prices stored before its first buy, when its valuation and returns are computed, then they equal those computed without those Prices.
- Given the full suite, when `npm run lint && npm run typecheck && npm test && npm run build` runs, then it passes, including `test/architecture/core-imports.test.ts`.

## Spec Change Log

## Review Triage Log

### 2026-11-05 — Review pass
- verdicts: 31 findings — high 0, medium 0, low 11, false 20, maybe-false 0
- findings:
  - `low` `defer` (blind) refetchPriceHistory ignores watched/benchmark roles — real but pre-existing (old rule was worse); fix needs a new dependency on the refetch caller; deferred.
  - `low` `patch` (blind) sold-out refetch rule changed (earliest stored vs first activity) without a distinguishing test — added a provider row before the buy; test now asserts period1 2024-05-20.
  - `false` `reject` (blind) heldPlans passes firstActivity for every target, not only held — targeting still uses listHeldSecurities; passing firstActivity keeps the baseline start of sold-out watched Securities (spec Always: watched starts unchanged); watched/benchmark starts are never after the buffered 3J start, so held results are identical.
  - `false` `reject` (blind) AD-9 "same start as watched" vs literal reading — the AC text states "earlier of first Transaction date and the 3J start minus the buffer"; Design Notes record the choice and it avoids re-backfilling every old holding.
  - `low` `patch` (blind) crypto test name claims a Binance backfill while Binance answers invalid-symbol — renamed to "asks Binance … (no EUR pair: CoinGecko only)".
  - `low` `reject` (blind) old-holding crypto fixtures start later than the moved buy date — the tests still check the intended behavior (short history stored, historyFrom = plan.from); cosmetic.
  - `low` `reject` (blind) values-unchanged test omits Security-level holding series — the Security series uses the same valuationSeries the Depot/Portfolio test proves; price-only Security figures change by design.
  - `low` `patch` (blind) held refetch branch with earlier stored date untested — added test "refetches a held Security from its earliest stored provider date …".
  - `false` `reject` (blind) rollout load of the one-time backfill — accepted explicitly by the sprint change proposal (one-time larger backfill).
  - `low` `reject` (blind) bufferedPresetStart has no direct test — exercised via priceHistoryStart and the existing benchmarkStartDate tests; month clamping is covered by addMonths tests.
  - `low` `defer` (blind) Epic 11 context tie rules for 11.2 — not this story's code; deferred to Story 11.2.
  - `low` `patch` (blind) heldPlans doc comment broken mid-sentence — reflowed.
  - `false` `reject` (blind) spec logs empty / oversized unexplained — logs are filled during review; oversized is a size warning only.
  - `low` `defer` (edge) refetch for held+watched/benchmark → extra backfill — same root cause as the first deferred item.
  - `low` `reject` (edge) mapping with historyFrom but no provider rows plans a 3-year incremental each run — providers report empty history as not-found (full plan fails, historyFrom cleared); the state is practically unreachable.
  - `false` `reject` (edge) recent crypto Binance failure repeats full backfill — designed retry: not-found completes, only transient failures retry.
  - `false` `reject` (edge) firstActivity passed for non-held targets — see blind row 3.
  - `low` `defer` (edge) refetch "no extra backfill" claim holds only for held-only Securities — same root cause as the first deferred item.
  - `low` `patch` (verification-gap) held refetch with earlier stored date untested — same patch as blind row 8.
  - `low` `patch` (verification-gap) sold-out refetch test cannot tell the new rule from the old — same patch as blind row 2.
  - `low` `defer` (verification-gap, other) refetch ignores watched/benchmark roles — same root cause as the first deferred item.
  - `false` `reject` (intent) reading A2 (live provider proof owed by an operator) — AGENTS.md mandates recorded responses; no human-only action exists.
  - `false` `reject` (intent) B1/B2 split — see blind row 4.
  - `false` `reject` (intent) C1 vs C2 — AC asks for held only, held and watched, benchmark cases; all covered.
  - `false` `reject` (intent) D1 vs D2 "charts unchanged" — the AC qualifies it: Prices before the first Transaction never enter valuations; Security price charts gaining history is the story's purpose.
  - `false` `reject` (intent) trigger callers untested — scheduler and actions call the unchanged refreshPrices/backfillHeldPrices entry points, already covered by their tests.
  - `false` `reject` (intent) B1/B2 test pin — duplicate of the B1/B2 reading.
  - `false` `reject` (intent) charts surface — duplicate of D1/D2.
  - `false` `reject` (intent) AD-13 / new Binance call — the call carries only the pair symbol and belongs to the backfill plan.
  - `false` `reject` (intent) short-history evidence is fixture-level — the accepted standard (tests never hit live providers).
  - `false` `reject` (intent) sold-out refetch change and crypto date moves — behavior intended by the spec; test gap patched (blind row 2).

## Design Notes

The AC wording "earlier of its first Transaction date and the `3J` Period start minus the benchmark buffer" is taken literally: the buffer applies to the `3J` start only, so a holding older than 3 years keeps `first activity` as its start and is **not** re-backfilled (its `historyFrom` already equals it). For recent holdings the result equals `watchlistHistoryStart`. `firstActivityDates` (incl. ISIN-change successor dates) remains the "first Transaction date". The start moves forward daily for recent holdings, so `historyFrom ≤ start` keeps later runs incremental.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.

## Auto Run Result

Status: done

**Summary:** Held Securities now get provider price history from the earlier of their first activity date and the buffered `3J` start (today − 36 months − 10 days), computed by the new pure `priceHistoryStart` in core. Existing recent holdings get one full backfill on the next run, then incremental refreshes; holdings older than 3 years are not re-backfilled. Watched and benchmark starts are unchanged; the split refetch uses the same held start.

**Files changed:**
- `src/core/benchmarks.ts` -- `bufferedPresetStart(today)`; `benchmarkStartDate` uses it (same results).
- `src/core/price-history.ts` (new) -- `priceHistoryStart(roles, today)`.
- `src/core/price-history.test.ts` (new) -- held only, held and watched, benchmark, no role, boundaries.
- `src/modules/prices/prices.ts` -- `heldPlans` and `refetchPriceHistory` use `priceHistoryStart`; doc comments.
- `src/modules/prices/prices.test.ts` -- updated starts; new tests for one-time backfill, no re-backfill of old holdings, short provider history, refetch starts, sold-out watched start, unchanged valuations/returns.
- `_bmad-output/implementation-artifacts/epic-11-context.md` (new) -- compiled Epic 11 context.

**Review:** 31 findings — 5 patched (all low: two refetch tests, sold-out start test, test rename, doc reflow), 2 deferred (refetch ignores watched/benchmark roles; 11.2 tie rules), 24 rejected (reasons in the triage log). Patches were applied directly by the orchestrating session.

**Follow-up review recommended:** false (patched: high 0, medium 0, low 5).

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (264 files, 3666 tests), `npm run build` — all passed.

**Residual risks:** the first scheduler run after deploy backfills about 3 years for every recent holding (larger one-time provider load); recent crypto holdings now call Binance on their first full backfill; Security-level price charts, moving averages and 52-week figures show the longer history (intended).
