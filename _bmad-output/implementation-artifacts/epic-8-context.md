# Epic 8 Context: Planning & Taxes

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy uses DepotManagement like a native app on his phone, checks his returns against market indices and against his other Depots, tracks his German capital-gains tax position per broker and year (making good use of his Freistellungsauftrag and catching withholding mistakes), and rebalances towards a robo-advisor-style target allocation with concrete, tax-aware buy and sell suggestions. Global ETFs get a region split so that region analyses and regional targets see, for example, the US share inside an MSCI World fund. Sub-pages get a back link naming where Tommy came from, so the installed app (which has no browser back button) has no dead ends. All tax figures and trade suggestions are estimates and advice only. Nothing is booked, and the broker's tax statement is authoritative.

## Stories

- Story 8.1: Home-Screen App
- Story 8.2: Benchmark Comparison
- Story 8.3: Tax Preview with Freistellungsauftrag
- Story 8.4: Region Weights for Global Funds
- Story 8.5: Target Allocation and Rebalancing
- Story 8.6: Back Navigation

## Requirements & Constraints

- **Home-screen app:** installable on iOS Safari and Android Chrome. It opens full-screen in the app's colours (light and dark). Every data route still requires login. No service worker and no offline cache: data stays on the server.
- **Benchmark:** the Portfolio or Depot line and the comparison line both start at 0 % at the Period start. An index return is the ETF's price return over the Period, from the last close on or before the Period start to the last close in the Period. A Depot-vs-Depot comparison uses exactly the same TTWROR as the Depot pages. If price history is missing, show "Keine Kurse für den Vergleich" instead of a line.
- **Tax:** follow German rules within a limited scope:
  - Withholding: 25 % Kapitalertragsteuer plus 5,5 % Solidaritätszuschlag on the taxable amount.
  - Stock losses offset only stock gains (Aktientopf). Other losses offset all income.
  - Teilfreistellung is 30 % for equity funds (asset class Aktien) and 0 % otherwise, with a manual override per Security.
  - The allowance (Freistellungsauftrag) is set per broker and year, default 0. Show a hint when the sum across brokers exceeds 1.000 € (the limit for singles; 2.000 € for couples).
  - Depots of the same broker share one allowance and one set of loss pots.
  - Compare the estimate with the tax withheld per the ledger (TAX amounts on trades and dividends, plus standalone TAX Transactions). Label the difference "voraussichtliche Erstattung" or "voraussichtliche Nachbelastung".
  - Out of scope, stated in a hint on the view: church tax, loss carry-forwards, Vorabpauschale, foreign withholding tax credit.
- **Region split:** approximate index weights per region (USA, Europa, Japan, Pazifik ohne Japan, Schwellenländer, Sonstige). The weights sum to 100 % and are dated in the rules table. They are editable per Security; a manual split is never overwritten by a refresh. Funds that match no rule keep their single region.
- **Targets:**
  - Segments: Aktien USA, Aktien Europa, Aktien Japan, Aktien Pazifik ohne Japan, Aktien Schwellenländer, Anleihen, Gold/Rohstoffe, Immobilien, Krypto, Geldmarkt/Cash. Targets must sum to 100 %.
  - Segment values sum to the scope value. Cash balances count as Geldmarkt/Cash.
  - An optional new deposit goes first to the most underweight segments.
  - A deviation below the threshold (default 2 points, editable) counts as "im Rahmen" and produces no trade.
  - Sells choose the lowest-tax holdings and FIFO lots first (losses before small gains). Each sell shows its estimated gain and tax, and the proposal shows its total tax.
- **Back navigation:**
  - Applies to sub-pages only: Security detail, Depot detail, Depot reconciliation, import batch, Parqet migration. Top-level pages (Übersicht, Depots, Analysen, Nachrichten, Import, Wertpapiere, Watchlists, Einstellungen, Mehr) get no back arrow; neither do the "Mehr" pages on phones.
  - Target = the previous *different* page, returned to as left (same URL incl. query such as selected watchlist, Depot switcher, tab; scroll, Period and chart choices kept), like browser back. In-page changes of the sub-page (Depot switcher, chart mode, Period, tabs) are never the target.
  - Without an in-app origin (direct open, bookmark, new tab, origin gone from history) fall back to the logical parent: Security detail → "Wertpapiere", Depot detail → "Depots", reconciliation → the Depot, import batch → "Import", Parqet migration → "Einstellungen".
  - The label must always match the target, also after reload, browser back/forward and the iOS swipe gesture. The origin is kept per browser tab only: no server state, and nothing added to the URL that changes what the page shows.
- **Testing:** every calculation is a pure core function with unit tests against hand-calculated references:
  - TTWROR series and rebasing, including a deposit inside the Period
  - tax loss pots, Teilfreistellung, allowance usage and the withheld comparison
  - region distribution
  - segment mapping, deposit distribution and trade selection
  - back-link target and label resolution: origin vs fallback, in-page changes, reload, back/forward
- **Accessibility:** WCAG 2.2 AA. Gains and losses are never shown by colour alone. Touch targets are at least 44 px.

## Technical Decisions

- **Auth (Story 8.1):** the app is single-user and every page and route requires a session. The auth gate lets through exactly the login page, the manifest (`app/manifest.ts`) and the icon paths. Icons: 192, 512, maskable, apple-touch-icon 180. Manifest theme and background colours come from the DESIGN.md tokens, and `src/theme/tokens.ts` must stay in sync with them. On iOS the installed app keeps its own login; the README states this.
- **Performance boundary:** the unit of measurement is a Depot including its Cash Account, and the Portfolio is the sum of non-archived Depots. TTWROR comes from the single core daily valuation series. Deposits, withdrawals and net taxes are external flows. Realized gains are FIFO per Depot, taken on the sale date.
- **Benchmark Securities:** one reference table of accumulating EUR UCITS ETFs:
  - MSCI World: IE00B4L5Y983
  - MSCI ACWI: IE00B6R52259
  - DAX: DE0005933931
  - S&P 500: IE00B5BMR087

  They are priced through the normal provider and price-resolver pipeline (manual > provider > transaction price, carried forward). They are never "held": they appear in no Position, total, news or analysis. `heldSecurities()` stays the only definition of held, so pricing must cover benchmarks without adding them to it.
- **Tax (one core function):** a single pure `tax` core function computes taxable income, loss pots, Teilfreistellung, allowance usage and estimated tax per broker and year. Inputs are ledger rows (FIFO results), classifications and allowance settings. The tax preview and every rebalancing sell estimate must call this same function. Withheld tax comes only from the ledger. Results are never booked and are always labelled as estimates.
- **Classification:** region splits live in the `classification` module with source `rule | manual`, and `manual` always wins. Every analysis reads classifications only through this module. ETF look-through (X-Ray) stays out of scope; only the approximate region-weight split is added. The rules table and the distribution are pure core functions.
- **Settings ownership and backup:** user settings are stored by their owning module:
  - Freistellungsauftrag amounts per broker and year
  - target weights per scope (Portfolio or a Depot)
  - deviation threshold
  - Teilfreistellung overrides

  Freistellungsauftrag amounts must be added to the JSON export/restore. Bump `schemaVersion` and add a pure upgrade function for older files. Restore replaces data and never merges.
- **Back navigation (Story 8.6):** one shared back-link component used on every sub-page, plus one pure function that resolves target and label from the origin entry with parent fallback. Client-side only, per-tab state; no spec, PRD or architecture change is involved.
- **Usual invariants:**
  - Money is a decimal string computed with `decimal.js`, never a JS `number`.
  - `src/core` is pure: no Prisma, I/O or `Date.now()`; pass "today" in.
  - Business dates are `YYYY-MM-DD`.
  - Only `ledger` writes ledger rows; Epic 8 writes none.
  - Prisma changes go in new migrations, never edits to committed ones.
  - Tests never hit live providers.

## UX & Interaction Patterns

- **Home-screen install:** the action is "Zum Home-Bildschirm" in iOS Safari and "App installieren" in Android Chrome. The installed app has name "DepotManagement", short name "Depot", `display: standalone`, start URL `/`, and the status bar takes the app colours in light and dark mode.
- **Value chart:** on Overview and Depot detail the chart tabs become Wertentwicklung · Performance · Drawdown.
  - Performance shows the cumulative TTWROR for the global Period, with hover and tap values.
  - A "Vergleich mit" select offers: keiner, MSCI World, MSCI ACWI, DAX, S&P 500, Gesamtportfolio (on Depot detail only), and every other non-archived Depot.
  - The comparison is a dashed second line with a legend. The KPI row shows both returns and the difference in percentage points.
  - The selection persists per browser.
- **Settings › "Steuern":** one Freistellungsauftrag input per broker and year.
- **Analysen › "Steuern":** per broker and chosen year, show:
  - dividends and interest
  - stock gains and losses
  - fund gains and losses after Teilfreistellung
  - other income
  - loss offsetting
  - allowance used and left
  - estimated vs withheld tax

  A Portfolio total row sums the brokers, and a scope hint lists what is not covered.
- **Securities page:** the region split is edited per Security as percentages that must sum to 100 %.
- **Allocation, "Region" dimension:** a fund's value is distributed by its split. On drill-down the fund appears under each region with its share.
- **Analysen › "Zielallokation"** (scope Portfolio or one Depot):
  - target inputs per segment
  - a table per segment: actual €, actual %, target %, deviation in points and in €
  - a "Neue Einzahlung" amount
  - a "Rebalancing-Vorschlag" list. Buys name the largest existing holding of the segment as the suggested instrument. Sells show per-sale gain and tax. Rows within the threshold are marked "im Rahmen".
- **Back link:** in the page header, left of the title, "‹ <label>" where the label names the origin: the Depot name, the watchlist name, "Übersicht", "Depots", "Wertpapiere", "Nachrichten", "Analysen", "Import", "Einstellungen" or the Security name. Long labels are truncated with an ellipsis; `aria-label` is "Zurück zu <label>" with the full label. Keyboard-operable, touch target ≥ 44 px, works at phone and desktop width.
- **Layout:** UI text is German with de-DE number formats. Gutters are 16 px on phones and 24 px on desktop. Phones use bottom navigation, and Analysen and Settings are reached via "Mehr".

## Cross-Story Dependencies

- Story 8.5 depends on Story 8.3 (the tax core for sell estimates and lot selection) and on Story 8.4 (region splits for the equity segments).
- Story 8.4 extends Story 7.1 (classification rules) and Story 7.2 (the allocation view, "Region" dimension).
- Story 8.2 builds on the Epic 4 TTWROR series and Period selector, the Story 7.6 Drawdown tab, and Epic 3 price backfill.
- Story 8.3 depends on Story 7.1 asset classes (Teilfreistellung), the Epic 1 and 4 FIFO realized results, the TAX amounts in the ledger, and the Epic 6 export/restore format.
- Story 8.1 depends on the Epic 1 auth gate and theme tokens. It is independent of the other Epic 8 stories.
- Story 8.6 complements Story 8.1 (the installed app lacks a browser back button). It touches the page headers of the sub-pages built in Epics 1 to 5 (Depot detail, reconciliation, import batch, Parqet migration) and the Security detail, and must recognise watchlists (Epic 9) as an origin. It is independent of Stories 8.2 to 8.5.
