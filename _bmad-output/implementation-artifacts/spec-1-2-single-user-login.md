---
title: 'Story 1.2: Single-User Login'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '1a3db97a7f7f61d81a48a71565a966fca9242ee3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A server action POST without a valid session (e.g. "Abmelden" after the 7-day session expired) gets a 307 to /login from the proxy, which the client-side action fetch may not handle as a navigation.
    evidence: |-
      Verified: POST /depots with a Next-Action header and no cookie returns 307 to /login?next=%2Fdepots (next start).
      Unverified: what the Next 16 client does with that 307 for a server action. Settle by letting the session expire in a browser, clicking "Abmelden" (or any later action), and observing whether the login page appears or an "unexpected response" error is thrown; if broken, answer action requests (Next-Action header) with a response the client can follow, plus a test.
    location: >-
      src/proxy.ts:28
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Every page of the app is reachable without authentication, so once it is exposed over the network anyone can read the (future) financial data.

**Approach:** Add an `auth` module (env config validation, bcrypt credential check, `jose`-signed session cookie), a Next.js 16 `src/proxy.ts` that guards every path except the login page and static assets, a German login page with return-URL handling, a logout action in the shell, a startup check in `src/instrumentation.ts` that stops the app when auth variables are missing or invalid, and a password-hash script documented in the README.

## Boundaries & Constraints

**Always:**
- Add exact pins `jose@6.2.13` and `bcrypt@6.0.0` (dependencies); add `"bcrypt"` to `serverExternalPackages`.
- Config from env only: `AUTH_USERNAME` (non-empty), `AUTH_PASSWORD_HASH` (bcrypt format `$2a|$2b|$2y$NN$` + 53 chars), `SESSION_SECRET` (≥ 32 chars). Empty counts as missing. Error messages name the offending variables, never their values.
- Session cookie `dm_session`: HS256 JWT via `jose` with `sub` = username, `iat`, `exp` = now + 7 days (fixed, never extended); cookie `httpOnly`, `sameSite: "lax"`, `path: "/"`, `maxAge` = 7 days, `secure` only when the request is HTTPS (first value of `x-forwarded-proto` is `https`).
- A token is valid only if signature, `exp` and `sub === AUTH_USERNAME` all check out.
- Credential check always runs `bcrypt.compare` (also for a wrong username) and compares usernames with `crypto.timingSafeEqual` on equal-length buffers, so failures do not reveal which field was wrong.
- Unauthenticated request: paths under `/api/` get `401` JSON `{"error":"unauthorized"}`; every other path gets a redirect to `/login?next=<original path + query>`. If a `dm_session` cookie was present but invalid/expired, the redirect also carries `expired=1` and deletes the cookie.
- Return URL is sanitized: only a value starting with a single `/` (not `//`, not `/\`) and not pointing at `/login` is honored; anything else falls back to `/`.
- Protected-shell pages move into route group `src/app/(app)/` (URLs unchanged); the login page renders without the navigation shell but inside the root theme providers.
- UI text German: title "Anmelden", fields "Benutzername" / "Passwort", button "Anmelden", error Alert "Anmeldung fehlgeschlagen.", expired info "Sitzung abgelaufen. Bitte erneut anmelden.", logout "Abmelden". Enter submits; ≥ 44 px targets; form keeps the username on error, clears the password.
- Never log credentials, hashes, the secret or tokens.

**Never:**
- No rate limiting, multi-user, password change UI, remember-me, or sliding session refresh.
- No Prisma model or DB access for auth (the session lives only in the cookie).
- No edits to `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- No real credentials or hashes of real passwords in the repo; tests generate their own hash with low cost.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No session, page | `GET /depots?x=1`, no cookie | 307 → `/login?next=%2Fdepots%3Fx%3D1` | — |
| No session, route handler | `GET /api/anything`, no cookie | 401 `{"error":"unauthorized"}` | — |
| Expired / tampered cookie | `GET /`, cookie with past `exp` or bad signature | 307 → `/login?next=%2F&expired=1`, cookie deleted | — |
| Valid session | `GET /depots` with valid cookie | passes through (200) | — |
| Public paths | `/login`, `/_next/static/*`, `/_next/image*`, `/favicon.ico` | not guarded | — |
| Login success | correct username + password, `next=/depots` | cookie set, redirect to `/depots` | — |
| Login wrong field | wrong username OR wrong password | same page, Alert "Anmeldung fehlgeschlagen.", no cookie | identical response for both |
| Unsafe return URL | `next=//evil.com`, `/\evil.com`, `https://evil.com`, `/login` | after login redirect to `/` | — |
| Login while logged in | `GET /login` with valid cookie | redirect to sanitized `next` or `/` | — |
| Logout | "Abmelden" in shell | cookie deleted, redirect to `/login` | — |
| Missing config | `SESSION_SECRET` empty at startup | process exits non-zero, stderr names `SESSION_SECRET` and points to README | — |
| Invalid config | `AUTH_PASSWORD_HASH=abc`, secret of 10 chars | startup error names both variables with the rule broken | — |

</intent-contract>

## Code Map

- `src/app/layout.tsx` -- root layout with theme providers and `<AppShell>`; move `AppShell` out into `(app)/layout.tsx`.
- `src/app/page.tsx`, `src/app/{depots,import,news,securities,settings,more}/page.tsx` -- move unchanged into `src/app/(app)/` (git mv); URLs stay the same.
- `src/app/_components/AppShell.tsx` -- client component with AppBar + `ColorModeToggle`; add an "Abmelden" control (form posting the logout server action) next to the toggle.
- `src/app/_components/navigation.ts` (+ test) -- nav paths only; unaffected by the route group.
- `next.config.ts` -- `serverExternalPackages` list; add `"bcrypt"`.
- `.env.example` -- already lists `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`; extend comments (secret length, generate via script, `\$` escaping).
- `README.md` -- has setup steps and scripts table; add a "Login" section.
- `src/modules/.gitkeep` -- first real module lands here (`src/modules/auth/`).
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, `.../03-file-conventions/proxy.md`, `.../instrumentation.md`, `.../02-guides/authentication.md` -- Next 16 docs: `proxy.ts` (renamed middleware) lives in `src/`, runs on Node runtime by default, `export function proxy` + `config.matcher`; `register()` in `instrumentation.ts` runs once before the server handles requests.
- `node_modules/@next/env` -- Next's dotenv-expand expands `$name` in `.env` values even in quotes; `\$` is unescaped to `$`. A bcrypt hash (`$2b$12$...`) must be written with every `$` as `\$` in `.env`.

## Tasks & Acceptance

**Execution:**
- `package.json`, `package-lock.json` -- add `jose` 6.2.13 and `bcrypt` 6.0.0 exact; add script `"hash-password": "node scripts/hash-password.mjs"` -- deps and hash tooling.
- `src/modules/auth/config.ts` -- `readAuthConfig(env)` returning `{ ok: true, config } | { ok: false, problems: string[] }` per the rules above; `assertAuthConfig(env)` throwing an Error whose message lists all problems and mentions `npm run hash-password` / README.
- `src/modules/auth/session.ts` -- `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `createSessionToken(username, secret, now?)`, `verifySessionToken(token, config)` → `{ username } | null`; jose only (safe for the proxy).
- `src/modules/auth/credentials.ts` -- `checkCredentials(username, password, config)` with constant-ish behavior described above.
- `src/modules/auth/return-url.ts` -- `safeReturnUrl(value)` per the sanitizer rule.
- `src/modules/auth/index.ts` -- re-export the public API plus `getSession()` (reads cookie via `next/headers`, returns session or null) for later server actions/route handlers.
- `src/modules/auth/*.test.ts` -- unit tests: config missing/invalid/valid; token round-trip, expired, tampered, wrong secret, wrong `sub`; credentials correct / wrong user / wrong password (hash generated in test with cost 4); return-URL cases from the matrix.
- `src/proxy.ts` (+ `src/proxy.test.ts`) -- guard per matrix with a matcher excluding `login`, `_next/static`, `_next/image`, `favicon.ico`; test builds `NextRequest`s for each guard row. Import the jose-only session file if pulling the module index (bcrypt) into the proxy breaks the build.
- `src/instrumentation.ts` -- in `register()` when `NEXT_RUNTIME === "nodejs"`: call `readAuthConfig(process.env)`; on failure `console.error` the message and `process.exit(1)`.
- `src/app/(app)/layout.tsx` -- wraps children in `AppShell`; server-side `getSession()` and `redirect("/login")` if null (defense in depth behind the proxy).
- `src/app/layout.tsx` -- drop `AppShell`, keep providers.
- `src/app/login/page.tsx`, `src/app/login/LoginForm.tsx`, `src/app/login/actions.ts` -- centered card with the German form (`useActionState`), hidden `next`, info Alert when `expired=1`; server action validates with zod, calls `checkCredentials`, sets the cookie (`secure` from `x-forwarded-proto`) and `redirect(safeReturnUrl(next))`; on failure returns the error state; page redirects an already valid session.
- `src/app/_actions/logout.ts` + `src/app/_components/AppShell.tsx` -- `"use server"` logout deleting the cookie and redirecting to `/login`; shell control "Abmelden" with icon + accessible label.
- `scripts/hash-password.mjs` -- reads the password from a hidden TTY prompt or stdin (never argv), bcrypt cost 12, prints `AUTH_PASSWORD_HASH=` line with `$` escaped as `\$`; also suggests generating `SESSION_SECRET` with `openssl rand -base64 48`.
- `README.md`, `.env.example`, `next.config.ts` -- Login section (set the three variables, hash script, escaping note, startup failure behavior, 7-day session, logout); comments; `bcrypt` external.

**Acceptance Criteria:**
- Given valid auth env in `.env`, when `npm run dev` runs and `curl` requests `/depots` without a cookie, then it gets 307 to `/login?next=%2Fdepots`; `/api/x` gets 401.
- Given the login form, when correct credentials are submitted with `next=/depots`, then the response sets an `HttpOnly; SameSite=lax` `dm_session` cookie with Max-Age 604800 and redirects to `/depots`, which then returns 200 with that cookie.
- Given wrong username or wrong password, then the page shows "Anmeldung fehlgeschlagen." and no cookie is set.
- Given "Abmelden" is used, then the cookie is cleared and `/` redirects to login again.
- Given `SESSION_SECRET` is unset, when `npm run dev` (or `npm start`) starts and gets a request, then the process exits non-zero with a message naming `SESSION_SECRET`.
- Given `npm run hash-password` with a piped password, then it prints an escaped `AUTH_PASSWORD_HASH=` line that, pasted into `.env`, lets that password log in.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0 (build without auth env set).

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 29 findings — high 0, medium 0, low 19, false 9, maybe-false 1
- findings:
  - `[maybe-false]` `[defer]` (blind) server action POST without session gets a 307 the action client may not follow — 307 confirmed via curl; client handling needs a browser check after real expiry; deferred as medium (unverified).
  - `[low]` `[reject]` (blind) `(app)/layout.tsx` fallback redirect drops `next`/`expired` — only fires if the proxy is bypassed, which no current path does; fixing needs header plumbing from the proxy.
  - `[false]` `[reject]` (blind) route handlers have no second session check — no route handler exists yet; `getSession()` is exported for them.
  - `[low]` `[patch]` (blind) changing `AUTH_PASSWORD_HASH` leaves tokens valid while README implies logout/rotation ends sessions — README now says a password change does not end sessions and to rotate `SESSION_SECRET` too.
  - `[false]` `[reject]` (blind) invalid config at runtime fails silently with `expired=1` — env cannot change after start and the startup check exits on invalid config (verified for `next dev` and `next start`, exit 1 without any request).
  - `[low]` `[reject]` (blind) bcrypt 72-byte truncation not warned — passwords over 72 bytes are unusual and the first 72 bytes still carry the strength; a guard adds a branch.
  - `[low]` `[patch]` (blind) hash script untested; raw-mode reader fragile — added `test/scripts/hash-password.test.ts` (escaping, first line, bcrypt match, empty input); raw-mode escape-key handling rejected as unlikely and branch-adding.
  - `[low]` `[patch]` (blind) login page tests only assert truthy — tests now assert `LoginForm` props `next` (sanitized) and `expired`.
  - `[low]` `[reject]` (blind) tests restore env by reassigning `process.env` — vitest isolates files; no observed leak; switching to `vi.stubEnv` is a refactor.
  - `[false]` `[reject]` (blind) matcher redirects public assets (robots.txt, manifest, icons) — no `public/` directory or metadata icon files exist; nothing is affected.
  - `[low]` `[patch]` (blind) failed login echoes the raw unbounded username — echoed value cut to 256 chars; test added.
  - `[low]` `[patch]` (edge) bcrypt regex accepts costs 00–03 and 32–99 so login can never succeed — regex limited to 04–31, README rule and tests updated.
  - `[low]` `[reject]` (edge) 72-byte limit — same as the blind 72-byte row.
  - `[low]` `[reject]` (edge) layout fallback loses return URL — same as the blind layout row.
  - `[low]` `[reject]` (edge) no rate limiting on login — single user, bcrypt cost 12 slows guessing; limiter adds state and branches; not in the story's acceptance criteria.
  - `[false]` `[reject]` (edge) `secure` wrong for direct HTTPS or forged `X-Forwarded-Proto` — `next start` serves no TLS itself; a forged header only affects the forger's own cookie.
  - `[low]` `[reject]` (edge) hash prompt mishandles pasted multi-line chunks / escape keys — unlikely; the stdin path covers scripted use; fix adds branches.
  - `[low]` `[patch]` (verification-gap) `(app)/layout.tsx` redirect untested — added `src/app/(app)/layout.test.tsx` (no/garbage/foreign token → `/login`; valid → AppShell).
  - `[low]` `[patch]` (verification-gap) `expired` flag not asserted — same fix as the blind login-page-tests row.
  - `[low]` `[patch]` (verification-gap) `register()` untested — added `src/instrumentation.test.ts` (nodejs + invalid env exits 1; unset/edge does not).
  - `[low]` `[patch]` (verification-gap) hash-script output unverified — same fix as the blind hash-script row.
  - `[low]` `[reject]` (verification-gap) LoginForm keep-username/clear-password only verified at state level — no DOM test setup in the repo; adding one is new infrastructure; behavior verified live (failed POST re-renders with the error Alert).
  - `[false]` `[reject]` (intent) reading B: login env setup is an operator action — env values are deploy configuration the README documents (an AC), not an outside human action; story is finished in-repo.
  - `[false]` `[reject]` (intent) ACs exercised only via mocked functions — verified live against `next start`: 307 with return URL, 401 for `/api/x`, wrong user and wrong password both 200 with "Anmeldung fehlgeschlagen." and no cookie, correct login 303 to `/depots` with `HttpOnly; SameSite=lax; Max-Age=604800`, then `/depots` 200 with the shell.
  - `[low]` `[reject]` (intent) layout fallback without return URL — same as the blind layout row.
  - `[false]` `[reject]` (intent) startup check might only run on the first request — `next dev` and `next start` both exit 1 within seconds with no request sent.
  - `[false]` `[reject]` (intent) only `/api/` route handlers answer 401 — no route handler exists outside `/api/`; README states the convention.
  - `[false]` `[reject]` (intent) secure flag only from `X-Forwarded-Proto` — same as the edge secure row.
  - `[low]` `[patch]` (intent) hash script untested — same fix as the blind hash-script row.

## Design Notes

The proxy is the optimistic gate (Next docs); `(app)/layout.tsx` re-verifies so a matcher mistake cannot expose a page. `getSession()` is the hook for later stories' server actions and route handlers.

`secure` is derived per request instead of from `NODE_ENV` so a local `npm start` over plain HTTP still works while a TLS-terminating reverse proxy (sets `x-forwarded-proto: https`) gets secure cookies.

Startup check uses `process.exit(1)` because a thrown error in `register()` is not guaranteed to stop the server; `next build` does not run `register()`, so builds need no auth env.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0
- `printf 'test-pass\n' | npm run -s hash-password` -- expected: one `AUTH_PASSWORD_HASH=\$2b\$12\$...` line
- `npm run dev` with a temp `.env` (synthetic credentials) and `curl -i` for each AC row -- expected: statuses, headers and German texts as listed
- `SESSION_SECRET= npm run dev` + one request -- expected: non-zero exit, message names `SESSION_SECRET`

**Manual checks (if no CLI):**
- Login page renders without the navigation drawer and with the "Minze" theme.

## Auto Run Result

Status: done

**Summary:** Added single-user login. A new `auth` module validates `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` (bcrypt, cost 04–31) and `SESSION_SECRET` (≥ 32 chars), checks credentials with bcrypt plus a timing-safe username compare, and signs a 7-day HS256 session cookie `dm_session` with `jose` (HttpOnly, SameSite=lax, Secure behind HTTPS via `X-Forwarded-Proto`). `src/proxy.ts` redirects unauthenticated pages to `/login?next=…` (adding `expired=1` and deleting a stale cookie) and answers `/api/*` with 401. A German login page with return-URL sanitizing, an "Abmelden" button in the shell, a startup check that exits 1 on missing or invalid auth variables, and an `npm run hash-password` script round it off. Protected pages moved into the `(app)` route group, which re-checks the session.

**Files changed:**
- `package.json`, `package-lock.json`, `next.config.ts` -- `jose` 6.2.13, `bcrypt` 6.0.0, `@types/bcrypt` 6.0.0 (exact); `hash-password` script; `bcrypt` external.
- `src/modules/auth/{config,session,credentials,return-url,index}.ts` (+ tests) -- auth module.
- `src/proxy.ts` (+ test) -- request guard and matcher.
- `src/instrumentation.ts`, `src/instrumentation-node.ts` (+ tests) -- startup check.
- `src/app/(app)/layout.tsx` (+ test), `src/app/(app)/**/page.tsx` (moved), `src/app/layout.tsx` -- route group with session re-check; root layout without shell.
- `src/app/login/{page.tsx,LoginForm.tsx,actions.ts}` (+ tests) -- login page and server action.
- `src/app/_actions/logout.ts` (+ test), `src/app/_components/AppShell.tsx` -- logout.
- `scripts/hash-password.mjs`, `test/scripts/hash-password.test.ts`, `test/helpers/next-mocks.ts` -- hash script, its test, Next mocks.
- `README.md`, `.env.example` -- Login docs; `src/modules/.gitkeep` removed.

**Review findings:** 29 findings (high 0, medium 0, low 19, false 9, maybe-false 1). Patches applied: 11 low rows in 7 fixes (bcrypt cost range, bounded username echo, README password-change note, layout test, LoginForm prop assertions, `register()` test, hash-script test). Deferred: 1 (server action POST after session expiry gets a 307; medium, unverified). Rejected: 9 false (no route handlers yet; runtime config cannot change after the startup check; no public assets exist; `next start` has no own TLS ×2; operator-action reading does not apply; ACs verified live; startup exits without a request; no route handlers outside `/api/`) and 8 low (layout fallback return URL ×3 — unreachable behind the proxy; bcrypt 72-byte limit ×2; `process.env` reassignment in tests; no rate limiting; raw-mode prompt edge cases; LoginForm DOM test needs new infrastructure).

**Follow-up review recommendation:** false — patched entries: high 0, medium 0, low 11.

**Verification:** `npm run lint`, `npm run typecheck` exit 0; `npm test` 17 files / 143 tests passed; `npm run build` exit 0 without auth env (all protected routes dynamic, Proxy present). `printf 'test-pass\n' | npm run -s hash-password` prints an escaped `AUTH_PASSWORD_HASH=\$2b\$12\$…` line. Live with synthetic credentials: `next dev` — `/depots?x=1` 307 to `/login?next=%2Fdepots%3Fx%3D1`, `/api/x` 401 JSON, login page renders without the nav shell; `next start` — wrong password and wrong username both 200 with "Anmeldung fehlgeschlagen." and no cookie, correct login 303 to `/depots` with `HttpOnly; SameSite=lax; Max-Age=604800`, then `/depots` 200 with the "Abmelden" control. Missing `SESSION_SECRET`: `next dev` and `next start` both exit 1 with no request sent, naming the variable.

**Residual risks:** server action requests from an expired session get a 307 (deferred); no login rate limiting; changing only the password keeps existing sessions valid until expiry (documented); the proxy matcher test relies on Next's experimental `unstable_doesMiddlewareMatch`; LoginForm field behavior after a failure has no component test (verified only via server-rendered response).
