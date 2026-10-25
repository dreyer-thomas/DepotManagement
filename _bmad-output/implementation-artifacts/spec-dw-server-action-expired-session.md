---
title: 'Server action requests without a valid session navigate to login'
type: 'bugfix'
created: '2026-10-25'
status: 'done'
baseline_revision: '7600df0233f482d40843a9549b990b593c984a70'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `src/proxy.ts` answers every unauthenticated non-`/api` request with a 307 to `/login`, including server action POSTs (`Next-Action` header). The Next 16.4.2 client action fetch (`fetchServerAction` in `next/dist/client/components/router-reducer/reducers/server-action-reducer.js`) uses `fetch` with default `redirect: 'follow'`, so a 307 re-POSTs the action to `/login`; the action (e.g. "Abmelden" in `src/app/_actions/logout.ts`) is not registered on `/login`, so the client gets an "action not found"/"unexpected response" error instead of the login page.

**Approach:** For requests carrying a `Next-Action` header, the proxy answers with status 200, an empty body and an `x-action-redirect: <same-origin /login?next=…[&expired=1]>;replace` header — the same contract Next uses for redirects thrown inside actions. Without RSC content the client treats it as a redirect without flight data and performs a hard navigation to the login URL. Cookie deletion and the `next`/`expired` parameters stay identical to the page-request branch.

## Boundaries & Constraints

**Always:** Keep the `/api` 401 JSON branch and the plain page 307 branch unchanged. The login target (`next` = pathname + search of the request, `expired=1` when a cookie was present) and the session-cookie deletion are computed once and shared by both branches. The `x-action-redirect` location is a same-origin relative path (`/login?…`).

**Never:** No change to the matcher, the session/auth modules, the login page, or Next internals. No handling of no-JS progressive-enhancement form posts (they carry no `Next-Action` header; out of scope). No live browser automation dependency in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Action, no cookie | POST `/depots?x=1`, `Next-Action: abc`, no session cookie | 200, `x-action-redirect: /login?next=%2Fdepots%3Fx%3D1;replace`, no `location`, no set-cookie | client hard-navigates to login |
| Action, expired cookie | POST `/`, `Next-Action`, expired token | 200, `x-action-redirect: /login?next=%2F&expired=1;replace`, session cookie deleted | client hard-navigates to login with expiry notice |
| Action, valid session | POST with `Next-Action` and valid token | passes through (`x-middleware-next: 1`) | No error expected |
| Page request, no session | GET `/depots` without `Next-Action` | unchanged 307 to `/login?next=…` | unchanged |

</intent-contract>

## Code Map

- `src/proxy.ts:25-34` -- page branch building `loginUrl` and the 307; add the `next-action` header branch here, reuse the same `loginUrl` and cookie deletion.
- `src/proxy.test.ts` -- existing `request()` helper builds GET `NextRequest`s with an optional cookie; extend it (method/extra headers) and add action cases.
- `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:107-137,184-190,269-274` -- read-only evidence: non-RSC response with `x-action-redirect` is accepted; no flight data + redirect location → `completeHardNavigation`.
- `node_modules/next/dist/client/components/app-router-headers.js:96` -- `ACTION_HEADER = 'next-action'`.
- `node_modules/next/dist/server/app-render/action-handler.js:267` -- Next's own `x-action-redirect: <url>;<type>` format.
- `src/app/_actions/logout.ts` -- the "Abmelden" action from the deferred entry (not on `/login`).

## Tasks & Acceptance

**Execution:**
- `src/proxy.ts` -- when the request has a `next-action` header and no valid session (non-`/api`), return `new NextResponse(null, { status: 200, headers: { "x-action-redirect": `${loginUrl.pathname}${loginUrl.search};replace` } })`, deleting the session cookie when one was sent; keep a short comment explaining why a 307 fails for actions -- client fetch follows 3xx as a re-POST.
- `src/proxy.test.ts` -- add tests for the three action rows of the matrix (no cookie, expired cookie with cookie deletion, valid session pass-through) -- covers the deferred-work requirement for a Next-Action proxy test.

**Acceptance Criteria:**
- Given the 7-day session has expired, when the user clicks "Abmelden" (or any server action) in the app, then the proxy response carries no `location` header and an `x-action-redirect` to `/login?next=<current path>&expired=1` that the Next 16 client follows as a navigation.
- Given an unauthenticated plain page request, when it hits the proxy, then the existing 307 behaviour and tests remain unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 11 findings — high 0, medium 0, low 5, false 6, maybe-false 0
- findings:
  - `[false]` `[reject]` (blind) Client navigation never checked end to end — refuted: headless Chrome against `next start` (scratch Playwright script, not committed): login, replace `dm_session` with a bogus token, click "Abmelden" → lands on `/login?next=%2F&expired=1` with "Sitzung abgelaufen"; baseline build of the old proxy shows Next's "This page couldn't load" and "An unexpected response was received from the server."
  - `[low]` `[patch]` (blind) Action detection by header alone; a GET with a stray `next-action` header gets an empty 200 — fixed: condition now `request.method === "POST" && …`, plus test that such a GET still gets the 307.
  - `[low]` `[reject]` (blind) Missing action tests for tampered cookie, invalid auth config, `/api` with `next-action`, special characters — the action branch reuses the same `loginUrl`/cookie code already covered by page-branch tests and `/api` returns before it; extra tests guard no demonstrated defect.
  - `[false]` `[reject]` (blind) Spec does not close DW-1 in the ledger — the intent forbids editing the ledger; the orchestrator records resolution.
  - `[false]` `[reject]` (blind) RSC navigation/prefetch GETs also get the 307 — Next's `fetch-server-response.js:139-144` treats a non-flight response as an MPA navigation to the final URL, so they reach `/login`; pre-existing and working.
  - `[false]` `[reject]` (blind) Synthesized 200 lacks `Cache-Control: no-store` — it answers a POST, which HTTP caches do not store without explicit freshness; no cache path shown.
  - `[low]` `[reject]` (blind) Reliance on an internal Next header contract and version-specific line refs — real upgrade risk but only cosmetic to fix here; recorded as residual risk.
  - `[false]` `[reject]` (blind) `replace` vs `push` unjustified — deliberate, documented in Design Notes; matches the history effect of the page-branch HTTP redirect; no defect.
  - `[low]` `[reject]` (edge) Client try/catch around actions (`ParqetMigrationWizard.tsx:363,397`) may briefly set the failure message before the hard navigation — only on session expiry, page unloads immediately (before the fix the error stayed); fix needs `isRedirectError` guards in several components.
  - `[low]` `[patch]` (edge) GET with crafted `next-action` header gets empty 200 — same root cause and fix as the blind POST-method finding.
  - `[false]` `[reject]` (intent) Navigation outcome only inferred from source; `expired=1` reading ambiguity — navigation now observed in a browser before/after; `expired=1` follows the existing cookie-present rule, which matches the expired-session scenario named in the intent.

## Design Notes

Status 200 rather than 303: a 303 would be followed by `fetch` as a GET to `/login`, returning HTML, which the client rejects as "An unexpected response was received from the server." `replace` keeps the stale page out of history, matching the HTTP redirect behaviour of the page branch.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test` -- expected: all pass, including new proxy action tests.
- `npm run build` -- expected: success.

## Auto Run Result

Status: done

**Summary:** For unauthenticated server action requests (POST with `Next-Action`), `src/proxy.ts` now answers 200 with an empty body and `x-action-redirect: /login?next=…[&expired=1];replace` instead of a 307; the Next 16 client hard-navigates to the login page. Page, `/api` and pass-through behaviour are unchanged.

**Files changed:**
- `src/proxy.ts` — action-redirect branch for POST + `next-action`, sharing the login URL and cookie deletion.
- `src/proxy.test.ts` — request helper takes method/headers; tests for action without session, with expired cookie, with valid session, and GET with a stray `next-action` header.
- `_bmad-output/implementation-artifacts/spec-dw-server-action-expired-session.md` — this spec.

**Review findings:** 11 findings; 2 patched (both `low`, one root cause: POST-method check); 0 deferred; 9 rejected (6 false, 3 low) with reasons in the Review Triage Log. Patched by verdict: high 0, medium 0, low 2. Follow-up review recommended: false.

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (67 files, 1103 tests) and `npm run build` all pass. Real browser check (headless Chrome via a scratch Playwright script against `next start` with a temp DB and synthetic credentials): with the fix, "Abmelden" after invalidating the session cookie lands on `/login?next=%2F&expired=1` showing "Sitzung abgelaufen. Bitte erneut anmelden."; with the baseline proxy the same steps end on Next's error page with "An unexpected response was received from the server.", confirming DW-1 was a real bug. `curl` POST with `Next-Action` against `next start` returns 200 with the expected `x-action-redirect`.

**Residual risks:** The fix relies on Next's internal `x-action-redirect` contract (checked against Next 16.4.2); a Next upgrade could change it without a unit test noticing. Client components that wrap actions in a catch-all `try/catch` may flash their failure message for a moment before the hard navigation.
