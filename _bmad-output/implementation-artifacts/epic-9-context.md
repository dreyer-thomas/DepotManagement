# Epic 9 Context: Watchlists & Claude Connector

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy parks investment ideas on several named watchlists, follows their Prices and news without holding them, and opens each like a Position. Claude (Desktop/Code on the Mac, claude.ai, iOS) can manage the watchlists through an MCP server inside the app, secured by OAuth on top of Tommy's single-user login; connected apps are visible and revocable in Settings. Key figures and, for stocks, analyst ratings on the Security detail page and in the watchlist let him judge an idea or holding without another finance site. The epic is the foundation for Epic 10 (read-only portfolio access for Claude).

## Stories

- Story 9.1: Watchlists and Entries
- Story 9.2: Security Detail without a Holding
- Story 9.3: Watchlists in Export and Restore
- Story 9.4: Claude Connector with Login (MCP + OAuth)
- Story 9.5: Connected Apps in Settings
- Story 9.6: Key Figures
- Story 9.7: Analyst Ratings

## Requirements & Constraints

- Named watchlists (required, unique, ≤ 60 chars), full CRUD of lists and entries in the app and from Claude; no buy action. Entry = one Security (ISIN or crypto symbol), plain-text note (≤ 2000), date added; once per list, may be on several lists. Removing an entry never deletes the Security or its Prices.
- Per entry: Price with stale badge, change today, change since added (resolved Price on date added, carry-forward; "–" without Price), "im Bestand" when held, "via Claude" when created via MCP.
- Watchlists are exported/restored; OAuth clients/tokens and key-figure/analyst snapshots are never exported. After restore, connected apps must reconnect.
- Privacy: financial data stays on the server except read-only access granted to an MCP client (Epic 10); in this epic Claude only gets the `watchlist` scope. Outbound provider requests carry only symbols, ISINs, names.
- Every page/route requires the session cookie except login, OAuth endpoints and `/api/mcp` (OAuth access token only). Nothing is written to the ledger via MCP except Security creation via `ledger.ensureSecurity`.
- Key figures/analyst data: a figure not delivered shows "–", never 0; snapshot older than 7 days flagged like a stale Price; refreshed at most once a day per Security (daily with classification run, or "Kennzahlen aktualisieren"); always show source and date plus a no-advice hint.
- Operator: set `APP_URL` before deploying 9.4; 9.4/9.5 need checks with real Claude clients.

## Technical Decisions

- **Modules:** `watchlist` owns Watchlist/WatchlistEntry (depends on `ledger`, `prices`); `mcp` owns OAuthClient/OAuthGrant/OAuthToken. `classification` also owns the key-figures and analyst snapshot per Security (plus the stored, editable "Analysten-Symbol"): a disposable cache with `fetchedAt`, never input to any calculation. Cross-module access only via `src/modules/<name>/index.ts` services.
- **Securities** only via idempotent `ledger.ensureSecurity`; unknown ISIN from MCP resolved via OpenFIGI, else refused with reason.
- **Pure core** (with unit tests): change since added and watchlist sorting (incl. split after date added, split-adjusted Prices on read); 52-week high/low (closing prices with dates), distance to high, 52-week performance from stored split-adjusted Prices, never from the provider (tests: split inside window, < 52 weeks of Prices); analyst consensus mapping, chart shares, target change. Single core price resolver and `isStale`.
- **Held set:** `heldSecurities` stays the only definition of "held". Watchlist Securities are priced like benchmarks and join the news set but never appear in Positions, totals or analyses. History back to the earlier of the `3J` start and the earliest date added; leaving every list (and not held) stops fetching.
- **Export/restore:** watchlists with entries, bumped `schemaVersion`; pure upgrade of older files to empty watchlists; restore replaces watchlists in the same DB transaction as the ledger.
- **MCP/OAuth:** stateless Streamable-HTTP `/api/mcp`; OAuth 2.1 with RFC 9728/8414 metadata, RFC 7591 registration, PKCE S256 only, exact redirect URI (HTTPS or localhost). Code single-use 10 min; access token 1 h; rotating refresh 90 days, reuse revokes the grant. Only SHA-256 hashes stored; tokens/codes/amounts never logged. Unauthenticated → 401 with `WWW-Authenticate: Bearer resource_metadata=…`. Auth proxy lets exactly `/.well-known/oauth-*`, `/oauth/*`, `/api/mcp` through. Scopes: `watchlist`; `portfolio:read` reserved for Epic 10. Tools are thin adapters over services/core; decimals as strings, dates `YYYY-MM-DD`. `get_watchlist` (and `get_security` once Epic 10 adds it) returns key figures and analyst data.
- **Yahoo:** one `quoteSummary` call per symbol (`summaryDetail`, `defaultKeyStatistics`, `financialData`, `calendarEvents`, `fundProfile`, plus `recommendationTrend`/`upgradeDowngradeHistory` for 9.7), shared with the classification request where possible, for held and watchlist Securities. Foreign stocks on German listings lack analyst data and forward KGV; analyst data then comes from the home listing resolved once by ISIN via Yahoo search (e.g. APC.DE → AAPL). Price-target change is computed against the same listing and currency (USD target vs USD price). Amounts in EUR as quoted for the mapped listing; ratios as delivered. Tests use recorded responses (German stock, foreign stock on German listing, ETF, no-data symbol; SAP.DE with trend, APC.DE → AAPL).
- **Config:** new env `APP_URL` (issuer/resource) in `.env.example`; `@modelcontextprotocol/sdk` exact-pinned in 9.4.

## UX & Interaction Patterns

- **Watchlists:** drawer entry between Wertpapiere and Einstellungen ("Mehr" on phones); lists as tabs (select on phones) in creation order, last list remembered per browser; empty state "Watchlist anlegen". "Wertpapier hinzufügen" reuses the Transaction form's Security Autocomplete. Table like the Depot positions list, sortable (default date added, newest first), stacked on phones; row opens Security detail. Duplicate: "Steht schon auf dieser Liste". Optional columns KGV, Dividendenrendite, Abstand zum 52-Wochen-Hoch, Analysten (consensus + n) via a column menu, remembered per browser; in the expanded row on phones.
- **Security detail without holding:** header, Period chart with moving average, news, classification, card "Auf Watchlists" (inline edit); holding/Transaction blocks omitted, not empty. "Zur Watchlist" and list chips on every Security. Securities page marks watchlist-only Securities "Watchlist".
- **Card "Kennzahlen"** (both layouts): "Yahoo Finance, Stand TT.MM.JJJJ"; stocks grouped Bewertung · Größe · Dividende · Qualität · Risiko · Termine; ETFs/funds Fondsgesellschaft, TER, Auflagedatum; 52-week figures for all, labelled "auf Schlusskursbasis"; hint "Angaben ohne Gewähr, keine Anlageberatung".
- **Card "Analystenbewertungen"** (stocks only, only when data exists): consensus "Optimistisch" (≤ 2,0) / "Neutral" (≤ 3,0) / "Pessimistisch" + "<n> Analysten"; radial Kaufen/Halten/Verkaufen chart with strong parts darker inside, labels with counts, gain/neutral/loss tokens, readable as a table for keyboard/screen readers; 4-month stacked trend columns; Kursziel mean with low–high range and implied %; collapsible "Letzte Änderungen" (last 10); hint "Einschätzungen von Analysten, keine Anlageberatung".
- **OAuth consent** outside the app shell: "„<Client-Name>“ möchte deine Watchlists lesen und ändern", redirect host, Erlauben / Ablehnen; login first when no session.
- **Settings › Verbundene Apps:** client, redirect host, scopes in German, connected since, last used (≤ once/min); "Trennen" (confirm) and "Alle trennen"; empty state explains connecting Claude.

## Cross-Story Dependencies

- 9.1 → 9.2 → 9.3 → 9.4 → 9.5 → 9.6 → 9.7; 9.2–9.5 build on the `watchlist` module and core from 9.1.
- 9.2 extends Security detail (4.6/4.7, moving average 7.8, classification 7.1); 9.3 extends export/restore (6.1/6.2); 9.4 reuses the login (1.2), README gains "Claude verbinden"; 9.5 needs 9.4's grants.
- 9.6 extends the classification refresh (AD-20), the 9.2 detail page, the 9.1 table and the 9.4 MCP tools; 9.7 reuses 9.6's refresh, cache and column menu.
- Epic 10 (consent checkbox for `portfolio:read`, read tools incl. `get_security` with key figures) depends on 9.4–9.6; keep scope model and consent page extensible.
