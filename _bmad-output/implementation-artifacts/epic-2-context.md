# Epic 2 Context: Corporate Actions & Parqet Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy can record stock splits and ISIN changes, and can bring his complete Transaction history over from Parqet CSV exports (one file per Depot) without making decisions row by row. After that, Positions, invested capital and Cash Account balances match what Parqet showed on export day, and FIFO realized Gain/Loss matches Parqet's per-sale `realizedgains`. From this point on he works with real data, so the migration has to be correct and complete in minutes.

## Stories

- Story 2.1: Record Stock Splits
- Story 2.2: Record ISIN Changes
- Story 2.3: Parqet Export Preview
- Story 2.4: Confirm Migration and Reconcile with Parqet
- Story 2.5: Hands-off Parqet Migration (added by the approved sprint change; reworks 2.3/2.4 behavior)

## Requirements & Constraints

- Splits: ratio plus effective date. Quantities and per-unit prices before the effective date are shown split-adjusted, and total Cost Basis is unchanged.
- ISIN changes: old and new quantity (the ratio may differ from 1:1). Total Cost Basis and the original FIFO purchase dates carry over to the new Security. The old Security stops being an open Position after the change, but its history stays visible.
- Migration input: one Parqet CSV per Depot, with the target Depot chosen at upload. The format is semicolon-delimited, text quoted, German decimal comma, newest rows first, ISO UTC `datetime`. `assettype` is `Security`, `Cash` or `Crypto`. `type` is `Buy`, `Sell`, `Dividend`, `TransferIn`, `TransferOut` or `cost`.
- Format quirks to handle:
  - Each trade or dividend has a paired Cash transfer. Collapse the pair into one Transaction, and on a rounding mismatch adjust `amount` so the derived cash booking equals the cash row.
  - Dividends: use `amount`, not `price × shares`, because dividend rows sometimes show `shares=1`.
  - A negative `tax` is a refund.
  - A `cost` row that has only `tax` becomes a TAX Transaction.
  - An unpaired Cash TransferIn/TransferOut becomes a Deposit/Withdrawal.
  - Drop the synthetic times and convert `datetime` to the Europe/Berlin business date.
  - Quantities can be fractional, up to 8 decimals.
- Grouping of Security transfers at the same instant (in this order):
  1. A TransferOut and TransferIn of the same ISIN become a split (ratio = new qty / old qty).
  2. A single remaining out plus in of different ISINs becomes an ISIN change.
  3. Each remaining TransferIn becomes a delivery: a BUY at Parqet's shares, price and amount, plus a DEPOSIT of the same amount on the same date. The Cash Account stays unchanged and the delivery counts as an external inflow.
  4. Only a remaining unpaired TransferOut is flagged.
- Flags (unpaired TransferOut, `non-eur`, `unparseable`, `unsupported-row`, `cash-pair-mismatch`) do not block. They are listed collapsed as "Nicht übernommen (n)". "Alle wie in Parqet übernehmen" books every flag that has a valid prefilled correction and skips the rest. The summary lists what was skipped.
- Asset types: add `FUND` ("Fonds", active mutual fund) through a new Prisma migration. It must be selectable wherever an asset type is chosen (new-Security form, ISIN-change dialog, migration preview).
- New Parqet `Security` rows are classified by a pure core name classifier, checked in this order:
  1. ETF/ETC/ETN/"UCITS ETF", or one of the issuers iShares, Xtrackers, Vanguard, Amundi, Lyxor, SPDR, Invesco, WisdomTree → ETF
  2. Turbo/Knock-Out/Mini Future/Optionsschein/Open End → CERTIFICATE
  3. SICAV/Fund/Funds/Fonds → FUND
  4. otherwise → STOCK

  `Crypto` rows stay CRYPTO, keyed by symbol. Classification is never an open decision: the preview offers an inline override, and the type stays editable later.
- On an empty Depot the preview must have zero open decisions, and "Übernehmen" must be enabled immediately. Duplicate matches against an existing ledger are still shown for a decision.
- Reconciliation summary:
  - Show Positions, invested capital and Cash Account balance next to the values the file implies at export date.
  - Compare FIFO realized Gain/Loss with `realizedgains` per sale and highlight differences above €0.01.
  - If the file has no cash rows, say so and offer an opening Deposit/Withdrawal.
- The migration is repeatable per Depot. Re-running the same file books only the rows that are not duplicates.
- Correctness: Depot value and Cost Basis must be exact. Cent-level drift in realized Gain/Loss summed over many lots is acceptable.
- Tests use synthetic, anonymised fixtures only (`*.csv.txt` under `test/fixtures/`). They must cover every format quirk, the five-row TransferIn delivery group, a same-ISIN split pair and fund/ETC names. Real exports are never committed or read into the repo.

## Technical Decisions

- **Corporate actions:**
  - Stored as CorporateAction rows on the Security, written only by `ledger`. They apply in every Depot that holds the Security.
  - Stored Transactions and Prices are never modified. Core applies split adjustment on read.
  - An ISIN change links the old and new Security (each its own row) with old and new quantity. Core moves the open FIFO lots, scaled by the ratio, with their original dates and total Cost Basis.
- **Ordering:** by `(date, sequence)`, and on the same date corporate actions apply before Transactions. Only the ledger assigns sequence. Migration submits rows oldest-first. Core gets "today" passed in.
- **Single write path:** migration builds AD-14 proposals in `modules/migration`, using a pure reader with no DB access during preview. On confirm it books everything through the ledger service in one DB transaction:
  - Securities via idempotent `ledger.ensureSecurity({ isin } | { cryptoSymbol })`, only at confirmation and never during staging.
  - Splits and ISIN changes as CorporateActions.
- **Canonical Transaction shape:**
  - Types are BUY/SELL/DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL.
  - `amount` is unsigned gross; `fee ≥ 0`; `tax` is signed (negative = refund).
  - `quantity`/`price` are set only on BUY/SELL.
  - Standalone FEE/TAX have `amount = 0`.
  - The cash effect is derived only in `core/cash`: BUY −(amount+fee+tax); SELL/DIVIDEND +amount−fee−tax; FEE −fee; TAX −tax; DEPOSIT +amount; WITHDRAWAL −amount.
- **Cash Account:** the Cash Account is the Depot (1:1, no table). Only Deposit and Withdrawal are cash-only Transactions.
- **Duplicates:** `core/duplicates` is advisory and returns `unique | duplicate | ambiguous`.
  - Match key: `(depotId, date, type, securityId|null, quantity|null, amount ±€0.01)`.
  - An incoming old ISIN is first resolved to the current Security by following ISIN-change actions.
  - Migration matches against the existing ledger only, not within its own file.
- **Asset type enum:** `STOCK | ETF | FUND | CERTIFICATE | CRYPTO | UNCLASSIFIED`. `UNCLASSIFIED` is kept only for Securities that no path could classify. Only `ledger` writes the name and assetType.
- **Decimals:** money, quantities and prices are TEXT decimal strings handled with `decimal.js`. Never use JS `number`, Prisma Decimal or SQL arithmetic on them.
- **Pure core:** `src/core` stays pure. The classifier, split and ISIN-change logic and the duplicate matcher live there.
- **Prisma migrations:** never edit a committed Prisma migration; add a new one. After a schema change, run `npx prisma generate`.
- **Errors:** expected failures return typed `{ ok: false, reason }` results; zod validates at shell boundaries.

## UX & Interaction Patterns

- **Corporate actions entry:** the row menu of a Position in the Positions table, "Corporate Action → Split" or "→ ISIN-Wechsel". The new Security for an ISIN change can be selected or created there.
- **Migration entry:** "Aus Parqet übernehmen" in Settings and in the Overview empty state when there is no Depot.
- **Migration wizard:**
  1. Choose the file, then the target Depot.
  2. Preview: counts per type, detected splits, ISIN changes and deliveries, the estimated asset type per Security with an inline override, a collapsed "Nicht übernommen (n)" list, and the resulting Positions and cash balance at export date.
  3. One-click "Übernehmen".
  4. Summary with the Parqet comparison.
- **General rules:** German UI and de-DE formats; no optimistic writes; nothing is booked without being shown first; modal depth ≤ 1. Desktop is the primary surface for migration, but it must still work at phone width.

## Cross-Story Dependencies

- 2.1 and 2.2 add the CorporateAction model and the core logic that 2.3–2.5 reuse when migrating split and ISIN-change pairs. 2.2 also extends `core/duplicates` with ISIN-change resolution.
- 2.3 (preview/reader) → 2.4 (confirm/reconcile) → 2.5 (hands-off rework of both).
  - 2.4 stays `awaiting-operator`. Its operator check (real-export reconciliation) runs only after 2.5 is done.
- These stories build on Epic 1: the ledger service, `ensureSecurity`, FIFO/cash core, the duplicate matcher and the Transaction form.
- Downstream effects of `FUND`:
  - Epic 3 (Securities page, Story 3.1) must offer FUND when classifying a Security.
  - Epic 4 composition (Story 4.5) gets a "Fonds" segment.
