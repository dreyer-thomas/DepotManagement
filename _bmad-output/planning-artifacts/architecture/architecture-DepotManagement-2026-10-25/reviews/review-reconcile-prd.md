---
title: 'Reconcile review — Architecture Spine vs PRD + Addendum'
reviewed: ARCHITECTURE-SPINE.md (draft, 2026-10-25)
sources: prd.md, addendum.md (prd-DepotManagement-2026-10-25)
date: 2026-10-25
---

# Reconcile Review: Spine vs PRD

## Verdict

**Revise before epics.** Coverage is broad: all FR-1..FR-18 are bound and the main structural
choices (ledger is the only truth, one write path, staged import, decimals, corporate actions as
events, one price resolver) fit the PRD well. But several quiet requirements, mostly the addendum
quirks and PRD testable consequences, either have no invariant or conflict with one. If left alone,
they will be settled differently in the import, migration, backup and evaluation epics. Findings
1–5 should be fixed in the spine. Findings 6–12 are smaller or can be fixed with one line each.
Findings 13–16 are notes.

Severity: **H** = contradiction or a cross-epic divergence that is likely; **M** = a missing
invariant that several epics touch; **L** = clarification.

---

## Findings

### 1. [H] The FR-6 duplicate key does not survive the data's real shapes — no canonical Transaction form
- **Refs:** PRD FR-6 (Depot, date, ISIN, type, quantity, amount ±€0.01), FR-15 consequence 2 (later documents for migrated Transactions are detected as duplicates); Addendum A1 quirks ("Dividends sometimes stored as `shares=1, price=amount`", trade/cash rounding, `identifier` = `BTC` for crypto).
- **Gap:** AD-3/AD-4 run "the FR-6 duplicate match" but never define the normalized values it compares:
  - **Dividend quantity:** a Parqet dividend migrated as `shares=1` will never match the same dividend later parsed from a ROBIN/comdirect PDF (quantity = units held). That breaks FR-15 consequence 2 for every dividend.
  - **Amount semantics:** is the stored `amount` gross trade value (price × qty), net cash (incl. fee/tax), or the cash row's figure (AD-6 uses the Parqet cash row on rounding mismatch)? Parqet's export, broker PDFs and manual entry will each fill it differently unless one definition is fixed, and then the ±€0.01 test fails.
  - **No ISIN:** crypto (symbol) and cash-only DEPOSIT/WITHDRAWAL have no ISIN. The key is undefined for them.
- **Fix:** Add an invariant (extend AD-6 or a new AD) that defines the **canonical Transaction**: what `amount`, `fee`, `tax` and `quantity` mean per type (e.g. `amount` = gross value before fee/tax; dividend `quantity` = units entitled, or explicitly *not part of the key* for DIVIDEND), and that the duplicate key uses `securityId` (ISIN or crypto symbol), not raw ISIN. Every writer (manual form, PDF parsers, Parqet migration) must normalize to this shape *before* the AD-3 ledger service. The Parqet dividend quirk is normalized in migration: use `amount`; derive or omit quantity.

### 2. [H] AD-3 runs duplicate matching on every write path — this contradicts FR-16 identical restore and FR-6 "never dropped automatically"
- **Refs:** PRD FR-6 consequence 3 (ambiguous matches never auto-dropped, flagged in review), FR-16 (restore reproduces *identical* Transactions), FR-2 (manual entry), FR-15 (migration of full history).
- **Gap:** AD-3: "Manual entry, import confirmation, Parqet migration and restore all call the same ledger service, which … runs the FR-6 duplicate match before persisting." Legitimate identical rows exist (several identical savings-plan buys on one day, which the PRD itself names). As written:
  - restore could drop or block genuine rows, so the export→restore round trip is no longer identical;
  - migration of a robo-advisor history could reject its own legitimate same-day buys;
  - manual entry has no review step to "flag" into, so the behaviour is undefined.
- **Fix:** Restate AD-3 like this. The duplicate match is *advisory*: it returns `unique | duplicate | ambiguous` and **never drops a row by itself**. Import and migration show the result in review (AD-4). Manual entry warns and asks to confirm. **Restore bypasses duplicate matching** (it replaces everything, AD-12) but keeps schema validation. Within one import/migration batch, rows match only against the existing ledger, not against each other, unless the batch rows come from the same file hash.

### 3. [H] Split adjustment will be applied twice to provider prices
- **Refs:** PRD FR-3 consequence 1 (Prices before the split date shown split-adjusted), FR-8, SM-2.
- **Gap:** AD-7 says Prices before a split are never modified and core applies split adjustment on read. AD-9 stores provider closes as returned. Yahoo's (`yahoo-finance2`) historical `close` is **already split-adjusted**, and most free sources behave the same way. Core would then adjust provider history a second time, while manual and transaction prices really are unadjusted. Charts and valuation before any split would then be wrong by the split ratio.
- **Fix:** Add to AD-9/AD-7 that every stored Price is in **one declared basis**: either (a) providers must return *unadjusted* closes, with the adapter un-adjusting via the provider's split events, or (b) Price rows carry an `adjustedThrough` / basis flag and core adjusts only unadjusted rows. Add a provider contract test with a known split Security.

### 4. [M] No sign convention for amounts, fees and taxes (tax refunds, standalone tax rows)
- **Refs:** Addendum A1 quirks ("Negative `tax` on sells/dividends = tax refund", "`cost` row with amount 0 and only `tax` set"), PRD FR-12 consequence 3 (taxes paid shown separately), FR-17, AD-10 (taxes treated as external outflow).
- **Gap:** The spine has a `TAX` type and a `tax` field on trades, but it does not say whether values are signed or magnitudes with the direction coming from the type, or how a negative tax (refund) flows. Parsers, migration, manual form, cash derivation (AD-6) and the AD-10 return treatment will each guess differently. A refund has to reduce "taxes paid" and be an external *inflow* if taxes are external outflows.
- **Fix:** Add a convention row or extend AD-6: e.g. `amount`/`fee` are non-negative magnitudes with direction set by type, and `tax` is **signed** (positive = paid, negative = refund). A Parqet `cost` row with `amount = 0` and only `tax` becomes a `TAX` Transaction. AD-10 then treats net tax (incl. refunds) as the external flow. Add a core unit test with a refund.

### 5. [M] FR-7 needs a price timestamp, but AD-8 makes Prices date-only
- **Refs:** PRD FR-7 consequences ("UI shows the timestamp of the latest Price per Security"; "a Price older than 3 days is flagged as stale in all overviews").
- **Gap:** AD-8 says Prices carry a business date, not a timestamp. Nothing stores when a price was fetched or entered, and no rule defines staleness (calendar days? trading days? measured against the business date or the fetch time?). Each overview would compute it its own way, and weekends (Fri close seen on Mon = 3 days) make the boundary unclear.
- **Fix:** Add `fetchedAt` (instant, UTC) on Price as metadata, next to the business date used for valuation. Add a single core function `isStale(latestPriceDate, today)` used by every view, with the rule stated (e.g. > 3 calendar days between the business date of the latest Price and the "today" parameter). Say whether manual prices are ever stale.

### 6. [M] No owner or trigger for historical price backfill after ledger writes
- **Refs:** PRD FR-8 (history back to *first Transaction*), FR-2 consequence 4 (evaluations reflect a change immediately), FR-15.
- **Gap:** A new Security, or a backdated Transaction, from manual entry, import, migration or restore needs provider history fetched from that date. AD-2 forbids `ledger` from writing Price, and the scheduler only fetches "latest daily". No one is told to backfill. Until a backfill runs, values fall back to transaction-price carry-forward, which is silently inaccurate.
- **Fix:** Add a rule: after any ledger write, the ledger service calls `prices.ensureHistory(securityId, fromDate)` (idempotent, async-allowed). The scheduler also runs a gap check for every held Security on start. While history is incomplete, the view shows it (reuse the stale flag).

### 7. [M] Sequence numbers: no rule for how each write path assigns them
- **Refs:** AD-8; Addendum A1 ("Newest rows first", synthetic times 06:00Z/00:00Z); PRD FR-6 (same-day savings-plan buys), FR-3 (FIFO dates).
- **Gap:** AD-8 introduces `(date, sequence)` ordering and drops Parqet's synthetic times, but does not say how sequence is assigned when (a) migration reads a reverse-chronological file with real and synthetic times, (b) a PDF import or manual entry inserts into a date that already has Transactions, or (c) an edit moves a Transaction to another date. Same-day buy-then-sell FIFO results depend on this.
- **Fix:** Add: the ledger service is the only place that assigns sequence. New rows on a date are appended (max + 1). Migration derives order from the real `datetime` ascending before dropping time, and file order is the tie-break. Restore keeps sequences verbatim. Users can reorder same-day rows explicitly.

### 8. [M] Migration cash reconciliation when an export has no Cash holding
- **Refs:** PRD FR-15 consequences 5–6 (Cash Account balance matches Parqet), assumption "comdirect/cominvest and ROBIN exports share the observed format"; Addendum A1 (only "Finanzen Zero Cash" observed).
- **Gap:** AD-6 derives the cash side of every trade. If a Parqet portfolio has no cash holding (only the finanzen.net zero sample was observed), the derived balance will be strongly negative and FR-15 consequence 6 fails. The spine has no opening-balance concept and does not say how missing cash flows are made up.
- **Fix:** Add a migration rule: when the export lacks Cash rows (or the derived balance ≠ the Parqet balance on the export date), migration proposes balancing DEPOSIT/WITHDRAWAL Transactions (marked as synthetic) in review. It must not adjust balances directly (AD-1). Also add the "verify all three exports before cancelling Parqet" check to migration acceptance. This is a time-critical sequencing constraint (PRD FR-15 notes).

### 9. [M] Privacy NFR: outbound data and telemetry are not constrained
- **Refs:** PRD §5 Privacy ("financial data stays on Tommy's own machine/server; no third-party analytics").
- **Gap:** AD-13 covers auth and secrets but not what leaves the server. Next.js sends anonymous telemetry by default. Providers (OpenFIGI, Yahoo, Google News, CoinGecko) receive identifiers. Nothing forbids sending quantities or values, or loading external fonts/CDNs from the browser.
- **Fix:** Add to AD-13: telemetry disabled (`NEXT_TELEMETRY_DISABLED=1`, no analytics SDKs). Outbound provider calls carry only Security identifiers or names, never quantities, amounts or Depot data. All assets are self-hosted (no CDN fonts).

### 10. [M] Phone-browser responsiveness has no cross-epic rule
- **Refs:** PRD §5 Responsiveness ("usable in a desktop browser and on a phone browser").
- **Gap:** The spine defers all UI structure to "the first UI story". Responsiveness is a property every screen epic (overview, import review, transaction form, charts) must honour, so deferring it to one story invites divergence.
- **Fix:** Add a convention row: every page must be usable at phone width (e.g. ≥ 360 px) using MUI breakpoints. Tables collapse to cards or lists. The chart library must support responsive containers. This becomes an acceptance criterion in each UI story.

### 11. [L] Archived Depots and historical Portfolio figures
- **Refs:** PRD FR-1 (archived Depot excluded from Portfolio overview, history viewable); AD-10 ("Portfolio is the sum of non-archived Depots").
- **Gap:** AD-10 applies the exclusion to *all* Portfolio figures, so archiving a closed Depot also rewrites past Portfolio value, realized Gain/Loss and TTWROR/XIRR. The PRD only requires exclusion from the *overview*. The reading is ambiguous, and evaluation epics may implement it differently.
- **Fix:** State the intended semantics explicitly. Either archived Depots are excluded from current overview and composition but kept in historical Portfolio series and Period returns, or they are excluded everywhere, with the consequence written down.

### 12. [L] Realized Gain/Loss tolerance vs "matches Parqet's realizedgains per sale"
- **Refs:** PRD FR-12 consequence 2 (*per sale* match); AD-5 ("cent-level differences … summed across many FIFO lots are acceptable").
- **Gap:** The spine loosens the PRD's per-sale match to an aggregate tolerance without saying so. The migration reconciliation test needs a numeric threshold.
- **Fix:** Set a per-sale tolerance (e.g. ≤ €0.01 per sale, or per lot × n) in AD-5 and the Tests convention, and record the deviation from the PRD wording if it is intended.

### 13. [L] Broker and CashAccount entity status is unclear
- **Refs:** PRD Glossary/FR-1 (Depot belongs to one Broker, owns one Cash Account).
- **Gap:** The ER diagram has a BROKER entity, but AD-2 assigns it to no owner and AD-12's export list leaves it out. `CashAccount` is a naming convention but not an entity. AD-1 says its balance is derived. Restore and parser registration ("per Broker") need a fixed Broker identity.
- **Fix:** Declare Broker a code-level enum (`COMDIRECT`, `ROBIN`, `FINANZEN_ZERO`) or an owned, backed-up model. Declare CashAccount implicit (1:1 with Depot, no table) or a ledger-owned row.

### 14. [L] Non-EUR rows in the Parqet export
- **Refs:** PRD §5 Currency (EUR only); Addendum A1 columns `originalcurrency`, `currency`, `fxrate`.
- **Gap:** The spine assumes implicit EUR but does not say what migration does with a row whose currency ≠ EUR or whose `fxrate` ≠ 1.
- **Fix:** Migration flags such rows for review, using the EUR `amount`. It never converts silently.

### 15. [L] Corporate action as a "Transaction type" (FR-2) vs a separate CorporateAction model
- **Refs:** PRD FR-2 (add/edit/delete Transactions of every type incl. corporate action), Glossary "Transaction".
- **Gap:** The spine models corporate actions as their own rows, which is fine, but the Transaction type list omits them. The edit/delete path and the duplicate rules for CorporateActions are not stated.
- **Fix:** Add one line saying CorporateActions are added, edited and deleted through the same ledger service (AD-3) and appear in the Transaction history UI, and say whether duplicate matching applies to them (it is probably keyed by Security, date and type).

### 16. [L] Uploaded PDF retention
- **Refs:** PRD §5 Privacy, Public repository; AD-4 (file hash stored).
- **Gap:** Not stated whether uploaded PDFs are kept, where they are kept, or when they are deleted. They contain personal financial data.
- **Fix:** Store uploads outside the source tree (same rule as the SQLite path) and delete them after the batch is confirmed or discarded. Keep only the hash and the extracted proposals.

---

## Covered well (no action)
FR-1 archive history (AD-10 + ledger); FR-2 immediate reflection (AD-1 compute-on-read + revalidate); FR-3 ISIN change carries FIFO dates and Cost Basis (AD-7); FR-4 per-file status and per-broker parsers (AD-4); FR-5 review gate (AD-4); FR-8 carry-forward (AD-9 resolver); FR-9 manual precedence (AD-9); FR-12 both metrics from one series (AD-10); FR-15 paired/unpaired transfer handling (AD-7) and trade/cash rounding (AD-6); FR-16 replace-not-merge and evaluations reproducible via backed-up prices (AD-12); FR-18 deposits/withdrawals as external flows (AD-10); public-repo, secrets and single-user (AD-13, Tests convention); EUR-only (Data formats); fractional 8-decimal quantities (AD-5); PRD Open Questions 1/2 carried into the spine's Deferred and Open Questions.
