---
title: 'Claude Connector with Login — MCP + OAuth (story 9-4)'
type: 'feature'
created: '2026-10-28'
status: 'awaiting-operator'
baseline_revision: 'a19a55299332552b2671385c43ca26e59dd0c7dd'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
operator_actions:
  - "Set APP_URL in the production server environment to the public HTTPS origin (e.g. https://depot.example.com, no path) and restart the service before deploying story 9.4."
  - "Deploy the build and run prisma migrate deploy so migration 20261102000000_add_oauth is applied on the server."
  - "In Claude Desktop or claude.ai add a custom connector with APP_URL/api/mcp, sign in with the app login, click Erlauben, and confirm list_watchlists works."
  - "On the iPhone Claude app confirm the same connector works and that add_watchlist_entry creates an entry that appears in the app with Price, change since added and via Claude."
  - "Run claude mcp add --transport http depotmanagement <APP_URL>/api/mcp in Claude Code, complete the browser login and consent, and confirm a tool call succeeds."
---

<intent-contract>

## Intent

**Problem:** Claude (Desktop, claude.ai, iOS, Claude Code) cannot reach the watchlists: there is no MCP endpoint and no way to authorize a client with Tommy's single-user login.

**Approach:** A new `mcp` module with an OAuth 2.1 authorization server (RFC 8414/9728 metadata, RFC 7591 registration, PKCE S256, consent page behind the existing login, opaque hashed tokens with rotating refresh) and one stateless Streamable-HTTP MCP endpoint `/api/mcp` whose nine tools are thin adapters over the `watchlist`/`ledger`/`prices` services. The proxy lets exactly these paths through; restore clears OAuth data.

## Boundaries & Constraints

**Always:**
- `APP_URL` (env): absolute `http(s)` origin without path/query/fragment (one trailing `/` stripped). Issuer = `APP_URL`; resource = `APP_URL/api/mcp`. Unset/invalid → every OAuth/MCP route answers 503 `{"error":"server_error"}` (logged once per request without values); the rest of the app works unchanged. Add to `.env.example`.
- Metadata (JSON, `Cache-Control: no-store`): `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` → `{resource, authorization_servers:[issuer], scopes_supported:["watchlist"], bearer_methods_supported:["header"]}`; `GET /.well-known/oauth-authorization-server` → `issuer`, `authorization_endpoint` (`/oauth/authorize`), `token_endpoint` (`/oauth/token`), `registration_endpoint` (`/oauth/register`), `response_types_supported:["code"]`, `grant_types_supported:["authorization_code","refresh_token"]`, `code_challenge_methods_supported:["S256"]`, `token_endpoint_auth_methods_supported:["none","client_secret_post","client_secret_basic"]`, `scopes_supported:["watchlist"]`, `authorization_response_iss_parameter_supported:true`.
- Registration `POST /oauth/register` (JSON, RFC 7591): `redirect_uris` 1–10, each exactly `https://…` or `http://localhost[:port]/…` / `http://127.0.0.1[:port]/…`, no fragment; `client_name` NFC-trimmed, ≤ 100, default `"Unbenannte App"`; `grant_types` ⊆ {authorization_code, refresh_token}; `response_types` ⊆ {code}; `token_endpoint_auth_method` ∈ supported (default `none`; the secret methods get a random `client_secret`, stored hashed). 201 with `client_id`, `client_id_issued_at`, the registered fields (+ `client_secret` once). Error 400 `{error:"invalid_redirect_uri"|"invalid_client_metadata", error_description}`. Before inserting, delete clients older than 24 h without any grant; then refuse with 400 when ≥ 200 clients exist.
- Authorize `GET /oauth/authorize` (page outside the app shell, like `/login`): unknown `client_id` or `redirect_uri` not exactly registered → error page, never a redirect. Other problems redirect to the URI with `error` (+ `state`, `iss`): `response_type`≠`code` → `unsupported_response_type`; missing `code_challenge` or method ≠ `S256` (absent counts as wrong) → `invalid_request`; `resource` present and ≠ resource → `invalid_target`; `scope` containing anything other than `watchlist`/`portfolio:read` → `invalid_scope`. Granted scope is always `watchlist` (`portfolio:read` is dropped until Epic 10). Without a session → redirect to `/login?next=<this path+query>`. With a session → consent card: "„<Client-Name>“ möchte deine Watchlists lesen und ändern", "Weiterleitung an <redirect host>", buttons "Erlauben" / "Ablehnen". The decision is a server action that re-validates session and all parameters; Erlauben → new code, redirect `redirect_uri?code=…&state=…&iss=…`; Ablehnen → `error=access_denied`. Response headers for `/oauth/*`: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`.
- Token `POST /oauth/token` (form-encoded; JSON responses with `Cache-Control: no-store`): client auth per its registered method (`invalid_client` 401 otherwise). `authorization_code`: code (single use, 10 min), same `client_id` and `redirect_uri`, `code_verifier` with `BASE64URL(SHA256(verifier)) === challenge`, `resource` if sent must equal resource → creates the grant and returns `{access_token, token_type:"Bearer", expires_in:3600, refresh_token, scope:"watchlist"}`. A reused code → `invalid_grant` and the grant created from it is revoked. `refresh_token`: valid, unconsumed, client matches → marks it consumed and issues a new access + refresh pair; a consumed refresh token presented again → `invalid_grant` and the whole grant revoked. Errors are RFC 6749 JSON (`invalid_request`, `invalid_grant`, `unsupported_grant_type`, …), status 400.
- Tokens: 32 random bytes base64url; access 1 h, refresh 90 days (per issued token), code 10 min. Only `sha256` hex hashes are stored. Expired rows are deleted opportunistically at issuance. Revoking a grant sets `revokedAt` and deletes its tokens.
- `/api/mcp` (`POST`; `GET`/`DELETE` → 405): `Authorization: Bearer` must be an unexpired access token of a non-revoked grant for this resource, else 401 with `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource/api/mcp"` (plus `error="invalid_token"` when a token was sent). Updates the grant's `lastUsedAt` at most once per minute. Then a fresh `McpServer` + `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) per request. Tools require scope `watchlist`.
- Tools (snake_case input/output; decimals as strings, dates `YYYY-MM-DD`; today = `businessDate(new Date())`): `list_watchlists` → `[{id,name,entry_count}]`; `get_watchlist {watchlist_id}` → `{id,name,entries}`; `create_watchlist {name}`; `rename_watchlist {watchlist_id,name}`; `delete_watchlist {watchlist_id, confirm_name?}` (a list with entries only when `confirm_name` equals the list name exactly); `add_watchlist_entry {watchlist_id, isin | crypto_symbol (exactly one), name?, note?, date_added?}`; `update_watchlist_entry {entry_id, note?, date_added?, watchlist_id?}`; `remove_watchlist_entry {entry_id}`; `search_securities {query}` (case-insensitive substring over name/ISIN/symbol of known Securities, ≤ 20, by name). Entry = `{id, security_id, name, isin, crypto_symbol, asset_type, note, date_added, price, price_date, stale, change_today, change_since_added, source, client_name}` from `watchlistView` — never `held`. Service failures → tool result `isError: true` with `{error:<reason>, message:<German text>}`.
- `add_watchlist_entry`: an existing Security (by normalized ISIN/symbol) is used as is; an unknown ISIN is looked up via OpenFIGI (name + type → asset type, `name` argument overrides the name, truncated to 100) and created through `ensureSecurity` inside `addWatchlistEntry`; OpenFIGI miss → `isin-not-found`, error → `isin-lookup-failed`, unmappable type → `asset-type-unknown`. An unknown crypto symbol becomes a CRYPTO Security named `name ?? symbol`. The entry gets `source: "MCP"` and the client's name. After a successful add/move the route schedules the price backfill and revalidates the watchlist/Security pages (callbacks passed in by the app layer).
- Proxy matcher lets exactly `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/api/mcp` through; everything else still needs the session cookie.
- `mcp` module owns `OAuthClient`, `OAuthGrant`, `OAuthToken` (new migration). Restore clears all three inside its transaction (`clearOAuth(tx)`); they are never exported.
- Never log tokens, codes, verifiers, secrets, request bodies or tool payload values.

**Never:**
- No Settings UI ("Verbundene Apps" is 9.5), no `portfolio:read` grant or tools (Epic 10), no `held` in payloads.
- No ledger/price/classification/tax/target writes from tools except Security creation via `ensureSecurity`.
- No JWT access tokens, no `plain` PKCE, no prefix/wildcard redirect matching, no MCP sessions or SSE GET stream, no change to Nginx.
- Never edit committed migrations; no SDK auth helpers that bypass the `mcp` module's own checks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Discovery | GET metadata URLs | documents per Always | — |
| No token | POST /api/mcp without/with bad bearer | 401 + `WWW-Authenticate` | `invalid_token` only when sent |
| Register | valid / `http://evil.com/cb` | 201 / 400 `invalid_redirect_uri` | — |
| Authorize, no session | valid params | 307 to `/login?next=…`; after login back to consent | — |
| Wrong redirect | unregistered URI | error page, no redirect | — |
| PKCE | missing / `plain` / wrong verifier | redirect `invalid_request` / token `invalid_grant` | — |
| Code reuse / expiry | second exchange / after 10 min | `invalid_grant`; reuse revokes grant | — |
| Refresh | rotate; reuse old | new pair; reuse → `invalid_grant`, all grant tokens dead | — |
| Revoked / expired access | grant revoked or 1 h passed | 401 | — |
| Add unknown ISIN | OpenFIGI hit / miss / 5xx | entry `source: MCP` / `isin-not-found` / `isin-lookup-failed` | nothing written on refusal |
| Delete non-empty | without / wrong / exact `confirm_name` | refused / refused / deleted | `confirm-name-mismatch` |
| APP_URL unset | any OAuth/MCP route | 503 `server_error` | — |

</intent-contract>

## Code Map

- `src/proxy.ts:46-50` -- matcher negative lookahead; add the exact OAuth/MCP paths. `src/proxy.test.ts` uses `unstable_doesMiddlewareMatch` for matcher cases.
- `src/modules/auth/index.ts` -- `getSession()`, `readAuthConfig`; `return-url.ts` `safeReturnUrl` already accepts `/oauth/authorize?…`. `src/app/login/actions.ts:21` raise `next` max to 4096 (authorize URLs).
- `src/app/login/page.tsx` -- layout template (Card outside shell) for `src/app/oauth/authorize/page.tsx`.
- `src/modules/watchlist/entries.ts:113` `addWatchlistEntry` -- add optional `origin?: { source: "MCP"; clientName: string }` input (default APP / null); `watchlistView` (entries + figures), `updateWatchlistEntry`, `removeWatchlistEntry`; `watchlists.ts` list/get/create/rename/delete. Reasons: `WatchlistFailureReason`, `WatchlistEntryFailureReason`.
- `src/modules/ledger/securities.ts:120` `findSecurityByKey` / `validateSecurity` -- export a `findSecurity(identifier)` (validated, normalized lookup) via `ledger/index.ts`; `listSecurities` for search.
- `src/modules/prices/providers/openfigi.ts` -- add `lookupIsinDetails(isin, {fetch, apiKey})` → `{status:"found", value:{name, securityType, securityType2, marketSector}}` | miss | error (no exchCode filter, first item with a name); `prices/index.ts` exports a wrapper using `globalThis.fetch` and `OPENFIGI_API_KEY`. Map in `mcp`: `ETP`→ETF; `Common Stock`/`ADR`/`GDR`/`REIT`/`Preference`→STOCK; `Open-End Fund`/`Closed-End Fund`/`Fund of Funds`/`Mutual Fund` (non-ETP)→FUND; `Warrant`/`Structured Product`/`Certificate`/`Index Warrant`→CERTIFICATE (match on `securityType` then `securityType2`, case-insensitive); else `asset-type-unknown`.
- `src/app/_actions/price-refresh.ts:37` `schedulePriceBackfill`; `src/app/_actions/watchlists.ts:46` `revalidateWatchlists` paths -- the MCP route passes equivalents as callbacks.
- `src/modules/backup/restore.ts:122-133` -- call `clearOAuth(tx)` in the transaction; `README.md` export section says OAuth data is excluded.
- `prisma/schema.prisma:431-469` -- style for new models; latest migration `prisma/migrations/20261101000000_add_watchlist` → new `20261102000000_add_oauth`.
- `src/core/dates.ts:34` `businessDate`. `src/app/api/export/route.ts` -- route handler style (security headers, error-name-only logs).
- `.env.example`, `README.md` ("Login", "Production deployment › Configuration") -- `APP_URL`; new section "Claude verbinden".

## Tasks & Acceptance

**Execution:**
- `package.json` -- add `"@modelcontextprotocol/sdk": "1.32.1"` (exact) -- MCP server + web-standard transport.
- `prisma/schema.prisma` + `prisma/migrations/20261102000000_add_oauth/migration.sql` -- `OAuthClient {id, clientId @unique, clientName, redirectUris (JSON text), grantTypes, tokenEndpointAuthMethod, clientSecretHash?, createdAt}`; `OAuthGrant {id, clientId→OAuthClient cascade, scope, createdAt, lastUsedAt?, revokedAt?}`; `OAuthToken {id, kind CODE|ACCESS|REFRESH, hash @unique, clientId→OAuthClient cascade, grantId?→OAuthGrant cascade, scope, resource, codeChallenge?, redirectUri?, expiresAt, consumedAt?, createdAt}` (timestamps as UTC ISO text). Codes carry no grant until exchanged.
- `src/modules/mcp/` (`index.ts`, `config.ts`, `crypto.ts`, `clients.ts`, `authorize.ts`, `tokens.ts`, `metadata.ts`, `http.ts`, `tools.ts`, `server.ts`, `backup.ts`) -- per Always; pure helpers (URI checks, PKCE, scope parsing, type mapping) unit-tested; `now` injectable for expiry tests.
- `src/modules/watchlist/entries.ts`, `src/modules/ledger/securities.ts`+`index.ts`, `src/modules/prices/providers/openfigi.ts`+`index.ts` -- the extensions in the Code Map, with tests (recorded OpenFIGI JSON inline).
- `src/app/.well-known/oauth-protected-resource/route.ts`, `…/oauth-protected-resource/api/mcp/route.ts`, `src/app/.well-known/oauth-authorization-server/route.ts`, `src/app/oauth/register/route.ts`, `src/app/oauth/token/route.ts`, `src/app/api/mcp/route.ts` -- thin handlers calling `mcp`.
- `src/app/oauth/authorize/page.tsx`, `ConsentForm.tsx`, `actions.ts` -- page and decision action; `next.config.ts` `headers()` for `/oauth/:path*`.
- `src/proxy.ts`, `src/app/login/actions.ts`, `src/modules/backup/restore.ts` -- per Code Map.
- Tests: `src/modules/mcp/*.test.ts` and route tests covering every matrix row plus discovery, registration, authorize with/without session, consent allow/deny, PKCE failure, wrong redirect URI, code reuse, expiry, refresh rotation and reuse, revoked token, each tool through a real MCP request (SDK `Client` + in-memory or HTTP-request round trip against the route handler), "via Claude" source on MCP entries, restore clears OAuth; proxy matcher cases incl. `/oauth/other`, `/api/mcp/x`, `/api/export` still guarded.
- `.env.example`, `README.md` -- `APP_URL`; "Claude verbinden": Desktop/claude.ai/iOS custom connector with `APP_URL/api/mcp`, `claude mcp add --transport http depotmanagement <APP_URL>/api/mcp`, tool list, that only the login is needed.

**Acceptance Criteria:**
- Given a registered client and a session, when it completes authorize (consent "Erlauben") → token exchange with the right verifier → `tools/call add_watchlist_entry`, then the entry appears in `watchlistView` with `source: MCP` and the client name, and `tools/list` returns exactly the nine tools.
- Given no session, when `/oauth/authorize` is opened, then the login page appears and after login the consent page with client name and redirect host.
- Given a grant revoked by refresh-token reuse, when its access token calls `/api/mcp`, then the response is 401.
- Given any route other than the seven OAuth/MCP paths, when requested without a session, then the proxy redirects or answers 401 as before.
- Given a restore, when it completes, then no OAuth client, grant or token remains.
- Given the full suite, when running `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 35 findings — high 0, medium 5, low 27, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: `readBody` trusts `content-length` and buffers chunked bodies fully on public `/oauth/register` and `/oauth/token` — Nginx allows 64 MB, so unauthenticated memory pressure is real; `readBody` now streams and stops at the limit.
  - `[medium]` `[patch]` Blind: `/api/mcp` 1 MiB cap checks only the declared header — same root cause; `handleMcp` now reads through `readBody` (413) and passes a rebuilt `Request`.
  - `[low]` `[reject]` Blind: 200 anonymous registrations block reconnects for 24 h — needs someone who knows the private server URL; a fix means rate limiting (new mechanism).
  - `[low]` `[reject]` Blind: loopback redirect matched with exact port (RFC 8252 §7.3), no `[::1]` — the spec mandates exact matching; Claude Code registers its exact callback URI each time.
  - `[low]` `[reject]` Blind: `APP_URL` accepts `http://` for any host — spec explicitly allows http(s) (local/LAN dev); README requires HTTPS for production; operator configuration.
  - `[low]` `[reject]` Blind: OpenFIGI lookup runs before note/date validation — only invalid input causes one needless outbound call carrying just the ISIN; reordering adds duplicate validation.
  - `[low]` `[patch]` Blind: dead `not-found`→`entry-not-found` mapping in `add_watchlist_entry` — removed; reason passed through.
  - `[low]` `[patch]` Blind: tool messages hard-code 60/2000/100 — built from `WATCHLIST_NAME_MAX_LENGTH`, `WATCHLIST_NOTE_MAX_LENGTH`, `SECURITY_NAME_MAX_LENGTH` (also in two tool descriptions).
  - `[false]` `[reject]` Blind: narrower refresh `scope` not applied — the only grantable scope is `watchlist`, so any accepted subset equals `grant.scope`; the issued scope is identical.
  - `[low]` `[reject]` Blind: refresh token issued to clients without the refresh grant — unusable but harmless (refused with `unauthorized_client`); Claude registers both grant types.
  - `[low]` `[reject]` Blind: consumed refresh rows kept 90 days, revoked grants never pruned — a few thousand rows per year in SQLite; 9.5 owns the grant list.
  - `[low]` `[reject]` Blind: previous access token stays valid ≤ 1 h after rotation — standard OAuth behaviour; short-lived by design.
  - `[low]` `[reject]` Blind: no `Origin` check on `/api/mcp` — DNS rebinding cannot supply the bearer token; every call needs a valid access token.
  - `[low]` `[reject]` Blind: consent-page login redirect lacks `expired=1` and stale-cookie deletion — only the hint text differs; login still works and returns.
  - `[low]` `[reject]` Blind: `get_watchlist`/`entryById` build every list via `watchlistView` — a handful of lists; a single-list view adds a new service API.
  - `[low]` `[patch]` Blind: long client name overflows the consent card — `overflowWrap: "anywhere"` added to the name line.
  - `[medium]` `[patch]` Edge: chunked MCP POST bypasses the 1 MiB limit — same root cause as Blind rows 1–2; fixed there.
  - `[low]` `[reject]` Edge: DB error in register/token gives Next's generic 500 without `no-store` — rare SQLite failure; no token in the body; fix adds try/catch branches.
  - `[medium]` `[patch]` Edge: clients with only revoked grants are never cleaned up, so after 200 connections registration fails for good — cleanup now deletes 24 h-old clients without a non-revoked grant; test added.
  - `[low]` `[reject]` Edge: count/create race can exceed `MAX_CLIENTS` — single user; the cap is a soft safeguard.
  - `[low]` `[reject]` Edge: client deleted between consent render and Erlauben throws — only when a restore runs mid-consent; the user retries the connection.
  - `[low]` `[reject]` Edge: user-provided name > 100 silently truncated — the spec mandates truncation to 100 for the ISIN path.
  - `[low]` `[patch]` Edge: non-Basic `Authorization` header on the token endpoint → `invalid_client` — only `Basic` scheme is now treated as client credentials; test added.
  - `[low]` `[reject]` Edge: update with the current `watchlist_id` schedules a backfill — the backfill only fetches what is missing; harmless.
  - `[low]` `[patch]` Verification gap: move/note-only backfill flags not asserted — assertions added in `http.test.ts`.
  - `[low]` `[patch]` Verification gap: `/securities` revalidation not asserted — assertion added in `route.test.ts`.
  - `[low]` `[patch]` Verification gap: over-long authorize request guard untested — case added in `page.test.tsx`.
  - `[low]` `[patch]` Verification gap: body-size limits untested — token, registration and MCP (with and without `content-length`) cases added.
  - `[medium]` `[patch]` Verification gap (other): chunked MCP body bypasses the cap — same root cause as Blind rows 1–2; fixed there.
  - `[low]` `[reject]` Intent: real Claude clients over public HTTPS are not exercised — human-only; recorded in `operator_actions`.
  - `[low]` `[reject]` Intent: proxy and route composition not tested in one request — matcher tested with `unstable_doesMiddlewareMatch`, handlers tested directly; Next wires them unchanged.
  - `[low]` `[reject]` Intent: login round trip tested as two unit checks — redirect target and the 4096 `next` limit are both tested; the login page already honours `next` (story 1.2 tests).
  - `[false]` `[reject]` Intent: "via Claude" rendering only covered by earlier stories — the UI was built in 9.1/9.2 with DOM tests; this story supplies the data, which is tested.
  - `[false]` `[reject]` Intent: process state (commit, `awaiting-operator`, `operator_actions`) missing — the diff was taken before finalize; finalize sets them.
  - `[low]` `[reject]` Intent: production `APP_URL` not set — outside the repo; recorded in `operator_actions`.

## Design Notes

Codes live in `OAuthToken` (kind CODE) with client, scope, challenge and redirect URI, so a grant exists only once a code is exchanged — 9.5 lists only real connections. Reuse detection keeps consumed rows until they expire: a consumed CODE row points at the grant it created, a consumed REFRESH row at its grant. Validation stays in the services: tools pass raw arguments and map reasons to messages, so the app and Claude refuse the same inputs. Operator-only parts (setting `APP_URL` on the server, connecting real Claude clients) are recorded as `operator_actions` at finalize.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for Roboto).
- `DATABASE_URL=file:<scratch>/t.db npx prisma migrate deploy` -- expected: new migration applies cleanly.

## Auto Run Result

Status: awaiting-operator

**Summary:** Story 9.4 implemented as far as an agent can take it. A new `mcp` module serves an OAuth 2.1 authorization server (RFC 9728/8414 metadata, RFC 7591 registration, PKCE S256 only, exact redirect URIs, consent page "„<Client-Name>“ möchte deine Watchlists lesen und ändern" behind the existing login, opaque SHA-256-hashed codes/tokens, single-use 10-minute codes, 1 h access tokens, rotating 90-day refresh tokens whose reuse revokes the grant) and a stateless Streamable-HTTP endpoint `/api/mcp` with the nine watchlist tools as thin adapters over the `watchlist`/`ledger`/`prices` services. MCP entries record source `MCP` and the client name ("via Claude"); an unknown ISIN is resolved through OpenFIGI. The proxy lets exactly the seven OAuth/MCP paths through; restore clears all OAuth data; without `APP_URL` every OAuth/MCP route answers 503. README gains "Claude verbinden"; `APP_URL` is in `.env.example`. What remains needs a human: set `APP_URL` on the server and connect real Claude clients (see `operator_actions`).

**Files changed:**
- `package.json`, `package-lock.json` — `@modelcontextprotocol/sdk` 1.32.1 (exact).
- `prisma/schema.prisma`, `prisma/migrations/20261102000000_add_oauth/` — OAuthClient, OAuthGrant, OAuthToken.
- `src/modules/mcp/*` — config, crypto, clients, authorize, tokens, metadata, http, server, tools, backup (+ tests).
- `src/app/.well-known/oauth-*/…/route.ts`, `src/app/oauth/{register,token}/route.ts`, `src/app/api/mcp/route.ts` (+ test) — thin handlers.
- `src/app/oauth/authorize/{page.tsx,ConsentForm.tsx,actions.ts,messages.ts}` (+ test) — consent page and decision action.
- `src/modules/watchlist/entries.ts`, `index.ts` — `origin` on `addWatchlistEntry`.
- `src/modules/ledger/securities.ts`, `index.ts` — `findSecurity`.
- `src/modules/prices/providers/openfigi.ts`, `isin-details.ts`, `index.ts` — `lookupIsinDetails`.
- `src/proxy.ts`, `src/app/login/actions.ts`, `src/modules/backup/restore.ts`, `next.config.ts` — exact public paths, longer `next`, `clearOAuth` in restore, anti-framing headers for `/oauth/*`.
- `.env.example`, `README.md` — `APP_URL`, "Claude verbinden".

**Review:** 35 findings (high 0, medium 5, low 27, false 3). Patches: 2 medium entries (body limits enforced by streaming on the public endpoints and `/api/mcp`; cleanup of clients without a live grant) and 8 low (dead reason mapping, messages from constants, consent name wrap, Basic-only client auth header, four test gaps). Deferred: none. Rejected: 25 — each reason is in the Review Triage Log.

**Follow-up review recommended:** true — two medium entries were patched (counts: high 0, medium 2, low 8). Unverified risk: the streamed `readBody` and the rebuilt `Request` handed to the SDK transport (copied headers such as `content-length`/`transfer-encoding`) are tested in vitest only, not under the real Next.js runtime with a real Claude client.

**Verification:** `npx prisma generate` ✓, `npm run lint` ✓, `npm run typecheck` ✓, `npm test` ✓ (247 files, 3368 tests), `npm run build` ✓ (routes `/.well-known/oauth-*`, `/oauth/*`, `/api/mcp` built), `prisma migrate deploy` on a scratch DB ✓. The implementer also ran `next start` against a scratch DB and checked metadata, 401 + `WWW-Authenticate`, frame headers, registration, the login redirect, the consent card and guarded routes. Matrix audit: every I/O row covered by a passing test.

**Residual risks:** Not tested with real Claude Desktop/claude.ai/iOS/Claude Code clients (operator actions). The external redirect after "Erlauben" via a server action is unit-tested, not checked in a browser. Without `APP_URL` the consent page shows an error card with HTTP 200 (pages cannot answer 503). Public registration can be exhausted by 200 anonymous requests for 24 h. The MCP SDK is now part of the restore server bundle.

