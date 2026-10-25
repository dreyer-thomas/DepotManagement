---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-DepotManagement-2026-10-25/prd.md
  - _bmad-output/planning-artifacts/prds/prd-DepotManagement-2026-10-25/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md
  - _bmad-output/specs/spec-DepotManagement/SPEC.md
  - _bmad-output/specs/spec-DepotManagement/glossary.md
  - _bmad-output/specs/spec-DepotManagement/parqet-export-format.md
  - _bmad-output/specs/spec-DepotManagement/data-sources.md
  - _bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/EXPERIENCE.md
---

# DepotManagement - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for DepotManagement, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Tommy can create, rename and archive Depots, each assigned to one Broker and owning one Cash Account; an archived Depot is excluded from the Portfolio overview but its history stays viewable.
FR2: Tommy can add, edit and delete Transactions of every type (buy, sell, dividend/distribution, fee, tax, Deposit, Withdrawal) for a Depot; Securities selectable by ISIN or name search, unknown ISINs can be added; fractional quantities up to 8 decimals; all asset types (stock, ETF, certificate, crypto); Positions and evaluations reflect changes immediately.
FR3: Tommy can record stock splits (ratio + effective date; earlier quantities and Prices shown split-adjusted) and ISIN changes (old and new quantity, ratio may differ from 1:1; total Cost Basis and original FIFO purchase dates kept).
FR4: Tommy can upload one or many broker PDF documents for a Depot and get Transactions extracted; v1 supports Deutsche Bank/ROBIN and comdirect/cominvest buy, sell and dividend confirmations; finanzen.net zero stays manual; each file shows status parsed, duplicate, or failed with reason.
FR5: Tommy can review, correct or discard extracted Transactions before they are booked.
FR6: The system detects already-booked Transactions (earlier import, migration or manual entry) and does not book them twice; re-importing the same document books nothing; duplicate = Depot, date, ISIN (Security), type and quantity match and amount within €0.01; ambiguous matches (e.g. identical savings-plan buys on one day) are flagged in review, never auto-dropped.
FR7: The system fetches current Prices for all held Securities at least daily and on demand; the UI shows the latest Price timestamp per Security; Prices older than 3 days are flagged stale in all overviews.
FR8: The system obtains daily historical Prices for each held Security back to its first Transaction; missing dates carry forward the last known Price (sourced, manual or from a Transaction) for value, charts and return metrics.
FR9: Tommy can enter or correct a Price manually when no Price Source covers a Security.
FR10: Tommy can see current value, invested capital and Gain/Loss (absolute and %) for the Portfolio and each Depot, plus the list of Positions with value and Gain/Loss.
FR11: Tommy can see a chart of value and invested capital over a selectable Period for the Portfolio or a single Depot.
FR12: Tommy can see Gain/Loss for a selectable Period split into realized and unrealized with dividends and fees; TTWROR and XIRR side by side for Portfolio and each Depot; realized Gain/Loss uses FIFO and matches Parqet's `realizedgains` per sale after migration; shown gross with taxes paid in the Period as a separate figure.
FR13: Tommy can see the Portfolio or a Depot broken down by Position, by asset type (stock, ETF, certificate, crypto, cash) and by Depot; no ETF look-through.
FR14: Tommy can see news headlines of the last 14 days for held Securities, overall and per Security, each linking to the original article.
FR15: Tommy can import his full Transaction history once from Parqet CSV exports, one file per Depot with target Depot selected; Positions, invested capital and Cash Account balance match Parqet at export date; paired same-timestamp Security TransferOut/TransferIn → ISIN change, unpaired → flagged; Cash movements become Deposits, Withdrawals and cash sides; later imported documents for migrated Transactions are detected as duplicates. Depends on FR3 and FR17.
FR16: Tommy can export all Depots and Transactions to an open file format and restore from it; export → restore into an empty instance reproduces identical Depots, Cash Accounts, Transactions, manual Prices and evaluations; restore replaces, never merges.
FR17: Tommy can see balance and booking history of each Depot's Cash Account; buy, sell, dividend, fee and tax book their cash side automatically; Deposits and Withdrawals are entered manually and change only the Cash Account.
FR18: Portfolio and Depot overviews and charts include Cash Account balances in total value, shown separately from Positions; Deposits and Withdrawals are external cash flows in both return metrics.

### NonFunctional Requirements

NFR1: Deployment — runs locally first, later on Tommy's Linux server behind Nginx with TLS; installable from the repository with a documented, simple setup.
NFR2: Privacy — financial data stays on Tommy's machine/server; no third-party analytics; only symbols, ISINs, company names leave the server.
NFR3: Security — single-user authentication required on every page and route once reachable over the network.
NFR4: Public repository — no personal data, credentials or API keys in the repo; configuration via environment/config files.
NFR5: Correctness — numbers reconcile with broker statements; Depot value and Cost Basis exact; cent-level differences in realized Gain/Loss across many FIFO lots acceptable.
NFR6: Cost — no paid services required for core function; manual Prices keep the system usable if free sources fail.
NFR7: Responsiveness — usable in desktop and phone browsers; no native app.
NFR8: Currency — EUR only.
NFR9: Performance (SM-3) — monthly import incl. review of all document-based Depots in under 10 minutes; robo-advisor Depots produce tens of Transactions per month.
NFR10: Accessibility — WCAG 2.2 AA; gain/loss never by color alone; touch targets ≥ 44 px.
NFR11: Scope discipline (SM-C1) — no feature or Broker without a named personal use.

### Additional Requirements

**Starter / project setup (Epic 1 Story 1):** greenfield `create-next-app` scaffold (Next.js 16.4.2 App Router, TypeScript 5.9.3, React 19.3.0) with Prisma 7.10.1 + `@prisma/adapter-better-sqlite3` + better-sqlite3 12.11.1 (exact pins), MUI 9.5.0 + Emotion, zod 4.6.7, decimal.js 10.6.0, vitest 5.0.5; Node 24 LTS (`engines >=24.11 <25`); source tree per spine Structural Seed (`src/app`, `src/core`, `src/modules/*`, `src/db`, `prisma/`, `test/fixtures/`).

- AR1 (AD-1): Ledger is the only truth; Positions, lots, Cost Basis, balances, transaction prices, values, returns, composition computed by `src/core` on read; caches disposable; corrections only via Transactions.
- AR2 (AD-2): Dependency direction `app → modules → core`, `modules → db`; module model ownership (ledger, prices, import, news, logos, auth); services accept optional Prisma tx client.
- AR3 (AD-3): Single ledger write path through the `ledger` service (zod validation, sequence assignment, duplicate policy); restore via `replaceAll`.
- AR4 (AD-4): Import staging (ImportBatch/ImportItem), confirmation revalidates and books via AR3; pure parsers per Broker/document type tested against anonymised fixtures; file hash warns only; PDFs discarded after batch closes.
- AR5 (AD-5): Money/quantity/price as TEXT decimal strings, decimal.js only, no SQL arithmetic, rounding only at presentation.
- AR6 (AD-6): Cash Account = Depot (1:1); cash side derived by `core/cash`; migration collapses Parqet trade+cash pairs and adjusts amount to match the cash row.
- AR7 (AD-7): Corporate actions as Security-scoped events; split adjustment on read; ISIN change moves FIFO lots; Parqet transfer pairs → ISIN change.
- AR8 (AD-8): Business dates `YYYY-MM-DD` Europe/Berlin; intra-day sequence by ledger; order `(date, sequence)`, corporate actions first; "today" passed into core.
- AR9 (AD-9): Price provider interface; one ProviderMapping per Security (auto-resolved via OpenFIGI/Yahoo, editable); stored Prices unadjusted; source manual|provider, unique (securityId, date, source), `fetchedAt`; resolver manual > provider > transaction price > carry forward; `isStale` in core; history backfill for held Securities.
- AR10 (AD-10): Performance unit = Depot incl. Cash Account; external flows Deposits, Withdrawals, net taxes; one daily valuation series; invested capital = FIFO Cost Basis of open Positions.
- AR11 (AD-11): News providers (Google News RSS primary, yahoo-finance2 secondary) by name/ticker; cached; not in backup.
- AR12 (AD-12): Versioned JSON export incl. Prices and manual logos; restore upgrades old versions, auto-exports first, replaces all in one transaction.
- AR13 (AD-13): Single Node process; in-process scheduler via `instrumentation.ts` (price fetch on start + daily, daily DB backup); in-app login (bcrypt + jose session cookie); Next telemetry off; outbound only symbols/names.
- AR14 (AD-14): Canonical Transaction shape (types, unsigned gross amount, fee ≥ 0, signed tax, quantity/price only BUY/SELL, cash-effect formulas).
- AR15 (AD-15): One advisory duplicate function `unique | duplicate | ambiguous`; policy per path (import/migration review, manual warn, restore skip).
- AR16 (AD-16): Securities created only via idempotent `ledger.ensureSecurity` at confirmation; unique ISIN / crypto symbol; assetType incl. `UNCLASSIFIED`.
- AR17 (AD-17): Archive refused with open Positions or cash; archived Depot read-only; `heldSecurities` single definition.
- AR18 (AD-18): Fixed env vars (`DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `BACKUP_DIR`, `BACKUP_KEEP`, `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`, `DATA_DIR`) + `.env.example`; DB outside source tree; WAL + busy timeout; `prisma migrate deploy` in deploy script; daily `backup()` rotation.
- AR19 (AD-19): `logos` module — logo.dev primary, Elbstream fallback, issuer/underlying for certificates, CoinGecko for crypto; fetched once, stored under `DATA_DIR`, served locally; manual upload wins; never blocks ledger writes.
- AR20: Data sources per `data-sources.md` (yahoo-finance2 4.0.5, onvista JSON for certificates, CoinGecko + Binance backfill for crypto, OpenFIGI); EODHD only as escape hatch.
- AR21: Parqet CSV format and quirks per `parqet-export-format.md` (semicolon, decimal comma, newest first, dividends `shares=1`, negative tax = refund, `cost` tax rows, rounding mismatches, synthetic times).
- AR22: Testing — vitest; core, parsers and provider adapters unit-tested; provider contract test on a known split; migration reconciled against local untracked Parqet exports; no personal data in repo.

### UX Design Requirements

UX-DR1: MUI theme "Minze" — palette tokens (primary `#0FA68A`, accent `#FFB547`, background `#F3FBF8`, surface, ink, gain/loss + soft variants, stale, cash, chart-invested, series-1..5) with `-dark` variants; dark mode follows system with manual toggle.
UX-DR2: Typography and shape — Roboto ramp + roles page-title, figure-hero, figure-kpi, figure (tabular numerals); radii 16 card / 8 input / full pills; soft mint shadow; de-DE number/date formatting helpers.
UX-DR3: App shell — permanent left drawer on ≥ md (Übersicht, Depots, Import, Nachrichten, Wertpapiere, Einstellungen); bottom navigation on < md (Übersicht · Depots · Nachrichten · Mehr) with "+" FAB for new Transaction on Overview and Depot detail; German UI.
UX-DR4: Global Period selector (1M · YTD · 1J · 3J · Max · Benutzerdefiniert) as pill group in page header of Overview, Depot, Position; selection persists across surfaces and sessions.
UX-DR5: Hero card — total value (figure-hero), gain/loss pill (amount + TTWROR), XIRR beside, realized/unrealized expandable, area chart inside.
UX-DR6: KPI row — cards with colored top border: invested capital, dividends (Period), cash, taxes paid (Period); 2×2 grid on phones.
UX-DR7: Area chart — value line 3px primary with gradient fill, invested capital dashed, crosshair/tap tooltip; text alternative via KPIs.
UX-DR8: Composition donut + legend — toggle by Position (top 8 + "Sonstige") · asset type · Depot (Overview only); cash always own segment; legend tap highlights segment.
UX-DR9: Security logo component — 32px round, from local cache, deterministic-color initials fallback with no layout shift; used at every Security mention.
UX-DR10: Positions table — logo + Security, quantity, price + stale badge, value, Gain/Loss abs/% pill, share; sortable (default value desc); Cash row pinned bottom; stacked rows on phones.
UX-DR11: Transaction list — newest first, grouped by month, type icon, Security, quantity, amount, cash effect; row opens form; paginated by month (no infinite scroll).
UX-DR12: Transaction form — type-first adaptive fields; Security Autocomplete (ISIN/name) with "Neue Security anlegen"; live cash effect; duplicate warning with "Trotzdem buchen"; delete confirm; dialog on desktop, full-screen on phone; German decimal input.
UX-DR13: Import review — upload dropzone (multi-PDF), per-file section with status chip (erkannt/Duplikat/mehrdeutig/fehlgeschlagen), inline-editable proposals, per-proposal book/discard, ambiguous decisions gate "Buchen", failed file → "Manuell erfassen" prefilled form; open batches persist and are counted in nav.
UX-DR14: Stale badge and Overview stale Alert ("Kurse für N Wertpapiere veraltet") linking to Securities; tooltip with source and fetch time.
UX-DR15: Securities surface — list of all Securities; classify `UNCLASSIFIED`; edit provider mapping; manual Price entry; "Kurse aktualisieren" with progress and failure snackbar; replace/upload logo.
UX-DR16: Settings — Depots (create, rename, archive with disabled reason "Depot hat noch Positionen oder Guthaben."; archived group read-only), Parqet migration entry, export/restore (restore requires typing "WIEDERHERSTELLEN"), appearance (theme toggle).
UX-DR17: Parqet migration wizard — file → target Depot → preview (counts per type, detected ISIN changes, flagged rows: unpaired transfers, non-EUR, unclassified) → resolve → confirm → summary with Parqet comparison.
UX-DR18: State patterns — empty states (no Depot: "Depot anlegen" / "Aus Parqet übernehmen"; Depot without Transactions; no news), Skeleton loading, session-expired redirect with return URL, form errors keep input, price fetch failure per row.
UX-DR19: Voice and tone — German, short, factual microcopy per EXPERIENCE.md examples; name Depot and Security in confirmations.
UX-DR20: Interaction rules — no optimistic writes, no hover-only actions, no auto-booking, modal depth ≤ 1, Enter submits / Esc closes.
UX-DR21: Accessibility floor — WCAG 2.2 AA, sign + arrow with gain/loss colors, keyboard-operable forms and chart tooltips, ≥ 44 px touch targets, semantic tables and readable stacked rows.

### FR Coverage Map

FR1: Epic 1 - Manage Depots (create, rename, archive)
FR2: Epic 1 - Manual Transactions of every type
FR3: Epic 2 - Splits and ISIN changes
FR4: Epic 5 - Upload and parse broker PDFs
FR5: Epic 5 - Review before booking
FR6: Epic 5 - Duplicate protection in import (core matcher built in Epic 1, used by Epic 2)
FR7: Epic 3 - Automatic current prices, stale flag
FR8: Epic 3 - Historical prices, carry forward
FR9: Epic 3 - Manual price fallback
FR10: Epic 4 - Portfolio and Depot overview
FR11: Epic 4 - Value development chart
FR12: Epic 4 - Gain/Loss, TTWROR, XIRR
FR13: Epic 4 - Composition
FR14: Epic 3 - News on holdings
FR15: Epic 2 - One-time Parqet migration
FR16: Epic 6 - Export and restore
FR17: Epic 1 - Cash Account balance and history
FR18: Epic 4 - Cash in overviews and return metrics

## Epic List

### Epic 1: Foundation & Manual Bookkeeping
Tommy can sign in, create and manage Depots, record every Transaction type by hand, and see Positions with FIFO Cost Basis and each Cash Account balance. Includes the project starter, the "Minze" theme and app shell, and the ledger core (canonical Transaction shape, duplicate matcher, sequence, Security creation). Works without price sources: values fall back to the latest Transaction price (AD-9).
**FRs covered:** FR1, FR2, FR17 · **Also:** NFR3, NFR4, NFR7, NFR8, NFR10, AR1–AR3, AR5, AR6, AR8, AR14–AR18, UX-DR1–4, UX-DR9–12, UX-DR16 (Depots part), UX-DR18–21

### Epic 2: Corporate Actions & Parqet Migration
Tommy can record splits and ISIN changes and bring his complete history from Parqet into DepotManagement, with Positions, invested capital and Cash Account balances reconciled against Parqet. From here on he works with real data.
**FRs covered:** FR3, FR15 · **Also:** AR7, AR15, AR16, AR21, UX-DR17

### Epic 3: Market Data — Prices, Logos, News
Tommy gets current and historical Prices automatically, sees stale Prices flagged, can enter manual Prices and fix provider mappings, sees logos at every Security, and reads the last 14 days of news on his holdings.
**FRs covered:** FR7, FR8, FR9, FR14 · **Also:** NFR2, NFR6, AR9, AR11, AR13 (scheduler), AR19, AR20, UX-DR14, UX-DR15

### Epic 4: Overview & Performance
Tommy sees total and per-Depot value, invested capital, realized/unrealized Gain/Loss with dividends, fees and taxes, TTWROR and XIRR side by side, the value chart and composition for any Period, with cash included in totals.
**FRs covered:** FR10, FR11, FR12, FR13, FR18 · **Also:** NFR5, AR10, AR17 (held set), UX-DR4–8

### Epic 5: Document Import
Tommy uploads ROBIN and comdirect/cominvest PDF documents, reviews the extracted Transactions with duplicate and ambiguity flags, and books them in one step.
**FRs covered:** FR4, FR5, FR6 · **Also:** NFR9, AR4, AR15, AR22 (parser fixtures), UX-DR13

### Epic 6: Data Safety & Operations
Tommy can export and restore all data, gets a daily database backup, and runs DepotManagement on his Linux server behind Nginx with TLS using a documented setup.
**FRs covered:** FR16 · **Also:** NFR1, NFR2, AR12, AR13, AR18, UX-DR16 (export/restore part)

**Action outside the epics:** take the Parqet CSV export of every portfolio before cancelling the Parqet subscription.

## Epic 1: Foundation & Manual Bookkeeping

Tommy can sign in, create and manage Depots, record every Transaction type by hand, and see Positions with FIFO Cost Basis and each Cash Account balance. Works without price sources: values use the latest Transaction price (AD-9).

### Story 1.1: Project Starter and App Shell

As Tommy,
I want the app scaffolded on the agreed stack with the "Minze" look and navigation,
So that every later feature lands in a consistent, runnable codebase I can start locally.

**Acceptance Criteria:**

**Given** a fresh clone of the repository
**When** I follow the README setup (`npm install`, copy `.env.example` to `.env`, `prisma migrate deploy`, `npm run dev`)
**Then** the app starts on Node 24 with the exact versions pinned in the spine Stack table (Next.js 16.4.2, React 19.3.0, Prisma/client/adapter 7.10.1 exact, better-sqlite3 12.11.1, MUI 9.5.0, zod 4.6.7, decimal.js 10.6.0, vitest 5.0.5, TypeScript 5.9.3)
**And** the source tree follows the spine Structural Seed (`src/app`, `src/core`, `src/modules`, `src/db`, `prisma/`, `test/fixtures/`)
**And** an ESLint rule or test fails the build if `src/core` imports anything outside `src/core` except `decimal.js` (AD-2)
**And** `.env.example` lists all AD-18 variable names without values, `.env` and the SQLite file are git-ignored, and `DATABASE_URL` points outside the source tree by default
**And** the Prisma client opens SQLite in WAL mode with a busy timeout
**And** `NEXT_TELEMETRY_DISABLED=1` is set in scripts and README
**And** the MUI theme implements DESIGN.md tokens (palette incl. `-dark` variants, typography roles with tabular numerals, radii, shadow) and dark mode follows the system with a manual toggle persisted per browser (UX-DR1, UX-DR2)
**And** the shell shows the permanent drawer on ≥ md and bottom navigation on < md with the German labels from EXPERIENCE.md (UX-DR3); unbuilt surfaces show a neutral placeholder
**And** shared helpers format money, percentages, quantities and dates in de-DE from decimal strings without converting money to `number` (AD-5)
**And** `npm test` runs vitest with at least one passing core test.
**And** a project Definition of Done in the README binds every later UI story to EXPERIENCE.md voice and tone (UX-DR19), interaction rules — no optimistic writes, no hover-only actions, modal depth ≤ 1, Enter submits, Esc closes (UX-DR20) — and the accessibility floor — WCAG 2.2 AA, ≥ 44 px touch targets, sign + arrow with gain/loss colors (UX-DR21).

### Story 1.2: Single-User Login

As Tommy,
I want the app to require my login,
So that my financial data is protected once the app is reachable over the network.

**Acceptance Criteria:**

**Given** `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` (bcrypt) and `SESSION_SECRET` are set
**When** I open any page or route without a valid session
**Then** I am redirected to the login page (route handlers respond 401), and after a successful login I return to the originally requested URL
**And** a wrong username or password shows "Anmeldung fehlgeschlagen." without revealing which field was wrong
**And** the session is a `jose`-signed, httpOnly, sameSite=lax cookie (secure when served over HTTPS) with a fixed lifetime; logout clears it
**And** an expired session redirects to login with return URL (UX-DR18)
**And** the README documents how to generate the password hash with a provided script
**And** missing auth variables stop the app at startup with a clear error message.

### Story 1.3: Create and Rename Depots

As Tommy,
I want to create Depots for my brokers and rename them,
So that I can start organizing my holdings per securities account.

**Acceptance Criteria:**

**Given** I am logged in and have no Depots
**When** I open the Overview
**Then** I see the empty state "Noch kein Depot." with the action "Depot anlegen" ("Aus Parqet übernehmen" appears disabled until Epic 2) (UX-DR18)
**When** I create a Depot with a name and a Broker (`COMDIRECT`, `DEUTSCHE_BANK`, `FINANZEN_ZERO`)
**Then** it is stored by the `ledger` module (Depot model created in this story), appears in the Depots list and in Settings → Depots, and its Cash Account exists implicitly with balance 0,00 € (AD-6)
**And** I can rename a Depot; names must be non-empty and unique (zod-validated, error shown inline)
**And** the Depot detail page shows the Depot name, Broker and the empty state "Noch keine Buchungen." with the action "Neue Buchung".

### Story 1.4: Record Buys and Sells

As Tommy,
I want to record buys and sells for a Depot, creating Securities by ISIN when needed,
So that my trades are in the ledger.

**Acceptance Criteria:**

**Given** a Depot exists
**When** I open "Neue Buchung" (dialog on desktop, full-screen on phone) and choose Kauf or Verkauf
**Then** I can pick a Security via Autocomplete by ISIN or name, or choose "Neue Security anlegen" with ISIN (or crypto symbol), name and asset type (STOCK, ETF, CERTIFICATE, CRYPTO) (UX-DR12)
**And** the Security is created only on save via idempotent `ledger.ensureSecurity`; ISIN and upper-case crypto symbol are unique (AD-16)
**And** I enter date, quantity (up to 8 decimals), price, fee and tax; inputs accept German decimal comma and pasted `1.234,56`
**And** the saved Transaction follows AD-14 (amount = unsigned gross value = quantity × price as entered or stated, fee ≥ 0, signed tax), values are stored as TEXT decimal strings (AD-5), the business date as `YYYY-MM-DD`, and the ledger service assigns the next intra-day sequence (AD-8)
**And** all writes go through the `ledger` service with zod validation (AD-3); invalid input shows inline errors and keeps the form filled
**And** the Depot detail shows a Transactions tab listing Transactions newest first, grouped by month, with type icon, logo placeholder (initials) and Security name, quantity and amount (UX-DR9, UX-DR11)
**And** a sell exceeding the held quantity is rejected with "Verkauf übersteigt Bestand (x Stück)."

### Story 1.5: Positions with FIFO Cost Basis

As Tommy,
I want to see my Positions per Depot with FIFO Cost Basis,
So that I know what I hold and what it cost.

**Acceptance Criteria:**

**Given** a Depot with buys and sells
**When** I open the Positions tab of the Depot detail
**Then** each open Position shows Security (initials logo), quantity, Cost Basis, average purchase price, latest price, value and unrealized Gain/Loss abs/% (UX-DR10)
**And** Positions, FIFO lots and Cost Basis are computed on read by pure functions in `src/core` from the ledger, ordered by `(date, sequence)`; nothing derived is stored (AD-1)
**And** Cost Basis = price × quantity + fees of the remaining units, earliest units sold first; realized Gain/Loss per sale is computed by FIFO
**And** until price sources exist, the price of a Security is the latest Transaction price on or before today, resolved by the single core price resolver (AD-9)
**And** the table is sortable, defaults to value descending, and becomes stacked rows on phones
**And** core unit tests cover partial sells across several lots, fees in Cost Basis, fractional quantities and same-day buy-then-sell ordering, all with decimal.js (no float).

### Story 1.6: Cash Account and Non-Trade Transactions

As Tommy,
I want to record dividends, fees, taxes, deposits and withdrawals and see each Depot's Cash Account,
So that value moving between Positions and cash is explainable.

**Acceptance Criteria:**

**Given** a Depot exists
**When** I choose Dividende, Gebühr, Steuer, Einzahlung or Auszahlung in the Transaction form
**Then** the fields adapt per type as specified in AD-14 and EXPERIENCE.md (DIVIDEND: Security, gross amount, tax; FEE/TAX: value, optional Security; DEPOSIT/WITHDRAWAL: amount) and the form shows the computed cash effect live
**And** `core/cash` derives every Transaction's cash booking with the AD-14 formulas (BUY −(amount+fee+tax), SELL/DIVIDEND +amount−fee−tax, FEE −fee, TAX −tax, DEPOSIT +amount, WITHDRAWAL −amount); a negative tax (refund) increases cash
**And** the Depot detail has a Cash Account tab showing the current balance and booking history with each entry's cash effect (FR17)
**And** the Positions table shows a pinned, visually distinct Cash row at the bottom
**And** core tests cover every type's formula, tax refunds and a running balance across mixed Transactions.

### Story 1.7: Edit and Delete Transactions with Duplicate Warning

As Tommy,
I want to correct or delete Transactions and be warned about likely duplicates,
So that my ledger stays right without cleanup sessions.

**Acceptance Criteria:**

**Given** a booked Transaction
**When** I click its row
**Then** the form opens in edit mode; saving updates it through the ledger service and Positions, Cash Account and all views reflect the change on the next read (AD-1)
**When** I delete it
**Then** a confirm dialog names Depot, Security and date; after confirming, it is removed and views update
**Given** I save a new or edited Transaction
**When** `core/duplicates` finds a match on `(depotId, date, type, securityId|null, quantity|null, amount within €0.01)`
**Then** the form shows an inline warning describing the existing Transaction and requires "Trotzdem buchen" to proceed; the match is advisory and never blocks or drops by itself (AD-15)
**And** the duplicate function returns `unique | duplicate | ambiguous` and is unit-tested including two identical savings-plan buys on one day (`ambiguous`)
**And** editing that would make a later sell exceed the held quantity is rejected with an explanatory message.

### Story 1.8: Archive Depots

As Tommy,
I want to archive a Depot I no longer use,
So that it leaves my Portfolio figures while its history stays viewable.

**Acceptance Criteria:**

**Given** a Depot with no open Positions and a Cash Account balance of 0,00 €
**When** I archive it in Settings → Depots
**Then** it moves to a collapsed "Archiviert" group, is excluded from every aggregate and from `heldSecurities`, and remains viewable read-only (AD-17)
**Given** a Depot with open Positions or non-zero cash
**Then** the archive action is disabled with "Depot hat noch Positionen oder Guthaben." (UX-DR16)
**And** the ledger service rejects any write to an archived Depot; the UI hides write actions there
**And** I can unarchive a Depot, restoring write access
**And** core provides `heldSecurities(ledger)` (open Positions in non-archived Depots) as the single definition of "held", with unit tests.

## Epic 2: Corporate Actions & Parqet Migration

Tommy can record splits and ISIN changes and bring his complete history from Parqet into DepotManagement, reconciled against Parqet. From here on he works with real data.

### Story 2.1: Record Stock Splits

As Tommy,
I want to record a stock split for a Security,
So that quantities, prices and Cost Basis stay correct across the split.

**Acceptance Criteria:**

**Given** a held Security
**When** I choose "Corporate Action → Split" from the row menu of its Position in the Positions table and enter ratio (e.g. 1:4) and effective date
**Then** a CorporateAction row is stored on the Security by the `ledger` module (model created in this story) and applies in every Depot holding it (AD-7)
**And** stored Transactions and Prices are never modified; core applies the split on read, so quantities and per-unit prices before the effective date are shown split-adjusted and total Cost Basis is unchanged
**And** on the effective date corporate actions apply before that day's Transactions (AD-8)
**And** I can edit or delete a split through the ledger; views update on the next read
**And** core tests cover a split between two buys followed by a partial sell (FIFO on adjusted quantities).

### Story 2.2: Record ISIN Changes

As Tommy,
I want to record that one Security was replaced by another,
So that my Position continues under the new ISIN with its original Cost Basis and purchase dates.

**Acceptance Criteria:**

**Given** a held Security
**When** I choose "Corporate Action → ISIN-Wechsel" from the row menu of its Position, select or create the new Security (via `ensureSecurity`) and enter effective date, old quantity and new quantity (ratio may differ from 1:1)
**Then** a CorporateAction links old and new Security; core moves the open FIFO lots with their original purchase dates and total Cost Basis to the new Security, scaling quantities by the ratio (AD-7)
**And** the old Security no longer appears as an open Position after the effective date; its history stays visible in the Transaction list
**And** a later sell of the new Security realizes Gain/Loss against the carried-over lots
**And** `core/duplicates` resolves an incoming old ISIN to the current Security by following ISIN-change actions (AD-15)
**And** core tests cover a 1:1 and a non-1:1 change followed by a partial sell.

### Story 2.3: Parqet Export Preview

As Tommy,
I want to upload a Parqet CSV export for a Depot and see what would be imported,
So that I can check my history before anything is booked.

**Acceptance Criteria:**

**Given** a Depot exists
**When** I start "Aus Parqet übernehmen" (Settings, or the Overview empty state, now enabled), upload one CSV and select the target Depot (UX-DR17)
**Then** a pure reader in `modules/migration` parses the format of `parqet-export-format.md` (semicolon, quoted text, German decimal comma, newest rows first) and produces AD-14 proposals in chronological order; nothing is written to the database until confirmation
**And** Buy/Sell/Dividend rows are collapsed with their Cash TransferOut/TransferIn pair into one Transaction; on rounding mismatch the amount is adjusted so the derived cash booking equals the cash row (AD-6)
**And** dividends use `amount` (not `price × shares`); negative `tax` becomes a refund; a `cost` row with only `tax` becomes a TAX Transaction; unpaired Cash TransferIn/TransferOut become Deposit/Withdrawal; synthetic times are dropped and `datetime` is converted to the Europe/Berlin business date (AD-8)
**And** a same-timestamp Security TransferOut/TransferIn pair becomes an ISIN-change proposal; an unpaired Security transfer, a non-EUR row and an unparseable row are flagged with reasons and never booked silently
**And** Securities from `assettype = Security` are proposed as `UNCLASSIFIED`, `Crypto` as CRYPTO keyed by symbol (AD-16)
**And** the preview shows counts per type, detected ISIN changes, flagged rows, and the resulting Positions, invested capital and Cash Account balance as of the export date
**And** the reader is unit-tested with a synthetic, anonymised fixture covering every quirk in `parqet-export-format.md`; real exports are never committed.

### Story 2.4: Confirm Migration and Reconcile with Parqet

As Tommy,
I want to resolve flagged items, book the migration and see it reconciled against Parqet,
So that I can trust DepotManagement as my new source of truth.

**Acceptance Criteria:**

**Given** a Parqet preview from Story 2.3
**When** I classify each `UNCLASSIFIED` Security (STOCK, ETF, CERTIFICATE) and decide every flagged row (book as corrected / skip)
**Then** "Übernehmen" becomes enabled only when no decision is open
**When** I confirm
**Then** all proposals are booked through the ledger service in one DB transaction (AD-3), Securities via `ensureSecurity`, ISIN changes as CorporateActions, sequence assigned oldest-first
**And** duplicate matching runs against the existing ledger only, not within the file; matches are shown for decision before booking (AD-15)
**And** a summary shows Positions, invested capital and Cash Account balance versus the values Parqet's file implies at export date, plus a per-sale comparison of DepotManagement's FIFO realized Gain/Loss with Parqet's `realizedgains`, highlighting differences above €0.01 per sale
**And** if the export contains no cash rows, the summary states that the Cash Account balance could not be reconciled and offers an opening Deposit/Withdrawal to set it
**And** the migration can be repeated for each further Depot; re-running the same file books only what is not a duplicate.

## Epic 3: Market Data — Prices, Logos, News

Tommy gets current and historical Prices automatically, sees stale Prices flagged, can enter manual Prices and fix provider mappings, sees logos at every Security, and reads recent news on his holdings.

### Story 3.1: Securities Page and Provider Mapping

As Tommy,
I want a page listing all my Securities with their price source mapping,
So that I can see and fix where each Security's prices come from.

**Acceptance Criteria:**

**Given** Securities exist in the ledger
**When** I open "Wertpapiere"
**Then** I see every Security with logo placeholder, name, ISIN or symbol, asset type and its ProviderMapping (provider + symbol) (UX-DR15)
**And** the `prices` module (ProviderMapping model created here) auto-resolves a mapping once for each Security without one: OpenFIGI by ISIN (preferring the Xetra listing), falling back to Yahoo search; crypto maps to CoinGecko by symbol (AD-9, `data-sources.md`)
**And** I can edit the provider and symbol; at most one active mapping exists per Security; outbound requests carry only ISIN or symbol (AD-13)
**And** I can classify an `UNCLASSIFIED` Security (through `ledger`, AD-16); an "Typ unbekannt" chip marks unclassified ones (UX-DR18)
**And** the mapping resolver is unit-tested with recorded provider responses (no live network in tests).

### Story 3.2: Prices for Stocks and ETFs

As Tommy,
I want current and historical prices for my stocks and ETFs fetched automatically,
So that values and charts are accurate without manual work.

**Acceptance Criteria:**

**Given** a Security mapped to the Yahoo provider
**When** prices are fetched for it
**Then** the `prices` module (Price model created here) stores daily EUR closes via the provider interface (`fetchLatest`, `fetchHistory`), using `yahoo-finance2` 4.0.5
**And** history is backfilled from the Security's first Transaction date for every held Security (AD-17 held set) and when a ledger write introduces a new held Security
**And** stored Prices are unadjusted as-traded closes: the adapter undoes Yahoo's split adjustment using CorporateActions; recording or changing a split triggers a history refetch for that Security (AD-9)
**And** Price rows carry `source = provider`, unique `(securityId, date, source)`, and a UTC `fetchedAt`; values are TEXT decimals
**And** the core price resolver now applies precedence manual > provider > Transaction price, carrying forward the last known Price for dates without one (FR8)
**And** a provider contract test using recorded data for a Security with a known split proves unadjusted storage
**And** provider failures are recorded per Security and never break other fetches or ledger writes.

### Story 3.3: Scheduled Refresh and Stale Flags

As Tommy,
I want prices refreshed daily and on demand, with stale prices clearly marked,
So that I always know how current my numbers are.

**Acceptance Criteria:**

**Given** the app is running as its single process
**When** it starts and then once per day
**Then** the scheduler registered in `instrumentation.ts` fetches prices for all held Securities; a `globalThis` guard prevents double start; nothing runs during `next build` (AD-13)
**When** I click "Kurse aktualisieren" on the Securities page
**Then** an on-demand fetch runs with progress shown, and a snackbar names any Securities that failed (UX-DR15)
**And** core `isStale(latestPriceDate, today)` (older than 3 calendar days) is the only staleness rule; every price display shows a stale badge "Kurs vom dd.mm.yyyy – veraltet" with a tooltip giving source and fetch time (UX-DR14)
**And** the Positions table and Securities page show each Security's latest price date (FR7)
**And** a failed Security shows a row-level error with the provider name and a "Kurs manuell eintragen" action (UX-DR18).

### Story 3.4: Prices for Certificates and Crypto

As Tommy,
I want prices for my turbo certificates and crypto,
So that the small share of my Portfolio outside stocks and ETFs is valued too.

**Acceptance Criteria:**

**Given** a CERTIFICATE Security
**When** prices are fetched
**Then** an onvista provider adapter (unofficial JSON by ISIN) supplies latest and historical EUR prices; mapping defaults to onvista for certificates
**Given** a CRYPTO Security
**Then** a CoinGecko adapter (Demo key `COINGECKO_API_KEY`) supplies daily EUR prices, and a one-time Binance klines backfill (`<SYMBOL>EUR`, 1d) covers history older than 365 days
**And** both adapters implement the AD-9 provider interface, are unit-tested with recorded responses, and fail soft (stale flag + manual price) without automatic failover to another provider
**And** CoinGecko attribution ("Data provided by CoinGecko") is shown on the Securities page.

### Story 3.5: Manual Prices

As Tommy,
I want to enter or correct a price by hand,
So that Securities without a working source are still valued correctly.

**Acceptance Criteria:**

**Given** any Security
**When** I enter a price with date on the Securities page or via "Kurs manuell eintragen"
**Then** the `prices` module stores it with `source = manual` (AD-9)
**And** a manual price wins over a provider price for the same date in every view, chart and metric, and the scheduler never overwrites it
**And** I can edit and delete manual prices; a list per Security shows them with date
**And** a manual price clears the stale flag only if its date is within 3 days.

### Story 3.6: Security Logos

As Tommy,
I want company and fund logos next to my Securities,
So that the app is easier to scan and nicer to use.

**Acceptance Criteria:**

**Given** a Security without a stored logo
**When** it is created or first held
**Then** the `logos` module (SecurityLogo model created here) fetches a logo once in the background: logo.dev by ISIN/ticker (`LOGO_DEV_API_KEY`), fallback Elbstream; certificates use the issuer or underlying logo; crypto falls back to the CoinGecko image (AD-19)
**And** the file is stored under `DATA_DIR` with source and `fetchedAt` and served by an app route; the browser never contacts a logo provider
**And** the Security logo component (32px round) shows the stored logo everywhere a Security is shown, and deterministic-color initials when none exists, without layout shift (UX-DR9)
**And** I can upload or replace a logo on the Securities page; a manual logo is never overwritten
**And** a logo fetch failure never blocks or fails a ledger write.

### Story 3.7: News on Holdings

As Tommy,
I want headlines from the last 14 days for the Securities I hold,
So that I stay informed without a second app.

**Acceptance Criteria:**

**Given** held Securities (AD-17)
**When** I open "Nachrichten"
**Then** I see headlines of the last 14 days, newest first, each with Security logo and name, source, date and a link opening the original article in a new tab (FR14)
**And** I can filter by Security
**And** the `news` module queries by company name or ticker (never ISIN): Google News RSS (de + en) primary, `yahoo-finance2` search news secondary, merges and de-duplicates by URL/title, and caches results; news is not ledger data and not backed up (AD-11)
**And** news refresh runs with the daily scheduler and on opening the page if the cache is older than a few hours
**And** with no headlines the page shows "Keine Nachrichten der letzten 14 Tage." (UX-DR18)
**And** provider parsing is unit-tested with recorded feeds.

## Epic 4: Overview & Performance

Tommy sees total and per-Depot value, invested capital, realized/unrealized Gain/Loss with dividends, fees and taxes, TTWROR and XIRR, the value chart and composition for any Period, with cash included.

### Story 4.1: Depot Value Summary with Period Selector

As Tommy,
I want each Depot's value, invested capital and cash summarized for a chosen Period,
So that I can see at a glance how a Depot stands.

**Acceptance Criteria:**

**Given** a Depot with Transactions and Prices
**When** I open its detail page
**Then** a hero card shows total value (Positions + Cash Account, figure-hero) and a KPI row shows invested capital, dividends (Period), cash and taxes paid (Period) as cards with colored top borders; 2×2 grid on phones (UX-DR5, UX-DR6, FR10, FR18)
**And** core produces one daily valuation series per Depot (Position values via the price resolver, cash via `core/cash`, invested capital = FIFO Cost Basis of open Positions), which every figure and later chart reads (AD-10)
**And** a Period selector (1M · YTD · 1J · 3J · Max · Benutzerdefiniert with date range) sits in the page header; the choice persists across Overview, Depot and Position pages and across sessions (UX-DR4)
**And** archived Depots show their last values read-only
**And** core tests verify value = Σ Position values + cash on sample days, including carried-forward Prices.

### Story 4.2: Gain/Loss and Return Metrics

As Tommy,
I want Gain/Loss split into realized and unrealized plus TTWROR and XIRR for the Period,
So that I can judge performance the way I do in Parqet.

**Acceptance Criteria:**

**Given** a Depot and a selected Period
**When** the Depot page renders
**Then** the hero card shows a gain/loss pill with Period Gain/Loss and TTWROR, XIRR beside it, and an expandable breakdown: realized, unrealized, dividends, fees, and taxes paid shown separately (FR12, UX-DR5)
**And** Period Gain/Loss = change in value − net external flows; external flows are Deposits, Withdrawals and net taxes (paid minus refunds), so figures are gross (AD-10, FR18)
**And** TTWROR chains daily sub-period returns between external flows; XIRR solves the money-weighted rate over the Period's flows plus start and end value; both from the same valuation series
**And** realized Gain/Loss uses FIFO Cost Basis per sale
**And** gain/loss colors always come with sign and arrow (UX-DR21)
**And** core tests cover: a Deposit not counted as gain, a tax refund, a Period with no flows (TTWROR = XIRR-equivalent sanity check), and a reference case with hand-calculated TTWROR and XIRR.

### Story 4.3: Value Development Chart

As Tommy,
I want a chart of value and invested capital over the Period,
So that I can spot trends.

**Acceptance Criteria:**

**Given** a Depot and a Period
**When** the hero card renders
**Then** an area chart shows value (3px primary line with gradient fill) and invested capital (dashed) from the core valuation series (UX-DR7, FR11)
**And** a crosshair (mouse) or tap (touch) tooltip shows date, value and invested capital, reachable by keyboard
**And** chart values on any date equal the KPI figures computed for that date
**And** the chart library is chosen in this story, wrapped in one component reused by Overview and Position pages, and receives numbers only at the presentation edge (AD-5).

### Story 4.4: Portfolio Overview

As Tommy,
I want one overview across all my Depots,
So that I see how everything together is doing (UJ-1).

**Acceptance Criteria:**

**Given** at least one non-archived Depot
**When** I open "Übersicht"
**Then** I see the hero card (Portfolio value, Gain/Loss pill, TTWROR, XIRR, area chart), the KPI row, top Positions with logos, the Depot table (value, Gain/Loss, TTWROR, XIRR per Depot) and the latest three headlines from the news module, laid out as in `mockups/overview-desktop.html` (FR10, FR11, FR12, FR18)
**And** Portfolio figures are the sum of non-archived Depots from the same valuation series (AD-10, AD-17)
**And** the stale Alert "Kurse für N Wertpapiere veraltet" appears above the KPIs when any held Price is stale, linking to Wertpapiere (UX-DR14)
**And** tapping a Depot row opens its detail; loading shows Skeletons (UX-DR18)
**And** the page is usable at phone width without horizontal scroll (bottom navigation, FAB "+" for a new Transaction).

### Story 4.5: Composition

As Tommy,
I want to see what my Portfolio and each Depot consist of,
So that I understand my allocation.

**Acceptance Criteria:**

**Given** Overview or Depot detail
**When** I view "Zusammensetzung"
**Then** a donut with legend shows shares by Position (top 8 + "Sonstige"), by asset type (ETF, Aktie, Zertifikat, Krypto, Guthaben, Unklassifiziert if any) and — on Overview only — by Depot (FR13, UX-DR8)
**And** cash is always its own segment in `{colors.cash}`; segments follow the series color order
**And** percentages sum to 100 % of total value including cash; the legend shows percentage and amount, and tapping a legend row highlights its segment
**And** the donut has a text alternative listing the segments (UX-DR21).

### Story 4.6: Position Detail

As Tommy,
I want a detail page for each Position,
So that I can drill into a holding before deciding to act (UJ-1 climax).

**Acceptance Criteria:**

**Given** a Position in a Depot
**When** I tap it in the Positions table or top Positions
**Then** I see the Security header (logo, name, ISIN, type, Depot), hero card with value, Period Gain/Loss and area chart, KPI cards (Cost Basis, unrealized, dividends in Period, average purchase price), latest price with date and stale badge, the FIFO lots, the Security's Transactions and its news of the last 14 days, as in `mockups/position-phone.html`
**And** a stale Position shows "Keine Kursquelle liefert aktuelle Kurse." with "Kurs manuell eintragen"
**And** menu actions offer Corporate Action (split, ISIN change) and new Transaction for this Security
**And** the Period selector applies; no news shows "Keine Nachrichten der letzten 14 Tage."

## Epic 5: Document Import

Tommy uploads ROBIN and comdirect/cominvest PDF documents, reviews the extracted Transactions with duplicate and ambiguity flags, and books them in one step.

### Story 5.1: Upload Documents into a Review Batch

As Tommy,
I want to drop many broker PDFs for a Depot into the app,
So that they are collected for review in one batch.

**Acceptance Criteria:**

**Given** a non-archived Depot
**When** I choose "Dokumente importieren" on the Depot detail (or "Import" in the navigation) and drop or pick several PDFs
**Then** the `import` module (ImportBatch and ImportItem models created here) creates one batch with one item per file (UX-DR13)
**And** text is extracted with `unpdf`; each item is passed to a parser registry keyed by Broker and document type; a file no parser recognizes gets status `failed` with "Layout nicht erkannt. Buchung bitte manuell erfassen."
**And** a file whose hash was imported before shows a warning but is not blocked (AD-4)
**And** nothing is written to the ledger and no Security is created in this step (AD-4)
**And** open batches persist across sessions until booked or discarded, and the Import navigation entry shows their count
**And** uploaded PDFs are deleted when the batch is booked or discarded
**And** the parser registry contract (`(extractedText) → TransactionProposal[] | ParseError`, proposals in AD-14 shape) is defined and unit-tested with a stub parser.

### Story 5.2: Deutsche Bank / ROBIN Parser

As Tommy,
I want ROBIN buy, sell and dividend confirmations recognized,
So that my robo-advisor Depot no longer needs manual entry.

**Acceptance Criteria:**

**Given** a batch for a `DEUTSCHE_BANK` Depot
**When** a ROBIN buy, sell or dividend confirmation PDF is processed
**Then** a pure parser extracts date, ISIN, type, quantity, price, gross amount, fee and tax into AD-14 proposals and marks the item `parsed`; the batch view lists the proposals per file
**And** savings-plan and rebalancing documents with several executions produce one proposal per execution
**And** amounts are parsed from German formats into decimal strings without float conversion (AD-5)
**And** unexpected layouts yield `failed` with a specific reason, never a partial proposal
**And** the parser is unit-tested against anonymised text fixtures of each document type committed under `test/fixtures/` (real PDFs never committed; Tommy supplies anonymised samples).

### Story 5.3: Review and Book Imported Transactions

As Tommy,
I want to review, correct and book the recognized Transactions,
So that only checked data enters my ledger (UJ-2).

**Acceptance Criteria:**

**Given** a batch with parsed items
**When** I open it
**Then** each file shows a status chip (erkannt, Duplikat, mehrdeutig, fehlgeschlagen) and its proposals with Security logo and name, editable inline, each with Buchen/Verwerfen, as in `mockups/import-review.html` (UX-DR13)
**And** `core/duplicates` checks every proposal against the ledger and the rest of the batch: `duplicate` items are shown as "Bereits gebucht am …" and not booked; `ambiguous` items require my explicit decision, and "N Buchungen buchen" stays disabled until all are decided (AD-15, FR6)
**When** I click "Buchen"
**Then** the batch revalidates against the current ledger, creates Securities via `ensureSecurity`, and books all accepted proposals through the ledger service in one DB transaction (AD-3); a snackbar reports "N Buchungen gebucht."
**And** re-importing the same document books nothing new (FR6)
**And** a failed file offers "Manuell erfassen", opening the Transaction form prefilled with Depot and, where readable, date (UX-DR13)
**And** for a batch of 15 documents, upload-to-booked takes under two minutes of interaction excluding my reading time (NFR9).

### Story 5.4: comdirect / cominvest Parser

As Tommy,
I want comdirect and cominvest confirmations recognized,
So that I can stop relying on Parqet's error-prone autosync.

**Acceptance Criteria:**

**Given** a batch for a `COMDIRECT` Depot
**When** a comdirect or cominvest buy, sell or dividend confirmation PDF is processed
**Then** a pure parser extracts AD-14 proposals as in Story 5.2 and the review and booking flow of Story 5.3 applies unchanged
**And** fractional savings-plan executions and Wertpapierabrechnungen with separate fee and tax lines are handled
**And** unexpected layouts yield `failed` with a specific reason
**And** the parser is unit-tested against anonymised text fixtures of each document type.

## Epic 6: Data Safety & Operations

Tommy can export and restore all data, gets a daily database backup, and runs DepotManagement on his Linux server behind Nginx with TLS using a documented setup.

### Story 6.1: Export All Data

As Tommy,
I want to export everything to one open file,
So that my data is never locked into the app.

**Acceptance Criteria:**

**Given** data in the ledger
**When** I click "Exportieren" in Settings
**Then** I download one JSON file `depotmanagement-export-<YYYYMMDD-HHMMSS>.json` with a `schemaVersion`, containing Depots, Securities, ProviderMappings, Transactions, CorporateActions, all stored Prices (manual and fetched) and manual logos as base64 (AD-12)
**And** caches, import staging, news and fetched logos are excluded
**And** decimals and dates are strings exactly as stored; IDs and intra-day sequences are kept
**And** the export schema is defined with zod and documented in the README.

### Story 6.2: Restore from Export

As Tommy,
I want to restore an export into an instance,
So that I can recover from mistakes or move to my server.

**Acceptance Criteria:**

**Given** an export file
**When** I choose "Wiederherstellen" in Settings, select the file and type "WIEDERHERSTELLEN" to confirm (UX-DR16)
**Then** the file is validated; older `schemaVersion`s are upgraded through pure upgrade functions; an invalid file is rejected with a reason and nothing changes
**And** an automatic export of the current data is written to `BACKUP_DIR` before anything is replaced
**And** in one DB transaction staging and caches are cleared and `ledger.replaceAll` and `prices.replaceAll` (and logos) replace all data, keeping IDs and sequences and skipping duplicate matching (AD-3, AD-12)
**And** export → restore into an empty instance → export again yields identical files, and all evaluations (values, Cost Basis, Gain/Loss, TTWROR, XIRR) are identical (FR16) — covered by an automated round-trip test
**And** restore never merges.

### Story 6.3: Daily Database Backup

As Tommy,
I want an automatic daily backup of the database,
So that a disk or operator error never costs me my history.

**Acceptance Criteria:**

**Given** `BACKUP_DIR` and `BACKUP_KEEP` are set
**When** the in-process scheduler runs its daily job (and once at startup if today's backup is missing)
**Then** a consistent copy of the SQLite database is written with better-sqlite3 `backup()` to `BACKUP_DIR/depot-<YYYY-MM-DD>.sqlite` (safe under WAL), and only the newest `BACKUP_KEEP` files are kept (AD-18)
**And** a failed backup is logged and shown as a warning in Settings with the time of the last successful backup
**And** the README documents restoring from such a file.

### Story 6.4: Production Deployment behind Nginx

As Tommy,
I want a documented, simple setup on my Linux server,
So that I can use DepotManagement from anywhere over HTTPS.

**Acceptance Criteria:**

**Given** a Linux server with Node 24 and Nginx
**When** I follow the README deployment section
**Then** a deploy/start script installs dependencies, runs `prisma migrate deploy`, builds, and starts `next start` on 127.0.0.1 as exactly one process; the app never migrates itself (AD-13, AD-18)
**And** an example systemd unit (restart on failure, env file outside the repo, logs to journald via stdout) and an example Nginx server block (TLS, proxy to 127.0.0.1, upload size sufficient for PDF batches) are provided
**And** the database file, `BACKUP_DIR` and `DATA_DIR` live outside the source tree
**And** moving local data to production is documented as export (Story 6.1) → restore (Story 6.2)
**And** the README contains no personal data, credentials or keys, and a check (script or CI step) fails if `.env`, SQLite files or Parqet CSVs are tracked by git (NFR4).
