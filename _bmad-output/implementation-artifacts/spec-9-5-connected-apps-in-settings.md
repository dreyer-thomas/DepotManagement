---
title: 'Connected Apps in Settings (story 9-5)'
type: 'feature'
created: '2026-10-28'
status: awaiting-operator
baseline_revision: '8a5dfdc1e8a5e4c8fdea59d21035a8d044e62168'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
deferred: []
operator_actions:
  - "Deploy the build to the production server (no new migration) and open Einstellungen › Verbundene Apps; confirm the existing Claude connection(s) are listed with client name, redirect host, \"Watchlists lesen und ändern\", connected-since and last-used times."
  - "Click Trennen on the Claude connection, confirm the dialog, check the toast „Claude“ getrennt. and that the row disappears; then make Claude call a watchlist tool and confirm the call fails with an authorization error (401)."
  - "Reconnect the same Claude client (claude.ai/Desktop connector or /mcp in Claude Code) through login and Erlauben, confirm a tool call works again and the connection reappears in Verbundene Apps."
  - "Connect a second client (e.g. Claude Code), use Alle trennen, and confirm both clients lose access and the list shows the empty state with the connector URL."
---

<intent-contract>

## Intent

**Problem:** Story 9.4 lets Claude clients connect through OAuth, but Tommy cannot see which apps hold a grant or cut one off without editing the database.

**Approach:** A new "Verbundene Apps" section on the Settings page lists every non-revoked grant (via a new `mcp` read service) and offers "Trennen" per grant and "Alle trennen", both server actions calling the existing `revokeGrant` semantics (set `revokedAt`, delete all tokens).

## Boundaries & Constraints

**Always:**
- Section `<Box component="section" aria-labelledby="settings-connected-apps">` with h2 "Verbundene Apps" on `/settings`, placed after "Datensicherung".
- Lists only grants with `revokedAt = null`, newest `createdAt` first. Per grant: client name; redirect host(s) = distinct `host` (hostname + port if any) of the client's registered redirect URIs, joined ", "; scopes in plain German (`watchlist` → "Watchlists lesen und ändern"; `portfolio:read` → "Depotdaten lesen (nur lesen)"; unknown scope → shown verbatim), joined ", "; "Verbunden seit <formatDateTime(createdAt)>"; "Zuletzt verwendet <formatDateTime(lastUsedAt)>" or "Zuletzt verwendet: noch nie". `lastUsedAt` is the value 9.4 already throttles to once per minute — no new writes.
- Empty state (no active grant): text explaining that Claude connects via the custom connector URL `<APP_URL>/api/mcp` (or, when `APP_URL` is unset/invalid, a hint that `APP_URL` must be set first) and the Claude Code command `claude mcp add --transport http depotmanagement <APP_URL>/api/mcp`; login + "Erlauben" is all that's needed. "Alle trennen" is hidden in the empty state.
- "Trennen" opens a confirm dialog "„<Client-Name>“ trennen?" stating that Claude loses access immediately and must reconnect via login; confirm button "Trennen" (error colour), cancel "Abbrechen" focused. On success: toast "„<Client-Name>“ getrennt." and the list refreshes.
- "Alle trennen" opens a confirm dialog naming the count ("Alle <n> verbundenen Apps trennen?"); on success toast "Alle Apps getrennt." Revokes every non-revoked grant in one DB transaction.
- Server actions check `getSession()` first (`{ok:false, reason:"unauthorized"}` otherwise), validate the grant id (string, existing, not already revoked → `{ok:false, reason:"not-found"}` with message "Diese Verbindung besteht nicht mehr."), then `revalidatePath("/settings")`.
- After revocation the next `/api/mcp` call with that grant's access token gets 401, and its refresh token gets `invalid_grant` (tokens are deleted).
- A revoked client can reconnect: the normal `/oauth/authorize` → consent → token flow with the same registered client creates a new grant that works and is listed.
- Dialogs follow `WatchlistDialogs.tsx` (full-screen below `sm`, 44 px touch targets); toast via MUI `Snackbar` + `Alert` like `PriceRefreshButton.tsx`. UI text German.

**Never:**
- No `portfolio:read` removal UI or scope editing (Story 10.1); no client deletion (registration cleanup stays in 9.4); no listing of revoked grants or pending codes.
- No new tables, columns or migrations; no token/hash values in props, logs or payloads; `src/app` never touches `prisma.oAuth*` directly — only `mcp` services.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | 2 active + 1 revoked grant | 2 rows, newest first, German scopes, dates, hosts | — |
| Never used | `lastUsedAt` null | "Zuletzt verwendet: noch nie" | — |
| Empty | no active grant | explanatory empty state, no "Alle trennen" | — |
| Trennen | active grant | grant revoked, tokens gone, next MCP call 401, toast | — |
| Trennen stale | already revoked / unknown id | `not-found`, dialog shows message | no write |
| Alle trennen | 3 active grants | all revoked, all tokens gone | — |
| No session | action without session | `unauthorized` | no write |
| Reconnect | revoked client re-authorizes | new grant, MCP call succeeds | — |

</intent-contract>

## Code Map

- `src/modules/mcp/tokens.ts:36` `revokeGrant(grantId, db, now)` -- reuse; `inTransaction` (line 43) for "Alle trennen". `verifyAccessToken` returns null for revoked grants (MCP 401 path already exists).
- `src/modules/mcp/clients.ts` -- `McpDb` type, `RegisteredClient.redirectUris` stored as JSON text in `OAuthClient.redirectUris`; reuse its parse helper if exported, else parse defensively.
- `src/modules/mcp/index.ts` -- export new services `listConnectedApps`, `disconnectApp`, `disconnectAllApps` (+ types).
- `src/modules/mcp/config.ts` -- `readMcpConfig` for `APP_URL`/resource in the empty state.
- `prisma/schema.prisma:474-540` -- OAuthClient/OAuthGrant/OAuthToken (read-only reference).
- `src/modules/mcp/oauth.test.ts` -- existing helpers for register → authorize → token flow; reuse for revoke/reconnect tests.
- `src/app/(app)/settings/page.tsx` + `page.test.tsx` -- add the section; test pattern `findSection(node, "settings-…")` with migrated DB singleton.
- `src/app/_actions/watchlists.ts` -- server action pattern (`UNAUTHORIZED`, `getSession`, `revalidatePath`).
- `src/app/_components/watchlists/WatchlistDialogs.tsx:36-80,203-270` -- `useDialog`, dialog shell, delete-confirm form pattern; `src/app/_components/securities/PriceRefreshButton.tsx:64` -- Snackbar toast.
- `src/core/format.ts:101` `formatDateTime` (UTC ISO → "dd.mm.yyyy, hh:mm" Berlin).
- `README.md:171` "Claude verbinden" -- add a sentence on Settings › Verbundene Apps (Trennen, reconnect).

## Tasks & Acceptance

**Execution:**
- `src/modules/mcp/grants.ts` -- `listConnectedApps(db?)` → `[{grantId, clientName, redirectHosts: string[], scopes: string[], createdAt, lastUsedAt}]`; `disconnectApp(grantId, db?, now?)` → `{ok:true, clientName}` | `{ok:false, reason:"not-found"}`; `disconnectAllApps(db?, now?)` → `{ok:true, count}` in one transaction via `revokeGrant`. Export from `index.ts`.
- `src/modules/mcp/grants.test.ts` -- list filter/order/hosts, disconnect + `verifyAccessToken` null + refresh `invalid_grant`, stale id, disconnect all, reconnect via full authorize/token flow with the same client.
- `src/app/_actions/connected-apps.ts` (+ `.test.ts`) -- `disconnectAppAction`, `disconnectAllAppsAction` per Always.
- `src/app/_components/connected-apps/` -- `labels.ts` (scope labels, dialog/toast texts; + `labels.test.ts`), `ConnectedAppsList.tsx` (client: rows, Trennen/Alle trennen dialogs, toast; + `.dom.test.tsx`).
- `src/app/(app)/settings/page.tsx` + `page.test.tsx` -- section with list or empty state (with/without `APP_URL`).
- `README.md` -- Verbundene Apps note under "Claude verbinden".

**Acceptance Criteria:**
- Given an active grant used via MCP, when Tommy opens Settings, then the row shows client name, redirect host, "Watchlists lesen und ändern", connected-since and last-used times.
- Given that grant, when Tommy confirms "Trennen", then the toast "„<Client-Name>“ getrennt." appears, the row disappears, and a following `/api/mcp` request with its old access token returns 401.
- Given a disconnected client, when it runs authorize → Erlauben → token exchange again, then a new grant is listed and its MCP call succeeds.
- Given the full suite, when running `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 21 findings — high 0, medium 1, low 17, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: "Alle trennen" dialog count comes from the rendered list and the toast ignores the returned `count` — only differs when a grant is created between page load and click; the spec-mandated toast "Alle Apps getrennt." stays true (no active grant remains).
  - `[low]` `[reject]` Blind: grants with the same client name share aria-label, dialog title and toast — each card also shows host and connected-since; telling them apart in labels adds parameters for a rare case.
  - `[low]` `[reject]` Blind: an unexchanged code from a consent seconds before "Alle trennen" still yields a grant — needs Erlauben and Alle trennen within the 10-minute code window by the same user; codes are not connections (spec lists grants only).
  - `[low]` `[patch]` Blind: dialog `unauthorized` and thrown-action paths untested — DOM cases added (session message / generic failure, dialog stays open, no toast); label test for `unauthorized`.
  - `[low]` `[reject]` Blind: after `not-found` the dialog stays open with Trennen enabled — a repeat click only repeats the message; fixing adds dialog state.
  - `[low]` `[reject]` Blind: `disconnectAllApps` runs two statements per grant — a handful of grants per user; restructuring revocation duplicates `revokeGrant` semantics.
  - `[low]` `[patch]` Blind: `ACTION_FAILED_MESSAGE` imported from the securities feature labels — now defined in `connected-apps/labels.ts`.
  - `[low]` `[reject]` Blind: `ConnectedAppsErrorReason` hand-written instead of derived — typecheck flags any new reason at the call site; no divergence possible silently.
  - `[false]` `[reject]` Blind: Cancel focused twice (autoFocus + onEntered) — same pattern as `WatchlistDialogs.tsx`; focusing the same element twice has no observable effect.
  - `[low]` `[reject]` Blind: no spinner while disconnecting — buttons are disabled, matching the other confirm dialogs; revocation is a few SQLite statements.
  - `[false]` `[reject]` Blind: page tests leave `APP_URL` changed — `beforeEach` deletes it in that file and vitest isolates env per test file (default `isolate`, no override in `vitest.config.ts`).
  - `[low]` `[reject]` Blind: README does not explain duplicate rows or "noch nie" — the UI text is self-explanatory; README states reconnect appears as a new connection.
  - `[low]` `[reject]` Edge: "Alle trennen" on a stale page with count 0 still toasts success — same as Blind row 1; no active grant remains, so the toast is true.
  - `[low]` `[reject]` Edge: stale dialog count vs revoked count — same root cause as Blind row 1.
  - `[false]` `[reject]` Edge: `formatDateTime` throws on non-ISO stored grant timestamps — grant `createdAt`/`lastUsedAt` are only written via `Date#toISOString()` in `tokens.ts`; OAuth rows are never restored or imported.
  - `[low]` `[patch]` Verification gap: toast surviving the re-render to an empty list untested — rerender-to-empty case added to `ConnectedAppsList.dom.test.tsx`.
  - `[low]` `[patch]` Verification gap: revalidation on `not-found` not asserted — assertion added to the not-found action test.
  - `[low]` `[patch]` Verification gap: unauthorized/thrown dialog paths — same root cause as Blind row 4; fixed there.
  - `[low]` `[reject]` Verification gap: all-or-nothing rollback of "Alle trennen" untested — needs fault injection the repo does not use; single-user SQLite makes a mid-loop failure unlikely.
  - `[medium]` `[reject]` Intent: real-Claude checks (401 after Trennen, reconnect through login/consent on the deployed instance) are human-only, as epic context states for 9.4/9.5 — no code fix; recorded as `operator_actions` at finalize with `status: awaiting-operator`.
  - `[low]` `[reject]` Intent: click → real action → revalidate → row gone not exercised as one browser flow — component (mocked action) and action (real DB) are tested separately, as everywhere in the repo; the browser check is in `operator_actions`.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for Roboto).

## Auto Run Result

Status: awaiting-operator

**Summary:** Settings gains a "Verbundene Apps" section after "Datensicherung". It lists every non-revoked OAuth grant (newest first) with client name, redirect host(s), scopes in plain German, "Verbunden seit …" and "Zuletzt verwendet …"/"noch nie". "Trennen" (confirm naming the client) and "Alle trennen" (confirm with count) are session-checked server actions over new `mcp` services that reuse `revokeGrant`, so the grant is revoked and all its tokens deleted at once: the next `/api/mcp` call gets 401 and the refresh token `invalid_grant`. A revoked client reconnects through the normal authorize/consent/token flow as a new grant. The empty state shows the connector URL and the Claude Code command, or asks to set `APP_URL` first. What remains needs a human: checking the flow with real Claude clients on the deployed instance (see `operator_actions`).

**Files changed:**
- `src/modules/mcp/grants.ts` (+ test), `index.ts`, `clients.ts` — `listConnectedApps`, `disconnectApp`, `disconnectAllApps`; `parseJsonArray` exported.
- `src/modules/mcp/http.test.ts` — 401 after disconnect / Alle trennen and reconnect through the HTTP handlers.
- `src/app/_actions/connected-apps.ts` (+ test) — `disconnectAppAction`, `disconnectAllAppsAction`.
- `src/app/_components/connected-apps/{ConnectedAppsList.tsx,ConnectedAppsEmpty.tsx,labels.ts}` (+ DOM and label tests) — cards, confirm dialogs, toast, empty state, German texts.
- `src/app/(app)/settings/page.tsx` (+ test) — the new section.
- `README.md` — Verbundene Apps under "Claude verbinden".

**Review:** 21 findings (high 0, medium 1, low 17, false 3). Patches: 4 low entries (three test gaps — toast after re-render to empty, revalidation on not-found, unauthorized/thrown dialog paths — and the failure message moved into `connected-apps/labels.ts`). Deferred: none. Rejected: 16 — each reason is in the Review Triage Log; the one medium (real-client checks are human-only) is recorded as `operator_actions`.

**Follow-up review recommended:** false — only low entries were patched (counts: high 0, medium 0, low 4).

**Verification:** `npm run lint` ✓, `npm run typecheck` ✓, `npm test` ✓ (251 files, 3397 tests), `npm run build` ✓ — run after the patches. Matrix audit: every I/O row is covered by a passing test (`grants.test.ts`, `connected-apps.test.ts`, `ConnectedAppsList.dom.test.tsx`, `labels.test.ts`, `page.test.tsx`, `http.test.ts`).

**Residual risks:** Not exercised in a browser or with real Claude clients (operator actions). How a real client behaves after its refresh token is refused (re-running authorization vs. needing a manual reconnect) is not observable in-repo. Pending authorization codes are not cancelled by "Alle trennen". `sprint-status.yaml` untouched (orchestrator-owned).
