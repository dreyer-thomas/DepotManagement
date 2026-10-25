---
type: architecture-review
lens: adversary (compliant-but-incompatible unit pairs)
target: ../ARCHITECTURE-SPINE.md
context: prd.md, addendum.md (prd-DepotManagement-2026-10-25)
date: 2026-10-25
---

# Adversarial Review — Architecture Spine DepotManagement

## Verdict

**Not build-ready. 16 holes, 6 of them critical.** The spine is strong on *where* code lives and *who may write* (AD-1..AD-3 hold up). It is weak on *what the shared data means*. AD-6 says a Transaction row "carries amount, fee and tax" and nothing more. It never says whether `amount` is gross or net, what sign it has, what `quantity`/`price` mean for a dividend, or what the FR-6 duplicate key reads. So Import, Migration, Manual entry and `core/cash` can each follow every AD exactly and still write rows that mean different things. The first visible symptom would be FR-6 (duplicates missed after migration, so the same trade is booked twice). The second would be FR-15/FR-17 (Cash Account balances that do not reconcile).

Further structural holes: restore is routed through the duplicate matcher (AD-3) even though it is a bulk replace (AD-12). Split adjustment can be applied twice (once by the provider, once by AD-7). Security creation and Security metadata have no single owner. Archived Depots have no rule outside the Portfolio total.

Method: for each hole, two epics/units are built so that both follow every AD to the letter. They still end up incompatible. Each hole ends with one enforceable rule to add or tighten in the spine.

---

## Critical holes

### H1 — Transaction money semantics are undefined (gross vs net, sign, fee/tax inclusion)

- **Pair:** *Document Import* (ROBIN/comdirect parsers) vs *Parqet Migration*, with `core/cash` as the third victim.
- **Compliant build A (Import):** The parser maps the PDF "Kurswert" to `amount` (gross, positive) and "Provision" to `fee`. It maps "Kapitalertragsteuer + Soli + KiSt" to `tax`. `core/cash` derives the buy cash booking as `-(amount + fee + tax)`.
- **Compliant build B (Migration):** AD-6 says that where trade and cash pair differ, "the cash row's amount becomes the booked amount". Parqet's cash pair is the *net settlement* (already including fee and tax). So migration stores a net `amount` *and* also fills `fee`/`tax` from the CSV columns. It also keeps Parqet's sign convention (the sign of `amount` per type).
- **Clash:**
  - (a) `core/cash` subtracts fee and tax a second time on every migrated trade, so FR-15's "Cash Account balance matches Parqet" fails.
  - (b) FR-6 compares `amount` within €0.01. The imported gross amount never matches the migrated net amount, so FR-15's "later documents detected as duplicates" fails silently and trades are **double-booked**.
  - (c) Negative `tax` (a refund, addendum A1) is a valid decimal in both builds, but only one of them treats it as cash in.
- **Also exposed:** AD-6's own sentence is ambiguous. "Amount" can mean the trade amount or the settlement amount, and AD-6 assigns it the Parqet *cash* value in one case only.
- **Proposed rule (tighten AD-6):** *`amount` is the unsigned gross value of the event, never including fee or tax (BUY/SELL = price × quantity as booked, DIVIDEND = gross total distribution, FEE/TAX/DEPOSIT/WITHDRAWAL = the moved sum). `fee` is ≥ 0. `tax` is signed (positive = paid, negative = refund). The direction comes only from `type`. `core/cash` alone derives the settlement as a fixed per-type formula. Every writer (parser, migration, form, restore) must map to this before calling the ledger service, and the Parqet rounding fix-up adjusts `amount` so that the derived settlement equals the Parqet cash row.*

### H2 — Dividend shape and the FR-6 duplicate key are underspecified

- **Pair:** *Document Import* (dividend confirmations) vs *Parqet Migration*; also *Manual entry* vs *Duplicate matching* (`core/duplicates`).
- **Compliant build A:** The dividend parser stores `quantity` = shares entitled and `price` = dividend per share (that is what the PDF states).
- **Compliant build B:** Migration copies Parqet's `shares=1, price=amount` dividends verbatim. The addendum says to use `amount`, but it says nothing about `quantity`.
- **Clash:**
  - FR-6 matches on *quantity*, so the same dividend arrives as quantity 1 vs quantity 37 and is never detected as a duplicate.
  - Worse, if any core function sums `quantity` without checking the type, a quantity-1 dividend changes a Position.
  - For FEE/TAX/DEPOSIT/WITHDRAWAL, the key fields "ISIN" and "quantity" do not exist. One implementer matches on `securityId IS NULL`, another skips the duplicate check for these types. As a result, a re-imported standalone tax document is either double-booked or every equal-sum Deposit is flagged.
  - The FR-6 key names *ISIN*, but Transactions reference `securityId`. After an ISIN change (AD-7), an imported old-ISIN document is compared against which Security?
- **Proposed rule (new AD, "Transaction shape & duplicate key"):** *`quantity` and `price` are set only for BUY and SELL (and must be null for every other type). DIVIDEND, FEE and TAX may reference a Security; DEPOSIT and WITHDRAWAL must not. The FR-6 key is exactly `(depotId, date, type, securityId-or-null, quantity-or-null, amount ±0.01)` on the H1-normalised `amount`, computed by one `core/duplicates` function, and an incoming ISIN is resolved to its current Security through ISIN-change CorporateActions before matching.*

### H3 — Restore vs the single write path: duplicate matching and cross-module atomicity

- **Pair:** *Backup* (restore) vs *Ledger*; also *Backup* vs *Prices*.
- **Compliant build A (Ledger):** AD-3 says restore "calls the same ledger service, which validates and runs the FR-6 duplicate match before persisting". So `ledger.addTransaction()` flags matches.
- **Compliant build B (Backup):** Backup follows AD-12 ("replaces all data in one transaction") and AD-2 (it may only call `ledger` and `prices` service functions).
- **Clash:**
  - A real ledger legitimately contains identical savings-plan buys on the same day (FR-6's own example). Replayed through the matcher, they come back "ambiguous". Restore must then either abort or drop rows, and FR-16 "identical evaluations" fails.
  - Restore also has to write Price and ProviderMapping (owned by `prices`) plus Depot/Security/Transaction (owned by `ledger`) in *one* DB transaction. No AD lets a service accept an outer transaction. Two compliant service APIs that each open their own `prisma.$transaction` cannot be composed, so restore is either non-atomic or reaches into foreign models (violating AD-2).
  - Restore deletes Depots, but staging (`ImportBatch`, owned by `import`, FK to Depot per the ER diagram) is excluded from the backup. Its rows then dangle or block the delete.
- **Proposed rule (tighten AD-3/AD-12):** *Restore calls a dedicated `ledger.replaceAll` (and `prices.replaceAll`) that validates schema and referential integrity but skips FR-6 matching and preserves IDs and sequence numbers verbatim. Every module service that writes accepts an optional Prisma transaction client, so that backup can run all `replaceAll` calls plus `import.clearStaging` and cache truncation inside one `$transaction`.*

### H4 — Split adjustment can be applied twice; transaction-sourced Prices are stored derivatives

- **Pair:** *Prices* (Yahoo provider adapter) vs *Overview/Chart* (`core/valuation` + `core/corporate-actions`).
- **Compliant build A (Prices):** The adapter returns `fetchHistory` closes in EUR per date, exactly as AD-9 says. Yahoo's chart `close` is **already split-adjusted**.
- **Compliant build B (Core):** AD-7 says "split adjustment of quantities and Prices is applied by core on read" for every Price before the split date.
- **Clash:**
  - Provider prices before a split are divided by the ratio twice. The chart shows a cliff at the split date, and TTWROR/XIRR are wrong.
  - Manual and transaction prices are as-traded, so after the fix they need the opposite treatment from provider prices. No AD says which representation is stored.
  - Second clash in the same area: AD-9 lists a stored `transaction` price source. If `ledger` writes those Price rows on every Transaction write, they are a persisted derivative. Editing or deleting the Transaction leaves a stale Price behind, which violates AD-1, and backup exports them (AD-12) as if they were primary data. If `core` instead derives them on read, the Prices module's "source: transaction" column is never written. Either way the dividend `shares=1, price=amount` rows (H2) produce absurd "transaction prices".
- **Proposed rule (tighten AD-7/AD-9):** *Stored Prices are always as-traded (unadjusted) closes. Each provider adapter must return unadjusted values (or undo the provider's adjustment using the stored CorporateActions) and is tested against a known split. Transaction prices are never stored: `core/prices` derives them from BUY/SELL rows on read, so the `Price.source` enum is `manual | provider` only.*

### H5 — Security creation and Security metadata have several writers and no identity rule for crypto

- **Pair:** *Document Import* vs *Parqet Migration* vs *Manual entry*; and *Ledger* vs *Prices* (OpenFIGI resolution).
- **Compliant builds:**
  - Import creates the Security when parsing (so staging rows can hold a `securityId`).
  - Migration creates it at confirm, with `assetType` taken from Parqet's `assettype`. That value is only ever `Security|Crypto|Cash`, so stock/ETF/certificate are indistinguishable.
  - Manual entry creates it from a form with a user-chosen type.
  - Prices resolves a mapping with OpenFIGI/Yahoo, receives name and security type, and "helpfully" updates the Security. Under AD-2 it cannot write that model, so it stores the values in ProviderMapping instead, and there are now two names and two types.
  - Crypto: AD conventions say Securities are found by "crypto symbol". Migration stores `BTC` (Parqet `identifier`). The prices team stores `BTC-EUR` (Yahoo symbol) as the identity, and a manual user types `Bitcoin`. Only ISIN is unique, so nothing stops three BTC rows.
- **Clash:**
  - Import violates AD-4 by writing ledger rows before confirmation (or AD-3 if it writes through `import`).
  - FR-13 composition by asset type is wrong for every migrated Security.
  - Duplicate Securities split one Position into several.
- **Proposed rule (new AD, "Security identity & ownership"):** *Securities are created only by `ledger.ensureSecurity({isin | cryptoSymbol})`, which is idempotent, is called at confirmation time (never during parsing/staging), and enforces uniqueness on ISIN and on an upper-case base crypto symbol (e.g. `BTC`, never a provider pair). `ledger` alone writes name and `assetType`. Prices/OpenFIGI may only return suggestions through a ledger service call, and a Security whose type cannot be determined is stored as `UNCLASSIFIED` and flagged for the user, never guessed.*

### H6 — Archived Depot semantics exist only for the Portfolio total

- **Pair:** *Overview/Composition* vs *Prices scheduler*; *Import* vs *Ledger*; *News* vs *Overview*.
- **Compliant builds:**
  - Overview excludes archived Depots from Portfolio totals (FR-1, AD-10), but the archived Depot's own page still computes values (its "history remains viewable").
  - The Prices scheduler fetches for "all held Securities" (FR-7) and computes holdings over *non-archived* Depots only. The archived Depot's chart then carries forward a months-old price and flags it stale forever.
  - News uses "held" across all Depots, so headlines appear for Positions that are not in any visible total.
  - Import lists Depots in its upload picker without filtering. Ledger has no archive guard, so new Transactions land in an archived Depot and silently stay out of the Portfolio.
  - Composition "by Depot" either shows a 0% slice or omits it.
- **Proposed rule (new AD, "Archived Depot"):** *An archived Depot is read-only: the ledger service rejects every write to it (unarchive first), and archiving is rejected while it holds open Positions or a non-zero Cash Account balance. Hence "held Securities" for prices and news is defined by one core function over non-archived Depots, and archived Depots are excluded from every aggregate (Portfolio, composition, news) but remain individually viewable using their last stored Prices.*

---

## Further holes

### H7 — Cash Account identity

- **Pair:** *Parqet Migration* vs *Backup/Composition*.
- **The conflict:**
  - Migration sees Parqet's `holding`/`holdingname` columns and, to meet FR-15's "Cash Account balance matches", creates a `CashAccount` row, or treats the cash holding as a pseudo-Security with assetType `Cash`.
  - The ER diagram has no CashAccount entity, AD-6 derives cash, and FR-16 still promises "identical Cash Accounts" after restore.
  - Composition's "cash" slice reads one representation, migration writes another.
  - A Parqet file that contains more than one cash holding (or cash rows of a different holding id) is not addressed at all.
- **Proposed rule:** *A Cash Account has no table and no Security row: its identity is `depotId` and its balance and history are `core/cash` output. Migration maps exactly one Parqet cash `holding` id per file to the target Depot and rejects a file that contains more than one.*

### H8 — Sequence number ownership

- **Pair:** *Parqet Migration* vs *Manual entry* vs *Backup*.
- **The conflict:**
  - AD-8 requires `(date, sequence)` but does not say who assigns it.
  - Migration numbers rows in file order, which is newest first (addendum A1), so same-day buy-then-sell becomes sell-then-buy and the FIFO result is wrong.
  - Manual entry uses `count+1`, which collides after deletes.
  - Restore renumbers.
  - Import of a document dated in the past gets which sequence relative to existing same-day rows?
- **Proposed rule:** *The ledger service alone assigns `sequence` (max+1 within depot/date) unless the caller passes an explicit order. Migration must pass rows in chronological order (reversing the CSV), restore preserves stored sequences verbatim, and `(depotId, date, sequence)` is a unique DB constraint.*

### H9 — Split scope: Depot or Security?

- **Pair:** *Corporate actions (FR-3 manual)* vs *Prices/Chart*.
- **The conflict:**
  - The ER diagram links CorporateAction to both Depot and Security. Manual entry records a split per Depot (it is entered from a Depot screen).
  - Price adjustment (H4) is per Security, so a split recorded in Depot A only adjusts Prices for Depot B's chart as well, or not at all, depending on the implementer.
  - ISIN changes come from Parqet per Depot with per-Depot quantities, but other Depots holding the same old ISIN get no event.
- **Proposed rule:** *A SPLIT CorporateAction is Security-scoped (`depotId` null) and applies to every Depot and every Price. An ISIN_CHANGE is Depot-scoped (it carries that Depot's old/new quantity), and the ledger service warns when another non-archived Depot still holds the old Security after the event date.*

### H10 — "Invested capital" has two plausible definitions

- **Pair:** *Overview (FR-10)* vs *Value chart (FR-11)*.
- **The conflict:**
  - Overview computes invested capital as the sum of open FIFO Cost Basis.
  - The chart's "invested capital" line uses cumulative Deposits − Withdrawals, because AD-10 makes those the external flows and the chart is "value incl. cash".
  - Both follow AD-1/AD-10, and on the same screen they show different numbers for the same label. FR-15 "invested capital matches Parqet" picks neither.
- **Proposed rule:** *"Invested capital" is defined once in `core/valuation` (proposed: cumulative net external flows, i.e. Deposits − Withdrawals − taxes per AD-10, per Depot) and every screen and chart consumes that single function. Open Cost Basis is labelled "Cost Basis", never "invested capital".*

### H11 — File-hash re-upload vs transaction-level duplicate status

- **Pair:** *Document Import* vs *Manual edit/delete in Ledger*.
- **The conflict:**
  - AD-4 stores the file hash "to recognise a re-upload". Import marks a re-uploaded file as `duplicate` by hash alone.
  - The user deleted the wrongly-parsed Transaction from that file earlier and wants to re-import it after a parser fix, but import refuses.
  - A different implementer ignores the hash and lets FR-6 decide.
- **Proposed rule:** *The file hash is informational only (shown as "uploaded before on …"). An ImportItem's `duplicate` status is always computed by FR-6 against the current ledger at review time and recomputed at confirmation.*

### H12 — Standalone tax and fee rows: where does the money go?

- **Pair:** *Parqet Migration* (`cost` row, amount 0, tax set) vs *Manual entry* (TAX form).
- **The conflict:**
  - Migration creates `TAX` with `amount=0, tax=12.34`.
  - The manual form creates `TAX` with `amount=12.34, tax=0`.
  - `core/cash` handles one of them, and the FR-12 "taxes paid" figure sums the `tax` column, so it misses manual taxes.
- **Proposed rule (corollary of H1):** *For FEE and TAX type rows the value lives in `amount` and the `fee`/`tax` columns must be zero. The "taxes paid" figure is `Σ tax on BUY/SELL/DIVIDEND + Σ amount of TAX rows`, computed in one core function.*

### H13 — Staging proposals reference Securities and Depots that may change

- **Pair:** *Document Import staging* vs *Ledger (ISIN change, archive, restore)*.
- **The conflict:** Staged proposals sit unconfirmed for days. Meanwhile an ISIN change or archive (or restore, H3) happens. At confirmation, the proposal books onto the old Security or the archived Depot, or fails with a foreign-key error.
- **Proposed rule:** *Staged proposals store raw identifiers (ISIN/symbol, depotId), never `securityId`. All validation (archive state, ISIN mapping, FR-6) is re-run inside the confirming ledger call.*

### H14 — Manual price entry ownership

- **Pair:** *Prices* vs *Ledger UI / Backup*.
- **The conflict:** FR-9 manual prices are user-entered business data, but they sit in `prices`' Price table. Backup includes them (good), but AD-3 says "only `ledger` writes ledger rows" and AD-1 calls Prices part of the ledger. That leaves it open whether a manual price write goes through `ledger` (validation and revalidation) or `prices`. Two forms (Security page vs Prices page) are built against two services.
- **Proposed rule:** *All Price and ProviderMapping writes (provider, manual, restore) go only through `prices` service functions. AD-1/AD-3's "ledger" wording is narrowed to Depot, Security, Transaction and CorporateAction.*

### H15 — Precedence when both manual and provider prices exist for a day, and price uniqueness

- **Pair:** *Prices scheduler* vs *Manual price fallback*.
- **The conflict:** The scheduler upserts on `(securityId, date)` and overwrites the user's manual correction. A different implementer keys on `(securityId, date, source)` and the resolver picks manual. AD-9 states the precedence but not the storage key, so one build loses manual data.
- **Proposed rule:** *Price is unique on `(securityId, date, source)`. Provider fetches only ever upsert `source=provider` rows, and the AD-9 resolver is the only place where precedence is applied.*

### H16 — Taxes as external flow vs cash derivation (AD-10 interacts with AD-6)

- **Pair:** *Returns (`core/returns`)* vs *Cash (`core/cash`)*.
- **The conflict:**
  - Tax is booked inside the Cash Account (AD-6) but treated as an external outflow (AD-10).
  - One implementer adds it to the flows list and still leaves it in the cash balance. Then the valuation series drops on the tax date *and* the flow is subtracted, which counts it twice.
  - A tax refund (negative tax) must become an external inflow, which no rule states.
- **Proposed rule:** *`core/returns` takes the flow list from one `core/cash` function that emits signed external flows (Deposit +, Withdrawal −, tax paid −, tax refund +) dated on the business date. The valuation series includes the cash balance after those bookings, so each flow is counted exactly once.*

---

## Proposed additions — summary table

| # | Target | One-sentence rule |
| --- | --- | --- |
| H1 | AD-6 | `amount` = unsigned gross, `fee` ≥ 0, `tax` signed; direction from `type`; settlement only via a `core/cash` per-type formula; Parqet rounding fix adjusts `amount`. |
| H2 | new AD | qty/price only on BUY/SELL; FR-6 key `(depotId,date,type,securityId?,qty?,amount±0.01)` with ISIN resolved via ISIN-change chain. |
| H3 | AD-3/AD-12 | Restore uses `replaceAll` (no FR-6, IDs and sequences preserved); write services accept an outer tx; staging/caches cleared in same tx. |
| H4 | AD-7/AD-9 | Prices stored unadjusted; adapters must un-adjust; transaction prices derived, never stored. |
| H5 | new AD | Securities only via idempotent `ledger.ensureSecurity` at confirm time; unique ISIN / base crypto symbol; ledger alone owns name/type; `UNCLASSIFIED` not guessed. |
| H6 | new AD | Archived Depot is read-only, archivable only when flat, excluded from all aggregates incl. "held" for prices/news. |
| H7 | AD-6 | Cash Account = `depotId`, no table; one Parqet cash holding per file. |
| H8 | AD-8 | Ledger assigns sequence; migration chronological; restore verbatim; unique constraint. |
| H9 | AD-7 | Split is Security-scoped; ISIN change is Depot-scoped with a warning for other holders. |
| H10 | AD-10 | One `core` definition of invested capital, used everywhere. |
| H11 | AD-4 | File hash informational; duplicate status from FR-6 at review and confirm. |
| H12 | AD-6 | FEE/TAX value in `amount`; taxes-paid figure from one core function. |
| H13 | AD-4 | Staging stores raw identifiers; confirm re-validates. |
| H14 | AD-2/AD-3 | Price/ProviderMapping writes only via `prices`. |
| H15 | AD-9 | Price unique on `(securityId,date,source)`. |
| H16 | AD-10 | Signed external-flow list from one `core/cash` function; counted once. |
