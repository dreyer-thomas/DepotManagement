---
title: 'Portfolio read permission (story 10.1)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: 'cc06b893f62a174ddec8614489f57398ff04cc72'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Re-authorizing a still-connected client creates a second active grant, so after "Depotzugriff entfernen" and reconnecting, Settings shows two cards for the same app.
    evidence: |-
      exchangeCode (src/modules/mcp/tokens.ts) always creates a new OAuthGrant and never revokes the client's older active grants; pre-existing since story 9.4/9.5, now more likely because the removal dialog tells the user to reconnect. Harmless (old card can be disconnected) but cluttered.
    location: >-
      src/modules/mcp/tokens.ts exchangeCode
    severity: low
---

<intent-contract>

## Intent

**Problem:** The MCP connector (Epic 9) accepts `portfolio:read` in an authorization request but silently drops it, so Tommy cannot decide per connection whether Claude may read his portfolio, and nothing can enforce that permission once Epic 10's read tools exist.

**Approach:** Make `portfolio:read` a real, opt-in grant scope: an unchecked-by-default checkbox on the consent page (only when requested), a per-grant "Depotzugriff entfernen" in Settings › Verbundene Apps that strips the scope without disconnecting, and a call-time scope gate for portfolio tools answering "Keine Berechtigung für Depotdaten". `list_depots` is added as the first gated tool so the gate is observable end-to-end through `/api/mcp`.

## Boundaries & Constraints

**Always:**
- `watchlist` is always granted on "Erlauben" (unchanged); `portfolio:read` only when the request named it AND the box was checked. A forged `portfolio_read` form field without the requested scope grants nothing extra.
- Effective scopes of an access token = token scopes ∩ current grant scopes, so removing `portfolio:read` takes effect on the very next MCP call (no 1 h tail of old access tokens). Refresh issues tokens with the current grant scope; a refresh asking for `portfolio:read` after removal is `invalid_scope` (existing subset check). Re-adding is only possible through a new consent (new grant).
- Portfolio tools are registered for every grant (so a client without the scope gets the specific error, not "unknown tool"); each checks `portfolio:read` at call time and, without it, returns `isError: true` with `{ "error": "portfolio-read-required", "message": "Keine Berechtigung für Depotdaten" }` and no data, without touching any service.
- Tools are thin adapters over exported module services (`listDepots` from `@/modules/ledger`); amounts are decimal strings, never JS numbers; read-only (`annotations.readOnlyHint: true`).
- Logs never contain tokens, codes or payload values. German UI text, English code.

**Never:**
- No other Epic 10.2 tools (`get_depot`, `list_positions`, …), no `held` flag on watchlist entries — that is story 10.2.
- No Prisma migration (scope stays the space-separated `OAuthGrant.scope` / `OAuthToken.scope` string).
- No UI to add `portfolio:read` to an existing grant.
- Do not touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Requested + checked | `scope=watchlist portfolio:read`, box checked, Erlauben | code/grant/tokens scope `watchlist portfolio:read`; token response `scope` same | — |
| Requested, unchecked | same request, box unchecked | scope `watchlist` | — |
| Not requested | `scope=watchlist` or absent | no checkbox rendered; forged `portfolio_read=on` → scope `watchlist` | — |
| Only `portfolio:read` requested | `scope=portfolio:read` | checkbox shown; `watchlist` always granted, plus `portfolio:read` if checked | — |
| Unknown scope | `scope=watchlist admin` | redirect `error=invalid_scope` (unchanged) | — |
| Tool without scope | grant `watchlist`, call `list_depots` | `isError`, message "Keine Berechtigung für Depotdaten", no depot data | — |
| Tool with scope | grant with `portfolio:read`, `list_depots` | `{ depots: [{ id, name, broker, archived, cash_balance }] }` in `listDepots` order, archived included | — |
| Remove access | active grant with `portfolio:read` | grant scope `watchlist`; same access token now gets the refusal; grant stays connected | — |
| Remove, already removed | active grant without `portfolio:read` | `{ ok: true, clientName }`, no write | — |
| Remove, unknown/revoked/malformed id | — | `{ ok: false, reason: "not-found" }`, no write | — |
| Remove without session | server action | `{ ok: false, reason: "unauthorized" }`, no write | — |

</intent-contract>

## Code Map

- `src/modules/mcp/authorize.ts` -- `SUPPORTED_SCOPES` (only `watchlist`, fed to discovery metadata), `grantedScope` (always returns `watchlist`), `AuthorizeRequest`, `validateAuthorizeRequest`, `approveAuthorization` (writes the CODE row with `request.scope`). Pivot of consent.
- `src/modules/mcp/tokens.ts:248` -- `verifyAccessToken` returns `scopes` from `row.scope` (token) only; needs intersection with `row.grant.scope` (already selected). `refresh` subset check and `issueTokenPair(grant.scope)` already use the grant scope.
- `src/modules/mcp/grants.ts` -- `listConnectedApps` (already maps `scopes`), `disconnectApp` pattern (validation of `grantId`, `inTransaction`) to copy for the new removal.
- `src/modules/mcp/tools.ts` -- `McpToolContext` (`scopes`), `result`/`refusal`/`guarded` helpers, `registerWatchlistTools` (scope-gated at registration). Portfolio tools go in a new `src/modules/mcp/portfolio-tools.ts` reusing the same payload style.
- `src/modules/mcp/server.ts` -- `createMcpServer` registers tools; `INSTRUCTIONS` text.
- `src/modules/mcp/metadata.ts` -- `scopes_supported` from `SUPPORTED_SCOPES`.
- `src/modules/mcp/index.ts` -- public exports (app layer may only import from here).
- `src/modules/ledger/depots.ts:222` -- `listDepots(db)` → `DepotSummary` (`id, name, broker, cashBalance, archived, …`), sorted by name de-DE; exported from `@/modules/ledger`.
- `src/app/oauth/authorize/page.tsx`, `ConsentForm.tsx`, `actions.ts` -- consent page, hidden params form, decision action calling `approveAuthorization(validation.request, config)`.
- `src/app/_actions/connected-apps.ts` -- session-checked server actions + `revalidatePath("/settings")`.
- `src/app/_components/connected-apps/ConnectedAppsList.tsx`, `labels.ts` -- per-grant card, single confirm dialog keyed by `Target`, toast; `SCOPE_LABELS` already has `"portfolio:read": "Depotdaten lesen (nur lesen)"`.
- Tests to extend: `src/modules/mcp/oauth.test.ts` (grantedScope / validate / consent / verifyAccessToken), `grants.test.ts`, `http.test.ts` (`connect()` helper hard-codes `scope: "watchlist"`; "lists exactly the nine tools"), `src/app/oauth/authorize/page.test.tsx`, `src/app/_actions/connected-apps.test.ts`, `src/app/_components/connected-apps/ConnectedAppsList.dom.test.tsx`, `labels.test.ts`.

## Tasks & Acceptance

**Execution:**
- `src/modules/mcp/authorize.ts` -- add `PORTFOLIO_READ_SCOPE` to `SUPPORTED_SCOPES`; add `portfolioReadRequested: boolean` to `AuthorizeRequest` (set when the requested scope names `portfolio:read`); `grantedScope` keeps returning the base `watchlist` (update its doc comment); `approveAuthorization(request, config, db?, now?, portfolioRead = false)` stores `watchlist portfolio:read` only when `portfolioRead && request.portfolioReadRequested`.
- `src/modules/mcp/tokens.ts` -- `verifyAccessToken` returns token scopes filtered to those still in the grant scope.
- `src/modules/mcp/grants.ts` -- add `removePortfolioAccess(grantId: unknown, db?)` → `{ ok: true; clientName } | { ok: false; reason: "not-found" }`: same id validation as `disconnectApp`; in one transaction sets the active grant's scope without `portfolio:read` and rewrites that grant's token rows' `scope` the same way; idempotent when the scope is already absent.
- `src/modules/mcp/portfolio-tools.ts` (new) -- `PORTFOLIO_TOOL_NAMES = ["list_depots"]`, `PORTFOLIO_READ_DENIED_MESSAGE`, `registerPortfolioTools(server, ctx)` with a call-time scope gate wrapper (also used by every 10.2 tool) and the `list_depots` tool (no arguments; snake_case payload `{ depots: [{ id, name, broker, archived, cash_balance }] }`).
- `src/modules/mcp/server.ts` -- register portfolio tools; extend `INSTRUCTIONS` with one sentence on portfolio tools needing the Depotdaten permission.
- `src/modules/mcp/index.ts` -- export `PORTFOLIO_READ_SCOPE`, `PORTFOLIO_TOOL_NAMES`, `removePortfolioAccess` and its result type.
- `src/app/oauth/authorize/page.tsx` + `ConsentForm.tsx` -- pass `offerPortfolioRead` (= `portfolioReadRequested`); render an unchecked MUI checkbox `name="portfolio_read"` labelled "Darf auch Depots, Bestände, Umsätze und Kennzahlen lesen (nur lesen)" only then.
- `src/app/oauth/authorize/actions.ts` -- pass `formData.get("portfolio_read") === "on"` to `approveAuthorization`.
- `src/app/_actions/connected-apps.ts` -- `removePortfolioAccessAction(grantId)`: session check, call service, revalidate `/settings`.
- `src/app/_components/connected-apps/labels.ts` + `ConnectedAppsList.tsx` -- on cards whose scopes include `portfolio:read`, an outlined "Depotzugriff entfernen" button (aria-label naming the client, 44 px) opening the shared dialog: title `Depotzugriff für „<Client>“ entfernen?`, text `„<Client>“ kann danach keine Depots, Bestände, Umsätze und Kennzahlen mehr lesen. Die Verbindung und die Watchlists bleiben bestehen; zum erneuten Freigeben die App neu verbinden.`, confirm button "Entfernen"; success toast `Depotzugriff für „<Client>“ entfernt.`; errors via existing `connectedAppsErrorMessage`.
- Tests -- cover every I/O-matrix row: module tests (`oauth.test.ts`, `grants.test.ts`), end-to-end through a real MCP client in `http.test.ts` (consent with/without checkbox → token → `list_depots` result or refusal; remove access → same token refused, watchlist tools still work, refresh with `scope=portfolio:read` → `invalid_scope`; tool list = nine watchlist tools + `list_depots`; discovery `scopes_supported` contains both), page/action tests for the checkbox and forged field, DOM test for the new button/dialog/toast, label tests.

**Acceptance Criteria:**
- Given an authorization request with `scope=watchlist portfolio:read` and a session, when the consent page renders, then it shows the checkbox "Darf auch Depots, Bestände, Umsätze und Kennzahlen lesen (nur lesen)" unchecked, and Erlauben without checking yields a grant with only `watchlist`.
- Given Settings › Verbundene Apps with a grant holding `portfolio:read`, when Tommy confirms "Depotzugriff entfernen", then the card stays listed showing only "Watchlists lesen und ändern", the button disappears, and Claude's next `list_depots` call with its existing token returns "Keine Berechtigung für Depotdaten".
- Given a connection without `portfolio:read`, when Claude calls `list_depots` via `/api/mcp`, then the result is an MCP tool error with message "Keine Berechtigung für Depotdaten" and contains no Depot data.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 16 findings — high 0, medium 0, low 10, false 6, maybe-false 0
- findings:
  - `[low]` `[defer]` Reconnecting after removing access leaves two active grants for the same client — pre-existing grant-per-consent behaviour from 9.4/9.5; deferred to the frontmatter list.
  - `[false]` `[reject]` Consent headline does not mention the portfolio request — EXPERIENCE.md specifies exactly this headline plus the checkbox; the diff matches the design.
  - `[false]` `[reject]` Clients never ask for portfolio:read (no scope hint in the 401 challenge) — `scopes_supported` in the protected-resource metadata now lists both scopes, which MCP clients use for scope selection when the challenge has none.
  - `[low]` `[reject]` `approveAuthorization` takes the consent flag as a fifth positional argument — readability only; an options-object refactor is more than a direct correction.
  - `[low]` `[patch]` `labels.ts` copies `PORTFOLIO_READ_SCOPE` unchecked and keys `SCOPE_LABELS` with a literal — key now uses the constant; test asserts equality with the mcp module's constant.
  - `[low]` `[patch]` No test shows the refusal never reaches the tool body — added `portfolio-tools.test.ts` with a spy body for `requirePortfolioRead`.
  - `[low]` `[reject]` `removePortfolioAccess` updates token rows one by one — a grant has a handful of rows; negligible, and the loop also handles tokens whose scope differs from the grant's.
  - `[low]` `[patch]` Server INSTRUCTIONS opening sentence only mentions watchlists — reworded to cover read-only portfolio access.
  - `[low]` `[patch]` "Entfernen" inline literal and hand-written reason union in ConnectedAppsList — moved to `REMOVE_PORTFOLIO_ACCESS_CONFIRM` in labels.ts; reason typed as `ConnectedAppsErrorReason`.
  - `[low]` `[reject]` DOM/action tests miss unauthorized/pending/revalidate-on-not-found for the remove action — same shared dialog/error path as the tested disconnect cases; unlikely to break unnoticed.
  - `[false]` `[reject]` (intent audit) Consent sentence unchanged — same refutation as the headline finding.
  - `[low]` `[reject]` (intent audit) No DOM test clicks the checkbox — a native checkbox submits "on"; the action is tested with that FormData value and the rendered input is asserted unchecked.
  - `[false]` `[reject]` (intent audit) Settings scope display for portfolio:read is not asserted — `labels.test.ts` covers `scopesText` with `portfolio:read` and the card renders `scopesText`.
  - `[low]` `[reject]` (intent audit) No test of a second consent restoring portfolio:read — the fresh-connect tests with the checkbox and the 9.5 reconnect test cover that path.
  - `[false]` `[reject]` (intent audit) Refusal is a tool-level `isError`, not a JSON-RPC error — tool errors are reported to the model via `isError` per the MCP spec, consistent with every existing refusal.
  - `[false]` `[reject]` (intent audit) `list_depots` is 10.2 scope creep — intentional (Design Notes) so the gate AC is observable at `/api/mcp`.

## Design Notes

`list_depots` lands here (not 10.2) solely so the gate's AC is observable at the `/api/mcp` surface; 10.2 adds its page-loader comparison test along with the other tools. Registering portfolio tools for every grant deliberately differs from the watchlist tools (registered only with scope): the AC requires the specific refusal, which an unregistered tool cannot produce.

Gate sketch:
```ts
function requirePortfolioRead<A>(ctx: McpToolContext, body: (args: A) => Promise<CallToolResult>) {
  return async (args: A) => ctx.scopes.includes(PORTFOLIO_READ_SCOPE) ? body(args) : denied();
}
```

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass

## Auto Run Result

Status: done

**Summary:** `portfolio:read` is now a real opt-in scope. The consent page shows an unchecked checkbox when the scope is requested; only a checked box grants it (`watchlist` is always granted; a forged field without the requested scope adds nothing). Settings › Verbundene Apps offers "Depotzugriff entfernen" per grant (confirm dialog, toast) that strips the scope without disconnecting; effective token scopes are intersected with the grant, so removal applies on the next MCP call and refresh cannot regain it. Portfolio tools are registered for every grant and gated at call time; `list_depots` is the first one and answers "Keine Berechtigung für Depotdaten" without the scope.

**Files changed:**
- `src/modules/mcp/authorize.ts` — `portfolio:read` supported, `portfolioReadRequested`, consent flag on `approveAuthorization`.
- `src/modules/mcp/tokens.ts` — `verifyAccessToken` returns token ∩ grant scopes.
- `src/modules/mcp/grants.ts` — `removePortfolioAccess`.
- `src/modules/mcp/portfolio-tools.ts` (new) — scope gate `requirePortfolioRead`, `list_depots`.
- `src/modules/mcp/tools.ts` — exports `result`, `guarded`, `Handler` for reuse.
- `src/modules/mcp/server.ts`, `index.ts` — register/export portfolio tools; instructions text.
- `src/app/oauth/authorize/page.tsx`, `ConsentForm.tsx`, `actions.ts` — checkbox and its decision.
- `src/app/_actions/connected-apps.ts` — `removePortfolioAccessAction`.
- `src/app/_components/connected-apps/ConnectedAppsList.tsx`, `labels.ts` — button, dialog, toast, texts.
- Tests: `oauth.test.ts`, `grants.test.ts`, `http.test.ts`, `portfolio-tools.test.ts` (new), `page.test.tsx`, `connected-apps.test.ts`, `ConnectedAppsList.dom.test.tsx`, `labels.test.ts`.

**Review findings:** 16 total — 4 patched (all low), 1 deferred (low, duplicate grants on reconnect), 11 rejected (6 false, 5 low not worth the complexity); reasons in the Review Triage Log.

**Follow-up review recommendation:** false — patched counts: high 0, medium 0, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (260 test files, 3569 tests) after the patches. Every I/O-matrix row is covered by a passing test.

**Residual risks:** Not checked in a real browser or against a live Claude client; reconnecting creates an additional grant (deferred).
