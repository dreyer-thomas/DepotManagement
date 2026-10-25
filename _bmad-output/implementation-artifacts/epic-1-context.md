# Epic 1 Context: Foundation & Manual Bookkeeping

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Lay the foundation of DepotManagement, a self-hosted, single-user portfolio tracker that replaces Parqet. Tommy can sign in, create, rename and archive Depots, record every Transaction type by hand, and see Positions with FIFO Cost Basis plus each Depot's Cash Account balance and history. The epic sets up the pinned stack, the "Minze" theme and the responsive app shell. It also builds the ledger core that every later epic reuses (import, migration, prices, performance, backup): the canonical Transaction shape, the single write path, sequencing, Security creation, the duplicate matcher and the held-Securities definition. There are no price sources yet, so values use the latest Transaction price.

## Stories

- Story 1.1: Project Starter and App Shell
- Story 1.2: Single-User Login
- Story 1.3: Create and Rename Depots
- Story 1.4: Record Buys and Sells
- Story 1.5: Positions with FIFO Cost Basis
- Story 1.6: Cash Account and Non-Trade Transactions
- Story 1.7: Edit and Delete Transactions with Duplicate Warning
- Story 1.8: Archive Depots

## Requirements & Constraints

- **Depots:** each Depot belongs to one Broker (`COMDIRECT`, `DEUTSCHE_BANK`, `FINANZEN_ZERO`) and has exactly one implicit Cash Account. Names are non-empty and unique. An archived Depot is left out of Portfolio figures, but its history stays viewable read-only.
- **Transactions:** the types are buy, sell, dividend, fee, tax, Deposit and Withdrawal. Each can be added, edited and deleted. Quantities allow up to 8 decimals. Asset types are stock, ETF, certificate and crypto. Every change shows on the next read.
- **Securities:** picked by ISIN or name search. An unknown ISIN, or a crypto symbol, can be added on the fly.
- **Cash Account:** buys, sells, dividends, fees and taxes book their cash side automatically. Deposits and Withdrawals change only cash. The Cash Account shows its balance and booking history.
- **Sell guard:** a sell, or an edit, that would exceed the held quantity at that point is rejected with an explanatory message.
- **Security:** every page and route needs a login. Route handlers answer 401; pages redirect to login and return to the original URL afterwards. The app refuses to start if any auth variable is missing.
- **Public repo:** no personal data, credentials or keys. All configuration comes from environment variables. Test fixtures are synthetic.
- **Other constraints:** EUR only. The app must work in desktop and phone browsers. Accessibility target is WCAG 2.2 AA.
- **Correctness:** Depot value and Cost Basis are exact. No floating point anywhere for money, quantities or prices.

## Technical Decisions

- **Stack (exact pins):**
  - Node 24 LTS (`>=24.11 <25`), TypeScript 5.9.3, Next.js 16.4.2 App Router, React 19.3.0
  - Prisma CLI, client and `@prisma/adapter-better-sqlite3` all at 7.10.1; better-sqlite3 12.11.1
  - MUI 9.5.0 with Emotion 11.14.x, zod 4.6.7, decimal.js 10.6.0, vitest 5.0.5, jose 6.2.13, bcrypt 6.0.0
- **Source tree:** `src/app` (thin routes and server actions), `src/core` (pure functions), `src/modules/<name>/index.ts` (services), `src/db` (Prisma singleton with WAL mode and a busy timeout), `prisma/`, `test/fixtures/`.
- **Dependency direction:** `app → modules → core` and `modules → db`. `src/core` imports only its own files and `decimal.js`; a lint rule or test enforces this. A module touches only the models it owns. In this epic, `ledger` owns Depot, Security, Transaction and CorporateAction, and `auth` owns the session. Writing services accept an optional Prisma transaction client.
- **Ledger is the only truth:** Positions, FIFO lots, Cost Basis, balances, prices, values and the held set are computed on read in core. Derived values are never stored or edited directly; a correction is always a new or changed Transaction.
- **Single write path:** only the `ledger` service writes ledger rows. It validates with zod, assigns the intra-day sequence, runs the duplicate check and rejects writes to archived Depots. The UI never touches Prisma, and affected routes revalidate after a write. Expected failures return `{ ok: false, reason }` instead of throwing.
- **Canonical Transaction shape:**
  - `amount` is the unsigned gross value and never includes fee or tax. `fee` is ≥ 0. `tax` is signed: positive means paid, negative means refund.
  - Direction comes only from `type`.
  - `quantity` and `price` are set only on BUY and SELL.
  - Standalone FEE and TAX carry their value in `fee` or `tax`, with `amount = 0`.
  - `securityId` is required for BUY, SELL and DIVIDEND, optional for FEE and TAX, and absent for DEPOSIT and WITHDRAWAL.
- **Cash effect** (`core/cash`, single definition):
  - BUY: −(amount+fee+tax)
  - SELL and DIVIDEND: +amount−fee−tax
  - FEE: −fee
  - TAX: −tax
  - DEPOSIT: +amount
  - WITHDRAWAL: −amount
  - The Cash Account has no table of its own; it is identified by its Depot.
- **Money:** money values are TEXT decimal strings, computed only with decimal.js and serialised with `toFixed()`. Never use Prisma `Decimal`, JS `number` or SQL arithmetic or comparison on them. Intermediate results are not rounded; rounding happens only at presentation.
- **Dates:** business dates `YYYY-MM-DD` (Europe/Berlin), never timestamps. The ledger assigns an integer sequence per Depot and date, appended after the last entry. FIFO and all evaluations order by `(date, sequence)`; on the same date, corporate actions come before Transactions. Core gets "today" as a parameter.
- **FIFO:** Cost Basis is price × quantity plus fees of the remaining units. The earliest units are sold first. Realized Gain/Loss is calculated per sale.
- **Price resolver:** use a single core resolver, built to grow later (manual > provider > Transaction price > carry forward). In this epic it returns the latest Transaction price on or before today.
- **Securities:** created only by an idempotent `ledger.ensureSecurity({ isin } | { cryptoSymbol })` when a Transaction is saved. ISIN and upper-case crypto symbol are each unique. `assetType` is one of `STOCK | ETF | CERTIFICATE | CRYPTO | UNCLASSIFIED`. Only `ledger` writes the name and type.
- **Duplicates:** `core/duplicates` matches on `(depotId, date, type, securityId|null, quantity|null, amount within €0.01)` and returns `unique | duplicate | ambiguous`. The result is advisory and never drops anything. On manual entry it shows a warning and asks for confirmation.
- **Archive and held set:** archiving is refused while the Depot has open Positions or non-zero cash. Core `heldSecurities(ledger)` (open Positions in non-archived Depots) is the only definition of "held".
- **Auth:** bcrypt password hash plus a `jose`-signed, httpOnly, sameSite=lax session cookie, set `secure` over HTTPS, with a fixed lifetime. A script generates the hash.
- **Config:**
  - `.env.example` lists `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `BACKUP_DIR`, `BACKUP_KEEP`, `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY` and `DATA_DIR`, without values.
  - The DB file lives outside the source tree and is git-ignored.
  - `prisma migrate deploy` runs in the start script; the app never migrates itself, and committed migrations are never edited.
  - `NEXT_TELEMETRY_DISABLED=1` is set. Prisma IDs use `cuid()`.
- **Logging:** logs go to stdout. Never log Transaction amounts, credentials or keys.
- **Tests:** vitest unit tests for core, using decimal.js and never floats.

## UX & Interaction Patterns

- **Theme "Minze":**
  - Palette: primary `#0FA68A`, accent `#FFB547`, background `#F3FBF8`, surface white, ink `#0B3B33`, plus the gain, loss, stale and cash tokens and their soft variants. Every token has a `-dark` variant.
  - Dark mode follows the system setting; a manual toggle overrides it and is stored per browser.
  - Typography: Roboto, with the roles page-title 22/600, figure-hero 34/700, figure-kpi 18/600 and figure 14/400. All figures use tabular numerals.
  - Shape: radii are 16 for cards, 8 for inputs and full for pills. Shadow is a soft mint `0 2px 10px rgba(15,166,138,.10)`.
- **Shell:**
  - From md up, a permanent drawer with Übersicht, Depots, Import, Nachrichten, Wertpapiere and Einstellungen.
  - Below md, a bottom navigation with Übersicht, Depots, Nachrichten and Mehr, plus a "+" FAB for a new Transaction on Overview and Depot detail.
  - Surfaces not built yet show a neutral placeholder.
- **Formatting:** de-DE formats `1.234,56 €`, `+3,21 %` and `25.10.2026`, produced from decimal strings. Inputs accept a decimal comma and pasted `1.234,56`.
- **Transaction form:**
  - Dialog on desktop, full-screen on phone.
  - The type is chosen first and the fields adapt to it: BUY and SELL have Security, date, quantity, price, fee and tax; DIVIDEND has Security, amount and tax; FEE and TAX have a value and an optional Security; DEPOSIT and WITHDRAWAL have an amount.
  - Security Autocomplete by ISIN or name, with "Neue Security anlegen".
  - Shows the cash effect live.
  - A possible duplicate shows an inline warning and needs "Trotzdem buchen". Delete asks for confirmation, naming Depot, Security and date.
- **Positions table:**
  - Columns: logo + Security, quantity, Cost Basis or average price, price, value, and Gain/Loss abs/% as a pill.
  - Sortable, value descending by default.
  - A Cash row is pinned at the bottom and looks distinct.
  - On phones it becomes stacked rows.
- **Transaction list:** newest first, grouped by month and paginated by month (no infinite scroll). Each row shows a type icon, Security, quantity, amount and cash effect. Clicking a row opens the form for editing.
- **Security logo:** 32px round, before every Security name. In this epic it falls back to initials on a color derived deterministically from the name, with no layout shift.
- **Depot detail:** has the tabs Positions, Cash Account and Transactions (Composition comes later).
- **Settings → Depots:** create, rename and archive. Archived Depots go into a collapsed "Archiviert" group. When archiving is blocked, the button is disabled with "Depot hat noch Positionen oder Guthaben."
- **States:**
  - Overview with no Depot: "Noch kein Depot." with "Depot anlegen". "Aus Parqet übernehmen" stays disabled until Epic 2.
  - Depot without Transactions: "Noch keine Buchungen." with "Neue Buchung".
  - Loading uses Skeletons. An expired session redirects with a return URL. On errors the form keeps its input and shows an Alert.
  - Login failure shows "Anmeldung fehlgeschlagen." without saying which field was wrong.
- **Definition of Done for every UI story:**
  - Microcopy is German, short and factual, and names the Depot and Security in confirmations.
  - No optimistic writes, no hover-only actions, dialogs at most one level deep, Enter submits and Esc closes.
  - Accessibility: WCAG 2.2 AA, gain/loss always with sign and arrow (never color alone), touch targets ≥ 44 px, keyboard-operable forms and semantic tables.

## Cross-Story Dependencies

- **Within the epic:**
  - 1.1 (stack, theme, shell, format helpers, core lint guard) comes before everything else.
  - 1.2 protects every surface that follows.
  - 1.3 creates the Depot model, which 1.4 to 1.8 need.
  - 1.4 creates the Security and Transaction models, the ledger service, sequencing and `ensureSecurity`.
  - 1.5 adds FIFO and the price resolver on top of 1.4.
  - 1.6 adds `core/cash` and the Cash row in the Positions table from 1.5.
  - 1.7 adds editing and deleting, the duplicate matcher and the sell guard on edits.
  - 1.8 needs Positions (1.5) and the cash balance (1.6) for its archive guard, and adds `heldSecurities`.
- **With later epics:**
  - Epic 2 (migration) and Epic 5 (import) reuse the ledger write path, `ensureSecurity`, the duplicate matcher and the canonical shape.
  - Epic 3 extends the price resolver, real logos and `heldSecurities`.
  - Epic 4 builds valuation and returns on core FIFO and cash.
  - Epic 6 adds `ledger.replaceAll` for restore.
  - Keep these interfaces stable and general enough for those uses.
