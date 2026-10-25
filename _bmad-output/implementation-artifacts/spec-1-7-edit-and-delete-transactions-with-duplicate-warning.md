---
title: 'Story 1.7: Edit and Delete Transactions with Duplicate Warning'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '197d102365d5ce741625e177839157e4902587cd'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A booked Transaction can be neither corrected nor removed, and nothing warns when the same Transaction is entered twice, so the ledger drifts and needs cleanup sessions.

**Approach:** Add pure `core/duplicates` (AD-15) and a positional holdings check in core; extend the ledger write path with `updateTransaction` and `deleteTransaction` plus an advisory duplicate check (manual policy: warn, confirm to proceed); open the Transaction form in edit mode from a Buchungen row, with "Löschen" behind an in-dialog confirmation and an inline duplicate warning with "Trotzdem buchen".

## Boundaries & Constraints

**Always:**
- `src/core/duplicates.ts` is the only duplicate definition: `matchDuplicates(candidate, rows)` → `{ status: "unique" | "duplicate" | "ambiguous", matches }`. A row matches when `depotId`, `date`, `type` and `securityId` (null = null) are equal, `quantity` is equal as decimals (both null counts as equal), and the event values differ by ≤ 0.01 (event value = `fee` for FEE, `tax` for TAX, else `amount`; exact decimal compare). 0 matches → `unique`, 1 → `duplicate`, ≥ 2 → `ambiguous`. A row with the candidate's `id` (when given) is never a match. Pure, decimal strings, no `number`.
- `src/core/holdings.ts`: add `sellableAt(trades, securityId, position: { date, sequence })` (minimum running held quantity from just before `position` through the end of the ledger, ≥ 0) and `firstOversell(trades, securityId)` (first SELL, by `(date, sequence)`, after which the running held quantity is negative, else `null`). `sellableQuantity` keeps its behaviour, delegating to `sellableAt` with the end of `date`.
- Ledger (only writer): `recordTransaction`, `updateTransaction(id, input, db?)` and `deleteTransaction(id, db?)` each run in one DB transaction, return typed `{ ok: false, … }` failures, write nothing on failure.
  - Duplicate check (record and update): after every other check passes and before a new Security is created, unless `input.allowDuplicate === true`: `matchDuplicates` against the Depot's rows (excluding the edited row). Status ≠ `unique` → `{ ok: false, reason: "possible-duplicate", status, matches: TransactionRecord[] }`. A not-yet-existing new Security is `unique` by definition.
  - `updateTransaction`: unknown id → `transaction-not-found`. Validated exactly like `recordTransaction` (type may change), Depot stays the row's Depot (`input.depotId` is ignored). Same date → keeps its sequence; changed date → appended after the last row of the new date. The holding guard below applies to the old and the new Security.
  - `deleteTransaction`: unknown id → `transaction-not-found`; holding guard on the deleted row's Security; the Security row stays.
  - Holding guard (edit and delete), per affected Security over the Depot's BUY/SELL rows with the change applied: if the edited row is a SELL whose quantity exceeds `sellableAt(other rows, …, its position)` → `sell-exceeds-holding` with `available`; else if `firstOversell` finds a SELL and the ledger before the change had none for that Security → `later-sell-exceeds-holding` with that SELL's `date`.
- Server actions: one `saveTransactionAction` (record when the form has no `transactionId`, else update; maps `allowDuplicate` = `"1"`), `deleteTransactionAction(id)`; both require a session, revalidate `/` (layout) only on success.
- Form: one `TransactionForm` for new and edit. Edit mode: title "Buchung bearbeiten", every field prefilled from the record (decimals shown with a decimal comma, FEE/TAX "Betrag" from `fee`/`tax`, Security preselected), submit "Speichern", plus "Löschen" (error colour). "Löschen" switches the same dialog to a confirm view (no second dialog): text from `deleteConfirmText` naming type, Security (if any), date and Depot; buttons "Abbrechen" (back to the form) and "Löschen"; success closes the dialog.
- Duplicate warning: a `possible-duplicate` result shows an inline `Alert severity="warning"` with `duplicateWarning(result)` describing the existing Transaction(s) (type, Security, date, quantity, value), and the submit button becomes "Trotzdem buchen", which resubmits the current values with `allowDuplicate=1`. Shown only while the type equals the submitted type.
- Buchungen list: each row opens the form in edit mode on click, and has a visible edit IconButton (`aria-label` "Buchung vom <Datum> bearbeiten", ≥ 44 px) for keyboard users.
- German messages: `later-sell-exceeds-holding` → "Nicht möglich: Der Verkauf am <Datum> würde den Bestand übersteigen."; `transaction-not-found` → "Buchung nicht gefunden."; both as Alert.

**Never:**
- No schema change or migration; no stored Positions/balances; no Prisma outside `src/modules/ledger` and `src/db`.
- No Depot change on edit, no undo, no bulk delete, no archive guard (story 1.8), no ISIN-change resolution in the matcher (Epic 2), no import/migration policies (Epics 2/5).
- No edits to `sprint-status.yaml`; synthetic test data only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Exact repeat | ledger BUY s1 10 @ 100 on 10-15; candidate same | `duplicate`, 1 match | — |
| Within tolerance | amount 150.00 vs 150.01; 150.00 vs 150.02 | `duplicate`; `unique` | — |
| Savings plan | ledger has two identical BUY s1 3.412871 for 150 on 10-15; candidate identical | `ambiguous`, 2 matches | — |
| Differs | other date / type / Security / quantity / Depot | `unique` | — |
| No Security | DEPOSIT 500 vs DEPOSIT 500 same day; FEE 4.9 vs FEE 5.9 | `duplicate`; `unique` | — |
| Self excluded | candidate with the id of its only match | `unique` | — |
| Manual repeat | record identical BUY without / with `allowDuplicate` | not written / written | `possible-duplicate` with the match |
| Edit price | BUY 10 @ 100 → @ 90 | row updated, sequence kept, Cost Basis 900 + fee on next read | — |
| Edit breaks later sell | BUY 10 (10-01), SELL 8 (10-20); edit BUY to 5 | rejected, unchanged | `later-sell-exceeds-holding`, date 2026-10-20 |
| Delete breaks later sell | same ledger; delete the BUY | rejected | `later-sell-exceeds-holding` |
| Edit own sell | BUY 10, SELL 8; edit SELL to 12 | rejected | `sell-exceeds-holding`, available `10` |
| Move date | edit row from 10-01 to 10-05 where 10-05 has seq 1 | new sequence 2 on 10-05 | — |
| Unknown id | update / delete `nope` | nothing written | `transaction-not-found` |

</intent-contract>

## Code Map

- `src/modules/ledger/transactions.ts` -- `validateTransaction` (reuse for update), `writeTransaction` (Security resolve → SELL guard → create Security → sequence → create; split so update/delete share resolve, guard, duplicate check), `recordTransaction` wraps `$transaction` when available, `TRANSACTION_INCLUDE`, `toRecord`, `RecordTransactionResult`/`TransactionFailureReason` (extend), `RecordTransactionInput` (add `allowDuplicate?: boolean`).
- `src/modules/ledger/index.ts` -- export `updateTransaction`, `deleteTransaction`, new result/input types.
- `src/core/holdings.ts:21` -- `sellableQuantity` (append-at-end semantics); `TradeRow`; generalise with `sellableAt`, add `firstOversell`. `src/core/ledger-order.ts` -- `compareLedgerOrder`.
- `src/core/decimal.ts` -- `ExactDecimal`, `canonicalDecimal`. `test/architecture/core-imports.test.ts` -- core may import only core and `decimal.js`.
- `src/app/_actions/transactions.ts` -- `recordTransactionAction`, zod `tradeForm`, `usedFields`/`figures`/`fieldReason`; becomes `saveTransactionAction` (keep the per-type mapping) + `deleteTransactionAction`. Test pattern in `transactions.test.ts` (session fakes, `revalidatePath` mock, temp DB).
- `src/app/_components/transactions/form-fields.ts` -- `TRADE_FIELDS` (add `transactionId`, `allowDuplicate`).
- `src/app/_components/transactions/labels.ts` -- `MESSAGES`, `FIELDS`, `transactionErrorMessage(reason, available, type)` (extend for the new reasons; `later-sell-exceeds-holding` needs the date → `formatDate`).
- `src/app/_components/transactions/transaction-form.ts` -- `FORM_SECTIONS`, `errorPlacement`; good home for pure `initialValues(record)`, `deleteConfirmText`, `duplicateWarning` (or a sibling file), each unit-tested.
- `src/app/_components/transactions/TransactionDialog.tsx` -- `TransactionForm` (controlled state, `useActionState`, submittedType), `NewTransactionButton` (session remount via `key`); add edit mode and the confirm view, keep one dialog shell.
- `src/app/_components/transactions/TransactionList.tsx` -- server-rendered month tables; becomes a client component (or wraps rows in one) that owns the selected record and one edit dialog; needs `depot {id,name}`, `securities`, `today` props.
- `src/app/(app)/depots/[id]/page.tsx` -- passes props to `TransactionList`; `page.test.tsx` renders with `renderText`/`renderHtml` (SSR of client components works).
- `src/core/format.ts` -- `formatDate`, `formatMoney`, `formatQuantity` for warning/confirm texts.

## Tasks & Acceptance

**Execution:**
- `src/core/duplicates.ts` (+ test) -- `matchDuplicates` per the rules; tests cover every matcher matrix row, including the savings-plan `ambiguous` case.
- `src/core/holdings.ts` (+ test) -- `sellableAt`, `firstOversell`; existing `sellableQuantity` tests unchanged and passing.
- `src/modules/ledger/transactions.ts` (+ test) -- duplicate check in `recordTransaction`, `updateTransaction`, `deleteTransaction`, holding guard; tests for every ledger matrix row; fix existing tests that book identical rows by passing `allowDuplicate: true` (never weaken assertions).
- `src/modules/ledger/index.ts` -- exports.
- `src/app/_components/transactions/form-fields.ts`, `labels.ts` (+ test), `transaction-form.ts` (+ test) -- new fields, messages, `initialValues`, `deleteConfirmText` (e.g. `Kauf „Beispiel AG" vom 15.10.2026 aus Depot „Hauptdepot" löschen?`; without Security `Einzahlung vom 15.10.2026 aus Depot „Hauptdepot" löschen?`), `duplicateWarning`.
- `src/app/_actions/transactions.ts` (+ test) -- save (create/update) and delete actions; tests: update via form, delete, unauthorized, `possible-duplicate` then success with `allowDuplicate=1`, no revalidate on failure.
- `src/app/_components/transactions/TransactionDialog.tsx`, `TransactionList.tsx`, `src/app/(app)/depots/[id]/page.tsx` (+ page test) -- edit mode, confirm view, duplicate warning, clickable rows with edit buttons; page test asserts one edit button per Transaction with its aria-label, and that an edit via `updateTransaction` shows on the next render in Buchungen, Positionen and Cash-Konto.

**Acceptance Criteria:**
- Given a booked Transaction, when its row (or edit button) in Buchungen is activated, then "Buchung bearbeiten" opens prefilled; "Speichern" updates it through the ledger and Positionen, Cash-Konto and Buchungen show the change on the next read.
- Given the edit dialog, when "Löschen" is chosen, then the dialog shows a confirmation naming Depot, Security and date; confirming removes the Transaction and closes the dialog; "Abbrechen" returns to the form.
- Given a new or edited Transaction matching an existing one, when it is submitted, then an inline warning describes the existing Transaction and the button reads "Trotzdem buchen"; pressing it books the Transaction.
- Given an edit or delete that would make a later sell exceed the held quantity, then it is rejected with "Nicht möglich: Der Verkauf am <Datum> würde den Bestand übersteigen." and nothing changes.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 30 findings — high 0, medium 0, low 22, false 8, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) `allowDuplicate` stays on after other fields change, so changed values are booked unchecked — warning/`allowDuplicate`/"Trotzdem buchen" now active only while the current values' key (type, date, shown figures, Security) equals the submitted key (`valuesKey`/`formDataKey`/`submitDecision` in `transaction-form.ts`).
  - `[false]` `[reject]` (blind) editing one of two confirmed identical rows warns again on every edit — the AC requires the warning for "a new or edited Transaction" that matches; re-confirming is the specified behaviour.
  - `[low]` `[reject]` (blind) the "before" comparison is per Security, so an already oversold Security lets a new oversell through — oversold history is unreachable through current write paths (every write is guarded); a per-SELL comparison adds logic for a state no path produces.
  - `[low]` `[reject]` (blind) `as SellExceedsHoldingFailure` / `as LaterSellExceedsHoldingFailure` casts — the other variant is unreachable in both callers (appending checks `sellableAt` incl. later rows; delete adds no row), documented by comments; narrowing adds branches for no reachable case.
  - `[low]` `[reject]` (blind) a failed delete's error reappears after "Abbrechen" → "Löschen" — within one dialog session nothing can change in between (saving closes the dialog), so the shown error is still accurate.
  - `[low]` `[patch]` (blind) `autoFocus` on the destructive "Löschen" — moved to "Abbrechen".
  - `[low]` `[reject]` (blind) dialog closable via Esc/backdrop while a request runs — deliberate project convention since story 1.3 (`DepotDialogs`: Esc and backdrop always close); the server still completes and revalidates.
  - `[low]` `[reject]` (blind) `failureDetail(object)` picks `available`/`date` by field name — correct for every current failure; harm is speculative.
  - `[low]` `[reject]` (blind) `TransactionList` became a client component and sends records/securities to the client — single-user, small payloads; restructuring into server table + client wrapper is a redesign for negligible gain.
  - `[low]` `[patch]` (blind) no test covers the dialog's new behaviour — grouped with the verification-gap dialog row; decisions moved into the tested pure helper.
  - `[low]` `[patch]` (blind) sticky edit cell stays untinted on row hover — cell keeps paper background and overlays `action.hover` on row hover.
  - `[false]` `[reject]` (blind) `DuplicateCandidate.type` is `string` and `id` spread order could be overwritten — `string` keeps core free of Prisma types; `ValidTransaction` has no `id`, so the edited row is always excluded (tested).
  - `[low]` `[reject]` (blind) a row click while selecting text opens the editor — rare; a selection guard adds a branch to the specified row-click behaviour.
  - `[low]` `[patch]` (edge) user edits fields after the warning, `allowDuplicate` skips the re-check — same root cause as the first blind row; fixed there.
  - `[low]` `[patch]` (edge) type switched away and back revives a stale warning — same root cause; the key now covers every value, so only the exact warned values revive it (they were checked).
  - `[low]` `[reject]` (edge) stale delete error after re-entering the confirm view — duplicate of the blind row.
  - `[low]` `[reject]` (edge) already-oversold ledger accepts new oversells — duplicate of the blind row.
  - `[low]` `[reject]` (edge) cast in `writeTransaction` — duplicate of the blind cast row.
  - `[low]` `[reject]` (edge) `sellableQuantity` is now only used by tests — the spec keeps it ("keeps its behaviour, delegating to `sellableAt`"); removing it would contradict the spec.
  - `[low]` `[reject]` (edge, claim) AC later-sell rejection fails after an import oversell — duplicate of the blind oversold row.
  - `[low]` `[patch]` (edge, claim) "Trotzdem buchen" books a different, never-checked Transaction — same root cause as the first blind row; fixed there.
  - `[low]` `[patch]` (verification-gap) oversold-history test edited a DEPOSIT, so the `!firstOversell(before)` branch never ran — test now also edits the oversold Security's BUY (fee 0 → 1) and expects `ok: true`.
  - `[low]` `[patch]` (verification-gap) dialog wiring (`transactionId`, `allowDuplicate`, label, warning gating) untested — extracted `submitDecision`, `valuesKey`, `formDataKey`, `securityKey` into `transaction-form.ts` with unit tests (new/edit, warning on/off after value/type change, labels, form-data key equals on-screen key).
  - `[false]` `[reject]` (intent) ledger returns `possible-duplicate` by default, so a match "blocks" at service level — nothing is dropped; AD-3 has the ledger run the match with each path's policy, and the manual path's policy (warn, confirm) is implemented; the core matcher is advisory.
  - `[false]` `[reject]` (intent) event value instead of raw `amount` for FEE/TAX — AD-14 stores their value in `fee`/`tax` with `amount = 0`; using `amount` would match every same-day fee (Design Notes).
  - `[false]` `[reject]` (intent) delete confirm is a view inside the edit dialog — it names Depot, Security and date as required and keeps dialogs one level deep (UX DoD).
  - `[false]` `[reject]` (intent) holding guard also covers delete and Security changes — stricter protection of the same invariant, no bad outcome.
  - `[low]` `[patch]` (intent) UI surfaces tested only via helpers/actions — same root cause as the verification-gap dialog row; fixed there.
  - `[low]` `[patch]` (intent) `allowDuplicate` persists after edits — same root cause as the first blind row.
  - `[false]` `[reject]` (intent) "all views reflect the change" checked only on the Depot tabs — the Depots list and header read the same on-read computation (`listDepots`/`getDepot`), and the action revalidates the whole layout (tested).

## Design Notes

"Ambiguous" means the candidate matches more than one existing row, so it cannot be told which one it repeats (two identical savings-plan buys already booked). The import epic passes ledger plus batch rows to the same function. Event value instead of the raw `amount` column for FEE/TAX: AD-14 stores their value in `fee`/`tax` with `amount = 0`, so comparing `amount` would match every same-day fee.

The holding guard compares against the pre-change ledger so an unrelated edit is not blocked by an already-negative history (only reachable through future import paths). Edit recomputes a trade's `amount` as Stück × Kurs and a DIVIDEND's `fee` as 0, matching what the form can enter today.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0 (build with a scratch `DATABASE_URL`)
- `npm run dev` with synthetic auth env and a scratch `DATABASE_URL`; book a BUY twice via the UI -- expected: warning, then "Trotzdem buchen" books it; edit and delete from Buchungen work.

**Manual checks (if no CLI):**
- Confirm view replaces the form inside the same dialog; edit button visible on phone width.

## Auto Run Result

Status: done

**Summary:** Transactions can be edited and deleted, and likely duplicates are flagged. New pure `core/duplicates` (`matchDuplicates` → `unique | duplicate | ambiguous`, event value within €0.01, own row excluded) and `core/holdings` additions (`sellableAt`, `firstOversell`). The ledger gets `updateTransaction` and `deleteTransaction` (one DB transaction each, `transaction-not-found`, holding guard with `sell-exceeds-holding` / `later-sell-exceeds-holding`) and an advisory duplicate check on record and update (`possible-duplicate` unless `allowDuplicate`). In Buchungen, a row click or the edit button opens "Buchung bearbeiten" prefilled; "Löschen" switches the same dialog to a confirmation naming type, Security, date and Depot; a possible duplicate shows an inline warning and "Trotzdem buchen", valid only for the values that were checked.

**Files changed:**
- `src/core/duplicates.ts` (+ test) -- the AD-15 matcher.
- `src/core/holdings.ts` (+ test) -- `sellableAt`, `firstOversell`; `sellableQuantity` delegates.
- `src/modules/ledger/transactions.ts` (+ test) -- shared resolve/guard/duplicate/write steps, `updateTransaction`, `deleteTransaction`, new failure types.
- `src/modules/ledger/index.ts` -- exports.
- `src/app/_actions/transactions.ts` (+ test) -- `saveTransactionAction` (create or update), `deleteTransactionAction`.
- `src/app/_components/transactions/form-fields.ts` -- `transactionId`, `allowDuplicate` fields.
- `src/app/_components/transactions/labels.ts` (+ test) -- new messages, `failureDetail`.
- `src/app/_components/transactions/transaction-form.ts` (+ test) -- `initialValues`, `deleteConfirmText`, `duplicateWarning`, `eventValue`, `valuesKey`/`formDataKey`/`submitDecision`.
- `src/app/_components/transactions/TransactionDialog.tsx` -- edit mode, confirm view, duplicate warning; shared `TransactionDialog`.
- `src/app/_components/transactions/TransactionList.tsx` -- client list with clickable rows, sticky edit buttons, edit dialog.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- passes Depot, Securities, today to the list; edit visible on every tab.

**Review findings:** 30 (high 0, medium 0, low 22, false 8).
- Patches applied: 5 entries (11 rows), all low — duplicate confirmation tied to the checked values; dialog submit decisions extracted into a tested helper; focus on "Abbrechen" in the delete confirmation; hover tint on the sticky edit cell; oversold-history test exercises the guard branch.
- Deferred: none.
- Rejected: 19, each with its reason in the triage log (8 false; 11 low — duplicates, unreachable states, project conventions or redesigns for negligible gain).

**Follow-up review recommendation:** false. First pass, patched by verdict: high 0, medium 0, low 5.

**Verification:**
- `npm run lint && npm run typecheck && npm test && npm run build` exit 0 after patches; 45 files / 611 tests passed (build with a scratch `DATABASE_URL`).
- Implementer ran `npm run dev` against a scratch DB with a throwaway login and a headless browser before the review patches: duplicate warning then "Trotzdem buchen" booked; row click opened the prefilled edit form and the edit showed; delete confirmation text, "Abbrechen" and "Löschen" worked; edit button visible at 390 px after pinning the column. The review patches (value-keyed warning, focus, hover tint) were not re-checked in a browser.
- Matrix audit: every I/O row covered by passing core, ledger or action tests.

**Residual risks:**
- Dialog behaviour is tested through pure helpers only (no DOM test setup); the patched warning gating was not re-run in a browser.
- An edit recomputes a trade's amount as Stück × Kurs and sets a DIVIDEND fee to 0; rows from future imports with other values would change on edit.
- The holding guard compares per Security against the pre-change ledger; an already oversold Security (not reachable today) would accept further oversells.
- At service level the duplicate check defaults to "warn"; import/migration (Epics 2/5) must pass their own policy.
