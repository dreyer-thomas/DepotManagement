---
title: 'Confirm Migration and Reconcile with Parqet (story 2-4)'
type: 'feature'
created: '2026-10-25'
baseline_revision: '1e645359e13175c00c8b071a1154ec72cb230b5a'
status: done
review_loop_iteration: 0
followup_review_recommended: false
operator_actions:
  - "Export every Parqet portfolio as CSV (Activities → Export as CSV) before cancelling the Parqet subscription, and keep the files outside the repository."
  - "Run Settings → \"Aus Parqet übernehmen\" with each real export into its target Depot and check the summary: Positions, invested capital, Verrechnungskonto and every sale must show no \"Abweichung\" (cent-level drift across many lots is acceptable)."
  - "Check whether Parqet's realizedgains includes taxes or fees: if sales with tax show a difference equal to their tax (the synthetic fixture assumes gross gains excluding tax), report it so the per-sale comparison can be adjusted."
  - "For a Depot whose export has no Cash rows, enter the broker's Verrechnungskonto balance at the export date in \"Eröffnungsbuchung\" and confirm the Depot's cash balance then matches the broker."
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-DepotManagement/parqet-export-format.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The wizard's client flow (re-send of file/Depot/decisions on "Übernehmen", decisions carried over after decisions-open, reset on file/Depot change, opening-balance submit) has no interaction test; only static renders and the server layer are tested.
    evidence: |-
      ParqetMigrationWizard.test.tsx renders ConfirmBar, ParqetDecisions, ParqetSummaryView and OpeningBalanceForm statically with fixed props; no handler runs. vitest runs in the node environment and no DOM testing library is installed (same tooling gap as DW-3..DW-6). Breaking confirm() (e.g. sending empty decisions or dropping carryDecisions) would pass npm test. Settle by adding DOM test tooling.
    location: >-
      src/app/_components/migration/ParqetMigrationWizard.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 2.3 only previews a Parqet export; Tommy cannot resolve its open items, book it, or check that the booked ledger reproduces what Parqet showed.

**Approach:** The preview gains decisions — classify each new `UNCLASSIFIED` Security, skip or correct each flagged row, and skip or book each possible duplicate of the target Depot's existing ledger. "Übernehmen" re-uploads the same file with the decisions; the server re-reads it, re-checks against the current ledger and books everything through a new ledger batch write in one DB transaction. A summary then compares the Depot's ledger at export date with the file (Positions, invested capital, cash, per-sale realized Gain/Loss vs `realizedgains`), and offers an opening cash booking when the file has no cash rows.

## Boundaries & Constraints

**Always:**
- Only `ledger` writes (AD-3, AD-16): new `ledger.recordBatch` ensures Securities via `ensureSecurity`, then applies entries in the given order via `recordTransaction` / `recordIsinChange` inside ONE `$transaction` with a long `timeout` (e.g. 300 000 ms; Prisma's 5 s default is too short for multi-year files). The first failing entry aborts and rolls back everything and is reported by its `ref`. Nothing is written on failure.
- Booking order: by date; on one date ISIN changes first, then file proposals in reader sequence, then corrected flagged rows. The ledger assigns sequences (appended per date, oldest first).
- Duplicates (AD-15): each proposal is matched with `core/duplicates` `matchDuplicates` against the target Depot's existing Transactions only (never within the file), Security resolved by key to an existing Security, through recorded ISIN changes. Proposals of Securities not yet in the ledger are `unique`. `duplicate`/`ambiguous` proposals are listed with their matches; the client pre-sets their decision to "Überspringen" (switchable to "Trotzdem buchen"). Booked proposals use `allowDuplicate: true` — the user already decided. An ISIN-change proposal whose old Security already has an ISIN change on that date is "bereits erfasst" and never booked again.
- Decisions are keyed by `records.join("-")` (proposals, flags) and Security key (classifications). Open = new `UNCLASSIFIED` Security without STOCK/ETF/CERTIFICATE, flag without skip/book, duplicate without skip/book. "Übernehmen" is enabled only with 0 open decisions; the server re-checks and answers `decisions-open` with a fresh preview when anything is open (e.g. the ledger changed since the preview).
- Corrections of flagged rows: type (BUY, SELL, DIVIDEND, TAX, DEPOSIT, WITHDRAWAL), date, Security key + name + type (security types only), quantity, price, amount, fee, tax; German decimal input (`parseDecimalInput`). Prefilled from the flagged rows' raw values. A key that is a file Security uses its classification, an existing one its stored data; otherwise name and type are required. Invalid values surface as the ledger's failure for that item.
- Summary at export date, from the Depot's ledger after booking: per Security (by key; union of file and ledger) quantity and Cost Basis, ledger vs file; invested capital; cash balance (only when the file had Cash rows); per SELL proposal with a `realizedGain` whose ledger row is known (booked, or skipped as a single-match duplicate) the FIFO gain (`core/fifo` sale at that row's `(date, sequence)`) vs Parqet. Differences > €0.01 (any quantity difference) are marked with text "Abweichung" plus icon, never color alone.
- No Cash rows in the file: summary says the Cash Account could not be reconciled and offers "Eröffnungsbuchung": the user enters the broker balance at export date; the difference to the ledger balance at that date is booked as DEPOSIT (> 0) or WITHDRAWAL (< 0) dated the file's earliest proposal date (editable, must be ≤ export date); difference 0 books nothing.
- Server actions: session check, zod-validated input, same file limit as preview; target Depot must exist and not be archived; `revalidatePath("/", "layout")` after a booking. Never log amounts.
- UI German, de-DE formats, phone width, touch targets ≥ 44px, modal depth ≤ 1, no optimistic writes.

**Never:**
- No staging table, no server-side preview state, no schema migration.
- No direct Prisma writes outside `src/modules/ledger`; no change to `core/duplicates` semantics.
- No within-file duplicate matching; no auto-booking without "Übernehmen".
- No real Parqet data in the repo; reconciliation with a real export is an operator task on local untracked files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First migration | synthetic fixture, empty Depot, all decided | every non-flagged proposal + ISIN change booked; summary all equal, no "Abweichung" | — |
| Re-run same file | same Depot, same file again | every proposal `duplicate`, pre-set skip; ISIN change "bereits erfasst"; confirm books 0 rows | — |
| Open decision | one UNCLASSIFIED Security unset | button disabled; server returns `decisions-open` + fresh preview | nothing written |
| Flag corrected | unpaired TransferIn → BUY 10 @ 5 | booked as BUY on its date after that date's proposals | — |
| Flag skipped | any flag → skip | not booked | — |
| Oversell | a SELL whose BUY was skipped | `booking-failed` naming that item and "sell-exceeds-holding" | full rollback |
| Bad correction | amount `abc` | `booking-failed` with `amount-invalid` for that flag | full rollback |
| Sale mismatch | Parqet `realizedgains` differs by 0.02 | that sale marked "Abweichung" | — |
| No cash rows | file without Cash rows | cash "nicht abgeglichen" + Eröffnungsbuchung form | — |
| Opening balance | ledger −1 200 at export date, target 300 | DEPOSIT 1 500 on earliest date; balance at export date 300 | 0 difference → "nichts zu buchen" |
| Archived Depot | Depot archived after preview | `depot-archived` | nothing written |

</intent-contract>

## Code Map

- `src/modules/migration/parqet-reader.ts:70` `FlaggedRow` — add `rows` (raw strings per record: datetime, type, assettype, identifier, holdingname, shares, price, amount, fee, tax, currency); result adds `hasCashRows` (any parsed `Cash` row). `readParqetCsv` at :337.
- `src/modules/migration/preview.ts:61` `previewParqetMigration` — extend into a shared analysis (Depot check, read, Security annotation, duplicates, recorded ISIN changes, figures) reused by confirm; preview adds `duplicates`, `isinChanges[].recorded`, `hasCashRows`, `flagged[].rows`.
- `src/core/duplicates.ts:76` `matchDuplicates(candidate, rows, isinChanges)`; `src/core/fifo.ts:44` `fifo` sales keyed by `(date, sequence)`; `src/core/cash.ts:69` `cashBalance`.
- `src/modules/ledger/transactions.ts:453` `recordTransaction` (nested-safe via `inTransaction`, `allowDuplicate`); `:581` `listTransactions`; holding check `checkHoldings` makes each SELL depend on earlier booked rows.
- `src/modules/ledger/corporate-actions.ts:383` `recordIsinChange` (`isin-change-exists`, needs the old Security id); `:96` `loadCorporateActions`; `:511` `listIsinChanges`.
- `src/modules/ledger/securities.ts:134` `ensureSecurity`, `findSecurityByKey`, `validateSecurity`.
- `src/modules/ledger/depots.ts:113` `inTransaction` (no options — `recordBatch` calls `$transaction` with timeout itself).
- `src/modules/ledger/positions.ts:18` `listPositions(depotId, today)` — add `listRealizedSales(depotId, asOf)` beside it.
- `src/app/_actions/migration.ts` — `previewParqetAction` pattern; `src/app/_actions/transactions.ts` revalidation pattern.
- `src/app/_components/migration/ParqetMigrationWizard.tsx` — `ParqetPreviewView` (static, tested via `test/helpers/render-text.ts`) and the wizard; `labels.ts`.
- `src/app/_components/transactions/labels.ts:85` `transactionErrorMessage`, `src/app/_components/corporate-actions/labels.ts:62` `isinChangeErrorMessage` — reuse for booking failures; `ASSET_TYPE_LABELS`.
- `test/fixtures/parqet/synthetic-export.csv.txt` — synthetic fixture; add a cash-free variant if needed (`*.csv.txt`).
- Tests: `test/helpers/test-db.ts` temp DB; patterns in `src/modules/migration/preview.test.ts`, `src/app/_actions/migration.test.ts`.

## Tasks & Acceptance

**Execution:**
- `src/modules/ledger/batch.ts` (+ test, temp DB) -- `recordBatch({ depotId, securities: { ref, identifier, details }[], entries })`, entries `{ kind: "transaction", ref, securityRef | null, input }` / `{ kind: "isin-change", ref, oldSecurityRef, newSecurityRef, date, oldQuantity, newQuantity }`; returns created Securities by ref, Transactions and ISIN changes by ref, or `{ ok: false, ref, failure }` after rollback (depot failure ref `"depot"`). Export from `index.ts`. -- single write path, atomic.
- `src/modules/ledger/positions.ts` (+ test) -- `listRealizedSales(depotId, asOf)` (securityId, date, sequence, gain) via `fifo` and corporate actions. -- per-sale reconciliation.
- `src/modules/migration/parqet-reader.ts` (+ test) -- flag `rows`, `hasCashRows`.
- `src/modules/migration/preview.ts` (+ test) -- shared analysis; duplicates; recorded ISIN changes.
- `src/modules/migration/decisions.ts` (+ test) -- pure, client-safe (no Prisma import): decisions type + zod schema, `itemKey`, `openDecisions(preview, decisions)`, `initialDecisions(preview)` (duplicates → skip), `correctionDraft(flag)`.
- `src/modules/migration/confirm.ts` (+ test, temp DB) -- `confirmParqetMigration(depotId, text, decisions)` → `{ ok: true, summary } | decisions-open (+ preview) | booking-failed (item, failure) | preview failures`; `recordOpeningBalance({ depotId, date, asOf, balance })`. Cover every matrix row with the synthetic fixture.
- `src/app/_actions/migration.ts` (+ test) -- `confirmParqetAction` (file, depotId, decisions JSON → `decisions-invalid` when unparsable), `openingBalanceAction`.
- `src/app/_components/migration/labels.ts` (+ test) -- confirm/opening failure texts, booking item labels, decision labels.
- `src/app/_components/migration/ParqetMigrationWizard.tsx`, `ParqetDecisions.tsx`, `ParqetSummaryView.tsx`, `OpeningBalanceForm.tsx` (+ static render tests) -- decision controls (type select per new Security, skip/correct per flag with inline correction fields and raw row text, skip/book per duplicate with its matches, "bereits erfasst" ISIN changes), "Offene Entscheidungen: n", "Übernehmen" (disabled while open or pending) sending the file and Depot that produced the preview; summary "Übernommen – {Depot}" with booked/skipped counts, comparison tables and opening-balance form; link to the Depot. Stale preview cleared when file or Depot changes.

**Acceptance Criteria:**
- Given a preview, when any decision is open, then "Übernehmen" is disabled and the open count is shown; when none is open, then it is enabled.
- Given I confirm, then all booked rows, new Securities and ISIN changes appear in the Depot in one atomic write, and the summary compares Positions, invested capital, cash and per-sale realized Gain/Loss, marking differences > €0.01 with "Abweichung".
- Given a file without Cash rows, when booked, then the summary states the cash could not be reconciled and the opening booking sets the balance at export date to the entered value.
- Given I run the same file again for the same Depot, then nothing new is booked; a file for another Depot books normally.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 28 findings — high 0, medium 2, low 25, false 1, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: file/Depot inputs stay enabled while a request is pending; a late result restores a stale preview/summary — inputs now disabled while pending.
  - `[low]` `[patch]` Blind: error Alert stays after the user changes decisions — decision changes now clear the error.
  - `[low]` `[reject]` Blind: opening-balance offer lives only in client state and the action accepts any Depot/date — after a reload the user can book the same Deposit/Withdrawal with the normal dialog; single-user app behind login; fix adds persisted state.
  - `[low]` `[reject]` Blind: "bereits erfasst" matches an ISIN change by old Security and date only — the ledger allows one ISIN change per old Security and date anyway (`isin-change-exists`); a conflicting target/ratio shows as a Position "Abweichung" in the summary; fix adds a new flag path.
  - `[low]` `[reject]` Blind: sales skipped as ambiguous duplicates are left out of the comparison without a count — needs identical same-day SELLs already in the ledger; fix adds a summary field.
  - `[false]` `[reject]` Blind: unchecked casts in `bookingFailureMessage` can render "undefined" — every reason the batch can return today (depot, Security, Transaction, ISIN-change, correction-field, security-ref-unknown) has a text in the transaction or ISIN-change maps.
  - `[low]` `[patch]` Blind: per-type correction field rules duplicated in `ParqetDecisions.tsx` and `confirm.ts` — moved to `correctionFields` in `decisions.ts`, used by both.
  - `[low]` `[reject]` Blind: correction name schema allows 200 chars vs ledger 100 — a longer name fails at booking with "höchstens 100 Zeichen" for that flag and nothing is written.
  - `[low]` `[reject]` Blind: two corrections naming the same new Security drop the second one's name/type — needs two corrected flags of one unknown ISIN with different details; fix adds conflict detection.
  - `[low]` `[patch]` Blind: no confirm test books a duplicate decided "book" — test added (re-run with one duplicate "book": 1 booked, 7 skipped, one more row).
  - `[low]` `[defer]` Blind: wizard interaction flow untested — no DOM test tooling; deferred (frontmatter).
  - `[low]` `[reject]` Blind: `recordBatch` throws inside a caller's transaction — intentional so the caller's transaction rolls back (documented); no caller passes a transaction client.
  - `[low]` `[reject]` Blind: duplicate/recorded checks run before the write transaction — needs a concurrent write in another tab during confirm (single user); an ISIN change recorded meanwhile still fails cleanly as `isin-change-exists`.
  - `[low]` `[reject]` Blind: no explanation when there is no export date — only a file without any datable proposal (nothing but flags) reaches it; fix adds a UI branch.
  - `[low]` `[patch]` Blind: ConfirmBar `role="group" aria-label="Übernehmen"` repeats the button name — removed.
  - `[low]` `[patch]` Edge: Depot/file change during a pending preview restores the old preview — same fix as the Blind race (inputs disabled while pending).
  - `[low]` `[patch]` Edge: decisions-open spreads a stale `loaded` closure after reset — same race fix; the branch no longer copies an outdated preview.
  - `[medium]` `[patch]` Edge: rejected confirm/preview action (network, transaction timeout) is unhandled — try/catch with German message `ACTION_FAILED_MESSAGE` (+ label test).
  - `[medium]` `[patch]` Edge: rejected opening-balance action is unhandled — same root cause and fix in `OpeningBalanceForm.tsx`.
  - `[low]` `[reject]` Edge: raw `BatchAbort` escapes when called with a transaction client — same as the Blind finding; intentional.
  - `[low]` `[reject]` Edge: conflicting recorded ISIN change silently skipped — same as the Blind finding.
  - `[low]` `[reject]` Edge: re-running a file after booking a corrected flag gives no duplicate warning for that flag — the flag must be decided again with its raw row shown; choosing "Überspringen" is the obvious re-run choice; fix adds a new duplicate-decision path for corrections.
  - `[low]` `[patch]` Edge (claim): stale preview after a mid-request Depot change contradicts "sends the file and Depot that produced the preview" — same race fix.
  - `[low]` `[patch]` Verification gap: duplicate decided "book" never exercised — test added (see above).
  - `[low]` `[patch]` Verification gap: non-BUY corrections untested — TAX (amount still set → only tax booked) and DEPOSIT (key still set → no Security) tests added.
  - `[low]` `[defer]` Verification gap: wizard confirm flow has no running test — same tooling gap; deferred with the Blind finding.
  - `[low]` `[reject]` Intent alignment: reconciliation against a real Parqet export (the story's purpose) is human-only and was not declared as owed — addressed at finalization: status `awaiting-operator` with `operator_actions`; no code change.
  - `[low]` `[defer]` Intent alignment: UI ACs (button enabling, duplicates shown, summary) are checked by static renders and module tests, and the manual `npm run dev` check was not performed — same tooling gap; deferred with the wizard entry.

## Design Notes

Stateless confirm (as 2.3 planned): the server re-runs `readParqetCsv` and the analysis, so a changed ledger yields fresh duplicates rather than booking against a stale view. `allowDuplicate: true` is migration's AD-15 policy: matching happened in the review and the user decided per item. The wizard may call the server actions directly inside `startTransition` (instead of `useActionState`) to hold preview, decisions and summary in one client state; on `decisions-open` keep decisions whose keys still exist.

Performance: each booked row reloads the Depot's trades for the holding guard (O(n²)); fine for a few thousand rows, hence the long transaction timeout.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed.

**Manual checks (if no CLI):**
- `npm run dev`: Settings → "Aus Parqet übernehmen", upload the synthetic fixture, classify, decide flags, "Übernehmen" → summary without "Abweichung"; upload again → 0 booked.

## Auto Run Result

Status: awaiting-operator

**Summary:** The Parqet wizard now resolves every open item and books the export. New `UNCLASSIFIED` Securities get a type, flagged rows are skipped or corrected inline (prefilled from their raw values), and possible duplicates of the target Depot's existing ledger (never within the file) are listed with their matches, pre-set to "Überspringen". "Übernehmen" is enabled only with 0 open decisions. It re-sends file, Depot and decisions; `confirmParqetMigration` re-reads the file, re-checks against the current ledger (`decisions-open` + fresh preview otherwise) and books Securities, ISIN changes and Transactions through the new `ledger.recordBatch` in one DB transaction (300 s timeout, full rollback, failing item named). The summary compares the Depot's ledger at export date with the file: Positions, invested capital, cash, and per-sale FIFO gain vs `realizedgains`, marking differences > €0.01 with "Abweichung" (text + icon). Files without Cash rows get an "Eröffnungsbuchung" that books the difference to the entered broker balance. Re-running a file books nothing new; recorded ISIN changes are not booked again.

**Files changed:**
- `src/modules/ledger/batch.ts` (+ test), `index.ts` — atomic batch write via `ensureSecurity` / `recordTransaction` / `recordIsinChange`.
- `src/modules/ledger/positions.ts` (+ test) — `listRealizedSales` for per-sale reconciliation.
- `src/modules/migration/parqet-reader.ts` (+ test) — raw values on flagged rows, `hasCashRows`.
- `src/modules/migration/preview.ts` (+ test) — shared analysis, duplicates, recorded ISIN changes.
- `src/modules/migration/decisions.ts` (+ test) — client-safe decision model, open count, defaults, correction drafts and fields.
- `src/modules/migration/confirm.ts` (+ test), `index.ts` — confirmation, summary, `recordOpeningBalance`.
- `src/app/_actions/migration.ts` (+ test) — `confirmParqetAction`, `openingBalanceAction`.
- `src/app/_components/migration/ParqetMigrationWizard.tsx`, `ParqetDecisions.tsx`, `ParqetSummaryView.tsx`, `OpeningBalanceForm.tsx`, `labels.ts` (+ tests) — decision UI, confirm bar, summary, opening booking, German texts.
- `test/fixtures/parqet/synthetic-export.csv.txt` (sale `realizedgains` 438,77 → 436,77, gross excl. tax), `synthetic-export-no-cash.csv.txt` (new) — synthetic fixtures.

**Review findings:** 28 findings. Patched 13 rows in 9 entries: medium — unhandled server-action rejections in wizard and opening form; low — input race while pending, stale error, duplicated correction-field rules, ConfirmBar aria duplication, tests for "book" duplicates and TAX/DEPOSIT corrections. Deferred 3 rows as one entry (wizard interaction tests; no DOM tooling). Rejected 12: 1 false (label casts cover every reason today), 11 low not worth a non-trivial fix (reasons in the triage log), including the intent-alignment note, which finalization handles as `awaiting-operator`.

**Follow-up review recommendation:** false — patched entries: high 0, medium 1, low 8.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all passed (61 files, 946 tests) after patches. Manual browser check not performed.

**Operator actions owed:** see frontmatter `operator_actions` — reconcile real Parqet exports locally (never in the repo), confirm the `realizedgains` tax semantics, and set opening cash balances for exports without Cash rows.

**Residual risks:** Parqet's `realizedgains` may include tax (the fixture assumes it does not), so every taxed sale would show "Abweichung"; the holding guard re-reads the Depot per booked row (O(n²), long transaction for very large files); a corrected flag re-booked on a re-run is not duplicate-checked; ambiguous skipped SELLs are not compared; the wizard's client flow has no interaction test.

## Operator Confirmation

Confirmed 2026-10-25: the external actions this story owed were carried out.

- Export every Parqet portfolio as CSV (Activities → Export as CSV) before cancelling the Parqet subscription, and keep the files outside the repository.
- Run Settings → "Aus Parqet übernehmen" with each real export into its target Depot and check the summary: Positions, invested capital, Verrechnungskonto and every sale must show no "Abweichung" (cent-level drift across many lots is acceptable).
- Check whether Parqet's realizedgains includes taxes or fees: if sales with tax show a difference equal to their tax (the synthetic fixture assumes gross gains excluding tax), report it so the per-sale comparison can be adjusted.
- For a Depot whose export has no Cash rows, enter the broker's Verrechnungskonto balance at the export date in "Eröffnungsbuchung" and confirm the Depot's cash balance then matches the broker.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
