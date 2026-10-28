---
id: SPEC-DepotManagement
companions:
  - ../../planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md
  - glossary.md
  - parqet-export-format.md
  - data-sources.md
  - ../../planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/EXPERIENCE.md
sources:
  - ../../planning-artifacts/prds/prd-DepotManagement-2026-10-25/prd.md
  - ../../planning-artifacts/prds/prd-DepotManagement-2026-10-25/addendum.md
  - ../../planning-artifacts/prds/prd-DepotManagement-2026-10-25/research-landscape.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# DepotManagement v1

## Why

**Pain + vision.** Tommy, a single private investor, pays a monthly subscription for Parqet to track several securities Depots (mostly stocks and ETFs, a small share of certificates and crypto), and its comdirect autosync regularly produces errors that need manual cleanup. DepotManagement replaces Parqet for his own use: self-hosted, no subscription, numbers he can trust, matching exactly the Parqet features he uses today (combined and per-Depot overviews, value development, Gain/Loss, composition, news). Owning the code is the second payoff: after parity, he adds the features he wants himself. Terms: `glossary.md`. Architecture invariants AD-1..AD-19: `ARCHITECTURE-SPINE.md`. Look and behavior: `DESIGN.md`, `EXPERIENCE.md`.

## Capabilities

CAP-N corresponds to PRD FR-N (CAP-19 added 2026-10-26).

- **CAP-1** — Manage Depots
  - **intent:** Tommy can create, rename and archive Depots, each assigned to one Broker and owning one Cash Account.
  - **success:** An archived Depot is excluded from the Portfolio overview while its history stays viewable.
- **CAP-2** — Enter Transactions manually
  - **intent:** Tommy can add, edit and delete Transactions of every type (buy, sell, dividend/distribution, fee, tax, Deposit, Withdrawal) for a Depot.
  - **success:** Securities are selectable by ISIN or name search and unknown ISINs can be added; quantities with up to 8 decimals and all asset types are accepted; Positions and all evaluations reflect a change immediately after saving.
- **CAP-3** — Corporate actions
  - **intent:** Tommy can record stock splits and ISIN changes so quantities and Cost Basis stay correct.
  - **success:** A split records ratio and effective date, and quantities and Prices before it are shown split-adjusted; an ISIN change records old and new quantity (ratio may differ from 1:1) and keeps total Cost Basis and original FIFO purchase dates.
- **CAP-4** — Import broker documents
  - **intent:** Tommy can upload one or many broker PDF documents for a Depot and get Transactions extracted.
  - **success:** Deutsche Bank/ROBIN, comdirect/cominvest and finanzen.net zero/Baader Bank buy, sell and dividend confirmations are parsed (finanzen.net zero also tax refunds); broker ISIN-change notices become a one-click corporate action or are shown as already recorded; each file shows status parsed, duplicate, or failed with a reason.
- **CAP-5** — Review before booking
  - **intent:** Tommy can review, correct or discard extracted Transactions before they are booked.
  - **success:** Nothing from an import appears in the ledger until Tommy confirms it.
- **CAP-6** — Duplicate protection
  - **intent:** The system detects Transactions already booked by an earlier import, migration or manual entry and does not book them twice.
  - **success:** Importing the same document twice books nothing new; a duplicate is Depot, date, Security, type and quantity matching with amount within €0.01; ambiguous matches (e.g. several identical savings-plan buys on one day) are flagged in review, never dropped automatically.
- **CAP-7** — Automatic price updates
  - **intent:** The system fetches current Prices for all held Securities at least daily and on demand.
  - **success:** The UI shows the latest Price timestamp per Security; a Price older than 3 days is flagged stale in all overviews.
- **CAP-8** — Historical prices
  - **intent:** The system obtains daily historical Prices for each held Security back to its first Transaction.
  - **success:** For a date without a Price, the last known Price (sourced, manual or from a Transaction) is carried forward and used for value, charts and return metrics.
- **CAP-9** — Manual price fallback
  - **intent:** Tommy can enter or correct a Price when no Price Source covers a Security.
  - **success:** A manual Price takes precedence over a sourced Price for that date in every view.
- **CAP-10** — Portfolio and Depot overview
  - **intent:** Tommy can see current value, invested capital and Gain/Loss (absolute and %) for the Portfolio and each Depot, with the list of Positions and their value and Gain/Loss.
  - **success:** After migration, values match broker statements at month end apart from Price timing (SM-2).
- **CAP-11** — Value development over time
  - **intent:** Tommy can see a chart of value and invested capital over a selectable Period for the Portfolio or a single Depot.
  - **success:** Chart values for any date equal the overview figures computed for that date.
- **CAP-12** — Gain/Loss evaluation
  - **intent:** Tommy can see Gain/Loss for a selectable Period, split into realized and unrealized, with dividends and fees accounted for.
  - **success:** TTWROR and XIRR are shown side by side for the Portfolio and each Depot; realized Gain/Loss uses FIFO and after migration matches Parqet's `realizedgains` per sale (cent-level differences across many lots acceptable); figures are gross with taxes paid in the Period shown separately.
- **CAP-13** — Composition
  - **intent:** Tommy can see the Portfolio or a Depot broken down by Position, by asset type (stock, ETF, fund, certificate, crypto, cash) and by Depot.
  - **success:** Shares per breakdown sum to the total value including cash.
- **CAP-14** — News on holdings
  - **intent:** Tommy can see news headlines from the last 14 days for held Securities, overall and per Security.
  - **success:** Each headline links to the original article; quality is comparable to Parqet's feed in Tommy's judgment; items with a source-provided teaser can be read in the app first.
- **CAP-15** — Initial migration from Parqet
  - **intent:** Tommy can bring his full Transaction history for all Depots in once from Parqet CSV exports (`parqet-export-format.md`), one file per Depot with the target Depot selected.
  - **success:** Positions, invested capital and Cash Account balance per Depot match Parqet as of the export date; same-timestamp Security transfers become splits or ISIN changes, an unpaired TransferIn becomes a delivery at Parqet's cost, and the migration completes without per-row decisions (asset types estimated from names, editable later); an export without cash movements gets minimal funding deposits so the Cash Account never goes negative; a Depot can be deleted to redo a migration; every trade is booked even when Parqet's cash rows differ (missing money as deposit, extra outflow as tax), no migrated Cash Account goes negative, sub-0.001 rounding oversells are absorbed, and fee-only realized-gain differences are not deviations; documents later imported for migrated Transactions are detected as duplicates.
- **CAP-16** — Export and backup
  - **intent:** Tommy can export all data to an open file format and restore from it.
  - **success:** Export then restore into an empty instance reproduces identical Depots, Cash Accounts, Transactions, manual Prices and evaluations; restore replaces all data, never merges.
- **CAP-17** — Cash Account balance
  - **intent:** Tommy can see the current balance and booking history of each Depot's Cash Account.
  - **success:** Every buy, sell, dividend, fee and tax books its cash side automatically; Deposits and Withdrawals are entered manually and change only the Cash Account.
- **CAP-18** — Cash in overviews
  - **intent:** Portfolio and Depot overviews and charts include Cash Account balances in total value, shown separately from Positions.
  - **success:** Deposits and Withdrawals are external cash flows in both return metrics and do not count as Gain/Loss.
- **CAP-19** — Security detail
  - **intent:** Tommy can open a detail page per Security across all Depots or for one Depot, also when no longer held.
  - **success:** It shows news, price history with buys and sells marked, the Transaction history with Depot, and the all-time result since the first buy (realized, unrealized, dividends, fees, taxes separately, total, % return and XIRR), all computed by core and consistent with the Depot figures; key figures from the provider show source and date, missing ones show "–", and the 52-week range is computed from stored Prices; analyst ratings (consensus, counts with trend, price targets) appear in a separate card for stocks only, labelled as opinions.

- **CAP-20** — Depot reconciliation
  - **intent:** Tommy can reconcile a Depot against his broker statement and correct real holding or cash errors.
  - **success:** A persisted reconciliation run checks off matching rows until finished; corrections are an ADJUSTMENT Transaction (no cash, no realized gain, external flow in returns) or a Deposit/Withdrawal for cash.

- **CAP-21** — Allocation analysis
  - **intent:** Tommy can see the Portfolio or a Depot split by asset class, type, sector, industry, region, country, company size and currency.
  - **success:** Shares sum to 100 % of value; ETFs/funds are classified as a whole; manual overrides win; tapping a segment lists its Positions.
- **CAP-22** — Performance and income analysis
  - **intent:** Tommy can analyse monthly/yearly returns (Portfolio, Depot and per Security), drawdown, realized gains, cash flow and dividends.
  - **success:** The heatmap shows time-weighted monthly returns consistent with the Depot figures; realized gains, cash flow and dividends per month/year reconcile with the ledger; the dividend estimate is marked as such; monthly dividend bars split by Security sum to the month total; the drawdown is flow-neutral (time-weighted index) and its maximum, duration and dates match a hand-calculated reference.
- **CAP-23** — Home-screen app
  - **intent:** Tommy can install the app on his phone or tablet home screen.
  - **success:** iOS and Android offer installation; it opens full-screen with the app's colours; every data route still requires login.
- **CAP-24** — Benchmark comparison
  - **intent:** Tommy can compare his time-weighted return with indices and between Depots.
  - **success:** Both lines start at 0 % at the Period start; the index return equals the ETF price return over the Period; Depot comparisons use the same TTWROR as the Depot pages.
- **CAP-25** — Tax preview with Freistellungsauftrag
  - **intent:** Tommy can see his German capital-gains tax position per broker and year.
  - **success:** Loss pots, Teilfreistellung and allowance usage match a hand-calculated reference; the estimate is compared with the tax withheld and labelled as an estimate.
- **CAP-26** — Target allocation and rebalancing
  - **intent:** Tommy can set robo-advisor-style targets and get rebalancing trades.
  - **success:** Segment values sum to the scope value; global funds are split by region weights; proposed trades reach the targets within the threshold; each sale shows its estimated tax.
- **CAP-27** — Watchlists
  - **intent:** Tommy can keep several named watchlists of Securities he does not need to hold, with a note and the date added per entry, and open each like a Position.
  - **success:** Change since added uses the resolved Price on the date added; a Security appears at most once per list; held entries are marked; watchlists survive export → restore.
- **CAP-28** — Claude connector
  - **intent:** Tommy can connect Claude (Desktop, Code, iOS) via MCP with OAuth and let it create, edit and delete watchlists and entries.
  - **success:** Claude on Mac and iOS connects with Tommy's login only; connections are listed in Settings; a removed connection's next call is rejected.
- **CAP-29** — Portfolio access for Claude
  - **intent:** Per connection, Tommy can grant Claude read-only access to Depots, Positions, Transactions and figures.
  - **success:** Figures returned equal the app's; no MCP tool writes; without the grant no portfolio data is returned.

## Constraints

- EUR only; all Depots are EUR Depots.
- Single user; runs locally first, later on Tommy's Linux server behind Nginx with TLS; installable from the repository with a documented, simple setup.
- Financial data stays on Tommy's machine/server, except read-only access Tommy explicitly grants to a connected MCP client; no third-party analytics; authentication required once reachable over the network.
- Public repository: no personal data, credentials or API keys; configuration via environment/config files.
- No paid services required for core function; manual Prices keep the system usable if free sources fail (`data-sources.md`).
- Correctness over features: numbers must reconcile with broker statements; a wrong value is worse than a missing feature.
- Usable in desktop and phone browsers; no native app.
- Cost Basis by FIFO; invested capital = Cost Basis of open Positions; Gain/Loss and returns gross, net taxes treated as external flow and shown separately.
- Robo-advisor Depots produce many small Transactions; import and review must handle tens per Depot per month.
- No feature or Broker is added without a named personal use by Tommy (SM-C1).
- Parqet migration depends on CAP-3 and CAP-17; the Parqet export must be taken before the subscription is cancelled.

## Non-goals

- Automatic broker sync.
- Tax view (Vorabpauschale, Freistellungsauftrag, Verlusttöpfe); tax reporting.
- ETF look-through / X-Ray (ETFs are classified as a whole; X-Ray is a later candidate).
- Benchmarks, dividend forecasts, rebalancing (later wish-list candidates).
- Multi-user, sharing, onboarding, billing, support for others; native mobile apps.
- Placing orders or any trading function.
- Security transfers between Depots.
- Foreign currencies.
- Spin-offs and mergers with cash components.

## Success signal

- **SM-1:** Tommy cancels Parqet and uses DepotManagement as his only tracker for 3 consecutive months.
- **SM-2:** Depot values match broker statements at each month end (deviation only from Price timing).
- **SM-3:** Monthly import of all document-based Depots takes under 10 minutes including review.

## Assumptions

- Monthly volume per robo-advisor Depot stays in the tens, not thousands.
- The comdirect/cominvest and ROBIN Parqet exports share the observed format — verify before cancelling Parqet.
- Free Price Sources (`data-sources.md`) cover German-listed ETFs adequately; EODHD (~€20/month) is the escape hatch.
- Cash Account handling for a Parqet export without cash rows is decided in the migration story.
