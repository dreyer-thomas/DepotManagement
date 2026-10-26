---
title: 'Scheduled refresh and stale flags'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: 'b3523936b26b9a37675218403258d530ed54260f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Prices from story 3.2 are fetched only after ledger writes; nothing refreshes them daily or on demand, and no screen tells Tommy how old a price is or that a fetch failed, so stale values look current.

**Approach:** Start an in-process price scheduler from `instrumentation.ts` (on start + once per Berlin day, `globalThis` guard), add a "Kurse aktualisieren" button with progress and result snackbar on the Securities page, add core `isStale`, and show the latest price date with a stale badge (tooltip: source + fetch time) on the Positions table and Securities page, plus a row-level fetch-failure error with a working "Kurs manuell eintragen" action.

## Boundaries & Constraints

**Always:**
- `isStale(latestPriceDate, today)` in `src/core/prices.ts` is the only staleness rule: true when `today` is more than 3 calendar days after `latestPriceDate` (`2026-10-22` is stale on `2026-10-26`, `2026-10-23` is not). Pure, uses `addDays`; no clock.
- Stale badge text exactly `Kurs vom dd.mm.yyyy – veraltet` (en dash), warning-soft styling from the `stale` palette (text always present, never color alone), keyboard-focusable, MUI Tooltip with source and fetch time. Non-stale prices show the date as plain text `Kurs vom dd.mm.yyyy`.
- Tooltip source labels: provider → provider label (`Yahoo Finance`, `onvista`, `CoinGecko`, from the Security's current mapping) + `abgerufen dd.mm.yyyy, HH:mm` (Europe/Berlin, from `fetchedAt`); manual → `Manuell eingetragen` + same time format; transaction → `Buchungskurs` (no time).
- Scheduler: one module `src/modules/prices/scheduler.ts`; started only from `register()` on `NEXT_RUNTIME === "nodejs"` after the auth check, never when `NEXT_PHASE === "phase-production-build"`; a `globalThis` symbol guard makes a second start a no-op; runs `refreshPrices(today)` immediately, then checks hourly (timer `unref()`'d) and runs again when the Europe/Berlin business date differs from the date of the last started run. A run's rejection is caught and logged (no amounts); it never crashes the process.
- "Kurse aktualisieren" calls a session-checked server action that awaits `refreshPrices(today)` (serialized with scheduler runs) and returns `{ ok: true, updated, failed: [{ securityId, name, provider, reason }] }`; the client shows a disabled button with progress while running, then a Snackbar and `router.refresh()`. No optimistic UI.
- Fetch failure surface: a Security whose mapping has `fetchError` shows an inline error `Kurs konnte nicht von <Provider> geladen werden.` with a `Kurs manuell eintragen` button opening a dialog (date default today, price in German decimal format) that stores a MANUAL Price via a new `prices` service; it upserts on `(securityId, date, MANUAL)`, validates price > 0 (`parseDecimalInput`) and date a business date ≤ today, never touches PROVIDER rows or the mapping.
- Latest price info per Security (Securities page) comes from the core resolver over stored observations (latest MANUAL/PROVIDER via `latestStoredPrices`) plus the latest BUY/SELL price observation (new ledger export); the badge is shown only for held Securities (`listHeldSecurities`), the date for every Security with a price.
- Module rules hold: `ledger` never imports `prices`; `src/core` stays pure; UI never touches Prisma; German UI text, de-DE formats; touch targets ≥ 44 px.

**Never:**
- No Overview stale Alert (story 4.x), no Position detail page, no news refresh (3.7), no onvista/CoinGecko adapters (3.4), no manual-price list/edit/delete or entry for Securities without a fetch error (3.5).
- No provider call during page render or `next build`; no second scheduler; no cron dependency; no `setInterval` without `unref()`.
- No automatic failover; no change to stored-price storage rules from 3.2; never edit committed migrations (no schema change is needed).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh price | Latest price 2026-10-24, today 2026-10-26 | `Kurs vom 24.10.2026`, no badge | — |
| Stale boundary | Latest 2026-10-23 vs 2026-10-22, today 2026-10-26 | 23rd not stale; 22nd shows `Kurs vom 22.10.2026 – veraltet` | — |
| No price at all | Position without any observation | Price `–`, no date, no badge | — |
| Double start | `register()` / `startPriceScheduler` called twice | One immediate run, one timer | — |
| Day change | Last run date 2026-10-25, hourly tick on 2026-10-26 | One new run; further ticks that day do nothing | Rejected run logged, next day retried |
| Build | `NEXT_PHASE=phase-production-build` | Scheduler not started | — |
| On-demand with failures | Two held Yahoo Securities, one fails | Snackbar `Kurse aktualisiert. Fehlgeschlagen: <Name>`; failed row shows provider error + action | Action rejected → snackbar `Verbindung fehlgeschlagen. Bitte erneut versuchen.` |
| Expired session | Click without session | Snackbar with session-expired message | — |
| Manual entry | Valid date ≤ today, price `12,34` | MANUAL row `12.34` stored, page refreshed, badge reflects new date | Invalid → field error, input kept |

</intent-contract>

## Code Map

- `src/instrumentation.ts` / `src/instrumentation-node.ts` (+ tests) -- `register()` runs `checkAuthConfigOrExit()` on nodejs; add `startBackgroundJobs()` in `instrumentation-node.ts` (build-phase check, calls `startPriceScheduler`). `instrumentation.test.ts` mocks `process.exit`, so it must `vi.mock` the scheduler start to avoid real runs.
- `src/modules/prices/prices.ts` -- `refreshPrices(today, deps, db)` (serialized, never throws on fetch failure; `PriceRunFailure { securityId, name, reason }`), `latestStoredPrices` (latest MANUAL + PROVIDER per Security as `PriceObservation`; extend with `fetchedAt` and provider label source). `yahooMappings`, `recordFailure` (sets `fetchError`, cleared on success in `storeHistory`).
- `src/modules/prices/mappings.ts` -- `listSecuritiesWithMappings`, `ProviderMappingSummary` (add `fetchError` to the select/type), `PricesDb`, `inTransaction`.
- `src/modules/prices/index.ts` -- public entry; export new services.
- `prisma/schema.prisma:126-163` -- `ProviderMapping.fetchError/fetchedAt`, `Price` with `fetchedAt`; no change needed.
- `src/core/prices.ts` -- `PriceObservation`, `resolvePrice` → `ResolvedPrice { price, date }`; extend observations with optional `fetchedAt?: string | null`, `provider?: string | null`, resolved result with `source`, `fetchedAt`, `provider`. Add `isStale`, `STALE_AFTER_DAYS = 3`.
- `src/core/positions.ts:10-75` -- `Position.priceDate` exists; add `priceSource`, `priceFetchedAt`, `priceProvider` from the resolved price (adjustedPrice spread keeps extra fields).
- `src/core/dates.ts` -- `addDays`, `businessDate`. `src/core/format.ts:66` -- `formatDate`; add `formatDateTime(isoInstant)` (`dd.mm.yyyy, HH:mm`, Europe/Berlin, Intl only).
- `src/modules/ledger/positions.ts:20-90` -- `listPositions` builds transaction observations; add exported `latestTradePrices(securityIds, asOf, db?)` (latest BUY/SELL price observation per Security) and export via `src/modules/ledger/index.ts`.
- `src/modules/ledger/depots.ts:209` -- `listHeldSecurities(asOf, db)`.
- `src/app/(app)/depots/[id]/page.tsx:68` -- passes `latestStoredPrices`; pass `today` to `PositionsTable`.
- `src/app/_components/positions/PositionsTable.tsx` -- desktop price cell (`money(position.price)`) and phone row caption; add price date / stale badge.
- `src/app/(app)/securities/page.tsx`, `src/app/_components/securities/SecurityList.tsx` -- add refresh button, latest price line, failure error + manual-price action. `MappingAutoResolver.tsx` shows the client progress/Alert pattern; `MappingDialog.tsx`/`SecurityDialog.tsx` (`TOUCH_TARGET`) show the dialog + `useActionState` pattern; `labels.ts` holds `PROVIDER_LABELS`, `ACTION_FAILED_MESSAGE`, `securityErrorMessage`.
- `src/app/_actions/securities.ts` -- session-checked actions pattern (`UNAUTHORIZED`, `formText`); `src/app/_actions/price-refresh.ts` -- background scheduling (unchanged).
- `src/core/decimal-input.ts:18` -- `parseDecimalInput` for German price input.
- `src/theme/theme.ts:36,92-105` -- `palette.stale.{main,soft}`.
- `test/helpers/dom.tsx`, `test/helpers/test-db.ts`, `test/helpers/next-mocks.ts` -- DOM tests (`// @vitest-environment happy-dom`), DB tests, Next mocks.

## Tasks & Acceptance

**Execution:**
- `src/core/prices.ts` (+ test) -- `isStale`, `STALE_AFTER_DAYS`; observations/resolved price carry `source`, `fetchedAt`, `provider` -- single staleness rule, tooltip data.
- `src/core/positions.ts` (+ test) -- Position gets `priceSource`, `priceFetchedAt`, `priceProvider` -- tooltip on Positions.
- `src/core/format.ts` (+ test) -- `formatDateTime` -- tooltip fetch time.
- `src/modules/ledger/positions.ts`, `index.ts` (+ test) -- `latestTradePrices` -- Securities page fallback date.
- `src/modules/prices/prices.ts` (+ test) -- `latestStoredPrices` fills `fetchedAt` and the mapping's provider; add `securityPriceInfo(today, db?)` → per Security `{ date, source, fetchedAt, provider, stale }` (stale only for held) or none; add `saveManualPrice(securityId, { date, price }, today, db?)` → `{ ok: true } | { ok: false, reason: "not-found" | "date-invalid" | "price-invalid" }` -- data for the UI.
- `src/modules/prices/mappings.ts` (+ test) -- `ProviderMappingSummary.fetchError` -- failure surface.
- `src/modules/prices/scheduler.ts` (+ test with fake timers, injected `run`/`now`) -- `startPriceScheduler(deps?)` with `globalThis` guard, immediate run, hourly day-change check, `unref()`; `stopPriceScheduler()` for tests -- AD-13.
- `src/instrumentation-node.ts`, `src/instrumentation.ts` (+ tests) -- `startBackgroundJobs()` skipped in build phase, called from `register()` on nodejs -- AD-13.
- `src/app/_actions/prices.ts` (+ test) -- `refreshPricesAction()` and `saveManualPriceAction(prev, formData)` (session-checked, `revalidatePath("/", "layout")` on success) -- shell boundary.
- `src/app/_components/prices/StaleBadge.tsx`, `price-labels.ts` (+ tests) -- `PriceDate` component (plain date or badge + Tooltip), source/tooltip text builders -- shared by Positions and Securities.
- `src/app/_components/positions/PositionsTable.tsx` (+ test), `src/app/(app)/depots/[id]/page.tsx` -- price date / badge under the price (desktop) and in the phone caption; `today` prop.
- `src/app/_components/securities/PriceRefreshButton.tsx` (+ DOM test) -- button, progress, Snackbar naming failures, `router.refresh()`.
- `src/app/_components/securities/ManualPriceDialog.tsx` (+ DOM test) -- "Kurs manuell eintragen" dialog.
- `src/app/_components/securities/SecurityList.tsx`, `src/app/(app)/securities/page.tsx` (+ tests) -- refresh button above the list, latest price line per row, failure error with provider name and manual-price action.

**Acceptance Criteria:**
- Given the Node runtime outside `next build`, when `register()` runs twice, then exactly one price scheduler is active, it ran `refreshPrices` once immediately, and on a later Berlin day exactly one more run happens.
- Given the Securities page, when I click "Kurse aktualisieren", then the button shows progress until the action returns, a snackbar names every failed Security (or confirms success), and the page refreshes.
- Given a held Security whose latest price is older than 3 days, when its Depot's Positions tab or the Securities page renders, then `Kurs vom dd.mm.yyyy – veraltet` appears with a tooltip naming the source and fetch time; with a fresher price only `Kurs vom dd.mm.yyyy` appears.
- Given a Security whose last fetch failed, when the Securities page renders, then its row shows the provider name in an error text and a "Kurs manuell eintragen" action that stores a MANUAL Price.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 28 findings — high 0, medium 3, low 19, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `recordFailure` hard-codes `provider: "YAHOO"` in `PriceRunFailure` — only Yahoo-mapped plans exist (`yahooMappings` filters `YAHOO`), so it is correct today; 3.4 adds the other adapters and the plan's provider with them; fix adds a plan field.
  - `[medium]` `[patch]` (blind) Run serialization queue was a module variable while the scheduler guards on `globalThis` for duplicate module copies, so scheduler and on-demand runs from separate bundles could overlap — the queue now lives on `globalThis` under `Symbol.for("depotmanagement.priceRunQueue")`.
  - `[false]` `[reject]` (blind) Tooltip names the current mapping's provider for older provider rows after a mapping change — `setMapping` deletes all PROVIDER rows of the Security in the same tx, and `resolveMappingFor` only replaces the not-found marker, so no PROVIDER row outlives its provider.
  - `[low]` `[reject]` (blind) Held Security without a usable mapping/`fetchError` gets a permanent stale badge with no manual-price action — the intent's AC ties the action to a failed fetch; entry for every Security is story 3.5 (next in the epic); fix widens the action surface.
  - `[low]` `[reject]` (blind) A failed run is retried only on the next Berlin day — the spec's "once per day" rule; the stale flag appears only after 3 days and "Kurse aktualisieren" is available meanwhile; fix adds retry state.
  - `[false]` `[reject]` (blind) Scheduler logs only counts and error names, no ids/reasons — `recordFailure` already logs provider, symbol and reason per failed Security for every run.
  - `[low]` `[reject]` (blind) A DB error in `refreshPrices` surfaces as the connection message; no overall time limit — DB errors are rare in a single-process SQLite app, each provider call has a 10 s timeout; fix adds a new failure branch.
  - `[low]` `[reject]` (blind) `securityPriceInfo` repeats `listSecurities` and reads trades twice — a few indexed queries at single-user scale.
  - `[low]` `[reject]` (blind) `formatDateTime` rolls an impossible day like `2026-02-30T…Z` over instead of throwing — every caller passes `toISOString()` output from the DB; fix adds a validation branch.
  - `[low]` `[reject]` (blind) After saving a manual Price the fetch-error Alert stays and the dialog gives no confirmation — the date line updates to the manual date after the refresh (`securityPriceInfo` test covers manual precedence), and the fetch error is still true; clearing it is excluded by the spec's "never touches the mapping".
  - `[low]` `[reject]` (blind) Depot page tests assert `– veraltet` on the real clock — fixture dates are in the past and only get staler, so the assertion is stable; the fresh/boundary cases are covered in `PositionsTable.test.tsx`.
  - `[low]` `[patch]` (blind) Busy spinner's `aria-label` duplicates the button text for screen readers — spinner is now `aria-hidden` without a label; DOM test checks `aria-busy` and the hidden spinner.
  - `[low]` `[reject]` (edge) Fetch-error Alert persists after a manual Price — same as the blind row above.
  - `[false]` `[reject]` (edge) Tooltip provider wrong after a mapping change — same refutation as the blind row (`setMapping` deletes PROVIDER rows).
  - `[low]` `[reject]` (edge) Security deleted between `getSecurity` and `price.upsert` makes the action reject — needs a concurrent Depot deletion during a dialog submit; fix adds a catch branch.
  - `[low]` `[reject]` (edge) `refreshPricesAction` rejects on a DB error — same as the blind DB-error row.
  - `[low]` `[reject]` (edge) `formatDateTime` accepts impossible days — same as the blind row.
  - `[false]` `[reject]` (edge) `businessDate(now())` throwing on every tick would silence the scheduler — `Intl.DateTimeFormat.formatToParts` on a valid `Date` never throws; `now` defaults to `new Date()`.
  - `[low]` `[reject]` (edge) `register()` rejects if importing `@/modules/prices` fails — a failing import is a build defect the build and tests catch; `startPriceScheduler` never throws synchronously (tick catches; run is promise-wrapped).
  - `[false]` `[reject]` (edge) `latestTradePrices` compares per-Depot sequences across Depots — ties occur only on the same date, and the Securities page shows only the date and the source (both identical for the tied rows); the existing resolver orders the same way.
  - `[medium]` `[patch]` (verification-gap) No test checks that `PositionsTable.priceInfo()` passes source, fetch time and provider into the tooltip — added `PositionsTable.dom.test.tsx`: stale Yahoo Position, keyboard focus, asserts "Yahoo Finance · abgerufen 22.10.2026, 20:05".
  - `[medium]` `[patch]` (verification-gap, other) On-demand refresh may not wait for a scheduler run across module copies — same root and fix as the blind serialization row.
  - `[low]` `[reject]` (intent) "Nothing during build" is proven only by the `NEXT_PHASE` guard test — Next does not call `register()` during `next build` (existing instrumentation comment) and `npm run build` passed with no fetch; an end-to-end build test adds tooling.
  - `[low]` `[reject]` (intent) No test crosses client → real action → `refreshPrices` — each boundary is tested (DOM with mocked action, action with mocked service, service against recorded responses), the repo's standard layering.
  - `[low]` `[reject]` (intent) Progress is an indeterminate busy state, not per-Security counts — the AC asks for progress shown; the run is one awaited server action without streaming; counts need a new progress channel.
  - `[false]` `[reject]` (intent) Row-level fetch error only on the Securities page, not on Positions rows — EXPERIENCE.md State Patterns place "Price fetch failed" on the Securities surface; Positions rows carry the stale badge.
  - `[low]` `[reject]` (intent) Snackbar provider (`PriceRunFailure.provider`) and row provider (mapping) come from different places — same as the first blind row; identical while Yahoo is the only adapter.
  - `[low]` `[reject]` (intent) Depot page tests mostly exercise the stale branch — same as the blind real-clock row.

### 2026-10-26 — Review pass
- verdicts: 27 findings — high 0, medium 1, low 23, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `securityPriceInfo` resolves raw observations without the ISIN-change remap `computePositions` applies, so a held successor Security with only predecessor prices shows no date/badge on the Securities page — real but needs an ISIN change on a Security without own prices; the Securities page shows no price value, Positions (where the value is shown) carries the badge; a fix must also keep the predecessor's own date, adding branches.
  - `[low]` `[reject]` (blind) A fetch error stays on a Security after it is sold (only held Securities are refetched) — the intent ties the error to `fetchError` on the mapping, which is still true; hiding it needs held state in `SecurityList`, a new branch.
  - `[low]` `[reject]` (blind) Success snackbar "Kurse aktualisiert." when `updated: 0, failed: []` — happens only when no held Security has a Yahoo mapping; nothing failed, so the message is not wrong; a separate message adds a branch.
  - `[low]` `[reject]` (blind) Fetch-error text ignores the reason (`not-found`, `currency`, `network`) — the intent fixes the exact text `Kurs konnte nicht von <Provider> geladen werden.`; "Kursquelle bearbeiten" stays available in the same row.
  - `[false]` `[reject]` (blind) Row fetch-error Alert (`role="alert"`) is re-announced on every load and refresh — live regions present at page load are not announced, and `router.refresh()`/revalidation reconciles the existing Alert node instead of re-inserting it; only a newly failed row is announced, which is intended.
  - `[low]` `[patch]` (blind) Unbounded `while (…) await user.tab()` in `PositionsTable.dom.test.tsx` hangs to the Vitest timeout if the badge stops being focusable — loop capped at 20 tabs followed by `expect(document.activeElement).toBe(badge)`.
  - `[low]` `[reject]` (blind) `ManualPriceErrorReason` restates the server reason union — a new reason in 3.5 would also need new dialog branching (the dialog narrows per reason), so deriving the type alone fixes nothing; 3.5 owns that change.
  - `[low]` `[reject]` (blind) A manual Price dated before the latest provider price has no visible effect — the intent allows any business date ≤ today and the dialog defaults to today; a warning adds a new UI branch.
  - `[low]` `[reject]` (blind) `revalidatePath` plus `router.refresh()` reloads twice — one extra RSC round trip on a single-user button; the intent asks for `router.refresh()`.
  - `[low]` `[reject]` (blind) Untested branches: dialog `not-found`/`unauthorized` alert, action with missing `securityId`/`File`, future-dated rows in `securityPriceInfo` — simple mappings over service rejections already tested in `prices.test.ts` and the action tests; adding tests is more than a direct correction for a negligible risk.
  - `[low]` `[patch]` (blind) Stale-badge tooltip needs a 700 ms long press on phones — `StaleBadge` Tooltip now uses `enterTouchDelay={0}` (opens on tap).
  - `[low]` `[reject]` (blind) `resolved.provider as PriceProvider | null` is an unchecked cast — the value comes from the Prisma `PriceProvider` enum column via `latestStoredPrices`; narrowing core's `string` type changes core's public type for no observed defect.
  - `[low]` `[reject]` (edge) ISIN-change successor shows no date on the Securities page — same as the blind ISIN row.
  - `[low]` `[reject]` (edge) Fetch error never clears for a sold Security — same as the blind sold-Security row.
  - `[low]` `[reject]` (edge) `refreshPrices` throwing (DB error) surfaces as the connection message — carried: DB errors are rare in a single-process SQLite app; fix adds a new failure branch.
  - `[low]` `[reject]` (edge) `register()` rejects if importing `@/modules/prices` fails — carried: a failing import is a build defect the build and tests catch.
  - `[false]` `[reject]` (edge) `businessDate(now())` throwing on every tick silences the scheduler — carried: `Intl.DateTimeFormat.formatToParts` on a valid `Date` never throws; `now` defaults to `new Date()`.
  - `[low]` `[reject]` (edge) `formatDateTime` rolls an impossible day over instead of throwing — carried: every caller passes `toISOString()` output from the DB.
  - `[low]` `[reject]` (edge, claim) Securities page drops the stale flag Positions shows after an ISIN change — same as the blind ISIN row.
  - `[medium]` `[patch]` (verification-gap) The `globalThis` run queue and scheduler guard were tested only through one module instance, so a module-local regression passed — added `serializes runs across module copies` (`prices.test.ts`, `vi.resetModules()` + re-import, `maxActive === 1`) and `ignores a start from a second module copy` (`scheduler.test.ts`); both fail when the queue/guard is made module-local (checked by mutation, then restored).
  - `[false]` `[reject]` (intent) Row-level fetch error only on the Securities page, not on Positions rows — carried: EXPERIENCE.md State Patterns place "Price fetch failed" on the Securities surface.
  - `[low]` `[reject]` (intent) Manual and transaction tooltip texts are checked only as strings, not as rendered tooltips — `StaleBadge` renders `priceSourceText` for every source; the rendering path is covered by the provider DOM tests.
  - `[low]` `[reject]` (intent) Scheduler wiring tested in pieces; "after the auth check" ordering has no test — the order is two sequential lines in `register()`; a test needs a non-returning `process.exit` mock, adding test tooling.
  - `[low]` `[reject]` (intent) No end-to-end test from click → real action → `refreshPrices` → failed row — carried: each boundary is tested, the repo's standard layering; the serialization part is the verification-gap row above.
  - `[low]` `[reject]` (intent) Manual-entry refresh relies on `revalidatePath` without `router.refresh()` — same `useActionState` + `revalidatePath` pattern as the existing Securities dialogs.
  - `[low]` `[reject]` (intent) Positions and Securities page can show different dates for one Security — same root as the blind ISIN row.
  - `[low]` `[reject]` (intent) `failed[].provider` is hard-coded `YAHOO` — carried: only Yahoo-mapped plans exist until 3.4.

## Design Notes

- "Kurs manuell eintragen" is required as a working action by this story's AC, while manual-price management belongs to 3.5. This story ships only the entry dialog and `saveManualPrice` (upsert of one date); 3.5 adds the per-Security list, edit/delete and entry for every Security, reusing both.
- Hourly day-change check instead of a 24 h interval: survives sleep/clock drift and gives "once per Berlin day"; a run shortly after midnight finalizes yesterday's close (the 7-day overlap replaces intraday bars).
- Securities page shows only the date (no price): a stored price is as-traded and would need split/ISIN adjustment to be shown correctly; Positions already show the adjusted price.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests, build starts no scheduler.
- `git grep -n "Number(\|parseFloat" -- src/modules/prices src/core/prices.ts` -- expected: no numeric arithmetic on prices.

## Auto Run Result

Status: done

**Summary:** Follow-up review pass on story 3.3 (in-process price scheduler from `register()`, "Kurse aktualisieren" button, core `isStale`, price date / stale badge with source tooltip on Positions and Securities, row-level fetch error with "Kurs manuell eintragen"). Four review layers re-read the full diff since `b3523936b26b9a37675218403258d530ed54260f`; three small patches were applied, nothing was deferred.

**Files changed in this pass:**
- `src/modules/prices/prices.test.ts` — test that runs from two module copies share the `globalThis` run queue.
- `src/modules/prices/scheduler.test.ts` — test that a second module copy cannot start a second scheduler.
- `src/app/_components/positions/PositionsTable.dom.test.tsx` — tab loop to the stale badge capped, with an explicit focus assertion.
- `src/app/_components/prices/StaleBadge.tsx` — tooltip opens on tap on touch screens (`enterTouchDelay={0}`).

**Review findings:** 27 total — 3 patches applied (medium 1: cross-module-copy tests for queue and scheduler guard; low 2: bounded tab loop, tap-to-open tooltip), 0 deferred, 24 rejected (3 false, 21 low; each reason in the triage log above — mainly: ISIN-change successor date on the Securities page, persistent fetch error after selling, success snackbar with nothing fetched, reason-less fetch-error text, double refresh, unchecked provider cast, plus 8 rows carried from the first pass).

**Follow-up review recommendation:** false — follow-up pass with no `high` patched (patched counts: high 0, medium 1, low 2); the first pass's named risk (shared queue across bundles untested) is now covered by tests.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (92 test files, 1340 tests; build OK). `git grep -n "Number(\|parseFloat" -- src/modules/prices src/core/prices.ts` — no matches. Mutation check: making the run queue or scheduler guard module-local fails exactly the two new tests.

**Residual risks:** after an ISIN change, a held successor Security without own prices shows no date/badge on the Securities page while Positions shows one; a fetch error stays visible on a sold Security; a failed scheduled run is retried only the next day (or by the button); `PriceRunFailure.provider` is hard-coded `YAHOO` until 3.4; live provider behaviour is verified only against recorded responses.
