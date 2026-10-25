---
title: 'Funding for Exports without Cash Rows and Depot Deletion (story 2-6)'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '688ef076c6065ce96fd284d08506ac5eeeaf7ea0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-25.md'
warnings: ['multiple-goals', 'oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A Parqet export without any `Cash` rows (comdirect/cominvest autosync portfolios) books every buy against cash that was never deposited, so the migrated Cash Account ends deeply negative (real case: about −26.000 €). A Depot with Transactions can neither be archived nor deleted, so a failed migration cannot be redone.

**Approach:** For cash-less exports the reader inserts minimal same-day funding DEPOSITs computed by one pure core function (walk proposals in `(date, sequence)` order with the `core/cash` running balance; before any proposal that would push it below zero, deposit exactly the shortfall). The preview announces them. Add "Depot löschen" in Settings → Depots: typed-name confirmation, dialog states the Transaction count, deletion runs through the `ledger` service in one DB transaction.

## Boundaries & Constraints

**Always:**
- Cash-less = `read.hasCashRows === false` (no parsed `Cash` TransferIn/TransferOut). Only then is funding applied; files with Cash rows produce byte-identical proposals to today.
- Core function in `src/core/funding.ts`, pure (imports only `./cash`, `./ledger-order`, `./decimal`): input rows in `CashRow` shape, starting balance 0, uses `cashEffect` from `core/cash`; returns, in ledger order, each row that needs funding with the shortfall amount (canonical decimal string, > 0). A row whose effect keeps the balance ≥ 0 gets nothing; sale/dividend proceeds therefore fund later buys.
- Reader: each funding DEPOSIT gets the funded proposal's `date` and `records`, `securityKey/quantity/price/realizedGain` null, `fee`/`tax` "0", new marker `funding: true`; it sits directly before the funded proposal; all proposals are then re-sequenced 1..n. `itemKey` appends `f` for funding proposals (delivery deposits keep `d`).
- Funding DEPOSITs are ordinary DEPOSIT Transactions booked through the existing `recordBatch` path (so they are external inflows for TTWROR/XIRR, AD-10) and take part in duplicate matching like any proposal.
- Preview: `fundingCount` (number of funding proposals); when `hasCashRows` is false the preview shows the note "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt" (N = 1: "1 Einzahlung wird ergänzt"), also for N = 0. The result figures include the funding (cash balance at export date ≥ 0).
- Balance alignment (2.4 `recordOpeningBalance` / `OpeningBalanceForm`) stays available for cash-less files; its offered booking date becomes the export date (`asOf`) instead of the earliest proposal date, so aligning down never makes past cash negative. The date stays editable.
- `ledger.deleteDepot(id, db?)` in `src/modules/ledger/depots.ts`: inside `inTransaction`, deletes all Transactions of the Depot, then the Depot; returns `{ ok: true, deleted: { transactions: n } }` or `{ ok: false, reason: "not-found" }`. Works for active and archived Depots. Securities, CorporateActions (Security-scoped) and everything of other Depots stay untouched. (No import-staging or cache tables exist yet; later stories that add Depot-scoped tables must extend this function — say so in its doc comment.)
- `DepotSummary.transactionCount` (computed on read alongside `cashBalance`) feeds the dialog text.
- Server action `deleteDepotAction(prev, formData)` (`id`, `confirmName`): unauthorized check; `confirmName` (NFC, trimmed) must equal the Depot's name exactly, else `{ ok: false, reason: "name-mismatch" }` and nothing is deleted; on success `revalidatePath("/", "layout")`.
- UI: a delete icon button (`DeleteOutline`, aria-label `„<Name>“ löschen`) on every Depot card in Settings mode (active and archived). Dialog title "Depot löschen", text: `Depot „<Name>“ mit <n> Buchung(en) endgültig löschen? Das kann nicht rückgängig gemacht werden.` (n = 1 "1 Buchung", else "n Buchungen"), a text field labeled `Zum Bestätigen „<Name>“ eingeben`, "Abbrechen" (initial focus) and a `color="error"` "Löschen" button disabled until the typed text matches. Failures show an Alert. German, no optimistic writes, modal depth 1.

**Never:**
- No funding for files with Cash rows; no change to cash pairing, transfer grouping, delivery logic, duplicate matching or reconciliation comparison.
- No new Prisma migration and no schema change (Transactions are deleted explicitly before the Depot).
- No deletion of Securities, CorporateActions or Prices; no "undo"; no deletion outside the ledger service.
- No real export data in fixtures (synthetic ISINs with valid check digits, `*.csv.txt`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First buy | balance 0, BUY 1000 + fee 5 | DEPOSIT 1005 same date, directly before the BUY | — |
| Proceeds fund later buy | balance 208, BUY 400 + fee 2 | no DEPOSIT | — |
| Partial shortfall | balance 208, BUY 600 | DEPOSIT 392 before the BUY; balance after = 0 | — |
| Sell / dividend / refund TAX | positive effect | no DEPOSIT | — |
| FEE or TAX row > balance | negative effect | DEPOSIT for the shortfall | — |
| Delivery in cash-less file | DEPOSIT + BUY delivery pair | no funding (delivery DEPOSIT covers the BUY) | — |
| File with Cash rows | any | proposals unchanged, `fundingCount` 0, no note | — |
| Cash-less file with no negative effect | only sells/dividends | note with N = 0, no DEPOSIT | — |
| Re-run cash-less file into same Depot | funding DEPOSITs already booked | reported as duplicates, skipped by default | — |
| Delete Depot | Depot with 7 Transactions, shared Security | Depot + 7 rows gone; Security, its splits and other Depots' rows stay | — |
| Delete unknown id | — | `not-found` | Alert "Depot nicht gefunden." |
| Typed name differs (case / typo) | — | nothing deleted | `name-mismatch` Alert "Der eingegebene Name stimmt nicht mit dem Depotnamen überein." |

</intent-contract>

## Code Map

- `src/core/cash.ts` -- `cashEffect`, `CashRow`; `src/core/ledger-order.ts` `compareLedgerOrder`; `src/core/decimal.ts` `ExactDecimal`, `canonicalDecimal`. Reuse in the new `src/core/funding.ts`. `test/architecture/core-imports.test.ts` forbids non-core imports (core tests use inline rows, no file I/O).
- `src/modules/migration/parqet-reader.ts` -- `TransactionProposal` (:22, add `funding?: true`), proposals built at the end (`pending.sort` … `proposals = pending.map(... sequence: index + 1)` ~:603); `hasCashRows: cashRows.length > 0` (:707). Insert funding after sequencing when `cashRows.length === 0`, then re-sequence.
- `src/modules/migration/decisions.ts:73` `itemKey` -- add `f` suffix for `funding`.
- `src/modules/migration/preview.ts` -- `ParqetPreview` (:73; add `fundingCount`), built ~:270; figures use `read.proposals` (funding included automatically).
- `src/modules/migration/confirm.ts:406` -- `summary.openingBalance.date` currently `read.proposals[0]?.date ?? asOf` → `asOf`. Booking loop over `read.proposals` (group 2) needs no change.
- `src/app/_components/migration/ParqetMigrationWizard.tsx` -- `ParqetPreviewView` sections (`Section` :47, "Einlieferungen" ~:183, "Ergebnis laut Datei" :245): add the funding note (an `Alert severity="info"` or body text near the result section) when `!preview.hasCashRows`; label helper in `src/app/_components/migration/labels.ts` (`fundingNote(n)`).
- `src/app/_components/migration/OpeningBalanceForm.tsx` -- default date from `offer.date` (now the export date); no other change.
- `src/modules/ledger/depots.ts` -- `DepotSummary`/`toSummary` (add `transactionCount: rows.length`), `inTransaction`, add `deleteDepot`; export it and `DeleteDepotResult` from `src/modules/ledger/index.ts`. Prisma `Transaction.depot` relation has no cascade.
- `src/app/_actions/depots.ts` -- add `deleteDepotAction` + `DeleteDepotActionState`, same patterns as `archiveDepotAction`.
- `src/app/_components/depots/DepotDialogs.tsx` -- `DepotDialog`, `useDialog`, `ArchiveForm`/`ArchiveDepotButton` as template for `DeleteDepotButton`; `labels.ts` `DEPOT_ERROR_MESSAGES` (add `name-mismatch`), add `deleteDepotQuestion(name, n)`.
- `src/app/_components/depots/DepotList.tsx` `SettingsActions` -- add the delete button for active and archived Depots.
- Tests/fixtures: `test/fixtures/parqet/synthetic-export-no-cash.csv.txt` (Buy 15×100 on 2024-02-01, Sell 3×100 on 2024-05-02 → now funding 1500, cash 300); its expectations in `src/modules/migration/confirm.test.ts:481-503` (`ledgerBalance "-1200"`, opening date), `ParqetMigrationWizard.test.tsx:56,220-237`, `src/app/_actions/migration.test.ts:194-222` must be updated. Depot tests: `src/modules/ledger/depots.test.ts` (`toEqual` on summaries needs `transactionCount`), `src/app/_actions/depots.test.ts`, `src/app/(app)/settings/page.test.tsx` (static render via `test/helpers/render-text.ts`), `src/app/_components/depots/labels.test.ts`. Temp DB: `test/helpers/test-db.ts`.

## Tasks & Acceptance

**Execution:**
- `src/core/funding.ts` (+ `funding.test.ts`) -- `fundingShortfalls<T extends CashRow>(rows): { row: T; amount: string }[]`; tests with inline synthetic rows (buys, sells, a dividend, fees, a TAX refund): applying the deposits never yields a negative running balance, the sum equals `max(0, −min prefix balance)` of the unfunded rows, matrix rows 1–5 -- the pure core function.
- `src/modules/migration/parqet-reader.ts` (+ test) -- funding insertion for cash-less files, `funding: true`, re-sequencing; tests: cash-less file gets DEPOSITs before the right proposals, file with Cash rows unchanged, delivery pair unfunded.
- `src/modules/migration/decisions.ts` (+ test) -- `itemKey` `f` suffix.
- `src/modules/migration/preview.ts` (+ test) -- `fundingCount`.
- `src/modules/migration/confirm.ts` (+ test) -- opening offer dated `asOf`; update existing no-cash tests (cash 300, alignment).
- `test/fixtures/parqet/synthetic-export-cashless.csv.txt` + test in `src/modules/migration/confirm.test.ts` -- no Cash rows: 2024-01-10 Buy A 10×100 fee 5; 2024-02-15 Buy B 20×50; 2024-03-20 Dividend A 30 tax 5; 2024-04-10 Sell A 5×120 fee 5 tax 10 (`realizedgains` consistent with FIFO); 2024-05-05 Buy C 4×100 fee 2; 2024-06-01 Buy B 10×60. Preview: `fundingCount` 3. Confirm into empty Depot: DEPOSITs 1005 (2024-01-10), 1000 (2024-02-15), 392 (2024-06-01); every `listCashBookings` balance ≥ 0; cash at export date 0; no position/invested/sale mismatch; then `recordOpeningBalance` to "150" books a DEPOSIT 150 dated the export date -- end-to-end acceptance.
- `src/app/_components/migration/labels.ts`, `ParqetMigrationWizard.tsx` (+ tests) -- funding note rendered for cash-less preview (plural and singular label test), absent with Cash rows.
- `src/modules/ledger/depots.ts`, `index.ts` (+ tests) -- `transactionCount`, `deleteDepot`; test: Depot with rows in two Depots sharing a Security with a recorded split → only target Depot and its rows gone; archived Depot deletable; `not-found`.
- `src/app/_actions/depots.ts` (+ test) -- `deleteDepotAction`; tests: unauthorized, name-mismatch keeps the Depot, success deletes + revalidates, then the same Parqet file migrates again into a new Depot with the same name (`confirmParqetAction`/`confirmParqetMigration`) without duplicates.
- `src/app/_components/depots/labels.ts`, `DepotDialogs.tsx`, `DepotList.tsx` (+ tests, settings page render) -- delete button per Depot card in Settings (active and archived), dialog text with count, typed confirmation.

**Acceptance Criteria:**
- Given a cash-less Parqet export, when the preview is built, then it shows "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt" and its cash figure is ≥ 0; after "Übernehmen" the Depot's Cash Account never goes negative and holds exactly the minimal funding DEPOSITs.
- Given an export with Cash rows, when previewed and confirmed, then proposals, figures and summary equal today's results (existing tests unchanged apart from the new preview field).
- Given a migrated cash-less Depot, when the alignment form is submitted with the broker's balance, then the final balance at export date equals it.
- Given Settings → Depots, when "Depot löschen" is opened, then the dialog states the Depot's Transaction count and that it cannot be undone, and "Löschen" stays disabled until the exact name is typed; when confirmed, the Depot disappears from the list and its Transactions are gone while shared Securities stay.
- Given a deleted migrated Depot, when the same export is migrated into a newly created Depot, then it books without duplicates and reconciles as before.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 31 findings — high 0, medium 0, low 19, false 12, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) Corrected flag rows (BUY/FEE/TAX) in a cash-less file are not funded — real, but flags are skipped by default and only an explicit manual correction of a rare flag reaches it; the fix needs funding recomputed at confirm time over the booked set (new branch/plumbing).
  - `[low]` `[reject]` (blind) Funding DEPOSIT and its funded proposal have separate duplicate decisions — only when migrating into a non-empty Depot whose rows match one half; a re-run skips both (tested: duplicates 3); coupling decisions adds branches for a rare case.
  - `[low]` `[reject]` (blind) Funding starts from 0 and ignores the target Depot's existing balance — the AC defines the walk over the file's proposals and the flow migrates one file into a fresh Depot; a non-empty target is unusual and would need ledger-aware funding.
  - `[low]` `[reject]` (blind) Re-migrating a longer, different export can book a second funding DEPOSIT with a different amount — the redo flow this story enables is delete + re-migrate; changed history between exports is not a supported re-run case.
  - `[low]` `[reject]` (blind) Negative-cost delivery (tax refund > cost) gets a funding DEPOSIT before its WITHDRAWAL — follows the funding rule literally, adds only the refund amount, and needs a transfer row with a refund larger than its cost (not observed); a fix needs a delivery-specific branch.
  - `[false]` `[reject]` (blind) Preview shows the funding count, not the amount — the AC prescribes exactly the note "N Einzahlungen werden ergänzt", implemented verbatim; the result section shows the resulting cash.
  - `[low]` `[reject]` (blind) Alignment form still lets the user pick an earlier date that makes past cash negative — the date is deliberately editable (2.4 behavior); the default is now the export date; enforcing the invariant adds server validation for an explicit user choice.
  - `[low]` `[reject]` (blind) Name check and deletion are not in one transaction (rename race) — single-user app, needs a rename in another tab within milliseconds; fix widens the ledger API.
  - `[low]` `[reject]` (blind) No success feedback / focus target after delete — same close-and-revalidate pattern as the existing archive dialog; the card disappearing is the feedback.
  - `[low]` `[reject]` (blind) No test that typing the name enables "Löschen" — enablement derives from `deleteConfirmationMatches` (unit-tested incl. NFC/case/typo) and the server re-checks; the repo has no interaction-test tooling (deferred since 2.4).
  - `[low]` `[patch]` (blind) N = 0 matrix row only covered via a hand-modified preview — added a preview test with a real cash-less dividend-only CSV: `hasCashRows` false, `fundingCount` 0, no DEPOSIT.
  - `[false]` `[reject]` (blind) Prices/ISIN changes and "deletable while not archivable" untested — no Price table exists; the ledger test's target Depot and the action test's migrated Depot both hold open Positions (not archivable) and are deleted.
  - `[low]` `[reject]` (edge) Existing-Depot balance ignored by funding — same as the blind finding above.
  - `[low]` `[reject]` (edge) Orphan funding DEPOSIT when only its BUY is a skipped duplicate — same as the blind finding above.
  - `[low]` `[reject]` (edge) Corrected flags not funded — same as the blind finding above.
  - `[low]` `[reject]` (edge) Negative-cost delivery gets funding — same as the blind finding above.
  - `[low]` `[reject]` (edge) Downward alignment at the export date can make later existing rows negative — needs manually booked rows dated after the export date in a freshly migrated Depot; refusing would add a new validation path.
  - `[low]` `[reject]` (edge) Rename race between name check and delete — same as the blind finding above.
  - `[low]` `[reject]` (edge, claim) "Never negative / exactly minimal funding" fails for non-empty targets, skipped duplicates, corrected flags — union of the rejected rows above; holds for the supported flow (fresh Depot, default decisions), which the end-to-end test proves.
  - `[low]` `[reject]` (edge, claim) "Delivery pair unfunded" fails for negative-cost deliveries — same as the delivery row above.
  - `[low]` `[patch]` (verification-gap) Server-side NFC normalization in `deleteDepotAction` untested — added an action test deleting "München" with an NFD-typed name; verified it fails without `.normalize("NFC")`.
  - `[low]` `[reject]` (verification-gap, other) Corrected flags not funded — same as the blind finding above.
  - `[low]` `[reject]` (verification-gap, other) Funding DEPOSIT not following its BUY's duplicate decision — same as the blind finding above.
  - `[false]` `[reject]` (intent) Real-data outcome should make this story awaiting-operator — the approved change proposal assigns the real cominvest re-migration and balance alignment to Story 2.4's operator verification (epic context, addendum handoff); all 2.6 ACs are checkable with synthetic fixtures.
  - `[false]` `[reject]` (intent) "Never negative" only tested for an empty Depot with default decisions — that is the AC's scenario (migrate into a newly created Depot); edge variants triaged above.
  - `[false]` `[reject]` (intent) External-inflow treatment only by construction — AD-10 classifies every DEPOSIT as an external flow; funding rows are plain DEPOSITs and return metrics are Epic 4.
  - `[false]` `[reject]` (intent) Staging/cache/Price tables absent; orphan Securities kept — no such tables exist (doc comment obliges later stories); the AC lists what is deleted and Securities are not in it (Design Notes).
  - `[false]` `[reject]` (intent) Typed-name interaction not exercised — see the interaction-test row above; logic and server check are tested.
  - `[false]` `[reject]` (intent) Re-migration tested at action/module level, not via the wizard — the wizard calls exactly these server actions.
  - `[false]` `[reject]` (intent) Core test uses inline rows instead of the fixture file — core purity forbids file I/O; inline synthetic rows mirror the fixture, which is used end-to-end at module level.
  - `[false]` `[reject]` (intent) 2.4/2.5 tests changed for cash-less inputs — the AC protects only files with Cash rows; cash-less files are meant to change.

## Design Notes

Funding walks the reader's proposals in their final ledger order, so same-day ordering follows the file (a sale later that day does not fund an earlier buy) — exactly the AC's `(date, sequence)` rule. Funding records reuse the funded proposal's records so a funding DEPOSIT is traceable to the buy it enabled; the `f` key suffix keeps item keys unique.

Alignment date: with funding the ledger balance at export date is the leftover of proceeds; a broker balance below it books a WITHDRAWAL, which dated at the first proposal would push early history negative. Dating it at the export date keeps the "never negative" invariant (broker balances are ≥ 0).

Security retention on delete: the AC lists what is deleted (Depot, Transactions, staging, caches); Securities are not in that list, and keeping them keeps Security-scoped splits/ISIN changes valid, so a re-migration sees them as "bereits erfasst" and existing Securities keep their (possibly corrected) type.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary.** Parqet exports without any Cash rows now get minimal same-day funding DEPOSITs from a pure core function (`fundingShortfalls`): walking proposals in `(date, sequence)` order, each proposal that would push cash below zero is preceded by a DEPOSIT of exactly the shortfall; proceeds fund later buys. The preview shows "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt"; files with Cash rows are unchanged. The balance-alignment offer is dated at the export date. Settings → Depots gains "Depot löschen" (active and archived): the dialog states the Transaction count and irreversibility, "Löschen" is enabled only for the exact typed name (re-checked server-side), and `ledger.deleteDepot` removes the Depot and its Transactions in one DB transaction while Securities and corporate actions stay.

**Files changed.**
- `src/core/funding.ts` (+ test) — pure funding calculation.
- `src/modules/migration/parqet-reader.ts`, `decisions.ts`, `preview.ts`, `confirm.ts` (+ tests) — funding insertion (`funding: true`, `f` key suffix), `fundingCount`, alignment dated at export date.
- `src/app/_components/migration/ParqetMigrationWizard.tsx`, `labels.ts` (+ tests) — funding note.
- `src/modules/ledger/depots.ts`, `index.ts` (+ tests) — `transactionCount`, `deleteDepot`.
- `src/app/_actions/depots.ts` (+ test) — `deleteDepotAction` with typed-name check.
- `src/app/_components/depots/DepotDialogs.tsx`, `DepotList.tsx`, `labels.ts` (+ tests, settings page test) — delete button and dialog.
- `test/fixtures/parqet/synthetic-export-cashless.csv.txt` — synthetic cash-less fixture (buys, sell, dividend, fees).
- `_bmad-output/implementation-artifacts/epic-2-context.md` — recompiled (planning docs had changed).

**Review findings.** 31 findings: 2 patches applied (both low test gaps: NFC delete-action test, real cash-less N = 0 preview test), 0 deferred, 17 low rejected and 12 false — reasons per row in the Review Triage Log.

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 0, low 2.

**Verification.** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (64 files, 1045 tests) after the patches. Every I/O matrix row is covered by a passing test.

**Residual risks.** Funding is computed from the file alone: migrating a cash-less file into a non-empty Depot, skipping only one half of a funding/buy duplicate pair, or booking corrected flags can over- or under-fund (rejected as unusual). A negative-cost delivery gets a small funding DEPOSIT. The real cominvest re-migration (delete Depot, recreate, migrate, align balance) is owed as Story 2.4's operator verification. The delete dialog's typing interaction is covered only by static render and helper tests.
