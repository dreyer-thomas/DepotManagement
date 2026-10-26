# Epic 5 Context: Document Import

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy uploads broker PDF documents for a Depot: Deutsche Bank/ROBIN and comdirect/cominvest buy, sell and dividend confirmations, plus finanzen.net zero/Baader Bank documents (including tax refunds). He reviews the extracted Transactions with duplicate and ambiguity flags, corrects or discards them, and books them in one step. This replaces Parqet's error-prone autosync and manual entry for all three document-based Depots. It also keeps the monthly import fast enough (under 10 minutes including review) for DepotManagement to remain his only tracker. Nothing reaches the ledger until Tommy has seen it.

## Stories

- Story 5.1: Upload Documents into a Review Batch
- Story 5.2: Deutsche Bank / ROBIN Parser
- Story 5.3: Review and Book Imported Transactions
- Story 5.4: comdirect / cominvest Parser
- Story 5.5: finanzen.net zero / Baader Bank Parser

## Requirements & Constraints

- Upload one or many PDFs for a non-archived Depot. Each file gets a status (parsed, duplicate, ambiguous or failed) and a specific reason when it fails. A file that no parser recognizes fails with "Layout nicht erkannt. Buchung bitte manuell erfassen." An unexpected layout always fails and never yields a partial proposal.
- Review before booking: proposals can be edited inline, and each one can be booked or discarded. Nothing is written until confirmation, not even a Security.
- Duplicate protection: a Transaction already booked by an earlier import, the Parqet migration or manual entry is never booked twice, and re-importing the same document books nothing. The duplicate key is Depot, date, type, Security and quantity, with the amount within €0.01. Ambiguous matches (for example identical savings-plan buys on one day) are flagged and need an explicit decision; they are never dropped automatically.
- A document with several executions (savings plan, rebalancing) produces one proposal per execution. Fractional quantities have up to 8 decimals.
- Parsers must check each document's arithmetic where the layout allows it. Example: for finanzen.net zero, the booked account total must equal the cash effect derived from the proposal, and a dividend's credited amount must equal gross − tax − fee; if either check fails, the file fails.
- Documents that need no booking (finanzen.net zero tax-pot notices) are reported as "Keine Buchung erforderlich." with no proposal. Corporate-action notices fail with "Kapitalmaßnahme bitte als Corporate Action erfassen." and are never booked as trades.
- Performance: a batch of 15 documents goes from upload to booked in under two minutes of interaction. Robo-advisor Depots produce tens of Transactions per month.
- EUR only.
- Public repo: real PDFs, broker texts and personal data are never committed. Parsers are tested against anonymised real-layout text fixtures under `test/fixtures/import/<broker>/*.txt`, never through `.gitignore` exceptions for `*.pdf`. Expected values belong in the tests.

## Technical Decisions

- **Staging, never booking:** the `import` module owns ImportBatch and ImportItem (introduced in 5.1). A batch belongs to a Depot and holds one item per file, with a status, a reason and proposals in the canonical Transaction shape. Open batches persist across sessions until booked or discarded. Uploaded PDFs are deleted when the batch is booked or discarded. The file hash only warns about a re-upload; it never blocks one.
- **Parsers:** text is extracted with `unpdf` (1.9.1). Each parser is a pure function `(extractedText) → TransactionProposal[] | ParseError`, registered per Broker enum (`DEUTSCHE_BANK`, `COMDIRECT`, `FINANZEN_ZERO`) and document type under `src/modules/import/parsers/<broker>/<doc-type>.ts`. Tests go through `parseDocument(broker, text)`. Proposals carry an ISIN rather than a securityId, because Securities do not exist yet. Parser output is zod-validated at the boundary.
- **Multi-file merging (comdirect):** a dividend credit (Ertragsgutschrift) and its tax notice (Steuermitteilung) come as separate files. They are merged into one DIVIDEND by reference number, with tax = gross − credited amount. A comdirect trade settlement carries its tax notice on later pages of the same file. Parsing can therefore depend on other items in the same batch.
- **Canonical shape:** the types are BUY/SELL/DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL.
  - `amount` is the unsigned gross value and never includes fee or tax; for a dividend it is the gross total, not the amount per share.
  - `fee ≥ 0`.
  - `tax` is signed: positive means paid, negative means refunded.
  - `quantity` and `price` are set only on BUY and SELL.
  - A standalone TAX (a finanzen.net zero refund) has `amount = 0`, its value in `tax` and no Security.
  - The cash effect is derived by `core/cash` and never stored.
- **Exact decimals:** German amounts (`1.234,56`) are parsed straight into decimal strings without float conversion. Use `decimal.js` only: no JS `number`, no Prisma `Decimal` and no SQL arithmetic on money, quantity or price.
- **Dates:** business dates are `YYYY-MM-DD` (Europe/Berlin), and the ledger assigns the intra-day sequence.
- **Duplicates:** one advisory function, `core/duplicates`, returns `unique | duplicate | ambiguous`. For import it checks each proposal against the ledger and against the rest of the batch. An incoming ISIN is first resolved to the current Security by following ISIN-change CorporateActions.
- **Booking:** confirmation revalidates every proposal against the current ledger, creates Securities through the idempotent `ledger.ensureSecurity`, and books all accepted proposals through the ledger service in one DB transaction. Services accept an optional Prisma transaction client. Only `ledger` writes ledger rows, and booking into an archived Depot is rejected.
- **Conventions:** expected failures return typed results (`{ ok: false, reason }`). Server actions call module services, and the UI never touches Prisma. Affected routes revalidate after a write. Amounts of individual Transactions are never logged.

## UX & Interaction Patterns

- **Entry points:** "Dokumente importieren" on the Depot detail page, and "Import" in the navigation (under "Mehr" on phones). The Import entry shows how many batches are open.
- **Upload:** a drag-and-drop zone plus a file picker, accepting several PDFs at once.
- **Review screen** (see `mockups/import-review.html`):
  - The header shows the Depot and Broker, the file count, a summary line, a "Verwerfen" button and "N Buchungen buchen". "N Buchungen buchen" stays disabled until every ambiguous item is decided.
  - There is one card per file, with a status chip: erkannt, Duplikat, mehrdeutig or fehlgeschlagen.
  - Each proposal row shows the Security logo and name, can be edited inline, and has its own Buchen and Verwerfen actions.
  - A duplicate reads "Bereits gebucht am …" and is not booked.
  - A failed file shows its reason and offers "Manuell erfassen", which opens the Transaction form prefilled with the Depot and, where readable, the date.
- **After booking:** a snackbar shows "N Buchungen gebucht."
- **Interaction rules:** no optimistic writes, no auto-booking, at most one level of modals, no actions that appear only on hover, German decimal input and touch targets of at least 44 px.

## Cross-Story Dependencies

- 5.1 defines the models, the upload flow, `unpdf` extraction and the parser registry contract (with a stub parser). 5.2, 5.4 and 5.5 plug their parsers into this registry. 5.3 builds review and booking on top of 5.1, and 5.4 and 5.5 reuse that review and booking flow unchanged.
- **Epic 1:** the ledger service (validation, sequence, duplicate policy), `ensureSecurity`, `core/duplicates`, `core/cash`, the Transaction form used by "Manuell erfassen", and the archive rule.
- **Epic 2:** ISIN-change CorporateActions for duplicate resolution, and migrated Parqet rows, which serve as duplicate targets.
- **Epic 3:** the Security logo component, plus the price backfill and logo fetch for newly held Securities after booking.
- **Epic 6:** restore clears import staging, and ImportBatch and ImportItem are excluded from the export.
