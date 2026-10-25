# Epic 2 Context: Corporate Actions & Parqet Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy can record stock splits and ISIN changes, and bring his complete Transaction history from Parqet CSV exports into DepotManagement (one file per Depot) without making decisions row by row. Positions, invested capital and Cash Account balances must match Parqet at the export date. Exports without cash rows get a sensible Cash Account, and a Depot can be deleted so that a failed migration can be run again. After this epic he works with real data, so correctness and reconciliation matter more than features.

## Stories

- Story 2.1: Record Stock Splits
- Story 2.2: Record ISIN Changes
- Story 2.3: Parqet Export Preview
- Story 2.4: Confirm Migration and Reconcile with Parqet
- Story 2.5: Hands-off Parqet Migration
- Story 2.6: Funding for Exports without Cash Rows and Depot Deletion

## Requirements & Constraints

- Splits: ratio + effective date; quantities and per-unit Prices before the split are shown split-adjusted, and total Cost Basis does not change. ISIN change: old and new quantity (the ratio may differ from 1:1); total Cost Basis and the original FIFO purchase dates are kept.
- Migration success: per Depot, Positions, invested capital and Cash Account balance match Parqet at export date. FIFO realized Gain/Loss is compared per sale with Parqet's `realizedgains`, and differences above €0.01 are highlighted. Cent-level drift across many lots is acceptable; Depot value and Cost Basis must be exact.
- Hands-off: the migration completes without per-row decisions. Asset types are estimated from names and stay editable later. Remaining flags never block "Übernehmen".
- Cash-less exports (no `Cash` rows at all, e.g. comdirect/cominvest autosync): the migration inserts minimal funding deposits so cash never goes negative. Sale and dividend proceeds stay in cash and fund later buys. Exports with cash rows are processed exactly as before. The balance-alignment Deposit/Withdrawal from 2.4 can then set the final balance to the broker's value.
- Depot deletion removes the Depot, its Transactions, import staging and caches. Securities and Prices shared with other Depots stay. Afterwards, the same export can be migrated again into a new Depot.
- Later document imports of migrated Transactions must be detected as duplicates. Re-running the same file books only non-duplicates.
- EUR only: non-EUR rows are flagged, never booked.
- Public repo: tests use only synthetic, anonymised fixtures (`test/fixtures/*.csv.txt`). Real Parqet exports are never committed or read by agents.

## Technical Decisions

- **Ledger is the only truth:** Positions, lots, balances and Cost Basis are computed on read by pure `src/core`. Only the `ledger` service writes Depots, Securities, Transactions and CorporateActions (zod validation, sequence assignment, duplicate policy). Migration and depot deletion run through it in one DB transaction. Writing services accept an optional Prisma tx client.
- **Corporate actions:** CorporateAction rows are scoped to the Security and apply in every Depot. Stored Transactions and Prices are never rewritten; core applies splits on read. An ISIN change links old and new Security, and core moves the open FIFO lots (dates and Cost Basis) to the new Security, scaled by the ratio. On the same date, corporate actions apply before Transactions.
- **Canonical Transaction shape:** types BUY/SELL/DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL.
  - `amount` is the unsigned gross value; `fee ≥ 0`; `tax` is signed (negative = refund).
  - Only BUY/SELL carry quantity and price.
  - Cash effect, defined once in `core/cash`: BUY −(amount+fee+tax); SELL/DIVIDEND +amount−fee−tax; FEE −fee; TAX −tax; DEPOSIT +amount; WITHDRAWAL −amount.
- **Parqet mapping:**
  - Parsing: semicolons, decimal comma, newest rows first. Rows are submitted oldest-first, and `datetime` becomes a Europe/Berlin business date (synthetic times dropped).
  - Trade/dividend rows and their Cash pair collapse into one Transaction. On a rounding mismatch, `amount` is adjusted so the derived cash equals the cash row.
  - Dividends use `amount`, not price × shares. Negative tax means a refund. A `cost` row with only tax becomes a TAX Transaction.
  - Unpaired Cash TransferIn/Out become a DEPOSIT/WITHDRAWAL.
- **Security transfers at one instant:**
  1. Pair by same ISIN first, giving a split (ratio = new/old quantity).
  2. Then a single out + single in of different ISINs gives an ISIN change.
  3. Each remaining TransferIn becomes a delivery: a BUY at Parqet's shares/price/amount plus a same-day DEPOSIT of equal amount (an external inflow).
  4. Only an unpaired TransferOut is flagged.
- **Funding for cash-less exports:** one pure core function walks the proposals in `(date, sequence)` order with the running balance from `core/cash`. Before any proposal that would push the balance below zero, it inserts a same-day DEPOSIT for exactly the shortfall. These deposits are external flows for TTWROR/XIRR.
- **Securities:** created only via idempotent `ledger.ensureSecurity({isin}|{cryptoSymbol})` at confirmation, never during staging. `AssetType` = STOCK | ETF | FUND | CERTIFICATE | CRYPTO | UNCLASSIFIED (FUND was added by a new Prisma migration). A pure core classifier works by name, checking in order: ETF/ETC/ETN/UCITS ETF or an ETF issuer → ETF; Turbo/Knock-Out/Mini Future/Optionsschein/Open End → CERTIFICATE; SICAV/Fund/Funds/Fonds → FUND; otherwise STOCK. Crypto rows stay CRYPTO, keyed by an upper-case symbol.
- **Duplicates:** one advisory `core/duplicates` returns `unique | duplicate | ambiguous` on the key (depotId, date, type, securityId, quantity, amount ±€0.01). Old ISINs resolve to the current Security via ISIN-change actions. Migration matches only against the existing ledger, never within its own file; matches are shown for a decision, never auto-dropped.
- **Data formats:** money, quantity and price are TEXT decimal strings computed with decimal.js only, with no SQL arithmetic. Dates are `YYYY-MM-DD`, ordered by `(date, sequence)`. "Today" is passed into core. Expected failures return `{ ok: false, reason }`.
- **Migrations:** never edit a committed Prisma migration; add a new one.

## UX & Interaction Patterns

- Corporate actions start from the Position row menu: "Corporate Action → Split" / "ISIN-Wechsel". The ISIN change lets the user select or create the new Security.
- Migration wizard ("Aus Parqet übernehmen", from Settings or the empty Overview):
  1. Choose the file, then the target Depot.
  2. The preview shows:
     - counts per type
     - detected splits, ISIN changes and deliveries
     - the estimated asset type per Security, with an inline override
     - a collapsed "Nicht übernommen (n)" section, with "Alle wie in Parqet übernehmen"
     - the note "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt" for cash-less files
     - the resulting Positions and cash balance at export date
  3. One-click "Übernehmen".
  4. The summary shows the comparison with Parqet, the per-sale realized check and the skipped items.
- Settings → Depots → "Depot löschen": confirm by typing the Depot's name. The dialog states how many Transactions will be deleted and that this cannot be undone.
- General rules: German microcopy, de-DE formats. No optimistic writes, no hover-only actions, modal depth ≤ 1. Gain/loss is never shown by color alone. Desktop is the primary surface for migration.

## Cross-Story Dependencies

- 2.1 and 2.2 (CorporateAction model, split/ISIN-change core) are prerequisites for the migration's split and ISIN-change proposals. The migration also relies on Epic 1: ledger service, `core/cash`, `core/duplicates`, `ensureSecurity`.
- 2.3 builds the pure reader and preview; 2.4 confirms, books and reconciles. 2.5 reworks 2.3/2.4: it adds the FUND type and the classifier, removes mandatory classification and transfer decisions, and adds splits/deliveries. 2.6 adds cash-less funding and Depot deletion on top of 2.5.
- Story 2.4 stays at operator verification; its real-data checks run after 2.5/2.6. Operator flow: delete the cominvest Depot, recreate it, re-migrate, align the balance.
- Downstream: Epic 3 (classification UI) and Epic 4 (composition "Fonds" segment) must handle FUND. Epic 5 document import must detect migrated Transactions as duplicates. Epic 4 returns treat delivery and funding deposits as external inflows.
