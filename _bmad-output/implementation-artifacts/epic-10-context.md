# Epic 10 Context: Portfolio Access for Claude

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy lets a connected Claude client (Desktop, claude.ai, iOS, Claude Code) read his Depots, Positions, Transactions and performance/allocation/income figures so he can run risk and strategy analyses with Claude instead of Parqet. Access is opt-in per connection, strictly read-only, and every figure Claude sees is exactly the figure the app shows. It extends the Epic 9 MCP connector (OAuth, consent page, Verbundene Apps) with a new scope `portfolio:read` and a set of read tools.

## Stories

- Story 10.1: Portfolio Read Permission
- Story 10.2: Portfolio Read Tools

## Requirements & Constraints

- Per connection, Tommy can grant Claude read-only access to Depots, Positions, Transactions and figures; nothing is ever written via MCP.
- `portfolio:read` is opt-in and off by default; it is only granted when Claude requests it and Tommy checks the consent checkbox. It can be removed from a grant without disconnecting; re-adding requires a new consent.
- A tool needing `portfolio:read` called without it returns an MCP error "Keine Berechtigung für Depotdaten" and no data.
- Privacy: financial data leaves the server only as responses to a connected MCP client holding `portfolio:read`. Responses never include credentials, session data or other connections' data.
- Security: `/api/mcp` accepts only OAuth access tokens issued after the single-user login; all other routes still require the session cookie.
- Payload format: amounts as decimal strings in EUR, dates `YYYY-MM-DD`.
- `list_transactions` is cursor-paginated, max 500 rows per call.
- Tests must prove: each tool's result equals the corresponding page loader on a fixture ledger; the tool list contains no tool that writes ledger, prices, classification, tax or target data.

## Technical Decisions

- **Single MCP endpoint, mcp module:** the `mcp` module serves Streamable-HTTP `/api/mcp` and the OAuth 2.1 server, and owns OAuthClient, OAuthGrant, OAuthToken. Scopes are `watchlist` (read/write watchlists) and `portfolio:read`; the granted scopes live on the grant.
- **Tools are thin adapters:** they call module services and core — never compute financial figures themselves. The `mcp` module may depend on `watchlist`, `ledger`, `prices`, `classification`, `auth` only through their exported services (`src/modules/<name>/index.ts`); never reads other modules' Prisma models.
- **Ledger is the source of truth (compute on read):** Positions, Cost Basis, balances, values, returns and composition come from `src/core` over the ledger; reuse the same functions the UI page loaders use so numbers match.
- **Performance semantics:** unit is a Depot incl. its Cash Account; Portfolio = sum of non-archived Depots; one daily valuation series feeds TTWROR, XIRR and Period figures; external flows are Deposits, Withdrawals and net taxes; invested capital = FIFO Cost Basis of open Positions. Security-level all-time result = realized + unrealized + dividends − fees (taxes separate).
- **Held set / archive:** archived Depots are excluded from every aggregate but stay viewable; "held" has one definition (`heldSecurities`). Benchmarks and watchlist Securities never appear in Positions or totals. With `portfolio:read`, watchlist entries carry `held: true|false` derived from that definition.
- **Classification:** allocation reads classifications only through the `classification` module (dimensions as in the Analysen › Aufteilung view; unclassified = "Unbekannt"). Key figures/analyst data are a disposable cache, returned by `get_security` but never input to calculations.
- **Decimals:** decimal.js only, TEXT decimal strings, no JS `number` for money; rounding only at presentation.
- **Validation/errors:** zod at the route/tool boundary; expected failures as typed results, not thrown.
- **Logging:** never log tokens, codes or amounts in tool payloads.
- OAuth data is not part of backup/restore; connected apps reconnect after a restore.

## UX & Interaction Patterns

- Consent page (outside the app shell, like Login): existing text "„<Client-Name>“ möchte deine Watchlists lesen und ändern", redirect host, plus checkbox "Darf auch Depots, Bestände, Umsätze und Kennzahlen lesen (nur lesen)" — shown only when `portfolio:read` is requested, unchecked by default; buttons Erlauben / Ablehnen.
- Settings › Verbundene Apps: per grant shows client, granted scopes in plain German, connected since, last used; actions Trennen, Alle trennen, and a new "remove portfolio access" per grant.
- UI text German, de-DE formats.

## Cross-Story Dependencies

- Builds on Epic 9: Story 9.4 (MCP endpoint, OAuth, consent page, watchlist tools) and Story 9.5 (Verbundene Apps). Story 9.6/9.7 key figures and analyst ratings must be included in `get_security`.
- 10.2 depends on 10.1: every read tool is gated by the `portfolio:read` scope check from 10.1.
- Tools reuse existing loaders/core from Epics 1–8: Overview/Period presets and benchmarks (Story 8.2), allocation (Story 7.2, region split 8.4), income/returns analyses, Security detail (FR-19), Transactions list.
