---
title: 'Prices for stocks and ETFs'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '1099de3255b33decc3e12694523c32dc6aafe2a8'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/specs/spec-DepotManagement/data-sources.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Positions are valued only with the last BUY/SELL price; there is no Price storage, no provider interface and no Yahoo price fetch, so values go stale between trades and Epic 4 has no daily history to chart.

**Approach:** Add a `Price` model and the AD-9 provider interface (`fetchLatest`, `fetchHistory`) to `prices`, a Yahoo adapter (`yahoo-finance2` `chart()`) that stores unadjusted EUR closes by undoing split adjustment with recorded CorporateActions, services that backfill/refresh held Yahoo-mapped Securities and refetch after split changes, background triggers after ledger writes, and extend the core resolver to manual > provider > Transaction price with carry-forward, wired into the Depot Positions table.

## Boundaries & Constraints

**Always:**
- `prices` owns `Price`; it reads ledger data only via `@/modules/ledger` exports; `ledger` never imports `prices` (stored prices reach `listPositions` through an injected loader). Writing services accept an optional Prisma tx client (`db`, default `prisma`).
- Price rows: `source ∈ {MANUAL, PROVIDER}`, unique `(securityId, date, source)`, `date` business date `YYYY-MM-DD` (Europe/Berlin), `price` canonical TEXT decimal, `fetchedAt` UTC ISO. decimal.js only — never JS `number` arithmetic, Prisma `Decimal` or SQL arithmetic on prices. Provider floats enter as `String(n)`.
- Stored provider prices are unadjusted as-traded closes: Yahoo close × Π(ratioNew/ratioOld) over the Security's recorded splits dated after the close's date, then rounded half-up to 4 decimal places.
- Only the held set (`ledger.listHeldSecurities(today)`) is fetched; only Securities with a `YAHOO` mapping are fetched in this story (ONVISTA/COINGECKO wait for 3.4, null markers/unmapped are skipped, not failures). `resolveMissingMappings` runs first.
- Fetch failures are typed per Security (`network`, `not-found`, `currency`, `schema`, `unexpected`), persisted on its mapping row, returned in the run result, and never stop other Securities, never throw to callers, never touch existing Price rows, never fail a ledger write. Non-EUR `meta.currency` is the `currency` failure (no conversion).
- Outbound Yahoo requests carry only the provider symbol and date range; 10 s timeout (`PROVIDER_TIMEOUT_MS`); logs name provider, symbol and reason, never prices or amounts.
- Tests never touch the network; the adapter takes an injected `chart` function and is tested with recorded responses in `test/fixtures/providers/`.

**Never:**
- No scheduler, `instrumentation.ts` change, "Kurse aktualisieren" button, stale flags/`isStale`, latest-price-date UI (3.3); no onvista/CoinGecko/Binance price adapters (3.4); no manual-price UI or service (3.5) — the resolver merely honours MANUAL rows.
- No automatic failover between providers; no provider call during page render or `next build`; no storing of Transaction-derived prices.
- Never write MANUAL rows from provider code; never edit committed migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First backfill | Held, `YAHOO`/`SAP.DE`, `historyFrom` null, first activity 2024-03-04 | Fetch 2024-03-04..today; one PROVIDER row per trading day; `historyFrom` = 2024-03-04, `fetchError` null | — |
| Incremental refresh | `historyFrom` ≤ first activity, latest PROVIDER row 2026-10-20 | Fetch 2026-10-13..today; rows in that range replaced | — |
| First activity moved earlier | Back-dated BUY before `historyFrom` | Full backfill from new first activity date | — |
| Known split | NVD.DE, split 1:10 recorded 2024-06-10, recorded chart around it | 2024-06-07 stored ≈ 10 × Yahoo close; 2024-06-10 stored = Yahoo close | — |
| Split recorded/changed/deleted | Split of a Yahoo-mapped Security | Full history refetch for it; all its PROVIDER rows replaced | Failure → old rows kept, error recorded |
| New held Security | BUY of a new Security via any ledger write | After the response, backfill runs for held Securities needing one | Ledger write already succeeded; failures recorded |
| Mapping edited | `setMapping` new symbol | Its PROVIDER rows deleted, fetch state reset, backfill scheduled | — |
| Provider down / unknown symbol / USD listing | Thrown error / empty result / `currency: "USD"` | Others still fetched; `{ securityId, name, reason }` in `failed`; `fetchError` set | Existing rows untouched |
| Resolver | Date D with MANUAL, PROVIDER and Transaction price | MANUAL wins; else PROVIDER; else Transaction; none on D → latest earlier one by same precedence | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add `enum PriceSource { MANUAL PROVIDER }`, model `Price` (owned by `prices`, `onDelete: Cascade`, `@@unique([securityId, date, source])`), back-relation on `Security`; add `historyFrom String?`, `fetchedAt String?`, `fetchError String?` to `ProviderMapping`. Latest migration `20261026090000_add_provider_mapping`; create SQL via `prisma migrate diff` against a temp `DATABASE_URL`, then `npx prisma generate`.
- `src/core/prices.ts` -- `PriceObservation` + `resolvePrice` (last observation by `(date, sequence, id)`); add `source: "manual" | "provider" | "transaction"` and order by `(date, source rank transaction < provider < manual, sequence, id)`.
- `src/core/positions.ts:31` -- `computePositions` adjusts every observation with `adjustedPrice` (works for stored prices unchanged).
- `src/core/corporate-actions.ts` -- `Split`, `adjustedPrice` (line ~275, inverse direction); add pure `unadjustSplitPrice(securityId, date, price, splits)`.
- `src/core/dates.ts` -- `businessDate(instant)` for Yahoo bar dates; `isBusinessDate`.
- `src/modules/ledger/positions.ts:20` -- `listPositions` builds Transaction observations; add optional `storedPrices?: (securityIds, asOf) => Promise<PriceObservation[]>` (4th param object) merged into observations for the lineage ids.
- `src/modules/ledger/depots.ts:209` -- `listHeldSecurities(asOf, db)`; `src/modules/ledger/corporate-actions.ts` -- `listSplits`, `recordSplit/updateSplit/deleteSplit` results (check they expose `securityId`; extend the result if not).
- `src/modules/ledger/securities.ts`, `index.ts` -- add `firstActivityDates(securityIds, db?)`: per Security the earliest Transaction date or ISIN-change date where it is the new Security.
- `src/modules/prices/mappings.ts` -- `resolveMissingMappings`, `setMapping` (upsert), `MappingDeps` (`fetch`, `search`, `env`, `now`); `PricesDb`. `providers/shared.ts` -- `PROVIDER_TIMEOUT_MS`, `FetchLike`. `providers/yahoo.ts` -- lazily loaded `yahooClient()` (reuse for `chart`).
- `src/app/(app)/depots/[id]/page.tsx:68` -- calls `listPositions(depot.id, today)`; pass `latestStoredPrices`.
- `src/app/_actions/{transactions,corporate-actions,migration,securities}.ts` -- ledger-writing actions with `if (result.ok) revalidatePath(...)`; tests mock `next/cache`/`next/headers` (see `depots.test.ts`).
- `test/fixtures/providers/` -- recorded fixtures from 3.1 (`*.json`).

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_price/migration.sql` -- Price model + mapping fetch-state columns -- storage.
- `src/core/prices.ts` (+ test) -- source-aware precedence and carry-forward; update `src/modules/ledger/positions.ts` to tag Transaction observations `"transaction"` -- FR8.
- `src/core/corporate-actions.ts` (+ test) -- `unadjustSplitPrice` -- AD-9 un-adjustment.
- `src/modules/prices/providers/types.ts` -- `DailyClose = { date, close }`, `PriceFetch<T> = { ok: true; value: T } | { ok: false; reason: PriceFetchFailure }`, `PriceAdapter { fetchLatest(symbol, ctx); fetchHistory(symbol, from, to, ctx) }` with `ctx = { securityId, splits }` -- AD-9 interface reused by 3.4.
- `src/modules/prices/providers/yahoo.ts` (+ `yahoo-chart.test.ts`) -- `yahooPrices({ chart? })`: `chart(symbol, { period1: from, period2: to+1 day, interval: "1d" }, { validateResult: false, fetchOptions: { signal } })`; zod-validate `meta.currency` and `quotes[{ date (coerce), close }]`; drop null closes; Berlin date per bar (last bar wins per date); un-adjust; `fetchLatest` = history of the last 7 days, newest bar; empty → `not-found`.
- `src/modules/prices/prices.ts` (+ test) -- `refreshPrices(today, deps?, db?)` → `{ updated, failed }`; `backfillHeldPrices(today, …)` (only Securities needing a full backfill, no network otherwise); `refetchPriceHistory(securityId, today, …)` (Yahoo-mapped and held or with PROVIDER rows); `latestStoredPrices(securityIds, asOf, db?)` (latest MANUAL and latest PROVIDER row ≤ asOf per Security as observations). Writes per Security in one tx (delete PROVIDER rows in range, `createMany`, update mapping state). Runs are serialized in-process (concurrent caller awaits the running run). `deps` add `chart` and `now`.
- `src/modules/prices/mappings.ts` -- `setMapping` also deletes the Security's PROVIDER rows and resets `historyFrom/fetchedAt/fetchError` in the same tx.
- `src/modules/prices/index.ts` -- export new services/types.
- `src/app/_actions/price-refresh.ts` (+ test) -- `schedulePriceBackfill()` / `schedulePriceRefetch(securityId)` via `after()` from `next/server`, catching and logging errors; call after successful saveTransaction/deleteTransaction/confirmParqet/openingBalance/saveIsinChange/deleteIsinChange (backfill), saveSplit/deleteSplit (refetch), setMapping (backfill).
- `src/app/(app)/depots/[id]/page.tsx` (+ page test) -- Positions use stored prices.
- `test/fixtures/providers/yahoo-chart-*.json` -- recorded `chart()` results (dates as ISO strings): `SAP.DE` short range, `NVD.DE` 2024-06-03..2024-06-14 (10:1 split 2024-06-10), plus a USD listing and an empty result.

**Acceptance Criteria:**
- Given a held Security mapped to `YAHOO`, when `refreshPrices(today)` runs against recorded responses, then PROVIDER rows exist for every bar from its first activity date to today with TEXT prices and UTC `fetchedAt`, and a second run inserts no duplicates.
- Given the recorded NVD.DE chart and a recorded 1:10 split on 2024-06-10, when its history is stored, then the 2024-06-07 price equals the recorded close × 10 (rounded to 4 dp) and the 2024-06-10 price equals the recorded close (contract test).
- Given one of two held Securities fails, when a run completes, then the other's prices are stored and the run returns the failed Security with its reason, and its `fetchError` is set.
- Given a ledger action that books a BUY of a new Security, when the action succeeds, then a backfill is scheduled via `after()` and a backfill failure never changes the action result.
- Given a MANUAL and a PROVIDER row for the same date and a BUY that day, when Positions of the Depot are listed, then the value uses the MANUAL price; without MANUAL the PROVIDER price; with no price that day the latest earlier one.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 31 findings — high 0, medium 5, low 22, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) Security bought today (before the first bar exists) gets a `not-found` failure — self-heals on the next day's write or run; booking before market open is rare; fix adds an empty-range branch to the adapter contract.
  - `[low]` `[reject]` (blind) Permanent failures (USD listing, unknown symbol) are refetched on every ledger write — one Yahoo request per failing Security per write, few writes per day for a single user; fix needs backoff state.
  - `[low]` `[reject]` (blind) `backfillHeldPrices` re-runs mapping lookups after every write — spec mandates `resolveMissingMappings` first; only Securities whose lookup failed transiently are retried (3.1 design).
  - `[medium]` `[patch]` (blind) Auto-resolving mappings on the Securities page schedules no backfill — `resolveMissingMappingsAction` (mapped > 0) and `resolveMappingAction` (ok) now call `schedulePriceBackfill()`; action tests assert `after`.
  - `[low]` `[reject]` (blind) `StoredPriceLoader` has no `db` parameter — the only caller (Depot page) uses the default client; no tx caller exists; fix adds a parameter.
  - `[low]` `[reject]` (blind) Unique index `(securityId, date, source)` not ordered for `(securityId, source)` queries — the `securityId` prefix limits scans to one Security's few thousand rows; negligible at single-user scale.
  - `[low]` `[reject]` (blind) `thrownReason` maps most thrown errors to `network` — Yahoo's 404 "No data found" message is matched to `not-found`; remaining mislabels are cosmetic reason codes.
  - `[low]` `[reject]` (blind) Incremental refresh deletes overlap rows Yahoo no longer returns — unlikely; carry-forward covers a dropped day, and replacing the window also removes corrected bars.
  - `[medium]` `[patch]` (blind) `storeHistory` "mapping changed meanwhile" guard untested — grouped with the verification-gap row below; test added.
  - `[false]` `[reject]` (blind) Shared `EMPTY_RESULT` object could be mutated — no caller mutates a run result (`price-refresh.ts` only reads it).
  - `[low]` `[reject]` (blind) 4 dp rounding drifts by 0.0001 for reverse splits on read — value error ≤ 0.0001 × quantity; the 4 dp rule is the spec's.
  - `[low]` `[reject]` (blind) `fetchLatest` reads the clock and hard-codes 7 days — shell code with injected `now`; interface method required by AD-9; unused in this story.
  - `[low]` `[reject]` (blind) `fetchError` is a free string, not an enum — written only from the typed `PriceFetchFailure`; 3.3 will read it.
  - `[low]` `[reject]` (blind) Page test does not assert carried-forward price date / future-dated rows — covered by `prices.test.ts` and core resolver tests.
  - `[medium]` `[patch]` (edge) Failed split refetch leaves `historyFrom` set, so pre-split history keeps the old adjustment — `recordFailure` now clears `historyFrom` for full plans; test asserts the next backfill refetches.
  - `[low]` `[reject]` (edge) Permanent full-backfill failure retried on every write — same root as the blind row above; rejected.
  - `[low]` `[reject]` (edge) Deleting an ISIN change re-holds the old Security with a gap in provider rows — `refreshPrices` (3.3 scheduler) fills it incrementally from the latest stored date; rare action.
  - `[low]` `[reject]` (edge) With a caller-supplied tx client a failed `createMany` after `deleteMany` commits partially — no caller passes a tx (same as 3.1 carried reasoning).
  - `[low]` `[reject]` (edge) First activity today/weekend → spurious `not-found` — same root as the first blind row; rejected.
  - `[false]` `[reject]` (edge) `addDays(to, 1)` RangeError classified as network — `to` is always `today` from `businessDate()`, a valid date; unreachable.
  - `[low]` `[reject]` (edge) Unsorted quotes make "last bar of a date wins" arbitrary — yahoo-finance2 maps Yahoo's ascending timestamp array in order; unlikely.
  - `[low]` `[patch]` (verification-gap) Edit paths of transactions and ISIN changes not asserted to schedule a backfill — assertions added in both action tests.
  - `[medium]` `[patch]` (verification-gap) `storeHistory` mapping-changed guard untested — test where the fake `chart()` switches the mapping mid-fetch: no rows, `historyFrom` null, `updated` 0.
  - `[low]` `[patch]` (verification-gap) `refetchPriceHistory` for a sold-out Security with PROVIDER rows untested — test added (sell all, record split, refetch replaces rows unadjusted).
  - `[medium]` `[patch]` (verification-gap, other) `resolveMappingAction`/`resolveMissingMappingsAction` schedule no backfill — same root and fix as the blind row.
  - `[low]` `[patch]` (intent) Backfill trigger lives at the server-action surface; unarchiving a Depot (re-holds Securities) scheduled nothing — `unarchiveDepotAction` now schedules a backfill; test added. Ledger cannot import `prices` (module rule), so actions are the trigger surface.
  - `[low]` `[reject]` (intent) `refreshPrices` has no production caller; existing held Securities wait for a write — the scheduler and "Kurse aktualisieren" are Story 3.3's acceptance criteria.
  - `[low]` `[reject]` (intent) Storing uses only `fetchHistory`, `fetchLatest` unused — both methods implemented and tested; the 7-day incremental window covers the latest close.
  - `[low]` `[reject]` (intent) Stored prices wired only into the Depot Positions tab, not migration confirm or a historical series — charts are Epic 4; migration reconciliation compares against Parqet's ledger figures.
  - `[false]` `[reject]` (intent) Split refetch triggered at the action surface, not the ledger — every split write path of the UI goes through `saveSplitAction`/`deleteSplitAction`.
  - `[false]` `[reject]` (intent) Fixture provenance unverified — fixtures were recorded live from Yahoo on 2026-10-26 (public market data; NVD.DE meta shows real XETRA data).

### 2026-10-26 — Review pass
- verdicts: 29 findings — high 0, medium 2, low 21, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) A failed split refetch of a sold-out Security is never retried (backfill plans only held Securities) — needs a failed refetch of a Security with no Position; only Epic 4 history is affected; fix needs persisted retry state.
  - `[low]` `[reject]` (blind) `setMapping` drops PROVIDER history even when provider and symbol are unchanged — re-saving an unchanged mapping is rare and self-heals with the scheduled backfill; fix adds a comparison branch.
  - `[low]` `[reject]` (blind) Today's intraday bar is stored as that day's close — it is the latest available price; the 7-day overlap of the 3.3 refresh replaces it (Design Notes); fix adds a market-hours branch.
  - `[low]` `[reject]` (blind) 4 dp rounding stores a close below 0.00005 EUR as "0" — no Yahoo EUR stock/ETF trades that low; crypto adapters are 3.4; fix adds a branch.
  - `[false]` `[reject]` (blind) Optional `storedPrices` in `listPositions` lets a caller value without stored prices — the only valuing caller (Depot page) passes it; `migration/confirm.ts` compares against Parqet's ledger figures by design; the injected loader is the spec's.
  - `[low]` `[reject]` (blind) No test for stored prices across an ISIN change — stored observations go through the same `adjustedPrice` as Transaction prices, whose ISIN-change remapping is tested in core; adding a matrix of cases is not a direct correction.
  - `[low]` `[reject]` (blind) Zero/negative closes are dropped silently and compared as JS numbers — dropping a non-positive close is the only sensible outcome; a comparison is not arithmetic; never seen in recorded data.
  - `[low]` `[reject]` (blind) `PRICE_FETCH_FAILURES` exported but unused; `fetchLatest` hard-codes 7 days — cosmetic; the list is for 3.3's `fetchError` reading.
  - `[low]` `[reject]` (blind) Known 3.3 limitations were rejected instead of deferred — the fix edits this build's spec.
  - `[low]` `[reject]` (blind) Spec drift: no recorded empty-result fixture, stale frontmatter, empty change log — the inline `quotes: []` covers the adapter path and a real recording needs a live call; the rest edits this build's spec.
  - `[low]` `[reject]` (blind) Cash-only writes schedule a backfill that runs mapping lookups — lookups run only for Securities without a mapping row (3.1 design); a no-op backfill makes no provider call; fix adds per-type branching in several actions.
  - `[false]` `[reject]` (blind) Split/ISIN-change action tests do not check that a failing `after()` leaves the result unchanged — `schedule()` catches a throwing `after()`, tested in `price-refresh.test.ts` ("never throws when after() is unavailable").
  - `[low]` `[reject]` (blind) `heldPlans` runs one `findFirst` per held Security — a handful of indexed queries at single-user scale; only the 3.3 refresh path hits it.
  - `[false]` `[reject]` (blind) `latestStoredPrices` maps every non-MANUAL source to provider — `PriceSource` has exactly MANUAL and PROVIDER; no other value can occur.
  - `[medium]` `[patch]` (edge) A split recorded with a future date is undone on closes Yahoo has not adjusted yet (stored 10× too high, permanently for rows outside the refresh overlap; `splitSchema` accepts any business date) — `runPlans` now passes only splits dated on or before the plan's `to`; test "does not undo a split dated after today" (fails without the fix).
  - `[low]` `[reject]` (edge) Old Security's provider rows dated on/after an ISIN change are not remapped, so the new Security loses the carried-forward provider price — only matters while the new Security has no provider rows (its backfill starts at the change date); fallback is the Transaction price; fix needs a per-change cutoff.
  - `[low]` `[reject]` (edge) Close below 0.00005 EUR stored as "0" — same as the blind rounding row.
  - `[false]` `[reject]` (edge) DB error in `heldPlans`/`loadSplits` makes runs reject despite the never-throws contract — the contract covers fetch failures (docstrings); DB errors propagate to `schedule()`, which logs them (tested).
  - `[low]` `[reject]` (edge, claim) `backfillHeldPrices` is not network-free because `resolveMissingMappings` runs first — carried: spec mandates `resolveMissingMappings` first; only Securities whose lookup failed transiently are retried (3.1 design).
  - `[low]` `[reject]` (edge, claim) No recorded empty-result fixture — same as the blind spec-drift row.
  - `[medium]` `[patch]` (verification-gap) `runPlans`' catch around `storeHistory` is never exercised — test added: an SQLite trigger aborts inserts for one Security; the run resolves with `{ updated: 1, failed: [unexpected] }`, the other Security is stored, existing rows kept, `fetchError` "unexpected".
  - `[low]` `[reject]` (intent) No app path runs the incremental refresh; prices freeze after backfill until 3.3 — carried: the scheduler and "Kurse aktualisieren" are Story 3.3's acceptance criteria.
  - `[low]` `[reject]` (intent) A split booked by the Parqet migration triggers no refetch for an already-backfilled Security — needs a migration into a ledger whose Security is already priced, with a new split and no earlier first activity (migration normally runs first); current Positions use post-split rows; fix needs a new field on `MigrationSummary`.
  - `[false]` `[reject]` (intent) Split refetch relaxes "only the held set" — deliberate and tested; refetching existing rows of a sold-out Security fetches nothing new and causes no wrong outcome.
  - `[false]` `[reject]` (intent) Triggers live at the server-action layer, so future writers (PDF import, restore) get none — every ledger writer that exists today is a server action that schedules; carried reasoning from the split-refetch row.
  - `[low]` `[reject]` (intent) The real `yahooChart` wrapper (timeout signal, `validateResult: false`) is never exercised — tests must not touch the network; typecheck covers the call shape; fix needs module-level mocking of `yahoo-finance2`.
  - `[low]` `[reject]` (intent) `fetchLatest` is unused by services — carried: both methods implemented and tested; the 7-day incremental window covers the latest close.
  - `[low]` `[reject]` (intent) A failed full fetch also clears `historyFrom` — intended retry path from the first pass; the only cost is a retry per ledger write (same as the rejected permanent-failure row).
  - `[low]` `[reject]` (intent) `latestStoredPrices` serves only the latest row, not a daily series — carried: charts are Epic 4.

## Design Notes

- Yahoo `close` is split-adjusted (not dividend-adjusted), so the inverse of the split factor restores as-traded closes: a 1:10 split on D means a bar before D was quoted 10× higher. Only splits the user recorded are undone; recording one triggers the refetch that repairs history.
- `historyFrom` on the mapping makes "needs backfill" a DB check (`historyFrom` null or > first activity date), so the post-write hook costs no network when nothing is new.
- Incremental refresh re-fetches a 7-day overlap so a late-corrected or intraday bar is replaced.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "Number(\|parseFloat" -- src/modules/prices` -- expected: no numeric arithmetic on prices.

## Auto Run Result

Status: done

**Summary:** Follow-up review pass of Story 3.2 (Price model, AD-9 provider interface, Yahoo `chart()` adapter with split un-adjustment, backfill/refresh/refetch services, `after()` triggers after ledger writes, manual > provider > Transaction resolver wired into the Depot Positions tab). This pass fixed one defect: a split recorded with a future date was undone on closes Yahoo had not yet adjusted, storing prices 10× too high.

**Files changed (this pass):**
- `src/modules/prices/prices.ts` — `runPlans` un-adjusts only with splits dated on or before the plan's `to` (today).
- `src/modules/prices/prices.test.ts` — tests for a future-dated split and for a storing failure of one Security (SQLite trigger) during a two-Security run.

**Review findings:** 29 total — 2 patch entries applied (2 medium, 0 high, 0 low), 0 deferred, 27 rejected (6 false, 21 low; reasons per row in the triage log of this pass).

**Follow-up review recommendation:** false — follow-up pass with no `high` patched (patched counts: high 0, medium 2, low 0); the work has converged.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all pass (85 test files, 1285 tests; build OK). `git grep -n "Number(\|parseFloat" -- src/modules/prices` — no matches. The future-split test fails with the fix reverted.

**Residual risks:** existing held Securities get prices only after a ledger write until the 3.3 scheduler exists; permanently failing Securities are retried on every ledger write; a split booked by the Parqet migration for an already-priced Security keeps old pre-split history until its next full refetch; Yahoo behaviour is verified only against recorded responses.
