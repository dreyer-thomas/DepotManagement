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
FR4: Tommy can upload one or many broker PDF documents for a Depot and get Transactions extracted; v1 supports Deutsche Bank/ROBIN, comdirect/cominvest and finanzen.net zero/Baader Bank buy, sell and dividend confirmations (finanzen.net zero also tax refunds); each file shows status parsed, duplicate, or failed with reason.
FR5: Tommy can review, correct or discard extracted Transactions before they are booked.
FR6: The system detects already-booked Transactions (earlier import, migration or manual entry) and does not book them twice; re-importing the same document books nothing; duplicate = Depot, date, ISIN (Security), type and quantity match and amount within €0.01; ambiguous matches (e.g. identical savings-plan buys on one day) are flagged in review, never auto-dropped.
FR7: The system fetches current Prices for all held Securities at least daily and on demand; the UI shows the latest Price timestamp per Security; Prices older than 3 days are flagged stale in all overviews.
FR8: The system obtains daily historical Prices for each held Security back to its first Transaction; missing dates carry forward the last known Price (sourced, manual or from a Transaction) for value, charts and return metrics.
FR9: Tommy can enter or correct a Price manually when no Price Source covers a Security.
FR10: Tommy can see current value, invested capital and Gain/Loss (absolute and %) for the Portfolio and each Depot, plus the list of Positions with value and Gain/Loss.
FR11: Tommy can see a chart of value and invested capital over a selectable Period for the Portfolio or a single Depot.
FR12: Tommy can see Gain/Loss for a selectable Period split into realized and unrealized with dividends and fees; TTWROR and XIRR side by side for Portfolio and each Depot; realized Gain/Loss uses FIFO and matches Parqet's `realizedgains` per sale after migration; shown gross with taxes paid in the Period as a separate figure.
FR13: Tommy can see the Portfolio or a Depot broken down by Position, by asset type (stock, ETF, fund, certificate, crypto, cash) and by Depot; no ETF look-through.
FR14: Tommy can see news headlines of the last 14 days for held Securities, overall and per Security, each linking to the original article; where the source provides one, a short teaser text is readable in the app before opening the article.
FR15: Tommy can import his full Transaction history once from Parqet CSV exports, one file per Depot with target Depot selected; Positions, invested capital and Cash Account balance match Parqet at export date; same-timestamp Security transfers paired by ISIN → split, single out/in of different ISINs → ISIN change, unpaired TransferIn → delivery (BUY + equal DEPOSIT), only unpaired TransferOut flagged; no per-row decisions, asset types estimated from names; exports without cash rows get minimal funding deposits so cash never goes negative; cash rows are paired per instant and unmatched differences booked as TAX so no trade is skipped; sells exceeding the holding by ≤ 0.001 units are clamped with the shortfall carried to the next buy; inflow-side cash differences become DEPOSITs, outflow-side become TAX, and minimal funding applies to every export so cash never goes negative; Cash movements become Deposits, Withdrawals and cash sides; later imported documents for migrated Transactions are detected as duplicates. Depends on FR3 and FR17.
FR16: Tommy can export all Depots and Transactions to an open file format and restore from it; export → restore into an empty instance reproduces identical Depots, Cash Accounts, Transactions, manual Prices and evaluations; restore replaces, never merges.
FR17: Tommy can see balance and booking history of each Depot's Cash Account; buy, sell, dividend, fee and tax book their cash side automatically; Deposits and Withdrawals are entered manually and change only the Cash Account.
FR18: Portfolio and Depot overviews and charts include Cash Account balances in total value, shown separately from Positions; Deposits and Withdrawals are external cash flows in both return metrics.
FR21: Tommy can see his Portfolio or a Depot split by asset class, type, sector, industry, region, country, company size and currency (ETFs and funds classified as a whole, manual override), with the Positions behind each segment.
FR22: Tommy can analyse returns per month and year (heatmap), the drawdown of his Portfolio or a Depot over the chosen Period, realized gains and cash flow per month and year, and dividends per month, year and Security with trailing-12-month income and an estimate of the next 12 months.
FR20: Tommy can reconcile a Depot against a broker statement position by position (persisted run with checks, finished explicitly) and book holding corrections (ADJUSTMENT: no cash, no realized gain, external flow in returns) or cash corrections.
FR19: Tommy can open a detail page per Security across all Depots (also when no longer held) showing news, price history with his buys and sells marked, the Transaction history with Depot, and the all-time result since the first buy (realized, unrealized, dividends, fees, taxes, total, return in % and XIRR).

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
UX-DR17: Parqet migration wizard — file → target Depot → preview (counts per type, detected splits, ISIN changes and deliveries, estimated asset type per Security, collapsed list of rows not taken over) → one-click confirm → summary with Parqet comparison.
UX-DR18: State patterns — empty states (no Depot: "Depot anlegen" / "Aus Parqet übernehmen"; Depot without Transactions; no news), Skeleton loading, session-expired redirect with return URL, form errors keep input, price fetch failure per row.
UX-DR19: Voice and tone — German, short, factual microcopy per EXPERIENCE.md examples; name Depot and Security in confirmations.
UX-DR20: Interaction rules — no optimistic writes, no hover-only actions, no auto-booking, modal depth ≤ 1, Enter submits / Esc closes.
UX-DR21: Accessibility floor — WCAG 2.2 AA, sign + arrow with gain/loss colors, keyboard-operable forms and chart tooltips, ≥ 44 px touch targets, semantic tables and readable stacked rows.

### FR Coverage Map

FR1: Epic 1 - Manage Depots (create, rename, archive)
FR2: Epic 1 - Manual Transactions of every type
FR3: Epic 2 - Splits and ISIN changes
FR4: Epic 5 - Upload and parse broker PDFs (finanzen.net zero added in Story 5.5; ISIN-change notices in Story 5.6)
FR5: Epic 5 - Review before booking
FR6: Epic 5 - Duplicate protection in import (core matcher built in Epic 1, used by Epic 2)
FR7: Epic 3 - Automatic current prices, stale flag
FR8: Epic 3 - Historical prices, carry forward
FR9: Epic 3 - Manual price fallback
FR10: Epic 4 - Portfolio and Depot overview
FR11: Epic 4 - Value development chart
FR12: Epic 4 - Gain/Loss, TTWROR, XIRR
FR13: Epic 4 - Composition
FR14: Epic 3 - News on holdings, news teasers (Stories 3.7, 3.8)
FR15: Epic 2 - One-time Parqet migration (Stories 2.3, 2.4; hands-off rework in 2.5; cash-less exports and Depot deletion in 2.6; robust cash pairing and rounding tolerance in 2.7; missing deposits and fee-aware gain comparison in 2.8)
FR16: Epic 6 - Export and restore
FR17: Epic 1 - Cash Account balance and history
FR18: Epic 4 - Cash in overviews and return metrics
FR19: Epic 4 - Security detail page and all-time performance (Stories 4.6, 4.7)
FR21: Epic 7 - Security classification and allocation analysis (Stories 7.1, 7.2)
FR22: Epic 7 - Return heatmap, realized gains, cash flow, dividends, drawdown, dividend charts, Security analyses (Stories 7.3–7.8)
FR20: Epic 2 - Depot reconciliation and holding corrections (Story 2.9)

## Epic List

### Epic 1: Foundation & Manual Bookkeeping
Tommy can sign in, create and manage Depots, record every Transaction type by hand, and see Positions with FIFO Cost Basis and each Cash Account balance. Includes the project starter, the "Minze" theme and app shell, and the ledger core (canonical Transaction shape, duplicate matcher, sequence, Security creation). Works without price sources: values fall back to the latest Transaction price (AD-9).
**FRs covered:** FR1, FR2, FR17 · **Also:** NFR3, NFR4, NFR7, NFR8, NFR10, AR1–AR3, AR5, AR6, AR8, AR14–AR18, UX-DR1–4, UX-DR9–12, UX-DR16 (Depots part), UX-DR18–21

### Epic 2: Corporate Actions & Parqet Migration
Tommy can record splits and ISIN changes and bring his complete history from Parqet into DepotManagement, with Positions, invested capital and Cash Account balances reconciled against Parqet. From here on he works with real data.
**FRs covered:** FR3, FR15, FR20 · **Also:** AR7, AR15, AR16, AR21, UX-DR17

#### Story 2.9: Depot Reconciliation and Holding Corrections

As Tommy,
I want to reconcile a Depot against my broker statement position by position and correct real errors,
So that every holding and the Cash Account match my broker without faking sales.

**Acceptance Criteria:**

**Given** a non-archived Depot
**When** I choose "Depot abgleichen" in the Depot detail ⋮ menu and enter the statement date
**Then** a reconciliation run opens listing every Position held on that date plus the Cash Account, each with the app's quantity (balance) on that date, an input for the statement value and a "stimmt" check
**And** a row whose statement value equals the app value (or that I check) is marked ✅ "abgeglichen"; a differing row shows the difference and two actions: "Buchungen ansehen" (the Security detail history in this Depot, possible duplicates marked by `core/duplicates`) and "Korrektur buchen"
**And** the header shows progress "x von y abgeglichen"; checks and entered values of the open run persist across sessions; at most one open run per Depot
**And** "Abgleich abschließen" ends the run (asking once when rows are still open); the next run starts empty; the Depot detail shows "Zuletzt abgeglichen am <statement date>"
**Given** a differing Position row
**When** I choose "Korrektur buchen"
**Then** a new Transaction type `ADJUSTMENT` ("Bestandskorrektur") is booked through the ledger service on the statement date with the signed quantity difference: no cash effect, no realized Gain/Loss; a positive difference adds a FIFO lot at a unit cost defaulting to the Position's average purchase price (editable), a negative difference removes the oldest FIFO units at their Cost Basis (AD-14)
**And** in TTWROR and XIRR the market value of the correction counts as an external flow (inflow for +, outflow for −) so returns are not distorted (AD-10)
**And** the correction appears in the Transaction history as "Bestandskorrektur" and can be edited and deleted like any Transaction; afterwards the row shows ✅
**Given** a differing Cash Account row
**When** I choose "Korrektur buchen"
**Then** a DEPOSIT or WITHDRAWAL for the difference is booked on the statement date with the note "Kontoabgleich"
**And** reconciliation runs and their entered statement values are stored by the `ledger` module (user-entered statement data, not derived) and included in export/restore; core functions for ADJUSTMENT in FIFO, cash and returns have unit tests

## Epic 3: Market Data — Prices, Logos, News
Tommy gets current and historical Prices automatically, sees stale Prices flagged, can enter manual Prices and fix provider mappings, sees logos at every Security, and reads the last 14 days of news on his holdings.
**FRs covered:** FR7, FR8, FR9, FR14 · **Also:** NFR2, NFR6, AR9, AR11, AR13 (scheduler), AR19, AR20, UX-DR14, UX-DR15

### Epic 4: Overview & Performance
Tommy sees total and per-Depot value, invested capital, realized/unrealized Gain/Loss with dividends, fees and taxes, TTWROR and XIRR side by side, the value chart and composition for any Period, with cash included in totals.
**FRs covered:** FR10, FR11, FR12, FR13, FR18, FR19 · **Also:** NFR5, AR10, AR17 (held set), UX-DR4–8

### Epic 5: Document Import
Tommy uploads ROBIN, comdirect/cominvest and finanzen.net zero PDF documents, reviews the extracted Transactions with duplicate and ambiguity flags, and books them in one step.
**FRs covered:** FR4, FR5, FR6 · **Also:** NFR9, AR4, AR15, AR22 (parser fixtures), UX-DR13

### Epic 6: Data Safety & Operations
Tommy can export and restore all data, gets a daily database backup, and runs DepotManagement on his Linux server behind Nginx with TLS using a documented setup.
**FRs covered:** FR16 · **Also:** NFR1, NFR2, AR12, AR13, AR18, UX-DR16 (export/restore part)

### Epic 7: Analyses
Tommy analyses his holdings like in Parqet: allocation by asset class, type, sector, industry, region, country, company size and currency (ETFs and funds as a whole), a monthly/yearly return heatmap, realized gains and cash flow per month and year, dividend history with trailing-12-month income, and the drawdown over the chosen Period.
**FRs covered:** FR21, FR22 · **Also:** AR9, AR13, UX-DR8 (donut pattern)

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
**Then** I can pick a Security via Autocomplete by ISIN or name, or choose "Neue Security anlegen" with ISIN (or crypto symbol), name and asset type (STOCK, ETF, FUND, CERTIFICATE, CRYPTO; FUND added by Story 2.5) (UX-DR12)
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

### Story 2.5: Hands-off Parqet Migration

As Tommy,
I want the Parqet migration to book my history without asking me row by row,
So that moving away from Parqet takes minutes, not an afternoon of decisions.

**Acceptance Criteria:**

**Given** the asset types of the ledger
**Then** `FUND` (active mutual fund, label "Fonds") is added to `AssetType` via a new migration and is selectable wherever an asset type is chosen (new Security in the Transaction form, ISIN-change dialog, migration preview)
**Given** a Parqet preview with new Securities from `assettype = Security`
**When** the preview is built
**Then** a pure core classifier assigns each one a type from its name, in this order: contains `ETF`, `ETC`, `ETN` or `UCITS ETF`, or issuer `iShares`, `Xtrackers`, `Vanguard`, `Amundi`, `Lyxor`, `SPDR`, `Invesco`, `WisdomTree` → ETF; contains `Turbo`, `Knock-Out`, `Mini Future`, `Optionsschein`, `Open End` → CERTIFICATE; contains `SICAV`, `Fund`, `Funds`, `Fonds` → FUND; otherwise STOCK; `Crypto` rows stay CRYPTO
**And** classification is no longer an open decision: the preview shows the estimated type per Security with an optional inline override, and the type stays editable later
**And** the classifier is unit-tested with the fund, ETF and ETC names from the real-data trial (AB SICAV I Concentrated US Equity Portfolio, BlackRock Global Funds European Special Situations Fund, Fidelity Funds - USD Bond Fund, iShares Developed Markets Property Yield UCITS ETF, Xtrackers Physical Gold ETC) and typical stock and turbo names
**Given** Security transfer rows sharing one instant
**When** the reader groups them
**Then** it first pairs `TransferOut` and `TransferIn` of the same ISIN into a split proposal (ratio = new quantity / old quantity, AD-7); then a remaining single out + single in of different ISINs becomes an ISIN change as before
**And** every remaining `TransferIn` becomes a delivery: a BUY with Parqet's shares, price and amount plus a DEPOSIT of the same amount on the same date, so the Cash Account is unchanged and the delivery counts as an external inflow (AD-10, AD-14)
**And** only a remaining unpaired `TransferOut` is still flagged
**Given** remaining flags (unpaired `TransferOut`, `non-eur`, `unparseable`, `unsupported-row`, `cash-pair-mismatch`)
**Then** they are listed in a collapsed "Nicht übernommen (n)" section that does not block "Übernehmen"; a single "Alle wie in Parqet übernehmen" books every flag that has a valid prefilled correction and skips the rest; the summary lists what was skipped
**And** duplicate matching against an existing ledger (AD-15) still shows matches for decision; on an empty Depot there are none
**Given** the synthetic fixture extended with a five-row `TransferIn` group, a same-ISIN out/in split pair and fund/ETC names
**When** it is previewed into an empty Depot
**Then** there are zero open decisions, "Übernehmen" is enabled immediately, and the resulting Positions, invested capital and Cash Account balance match the fixture's expected values

### Story 2.6: Funding for Exports without Cash Rows and Depot Deletion

As Tommy,
I want a Parqet export without cash movements to produce a sensible Cash Account, and a way to delete a Depot completely,
So that my cominvest history imports without a fake −26.000 € balance and I can redo a failed migration.

**Acceptance Criteria:**

**Given** a Parqet export that contains no `Cash` rows at all (e.g. a Parqet portfolio filled by comdirect/cominvest autosync)
**When** the preview is built
**Then** the preview states "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt"
**And** proposals are walked in `(date, sequence)` order with the running balance from `core/cash`; whenever a proposal's cash effect would take the balance below zero, a DEPOSIT for exactly the shortfall is inserted on the same date, sequenced directly before it (AD-6, AD-14)
**And** proceeds from sells and dividends stay in the Cash Account and fund later buys, so only the minimal external funding is added
**And** the Cash Account therefore never goes negative in the migrated history, and the inserted deposits count as external inflows in TTWROR and XIRR (AD-10)
**And** exports that contain `Cash` rows are processed exactly as before
**And** after booking, the existing balance alignment from Story 2.4 can set the final Cash Account balance to the broker's value at export date
**And** a pure core function computes the funding deposits and is unit-tested with a synthetic cash-less fixture (buys, sells, a dividend, fees): never negative, deposits sum to the minimal funding
**Given** a Depot in Settings → Depots
**When** I choose "Depot löschen" and type the Depot's name to confirm
**Then** the Depot, all its Transactions, its import staging and any caches are deleted through the `ledger` service in one DB transaction (AD-3); Securities and Prices shared with other Depots stay
**And** the confirm dialog states how many Transactions will be deleted and that this cannot be undone
**And** after deletion the same Parqet export can be migrated again into a newly created Depot

### Story 2.7: Robust Cash Pairing and Rounding Tolerance in the Parqet Migration

As Tommy,
I want every trade from my Parqet exports to be booked even when Parqet's cash rows do not match the trade figures,
So that no buy goes missing and no later sell fails with "Verkauf übersteigt Bestand".

**Acceptance Criteria:**

**Given** trade rows (BUY, SELL, DIVIDEND) and `Cash` rows of a Parqet export
**When** the reader pairs them
**Then** all trades and cash rows sharing one instant form a group; within a group, trades are paired 1:1 with cash rows first (as before), and any remaining trades and cash rows of the group are reconciled together as one group (e.g. a robo-advisor rebalancing with nine trades and a single net cash row)
**And** `cash-pair-mismatch` is no longer a flag: every trade is booked with Parqet's quantity, price, amount and fee unchanged (Positions and Cost Basis match Parqet)
**And** when a group's cash rows differ from the summed derived cash effects (AD-14) by more than €0.01, one standalone TAX Transaction (amount 0, signed tax = derived effect − cash, Security of the group's largest trade when the group has one Security, otherwise none) is added on that date, sequenced after the group's trades, so the Cash Account follows Parqet's cash rows; differences up to €0.01 keep the existing amount alignment (AD-6)
**And** the preview shows "N Kontodifferenzen werden als Steuer gebucht" with the total
**Given** a migrated SELL whose quantity exceeds the quantity held at that point by at most 0.001 units (Parqet rounding of fractional shares)
**Then** the SELL is booked with the held quantity (amount, fee and tax unchanged), the shortfall is carried and subtracted from the quantity of the next BUY of the same Security in that Depot (amount unchanged), and the preview shows "N Rundungsreste ausgeglichen"
**And** a SELL exceeding the holding by more than 0.001 units still stops booking with the existing message
**Given** synthetic fixtures covering a buy whose cash row omits the fee, a sell whose cash row is lower than its amount (withheld tax), a dividend with a mismatching cash row, a rebalancing instant with several buys and sells and one net cash row, and a fractional sell exceeding the holding by 0.0008 followed later by a correcting buy
**When** they are previewed and booked into an empty Depot
**Then** there are no flags, booking succeeds, quantities end exactly as in the fixture, Cost Basis equals Parqet's, and the Cash Account equals the sum of the fixture's cash rows
**And** the pure grouping, difference and shortfall functions live in `src/modules/migration` or `src/core` and are unit-tested

### Story 2.8: Missing Deposits and Fee-Aware Gain Comparison in the Parqet Migration

As Tommy,
I want money Parqet never recorded as a deposit to be booked as a deposit, and fee-only gain differences not to look like errors,
So that my Cash Accounts are plausible, my taxes-paid figure is right and the migration summary only shows real deviations.

**Acceptance Criteria:**

**Given** a group of trades and cash rows sharing one instant (Story 2.7) whose cash rows differ from the summed derived cash effects by more than €0.01
**When** the cash rows show less money going out or more coming in than the trades explain (difference on the inflow side)
**Then** the difference is booked as one DEPOSIT on that date, sequenced before the group's trades (money paid in from outside, e.g. a savings-plan contribution invested directly)
**When** the cash rows show more money going out or less coming in than the trades explain (difference on the outflow side)
**Then** the difference stays one standalone TAX Transaction with a positive tax, as in Story 2.7
**And** the preview shows "N fehlende Einzahlungen ergänzt" and "N Kontodifferenzen als Steuer gebucht" separately with their totals
**Given** any Parqet export, with or without `Cash` rows
**When** proposals are walked in `(date, sequence)` order
**Then** the minimal-funding rule of Story 2.6 applies to every export: whenever a row would take the running Cash Account balance below zero, a same-day DEPOSIT for exactly the shortfall is inserted before it, so the migrated Cash Account never goes negative
**And** the cash comparison with Parqet in the summary explains that Parqet's own balance lacks deposits when the funding rule added any, instead of reporting a plain mismatch
**Given** the per-sale comparison of realized Gain/Loss with Parqet's `realizedgains`
**Then** a difference that equals the fees attributable to the sale (the sell fee plus the buy fees of the consumed FIFO lots, within €0.01) is shown as "Gebühren" and not counted as a deviation; other differences above €0.01 remain deviations
**Given** synthetic fixtures with a rebalancing instant whose net cash row omits a contribution, a sell with withheld tax, a cash history that would go negative, and sales with buy and sell fees
**When** they are previewed and booked into an empty Depot
**Then** contributions are DEPOSITs, withheld tax is TAX with positive tax, the Cash Account never goes negative, and fee-only gain differences are not deviations
**And** the classification of differences and the fee attribution are pure functions with unit tests


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
**And** I can change any Security's type (STOCK, ETF, FUND, CERTIFICATE, CRYPTO) through `ledger` (AD-16); an "Typ unbekannt" chip marks the rare `UNCLASSIFIED` ones (UX-DR18)
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

### Story 3.8: News Teasers

As Tommy,
I want to read a short teaser of a news item inside the app,
So that I get the gist without wading through an overloaded website.

**Acceptance Criteria:**

**Given** held Securities with a Yahoo symbol (ProviderMapping or Yahoo search, AD-9) — stocks and crypto
**When** news is refreshed
**Then** a new news provider reads the Yahoo Finance RSS feed per symbol (`feeds.finance.yahoo.com/rss/2.0/headline?s=<symbol>&region=DE&lang=de-DE`), storing title, link, source, publication date and the item's description as `teaser` (plain text, tags and entities removed, trimmed to at most ~600 characters at a sentence or word boundary); only the symbol leaves the server (AD-13)
**And** items older than 14 days are dropped, and only items whose title or teaser mentions the Security's name (normalized, legal-form suffixes like AG/SE/Inc. ignored) or symbol are kept, so loosely related press releases do not appear
**And** the feed is unofficial: a failing, empty or malformed feed is a provider failure for that Security only and never breaks the news page; requests are spaced and the feed is fetched no more often than the existing news cache rule
**And** Google News RSS stays as a headline-only source (all Securities, notably ETFs and certificates); when the same story arrives from both, the item with a teaser wins (de-duplication by URL or normalized title)
**And** on "Nachrichten" and Security detail, an item with a teaser expands on tap/click (accordion, keyboard accessible) to show the teaser with source and date and a link "Zum Artikel" opening the original in a new tab; an item without a teaser keeps today's behaviour and opens the article directly; a small marker shows which items have a teaser
**And** teasers are cached news data like headlines: not ledger data, not backed up, purged with the 14-day window (AD-11)
**And** the RSS parsing (description cleanup, trimming, name filter, de-duplication) is unit-tested with recorded synthetic feeds; tests never hit Yahoo

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
**Then** a donut with legend shows shares by Position (top 8 + "Sonstige"), by asset type (ETF, Fonds, Aktie, Zertifikat, Krypto, Guthaben, Unklassifiziert if any) and — on Overview only — by Depot (FR13, UX-DR8)
**And** cash is always its own segment in `{colors.cash}`; segments follow the series color order
**And** percentages sum to 100 % of total value including cash; the legend shows percentage and amount, and tapping a legend row highlights its segment
**And** the donut has a text alternative listing the segments (UX-DR21).

### Story 4.6: Security Detail Page

As Tommy,
I want one detail page per Security that brings together all my Depots,
So that I can drill into a holding — or one I already sold — before deciding to act (UJ-1 climax).

**Acceptance Criteria:**

**Given** a Security I hold or held in any Depot
**When** I tap it in the Positions table, top Positions, the Securities page or a Transaction row
**Then** a Security detail page opens (also for Securities no longer held) with the header (logo, name, ISIN, type) and a Depot switcher "Alle Depots" plus each Depot that ever booked this Security (default: the Depot I came from, else "Alle Depots"), as in `mockups/position-phone.html`
**And** for the selected scope it shows the hero card (current value, Period Gain/Loss, area chart), KPI cards (quantity, Cost Basis, unrealized, dividends in Period, average purchase price), latest price with date and stale badge, the open FIFO lots per Depot, and the Security's news of the last 14 days
**And** the Transaction history lists every Transaction of this Security in the scope, newest first, each with its Depot name
**And** a stale price shows "Keine Kursquelle liefert aktuelle Kurse." with "Kurs manuell eintragen"
**And** menu actions offer Corporate Action (split, ISIN change) and a new Transaction for this Security (Depot preselected when one is selected)
**And** the Period selector applies; no news shows "Keine Nachrichten der letzten 14 Tage."
**And** all figures come from `src/core` over the ledger (AD-1); "Alle Depots" sums the per-Depot results and FIFO stays per Depot

### Story 4.7: All-time Performance and Price Chart with Trades

As Tommy,
I want each Security's complete result since my first buy and its price history with my trades marked,
So that I see what a holding really earned me and when I bought and sold.

**Acceptance Criteria:**

**Given** the Security detail page (Story 4.6) for a scope ("Alle Depots" or one Depot)
**Then** a card "Gesamt seit Erstkauf" shows: realized Gain/Loss (FIFO, all sales), unrealized Gain/Loss, dividends, fees, taxes paid (separately), total Gain/Loss (realized + unrealized + dividends − fees, gross of taxes, AD-10), total invested (sum of buy costs), and two returns: total Gain/Loss ÷ total invested in %, and an annualised money-weighted return (XIRR) over the Security's own flows (buys as outflows; sells, dividends and the current value as inflows)
**And** the card works for Securities no longer held (unrealized 0, current value 0) and does not depend on the Period selector
**Given** the hero chart
**Then** a toggle switches between "Kurs" (price per unit from the core price resolver, split-adjusted, AD-7/AD-9) and "Wert" (Position value); in "Kurs" mode every BUY and SELL in the scope is marked on its date (distinct markers for buy and sell) with a tooltip giving date, Depot, quantity and price
**And** the Security-level total and XIRR are pure core functions with unit tests covering a fully sold Security, a Security held in two Depots, dividends, fees and a split

## Epic 5: Document Import

Tommy uploads ROBIN, comdirect/cominvest and finanzen.net zero PDF documents, reviews the extracted Transactions with duplicate and ambiguity flags, and books them in one step.

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
**And** the parser is unit-tested against the anonymised real-layout fixtures in `test/fixtures/import/comdirect/` (`buy.txt`, `sell.txt`, `dividend.txt`, `dividend-tax.txt`; expected values are stated in the fixtures' test, not here). Trade settlements are label-first (`Kurswert : EUR …`); the dividend credit has glued tokens (WKN and ISIN directly followed by the name)
**And** a comdirect Wertpapierabrechnung PDF carries its Steuermitteilung as further pages of the same file: the trade's tax is read from that part (abgeführte Steuern), so one file yields one proposal with fee and tax
**And** an Ertragsgutschrift and its Steuermitteilung arrive as separate files and are merged into one DIVIDEND proposal by Referenz-Nummer (the credit's "Referenz-Nr." equals the notice's "Referenz-Nummer"); tax = gross EUR − credited EUR after tax, which covers Kapitalertragsteuer, Solidaritätszuschlag, Kirchensteuer and foreign withholding tax
**And** an Ertragsgutschrift whose Steuermitteilung is not in the batch yields the DIVIDEND with tax 0 and a review hint; a dividend Steuermitteilung without its Ertragsgutschrift in the batch fails with "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen."

### Story 5.5: finanzen.net zero / Baader Bank Parser

As Tommy,
I want finanzen.net zero (Baader Bank) documents recognized,
So that my third Depot no longer needs manual bookkeeping.

**Acceptance Criteria:**

**Given** a batch for a `FINANZEN_ZERO` Depot
**When** Baader Bank documents from finanzen.net zero are processed
**Then** pure parsers registered for `FINANZEN_ZERO` produce AD-14 proposals and the review and booking flow of Story 5.3 applies unchanged
**And** "Wertpapierabrechnung: Kauf/Verkauf" yields one BUY or SELL: quantity from "STK n", price from the execution line, amount = Kurswert, fee = net of the fee lines (Finanzkommission, Vermittlungsentgelt, Handelsplatzabhängige Gutschrift as a negative fee), tax = sum of the page-1 tax lines (Kapitalertragsteuer, Solidaritätszuschlag, Kirchensteuer; a trailing "-" marks an amount paid), date = Handelsdatum; the booked total ("Zu Lasten/Zu Gunsten Konto … EUR") must equal the derived cash effect, else the file fails with a reason
**And** "Dividendenabrechnung" and "Fondsausschüttung" yield one DIVIDEND: amount = "Bruttobetrag EUR", tax = all withheld taxes including foreign withholding tax (Quellensteuer, US-Quellensteuer), fee = external fees ("Gebühren extern …"), date = Zahltag; the credited amount must equal gross − tax − fee
**And** "Steuerausgleichsrechnung" with "Erstattung" yields one TAX Transaction with negative tax (refund) and no Security; "Verlusttopfoptimierung" and other tax-pot notices without booking are recognized and reported as "Keine Buchung erforderlich." without a proposal
**And** "Obligatorischer Umtausch" (ISIN change) and other corporate-action notices fail with "Kapitalmaßnahme bitte als Corporate Action erfassen." and are never booked as trades
**And** the tax details on later pages ("Steuerbeträge", "Merkposten / Steuertöpfe") are not read as additional tax
**And** the parsers are unit-tested against the anonymised real-layout fixtures in `test/fixtures/import/finanzen-zero/` (`buy.txt`, `sell.txt`, `dividend.txt`, `fund-distribution.txt`, `tax-refund.txt`, `tax-pot-no-booking.txt`, `isin-change.txt`), each through `parseDocument("FINANZEN_ZERO", …)`

### Story 5.6: ISIN Changes from Broker Documents

As Tommy,
I want an ISIN-change notice from my broker to be recognized and booked with one click,
So that corporate-action documents no longer end as "fehlgeschlagen" or tempt me into a wrong manual trade.

**Acceptance Criteria:**

**Given** a finanzen.net zero "Obligatorischer Umtausch" (or another broker notice the parsers identify as an ISIN change with one Ausbuchung and one Einbuchung)
**When** it is processed in a batch
**Then** the parser returns an ISIN-change proposal (old ISIN, new ISIN, old quantity, new quantity, effective date = "per" date of the booking, new Security name) instead of a failure
**And** the review shows the file with a new status "Kapitalmaßnahme" and the change as "ISIN-Wechsel <old> → <new>, <qty> St. am <date>"
**And** if the same ISIN change (same old and new Security, same date) is already recorded, the file shows "Bereits erfasst" and is not booked (like a duplicate)
**And** otherwise the action "Als ISIN-Wechsel buchen" records it through the existing ledger ISIN-change service (`ensureSecurity` for the new ISIN, FIFO lots and Cost Basis carried over, AD-7) as part of the batch booking; it is never booked as BUY/SELL
**And** "Manuell erfassen" is not offered for such files; for corporate-action notices the parsers cannot read, the failure reason points to "Position → Corporate Action" and no Transaction form opens
**And** the parser is unit-tested against `test/fixtures/import/finanzen-zero/isin-change.txt`, and the review/booking path has tests for "already recorded" and "book now"

## Epic 6: Data Safety & Operations

Tommy can export and restore all data, gets a daily database backup, and runs DepotManagement on his Linux server behind Nginx with TLS using a documented setup.

### Story 6.1: Export All Data

As Tommy,
I want to export everything to one open file,
So that my data is never locked into the app.

**Acceptance Criteria:**

**Given** data in the ledger
**When** I click "Exportieren" in Settings
**Then** I download one JSON file `depotmanagement-export-<YYYYMMDD-HHMMSS>.json` with a `schemaVersion`, containing Depots, Securities, ProviderMappings, Transactions (including ADJUSTMENT rows and their notes), CorporateActions, ReconciliationRuns with their rows, all stored Prices (manual and fetched) and manual logos as base64 (AD-12)
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

## Epic 7: Analyses

Tommy analyses his holdings like in Parqet: allocation views, return heatmap, realized gains, cash flow and dividends. ETFs and funds are classified as a whole; ETF look-through (X-Ray) comes later.

### Story 7.1: Security Classification

As Tommy,
I want every Security classified by asset class, type, sector, industry, region, country, company size and currency,
So that my holdings can be analysed by these dimensions.

**Acceptance Criteria:**

**Given** a Security
**When** it is created or first held, and on the daily scheduler run for Securities without classification
**Then** the new `classification` module stores one classification per Security with: asset class (Aktien, Anleihen, Rohstoffe, Immobilien, Geldmarkt, Krypto, Derivate, Gemischt), type (from `assetType`), sector, industry, region, country, company size (Large/Mid/Small Cap or "–") and currency, each with its source (`provider`, `rule`, `manual`) (AD-20)
**And** stocks are classified from Yahoo `quoteSummary` `assetProfile`/`price` (sector, industry, country, market cap, currency) through the provider pattern; Yahoo sector names are mapped to German labels by one table; outbound requests carry only ticker or ISIN (AD-13)
**And** ETFs and funds are classified as a whole by a rules table on name and index (e.g. "MSCI World" → Welt, "Emerging Markets"/"EM" → Schwellenländer, "S&P 500" → USA, "STOXX 600"/"Europe" → Europa, "Gov Bond"/"Anleihen" → asset class Anleihen, "Gold"/"ETC" → Rohstoffe, "REIT"/"Property" → Immobilien); unmatched ones get region "Unbekannt"
**And** certificates take the underlying's classification when it is a held or known Security, else asset class Derivate; crypto gets asset class Krypto
**And** on the Securities page each dimension can be overridden manually; a manual value always wins and is never overwritten by a refresh
**And** classification failures never block ledger writes; the rules table and mapping are pure core functions with unit tests (fixtures with recorded Yahoo responses, no live network)

### Story 7.2: Allocation Analysis

As Tommy,
I want to see my Portfolio or a Depot broken down by each classification dimension,
So that I can judge diversification at a glance.

**Acceptance Criteria:**

**Given** the new navigation entry "Analysen" (drawer on ≥ md, under "Mehr" on phones) and its tab "Aufteilung"
**When** I choose a scope (Portfolio or one Depot) and a dimension (Anlageklasse, Wertpapiertyp, Sektor, Branche, Region, Land, Unternehmensgröße, Währung)
**Then** a donut with legend (label, % and amount) shows the current value split by that dimension, cash as its own segment where meaningful, unclassified values as "Unbekannt" (UX-DR8)
**And** tapping a segment lists the Positions in it with logo, name, value and share, each linking to the Security detail
**And** shares sum to 100 % of the scope's value; figures come from core over the ledger and current prices (AD-1, AD-9)

### Story 7.3: Return Heatmap

As Tommy,
I want a heatmap of my returns per month and year,
So that I see good and bad periods at a glance.

**Acceptance Criteria:**

**Given** the "Analysen" tab "Rendite"
**When** I choose a scope (Portfolio or one Depot)
**Then** a grid of years × months shows the time-weighted return (TTWROR, AD-10) of each month in %, plus quarter and year totals; positive cells green, negative red, intensity by magnitude, with sign so meaning does not rely on colour (UX-DR21)
**And** tapping a cell shows start value, end value, return %, net external flows and the number of Transactions in that month
**And** months before the first Transaction or after today stay empty; the current month is marked as running
**And** monthly and chained yearly returns come from one core function over the daily valuation series, unit-tested against a hand-calculated reference

### Story 7.4: Realized Gains and Cash Flow

As Tommy,
I want my realized gains and my net cash flow per month and year,
So that I see what my sales earned and how much money I put in.

**Acceptance Criteria:**

**Given** the "Analysen" tab "Gewinne"
**Then** a bar chart shows realized Gain/Loss (FIFO, AD-10) per month for a chosen year and per year over all years, with dividends and fees as switchable layers and taxes paid shown separately
**And** lists show the five best and five worst sales (Security, date, quantity, realized Gain/Loss abs and %)
**And** a "Kapitalfluss" chart shows net external flows (Deposits − Withdrawals, including migration funding and corrections) per month and year
**And** all figures come from core over the ledger for the chosen scope (Portfolio or one Depot), with unit tests

### Story 7.5: Dividend Analysis

As Tommy,
I want my dividend history and income at a glance,
So that I can follow my passive income.

**Acceptance Criteria:**

**Given** the "Analysen" tab "Dividenden"
**Then** views show dividends per month (selected year), per year, cumulative, and per Security, with a gross/net toggle (net = gross − tax − fee)
**And** a KPI row shows the income of the last 12 months and the trailing yield (income ÷ current value of the paying Positions)
**And** an "Erwartet" view lists the expected payments of the next 12 months, estimated from each held Security's payments of the last 12 months (same months, current quantity), clearly marked as an estimate
**And** all figures come from core over the ledger for the chosen scope, with unit tests

### Story 7.6: Drawdown

As Tommy,
I want to see how far my Portfolio, a Depot or a single Security fell below its previous peak over time,
So that I can judge the risk I carry.

**Acceptance Criteria:**

**Given** the value chart on Overview and Depot detail
**When** I switch its new tabs "Wertentwicklung | Drawdown" to "Drawdown"
**Then** a red area below a 0 % line shows the drawdown per day over the global Period (1M, YTD, 1J, 3J, Max, custom): the decline of the time-weighted performance index (TTWROR, AD-10) from its running peak within the Period, so Deposits, Withdrawals and transfers never count as losses
**And** hover (tap on phones) shows date and drawdown in %
**And** a KPI row shows "Aktueller Drawdown" (today vs. peak), "Maximaler Drawdown" (deepest point in the Period), "Dauer" (days from the peak before the maximum drawdown until recovery to that peak, or until the Period end if not recovered) and "Periode" (start – end of that phase, de-DE dates)
**And** at a new peak the current drawdown is 0 %; without any decline all figures show 0 % and "–"
**And** on Security detail the chart toggle "Kurs / Wert" gains "Drawdown": the decline of the Security's price from its running peak within the Period, on prices restored to split-adjusted values with its recorded splits (so a split is never a drop), with the same KPIs, hover and buy/sell/dividend markers as "Kurs"; it works for Securities no longer held
**And** the tab choice persists like the Period; changing the Period recomputes
**And** the drawdown series and figures come from one pure core function over the daily valuation series used by the value chart and heatmap (AD-1, AD-10), unit-tested against a hand-calculated reference including a flow inside a decline, a split inside the Period and an unrecovered drawdown

### Story 7.7: Dividend Charts

As Tommy,
I want my dividends broken down by Security per month and compared year by year,
So that I see which holdings pay when and whether my income grows.

**Acceptance Criteria:**

**Given** the "Analysen" tab "Dividenden" (Story 7.5)
**When** I open the view "Monatlich (pro Jahr)" (the former "Monate", January–December of the chosen year; the year is chosen in the card header with a year field and previous/next arrows)
**Then** each month's bar is stacked by Security, one stable colour per Security, with the month total above the bar
**And** hover (tap on phones) on a segment shows logo, name, amount of that Security and the month total
**And** a new view "Akkumuliert (pro Jahr)" draws one line per year, cumulative from January to December, all years overlaid with a legend; a "Prognose" switch extends the current year's line, dashed, with the expected payments of Story 7.5 (marked as an estimate)
**And** the former "Kumuliert" view stays as "Akkumuliert" (all-time cumulative)
**And** the Brutto/Netto toggle and the scope (Portfolio or one Depot) apply to every view; "Wertpapiere" and "Erwartet" stay unchanged
**And** the per-Security monthly split and the yearly cumulative lines come from `core/dividend-analysis` over the ledger, with unit tests
**And** (amended 2026-10-27 after use) the views "Monatlich (fortl.)" and "Breakdown" are removed: too cluttered in practice

### Story 7.8: Security Analyses

As Tommy,
I want the analyses I have for my Portfolio also on the page of a single Security,
So that I can judge how one holding performed month by month and against its trend.

**Acceptance Criteria:**

**Given** Security detail (scope "Alle Depots" or one Depot from its switcher)
**Then** a card "Performance-Heatmap" shows the time-weighted return (TTWROR, AD-10) of this Position per month with a "Gesamt" column per year, and a toggle "Q | M" switching between quarters and months; colours, signs and empty cells as in Story 7.3 (months without holding stay "–"); a link "Zur Heatmap des gesamten Portfolios" opens Analysen › Rendite
**And** for a Security no longer held the heatmap covers the months it was held
**And** the chart toggle gains "Performance": the Position's cumulative time-weighted return in % over the global Period (buys and sells are flows, not gains), with hover and the buy/sell/dividend markers
**And** the "Kurs" view gains an optional overlay "Gleitender Durchschnitt" (200 days, switchable to 38 days), drawn dashed on split-adjusted prices and computed only from stored Prices; off by default, the choice persists per browser
**And** the per-Security heatmap reuses the core heatmap function of Story 7.3 over the Position's daily valuation series; the performance line and the moving average are pure core functions with unit tests against hand-calculated references (including a split and a sale inside the Period)
