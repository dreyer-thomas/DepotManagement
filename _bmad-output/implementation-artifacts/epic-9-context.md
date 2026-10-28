# Epic 9 Context: Watchlists & Claude Connector

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy parks investment ideas on several named watchlists, follows their Prices and news without holding them, and opens each like a Position. Because ideas often come out of research with Claude, Claude (Desktop and Code on the Mac, claude.ai, the iOS app) can manage the watchlists directly through an MCP server inside the app, secured by OAuth on top of Tommy's existing single-user login. Connected apps are visible and revocable in Settings. This epic is the foundation for Epic 10 (read-only portfolio access for Claude).

## Stories

- Story 9.1: Watchlists and Entries
- Story 9.2: Security Detail without a Holding
- Story 9.3: Watchlists in Export and Restore
- Story 9.4: Claude Connector with Login (MCP + OAuth)
- Story 9.5: Connected Apps in Settings

## Requirements & Constraints

- Several named watchlists (name required, unique, ≤ 60 chars); full create/rename/delete of lists and entries, in the app and from Claude. No buy action from a watchlist.
- An entry is one Security (ISIN or crypto symbol) with a plain-text note (≤ 2000 chars) and a date added; a Security appears at most once per list but may be on several lists. Removing an entry never deletes the Security or its Prices.
- Per entry: Price with stale badge, change today, change since added (from the resolved Price on the date added, carry-forward; "–" without a Price), "im Bestand" when held, "via Claude" when created through MCP.
- Watchlists are part of export/restore and backup; OAuth clients/tokens are never exported, so connected apps must reconnect after a restore.
- Privacy policy (deliberately changed): financial data stays on the server except read-only access Tommy grants to a connected MCP client (Epic 10). In this epic Claude only gets the `watchlist` scope. Outbound requests to providers still carry only symbols, ISINs, company names.
- Security: every page and route still requires the session cookie, except login, the OAuth endpoints and `/api/mcp`, which accepts only an OAuth access token issued after that same login.
- Success: Claude on Mac and iPhone connects with Tommy's login only and adds an idea that appears in the app with Price and "since added"; removing the connection makes the next MCP call fail with 401; nothing is written to the ledger via MCP (except Security creation through `ledger.ensureSecurity` for a new watchlist entry).
- Operator: Tommy must set `APP_URL` in the server env before deploying 9.4; 9.4 and 9.5 need operator checks with real Claude clients.

## Technical Decisions

- **Module ownership:** new `watchlist` module owns Watchlist and WatchlistEntry (depends on `ledger`, `prices`); new `mcp` module owns OAuthClient, OAuthGrant, OAuthToken (depends on `watchlist`, `ledger`, `prices`, `classification`, `auth`). Cross-module access only through exported services in `src/modules/<name>/index.ts`; writing services accept an optional Prisma transaction client.
- **Securities:** created only via idempotent `ledger.ensureSecurity({ isin } | { cryptoSymbol })`; only `ledger` writes name/assetType. Unknown ISIN from MCP is resolved through OpenFIGI, else refused with a reason.
- **Pure core:** "change since added" and watchlist sorting are pure `src/core` functions with unit tests, including a split after the date added (split-adjusted Prices via CorporateActions on read; stored Prices stay unadjusted). Price on a date uses the single core resolver (manual > provider > Transaction price, else carry-forward); stale uses the single core `isStale`.
- **Held set:** `heldSecurities(ledger)` stays the only definition of "held". Watchlist Securities are priced like benchmarks and are in the news set, but never held: they appear in no Position, total or analysis. Price history goes back to the earlier of the `3J` preset start and the earliest date added; a Security leaving every list and not held stops being fetched, stored Prices remain.
- **Export/restore:** export JSON gains Watchlists with entries (Security reference, note, date added, position) and a bumped `schemaVersion`; older files upgrade to empty watchlists via a pure upgrade function; restore replaces watchlists in the same DB transaction as the ledger, never merges.
- **MCP/OAuth (AD-22):** one stateless Streamable-HTTP endpoint `/api/mcp` plus an OAuth 2.1 authorization server per the MCP authorization spec: RFC 9728 protected-resource metadata, RFC 8414 server metadata, RFC 7591 dynamic registration (`/oauth/register`), PKCE S256 only, exact redirect URI match (HTTPS, or `http://localhost`/`127.0.0.1`). Code single-use, 10 min; opaque access token 1 h; rotating refresh token 90 days, reuse revokes the whole grant. Codes and tokens stored only as SHA-256 hashes; tokens, codes and payload amounts never logged. Unauthenticated `/api/mcp` → 401 with `WWW-Authenticate: Bearer resource_metadata=…`.
- **Scopes:** `watchlist` (read/write through the `watchlist` service); `portfolio:read` is reserved for Epic 10. Tools are thin adapters over module services and core, never compute figures themselves, and validation is identical to the app. Entries created via MCP record source `mcp` and the client name. Payloads: decimals as strings, dates `YYYY-MM-DD`.
- **Auth proxy** (`src/proxy.ts`) lets exactly `/.well-known/oauth-*`, `/oauth/*` and `/api/mcp` through; those routes check their own credentials.
- **Config:** new env var `APP_URL` (public base URL, OAuth issuer and resource) added to `.env.example`. New dependency `@modelcontextprotocol/sdk` with an exact pin chosen in 9.4. Nginx needs no change.
- Usual conventions apply: decimal strings via `decimal.js`, business dates, new Prisma migrations only (never edit committed ones), tests use recorded provider responses.

## UX & Interaction Patterns

- **Watchlists surface:** nav drawer entry between Wertpapiere and Einstellungen; under "Mehr" on phones. Lists as tabs (select on phones) in creation order; last opened list remembered per browser; empty state "Watchlist anlegen". "Wertpapier hinzufügen" reuses the Transaction form's Security Autocomplete (incl. "Neue Security anlegen"). Table resembles the Depot positions list; sortable by name, change today, change since added, date added (default newest first); stacked rows on phones; row opens Security detail. Deleting a non-empty list confirms with name and entry count. Duplicate message: "Steht schon auf dieser Liste".
- **Security detail without holding:** header, Period price chart with moving-average overlay, news, classification, and card "Auf Watchlists" (each list, date added, change since added, full note, inline edit). Holding/Transaction blocks are omitted, not shown empty; a once-held Security keeps them. Every Security detail gets "Zur Watchlist" and list chips. The Securities page marks watchlist-only Securities with "Watchlist".
- **OAuth consent page:** outside the app shell like Login; text "„<Client-Name>“ möchte deine Watchlists lesen und ändern", redirect host, buttons Erlauben / Ablehnen. Without a session the existing login is shown first, then returns.
- **Settings › Verbundene Apps:** per grant client name, redirect host, scopes in plain German, connected since, last used (updated at most once per minute); "Trennen" (confirm naming the client) and "Alle trennen"; empty state explains how to connect Claude. Toast example: "„Claude“ getrennt."
- UI text German, de-DE formats.

## Cross-Story Dependencies

- Sequence 9.1 → 9.2 → 9.3 → 9.4 → 9.5; 9.2–9.5 build on the `watchlist` module and core functions from 9.1.
- 9.2 extends the existing Security detail page (Stories 4.6/4.7, moving average from 7.8, classification from 7.1) and the news set.
- 9.3 extends export/restore (Stories 6.1/6.2); its restore text must mention reconnecting apps from 9.4.
- 9.4 reuses the single-user login (Story 1.2) and the `watchlist` service; the README gains "Claude verbinden".
- 9.5 depends on 9.4's grants/tokens. Epic 10 (10.1 consent checkbox for `portfolio:read`, 10.2 read tools) depends on 9.4 and 9.5; design the scope model and consent page so `portfolio:read` can be added without rework.
