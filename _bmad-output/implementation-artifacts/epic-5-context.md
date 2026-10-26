# Epic 5 Context: Document Import

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy uploads broker PDF documents for a Depot: Deutsche Bank/ROBIN and comdirect/cominvest buy, sell and dividend confirmations, finanzen.net zero/Baader Bank documents (including tax refunds), and broker ISIN-change notices. He reviews the extracted Transactions with duplicate and ambiguity flags, corrects or discards them, and books them in one step; ISIN-change notices become a one-click corporate action instead of a failed file. This replaces Parqet's error-prone autosync and manual entry for all three document-based Depots, and keeps the monthly import (under 10 minutes including review) fast enough for DepotManagement to remain his only tracker. Nothing reaches the ledger until Tommy has seen it.

## Stories

- Story 5.1: Upload Documents into a Review Batch
- Story 5.2: Deutsche Bank / ROBIN Parser
- Story 5.3: Review and Book Imported Transactions
- Story 5.4: comdirect / cominvest Parser
- Story 5.5: finanzen.net zero / Baader Bank Parser
- Story 5.6: ISIN Changes from Broker Documents

## Requirements & Constraints

- Upload one or many PDFs for a non-archived Depot. Each file gets a status (parsed, duplicate, ambiguous, failed, and from 5.6 "Kapitalmaßnahme") and a specific reason when it fails. Unrecognized layouts fail with "Layout nicht erkannt. Buchung bitte manuell erfassen."; an unexpected layout always fails, never a partial proposal.
- Review before booking: proposals are editable inline and individually bookable or discardable. Nothing is written until confirmation, not even a Security.
- Duplicate protection: a Transaction already booked (earlier import, Parqet migration, manual entry) is never booked twice; re-importing a document books nothing. Key: Depot, date, type, Security, quantity, amount within €0.01. Ambiguous matches (e.g. identical savings-plan buys on one day) need an explicit decision and are never dropped automatically.
- Multi-execution documents (savings plan, rebalancing) yield one proposal per execution; quantities up to 8 decimals.
- Parsers check document arithmetic where the layout allows (e.g. finanzen.net zero: booked account total = derived cash effect; dividend credited = gross − tax − fee); a failed check fails the file.
- Documents needing no booking (tax-pot notices) report "Keine Buchung erforderlich." without a proposal.
- Corporate-action notices are never booked as BUY/SELL. A notice identified as an ISIN change (one Ausbuchung, one Einbuchung) becomes an ISIN-change proposal (old/new ISIN, old/new quantity, effective date = "per" date, new Security name). If the same change (same old and new Security, same date) is already recorded it shows "Bereits erfasst" and is not booked. Unreadable corporate-action notices fail with a reason pointing to "Position → Corporate Action" and never offer "Manuell erfassen" or a Transaction form.
- Performance: 15 documents from upload to booked in under two minutes of interaction. EUR only.
- Public repo: no real PDFs or personal data committed. Parsers are tested against anonymised real-layout text fixtures under `test/fixtures/import/<broker>/*.txt` (never `.gitignore` exceptions for `*.pdf`); expected values live in the tests.

## Technical Decisions

- **Staging, never booking:** the `import` module owns ImportBatch/ImportItem. A batch belongs to a Depot, one item per file with status, reason and proposals. Open batches persist until booked or discarded; uploaded PDFs are then deleted. The file hash only warns about re-uploads, never blocks.
- **Parsers:** text extracted with `unpdf`. Each parser is pure, `(extractedText) → TransactionProposal[] | ParseError`, registered per Broker enum (`DEUTSCHE_BANK`, `COMDIRECT`, `FINANZEN_ZERO`) and document type; tests go through `parseDocument(broker, text)`. Proposals carry an ISIN, not a securityId. Parser output is zod-validated at the boundary. 5.6 extends the proposal contract with an ISIN-change proposal kind alongside Transaction proposals.
- **Multi-file merging (comdirect):** an Ertragsgutschrift and its separate Steuermitteilung merge into one DIVIDEND by reference number (tax = gross − credited). A trade settlement carries its tax notice on later pages of the same file. Parsing can therefore depend on other items in the batch.
- **Canonical Transaction shape:** types BUY/SELL/DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL/ADJUSTMENT (ADJUSTMENT is a holding correction from reconciliation, not produced by parsers). `amount` is unsigned gross, never including fee or tax (dividend: gross total). `fee ≥ 0`; `tax` signed (positive paid, negative refund). `quantity`/`price` only on BUY/SELL/ADJUSTMENT. Standalone TAX (finanzen.net zero refund) has `amount = 0`, value in `tax`, no Security. Optional `note` ≤ 200 chars. Cash effect is derived by `core/cash`, never stored.
- **Exact decimals:** German amounts (`1.234,56`) parsed straight into decimal strings; `decimal.js` only, never JS `number`, Prisma `Decimal` or SQL arithmetic.
- **Dates:** business dates `YYYY-MM-DD` (Europe/Berlin); the ledger assigns intra-day sequence; corporate actions order first on a date.
- **Duplicates:** one advisory function `core/duplicates` → `unique | duplicate | ambiguous`, checked against the ledger and the rest of the batch. Incoming ISINs are first resolved to the current Security by following ISIN-change CorporateActions.
- **Booking:** confirmation revalidates every proposal against the current ledger, creates Securities via idempotent `ledger.ensureSecurity`, and books all accepted proposals through the ledger service in one DB transaction (services accept an optional Prisma tx client). ISIN-change proposals are recorded through the existing ledger ISIN-change (CorporateAction) service in the same batch booking; core moves open FIFO lots, original purchase dates and total Cost Basis to the new Security in every Depot. Only `ledger` writes ledger rows or CorporateActions; booking into an archived Depot is rejected.
- **Conventions:** expected failures return typed results (`{ ok: false, reason }`); server actions call module services, UI never touches Prisma; affected routes revalidate after writes; individual amounts are never logged.

## UX & Interaction Patterns

- **Entry points:** "Dokumente importieren" on the Depot detail; "Import" in the navigation (under "Mehr" on phones) showing the count of open batches.
- **Upload:** drag-and-drop zone plus file picker, multiple PDFs.
- **Review screen** (`mockups/import-review.html`): header with Depot/Broker, file count, summary, "Verwerfen" and "N Buchungen buchen" (disabled until every ambiguous item is decided). One card per file with status chip (erkannt, Duplikat, mehrdeutig, fehlgeschlagen, Kapitalmaßnahme). Proposal rows show Security logo and name, inline-editable, with Buchen/Verwerfen. Duplicates read "Bereits gebucht am …" and are not booked. Failed trade documents offer "Manuell erfassen" (Transaction form prefilled with Depot and, where readable, date).
- **ISIN-change files:** shown as "ISIN-Wechsel <old> → <new>, <qty> St. am <date>" with action "Als ISIN-Wechsel buchen", or "Bereits erfasst" when already recorded; no "Manuell erfassen".
- **After booking:** snackbar "N Buchungen gebucht."
- **Interaction rules:** no optimistic writes, no auto-booking, modal depth ≤ 1, no hover-only actions, German decimal input, touch targets ≥ 44 px.

## Cross-Story Dependencies

- 5.1 defines models, upload, `unpdf` extraction and the parser registry contract; 5.2, 5.4, 5.5 plug parsers into it. 5.3 builds review and booking on 5.1; 5.4 and 5.5 reuse that flow unchanged.
- 5.6 builds on 5.5 (its `isin-change.txt` fixture and the corporate-action rejection it replaces for parsable ISIN changes) and on 5.3 (new status, duplicate-like "Bereits erfasst", batch booking).
- **Epic 1:** ledger service, `ensureSecurity`, `core/duplicates`, `core/cash`, Transaction form for "Manuell erfassen", archive rule.
- **Epic 2:** ISIN-change CorporateAction service and core lot transfer (used by 5.6 and duplicate resolution); migrated Parqet rows and CorporateActions are duplicate/"already recorded" targets.
- **Epic 3:** Security logo component; price backfill and logo fetch for newly held Securities after booking.
- **Epic 6:** restore clears import staging; ImportBatch/ImportItem are excluded from export.
