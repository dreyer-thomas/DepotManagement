# Epic 5 Context: Document Import

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy uploads broker PDF documents (Deutsche Bank/ROBIN and comdirect/cominvest buy, sell and dividend confirmations) for a Depot, reviews the extracted Transactions with duplicate and ambiguity flags, corrects or discards them, and books them in one step. This replaces Parqet's error-prone autosync and manual entry for the document-based Depots, and makes the monthly import routine fast enough (under 10 minutes including review) to keep DepotManagement the only tracker. Nothing reaches the ledger without Tommy seeing it.

## Stories

- Story 5.1: Upload Documents into a Review Batch
- Story 5.2: Deutsche Bank / ROBIN Parser
- Story 5.3: Review and Book Imported Transactions
- Story 5.4: comdirect / cominvest Parser

## Requirements & Constraints

- Upload one or many PDFs for a non-archived Depot; each file gets status parsed, duplicate, ambiguous or failed with a specific reason. Unrecognized layouts fail with "Layout nicht erkannt. Buchung bitte manuell erfassen." — never a partial proposal.
- Review before booking: proposals are editable inline, each can be booked or discarded; nothing (not even a Security) is written until confirmation.
- Duplicate protection: an earlier import, the Parqet migration or a manual entry must not be booked twice; re-importing the same document books nothing. Duplicate key = Depot, date, type, Security, quantity, amount within €0.01. Ambiguous matches (e.g. identical savings-plan buys on one day) are flagged and require an explicit decision; never auto-dropped.
- Savings-plan/rebalancing documents with several executions produce one proposal per execution; fractional quantities (up to 8 decimals); comdirect settlements with separate fee and tax lines must be handled.
- Performance: a 15-document batch from upload to booked in under two minutes of interaction; robo-advisor Depots produce tens of Transactions per month.
- finanzen.net zero/Baader stays manual (out of scope); EUR only.
- Public repo: real PDFs, broker texts and personal data are never committed; parsers are tested against anonymised text fixtures under `test/fixtures/` named `*.txt` (no `.gitignore` exceptions for `*.pdf`).

## Technical Decisions

- **Staging, never booking:** the `import` module owns ImportBatch and ImportItem (introduced in 5.1); a batch belongs to a Depot and holds one item per file with status + reason and proposals in canonical Transaction shape. Open batches persist across sessions until booked or discarded; uploaded PDFs are deleted when the batch is booked or discarded. The file hash only warns about a re-upload, never blocks.
- **Parsers:** text extracted with `unpdf` (1.9.1); pure functions `(extractedText) → TransactionProposal[] | ParseError` registered per Broker (`DEUTSCHE_BANK`, `COMDIRECT`) and document type under `src/modules/import/parsers/<broker>/<doc-type>.ts`. Proposals carry ISIN (not a securityId) since Securities do not exist yet. Parser output is zod-validated at the boundary.
- **Canonical shape:** types BUY/SELL/DIVIDEND (plus FEE/TAX as needed); `amount` is the unsigned gross value excluding fee and tax (dividend = gross total, not per share); `fee ≥ 0`; `tax` signed (positive paid, negative refund); `quantity`/`price` only on BUY/SELL. Cash effect is derived by `core/cash`, never stored.
- **Exact decimals:** German amounts (`1.234,56`) parsed straight into decimal strings without float conversion; `decimal.js` only; no JS `number`, Prisma `Decimal` or SQL arithmetic on money/quantity/price. Amounts stored exactly as the broker states them.
- **Dates:** business dates `YYYY-MM-DD` (Europe/Berlin); the ledger assigns the intra-day sequence.
- **Duplicates:** the single advisory `core/duplicates` function returns `unique | duplicate | ambiguous`; for import it checks against the ledger and the rest of the batch; incoming ISINs are first resolved through ISIN-change CorporateActions to the current Security.
- **Booking:** confirmation revalidates every proposal against the current ledger, creates Securities via idempotent `ledger.ensureSecurity({ isin })`, and books all accepted proposals through the ledger service in one DB transaction (services accept an optional Prisma tx client). Only `ledger` writes ledger rows; booking into an archived Depot is rejected.
- Expected failures return typed results (`{ ok: false, reason }`); server actions call module services; UI never touches Prisma; affected routes revalidate after the write. Never log amounts per Transaction.

## UX & Interaction Patterns

- Entry points: "Dokumente importieren" on Depot detail and "Import" in the navigation (under "Mehr" on phones); the Import nav entry shows the count of open batches. Desktop-optimized but must work on phones.
- Upload: drag-and-drop zone plus file picker, multiple PDFs at once.
- Review screen (reference `mockups/import-review.html`): header with Depot/Broker, file count and summary line ("12 Dateien erkannt, 1 Duplikat, 1 fehlgeschlagen · 1 Entscheidung offen"), "Verwerfen" and "N Buchungen buchen" (disabled until every ambiguous item is decided). One card per file with status chip: erkannt (gain-soft/gain), Duplikat (MUI default grey), mehrdeutig (stale-soft/stale), fehlgeschlagen (loss-soft/loss). Proposal rows show type, date, Security logo + name, quantity, amount, fee/tax as applicable; inline edit; per-row Buchen/Verwerfen.
- Duplicate files read "Bereits gebucht am …" and are not booked; ambiguous rows explain the existing match. Failed files show the reason and "Manuell erfassen", opening the Transaction form prefilled with Depot and, where readable, date.
- After booking: snackbar "N Buchungen gebucht."; no optimistic writes, no auto-booking, modal depth ≤ 1, no hover-only actions; German decimal input; ≥ 44 px touch targets.

## Cross-Story Dependencies

- 5.1 defines the models, upload flow, `unpdf` extraction and parser registry contract (with a stub parser); 5.2 and 5.4 plug parsers into it; 5.3 builds review and booking on 5.1 and is exercised by 5.2's proposals; 5.4 reuses 5.3's flow unchanged.
- Relies on existing Epic 1 pieces: ledger service (validation, sequence, duplicate policy), `ensureSecurity`, `core/duplicates`, `core/cash`, Transaction form (for "Manuell erfassen"), archive rule; Epic 2 ISIN-change CorporateActions for duplicate resolution and migrated rows as duplicate targets; Epic 3 Security logo component and new-held-Security price backfill/logo fetch triggered after booking.
- Epic 6 restore clears import staging; ImportBatch/ImportItem are excluded from export.
