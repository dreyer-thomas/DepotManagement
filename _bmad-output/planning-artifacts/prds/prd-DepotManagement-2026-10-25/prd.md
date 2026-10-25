---
title: DepotManagement PRD
status: final
created: 2026-10-25
updated: 2026-10-25
---

# PRD: DepotManagement
*Working title.*

## 0. Document Purpose

This PRD defines the first version of DepotManagement, a self-hosted portfolio tracker built by and for a single private investor (Tommy). It is the input for architecture and epic/story breakdown. Features are grouped into sections with globally numbered FRs; inferred points are tagged `[ASSUMPTION]` inline and indexed in §10. Background research on Parqet, comparable tools, price data sources and broker export formats lives in `research-landscape.md` next to this file; implementation-level detail goes to `addendum.md`.

## 1. Vision

DepotManagement replaces Parqet for Tommy's personal use. It tracks several securities Depots — mainly stocks and ETFs, plus a small share of certificates and crypto — shows how each Depot and the Portfolio are doing over time, and gives the overview needed to make investment decisions, all without a monthly subscription.

Version 1 deliberately matches only what Tommy actually uses in Parqet today: combined and per-Depot overviews, value development over time, Gain/Loss evaluation, Portfolio composition, and news on held Securities. Transactions get in by manual entry or by importing broker documents; there is no automated broker sync, because the one sync Tommy uses today regularly produces errors that need manual cleanup.

Owning the code is the second payoff: once parity is reached, Tommy can add the features he wants rather than waiting for — or paying for — someone else's roadmap. The repository may be public so others can self-install it, but serving other users is not a goal.

## 2. Target User

### 2.1 Jobs To Be Done
- **Check how it's going:** see at a glance what all Depots together, and each Depot alone, are worth and whether they gained or lost.
- **Spot trends:** see how value and performance developed over chosen Periods to inform buy/hold/sell decisions.
- **Understand composition:** see what the Portfolio consists of (by Position, asset type, and broad allocation).
- **Stay informed:** read current news about held securities in one place.
- **Keep the books right with little effort:** get Transactions in quickly and trust the numbers without cleanup sessions.
- **Stop paying for it:** run the tool on own hardware at no subscription cost.

### 2.2 Non-Users (v1)
- Other investors, households, or advisors. A public repo is a by-product, not an audience commitment; no multi-user, onboarding, or support features.

### 2.3 Key User Journeys
- **UJ-1. Tommy checks in on his Portfolio.** On a weekday evening Tommy opens DepotManagement in the browser, sees total value and Gain/Loss across all three Depots, switches the Period to "1 year" to see the trend, drills into the Depot that moved most, and skims news on its largest Positions before deciding whether to act.
- **UJ-2. Tommy imports his monthly broker documents.** At month end Tommy downloads the transaction documents from a broker's online postbox, drops them into DepotManagement, reviews the recognized Transactions (flagging any duplicates or unparsed files), confirms, and sees the Depot updated. **Edge case:** a document's layout is not recognized — Tommy sees which file failed and enters the Transaction manually.
- **UJ-3. Tommy records a trade by hand.** For the Depot without usable documents, Tommy enters a buy (security by ISIN, date, quantity, price, fees) in a short form and sees it reflected immediately.

## 3. Glossary
- **Depot** — One securities account at one broker. Belongs to exactly one Broker; holds zero or more Positions.
- **Broker** — The institution where a Depot is held (in v1: comdirect/cominvest, Deutsche Bank/ROBIN, finanzen.net zero/Baader Bank).
- **Portfolio** — The combined view of all Depots.
- **Security** — A tradable instrument identified by ISIN (or symbol for crypto). Asset types: stock, ETF (incl. ETC), fund (active mutual fund), certificate (e.g. open-end turbo), crypto. Stocks and ETFs dominate; certificates and crypto are a small share.
- **Cash Account** — The settlement account (Verrechnungskonto) belonging to exactly one Depot; holds a EUR balance changed by Deposits, Withdrawals, and the cash side of Transactions.
- **Position** — The holding of one Security within one Depot: quantity, Cost Basis, current value.
- **Transaction** — A booked event that changes a Position or a Cash Account: buy, sell, dividend/distribution, fee, tax, corporate action, Deposit, or Withdrawal.
- **Deposit / Withdrawal** — Money moved into or out of a Cash Account from outside the Depot.
- **Document Import** — Creating Transactions by uploading broker-issued PDF documents (trade and dividend confirmations). The one-time Parqet CSV migration (FR-15) is separate.
- **Price** — A Security's quoted value on a given date, from a Price Source.
- **Price Source** — An external provider of current and historical Prices.
- **Cost Basis** — The purchase cost (price × quantity + fees) of the units still held, determined by FIFO: the earliest bought units of a Position count as sold first. Same method as German tax law and Parqet.
- **Gain/Loss** — Change in value from price movement and income (dividends) minus fees, measured against Cost Basis; realized (from sales) or unrealized (open Positions). Shown gross (before taxes); taxes paid are shown as a separate figure next to it.
- **Period** — A selectable time range for charts and evaluations (e.g. 1M, YTD, 1Y, Max, custom).

## 4. Features

### 4.1 Depot and Transaction Management
**Description:** Tommy maintains his Depots and their Transactions. Manual entry is a first-class path, not a fallback — one Depot is fully manual today. Realizes UJ-3.

#### FR-1: Manage Depots
Tommy can create, rename, and archive Depots, each assigned to a Broker and owning one Cash Account.
**Consequences (testable):**
- An archived Depot is excluded from the Portfolio overview but its history remains viewable.

#### FR-2: Enter Transactions manually
Tommy can add, edit, and delete Transactions of every type (buy, sell, dividend/distribution, fee, tax, corporate action, Deposit, Withdrawal) for a Depot. Realizes UJ-3.
**Consequences (testable):**
- A Security is selected by ISIN (or name search); unknown ISINs can be added.
- Fractional quantities are supported (up to 8 decimals, as seen for crypto and some shares in Tommy's history).
- All asset types in the Glossary can be entered.
- Positions and all evaluations reflect a change immediately after saving.

#### FR-3: Corporate actions
Tommy can record stock splits and ISIN changes (one Security replaced by another, Cost Basis carried over) so that quantities and Cost Basis remain correct.
**Consequences (testable):**
- A split records ratio and effective date; quantities and Prices before that date are shown split-adjusted.
- An ISIN change records old and new quantity (ratio may differ from 1:1) and keeps the total Cost Basis and original FIFO purchase dates.
**Notes:** ISIN changes occur in Tommy's real history. `[ASSUMPTION: spin-offs and mergers with cash components deferred]`

### 4.2 Document Import
**Description:** Tommy uploads broker documents and gets Transactions created from them, with a review step before anything is booked. This replaces Parqet's import and avoids the error-prone autosync. Realizes UJ-2.

#### FR-4: Import broker documents
Tommy can upload one or many broker documents for a Depot and have Transactions extracted from them.
**Consequences (testable):**
- Supported in v1: Deutsche Bank/ROBIN PDF documents (buy, sell, and dividend confirmations — imported this way in Parqet today) and comdirect/cominvest PDF documents (replacing the Parqet autosync used today; confirmed sufficient).
- finanzen.net zero stays manual in v1 (Parqet supports neither sync nor import for it). Document Import for finanzen.net zero/Baader Bank is a later candidate.
- Each file shows a status: parsed, duplicate, or failed with a reason.

#### FR-5: Review before booking
Tommy can review, correct, or discard extracted Transactions before they are booked.

#### FR-6: Duplicate protection
The system detects Transactions that were already booked (from earlier imports or manual entry) and does not book them twice.
**Consequences (testable):**
- Importing the same document twice books nothing new on the second import.
- A Transaction counts as a duplicate when Depot, date, ISIN, type, and quantity match and the amount differs by at most €0.01.
- Ambiguous matches (e.g. several identical savings-plan buys on one day) are never dropped automatically; they are flagged in the review step (FR-5) for Tommy to decide.

**Notes:** Robo-advisor Depots generate many small rebalancing and savings-plan Transactions, so import volume per month can be high. `[ASSUMPTION: monthly volume per robo-advisor Depot stays in the tens, not thousands]`

### 4.3 Prices
**Description:** The system keeps Prices current and historical so values and charts are accurate without manual work.

#### FR-7: Automatic price updates
The system fetches current Prices for all held Securities from a Price Source at least daily, and on demand.
**Consequences (testable):**
- The UI shows the timestamp of the latest Price per Security.
- A Price older than 3 days is flagged as stale in all overviews.

#### FR-8: Historical prices
The system obtains historical daily Prices for each held Security back to its first Transaction, so value development can be charted.
**Consequences (testable):**
- Where no Price exists for a date, the last known Price (sourced, manual, or from a Transaction) is carried forward and used for value, charts, and return metrics.

#### FR-9: Manual price fallback
Tommy can enter or correct a Price manually when no Price Source covers a Security.
**Notes:** Certificates and crypto may need a different Price Source than stocks/ETFs; given their small share, manual Prices are an acceptable fallback for them.

### 4.4 Overview and Performance
**Description:** The core screens: how the Portfolio and each Depot are doing, now and over time. Realizes UJ-1.

#### FR-10: Portfolio and Depot overview
Tommy can see current value, invested capital, and Gain/Loss (absolute and %) for the Portfolio and for each Depot, plus the list of Positions with their value and Gain/Loss.

#### FR-11: Value development over time
Tommy can see a chart of value (and invested capital) over a selectable Period for the Portfolio or a single Depot.

#### FR-12: Gain/Loss evaluation
Tommy can see Gain/Loss for a selectable Period, split into realized and unrealized, with dividends and fees accounted for.
**Consequences (testable):**
- For any Period, both a time-weighted return (TTWROR) and a money-weighted return (IRR/XIRR) are shown side by side, for the Portfolio and each Depot.
- Realized Gain/Loss uses FIFO Cost Basis; after migration it matches Parqet's `realizedgains` per sale.
- Gain/Loss is shown gross, with taxes paid in the same Period as a separate figure.

**Notes:** Tommy reads both; depending on the year and cash-flow timing they differ noticeably, so neither replaces the other.

#### FR-13: Composition
Tommy can see the Portfolio or a Depot broken down by Position, by asset type (stock, ETF, fund, certificate, crypto, cash), and by Depot.
**Out of Scope:** ETF look-through to underlying holdings, sectors, or countries.

### 4.5 News
**Description:** Current news about held Securities, so Tommy doesn't need a second app. Realizes UJ-1.

#### FR-14: News on holdings
Tommy can see news headlines from the last 14 days for held Securities, overall and per Security, each linking to the original article.
**Notes:** Quality should be comparable to Parqet's news (source unknown). A free news API that requires an API key is acceptable. Concrete source open — see Open Question 2.

### 4.6 Data Ownership
#### FR-15: Initial migration from Parqet
Tommy can bring his existing Transaction history for all Depots into DepotManagement once from a Parqet export. From then on, new Transactions come in via Document Import or manual entry.
**Consequences (testable):**
- After migration, Positions and invested capital per Depot match Parqet as of the export date.
- Documents later imported for Transactions already covered by the migration are detected as duplicates (FR-6).
- One export file is imported per Depot; Tommy selects the target Depot.
- Security transfers at one timestamp are paired by ISIN into splits, then a single out/in of different ISINs into an ISIN change (FR-3); an unpaired TransferIn is booked as a delivery at Parqet's cost (buy plus equal deposit); only an unpaired TransferOut is flagged.
- The migration needs no per-row decisions; asset types are estimated from Security names and stay editable later.
- Cash Account movements in the export become Deposits, Withdrawals, and the cash side of Transactions (FR-17).
- After migration, each Cash Account balance matches Parqet as of the export date.
- An export without cash movements (autosync portfolios) gets a deposit for each funding shortfall at the time of the buy, so the Cash Account never goes negative and returns treat that money as external inflow.
- A Depot can be deleted with all its Transactions, so a migration can be redone.

**Notes:** Parqet offers a CSV export of all activities per Parqet portfolio (Activities overview → "Export as CSV"), only on paid tiers (Plus/Investor) (https://parqet.com/en/blog/export). **The export must be taken before the Parqet subscription is cancelled.** A real export has been analyzed; format and quirks are in `addendum.md` §A1. `[ASSUMPTION: the comdirect/cominvest and ROBIN exports share the observed format — verify before cancelling Parqet]` Depends on FR-3 and FR-17; sequence those first.

#### FR-16: Export and backup
Tommy can export all Depots and Transactions to an open file format and restore from it.
**Consequences (testable):**
- Export then restore into an empty instance reproduces identical Depots, Cash Accounts, Transactions, manual Prices, and evaluations.
- Restore replaces all existing data; it does not merge.

### 4.7 Cash Account
**Description:** Each Depot carries its Cash Account so that value swings around buys and sells are explainable: money moves between Positions and cash instead of seeming to vanish or appear from nowhere. Realizes UJ-1.

#### FR-17: Cash Account balance
Tommy can see the current balance and booking history of each Depot's Cash Account.
**Consequences (testable):**
- Every buy, sell, dividend, fee, and tax Transaction automatically books its cash side to the Cash Account.
- Deposits and Withdrawals can be entered manually and change only the Cash Account.

#### FR-18: Cash in overviews
The Portfolio and Depot overviews (FR-10, FR-11) include Cash Account balances in total value, shown separately from Positions.
**Consequences (testable):**
- Deposits and Withdrawals are treated as external cash flows in both return metrics (FR-12), so they do not count as Gain/Loss.

## 5. Cross-Cutting NFRs and Constraints
- **Deployment:** Runs locally first; later as a web app on Tommy's Linux production server behind Nginx with TLS. Must be installable from the repository with a documented, simple setup.
- **Privacy & security:** Financial data stays on Tommy's own machine/server; no third-party analytics. Once reachable over the network, access requires authentication (single user).
- **Public repository:** No personal data, credentials, or API keys in the repo; configuration via environment/config files.
- **Correctness over features:** Numbers must reconcile with broker statements; a wrong value is worse than a missing feature.
- **Cost:** No paid services required for core function. `[ASSUMPTION: a free Price Source with adequate coverage of German-listed ETFs exists]` Fallback if none exists: manual Prices keep the system usable, and architecture assesses a low-cost paid source for Tommy to decide on.
- **Responsiveness:** Usable in a desktop browser and on a phone browser; no native app.
- **Currency:** EUR only; all Depots are EUR Depots. Foreign-currency support is out of scope for v1.

## 6. MVP Scope

### 6.1 In Scope
- Depots, manual Transactions, corporate actions (splits, ISIN changes) — FR-1 to FR-3
- Cash Account per Depot — FR-17, FR-18
- Asset types: stock, ETF, fund, certificate, crypto
- Document Import with review and duplicate protection — FR-4 to FR-6
- Automatic current and historical Prices with manual fallback — FR-7 to FR-9
- Portfolio/Depot overview, value chart, Gain/Loss, composition — FR-10 to FR-13
- News on holdings — FR-14
- One-time migration, export/backup — FR-15, FR-16

### 6.2 Out of Scope for MVP
- Automatic broker sync (error-prone today; manual entry and Document Import suffice)
- Tax view (Vorabpauschale, Freistellungsauftrag, Verlusttöpfe) — never used in Parqet
- ETF look-through / X-Ray — not needed
- Benchmarks, dividend forecasts, rebalancing — candidates for later wish-list features
- Multi-user, sharing, mobile native apps

## 7. Non-Goals
- Not a commercial product or SaaS; no onboarding, billing, or support for others.
- Not a trading tool; it never places orders.
- Not a tax-reporting tool.
- No Security transfers between Depots: Tommy moves money between Depots via sells and buys.

## 8. Success Metrics
- **SM-1:** Tommy cancels his Parqet subscription and uses DepotManagement as his only tracker for 3 consecutive months. Validates FR-10 to FR-14, FR-17, FR-18.
- **SM-2:** Depot values match broker statements at each month end (deviation only from Price timing). Validates FR-2 to FR-9.
- **SM-3:** Monthly import of all document-based Depots takes under 10 minutes including review. Validates FR-4 to FR-6.
- **SM-C1 (counter-metric):** No feature or Broker is added without a named personal use by Tommy; completeness for hypothetical other users is not a goal. Counterbalances scope growth against SM-1.

## 9. Open Questions
*Both are deferred to architecture and must be resolved before implementation; Tommy has no existing preference.*

1. Which Price Source(s) cover all held stocks and ETFs on German exchanges reliably and for free, and is there a free Price Source for crypto and certificates?
2. Which free, keyed news API delivers quality comparable to Parqet's news feed?

## 10. Assumptions Index
- §4.1 FR-3 — spin-offs and mergers with cash components are deferred.
- §4.2 FR-6 — monthly volume per robo-advisor Depot stays in the tens, not thousands.
- §4.6 FR-15 — comdirect/cominvest and ROBIN Parqet exports share the observed format.
- §5 — a free Price Source with adequate coverage of German-listed ETFs exists.
