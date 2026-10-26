---
title: 'comdirect / cominvest Parser'
type: 'feature'
created: '2026-10-26'
status: 'awaiting-operator'
baseline_revision: 'f6832510d1a44510eaa0f32e49206bf8898a603e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      cominvest documents, real comdirect fee lines and real savings-plan/multi-execution layouts are not verified against real unpdf output.
    evidence: |-
      All fixtures are comdirect "Trading" layouts; buy-fees.txt and savings-plan.txt are synthetic variants of buy.txt and multi-execution is tested by concatenating buy.txt and sell.txt. If cominvest settlements use another title or layout they fail safely with "Layout nicht erkannt". Settled by anonymised real cominvest and comdirect samples (operator action).
    location: >-
      src/modules/import/parsers/comdirect/trade.ts, dividend.ts
    severity: medium (unverified)
operator_actions:
  - "Upload one real cominvest settlement PDF (buy or sell, ideally a multi-execution rebalancing document) to a comdirect Depot in `npm run dev` and confirm the review shows status erkannt with correct date, ISIN, quantity, price, amount, fee and tax."
  - "Upload one real comdirect settlement PDF with Provision/Börsenplatzgebühr and one real savings-plan execution PDF and confirm the fee and fractional quantity in the review."
  - "Upload a real comdirect Ertragsgutschrift together with its Steuermitteilung in one batch and confirm one DIVIDEND with the correct tax and the Steuermitteilung shown as keine Buchung."
  - "If any real layout fails, extract and anonymise its text as described in test/fixtures/import/comdirect/README.md, save it under test/fixtures/import/comdirect/ as *.txt and add a test in src/modules/import/parsers/comdirect/."
---

<intent-contract>

## Intent

**Problem:** The `COMDIRECT` entry of the parser registry is empty, so every comdirect/cominvest buy, sell and dividend document fails with "Layout nicht erkannt"; comdirect dividends additionally come as two files (Ertragsgutschrift + Steuermitteilung) that only together give the booked amount.

**Approach:** Three pure comdirect parsers (`trade`, `dividend`, `dividend-tax`) registered for `COMDIRECT`, tested against the anonymised real-layout fixtures in `test/fixtures/import/comdirect/`. Parser output may carry a review note and a link; a pure batch step `linkDocuments` runs after all files of an upload are parsed and merges each Ertragsgutschrift with its Steuermitteilung by Referenz-Nummer. A merged Steuermitteilung is stored with the new item status `NO_BOOKING` (chip "keine Buchung", no proposals), which story 5.5 reuses for "Keine Buchung erforderlich.".

## Boundaries & Constraints

**Always:**
- Same parser rules as story 5.2: pure, German amounts straight to decimal strings (`germanAmount`, `ExactDecimal`), never `Number`; once a parser claims a text, any unreadable field, non-EUR value, Storno or failed arithmetic check → `{ error: "invalid", message }` with a specific German reason ending "Buchung bitte manuell erfassen." — never partial proposals.
- Parser contract (`proposal.ts`): a parser returns `TransactionProposalInput[] | ParsedDocument | ParseError`, `ParsedDocument = { proposals, note?, link? }`; `link` is `{ kind: "dividend-credit", reference, beforeTax }` or `{ kind: "dividend-tax-notice", reference, isin, beforeTax, afterTax }` (decimal strings). Empty `proposals` are only valid with a `dividend-tax-notice` link. Deutsche Bank parsers stay unchanged.
- **Trade** (claims `GESCHÄFTSABRECHNUNG` with `Wertpapierkauf`/`Wertpapierverkauf`): the text splits into settlement parts (from each `GESCHÄFTSABRECHNUNG`) and Steuermitteilung parts (from each `Steuerliche Behandlung:`); one proposal per settlement in document order. Per settlement: BUY/SELL from Wertpapierkauf/-verkauf; `date` = `Geschäftstag`; `isin` from the `WPKNR/ISIN` block; `name` = first Bezeichnung line without its trailing WKN; `quantity`/`price` from `St. <qty> EUR <price>` (≤ 8 decimals); `amount` = `Kurswert : EUR`; total = last `EUR <amount>` on the line after `Zu Ihren Lasten vor Steuern` (BUY) / `Zu Ihren Gunsten vor Steuern` (SELL; wrong direction → invalid); `fee` = BUY total − Kurswert, SELL Kurswert − total (< 0 → invalid). The Steuermitteilung part with `Nr. <Geschäftsnummer digits>` belongs to the settlement (a single part without number pairs with a single settlement); its ISIN and |vor Steuern| must equal the settlement's and `vor Steuern + abgeführte Steuern = nach Steuern` (signed as printed) must hold; `tax` = −`abgeführte Steuern` (printed negative = paid). A notice part matching no settlement → invalid. A settlement without notice gets tax 0 and the note "Keine Steuermitteilung im Dokument: Steuern sind nicht enthalten. Bitte prüfen.".
- **Dividend credit** (claims `Ertragsgutschrift`/`Dividendengutschrift` with `Bruttobetrag:`): `date` = `zahlbar ab`; ISIN from `STK <qty> <ISIN>` (glued name after it); `name` from `per <date> <WKN><name>`; `amount` = `Bruttobetrag: EUR …`, else the `EUR` value of `zum Devisenkurs:` (missing → foreign-currency invalid); `beforeTax` = last `EUR` amount on the line after `Zu Ihren Gunsten vor Steuern` (0 ≤ beforeTax ≤ amount); `tax` = amount − beforeTax (foreign withholding; 0 without); `link` = credit with `Referenz-Nr.` (missing → invalid); `note` = "Steuermitteilung (Referenz-Nr. <ref>) nicht im Import: Steuern sind nicht enthalten. Bitte prüfen oder zusammen hochladen.".
- **Dividend Steuermitteilung** (claims `Steuerliche Behandlung:` texts not claimed above): a trade notice (`Kauf`/`Verkauf` in that line) → invalid "Steuermitteilung zu einem Wertpapiergeschäft ohne Abrechnung. Bitte mit der Abrechnung hochladen."; else reads `Referenz-Nummer`, ISIN, `Zu Ihren Gunsten vor/nach Steuern`, `abgeführte Steuern` with the arithmetic check and returns `{ proposals: [], link }`.
- **`linkDocuments`** (pure, `parsers/link.ts`, runs over all outcomes of one upload in `createImportBatch`, before any write): a notice whose reference matches ≥ 1 credit is merged into each such credit: ISIN and `beforeTax` must match (else credit and notice FAILED "Steuermitteilung passt nicht zur Ertragsgutschrift (Referenz-Nr. <ref>). Buchung bitte manuell erfassen."); credit `tax` = amount − notice `afterTax`, note removed; notice → `NO_BOOKING` with reason "Steuern in „<credit file name>“ übernommen. Keine Buchung erforderlich.". A notice without credit → FAILED "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen." (`documentDate` stored as for other failed files). Links are never stored.
- Storage/review: `ImportItemStatus.NO_BOOKING` (migration records the enum change only, as `20261025210000_add_fund_asset_type`); `reason` holds the failure reason (FAILED), the review note (PARSED) or the info (NO_BOOKING). `ItemReviewStatus` gains `NO_BOOKING` (chip "keine Buchung", MUI default grey like Duplikat; summary part "N ohne Buchung", omitted at 0); a PARSED item's note shows under its file name as a warning-colored text; `listOpenBatches` counts only FAILED as failed.

**Never:** No real documents or personal data committed (only the existing anonymised fixtures plus synthetic variants); no change to booking, `core/duplicates`, ledger or Deutsche Bank parser behavior; no foreign-currency conversion beyond reading the stated EUR value; no cross-batch linking (merging happens only within one upload); no new Transaction types; no I/O or logging in parsers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buy | `buy.txt` | BUY 2026-04-07 DE0005933931 2.5 @ 180.12345, amount 450.31, fee 0, tax 0, name "iShares Core DAX UCITS ETF DE" | — |
| Sell with tax | `sell.txt` | SELL 2026-05-06 LU0274209740 3.2 @ 52.5, amount 168, fee 0, tax 3.32 | — |
| Fees | `buy-fees.txt` (Provision + Börsenplatzgebühr, vor Steuern 456,71) | fee 6.4 | fee < 0 → invalid |
| Savings plan | `savings-plan.txt` fractional qty | quantity with up to 8 decimals | — |
| Multi-execution | buy + sell texts in one document | 2 proposals, each with its own notice's tax | unmatched notice → invalid |
| No notice | `sell.txt` without the Steuermitteilung part | SELL tax 0 + note | — |
| Notice mismatch | notice ISIN or vor Steuern ≠ settlement, or before + abgeführt ≠ after | — | invalid with reason |
| Dividend pair | `dividend.txt` + `dividend-tax.txt` in one upload | DIVIDEND 2026-06-21 IE00B3RBWM25 amount 25.57 tax 4.73; notice NO_BOOKING | — |
| Lone credit | `dividend.txt` only | DIVIDEND tax 0 + note | — |
| Lone notice | `dividend-tax.txt` only | FAILED "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen." | — |
| Foreign / Storno / missing ISIN | variants | — | invalid with specific reason |
| Other text | Kontoauszug | unrecognized → layout message | — |

</intent-contract>

## Code Map

- `src/modules/import/proposal.ts` -- `Parser`, `ParseError`, `transactionProposalSchema`; add `ParsedDocument`, `DocumentLink`.
- `src/modules/import/parsers/registry.ts:18-72` -- `PARSERS.COMDIRECT: []` to fill; `parseDocument` validates output; `ParseOutcome` gains `note?`/`link?` on PARSED and a `{ status: "LINK_ONLY", documentType, link }` outcome; comment "comdirect follows in story 5.4" to update.
- `src/modules/import/parsers/registry.test.ts:36-43` -- production-registry test to update.
- `src/modules/import/parsers/german.ts` -- `germanAmount`, `germanDate`, `AMOUNT_PATTERN`, `DATE_PATTERN`, `ISIN_PATTERN`.
- `src/modules/import/parsers/deutsche-bank/reasons.ts` -- reason builders (`missingFieldReason`, `foreignCurrencyReason`, `implausibleReason`, `STORNO_REASON`); move the broker-neutral ones to `parsers/reasons.ts`, deutsche-bank re-exports (no wording change).
- `src/modules/import/parsers/deutsche-bank/{trade,dividend}.ts` -- style precedent (regex constants, `ExactDecimal`, name guard with `SECURITY_NAME_MAX_LENGTH`).
- `src/modules/import/batches.ts:185-292` -- `prepare` + `createImportBatch`: keep the text until linking, run `linkDocuments(broker-independent)`, then compute `documentDate` for FAILED; store NO_BOOKING/notes in `reason`. `:339-345` broken check only for PARSED; `:605-630` `listOpenBatches` failedCount.
- `src/modules/import/review.ts:18,24,117-150` -- `ItemReviewStatus`, `ReviewItemInput.status`, `itemReviewStatus`, `reviewCounts` files record.
- `src/app/_components/import/labels.ts:14,75` -- `ITEM_STATUS_LABELS`, `reviewSummary`.
- `src/app/_components/import/ImportReview.tsx:50-56,360-392` -- `CHIP_COLORS`, `ItemCard` reason display.
- `prisma/schema.prisma:233` -- `enum ImportItemStatus`; `reason` doc comment.
- `test/fixtures/import/comdirect/*.txt` -- anonymised real layouts (read-only); `test/fixtures/import/deutsche-bank/README.md` -- README precedent.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/20261026220000_import_no_booking/migration.sql` -- `NO_BOOKING` value + comment-only migration; `npx prisma generate`.
- `src/modules/import/proposal.ts`, `parsers/registry.ts` (+ test) -- extended contract, `LINK_ONLY` outcome, note passthrough, COMDIRECT entries `trade`, `dividend`, `dividend-tax`.
- `src/modules/import/parsers/reasons.ts` + `deutsche-bank/reasons.ts` -- shared builders.
- `src/modules/import/parsers/comdirect/{trade,dividend,tax-notice,reasons}.ts` -- parsers per rules; shared notice reader in `tax-notice.ts`.
- `src/modules/import/parsers/link.ts` (+ `link.test.ts`) -- `linkDocuments(outcomes: { fileName, outcome }[])` → stored outcomes (PARSED with note, FAILED, NO_BOOKING); unit-test pair, lone credit, lone notice, mismatch, two credits same reference.
- `src/modules/import/parsers/comdirect/*.test.ts` -- every matrix row through `parseDocument("COMDIRECT", …)` with exact decimals.
- `test/fixtures/import/comdirect/{buy-fees,savings-plan}.txt` + `README.md` -- synthetic variants (layout of `buy.txt`, consistent sums), README as for deutsche-bank.
- `src/modules/import/batches.ts`, `review.ts` (+ tests) -- linking at upload, NO_BOOKING handling, counts; DB test: uploading credit + notice yields one DIVIDEND with tax 4.73 and a NO_BOOKING item, which books one Transaction.
- `src/app/_components/import/{labels.ts,ImportReview.tsx}` (+ tests) -- chip, summary part, note display.

**Acceptance Criteria:**
- Given a `COMDIRECT` Depot, when `buy.txt`, `sell.txt` or a credit+notice pair are uploaded as one batch, then the review shows proposals with the matrix values and booking them uses the story 5.3 flow unchanged.
- Given a dividend pair in one upload, when reviewed, then the notice file shows chip "keine Buchung" with "Steuern in „…“ übernommen. Keine Buchung erforderlich." and no proposal, and "N Buchungen buchen" counts only the DIVIDEND.
- Given a lone credit or a trade without notice, when reviewed, then its note is shown under the file name.
- Given any claimed but unreadable comdirect document, when parsed, then the item is FAILED with a specific German reason and no proposals.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 32 findings — high 0, medium 2, low 18, false 6, maybe-false 6
- findings:
  - `[low]` `[patch]` (blind) Open-batches line "2 Dateien · 1 erkannt · 0 fehlgeschlagen" does not add up with NO_BOOKING items — `batchSummary` now inserts "· N ohne Buchung" (derived, no new field); test added.
  - `[low]` `[reject]` (blind) DESIGN.md `status-chip-import` lacks a no-booking token — the chip reuses the documented "MUI default grey" of Duplikat; editing a planning artifact is not this story's change.
  - `[false]` `[reject]` (blind) One notice merged into two credits double-counts tax — each credit is a full DIVIDEND with its own correct tax; two credits of one reference are sibling duplicates, which `classifyBatch` flags ambiguous, so nothing is booked twice without a decision.
  - `[low]` `[reject]` (blind) Notice fails with "ohne Ertragsgutschrift" when its credit is in the upload but failed — both files go to manual entry anyway; fix needs reading the reference of a failed credit (new branch) for a rare case.
  - `[medium]` `[patch]` (blind) Non-dividend Steuermitteilung (Vorabpauschale) read as dividend notice with a misleading reason — dividend notice parser now requires a distribution header (`Ausschüttung|Dividende|Ertrag`), else unrecognized → "Layout nicht erkannt"; test added.
  - `[false]` `[reject]` (blind) Merged proposals not re-validated; refund gives negative tax — only `tax` changes and the schema accepts any signed DIVIDEND tax; a negative tax is a legitimate refund.
  - `[low]` `[reject]` (blind) `applyNotice` ignores the notice's Lasten/Gunsten direction — a wrong-direction notice would need the same Geschäftsnummer, ISIN and amount; adds a guard for an unseen case.
  - `[maybe-false]` `[reject]` (blind) Storno matched anywhere in the text — no comdirect fixture contains "Storno" outside cancellations; if true the file fails safely to manual entry (low); same decision as story 5.2.
  - `[maybe-false]` `[defer]` (blind) cominvest layout untested — needs real cominvest samples; recorded in `deferred` and `operator_actions` (medium, unverified).
  - `[low]` `[reject]` (blind) Merged credit card does not name the source of its tax — the notice card in the same review states "Steuern in „…“ übernommen"; the spec removes the credit note on merge.
  - `[low]` `[reject]` (blind) Finanztransaktionssteuer/Stückzinsen end up in fee — product decision (same as story 5.2); comdirect ETF trades carry none.
  - `[low]` `[patch]` (blind) Exported global `NOTICE_MARKER` with shared `lastIndex` and an inline duplicate — exported without `g`, `matchAll` uses a fresh global copy, `readTaxNotice` uses the constant.
  - `[false]` `[reject]` (blind) Comment-only migration untested — every DB test applies all committed migrations (`test/helpers/test-db.ts` → `createMigratedDatabaseFile`), and the build/test run passed.
  - `[low]` `[patch]` (blind) Missing edge-case tests — added two-notice agree/disagree and merge with foreign withholding (link.test.ts); over-long name, NO_BOOKING-only booking and mismatch documentDate rejected as low-value.
  - `[maybe-false]` `[reject]` (edge) Credit and notice in one PDF: notice page ignored — comdirect delivers the notice separately ("separaten Steuermitteilung", AC); if it happens the credit's note warns that taxes are missing (low).
  - `[medium]` `[patch]` (edge) Vorabpauschale notice asks for a non-existent credit — same entry as the blind Vorabpauschale row.
  - `[low]` `[reject]` (edge) Dividend-tax file with several notices links only the first — comdirect sends one notice per file; an unlinked credit still shows its "nicht im Import" note.
  - `[low]` `[patch]` (edge) Unreadable notice part in a multi-settlement document is not located — `readTaxNotice` gets " (Steuermitteilung N)"; test added.
  - `[low]` `[reject]` (edge) Partial-notice note does not name the settlements — the note still warns per file; naming needs a new builder.
  - `[low]` `[patch]` (edge) Open-batch summary counts do not add up — same entry as the blind batchSummary row.
  - `[low]` `[patch]` (verification-gap) `noticesAgree` branch untested — tests added: conflicting notices fail all three files, identical notices merge.
  - `[low]` `[patch]` (verification-gap) Partial-notice note in multi-settlement documents untested — buy + sell-without-notice test added.
  - `[low]` `[patch]` (verification-gap) Duplicate notice for one Geschäftsnummer untested — test added (FAILED, unmatched reason).
  - `[low]` `[patch]` (verification-gap other) batchSummary inconsistency — same entry as the blind batchSummary row.
  - `[false]` `[reject]` (intent) Review UI extended although 5.3 should apply "unchanged" — booking is unchanged; the merge and review-hint ACs of 5.4 require showing the merged notice and the hint.
  - `[maybe-false]` `[defer]` (intent) cominvest covered only by assumption — same entry as the blind cominvest row.
  - `[maybe-false]` `[defer]` (intent) Fee lines only in a synthetic fixture — same root: real samples (operator action).
  - `[maybe-false]` `[defer]` (intent) Savings plan / multi-execution only synthetic — same root: real samples (operator action).
  - `[false]` `[reject]` (intent) Unclaimed comdirect text gets the generic reason — the epic requires exactly "Layout nicht erkannt. Buchung bitte manuell erfassen." for unrecognized files.
  - `[low]` `[reject]` (intent) Lone credit tax is gross − vor Steuern, not literally 0 — equals 0 without foreign withholding (the AC's case) and keeps cash right with it; deliberate per Design Notes.
  - `[low]` `[reject]` (intent) Server-action/page upload surface not exercised — covered at service and DOM level; no browser e2e harness (same as 5.3).
  - `[false]` `[reject]` (intent) epic-5-context.md brings in 5.5 content — it is the compiled epic context, which covers all epic stories by design.

## Design Notes

Merging must see several files, but parsers stay pure per text: the link travels in the parse outcome and `linkDocuments` is a pure batch-level step before staging, so review and booking (5.3) see an ordinary DIVIDEND. Lone credit `tax = gross − Zu Ihren Gunsten vor Steuern` reduces to the AC's "tax 0" when no foreign withholding tax is deducted on the credit and keeps the cash effect right when it is. The trade tax comes from the notice part because the settlement page prints only "vor Steuern". `NO_BOOKING` instead of a FAILED/PARSED hack keeps "fehlgeschlagen" meaning "needs manual entry" and is the status story 5.5 needs for tax-pot notices.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` (throwaway `DATABASE_URL`) -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: upload a comdirect credit + its Steuermitteilung to a comdirect Depot → one DIVIDEND, notice "keine Buchung".

## Auto Run Result

Status: awaiting-operator

**Summary:** comdirect / cominvest parsers registered for `COMDIRECT`: `trade` (settlements with their Steuermitteilung pages, paired by Geschäftsnummer; fee derived from "vor Steuern" − Kurswert, tax = −abgeführte Steuern; one proposal per settlement), `dividend` (Ertragsgutschrift, EUR value of foreign gross, tax = gross − vor Steuern until merged) and `dividend-tax` (Steuermitteilung → link only). A pure batch step `linkDocuments` merges credit and notice of one upload by Referenz-Nummer (tax = gross − nach Steuern); the merged notice is stored with the new item status `NO_BOOKING` (chip "keine Buchung"). Lone credits and settlements without notice carry a review note; a lone dividend notice fails with "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen.". Booking (5.3) is unchanged.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261026220000_import_no_booking/migration.sql` — `ImportItemStatus.NO_BOOKING` (comment-only migration), `reason` doc.
- `src/modules/import/proposal.ts` — `ParsedDocument`, `DocumentLink` and their schemas.
- `src/modules/import/parsers/registry.ts` (+ test) — COMDIRECT parsers, note/link passthrough, `LINK_ONLY` outcome.
- `src/modules/import/parsers/link.ts` (+ test) — cross-file merge within one upload.
- `src/modules/import/parsers/comdirect/{trade,dividend,tax-notice,reasons}.ts` (+ tests) — the parsers and German reasons.
- `src/modules/import/parsers/reasons.ts`, `deutsche-bank/reasons.ts` — shared reason builders (DB re-exports, wording unchanged).
- `src/modules/import/{batches,review,index}.ts` (+ tests) — linking at upload, NO_BOOKING review status and counts, failedCount.
- `src/app/_components/import/{labels.ts,ImportReview.tsx}` (+ tests) — chip, summaries, note display.
- `test/fixtures/import/comdirect/{buy-fees,savings-plan}.txt`, `README.md` — synthetic variants and how to add anonymised samples.

**Review:** 32 findings (high 0, medium 2, low 18, false 6, maybe-false 6). Patched: medium 1 entry (non-dividend Steuermitteilung now unrecognized), low entries: batchSummary "ohne Buchung", non-global `NOTICE_MARKER`, notice position in multi-settlement reasons, tests for conflicting/identical notices, foreign-withholding merge, partial notices and duplicate notices. Deferred: real-layout verification of cominvest, fee lines and savings-plan/multi-execution documents (medium, unverified) → operator actions. Rejected with reasons in the Review Triage Log: DESIGN.md token, double-counted tax (false), failed-credit notice reason, re-validation (false), notice direction, broad Storno match, credit tax source note, FTT as fee, migration test (false), combined credit+notice PDF, several notices per file, partial-note naming, unchanged-5.3 (false), generic unrecognized reason (false), lone-credit tax formula, no e2e, epic context (false).

**Follow-up review recommended:** false — first pass patched no `high` and one `medium` entry.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` against a throwaway `DATABASE_URL`: all pass after the patches (159 files, 2187 tests). Every I/O matrix row is covered by passing tests. No manual `npm run dev` upload with real PDFs.

**Operator actions owed:** see `operator_actions` in the frontmatter (real cominvest / comdirect fee, savings-plan and dividend-pair uploads; anonymised fixtures if a layout differs).

**Residual risks:** cominvest and real fee/savings-plan layouts are unverified and fail safely with a specific reason if they differ; Storno detection rejects any document mentioning "Storno"; a credit and its notice uploaded in different batches are not merged (credit booked with its note, notice fails); foreign-currency settlements need manual entry.
