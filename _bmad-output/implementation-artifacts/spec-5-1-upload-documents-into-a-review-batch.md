---
title: 'Upload Documents into a Review Batch'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '455947866d585063dcd5e452f89282e9f137caef'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      No test covers that a BOOKED import batch cannot be discarded and keeps its rows and files.
    evidence: |-
      discardImportBatch filters status OPEN (src/modules/import/batches.ts) and ImportBatchView hides Verwerfen for non-OPEN batches, but BOOKED is unreachable until story 5.3 adds booking; test there.
    location: >-
      src/modules/import/batches.ts discardImportBatch
    severity: low
---

<intent-contract>

## Intent

**Problem:** There is no way to bring broker PDFs into the app; `/import` is a placeholder. Epic 5 needs a staging area (AD-4) that collects uploaded documents per Depot, extracts their text and runs them through a broker parser registry — without touching the ledger.

**Approach:** New `import` module owning `ImportBatch`/`ImportItem` (Prisma migration), PDF files under `<DATA_DIR>/imports`, `unpdf` text extraction, and a parser registry contract `(text) → TransactionProposal[] | ParseError` (empty in production for 5.1; stub-tested). UI: upload card + open-batch list on `/import`, batch view on `/import/[batchId]` with discard, "Dokumente importieren" on Depot detail, open-batch count on the Import nav entry.

## Boundaries & Constraints

**Always:**
- One batch per upload (one non-archived Depot), one ImportItem per file in upload order, status `PARSED` or `FAILED` with a German reason; unrecognized layout reason is exactly `Layout nicht erkannt. Buchung bitte manuell erfassen.`
- Parser lookup: registry keyed by `Broker` → list of `{ documentType, parse }`; parsers are tried in order, the first that does not return `{ error: "unrecognized" }` decides. Parser output is zod-validated (AD-14 shape: type BUY/SELL/DIVIDEND/FEE/TAX, `date` YYYY-MM-DD, `isin` valid, optional `name`, decimal strings via `decimal.js`, `amount ≥ 0`, `fee ≥ 0`, signed `tax`, `quantity`/`price` only and required on BUY/SELL). Invalid output, a thrown parser, or an empty proposal list → `FAILED` with a specific reason, never partial proposals.
- SHA-256 of the file bytes stored per item; a hash that exists on another item (any stored batch, or earlier in the same upload) sets `duplicateUpload` → warning "Diese Datei wurde bereits hochgeladen." — never blocks.
- Batches persist (status `OPEN`) until discarded; discard deletes the batch rows and its PDF directory. Import's only writes are `ImportBatch`/`ImportItem` and files under `<DATA_DIR>/imports/<batchId>/`; stored file names are generated (`<itemId>.pdf`) and re-validated on use (no traversal).
- Limits: ≤ 50 files, ≤ 5 MB per file (larger → item `FAILED` "Datei zu groß (max. 5 MB)."), ≤ 20 MB per upload (else rejected); `next.config.ts` server-action `bodySizeLimit` raised to `25mb`. Non-PDF bytes (no `%PDF-` header) → `FAILED` "Keine PDF-Datei."; extraction failure → `FAILED` "Text konnte nicht gelesen werden."
- Server actions check the session first, call module services only, revalidate `/` layout after writes. Never log amounts or document text.

**Never:** No Transaction, Security, Price or logo writes; no booking, inline editing, duplicate matching against the ledger or "Manuell erfassen" (story 5.3); no real broker parsers (5.2/5.4); no committed PDFs or real documents; no `.gitignore` exceptions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | 3 PDFs, active Depot | 1 OPEN batch, 3 items in order, redirect to `/import/<id>`; nav count +1 | — |
| Unrecognized | PDF no parser claims | item FAILED, "Layout nicht erkannt. Buchung bitte manuell erfassen." | — |
| Stub parses | registry with stub parser | item PARSED, proposals stored, documentType set | — |
| Re-upload | same bytes uploaded again | new item flagged `duplicateUpload` with warning | not blocked |
| Bad file | text file renamed `.pdf` / 6 MB PDF | FAILED "Keine PDF-Datei." / "Datei zu groß (max. 5 MB)." | other files unaffected |
| Rejected upload | no files / archived or unknown Depot / >50 files / >20 MB | no batch created | typed `{ ok:false, reason }` shown as German Alert |
| Discard | open batch | rows and `<DATA_DIR>/imports/<id>` removed, redirect `/import` | unknown id → `not-found` |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add enums `ImportBatchStatus { OPEN BOOKED }`, `ImportItemStatus { PARSED FAILED }`; models `ImportBatch` (id, depotId → Depot `onDelete: Cascade`, status, createdAt UTC ISO string, items) and `ImportItem` (id, batchId → batch Cascade, position Int, fileName, fileHash (indexed), storedFile String?, status, documentType String?, reason String?, proposals String JSON default "[]"). Comment "Owned by the import module (AD-4)". Add `importBatches ImportBatch[]` on Depot. New migration folder; never edit old ones.
- `src/modules/logos/storage.ts` -- pattern for DATA_DIR resolution, safe file names, `rmSync` handling; import gets its own `src/modules/import/storage.ts` (`importsDir(env)` = `<DATA_DIR or ~/.depotmanagement/data>/imports`) — do not import logos internals (AD-2).
- `src/modules/logos/logos.ts:16-55` -- `XDb = Prisma.TransactionClient`, `deps` injection (`env`, `now`), `inTransaction` pattern to mirror.
- `src/modules/ledger/index.ts` -- `getDepot(id)` returns `DepotSummary` (`archived`, `broker`, `name`); `isinSchema` reusable for proposal ISIN validation; the only allowed ledger reads.
- `src/modules/migration/limits.ts` + `test/architecture/next-config.test.ts` -- size-limit constant pattern; extend the test to assert limit > `IMPORT_MAX_BATCH_BYTES`.
- `src/app/_actions/migration.ts` -- upload server-action pattern (zod form parsing, `getSession`, typed failures); `src/app/_actions/logos.test.ts` -- action test pattern (migrated singleton DB, temp `DATA_DIR`, mocked `next/headers`/`next/cache`).
- `src/app/(app)/layout.tsx` + `layout.test.tsx` -- fetch open-batch count (failure → 0, logged by error name) and pass to `AppShell`; test mocks `@/modules/import`.
- `src/app/_components/AppShell.tsx`, `MoreLinks.tsx`, `navigation.ts` -- show count on drawer "Import" and "Mehr" bottom item (MUI `Badge`), and on the Import row of `MoreLinks` (more page reads the count).
- `src/app/(app)/depots/[id]/page.tsx` -- add "Dokumente importieren" link (`/import?depot=<id>`) next to "Neue Buchung" and in the empty state; hidden when archived.
- `src/app/(app)/import/page.tsx` -- placeholder to replace. `src/core/format.ts` -- German formatting for dates/amounts in the proposal table.
- `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/mockups/import-review.html` + `DESIGN.md` `status-chip-import` tokens -- chip colors (erkannt gain-soft/gain, fehlgeschlagen loss-soft/loss).

## Tasks & Acceptance

**Execution:**
- `package.json` -- `npm install unpdf@1.9.1 --save-exact` -- AD stack pin.
- `prisma/schema.prisma`, `prisma/migrations/<ts>_add_import_staging/migration.sql` -- models above; run `npx prisma generate`.
- `src/modules/import/proposal.ts` -- `TransactionProposal` type + zod schema, `ParseError` (`{ error: "unrecognized" } | { error: "invalid"; message: string }`), `Parser` type -- the registry contract.
- `src/modules/import/parsers/registry.ts` -- `ParserRegistry = Record<Broker, ParserEntry[]>`, production `PARSERS` (all brokers `[]`), `parseDocument(broker, text, registry)` → `{ status: "PARSED", documentType, proposals } | { status: "FAILED", reason }` -- single decision point.
- `src/modules/import/extract.ts` -- `isPdf(bytes)`, `extractPdfText(bytes)` via `unpdf` (`extractText(..., { mergePages: true })`).
- `src/modules/import/storage.ts` -- `importsDir`, write/delete batch dir with validated names.
- `src/modules/import/batches.ts` -- `createImportBatch(depotId, files: {name, bytes}[], deps?)`, `getImportBatch(id)`, `listOpenBatches()`, `countOpenBatches()`, `discardImportBatch(id, deps?)`; limits constants in `src/modules/import/limits.ts`; `index.ts` exports the public API.
- `src/app/_actions/import.ts` -- `uploadDocumentsAction` (useActionState; redirect to batch on success) and `discardImportBatchAction`.
- `src/app/_components/import/` -- `UploadDropzone` (drag-and-drop + "Dateien auswählen" picker, multiple `.pdf`, Depot select of non-archived Depots, client-side total-size check, ≥ 44 px targets), `ImportBatchView` (header Depot/Broker, "N Dateien · X erkannt · Y fehlgeschlagen", one card per file: chip, reason, re-upload warning, proposal table type/date/ISIN/quantity/amount/fee/tax), `DiscardBatchButton` (confirm dialog), `labels.ts`.
- `src/app/(app)/import/page.tsx`, `src/app/(app)/import/[batchId]/page.tsx` -- upload card (Depot preselected from `?depot=`) + open-batch list ("Keine offenen Importe." when empty); batch page `notFound()` on unknown id.
- Depot page, layout, AppShell, MoreLinks, more page, `next.config.ts` -- per Code Map.
- `src/app/_actions/depots.ts` -- `deleteDepotAction` calls `discardImportBatchesOfDepot(id)` (exported from `import`) before `deleteDepot` -- no orphaned PDF directories.
- Tests: `src/modules/import/parsers/registry.test.ts` (stub parser: parsed, unrecognized message, invalid output, throw, empty list, first-claiming parser wins), `proposal.test.ts`, `extract.test.ts` (real `unpdf` on a minimal PDF built in-test as bytes; non-PDF), `batches.test.ts` (test DB, temp DATA_DIR, injected extractor/registry: matrix rows, no Transaction/Security rows written, files deleted on discard), `src/app/_actions/import.test.ts`, DOM test for `UploadDropzone`, updated layout/navigation/next-config tests.

**Acceptance Criteria:**
- Given a non-archived Depot, when I click "Dokumente importieren" on its detail page, then `/import` opens with that Depot preselected, and dropping or picking several PDFs and submitting creates one batch and shows its batch view.
- Given open batches, when I reload or log in again, then they are listed on `/import` and the Import nav entry (drawer; "Mehr" on phones) shows their count; after "Verwerfen" the count drops and the batch's PDFs are gone from disk.
- Given any upload, when it completes, then the Transaction, Security, Price and SecurityLogo tables are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 39 findings — high 0, medium 10, low 16, false 11, maybe-false 2
- findings:
  - `[medium]` `[patch]` (blind) Thrown upload/discard action reaches the error boundary; ACTION_FAILED_MESSAGE unused — both components now catch (with `unstable_rethrow` for redirects) and show ACTION_FAILED_MESSAGE; DOM tests added.
  - `[low]` `[reject]` (blind) Stale server error alert stays after changing Depot/selection — only reachable after rare server-side rejections; fix adds state.
  - `[low]` `[patch]` (blind) Upload action comment wrongly claims checks run before the body is read; global 25 MB body limit — comment corrected; the global limit is accepted for a single-user, login-gated app (route-handler rework not worth it).
  - `[medium]` `[patch]` (blind) File writes and ~150 queries inside a transaction with Prisma's default 5 s timeout — explicit 120 s timeout and maxWait 10 s added.
  - `[low]` `[reject]` (blind) No reconciliation of orphaned PDFs after a crash — needs a sweep job; crash-only path.
  - `[low]` `[reject]` (blind) getDepot/listDepots over-fetch summaries — single-user performance only; fix needs a new ledger API.
  - `[maybe-false]` `[reject]` (blind) No per-file extraction timeout — would need a pathological PDF to show a hang; if true only low (user's own broker documents).
  - `[low]` `[reject]` (blind) Depot delete discards staging before a non-atomic deleteDepot — deleteDepot only fails for not-found, already checked; reorder needs extra id bookkeeping.
  - `[low]` `[reject]` (blind) Archiving a Depot with open batches leaves them open — discard still works; booking into an archived Depot is rejected by story 5.3.
  - `[false]` `[reject]` (blind) Hash check global / AD-4 `duplicate` status missing — AD-4 `duplicate` is the ledger-duplicate classification owned by 5.3; the hash only warns, as specified.
  - `[low]` `[patch]` (blind) `.env.example` DATA_DIR comment omits import PDFs; DATA_DIR logic duplicated — comment updated; duplication kept to respect AD-2 module boundaries.
  - `[low]` `[reject]` (blind) Client selection gaps (dropped non-PDFs, no per-file size check, no single-file removal, double-add) — server fails such items per file; UI conveniences.
  - `[low]` `[reject]` (blind) Unknown `?depot=` silently preselects the first Depot — the visible Depot select names the target.
  - `[low]` `[reject]` (blind) Batch view lacks back link, booked state, "Manuell erfassen" — "Manuell erfassen" and booking belong to story 5.3; navigation via drawer exists.
  - `[medium]` `[patch]` (blind) Test gaps: rollback cleanup, rendered badge, archived batch — rollback and badge tests added (grouped with verification-gap rows); archived part rejected as above.
  - `[false]` `[reject]` (blind) depots.test.ts leaks DATA_DIR — `afterEach` restores `process.env = { ...savedEnv }` (depots.test.ts:54).
  - `[medium]` `[patch]` (edge) Transaction timeout on slow disk — same fix as the blind timeout row.
  - `[medium]` `[patch]` (edge) createImportBatch throw not mapped in the action — handled client-side with the existing `action-failed` pattern.
  - `[medium]` `[patch]` (edge) UploadDropzone has no catch — fixed as above.
  - `[medium]` `[patch]` (edge) DiscardBatchButton has no catch — fixed as above.
  - `[maybe-false]` `[reject]` (edge) pdf.js may hang on a crafted PDF — unproven; if true only low.
  - `[low]` `[reject]` (edge) Stale server error alert — same as blind row.
  - `[low]` `[reject]` (edge) Upload racing a Depot delete orphans a directory — single-user, near-impossible timing.
  - `[low]` `[reject]` (edge) Concurrent identical uploads miss the re-upload flag — single user; warning-only feature.
  - `[low]` `[patch]` (edge) 255-char truncation can split a surrogate pair — now truncates by code points; test added.
  - `[false]` `[reject]` (edge) DATA_DIR env leak in depots.test.ts — restored in afterEach.
  - `[medium]` `[patch]` (verification-gap) Open-import badge/chip never rendered in a test — AppShell.dom.test.tsx and more/page.test.tsx added.
  - `[medium]` `[patch]` (verification-gap) Rollback file cleanup untested — batches.test.ts case with a failing second update added.
  - `[low]` `[defer]` (verification-gap) Discard of a BOOKED batch untested — BOOKED is unreachable until story 5.3; deferred.
  - `[false]` `[reject]` (intent) PDFs not deleted on booking — no booking path exists in 5.1; 5.3 owns booking.
  - `[false]` `[reject]` (intent) Registry keyed by Broker with documentType on entries — entries are registered per Broker and document type; lookup by type needs detection, which the parsers do.
  - `[false]` `[reject]` (intent) Item status lacks `duplicate` — see blind hash row.
  - `[false]` `[reject]` (intent) Hash memory lost after discard — a discarded file was never imported.
  - `[low]` `[reject]` (intent) UI journey only tested piecewise — no e2e harness in the project; each hop is tested.
  - `[medium]` `[patch]` (intent) Nav count tested only via helpers/props — same as verification-gap badge row.
  - `[false]` `[reject]` (intent) Persistence across sessions not exercised — batches are DB rows read on every request; list and count tests cover it.
  - `[false]` `[reject]` (intent) unpdf not run on real documents — real PDFs must not be committed; real unpdf runs on an in-test PDF.
  - `[false]` `[reject]` (intent) Production registry empty so every upload fails — required by the AC (stub-tested contract; parsers come in 5.2/5.4).
  - `[false]` `[reject]` (intent) Ledger untouched only checked at module level — the action delegates to the same service; table-count test covers it.

### 2026-10-26 — Review pass
- verdicts: 28 findings — high 0, medium 4, low 18, false 5, maybe-false 1
- findings:
  - `[medium]` `[patch]` (blind) Proposal schema accepts FEE/TAX/DIVIDEND shapes the ledger rejects (FEE with amount, TAX with tax 0, zero dividend) — superRefine now enforces AD-14 per-type rules matching `validateTransaction`; proposal tests added.
  - `[medium]` `[patch]` (blind) `isin` required on FEE/TAX although AD-14 makes the Security optional there — same root cause as above; `isin` optional, required only for BUY/SELL/DIVIDEND; ImportBatchView shows "–" when absent.
  - `[low]` `[reject]` (blind) `/import` list counts raw status while the batch view downgrades invalid stored proposals — only reachable with corrupted stored JSON ("never expected"); fix needs a shared status helper.
  - `[false]` `[reject]` (blind) Upload transaction holds the SQLite write lock for up to 120 s — extraction runs before the transaction (batches.ts:156-158); inside it only ≤ 20 MB of sync file writes, milliseconds; 120 s is just the upper bound.
  - `[low]` `[reject]` (blind) Limit values hard-coded in German messages instead of built from constants — consistent today; drift only if limits.ts changes, which is rare.
  - `[low]` `[reject]` (blind) finanzen.net zero Depots offered as upload targets — intent allows any non-archived Depot; the result is "Layout nicht erkannt. Buchung bitte manuell erfassen.", which is the manual path the epic prescribes.
  - `[low]` `[reject]` (blind) Proposal table omits price and documentType — columns match the spec's table list; the review UI is reworked in story 5.3.
  - `[low]` `[patch]` (blind) Drop-zone highlight flickers when the pointer moves onto child elements — onDragLeave now ignores leaves whose relatedTarget is inside the zone.
  - `[low]` `[reject]` (blind) Re-upload warning gives no batch/date context — exact text is specified; an enhancement.
  - `[low]` `[patch]` (blind) Typical small selections show "0,0 MB" — formatMegabytes returns "< 0,1 MB" below 0.05 MB; labels and DOM tests updated.
  - `[medium]` `[patch]` (edge) Parser output passes schema but ledger rejects FEE/TAX/DIVIDEND — same entry as the first blind row.
  - `[medium]` `[patch]` (edge) ISIN-less FEE/TAX documents fail as invalid output — same entry as the second blind row.
  - `[maybe-false]` `[reject]` (edge) carried — pdf.js may hang on a crafted PDF — unproven; if true only low (user's own broker documents).
  - `[low]` `[reject]` (edge) Depot archived/deleted between the check and the insert — single-user race; a deleted Depot fails the FK and surfaces as the handled action-failed message.
  - `[false]` `[reject]` (edge) Outer transaction rollback orphans files — no caller passes an outer transaction client; the action uses the root client.
  - `[low]` `[reject]` (edge) carried — Open batch of a later-archived Depot stays listed — discard still works; booking into an archived Depot is rejected by story 5.3.
  - `[low]` `[patch]` (edge) carried — Global 25 MB server-action body limit — accepted for a single-user, login-gated app; no further change.
  - `[low]` `[reject]` (edge) carried — Staging discarded before a non-atomic deleteDepot — deleteDepot only fails for not-found, already checked.
  - `[low]` `[reject]` (edge) Stale discard error alert on dialog reopen — needs a batch discarded in another tab; single user.
  - `[low]` `[patch]` (verification-gap) Stored-proposal fallback reason and PARSED-with-empty-list branch untested — batches.test.ts asserts STORED_PROPOSALS_INVALID_REASON and adds the empty-list case.
  - `[low]` `[reject]` (intent) carried — Nav count +1 only tested piecewise — no e2e harness; each hop (service, layout, AppShell DOM) is tested.
  - `[false]` `[reject]` (intent) Stub parsing only exercised at service level — the production registry is empty by intent ("stub-tested"); the action deliberately takes no registry.
  - `[low]` `[reject]` (intent) Body over 25 MB from a client bypassing the browser check shows "Verbindung fehlgeschlagen" — needs a hand-crafted request; the UI blocks > 20 MB.
  - `[low]` `[patch]` (intent) Traversal re-validation in storage never exercised by a test — new storage.test.ts covers generated names, refused `..` ids/names and ignored invalid delete ids.
  - `[low]` `[reject]` (intent) Empty extracted text (scanned PDF) reads "Layout nicht erkannt" rather than the extraction message — both direct the user to manual entry.
  - `[false]` `[reject]` (intent) carried — Re-upload after discard shows no warning — a discarded file was never imported.
  - `[low]` `[reject]` (intent) carried — Per-file 5 MB limit not checked client-side — server fails the item per file; UI convenience.
  - `[false]` `[reject]` (intent) Depot-delete path changed outside the import surfaces — specified in Tasks (`discardImportBatchesOfDepot` before `deleteDepot`).

## Design Notes

Discarded batches are deleted outright, so the re-upload warning compares against items of stored batches (open now, `BOOKED` after 5.3 keeps rows but deletes files). Depot deletion cascades batch rows; the delete-Depot action should call `discardImportBatchesOfDepot(depotId)` first so no PDF directories are orphaned. `proposals` is JSON TEXT validated with the same zod schema when read. 5.3 adds duplicate/ambiguous classification and booking on top; keep `ImportItemStatus` minimal here.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: Depot detail → "Dokumente importieren" → drop 2 PDFs → batch view shows two "fehlgeschlagen" cards with the layout message; nav badge shows 1; "Verwerfen" removes it.

## Auto Run Result

Status: done

**Summary:** Follow-up review pass of the import staging story (AD-4): `ImportBatch`/`ImportItem` with PDFs under `<DATA_DIR>/imports/<batchId>/`, `unpdf` extraction, zod-validated parser registry contract, re-upload hash warning, discard, `/import` and batch views, nav badge. This pass aligned the proposal contract with AD-14 and the ledger's validation and fixed two UI details.

**Files changed (this pass):**
- `src/modules/import/proposal.ts` — per-type AD-14 rules (DIVIDEND amount > 0; FEE fee > 0, amount/tax 0; TAX tax ≠ 0, amount/fee 0); `isin` optional only on FEE/TAX.
- `src/modules/import/proposal.test.ts` — accept/reject cases for the new rules.
- `src/app/_components/import/ImportBatchView.tsx` — "–" for a proposal without ISIN.
- `src/app/_components/import/UploadDropzone.tsx` — no highlight flicker when dragging over children.
- `src/app/_components/import/labels.ts` (+ `labels.test.ts`, `UploadDropzone.dom.test.tsx`) — "< 0,1 MB" for small selections.
- `src/modules/import/batches.test.ts` — stored-proposal fallback reason and empty-list case.
- `src/modules/import/storage.test.ts` — new: generated names and traversal refusal.

**Review:** 28 findings (high 0, medium 4, low 18, false 5, maybe-false 1). Patched entries: medium 1 (proposal contract, 4 rows), low 4 (drag flicker, MB label, stored-proposal test, storage test); 1 carried low patch row needed no change. Nothing deferred. Rejected with reasons in the Review Triage Log: list/view count divergence (corrupt-data only), 120 s lock (false), hard-coded limit text, finanzen.net zero targets, missing price column, warning context, archived/deleted Depot race, outer-transaction rollback (false), stale discard alert, > 25 MB bypass, empty-text message, stub-only service tests (false), Depot-delete path (false), plus carried rows.

**Follow-up review recommended:** false — follow-up pass with no `high` patched (medium 1, low 4).

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` against a throwaway DATABASE_URL — all pass (150 files, 1990 tests). The build logs a handled "counting open batches failed" for the unmigrated throwaway DB (layout falls back to 0).

**Residual risks:** drag-leave fix has no DOM test (jsdom does not render the highlight); orphaned PDFs after a process crash are not swept; existing local databases need `prisma migrate deploy` (the start script runs it).
