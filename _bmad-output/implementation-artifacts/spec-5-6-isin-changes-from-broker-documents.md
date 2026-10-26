---
title: 'ISIN Changes from Broker Documents'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '684fafeef651745ce0f1cbdc9b81aac80bd4e365'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A Deutsche Bank/ROBIN or comdirect corporate-action notice is not recognized as one, so it fails with "Layout nicht erkannt" and still offers "Manuell erfassen" (the trade form).
    evidence: |-
      Only finanzen.net zero has a corporate-action parser; the Deutsche Bank and comdirect parsers contain no corporate-action detection and no fixtures of such notices exist. Settled by an anonymised real corporate-action notice from either broker (then add detection that fails it with the Corporate Action hint or reads it as an ISIN change).
    location: >-
      src/modules/import/parsers/registry.ts
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** A finanzen.net zero "Obligatorischer Umtausch" (ISIN change) fails as "fehlgeschlagen" and offers "Manuell erfassen", which opens the trade form — a path to a wrong BUY/SELL booking. Recognizable ISIN changes should be a one-click corporate action in the import review, and unreadable corporate-action notices must never lead to the Transaction form.

**Approach:** The Baader corporate-action parser returns an ISIN-change proposal for a readable notice with exactly one Ausbuchung and one Einbuchung. Such a file is stored with the new item status `CORPORATE_ACTION`, reviewed as "Kapitalmaßnahme" (already recorded → "Bereits erfasst", else default booked with "Als ISIN-Wechsel buchen"/"Verwerfen"), and booked as a `recordBatch` `isin-change` entry in the same batch booking. Unreadable corporate-action notices fail with a reason pointing to "Position → Corporate Action" and without "Manuell erfassen".

## Boundaries & Constraints

**Always:**
- **ISIN-change proposal** (`kind: "isin-change"`): `date` (business date), `oldIsin`, `oldName?`, `oldQuantity`, `newIsin`, `newName`, `newQuantity`; zod-validated (`isinSchema`, names ≤ `SECURITY_NAME_MAX_LENGTH`, quantities decimal > 0 with ≤ 8 places, `oldIsin ≠ newIsin`). `ParsedDocument.isinChange` is valid only with empty `proposals` and no `note`/`link`/`noBooking` (else `INVALID_OUTPUT_REASON`); `parseDocument` → `{ status: "CORPORATE_ACTION", documentType, isinChange }`; `linkDocuments` passes it through.
- **Baader parse rule** (claim check unchanged: `isBaaderDocument` and title or depot-posting line): readable only when the text has exactly one line `Ausbuchung aus Depot <nr> per <dd.mm.yyyy>` and exactly one `Einbuchung in Depot <nr> per <dd.mm.yyyy>` with equal dates; exactly one block `^Ausbuchung$` and one `^Einbuchung$` (page 2), each followed by `Stück <qty> <name>` and `ISIN: <ISIN>`; different ISINs; and no `Zu Lasten`, `Zu Gunsten`, `Barausgleich` or `Spitze` anywhere. `date` = the "per" date; quantities via `germanAmount`. Anything else claimed (split, spin-off, cash compensation, missing block, mismatched dates) → `{ error: "invalid", message: CORPORATE_ACTION_REASON, corporateAction: true }`.
- `CORPORATE_ACTION_REASON` becomes exactly "Kapitalmaßnahme bitte in der Position unter „Corporate Action“ erfassen." A FAILED outcome with `corporateAction: true` is stored with `documentType: "corporate-action"`; the review never shows "Manuell erfassen" for such an item.
- **Storage:** new `ImportItemStatus.CORPORATE_ACTION` (migration with comment only, like `20261026220000_import_no_booking`); the item stores `[isinChange]` in `proposals` (validated with its own schema on read) and its decision at index 0 in `decisions`.
- **Review:** `ImportItemView.isinChange` (null otherwise) carries key `proposalKey(itemId, 0)`, proposal, `status`, decision, effective. Status `recorded` when both ISINs map to stored Securities and `listIsinChanges` has a change with exactly that old Security, new Security and date → effective `discard`, no actions, text "Bereits erfasst"; `duplicate` when an earlier item of the batch has the same old ISIN, new ISIN and date → effective `discard`, text "Bereits in diesem Import."; else `unique` → stored decision, default `book`. Chip "Kapitalmaßnahme" (`ItemReviewStatus` `CORPORATE_ACTION`); row text "ISIN-Wechsel <old> → <new>, <qty> St. am <dd.mm.yyyy>" (qty = old quantity; when quantities differ "<old> St. → <new> St."), names below when known. Booked keys and counts include it; `decideProposal` accepts it (index 0); it is not editable.
- **Booking:** accepted ISIN changes become `recordBatch` `isin-change` entries; both ISINs go into the batch securities (old: name `oldName ?? oldIsin`, new: `newName`, asset type via `classifySecurityName`; existing Securities stay unchanged via `ensureSecurity`). Entries are ordered by date, ISIN changes before Transactions of the same date (AD-8), then position, index. A rejected ISIN change reports its file and the `isinChangeErrorMessage` text; nothing is booked.

**Never:** No BUY/SELL, Transaction form or "Manuell erfassen" for corporate-action items; no change to Deutsche Bank/comdirect parsers, `core/duplicates`, ledger services or the ISIN-change dialog; no editing of ISIN-change proposals; no splits or other corporate actions from documents; no real documents or personal data committed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ISIN change | `isin-change.txt` | CORPORATE_ACTION: 2026-08-13, DE0007236101 "Siemens AG" 12 → DE000ENER6Y0 "Siemens Energy AG" 12 | — |
| Already recorded | same change (both Securities, same date) in ledger | "Bereits erfasst", not in bookKeys | — |
| Book now | unrecorded change, batch booked | CorporateAction ISIN_CHANGE created, new Security ensured, lots move | ledger failure → nothing booked, file named |
| Same file twice | two identical change items | second "Bereits in diesem Import.", one booked | — |
| Unreadable notice | split title, missing Einbuchung block, dates differ, `Barausgleich` | FAILED, Position → Corporate Action reason, `documentType` `corporate-action`, no "Manuell erfassen" | — |
| Other failures | trade layout unknown | FAILED with "Manuell erfassen" as before | — |

</intent-contract>

## Code Map

- `src/modules/import/proposal.ts` -- add `isinChangeProposalSchema`/types, `ParsedDocument.isinChange`, `ParseError` invalid `corporateAction?: true`.
- `src/modules/import/parsers/registry.ts` -- `ParseOutcome` `CORPORATE_ACTION`; FAILED with `corporateAction`; validation of combinations (same pattern as `noBooking`).
- `src/modules/import/parsers/link.ts:11-15,44` -- `LinkedOutcome` gains `CORPORATE_ACTION` and FAILED `corporateAction`; passthrough.
- `src/modules/import/parsers/finanzen-zero/{corporate-action,reasons}.ts` -- parse rule above; new reason text; `german.ts` (`germanAmount`, `germanDate`, `ISIN_PATTERN`) for fields.
- `src/modules/import/review.ts` -- `StoredItemStatus`/`ItemReviewStatus` + `CORPORATE_ACTION`, `itemReviewStatus`, `reviewCounts.files`; pure ISIN-change classification helper (recorded / duplicate / unique).
- `src/modules/import/batches.ts` -- `createImportBatch` stores status/proposals/documentType (`:243-262`); `reviewItems` (`:331`) already loads `listIsinChanges` and securities — classify ISIN changes there; `openItem` (`:420`) for decisions accepts CORPORATE_ACTION (update stays PARSED-only); `bookImportBatch` (`:505`) builds entries/securities/order; `BookImportBatchResult.type` gains `"ISIN_CHANGE"`; `listOpenBatches` counts CORPORATE_ACTION as parsed.
- `src/modules/ledger/batch.ts` -- `recordBatch` already supports `kind: "isin-change"` (read-only).
- `src/modules/import/index.ts` -- re-export new types.
- `prisma/schema.prisma:280` -- enum value; new migration `prisma/migrations/20261027100000_import_corporate_action/migration.sql` (sorts after `20261027000000_reconciliation`).
- `src/app/_components/import/{labels.ts,ImportReview.tsx}` -- chip label/color (grey like NO_BOOKING), `reviewSummary` part "N Kapitalmaßnahme(n)", ISIN-change row with `ToggleButtonGroup` "Als ISIN-Wechsel buchen"/"Verwerfen", hide `ManualEntryButton` when `documentType === "corporate-action"`, `ledgerRejectedMessage` for `"ISIN_CHANGE"` via `isinChangeErrorMessage` (`src/app/_components/corporate-actions/labels.ts:66`).
- Tests to update: `batches.test.ts:777` and `finanzen-zero/tax.test.ts:82` (old reason / FAILED expectation for `isin-change.txt`).

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, new migration -- enum value `CORPORATE_ACTION`; rerun `npx prisma generate`.
- `src/modules/import/proposal.ts`, `parsers/registry.ts`, `parsers/link.ts` (+ `registry.test.ts`, `link.test.ts`) -- contract, outcomes, passthrough, invalid combinations.
- `src/modules/import/parsers/finanzen-zero/corporate-action.ts`, `reasons.ts` (+ new `corporate-action.test.ts`, update `tax.test.ts`) -- every matrix parser row through `parseDocument("FINANZEN_ZERO", …)`; failure variants by string replacement on `isin-change.txt`.
- `src/modules/import/review.ts` (+ `review.test.ts`) -- statuses, classification, counts.
- `src/modules/import/batches.ts` (+ `batches.test.ts`) -- storage, review, decisions, booking; DB tests "already recorded" (pre-recorded via `recordIsinChange`, file shows recorded, nothing to book) and "book now" (BUY of old ISIN booked first, then the upload books the change; position moves to the new ISIN), plus the corporate-action FAILED item's documentType.
- `src/app/_components/import/labels.ts`, `ImportReview.tsx` (+ `labels.test.ts`, `ImportReview.dom.test.tsx`) -- chip, summary, row text, toggle, "Bereits erfasst", no "Manuell erfassen" for corporate-action failures, rejection message.

**Acceptance Criteria:**
- Given a FINANZEN_ZERO batch with `isin-change.txt` and no recorded change, when I open the review, then the file shows chip "Kapitalmaßnahme", "ISIN-Wechsel DE0007236101 → DE000ENER6Y0, 12 St. am 13.08.2026" with "Als ISIN-Wechsel buchen" selected, and "1 Buchung buchen" records the ISIN change (no Transaction) in one booking.
- Given the same change already recorded, when I open the review, then the file shows "Bereits erfasst" without actions and it is not counted in "N Buchungen buchen".
- Given an unreadable corporate-action notice, when reviewed, then it is "fehlgeschlagen" with the "Position → Corporate Action" reason and no "Manuell erfassen" button.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 30 findings — high 0, medium 0, low 19, false 5, maybe-false 6
- findings:
  - `[low]` `[reject]` (blind) Parser throw / registry-rejected isinChange stores FAILED without the corporate-action mark → "Manuell erfassen" — the parser pre-validates with the same schema, so INVALID_OUTPUT is unreachable; a throw from plain regexes is theoretical; marking per entry adds a branch.
  - `[low]` `[reject]` (blind) Discarding the first copy of a doubled change leaves the second as duplicate, nothing booked — the user discarded it explicitly and can switch the first copy back to book; no dead end.
  - `[low]` `[patch]` (blind) Sibling-duplicate key ignores quantities, a corrected notice is dropped silently — key now includes both quantities (review.test.ts case added); conflicting notices are both bookable and the ledger names the conflict.
  - `[low]` `[reject]` (blind) A different change of the old Security on the same date is shown unique and fails the whole booking — the rejection names the file and the reason, the user discards it; rare and a fix adds a new review state.
  - `[low]` `[reject]` (blind) Old ISIN not held: booking creates two Securities and a global change — a notice arrives only for held securities; the spec accepts ensureSecurity for both ISINs.
  - `[low]` `[reject]` (blind) /import list counts the change as "erkannt" while the review lists "Kapitalmaßnahme" — cosmetic count difference between two screens; a separate count adds a field to OpenImportBatch.
  - `[maybe-false]` `[reject]` (blind) Parser does not cross-check Verhältnis, page-1 ISINs/STK or depot numbers — a garbled extraction that still matches both exact block patterns is unlikely; if true, the row text shows the values before booking (low).
  - `[maybe-false]` `[reject]` (blind) NOT_PLAIN matches case-insensitively anywhere (e.g. "zu Gunsten Ihres Depots") — the real-layout fixture has no such wording; a false positive fails safely to the Corporate Action hint (low); settled by a second real notice.
  - `[low]` `[patch]` (blind) AD-8 same-date ordering untested — batches.test.ts now books a new-ISIN SELL on the change date uploaded before the notice; succeeds only with the change first.
  - `[low]` `[reject]` (blind) "corporate-action" literal in three places can drift — client component cannot import the runtime constant; tests pin both the stored type and the UI check.
  - `[low]` `[reject]` (blind) decideProposal stores decisions for recorded/duplicate changes — same behavior as duplicate Transaction proposals (story 5.3); the stored decision is ignored while not unique.
  - `[low]` `[patch]` (blind) DOM tests miss a BOOKED batch with an ISIN change — added (chip and text shown, no buttons, no note).
  - `[low]` `[reject]` (blind) Two private functions named readIsinChange — module-private in different files; no named harm.
  - `[low]` `[patch]` (edge) Duplicate key ignores quantities — same entry as the blind quantity row.
  - `[low]` `[reject]` (edge) Discarded earlier copy leaves duplicate unbooked — same as blind row.
  - `[low]` `[reject]` (edge) Old ISIN not stored creates orphan Security — same as blind row.
  - `[low]` `[patch]` (edge) New Security asset type guessed from its name (ETF successor as STOCK) — booking now copies the old Security's asset type when it exists; test asserts ETF → ETF.
  - `[low]` `[patch]` (edge) BOOKED batch shows "Bereits erfasst" for its own booked change — the note shows only while the batch is open, like Transaction notes.
  - `[maybe-false]` `[reject]` (edge) NOT_PLAIN too broad — same as blind row.
  - `[maybe-false]` `[reject]` (edge) Chained same-date changes A→B, B→C in reversed file order — no such notice pair is known; if real it fails at the holding guard or books per file order (low).
  - `[maybe-false]` `[reject]` (edge) "Moves zero units" claim wrong if the old ISIN is repurchased after the change — the old ISIN normally stops trading after an ISIN change; low if true.
  - `[low]` `[patch]` (verification-gap) Same-date ordering untested — same test as the blind row.
  - `[low]` `[patch]` (verification-gap) Read-only batch with an ISIN change untested — same DOM test as the blind row.
  - `[low]` `[patch]` (verification-gap, other) BOOKED batch labels its own change "Bereits erfasst" — same fix as the edge row.
  - `[maybe-false]` `[defer]` (intent) Deutsche Bank/comdirect corporate-action notices still offer "Manuell erfassen" — no parser of those brokers detects corporate actions and no samples exist; recorded in `deferred` (medium, unverified).
  - `[false]` `[reject]` (intent) "Bereits erfasst" should be a duplicate chip — the AC requires the file to show "Bereits erfasst" and not be booked; it does, under the "Kapitalmaßnahme" chip the AC introduces.
  - `[false]` `[reject]` (intent) Change recorded on another date not treated as recorded — the AC defines recorded as same old and new Security and same date.
  - `[false]` `[reject]` (intent) A real-PDF check could be an operator action — no AC requires a real document; repo policy forbids real documents.
  - `[false]` `[reject]` (intent) recordBatch is not "the existing ledger ISIN-change service" — recordBatch's isin-change entry calls `recordIsinChange` (src/modules/ledger/batch.ts).
  - `[false]` `[reject]` (intent) Server action path for decisions on corporate-action files untested / work uncommitted — the action is an unchanged passthrough to the tested decideProposal; finalization commits the work.

## Design Notes

"One click" = the ISIN change behaves like a unique proposal: default booked, discardable, written by the batch's "N Buchungen buchen" in the same `recordBatch` transaction as the trades — so a BUY of the old ISIN in the same upload is booked before the change and a later SELL of the new ISIN after it. The page-1 field order of the Baader notice is scrambled by extraction (the new name floats after the second "Nominale"), so names, quantities and ISINs come from the clean page-2 "Fortsetzung" blocks and only the dates from the page-1 "per" lines; a notice without page 2 fails safely to the Corporate Action hint. "Already recorded" follows the AC literally (same Securities and date); a change recorded on another date is not flagged — booking it again moves zero units because the old holding is already gone.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` (throwaway `DATABASE_URL`) -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** A readable finanzen.net zero "Obligatorischer Umtausch" (exactly one Ausbuchung and one Einbuchung, same "per" date, different ISINs, no cash or remainder) becomes an ISIN-change proposal stored as the new item status `CORPORATE_ACTION`. The review shows chip "Kapitalmaßnahme" and "ISIN-Wechsel <old> → <new>, <qty> St. am <date>"; an already recorded change shows "Bereits erfasst" and is not booked, otherwise "Als ISIN-Wechsel buchen" (default) books it as a `recordBatch` isin-change entry in the same batch booking (ISIN changes before Transactions of the same date). Unreadable corporate-action notices fail with "Kapitalmaßnahme bitte in der Position unter „Corporate Action“ erfassen.", are stored with document type `corporate-action` and never offer "Manuell erfassen".

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261027100000_import_corporate_action/migration.sql` — enum value `CORPORATE_ACTION` (comment-only migration).
- `src/modules/import/proposal.ts` — `isinChangeProposalSchema`, `ParsedDocument.isinChange`, `ParseError.corporateAction`.
- `src/modules/import/parsers/registry.ts`, `parsers/link.ts` (+ tests) — `CORPORATE_ACTION` outcome, corporate-action FAILED marker, passthrough.
- `src/modules/import/parsers/finanzen-zero/corporate-action.ts`, `reasons.ts` (+ new `corporate-action.test.ts`, `tax.test.ts`) — ISIN-change reading and the new reason.
- `src/modules/import/review.ts` (+ test) — statuses, `classifyIsinChanges`, counts.
- `src/modules/import/batches.ts`, `index.ts` (+ `batches.test.ts`) — storage, review view, decisions, booking, asset type carried from the old Security.
- `src/app/_components/import/labels.ts`, `ImportReview.tsx` (+ tests) — chip, summary, ISIN-change row and toggle, no manual entry for corporate actions, rejection message.

**Review:** 30 findings (high 0, medium 0, low 19, false 5, maybe-false 6). Patched (all low): duplicate key includes quantities; new Security takes the old Security's asset type; notes hidden on read-only batches; tests for same-date ordering and a BOOKED batch with an ISIN change. Deferred: Deutsche Bank/comdirect corporate-action notices not detected (medium, unverified). Rejected with reasons in the Review Triage Log: unreachable parser-failure marker, discarded first copy, conflicting recorded change, unheld old ISIN, list-vs-review counts, missing cross-checks, broad cash guard, literal document type, decisions on non-bookable changes, duplicate function names, chained changes, repurchase claim, and five false intent readings.

**Follow-up review recommended:** false — first pass patched 0 high and 0 medium entries (5 low entries).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` with a throwaway `DATABASE_URL`: all pass after the patches (170 files, 2355 tests). Every I/O matrix row is covered by passing tests. No manual `npm run dev` upload.

**Residual risks:** only the anonymised `isin-change.txt` layout is known; other real Baader corporate-action layouts fail safely to the Corporate Action hint. A change already recorded on a different date is not flagged. Deutsche Bank/comdirect corporate-action notices are deferred. No human-only acceptance criterion, so no operator actions.
