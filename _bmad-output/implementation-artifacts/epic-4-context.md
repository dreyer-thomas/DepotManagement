# Epic 4 Context: Overview & Performance

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the ledger (Epics 1–2) and prices (Epic 3) into the evaluations Tommy used Parqet for: total and per-Depot value, invested capital, realized/unrealized Gain/Loss with dividends, fees and taxes, TTWROR and XIRR side by side, a value chart and composition for any selectable Period, cash included in totals, plus a per-Security detail page with all-time results. This is the payoff surface for the daily check-in (UJ-1) and the basis for cancelling Parqet; numbers must reconcile with broker statements and agree across every screen.

## Stories

- Story 4.1: Depot Value Summary with Period Selector
- Story 4.2: Gain/Loss and Return Metrics
- Story 4.3: Value Development Chart
- Story 4.4: Portfolio Overview
- Story 4.5: Composition
- Story 4.6: Security Detail Page
- Story 4.7: All-time Performance and Price Chart with Trades

## Requirements & Constraints

- Show current value, invested capital and Gain/Loss (absolute and %) for the Portfolio and each Depot, with Positions and their value/Gain/Loss.
- Value chart of value and invested capital over the Period; chart values on any date must equal the KPI figures computed for that date.
- Period Gain/Loss split into realized (FIFO per sale), unrealized, dividends, fees; taxes paid in the Period shown separately; figures gross. TTWROR and XIRR side by side for Portfolio and each Depot.
- Composition by Position, by asset type (ETF, Fonds, Aktie, Zertifikat, Krypto, Guthaben, Unklassifiziert if any) and — Overview only — by Depot; shares sum to 100 % of total value including cash. No ETF look-through.
- Cash Account balances are part of total value, shown separately from Positions; Deposits and Withdrawals are external flows and never count as Gain/Loss.
- Security detail works across all Depots or one Depot, also for Securities no longer held; all-time result since first buy: realized, unrealized, dividends, fees, taxes (separate), total, % return on total invested, and Security XIRR — independent of the Period selector.
- Correctness: Depot value and Cost Basis exact; cent-level realized differences across many FIFO lots acceptable. EUR only.
- Accessibility: WCAG 2.2 AA; gain/loss never by color alone (sign + arrow); chart tooltips keyboard-reachable; donut has a text alternative; touch targets ≥ 44 px; usable at phone width without horizontal scroll.
- Out of scope: benchmarks, dividend forecasts, tax views, sectors/countries.

## Technical Decisions

- **Compute on read, no stored results:** values, Positions, Cost Basis, returns and composition are computed by pure `src/core` functions from the ledger every read; any snapshot is a disposable cache only (and only if measurably slow). Shell (`src/app`, modules) loads data and renders; it never computes financial figures.
- **One daily valuation series per Depot** produced by core (Position values via the price resolver, cash via `core/cash`, invested capital = FIFO Cost Basis of open Positions via one core function). Every KPI, chart, TTWROR and XIRR reads this same series. Expected homes: `core/valuation`, `core/returns`, `core/composition`.
- **Performance unit = Depot incl. Cash Account.** Portfolio = sum of non-archived Depots. External flows = Deposits, Withdrawals and net taxes (paid minus refunds); tax cash debit is external, not counted twice. Period Gain/Loss = change in value − net external flows.
- **TTWROR** chains daily sub-period returns between external flows; **XIRR** solves the money-weighted rate over the Period's flows plus start and end value.
- **Security-level figures:** computed from that Security's rows; "Alle Depots" sums per-Depot results, FIFO stays per Depot. All-time total = realized + unrealized + dividends − fees (taxes separate). Security XIRR: buys are outflows; sells, dividends and current value are inflows. Total invested = sum of buy costs.
- **Prices:** one core resolver per date — manual > provider > Transaction price on that date (derived, never stored) > last known carried forward. Stored prices are unadjusted; split adjustment applied by core on read (price chart "Kurs" mode must be split-adjusted). `isStale` (older than 3 calendar days) is the single stale rule.
- **Held set:** `heldSecurities` (open Positions in non-archived Depots) is the only definition of "held". Archived Depots are excluded from aggregates but show their last values read-only.
- **Money:** decimal strings + `decimal.js` throughout core; no rounding of intermediates; JS `number` only for return percentages and chart payloads at the presentation edge.
- **Dates:** business dates `YYYY-MM-DD` (Europe/Berlin), ordered `(date, sequence)`, corporate actions before Transactions on the same date; core receives "today" as a parameter (no `Date.now()` in core).
- **Chart library** is chosen in Story 4.3, wrapped in one component reused by Overview, Depot and Security pages.
- **Tests:** core unit tests for valuation (value = Σ Positions + cash incl. carried-forward prices), returns (Deposit not gain, tax refund, no-flow Period sanity check, hand-calculated TTWROR/XIRR reference), and Security totals (fully sold, two Depots, dividends, fees, split). Synthetic fixtures only.

## UX & Interaction Patterns

- **Hero card:** "Gesamtwert" in figure-hero, gain/loss pill (amount + TTWROR), XIRR beside it, expandable breakdown (realized, unrealized, dividends, fees, taxes), area chart inside.
- **KPI row:** invested capital (primary border), dividends in Period (accent), cash (cash color), taxes paid in Period (series-4); 4px colored top border; one line on ≥ md, 2×2 grid on phones.
- **Area chart:** value as 3px primary line with vertical gradient fill; invested capital dashed `chart-invested`, no fill; light horizontal grid only; crosshair/tap tooltip (date, value, invested) in a white rounded card; carried-forward days not marked.
- **Period selector:** pill group 1M · YTD · 1J · 3J · Max · Benutzerdefiniert (date range) in the page header of Overview, Depot and Security detail; selection persists across those pages and across sessions.
- **Composition donut + legend:** top 8 Positions + "Sonstige"; segments in series-1..5 order; cash always its own segment in `cash` color; legend shows label, %, amount; tapping a legend row highlights its segment.
- **Overview:** layout per `mockups/overview-desktop.html` — hero, stale Alert ("Kurse für N Wertpapiere veraltet", links to Wertpapiere) above KPIs when any held price is stale, top Positions with logos, Depot table (value, Gain/Loss, TTWROR, XIRR), latest three headlines; Depot row opens Depot detail; Skeleton loading; bottom nav + FAB "+" on phones; empty state "Noch kein Depot." with "Depot anlegen" / "Aus Parqet übernehmen".
- **Security detail:** per `mockups/position-phone.html` — header (logo, name, ISIN, type), Depot switcher "Alle Depots" + each Depot that ever booked it (default: Depot came from), hero with chart toggle "Kurs" (buy/sell markers with tooltip: date, Depot, quantity, price) / "Wert", KPIs (quantity, Cost Basis, unrealized, dividends in Period, average purchase price), latest price + stale badge, card "Gesamt seit Erstkauf", open FIFO lots per Depot, Transactions newest first with Depot name, 14-day news ("Keine Nachrichten der letzten 14 Tage."). Stale price: "Keine Kursquelle liefert aktuelle Kurse." with "Kurs manuell eintragen". Menu: Corporate Action, new Transaction (Depot preselected).
- Microcopy German, short, numbers first; de-DE formats (`1.234,56 €`, `+3,21 %`, `25.10.2026`); spines win over mockups on conflict.

## Cross-Story Dependencies

- 4.1 builds the core valuation series and the Period selector that 4.2–4.7 all consume.
- 4.2 return metrics feed the hero pill used by 4.4 and 4.6; 4.3's chart component is reused by 4.4, 4.6 and 4.7 (4.7 adds the Kurs/Wert toggle and trade markers).
- 4.4 Overview aggregates 4.1–4.3 across non-archived Depots; 4.5 composition is placed on Overview and Depot detail.
- 4.7 extends the 4.6 page.
- Relies on Epic 1 (ledger, FIFO, `core/cash`, Positions table, Transaction form), Epic 2 (corporate actions/split adjustment, migrated data), Epic 3 (price resolver, carry-forward, stale flag, logos, news module for headlines and Security news, manual price entry).
