# Epic 7 Context: Analyses

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give Tommy the Parqet-style analyses he still misses: allocation of the Portfolio or a Depot by classification dimension (asset class, type, sector, industry, region, country, company size, currency), a monthly/yearly return heatmap, realized gains and net cash flow, and dividend history with a 12-month income figure and an estimate. It rests on a new Security classification layer. ETFs and funds are classified as a whole; ETF look-through ("X-Ray") is explicitly out of scope until a later decision.

## Stories

- Story 7.1: Security Classification
- Story 7.2: Allocation Analysis
- Story 7.3: Return Heatmap
- Story 7.4: Realized Gains and Cash Flow
- Story 7.5: Dividend Analysis

## Requirements & Constraints

- Allocation: shares sum to 100 % of the scope's value; cash is its own segment where meaningful; unclassified values show as "Unbekannt"; tapping a segment lists its Positions; manual overrides always win.
- Heatmap: the time-weighted monthly returns must agree with the Depot/Portfolio return figures; quarter and year totals chain monthly returns; months before the first Transaction or after today stay empty; the current month is marked as running.
- Realized gains, cash flow and dividends per month/year must reconcile with the ledger. Cash flow = Deposits − Withdrawals, including migration funding and corrections.
- Dividends: gross/net toggle (net = gross − tax − fee); trailing 12-month income and trailing yield (income ÷ current value of paying Positions); the next-12-month estimate (same months as last 12, current quantity) must be clearly labelled as an estimate.
- Every analysis offers scope Portfolio (sum of non-archived Depots) or a single Depot.
- Classification never blocks a ledger write. Outbound provider requests carry only ticker or ISIN, never quantities or values.
- Tests never hit live providers: use recorded Yahoo responses as fixtures (synthetic, no real financial data). Each core calculation needs unit tests; the heatmap needs a hand-calculated reference.
- Correctness: exact decimals for money; cent-level drift in summed FIFO realized gains is acceptable. WCAG 2.2 AA, gain/loss never by colour alone.

## Technical Decisions

- **New `classification` module** owns one classification per Security: asset class (Aktien, Anleihen, Rohstoffe, Immobilien, Geldmarkt, Krypto, Derivate, Gemischt), type (from the ledger's `assetType`), sector, industry, region, country, company size (Large/Mid/Small Cap or "–"), currency; each value stores its source `provider | rule | manual`. A `manual` value is never overwritten by refresh. Every analysis reads classifications only through this module's service (`src/modules/classification/index.ts`); other modules never touch its tables.
- **Stocks**: Yahoo `quoteSummary` (`assetProfile`/`price`: sector, industry, country, market cap, currency) behind the existing provider pattern; results cached and refreshed by the in-process scheduler (daily run for unclassified Securities, plus on Security creation / first held). Yahoo sector names map to German labels via one table.
- **ETFs/funds**: one pure rules function in `src/core` on name/index (e.g. MSCI World → Welt, EM → Schwellenländer, S&P 500 → USA, STOXX 600/Europe → Europa, Gov Bond → Anleihen, Gold/ETC → Rohstoffe, REIT/Property → Immobilien); unmatched → region "Unbekannt". Certificates inherit the underlying's classification if known, else Derivate; crypto → Krypto.
- `assetType` and Security name remain owned and written only by `ledger`; classification may read but not write them.
- **Analysis figures are computed on read in `src/core`** (composition, returns, valuation) from the ledger and current prices; nothing derived is stored. Heatmap returns come from the single daily valuation series (TTWROR); external flows are Deposits, Withdrawals, net taxes and ADJUSTMENT market values. Realized Gain/Loss is FIFO per Depot. Invested capital and "held" use the existing single core functions.
- Price on a date follows the one core resolver (manual > provider > transaction price, carried forward).
- Money as decimal strings via `decimal.js`; JS `number` only for percentages and chart payloads at the presentation edge. Dates `YYYY-MM-DD`, "today" passed into core.
- `src/core` stays pure (only own files + `decimal.js`); new Prisma models need a new migration (never edit committed ones) and must be considered for export/restore if they hold user-entered data (manual overrides).

## UX & Interaction Patterns

- New nav entry "Analysen": permanent drawer on ≥ md (between Depots and Import); under "Mehr" in the phone bottom nav.
- Four tabs: Aufteilung (donut + legend with label, %, amount; dimension selector; tap segment → Position list with logo, name, value, share, linking to Security detail), Rendite (years × months grid, green/red intensity by magnitude with sign shown; tap cell → start/end value, return %, net flows, Transaction count), Gewinne (realized gains bars per month of chosen year / per year, switchable dividends and fees layers, taxes separate; five best/worst sales; Kapitalfluss chart), Dividenden (per month/year/cumulative/per Security, gross/net toggle, KPI row, "Erwartet" view).
- Reuse the existing donut/legend pattern, Security logo component, Minze theme tokens (series colours, gain/loss), de-DE formatting, Skeleton loading, keyboard-reachable tooltips, ≥ 44 px touch targets. Securities page gains per-dimension manual override for classification.
- German UI text; no hover-only actions; modal depth ≤ 1.

## Cross-Story Dependencies

- 7.1 is a prerequisite for 7.2 (allocation dimensions read classifications). 7.3–7.5 depend only on existing ledger/core functions and can proceed independently of 7.1.
- Builds on existing work: ledger and `assetType` (Epic 1/2), prices provider pattern and scheduler (Epic 3), valuation series, TTWROR, FIFO realized gains and composition donut (Epic 4), ADJUSTMENT corrections (Story 2.9), logos (AD-19), export/restore (Epic 6).
