# Epic 2 Context: Corporate Actions & Parqet Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy can record stock splits and ISIN changes, and bring his complete Transaction history from Parqet CSV exports into DepotManagement (one file per Depot) without making decisions row by row. Positions, invested capital and Cash Account balances must match Parqet at the export date. Every trade must be booked even when Parqet's cash rows do not match the trade figures or Parqet rounds fractional sell quantities. Money that Parqet never recorded as a deposit is booked as a deposit, so the Cash Account never goes negative. A Depot can be deleted so that a failed migration can be run again. Finally, he can reconcile any Depot against his broker statement position by position and fix genuine errors with holding corrections that neither touch cash nor fake a sale. After this epic he works with real data, so correctness and reconciliation matter more than features.

## Stories

- Story 2.1: Record Stock Splits
- Story 2.2: Record ISIN Changes
- Story 2.3: Parqet Export Preview
- Story 2.4: Confirm Migration and Reconcile with Parqet
- Story 2.5: Hands-off Parqet Migration
- Story 2.6: Funding for Exports without Cash Rows and Depot Deletion
- Story 2.7: Robust Cash Pairing and Rounding Tolerance in the Parqet Migration
- Story 2.8: Missing Deposits and Fee-Aware Gain Comparison in the Parqet Migration
- Story 2.9: Depot Reconciliation and Holding Corrections

## Requirements & Constraints

- **Splits:** ratio + effective date. Quantities and per-unit Prices before the split are shown split-adjusted; total Cost Basis does not change.
- **ISIN change:** old and new quantity (the ratio may differ from 1:1). Total Cost Basis and the original FIFO purchase dates are kept.
- **Migration success:** per Depot, Positions, invested capital and Cash Account balance match Parqet at export date. Cent-level drift across many lots is acceptable; Depot value and Cost Basis must be exact.
- **Realized gain check:** FIFO realized Gain/Loss is compared per sale with Parqet's `realizedgains`. A difference equal to the fees attributable to the sale (sell fee plus buy fees of the consumed FIFO lots, within €0.01) is labelled "Gebühren" and is not a deviation. Other differences above €0.01 are highlighted as deviations.
- **Hands-off:** the migration completes without per-row decisions. Asset types are estimated from names and stay editable later. Remaining flags never block "Übernehmen".
- **Minimal funding, every export** (with or without `Cash` rows): the migrated Cash Account never goes negative. Sale and dividend proceeds stay in cash and fund later buys. When funding was added, the summary's cash comparison explains that Parqet's own balance lacks deposits, instead of reporting a plain mismatch. The balance alignment from 2.4 can then set the final balance to the broker's value.
- **Mismatching cash rows never cause skipped trades.** Examples: fee omitted, withheld tax missing, dividend differences, one net cash row for a rebalancing instant. `cash-pair-mismatch` is not a flag. Every trade is booked with Parqet's quantity, price, amount and fee unchanged, so Positions and Cost Basis match Parqet.
- **Group differences:**
  - Inflow side (cash rows show less going out or more coming in than the trades explain): booked as a DEPOSIT, e.g. a savings contribution invested directly.
  - Outflow side: booked as TAX with a positive tax.
  - Contributions must never appear as negative TAX "refunds".
- **Rounding oversells:**
  - A migrated SELL exceeding the holding by ≤ 0.001 units is booked with the held quantity (amount, fee and tax unchanged).
  - The shortfall is subtracted from the quantity of the next BUY of that Security in the Depot (amount unchanged).
  - Larger oversells still stop booking with "Verkauf übersteigt Bestand".
- **Depot deletion** removes the Depot, its Transactions, import staging and caches. Securities and Prices shared with other Depots stay. Afterwards, the same export can be migrated again into a new Depot.
- **Duplicates:** later document imports of migrated Transactions must be detected as duplicates. Re-running the same file books only non-duplicates.
- **Depot reconciliation (2.9):**
  - A run per non-archived Depot is opened for a statement date and lists every Position held on that date plus the Cash Account, with the app's quantity/balance on that date, the entered statement value and a "stimmt" check.
  - Matching or checked rows count as reconciled; differing rows show the difference. Progress "x von y abgeglichen".
  - At most one open run per Depot; checks and entered values persist across sessions until "Abgleich abschließen" (asks once if rows are still open). The next run starts empty; the Depot shows "Zuletzt abgeglichen am <statement date>".
  - Holding correction = new Transaction type `ADJUSTMENT` ("Bestandskorrektur") on the statement date with the signed quantity difference. A positive difference adds a FIFO lot at a unit cost defaulting to the Position's average purchase price (editable); a negative one removes the oldest FIFO units at their Cost Basis. No cash effect, no realized Gain/Loss. Editable and deletable like any Transaction.
  - In TTWROR and XIRR the correction's market value is an external flow (inflow for +, outflow for −), so returns are not distorted.
  - Cash correction = DEPOSIT or WITHDRAWAL for the difference on the statement date, note "Kontoabgleich".
  - Reconciliation runs and their statement values are user-entered data (not derived), stored by `ledger`, and included in export/restore.
  - Unit tests for ADJUSTMENT in FIFO, cash and returns.
- **EUR only:** non-EUR rows are flagged, never booked.
- **Test data:** the repo is public, so tests use only synthetic, anonymised fixtures (`test/fixtures/*.csv.txt`). Real Parqet exports are never committed or read by agents.

## Technical Decisions

- **Ledger is the only truth:**
  - Positions, lots, balances and Cost Basis are computed on read by pure `src/core`.
  - Only the `ledger` service writes Depots, Securities, Transactions and CorporateActions (zod validation, sequence assignment, duplicate policy).
  - Migration and Depot deletion run through it in one DB transaction. Writing services accept an optional Prisma tx client.
- **Corporate actions:**
  - CorporateAction rows are scoped to the Security and apply in every Depot. Stored Transactions and Prices are never rewritten; core applies splits on read.
  - An ISIN change links the old and new Security. Core moves the open FIFO lots (dates and Cost Basis) to the new Security, scaled by the ratio.
  - On the same date, corporate actions apply before Transactions.
- **Canonical Transaction shape:** types BUY/SELL/DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL/ADJUSTMENT.
  - `amount` is the unsigned gross value; `fee ≥ 0`; `tax` is signed (negative = refund).
  - Only BUY/SELL carry quantity and price, except `ADJUSTMENT`: signed `quantity`, `price` = unit cost (for a positive quantity), `amount`/`fee`/`tax` = 0, cash effect 0. FIFO adds a lot (+) or removes the oldest units at Cost Basis without realized Gain/Loss (−); returns treat its market value as an external flow. Schema changes for the new type go into a new Prisma migration.
  - Cash effect, defined once in `core/cash`: BUY −(amount+fee+tax); SELL/DIVIDEND +amount−fee−tax; FEE −fee; TAX −tax; DEPOSIT +amount; WITHDRAWAL −amount.
- **Parqet mapping:**
  - Parsing: semicolons, decimal comma, newest rows first. Rows are submitted oldest-first, and `datetime` becomes a Europe/Berlin business date (synthetic times dropped).
  - Trades (BUY/SELL/DIVIDEND) and Cash rows sharing one instant form a group. Within it, trades pair 1:1 with cash rows first and collapse into one Transaction; leftover trades and cash rows are reconciled together.
  - Group difference (cash rows vs. summed derived cash effects) ≤ €0.01: adjust `amount` so the derived cash equals the cash row.
  - Group difference above €0.01, inflow side: one DEPOSIT on that date, sequenced before the group's trades.
  - Group difference above €0.01, outflow side: one standalone TAX Transaction (amount 0, positive tax; Security of the largest trade if the group has one Security, else none), sequenced after the group's trades.
  - Quantity, amount and fee are never changed to absorb a difference.
  - Dividends use `amount`, not price × shares. Negative tax means a refund. A `cost` row with only tax becomes a TAX Transaction.
  - Unpaired Cash TransferIn/Out become a DEPOSIT/WITHDRAWAL.
- **Pure functions with unit tests** (in `src/modules/migration` or `src/core`): grouping, group difference, inflow/outflow classification, shortfall carry, and fee attribution for the gain comparison.
- **Security transfers at one instant:**
  1. Pair by same ISIN first, giving a split (ratio = new/old quantity).
  2. Then a single out + single in of different ISINs gives an ISIN change.
  3. Each remaining TransferIn becomes a delivery: a BUY at Parqet's shares/price/amount plus a same-day DEPOSIT of equal amount (an external inflow).
  4. Only an unpaired TransferOut is flagged.
- **Funding:** one pure core function walks all proposals in `(date, sequence)` order with the running balance from `core/cash`. Before any proposal that would push the balance below zero, it inserts a same-day DEPOSIT for exactly the shortfall. Funding, contribution and delivery deposits are external flows for TTWROR/XIRR.
- **Securities:**
  - Created only via idempotent `ledger.ensureSecurity({isin}|{cryptoSymbol})` at confirmation, never during staging.
  - `AssetType` = STOCK | ETF | FUND | CERTIFICATE | CRYPTO | UNCLASSIFIED. FUND was added by a new Prisma migration.
  - A pure core classifier works by name, checking in order: ETF/ETC/ETN/UCITS ETF or an ETF issuer → ETF; Turbo/Knock-Out/Mini Future/Optionsschein/Open End → CERTIFICATE; SICAV/Fund/Funds/Fonds → FUND; otherwise STOCK.
  - Crypto rows stay CRYPTO, keyed by an upper-case symbol.
- **Duplicates:** one advisory `core/duplicates` returns `unique | duplicate | ambiguous` on the key (depotId, date, type, securityId, quantity, amount ±€0.01). Old ISINs resolve to the current Security via ISIN-change actions. Migration matches only against the existing ledger, never within its own file. Matches are shown for a decision, never auto-dropped.
- **Reconciliation storage:** runs (Depot, statement date, open/finished, per-row statement value and check) are owned and written by the `ledger` module. It is ledger data, not a cache: never derived, part of the AD-12 export/restore. App values per row are computed on read by core for the statement date. Corrections go through the ledger service like any write; archived Depots are read-only.
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
     - "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt" for cash-less files
     - "N fehlende Einzahlungen ergänzt" and "N Kontodifferenzen als Steuer gebucht", shown separately with their totals, plus "N Rundungsreste ausgeglichen"
     - fee-only gain differences labelled "Gebühren"
     - the resulting Positions and cash balance at export date
  3. One-click "Übernehmen".
  4. The summary shows the comparison with Parqet, the per-sale realized check and the skipped items.
- Depot reconciliation: Depot detail ⋮ "Depot abgleichen" → statement date → rows per Position plus Cash Account (app value, statement input, "stimmt" check, ✅ "abgeglichen" when matched). Differing rows show the difference, "Buchungen ansehen" (the Security detail history in this Depot, possible duplicates marked via `core/duplicates`) and "Korrektur buchen". Header shows "x von y abgeglichen"; "Abgleich abschließen" ends the run; Depot detail shows "Zuletzt abgeglichen am …". Corrections appear in the history as "Bestandskorrektur".
- Settings → Depots → "Depot löschen": confirm by typing the Depot's name. The dialog states how many Transactions will be deleted and that this cannot be undone.
- General rules: German microcopy, de-DE formats. No optimistic writes, no hover-only actions, modal depth ≤ 1. Gain/loss is never shown by color alone. Desktop is the primary surface for migration.

## Cross-Story Dependencies

- **Prerequisites:** 2.1 and 2.2 (CorporateAction model, split/ISIN-change core) come before the migration's split and ISIN-change proposals. The migration also relies on Epic 1: ledger service, `core/cash`, `core/duplicates`, `ensureSecurity`.
- **How the migration stories build on each other:**
  - 2.3 builds the pure reader and preview; 2.4 confirms, books and reconciles.
  - 2.5 reworks 2.3/2.4: it adds the FUND type and the classifier, removes mandatory classification and transfer decisions, and adds splits/deliveries.
  - 2.6 adds funding for cash-less exports and Depot deletion.
  - 2.7 reworks cash pairing and oversell handling (removes `cash-pair-mismatch`; group differences become TAX).
  - 2.8 refines 2.6/2.7: inflow-side differences become DEPOSITs, minimal funding applies to every export, and the gain comparison becomes fee-aware.
- **Operator verification:** Story 2.4 stays at operator verification; its real-data checks run after 2.5–2.8. After 2.8, a throwaway end-to-end run should show no negative cash, no negative TAX from contributions and only non-fee gain deviations. Tommy then migrates all three Depots, aligns each Cash Account to the broker balance and confirms 2.4.
- **Story 2.9** is independent of the migration stories (2.3–2.8, all done) but builds on Epic 1 (ledger service, FIFO, `core/cash`, `core/duplicates`, Transaction form/history, Depot detail), Epic 4 (returns per AD-10; Security detail page from 4.6 for "Buchungen ansehen") and must keep Epic 6 export/restore (still backlog) in mind: runs and the ADJUSTMENT type must be exported and restored. Trigger: holding differences against brokers came from trades after the Parqet exports and a cominvest export ending early, not from app errors; the run lets Tommy verify every holding and fix genuine errors.
- **Downstream:**
  - Epic 3 (classification UI) and Epic 4 (composition "Fonds" segment) must handle FUND.
  - Epic 5 document import must detect migrated Transactions as duplicates.
  - Epic 4 returns treat delivery, funding and contribution deposits as external inflows, and ADJUSTMENT market value as an external flow.
  - Epic 6 export/restore must carry reconciliation runs and ADJUSTMENT Transactions.
