# Epic 2 Context: Corporate Actions & Parqet Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let Tommy record stock splits and ISIN changes so quantities, Prices and FIFO Cost Basis stay correct across them, and then bring his complete Transaction history from Parqet CSV exports (one file per Depot) into DepotManagement. After migration, Positions, invested capital and Cash Account balance per Depot must match what Parqet showed on export day, and realized Gain/Loss must match Parqet's per-sale `realizedgains`. This is the point where the app switches from synthetic to real data and becomes Tommy's source of truth, so correctness and "nothing booked unseen" matter more than anywhere else.

## Stories

- Story 2.1: Record Stock Splits
- Story 2.2: Record ISIN Changes
- Story 2.3: Parqet Export Preview
- Story 2.4: Confirm Migration and Reconcile with Parqet

## Requirements & Constraints

- Split: ratio + effective date; earlier quantities and per-unit Prices shown split-adjusted; total Cost Basis unchanged; applies in every Depot holding the Security.
- ISIN change: old and new quantity (ratio may differ from 1:1); open FIFO lots move to the new Security keeping original purchase dates and total Cost Basis; old Security disappears as an open Position after the effective date but its history stays visible; later sells of the new Security realize against carried-over lots.
- Splits and ISIN changes are editable and deletable; views reflect changes on the next read.
- Migration: one CSV per Depot, target Depot chosen at upload; nothing is written until confirmation. Repeatable per Depot; re-running the same file books only non-duplicates.
- Parqet format quirks the reader must handle: semicolon-delimited, quoted text, German decimal comma, newest rows first (emit proposals chronologically); `datetime` is ISO UTC → convert to Europe/Berlin business date, drop synthetic times (06:00Z/00:00Z); types `Buy`, `Sell`, `Dividend`, `TransferIn`, `TransferOut`, `cost`; `assettype` `Security` (type not distinguishable), `Cash`, `Crypto` (e.g. `BTC`, 8-decimal quantities); fractional quantities anywhere.
- Mapping rules: Buy/Sell/Dividend collapse with their Cash TransferOut/TransferIn pair into one Transaction; on rounding mismatch adjust `amount` so the derived cash booking equals the cash row. Dividends use `amount`, never `price × shares` (often `shares=1`). Negative `tax` = refund. `cost` row with amount 0 and only `tax` → TAX Transaction. Unpaired Cash TransferIn/Out → Deposit/Withdrawal. Same-timestamp Security TransferOut (old ISIN, price 0) + TransferIn (new ISIN) → ISIN-change proposal. Unpaired Security transfer, non-EUR row and unparseable row → flagged with reason, never booked silently.
- `assettype = Security` → proposed `UNCLASSIFIED`; user must classify (STOCK/ETF/CERTIFICATE) before confirm. `Crypto` → CRYPTO keyed by upper-case symbol.
- Preview shows counts per type, detected ISIN changes, flagged rows, and resulting Positions, invested capital and Cash Account balance at export date.
- Confirm ("Übernehmen") enabled only when no decision is open; summary compares Positions, invested capital and cash balance vs. Parqet, plus per-sale FIFO realized Gain/Loss vs. `realizedgains`, highlighting differences > €0.01 per sale (cent-level drift across many lots is acceptable overall).
- Export without cash rows: summary states cash could not be reconciled and offers an opening Deposit/Withdrawal.
- Public repo: reader tested only with a synthetic, anonymised fixture covering every quirk (`*.csv.txt` under `test/fixtures/`); real exports are never committed or read into the repo; reconciliation against real exports uses local untracked files.

## Technical Decisions

- **CorporateAction model** (created in 2.1) is owned and written only by `ledger`; Security-scoped, applies across all Depots. Transactions and stored Prices are never modified — core applies split adjustment on read. ISIN change links old and new Security (each its own row) with old/new quantity; core moves lots.
- Ordering: `(date, sequence)`; on the same date corporate actions apply before Transactions. Business dates `YYYY-MM-DD`; core gets "today" passed in.
- Core work lives in pure `src/core` (e.g. corporate-actions, FIFO, cash, duplicates) importing only its own files and `decimal.js`. Core tests: split between two buys + partial sell; 1:1 and non-1:1 ISIN change + partial sell.
- `core/duplicates` must resolve an incoming old ISIN to its current Security by following ISIN-change actions. Duplicate key: `(depotId, date, type, securityId|null, quantity|null, amount within €0.01)`; result `unique | duplicate | ambiguous`, advisory only. Migration matches against the existing ledger only, not within its own file; matches shown for decision before booking.
- `modules/migration` holds a pure CSV reader producing canonical Transaction proposals; booking goes through the single ledger write path (zod validation, sequence assignment oldest-first) in one DB transaction. Securities created only via idempotent `ledger.ensureSecurity` at confirmation, never during preview; ISIN changes booked as CorporateActions.
- Canonical Transaction shape: types `BUY SELL DIVIDEND FEE TAX DEPOSIT WITHDRAWAL`; `amount` unsigned gross (excl. fee/tax; dividend = gross total); `fee ≥ 0`; `tax` signed (+ paid, − refund); quantity/price only on BUY/SELL; standalone FEE/TAX use `amount = 0`. Cash effect: BUY −(amount+fee+tax); SELL/DIVIDEND +amount−fee−tax; FEE −fee; TAX −tax; DEPOSIT +amount; WITHDRAWAL −amount.
- Money/quantity/price as TEXT decimal strings via `decimal.js`; no JS `number`, Prisma Decimal or SQL arithmetic. EUR only — non-EUR rows go to review.
- Expected failures return typed results `{ ok: false, reason }`; zod at every shell boundary (upload, form, parser output). Never log per-Transaction amounts.
- Recording a split should trigger a price-history refetch for that Security once the prices module exists (Epic 3); stored Prices stay unadjusted.

## UX & Interaction Patterns

- Corporate actions start from the Position's row menu in the Positions table: "Corporate Action → Split" / "Corporate Action → ISIN-Wechsel"; new Security selectable or creatable.
- Migration wizard ("Aus Parqet übernehmen", in Settings and the Overview empty state — now enabled): file → target Depot → preview → resolve flagged rows / classify Securities → confirm → summary with Parqet comparison. Desktop-optimised but must work at phone width.
- No auto-booking, no optimistic writes, modal depth ≤ 1, Enter submits / Esc closes; German, short factual microcopy naming Depot and Security; gain/loss never by color alone.

## Cross-Story Dependencies

- Builds on Epic 1: ledger service, canonical shape, `ensureSecurity`, duplicate matcher, sequence, FIFO/cash core, Positions table, Settings Depots section.
- 2.1 creates the CorporateAction model; 2.2 extends it and the duplicate matcher's ISIN resolution.
- Migration (2.3/2.4) depends on 2.1–2.2 (ISIN-change proposals, split handling) and on the Cash Account (Epic 1). 2.4 consumes 2.3's preview.
- Later: Epic 5 document import must detect migrated Transactions as duplicates; Epic 3 price backfill must respect splits.
