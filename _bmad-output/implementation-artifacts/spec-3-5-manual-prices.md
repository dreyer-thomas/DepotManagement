---
title: 'Manual prices'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: 'd4f5a83706bcca89b74f07d499cbd49a0cf54245'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A manual Price can only be entered from a failed-fetch row (story 3.3), cannot be seen, edited or deleted, so a Security without a working source cannot be maintained by hand.

**Approach:** Offer "Kurs manuell eintragen" on every Security card of the Securities page, show a per-Security list of its manual Prices (date + price, newest first) with "Bearbeiten" and "Löschen", backed by new `prices` services for listing, updating and deleting MANUAL rows; prove by tests that manual wins over provider on the same date, survives every scheduler run and clears the stale flag only within 3 days.

## Boundaries & Constraints

**Always:**
- Only the `prices` module writes Price rows; manual services touch only `source = MANUAL` rows, never PROVIDER rows or the mapping (`fetchError` stays).
- Validation identical to `saveManualPrice`: business date on or before `today`, price German or plain decimal text > 0 (`parseDecimalInput`), stored as canonical TEXT decimal; `fetchedAt` = entry/edit time (UTC ISO). Typed results, never throw for user input.
- `updateManualPrice(priceId, { date, price }, today)`: `not-found` unless `priceId` is an existing MANUAL row; may change date and price; moving to a date that already has another MANUAL row of the same Security → `date-taken`, nothing written.
- `deleteManualPrice(priceId)`: deletes exactly that MANUAL row; `not-found` otherwise (a PROVIDER id is `not-found`).
- `listManualPrices()`: per Security id its MANUAL rows `{ id, date, price }`, date descending; read-only.
- Server actions check the session first (`unauthorized`), parse FormData with zod, call the service with today's Berlin business date, `revalidatePath("/", "layout")` only on success.
- UI (German, de-DE): every card has "Kurs manuell eintragen" (aria-label `Kurs manuell eintragen – <name>`) in its action row — except a card with a fetch-error Alert, which keeps the button only as the Alert action (one button per card). A card with manual Prices shows "Manuelle Kurse" with one row per Price: `dd.mm.yyyy` and the price as `1.234,5 €` (all stored decimals, German separators), buttons "Bearbeiten" / "Löschen" with aria-labels naming Security and date. Edit opens the same dialog titled "Manuellen Kurs bearbeiten", prefilled (price with `,` decimal separator, no grouping). Delete opens a confirm dialog "Manuellen Kurs löschen" with text `Manuellen Kurs vom <dd.mm.yyyy> für <name> löschen?`, "Abbrechen" (autofocus) / "Löschen" (error color). No optimistic writes; touch targets ≥ 44 px; error messages via `manualPriceErrorMessage` (new `date-taken`: "Für dieses Datum gibt es bereits einen manuellen Kurs.").

**Never:**
- No Prisma migration (Price model with `MANUAL` exists); no change to `src/core` resolver or `isStale` semantics; no change to provider adapters or the scheduler beyond tests.
- No logos (3.6), news (3.7), charts/metrics (Epic 4); no bulk import of manual Prices.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit price | MANUAL 2026-10-20 `12.34`, update to `{2026-10-20, "13,5"}` | row now `13.5`, new `fetchedAt` | — |
| Move date | MANUAL 2026-10-20, update to 2026-10-21 (free) | same row id now dated 2026-10-21 | — |
| Date taken | MANUAL rows on 20 and 21, move 20 → 21 | `date-taken`, both rows unchanged | — |
| Invalid edit | date after today / price `0` | `date-invalid` / `price-invalid`, unchanged | — |
| Wrong id | PROVIDER row id or unknown id (update or delete) | `not-found`, nothing changed | — |
| Delete | MANUAL row id | row gone, PROVIDER row of same date kept, resolver now picks provider | — |
| Scheduler | MANUAL 2026-10-22 `999` + full and incremental `refreshPrices` storing PROVIDER `2026-10-22` | MANUAL row unchanged; `securityPriceInfo` and Positions use `999` | — |
| Stale | held Security, only MANUAL dated 2026-10-22, today 2026-10-26 | `stale: true`; MANUAL 2026-10-23 → `stale: false` | — |

</intent-contract>

## Code Map

- `src/modules/prices/prices.ts:395-421` -- `saveManualPrice` (validation to reuse: extract a shared validator for date/price), `SaveManualPriceFailureReason`; add `listManualPrices`, `updateManualPrice`, `deleteManualPrice` and their result types here. `storeHistory` (≈line 130) deletes only `source: "PROVIDER"` rows — the scheduler guarantee to prove by test.
- `src/modules/prices/index.ts` -- export the new services and types.
- `src/modules/prices/prices.test.ts` -- helpers `security`, `buy`, `mapTo`, `charts`, `deps`, `NOW`; `describe("saveManualPrice")` at ≈line 675; `securityPriceInfo` tests ≈line 636; Positions-with-MANUAL test ≈line 603 (`listPositions(..., { storedPrices })`). Recorded Yahoo chart fixtures are used by the refresh tests at ≈line 92.
- `src/core/prices.ts` -- `resolvePrice` (manual > provider > transaction per date, carry-forward) and `isStale`; read-only.
- `src/app/_actions/prices.ts` -- `saveManualPriceAction` pattern (session, zod `formText`, revalidate); add `updateManualPriceAction` (FormData: `priceId`, `date`, `price`) and `deleteManualPriceAction(priceId)`.
- `src/app/_actions/prices.test.ts` -- real-DB action tests with fake session/timers; extend.
- `src/app/_components/securities/ManualPriceDialog.tsx` -- `ManualPriceForm`/`ManualPriceButton`; generalise the form for edit (hidden `priceId`, initial date/price, edit action) and add edit/delete buttons + confirm dialog (new component file allowed, e.g. `ManualPriceList.tsx`).
- `src/app/_components/securities/SecurityList.tsx` -- card layout; add the action-row button and the "Manuelle Kurse" list; new prop `manualPrices?: Record<string, ManualPriceRow[]>`.
- `src/app/(app)/securities/page.tsx` -- load `listManualPrices()` alongside `securityPriceInfo(today)` and pass it down; `page.test.tsx` mocks.
- `src/app/_components/prices/price-labels.ts` -- `ManualPriceErrorReason`, `MANUAL_PRICE_ERRORS`; add `date-taken`, a price formatter for manual rows, the delete confirm text.
- `src/core/format.ts` -- `formatDate`; `formatQuantity` caps at 8 decimals, so manual price display must not use it if more decimals are stored.
- `src/app/_components/securities/SecurityDialog.tsx` -- `SecurityDialog`, `useDialog`, `TOUCH_TARGET`.
- `src/app/_components/transactions/TransactionDialog.tsx:148-180` -- confirm-delete dialog pattern to mirror.
- Tests: `ManualPriceDialog.dom.test.tsx`, `SecurityList.dom.test.tsx` (expects exactly one manual-price button on the failure card — update to the new rule), `test/helpers/dom.ts` (`formEntries`, `registerDomCleanup`).

## Tasks & Acceptance

**Execution:**
- `src/modules/prices/prices.ts` (+ `prices.test.ts`) -- add list/update/delete services per Boundaries, sharing validation with `saveManualPrice`; tests for every I/O matrix row (incl. scheduler full + incremental run keeping MANUAL and Positions using it, stale within/outside 3 days).
- `src/modules/prices/index.ts` -- exports.
- `src/app/_actions/prices.ts` (+ test) -- update/delete actions: success, typed failure, unauthorized writes nothing.
- `src/app/_components/prices/price-labels.ts` (+ test) -- `date-taken` message, manual price text, delete confirm text.
- `src/app/_components/securities/ManualPriceDialog.tsx` / new `ManualPriceList.tsx` (+ dom tests) -- edit dialog prefilled and submitting `priceId`, delete confirm calling the action and closing on success, error alert on failure.
- `src/app/_components/securities/SecurityList.tsx` (+ dom test) -- button on every card (one per card), manual list rendering.
- `src/app/(app)/securities/page.tsx` (+ test) -- pass manual Prices.

**Acceptance Criteria:**
- Given any Security on the Securities page, when I use "Kurs manuell eintragen" and save, then a `MANUAL` Price row exists and appears under "Manuelle Kurse" of that Security with date and price.
- Given a manual Price in the list, when I edit or delete it (delete after confirming), then the row is updated or removed and the page shows the new state after the server confirmed.
- Given a manual and a provider Price on the same date, when Positions, `securityPriceInfo` or any later price run read or write Prices, then the manual value is used and the MANUAL row is never changed by the run.
- Given a held Security whose latest price is manual, when its date is within 3 days of today, then it is not stale; otherwise it is stale.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 17, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `updateManualPrice` reads the row outside the transaction; a concurrent move onto the target date throws P2002 instead of `date-taken` — needs two writes within milliseconds from two tabs of a single user; the fix adds a catch branch; outcome is a generic error with nothing written.
  - `[low]` `[patch]` (blind) A `not-found` update/delete leaves the vanished row listed until reload — both actions now also revalidate on `not-found`; action test asserts it.
  - `[low]` `[patch]` (blind) Edit-mode `not-found` → "Manueller Kurs nicht gefunden." remap untested — dom test added.
  - `[low]` `[reject]` (blind) `fetchedAt` assertion only checks "not the seeded value" and the service uses `new Date()` — the assertion does distinguish the seeded value (proves the edit time was written); `saveManualPrice` from 3.3 uses the same clock; injecting a clock adds a parameter for no user harm.
  - `[low]` `[patch]` (blind) No test proves update/delete leave the mapping untouched — edit and delete tests now assert the mapping row (`fetchError`, `fetchedAt`, `historyFrom`) is unchanged.
  - `[low]` `[reject]` (blind) Action tests lack `date-taken`/`price-invalid` for the update action — the action passes the service result through unchanged; every reason is tested at service level and the zod→service path by the `date-invalid` action test.
  - `[low]` `[reject]` (blind) UI-only `price-not-found` reason mixed into `ManualPriceErrorReason` — two call sites, both tested; no caller diverges today.
  - `[low]` `[reject]` (blind) Manual list has no cap/collapse — single user, the story asks for a list of them with date; paging adds UI state.
  - `[low]` `[reject]` (blind) "Manuelle Kurse" title is a `<p>`, not a heading — the card title itself is a `<p>` too; a heading level here alone would break the page's heading structure; the list has an accessible name.
  - `[low]` `[reject]` (blind) A no-op edit rewrites `fetchedAt` — harmless; `fetchedAt` is the entry/edit time by spec.
  - `[low]` `[reject]` (blind) Date `max` from server `today` goes stale past midnight — pre-existing from 3.3; a reload fixes it.
  - `[low]` `[reject]` (edge) Concurrent manual save onto the target date throws instead of `date-taken` — same as the first blind row.
  - `[low]` `[patch]` (edge) `not-found` does not revalidate — same root cause as the blind row; fixed there.
  - `[low]` `[reject]` (edge) Focus falls to the body after a successful delete unmounts the row — keyboard-only deletion is rare here; focus management adds new code.
  - `[low]` `[patch]` (verification-gap) Edit dialog `not-found` message untested — same as the blind row; dom test added.
  - `[low]` `[patch]` (verification-gap) Reopening the edit dialog after "Abbrechen" not tested to reset — dom test added (stored `1234,5` again, no error).
  - `[false]` `[reject]` (intent) "Wins in every view, chart and metric" only proven for Positions and `securityPriceInfo` — charts/metrics do not exist yet (Epic 4); every price consumer goes through the single core `resolvePrice`.
  - `[false]` `[reject]` (intent) Scheduler itself not run — `scheduler.ts:34` runs `refreshPrices`, which the test runs full and incremental.
  - `[false]` `[reject]` (intent) Two-surface reading (separate page-level entry form) — the per-card button is on the Securities page and is the "Kurs manuell eintragen" action, satisfying both phrasings.
  - `[low]` `[reject]` (intent) No end-to-end click-through-and-rerender test — each link is tested (dom → mocked action, action → real DB + revalidate, page renders seeded MANUAL rows); a browser e2e harness does not exist in this repo.
  - `[false]` `[reject]` (intent) Stale badge not tested at page level for manual prices — the badge renders from the provider-agnostic `stale` flag, tested in `SecurityList.dom.test.tsx`; the flag for manual prices is tested in the service.
  - `[false]` `[reject]` (intent) Button now on every card (changed from 3.3) — required by this story.
  - `[false]` `[reject]` (intent) Run rules / operator flow — no human-only action in this story; status stays on the normal path, `sprint-status.yaml` untouched.

## Design Notes

- Editing by row id (not by date) lets the user correct a wrongly entered date; `date-taken` instead of silently merging keeps an edit from deleting a different manual Price. Creating on an occupied date keeps 3.3's replace behaviour (the dialog is "enter the price of this date").
- Charts and return metrics do not exist yet (Epic 4); "manual wins everywhere" is guaranteed by the single core resolver they must use, so this story proves it through the existing consumers (Positions, `securityPriceInfo`).

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "Number(\|parseFloat" -- src/modules/prices src/app/_components/securities` -- expected: no numeric arithmetic on prices.

## Auto Run Result

Status: done

**Summary:** Manual Prices can now be maintained for any Security on the Securities page: every card offers "Kurs manuell eintragen" (on a failed-fetch card only as the error Alert's action), and a "Manuelle Kurse" list per Security shows date and price (all stored decimals, de-DE) with "Bearbeiten" (prefilled dialog, date and price changeable, `date-taken` when moving onto another manual Price) and "Löschen" (confirm dialog naming date and Security). New `prices` services `listManualPrices`, `updateManualPrice`, `deleteManualPrice` touch only MANUAL rows. Tests prove manual wins over provider on the same date (Positions, price info), survives full and incremental price runs unchanged, and clears the stale flag only within 3 days.

**Files changed:**
- `src/modules/prices/prices.ts` (+ test) — shared manual-price validation; list/update/delete services.
- `src/modules/prices/index.ts` — exports.
- `src/app/_actions/prices.ts` (+ test) — update/delete server actions (revalidate on success and on `not-found`).
- `src/app/_components/prices/price-labels.ts` (+ test) — `date-taken` / `price-not-found` messages, manual price text, delete confirm text.
- `src/app/_components/securities/ManualPriceDialog.tsx` (+ test) — form handles edit mode; `ManualPriceEditDialog`.
- `src/app/_components/securities/ManualPriceList.tsx` (+ new dom test) — "Manuelle Kurse" list with edit and confirm-delete.
- `src/app/_components/securities/SecurityList.tsx` (+ test) — button on every card, manual list.
- `src/app/(app)/securities/page.tsx` (+ test) — loads manual Prices.

**Review findings:** 23 total — 4 patch entries applied (all low: revalidate on `not-found` for update/delete; dom tests for edit `not-found` message and dialog reset after cancel; mapping-untouched assertions), 0 deferred, 17 rows rejected (6 false, 11 low; reasons in the triage log — mainly: millisecond-window concurrent-write race, list paging, heading semantics, focus after delete, clock injection, pre-existing date-max staleness, charts/metrics not existing yet, scheduler delegating to `refreshPrices`).

**Follow-up review recommendation:** false — patched counts: high 0, medium 0, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (95 test files, 1412 tests; build OK). `git grep -n "Number(\|parseFloat" -- src/modules/prices src/app/_components/securities` — no matches. Matrix audit: every I/O row covered by a passing test in `src/modules/prices/prices.test.ts` ("manual Price maintenance").

**Operator actions:** none — the story needs no human-only action.

**Residual risks:** a concurrent edit racing a save onto the same date shows a generic error instead of `date-taken`; a Security maintained by hand for a long time gets a long unpaged list; "manual wins" in charts/metrics relies on Epic 4 using the core resolver.
