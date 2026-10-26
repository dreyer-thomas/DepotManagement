---
title: 'Review and Book Imported Transactions'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '79299d7989856bd5db21c8cdebc8fca90976308c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** An import batch (5.1) shows parsed proposals (5.2) read-only; nothing can be corrected, checked for duplicates or booked, so documents still end in manual entry.

**Approach:** Turn the batch view into the review screen of `mockups/import-review.html`: every proposal is classified with `core/duplicates` against the Depot's ledger and the rest of the batch, can be edited inline and decided (Buchen/Verwerfen); edits and decisions are stored on the item. "N Buchungen buchen" revalidates on the server and books all accepted proposals through `ledger.recordBatch` in one DB transaction that also marks the batch BOOKED; failed files get "Manuell erfassen".

## Boundaries & Constraints

**Always:**
- Classification per proposal (pure, in `import`): candidate Security = stored Security with the proposal's ISIN, else a pseudo key `isin:<ISIN>` (matches no ledger row). Ledger matches = `matchDuplicates(candidate, Depot rows, isinChanges)`; sibling matches = `matchDuplicates` against every OTHER proposal of the batch (same pseudo-key rule). Any sibling match or ≥ 2 ledger matches → `ambiguous`; exactly 1 ledger match → `duplicate`; else `unique`.
- Effective decision: `unique` → stored decision ?? book; `duplicate` → never booked (no decision control); `ambiguous` → stored decision, else open. "N Buchungen buchen" is disabled while any decision is open or N = 0.
- File chip: FAILED → fehlgeschlagen (loss); any ambiguous proposal → mehrdeutig (stale-soft/stale); all proposals duplicate → Duplikat (MUI default grey); else erkannt (gain).
- Duplicate row note: "Bereits gebucht am <dd.mm.yyyy>. Wird nicht erneut gebucht."; ambiguous note names each ledger match ("Gleiche Buchung bereits vorhanden: Kauf 15.10.2026, 3,412871 Stück, 150,00 €.") and/or "Gleiche Buchung mehrfach in diesem Import." plus "Bitte entscheiden."
- Edits and decisions persist on the ImportItem (OPEN batches only); an edit is validated with `transactionProposalSchema` (type, ISIN, name unchanged); German decimal input via `parseDecimalInput`; field errors in German.
- Booking (`bookImportBatch(batchId, expectedKeys)`): recompute classification against the current ledger; open decision → `decisions-open`; the set of `"<itemId>:<index>"` keys to book ≠ `expectedKeys` → `review-changed` (UI: "Der Import hat sich geändert. Bitte erneut prüfen." + refresh); none → `nothing-to-book`. Securities via `ensureSecurity({ isin }, { name: proposal name ?? ISIN, assetType: classifySecurityName(name) })`; entries sorted by (date, item position, index), `allowDuplicate: true` (import's own policy decided). In the SAME DB transaction the batch moves OPEN→BOOKED (claim fails → `not-found`, nothing booked) and `storedFile` is cleared; PDFs are deleted after commit; item rows stay (re-upload hash warning). Any ledger failure rolls back everything and returns the failing file name and the ledger failure (German via `transactionErrorMessage`).
- After a successful booking: `revalidatePath("/", "layout")`, `schedulePriceBackfill()` (prices + logos of new Securities), snackbar "N Buchungen gebucht." (singular "1 Buchung gebucht."); the batch page shows the BOOKED batch read-only with a link to the Depot.
- "Manuell erfassen" on a failed file opens `TransactionDialog` (modal depth 1) for the batch Depot with Datum = item `documentDate` (first `dd.mm.yyyy` in the extracted text of a parser-failed file, stored at upload) else today. Hidden when the Depot is archived; booking an archived Depot's batch is disabled with an Alert and rejected by the ledger.
- No hover-only actions, ≥ 44 px touch targets, German formats; server actions check the session and call module services only; never log amounts.

**Never:** No writes to ledger rows outside `ledger`; no booking of `duplicate` proposals; no auto-booking or optimistic UI; no change to parsers (5.2/5.4) or `core/duplicates`; no edit of type/ISIN (wrong ones → Verwerfen + Manuell erfassen); no "Import vom …" provenance (Transactions do not store it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh batch | 3 unique proposals | chips erkannt, "3 Buchungen buchen" enabled; book → 3 Transactions, new Securities, BOOKED, PDFs gone, nav count −1 | — |
| Re-import | same document after booking | proposal `duplicate`, chip Duplikat, N = 0, button disabled | — |
| Savings plan | 2 identical buys in batch, empty ledger | both ambiguous, button disabled until both decided; both "Buchen" → 2 Transactions | — |
| Two ledger matches | 1 proposal, 2 identical ledger rows | ambiguous with both matches listed | — |
| ISIN change | proposal with old ISIN, ledger row on successor | duplicate | — |
| Discard row | unique row "Verwerfen" | N −1, not booked | — |
| Edit | amount "1.234,56" | stored "1234.56", reclassified on reload | invalid → German field error, nothing stored |
| Ledger rejects | SELL exceeding holding | nothing booked, batch OPEN, PDFs kept | "<file>: <ledger message>" Alert |
| Changed meanwhile | ledger row added after page load | — | `review-changed`, refresh |
| Double submit / BOOKED | book or decide/edit a BOOKED batch | nothing booked | `not-found`; discard of BOOKED → `not-found`, rows kept |
| Failed file | Layout nicht erkannt, text with "15.10.2026" | "Manuell erfassen" dialog, Datum 15.10.2026, Depot fixed | no date → today |

</intent-contract>

## Code Map

- `prisma/schema.prisma` `ImportItem` -- add `decisions String @default("[]")` (JSON array aligned with proposals: `"book" | "discard" | null`) and `documentDate String?`; new migration folder after `20261026200000_add_import_staging`; run `npx prisma generate`.
- `src/core/duplicates.ts` -- `matchDuplicates(candidate, rows, isinChanges)` (1 match duplicate, >1 ambiguous); read-only.
- `src/modules/migration/preview.ts:126-170` -- precedent: ledger rows indexed by `date|type`, candidate `securityId` from stored Security, unknown Security → no ledger match.
- `src/modules/ledger/batch.ts` -- `recordBatch(input, db)`: Securities via `ensureSecurity`, entries via `recordTransaction`, own `$transaction` (catches `BatchAbort` → typed failure). Add optional third param `options?: { beforeEntries?: (tx: LedgerDb) => Promise<void> }` run first inside the transaction (a throw rolls back and propagates); document it. Only change in `ledger`.
- `src/modules/ledger/index.ts` -- `listTransactions(depotId)` (`security` summary), `listSecurities`, `listIsinChanges` (map to core `IsinChange` as in preview.ts:213-219), `getDepot` (`archived`), `ensureSecurity` details `{ name, assetType }`.
- `src/core/asset-type.ts:48` -- `classifySecurityName(name)` for new Securities.
- `src/modules/import/batches.ts` -- `getImportBatch` (extend with review data + `depotArchived`), `createImportBatch` `prepare` (store `documentDate` when the parser fails after extraction; use `germanDate`/`DATE_PATTERN` from `parsers/german.ts`), `discardImportBatch` (already OPEN-only), `inTransaction`, `readProposals`.
- `src/modules/import/proposal.ts` -- `transactionProposalSchema` for edits.
- `src/core/decimal-input.ts` -- `parseDecimalInput` for German edit input (in the action).
- `src/app/_actions/import.ts` + `import.test.ts` -- action pattern, session check, mocked `next/*`; mock `./price-refresh` like `transactions.test.ts`.
- `src/app/_actions/price-refresh.ts:35` -- `schedulePriceBackfill()`.
- `src/app/_components/import/ImportBatchView.tsx`, `labels.ts` -- current read-only view, chip, summary to replace/extend.
- `src/app/_components/transactions/TransactionDialog.tsx:463` -- `TransactionDialog({ open, onClose, formKey, depot, securities, today })`; `today` is only the default Datum (pass documentDate).
- `src/app/_components/transactions/labels.ts:86` -- `transactionErrorMessage(reason, detail, type)`, `failureDetail`; `transactionTypeLabel`.
- `src/app/_components/securities/SecurityLogo.tsx` -- `SecurityLogo({ securityId, name })` (pseudo id for new Securities → initials).
- `src/app/_components/securities/PriceRefreshButton.tsx:64` -- Snackbar + Alert pattern.
- `src/app/(app)/import/[batchId]/page.tsx` -- also pass `listSecurities()` and `businessDate(new Date())` for the dialog.
- DESIGN.md `status-chip-import` -- ambiguous `stale-soft/stale`, duplicate MUI default grey.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/20261026210000_import_review/migration.sql` -- two ImportItem columns.
- `src/modules/ledger/batch.ts` (+ `batch.test.ts`) -- `beforeEntries` hook; tests: runs inside the transaction; its throw rolls back Securities/Transactions and propagates.
- `src/modules/import/review.ts` (+ `review.test.ts`) -- pure: `classifyBatch(depotId, items, ledgerRows, securityIdByIsin, isinChanges)` → per proposal `{ status, ledgerMatches, siblingMatch }`; `effectiveDecision`; `itemReviewStatus`; `reviewCounts` (files per chip, openDecisions, bookKeys). Unit-test every classification/decision rule of the matrix incl. 0.01 tolerance.
- `src/modules/import/batches.ts` -- `getImportBatch` returns per item `reviewStatus` (`PARSED | AMBIGUOUS | DUPLICATE | FAILED`), `documentDate`, per proposal `{ key, proposal, status, ledgerMatches, siblingMatch, decision, effective, securityId, securityName }`, batch `depotArchived`, `bookKeys`, `openDecisions`; `decideProposal(batchId, itemId, index, decision | null)`, `updateProposal(batchId, itemId, index, fields)` (typed failures `not-found`, `invalid` with field), `bookImportBatch(batchId, expectedKeys, deps)`; `documentDate` at upload. Export via `index.ts`.
- `src/modules/import/batches.test.ts` -- DB tests for every matrix row touching the DB, 15-file batch booked in one call, BOOKED discard → `not-found` with rows kept (5.1 deferred), rollback leaves batch OPEN and files.
- `src/app/_actions/import.ts` (+ test) -- `decideProposalAction`, `updateProposalAction` (German decimals → canonical, field error), `bookImportBatchAction` (`expectedKeys` JSON; success → revalidate + `schedulePriceBackfill`, returns `{ ok: true, booked, depotId }`).
- `src/app/_components/import/` -- `ImportReview` client component (summary "14 Dateien: 11 erkannt, 1 mehrdeutig, 1 Duplikat, 1 fehlgeschlagen · 1 Entscheidung offen" — zero parts omitted except erkannt; Verwerfen; "N Buchungen buchen"; snackbar; error Alerts), proposal rows (type, date, logo+name, Stück, Betrag, Gebühr, Steuer; Buchen/Verwerfen toggle; "Bearbeiten" expanding an inline edit row with Speichern/Abbrechen), notes, `ManualEntryButton`; chip for four statuses; labels + tests; DOM tests (button disabled until decided, toggle calls action, edit error shown, snackbar text, Manuell erfassen prefilled date, BOOKED read-only).
- `src/app/(app)/import/[batchId]/page.tsx` (+ test) -- load securities/today; BOOKED view.

**Acceptance Criteria:**
- Given a batch with parsed items, when I open it, then each file shows one of erkannt/Duplikat/mehrdeutig/fehlgeschlagen and its proposals with logo and name, editable inline, each with Buchen/Verwerfen.
- Given open ambiguous decisions, when I view the header, then "N Buchungen buchen" is disabled; after deciding all, it is enabled and booking creates exactly the accepted Transactions in one DB transaction and shows "N Buchungen gebucht.".
- Given a booked document, when the same PDF is uploaded and reviewed again, then nothing new can be booked.
- Given a failed file, when I click "Manuell erfassen", then the Transaction dialog opens for the batch Depot with the readable date or today.
- Given a 15-document batch without ambiguities, when I click "N Buchungen buchen" once, then all proposals are booked (NFR9: review requires no per-row action).

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 32 findings — high 0, medium 4, low 23, false 5, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) Book button enabled while an inline edit row is open: unsaved corrections dropped, old values booked — `disabled` now includes `editingKey !== null`; DOM test added.
  - `[low]` `[patch]` (blind) Row controls stay clickable during booking/edit saving — row busy state now includes `booking`; DOM test added.
  - `[low]` `[reject]` (blind) `expectedKeys` compares only the key set, not contents/ledger matches shown — needs a concurrent edit in another tab or a new matching ledger row between page load and click (single user); fix adds a content fingerprint.
  - `[medium]` `[patch]` (blind) In-transaction claim and re-check in `beforeEntries` untested — grouped with verification-gap row; two tests with an intercepting `$transaction` client added (`not-found`, `review-changed`, nothing booked).
  - `[low]` `[reject]` (blind) False-positive Duplikat cannot be booked or entered manually from the review — AC: duplicates are not booked; "Neue Buchung" on the Depot page with "Trotzdem buchen" covers genuine identical trades.
  - `[low]` `[reject]` (blind) `/import` list summary (parsed/failed) differs from the batch page chips — cosmetic; aligning needs a full classification per listed batch.
  - `[low]` `[reject]` (blind) Failed file shows no "handled" state after Manuell erfassen — needs new per-item state; the ledger's own duplicate warning guards double entry.
  - `[false]` `[reject]` (blind) Edit error ignores the schema issue (missing vs invalid), date fallback for non-editable issue — empty figures fail in the action as `<field>-invalid` before the service; stored proposals are valid and only editable fields change, so non-editable issues cannot arise.
  - `[low]` `[patch]` (blind) `decide`/edit save do not refresh on `not-found` — both now call `router.refresh()`; decide path DOM-tested.
  - `[low]` `[reject]` (blind) BOOKED batches are classified (all Duplikat, hidden) — negligible single-user cost; UI hides it.
  - `[false]` `[reject]` (blind) A decision kept across a reclassifying edit is invisible — the toggle shows the effective decision (`selected = effective`), so a kept "Verwerfen" is visible.
  - `[low]` `[reject]` (blind) No early archived check in `bookImportBatch` — the button is disabled and the ledger rejects with rollback; only a saved round trip.
  - `[low]` `[reject]` (blind) `readDecisions` silently drops corrupt JSON — only reachable by tampering with the DB.
  - `[low]` `[reject]` (blind) Notes row not linked via `aria-describedby` — notes render directly under the row; wiring adds ids for a single-user app.
  - `[low]` `[reject]` (edge) Proposal edited between outer read and booking transaction → stale values booked — same root as the expectedKeys row; millisecond window or second tab.
  - `[low]` `[reject]` (edge) Edit in another tab with unchanged keys → unseen values booked — same root as above.
  - `[medium]` `[patch]` (edge) Book enabled with open edit row — same entry as the first blind row.
  - `[low]` `[patch]` (edge) Toggles enabled during booking — same entry as the second blind row.
  - `[false]` `[reject]` (edge) `bookImportBatch` with a transaction client leaks `BatchAbort` — no caller passes one; the only caller (`bookImportBatchAction`) uses the default root client.
  - `[low]` `[patch]` (edge) `Review.editable` doc comment claims the Depot is bookable while the value is only "OPEN" — comment corrected.
  - `[low]` `[patch]` (edge) `firstDocumentDate` matches inside longer digit runs — `(?<!\d)`/`(?!\d)` lookarounds added; test added.
  - `[low]` `[patch]` (edge) `itemCounts` dead after the rework — deleted with its test line.
  - `[low]` `[reject]` (edge) Duplicate rows lack Buchen/Verwerfen and Bearbeiten (AC "each with Buchen/Verwerfen") — AC also says duplicates are not booked; the spec resolves both by a "wird nicht gebucht" row.
  - `[low]` `[reject]` (edge) Booked content may differ from the stored accepted proposal under a concurrent edit — same root as the expectedKeys row.
  - `[low]` `[patch]` (verification-gap) Date ordering of accepted proposals untested — test stages a SELL file before an earlier BUY and books both.
  - `[medium]` `[patch]` (verification-gap) In-transaction claim/re-check never exercised — tests added (see blind row).
  - `[low]` `[reject]` (intent) NFR9 measured by proxy (one-click booking, 15-file service test), not interaction time — interaction time is not automatable; design needs no per-row action.
  - `[low]` `[reject]` (intent) Mockup match checked by DOM text, not visually — no visual-regression harness in the project.
  - `[low]` `[reject]` (intent) Re-import round trip uses stub parser, not real PDFs — real PDFs must not be committed; the parser is covered in 5.2.
  - `[low]` `[reject]` (intent) Revalidation covers the key set only — same root as the expectedKeys row.
  - `[false]` `[reject]` (intent) Snackbar may vanish when the page re-renders as BOOKED — `router.refresh()` keeps the mounted `ImportReview` and its state; the tree is unchanged.
  - `[false]` `[reject]` (intent) Operator clause unused although NFR9/mockup are human checks — those are in-repo verification, not actions outside the repo; no operator-owed action exists.

### 2026-10-26 — Review pass (follow-up)
- verdicts: 26 findings — high 0, medium 1, low 21, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) A SELL file uploaded before a same-day BUY file is booked first and the ledger rejects the batch — sort order (date, position, index) is the spec's; a BUY-before-SELL tie-break would break sell-then-rebuy days instead; a same-day round trip split over two files in one batch is rare and the Alert names the file.
  - `[low]` `[reject]` (blind) "Manuell erfassen" only on FAILED files, not for a parsed proposal with a wrong type/ISIN — the Always clause scopes the button to failed files; "Neue Buchung" on the Depot page covers the rare parser error.
  - `[low]` `[patch]` (blind) `decisions-open`/`nothing-to-book` from booking leave the page stale (no control for the newly open decision) — `ImportReview.book` now refreshes on every non-ledger failure; DOM test extended with `decisions-open`.
  - `[low]` `[reject]` (blind) BOOKED view does not show which proposals were booked, discarded or skipped — needs a new booked-state rendering; the Transactions are visible on the Depot.
  - `[false]` `[reject]` (blind) No test fails if `allowDuplicate: true` is removed — mutation run: removing it fails the savings-plan test and the two-ledger-matches path (2 failures).
  - `[low]` `[reject]` (blind) `decideProposalAction` maps an unknown decision to `null` and clears the stored decision — only reachable by a hand-crafted request; the own UI sends only book/discard/null; fix adds a guard.
  - `[low]` `[reject]` (blind) `TRANSACTION_REASONS` in `labels.ts` is a hand-copied reason list that can drift — a new ledger reason falls back to "Buchung wurde abgelehnt."; fix adds a new exported guard to `transactions/labels.ts`.
  - `[low]` `[patch]` (blind) No test shows an edit cannot change type, ISIN or name — test added: an edit carrying type/ISIN/name keeps BUY/SAP/"SAP SE".
  - `[false]` `[reject]` (blind) `UpdateProposalResult.issue` can be `decimal-invalid` for an empty figure — carried: empty figures fail in the action as `<field>-invalid` before the service (same claim as the first pass's false row).
  - `[low]` `[reject]` (blind) Batch "Verwerfen" stays enabled during booking — it opens a confirm dialog first, the server outcome is safe (`not-found` or rollback); fix adds a prop to `DiscardBatchButton`.
  - `[low]` `[reject]` (blind) Edit row ignores `review.busy`; opening Bearbeiten on another row drops unsaved input — single user, a second click on another row's Bearbeiten is deliberate; fix needs a guard or confirm.
  - `[low]` `[reject]` (blind) Every row's toggle group and edit button share one accessible name — same family as the first pass's `aria-describedby` reject; fix adds per-row label wiring.
  - `[low]` `[reject]` (blind) Whole Depot ledger re-read on each review render and inside the booking transaction — single-user SQLite with a personal ledger; bounding the query adds filtering logic.
  - `[low]` `[reject]` (blind) The `expectedKeys` content risk was rejected rather than deferred — its fix is to edit this build's spec; the risk itself stays a carried reject and is named under residual risks.
  - `[low]` `[reject]` (edge) Proposal content edited between outer read and booking transaction books stale values — carried: same root as the first pass's `expectedKeys` row.
  - `[low]` `[reject]` (edge) After a decision, controls re-enable before `router.refresh()` delivers new keys, so a fast click gets a spurious `review-changed` — harmless: the message plus refresh recovers; fix needs `useTransition` wiring.
  - `[low]` `[reject]` (edge) Unsaved edit input dropped when opening another row's Bearbeiten — same entry as the blind edit-row row.
  - `[low]` `[reject]` (edge) Malformed decision clears the stored decision — same entry as the blind `decideProposalAction` row.
  - `[medium]` `[patch]` (verification-gap) Fee, tax, quantity, price and the no-ISIN FEE path of booked proposals are unverified — booking test now projects quantity/price/fee/tax and books a FEE proposal without an ISIN (`security` null).
  - `[low]` `[patch]` (verification-gap) FEE/TAX branches of `editableFields` untested — `edit-fields.test.ts` pins all five types; `updateProposal` test edits a FEE (only date/fee applied) and a TAX (only tax applied).
  - `[low]` `[reject]` (intent) No end-to-end test from click through real action and service to the BOOKED re-render — each step is covered at service, action and DOM level; the project has no browser e2e harness.
  - `[low]` `[reject]` (intent) Mockup fidelity and touch-target rule not compared/asserted — carried: no visual-regression harness (first pass row).
  - `[false]` `[reject]` (intent) "Depot fixed" in the Manuell erfassen dialog only assumed — `TransactionDialog` writes `depot.id` as a hidden input (`TransactionDialog.tsx:393`); there is no Depot selector.
  - `[low]` `[reject]` (intent) Duplicate rows offer no Bearbeiten — carried: same as the first pass's "no decision control on duplicate rows" row.
  - `[false]` `[reject]` (intent) New `beforeEntries` hook on `ledger.recordBatch` is unspecified — the Code Map lists `src/modules/ledger/batch.ts` and the hook keeps all ledger writes inside `ledger` (AD rule), which the intent requires for the same-transaction claim.
  - `[low]` `[reject]` (intent) ISIN-change duplicate needs a stored Security for the old ISIN — the intent's pseudo-key rule defines exactly this; an ISIN change always has its old Security stored.

## Design Notes

Siblings make two identical savings-plan executions ambiguous even on an empty ledger (EXPERIENCE journey step 4); a single-match re-import is a plain duplicate, so re-importing books nothing. The mockup's single-match "mehrdeutig" example is illustrative; AD-15's 1/>1 rule wins. Decisions are persisted (not client state) so an open batch keeps them across sessions, and the server is the single source for N; `expectedKeys` guards against booking a set the user did not see. The claim (OPEN→BOOKED) runs first in the booking transaction, so a double submit cannot book twice.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` (throwaway `DATABASE_URL`) -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: upload a ROBIN text-based PDF twice → second batch shows Duplikat; failed file → "Manuell erfassen" dialog with date.

## Auto Run Result

Status: done

**Summary:** The import batch page is the review screen of `mockups/import-review.html`: proposals are classified with `core/duplicates` (Duplikat never booked, mehrdeutig needs a decision, erkannt booked by default), can be edited inline and decided with Buchen/Verwerfen (stored on the item), and "N Buchungen buchen" revalidates on the server and books through `ledger.recordBatch` in one transaction that claims the batch OPEN→BOOKED. Failed files offer "Manuell erfassen". This follow-up review pass closed test gaps and made a refused booking reload the review.

**Files changed (this pass):**
- `src/app/_components/import/ImportReview.tsx` — a refused booking (any reason but a ledger rejection) refreshes the page.
- `src/app/_components/import/ImportReview.dom.test.tsx` — `decisions-open` triggers a refresh.
- `src/modules/import/batches.test.ts` — booked quantity/price/fee/tax and a no-ISIN FEE; FEE/TAX edits; type/ISIN/name not editable.
- `src/modules/import/edit-fields.test.ts` (new) — editable fields per type.

**Files changed (story, first pass):** `prisma/schema.prisma` + migration `20261026210000_import_review`; `src/modules/ledger/batch.ts` (`beforeEntries`); `src/modules/import/{review,edit-fields,batches,index}.ts`; `src/app/_actions/import.ts`; `src/app/_components/import/{ImportReview,ImportBatchView,labels}.tsx|ts`; `src/app/(app)/import/[batchId]/page.tsx`; tests alongside.

**Review (follow-up pass):** 26 findings — high 0, medium 1, low 21, false 4, maybe-false 0. Patched: 1 medium (booked fee/tax/no-ISIN verification), 3 low (refresh on refused booking, FEE/TAX edit coverage, type/ISIN/name edit test). Nothing deferred. Rejected, with reasons in the Review Triage Log:
- same-day SELL-before-BUY order across files
- Manuell erfassen only on failed files
- BOOKED view without per-proposal outcome
- unknown decision clears the stored one (2 rows)
- hand-copied `TRANSACTION_REASONS`
- discard button during booking
- edit row and busy state, dropped unsaved input (2 rows)
- shared accessible names
- full ledger re-read
- `expectedKeys` not deferred (fix edits the spec)
- stale content under concurrent edit (carried)
- re-enable before refresh
- no end-to-end test
- mockup fidelity (carried)
- duplicate-row edit (carried)
- ISIN-change needs the old Security
- false: `allowDuplicate` untested (mutation run proves it is), `decimal-invalid` issue (carried), Depot not fixed in dialog, unspecified `beforeEntries`

**Follow-up review recommended:** false. Follow-up pass with no `high` patched (patched: medium 1, low 3); the in-transaction claim/re-check tests and the edit-row `not-found` refresh from the first pass were re-read by four reviewers without new findings.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` against a throwaway `DATABASE_URL`: all pass (156 files, 2121 tests). Mutation check: setting `allowDuplicate: false` fails 2 booking tests. No manual `npm run dev` check with real PDFs.

**Residual risks:**
- Edits or ledger changes made in another tab with an unchanged key set are not detected at booking.
- The BOOKED view does not show per-proposal outcomes.
- Same-day SELL and BUY in separate files of one batch can be rejected by the ledger when the SELL file comes first.
- Real ROBIN layouts depend on the operator follow-up from story 5.2.
