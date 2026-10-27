# Epic 7 Context: Analyses

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give Tommy the Parqet-style analyses he still misses: allocation of the Portfolio or a Depot by classification dimension, a monthly/yearly return heatmap, realized gains and net cash flow, dividend history with 12-month income, an estimate and per-Security dividend charts, the drawdown of the Portfolio, a Depot or a single Security over the chosen Period, and the Portfolio analyses (heatmap, performance line, moving average) on the page of a single Security. It rests on a Security classification layer. ETFs and funds are classified as a whole; ETF look-through ("X-Ray") is out of scope until a later decision.

## Stories

- Story 7.1: Security Classification
- Story 7.2: Allocation Analysis
- Story 7.3: Return Heatmap
- Story 7.4: Realized Gains and Cash Flow
- Story 7.5: Dividend Analysis
- Story 7.6: Drawdown
- Story 7.7: Dividend Charts
- Story 7.8: Security Analyses

## Requirements & Constraints

- Every Portfolio analysis offers scope Portfolio (sum of non-archived Depots) or one Depot; Security-level analyses offer "Alle Depots" or one Depot, and work for Securities no longer held.
- Allocation: shares sum to 100 % of scope value; cash its own segment where meaningful; unclassified → "Unbekannt"; manual classification overrides always win.
- Heatmap: monthly TTWROR, quarters/years chained; months before the first Transaction or after today (or without holding, per Security) stay empty / "–"; current month marked as running.
- Drawdown (Portfolio/Depot): decline of the time-weighted performance index from its running peak within the Period, so Deposits, Withdrawals and transfers never count as losses. KPIs: current drawdown, maximum drawdown, duration (peak before the max until recovery, or Period end) and the phase's dates; at a new peak 0 %, no decline → 0 % and "–". Security drawdown uses split-adjusted prices so a split is never a drop.
- Security performance line: Position's cumulative TTWROR over the Period, buys and sells are flows, not gains. Moving average (200 days, switchable to 38) on split-adjusted stored Prices only; off by default.
- Dividends: gross/net toggle (net = gross − tax − fee) applies to every view; trailing 12-month income and trailing yield; the next-12-month estimate (same months, current quantity) and the "Prognose" line are clearly marked as estimates. Yield on cost = Security's last-12-month dividends ÷ current Cost Basis, "–" when not held.
- Classification never blocks a ledger write; outbound requests carry only ticker or ISIN. Tests never hit live providers (recorded, synthetic fixtures).
- Every core calculation is unit-tested against hand-calculated references; drawdown must cover a flow inside a decline, a split inside the Period and an unrecovered drawdown; Security performance and moving average must cover a split and a sale inside the Period.
- Exact decimals for money; cent-level drift in summed FIFO realized gains acceptable. WCAG 2.2 AA: gain/loss never by colour alone (sign shown).

## Technical Decisions

- **`classification` module** owns one classification per Security (asset class Aktien/Anleihen/Rohstoffe/Immobilien/Geldmarkt/Krypto/Derivate/Gemischt, type from `assetType`, sector, industry, region, country, company size, currency), each value with source `provider | rule | manual`; manual is never overwritten. Every analysis reads classifications only through this module. Stocks via Yahoo `quoteSummary` behind the provider pattern, scheduler-refreshed; ETFs/funds via one pure rules function on name/index; certificates inherit the underlying else Derivate; crypto → Krypto. `assetType` and names stay owned by `ledger`.
- **All analysis figures are computed on read in `src/core`** from the ledger and prices; nothing derived is stored. One daily valuation series (TTWROR) feeds the value chart, heatmap and drawdown; external flows are Deposits, Withdrawals, net taxes and ADJUSTMENT values. Realized Gain/Loss is FIFO per Depot; Security "Alle Depots" figures sum per-Depot results.
- Drawdown is one pure core function over the daily valuation series (Portfolio/Depot) and over split-adjusted prices (Security). The per-Security heatmap reuses the Story 7.3 core heatmap function over the Position's daily valuation series; performance line and moving average are separate pure core functions. Dividend per-Security monthly split, yearly cumulative lines and yield on cost live in `core/dividend-analysis`.
- Stored Prices are unadjusted; split adjustment happens in core on read from recorded splits. Price on a date follows the one resolver (manual > provider > transaction price, carried forward).
- Money as decimal strings via `decimal.js`; JS `number` only for percentages/chart payloads at the presentation edge. Dates `YYYY-MM-DD`, "today" passed into core. `src/core` stays pure. New Prisma models need a new migration; user-entered data (manual overrides) must be considered for export/restore.

## UX & Interaction Patterns

- Nav entry "Analysen" (drawer ≥ md; under "Mehr" on phones) with tabs Aufteilung (donut + legend, dimension selector, tap segment → Positions), Rendite (years × months grid, tap cell → start/end value, return, net flows, Transaction count), Gewinne (realized gains bars with dividend/fee layers, taxes separate, best/worst five sales, Kapitalfluss), Dividenden.
- Dividenden views: "Monatlich (pro Jahr)" and "Monatlich (fortl.)" bars stacked by Security (one stable colour per Security, month total above, segment hover/tap shows logo, name, amount, month total); "Jahre"; "Akkumuliert" (all-time); "Akkumuliert (pro Jahr)" one line per year with "Prognose" switch (dashed); "Breakdown" with Security selector (logo, name, type, ISIN, WKN, up/down stepping), chosen Security highlighted, others dimmed, KPIs "Im <Monat>", "Seit Jan. <Jahr>", "Pers. Div-Rendite"; "Wertpapiere" and "Erwartet" unchanged.
- Overview and Depot detail value chart gains tabs "Wertentwicklung | Drawdown": red area below a 0 % line, hover/tap shows date and %, KPI row below. Tab choice persists like the global Period; changing the Period recomputes.
- Security detail: chart toggle "Kurs / Wert" gains "Performance" and "Drawdown" (both with buy/sell/dividend markers); "Kurs" gains optional dashed "Gleitender Durchschnitt" overlay (200/38 days, persisted per browser); new card "Performance-Heatmap" with "Gesamt" per year, toggle "Q | M", link "Zur Heatmap des gesamten Portfolios" to Analysen › Rendite.
- Reuse donut/legend, Security logo component, Minze tokens (series, gain/loss), de-DE formatting, Skeleton loading, keyboard-reachable tooltips, ≥ 44 px touch targets; German UI; no hover-only actions; modal depth ≤ 1.

## Cross-Story Dependencies

- 7.1 → 7.2 (allocation reads classifications). 7.1–7.5 are done; 7.6–7.8 build on them.
- 7.7 extends the 7.5 Dividenden tab and reuses its expected-payments estimate for "Prognose".
- 7.8 reuses the 7.3 core heatmap function and sits next to the 7.6 Security "Drawdown" toggle on the same chart; both extend the Security detail page and price chart with trade markers (Stories 4.6, 4.7).
- 7.6 extends the Epic 4 value chart and uses the same valuation series as the 7.3 heatmap; Security drawdown relies on recorded splits (Epic 2) and stored prices (Epic 3).
