---
title: 'Security logos'
type: 'feature'
created: '2026-10-26'
status: done
operator_actions:
  - 'Create a free logo.dev account, copy its publishable key (pk_…) and set it as LOGO_DEV_API_KEY in the production .env, then restart the app.'
baseline_revision: 'd107a2ff8b8e77e6d30cb75158e5e345c6dc9200'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every Security mention shows only name-derived initials (placeholder from 3.1); there is no logo storage, fetching, serving or upload.

**Approach:** New `logos` module (SecurityLogo model + files under `DATA_DIR`) that fetches a logo once per Security in the background (logo.dev → Elbstream; certificates via issuer; crypto → CoinGecko image), serves stored files from an authenticated app route, lets the user upload/replace a logo on the Securities page (manual always wins), and makes the shared `SecurityLogo` component show the stored logo everywhere with initials as instant fallback.

## Boundaries & Constraints

**Always:**
- Only `logos` reads/writes SecurityLogo rows and logo files; it reaches `ledger`/`prices` only via their `index.ts` (`listSecurities`, `getSecurity`, `listSecuritiesWithMappings`). Writing services accept an optional Prisma tx client.
- SecurityLogo: one row per Security (`securityId` unique, cascade delete), `source` `FETCHED|MANUAL`, `provider` `LOGO_DEV|ELBSTREAM|COINGECKO` (null for MANUAL and for the none-found marker), `fileName`/`contentType` (both null = marker "nothing found"), `fetchedAt` UTC ISO. New Prisma migration; existing migrations untouched.
- Fetch candidates: Securities without a row, plus FETCHED markers older than 30 days (`MARKER_RETRY_DAYS`). Never a Security with a MANUAL row or a FETCHED file. Chain, first image wins:
  - ISIN (non-certificate): logo.dev `/isin/{ISIN}` → logo.dev `/ticker/{symbol}` (only when mapped to YAHOO) → Elbstream `/logos/isin/{ISIN}`.
  - CERTIFICATE: issuer ISIN from a static issuer table matched on the Security name (case-insensitive, word-bounded) → same ISIN chain with the issuer ISIN; no match → marker.
  - Crypto: logo.dev `/crypto/{SYMBOL}` → Elbstream `/logos/crypto/{SYMBOL}` → CoinGecko `coins/{id}` `image.large` (only when mapped to COINGECKO; image host must end in `coingecko.com`, https).
  - logo.dev: `https://img.logo.dev/<kind>/<id>?token=<LOGO_DEV_API_KEY>&format=png&size=128&fallback=404`, skipped when the key is unset. Elbstream: `https://api.elbstream.com/logos/<kind>/<id>?format=png`. CoinGecko uses `COINGECKO_API_KEY` header like the prices adapter.
  - Per provider: HTTP 404 → not-found; other non-2xx, network, timeout (10 s) → error; body > 256 KB or bytes not PNG/JPEG/WebP (magic-byte sniff, never trust Content-Type) → not-found.
  - Outcome: image → FETCHED row with file; all not-found → marker row; any error and no image → no write (retried at next trigger).
- Files: `<DATA_DIR>/logos/<securityId>-<epochMs>.<png|jpg|webp>`; empty `DATA_DIR` → `~/.depotmanagement/data`. File written before the DB row; the previous file of that Security deleted after the row update; a fetch that finds a MANUAL row at write time (checked in the write transaction) discards its file and writes nothing.
- Runs serialized in-process (globalThis queue). Triggers: once on server start (`startBackgroundJobs`, never during build) and via `after()` from every server action that currently calls `schedulePriceBackfill()` in `transactions.ts`, `migration.ts`, `corporate-actions.ts`, `depots.ts`. A fetch failure or exception is logged (no URL, key or amounts) and never changes an action result or blocks a ledger write.
- Manual upload `saveManualLogo(securityId, bytes)`: `not-found` (unknown Security), `file-missing` (empty), `file-too-large` (> 1 MiB), `file-type` (not PNG/JPEG/WebP by magic bytes); success writes a MANUAL row (provider null) replacing any row; `fetchedAt` = upload time. Server action checks the session first, revalidates `"/"` layout on success.
- Route `GET /api/logos/[securityId]`: session check (401), unknown/marker → 404, else file bytes with stored `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. File names read from the DB are validated against `^[A-Za-z0-9_-]+\.(png|jpg|webp)$` before joining paths.
- UI: `SecurityLogo` takes `securityId` + `name`; with a stored logo it renders the 32px round Avatar with `src=/api/logos/<id>?v=<version>` and the initials as children (shown if the image fails); without one, initials immediately — same box size, no layout shift. Versions come from a context provider filled in `(app)/layout.tsx` via `listLogoVersions()`. Securities page card action row: "Logo hochladen" (no stored logo) / "Logo ersetzen" (stored logo), aria-label `… – <name>`, dialog titled "Logo hochladen" with file input (accept `image/png,image/jpeg,image/webp`), hint "PNG, JPEG oder WebP, höchstens 1 MB.", "Abbrechen"/"Hochladen", German error messages, closes and refreshes on success; ≥ 44 px targets. App shell shows a visible attribution link line "Logos: Logo.dev · Elbstream" (≥ 16px font) on every page.

**Never:**
- No browser request to any logo provider; no hotlink URLs stored or rendered; no SVG accepted or stored.
- Outbound logo requests carry only ISIN, ticker, crypto symbol or coin id (plus the key).
- No change to `src/core`, price fetching, or the backup format (Epic 6); no news (3.7); no logo deletion UI.
- Tests never hit live providers (fake `fetch` with recorded/synthetic bytes; temp `DATA_DIR`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stock, logo.dev hit | ISIN Security, key set, logo.dev 200 PNG | FETCHED/LOGO_DEV row + file; Elbstream not called | — |
| Fallback | logo.dev 404, ticker 404, Elbstream 200 PNG | FETCHED/ELBSTREAM row | — |
| No key | key unset | logo.dev never called (no request), Elbstream tried | — |
| Nothing found | all 404 | marker row; next run skips it; retried once marker > 30 days | — |
| Transient | logo.dev 503, Elbstream 404 | no row; next run retries | logged |
| Bad body | 200 with HTML / 300 KB | treated as not-found | — |
| Certificate | CERTIFICATE "Vontobel Turbo …" | queries issuer ISIN CH0012335540; unknown issuer → marker without requests | — |
| Crypto | BTC, logo.dev+Elbstream 404, COINGECKO mapping `bitcoin` | CoinGecko image stored as COINGECKO | — |
| Manual wins | MANUAL row exists | never a candidate; fetch racing an upload discards its file | — |
| Upload invalid | 0 bytes / 2 MiB / GIF / unknown id | `file-missing` / `file-too-large` / `file-type` / `not-found`, nothing written | typed result |
| Ledger write | transaction save while providers fail | action result unchanged | logged |
| Route | no session / marker / stored file | 401 / 404 / 200 with headers above | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add `LogoSource`, `LogoProvider` enums, `SecurityLogo` model, `logo SecurityLogo?` relation on Security (pattern: ProviderMapping). New migration folder `prisma/migrations/2026102615xxxx_add_security_logo/` (create with `prisma migrate dev --create-only` against a temp `DATABASE_URL`), then `npx prisma generate`.
- `src/modules/prices/mappings.ts:257` `listSecuritiesWithMappings` -- source for YAHOO ticker / COINGECKO coin id per Security (read-only use from `logos`).
- `src/modules/prices/providers/shared.ts`, `coingecko.ts` -- patterns to mirror (FetchLike, Lookup, `envKey`, `PROVIDER_TIMEOUT_MS`, `x-cg-demo-api-key`, COINGECKO_COINS_URL); do not import them from `logos` (module boundary) — copy the small helpers into `src/modules/logos/providers/shared.ts`.
- `src/modules/prices/prices.ts:48-58` -- `serialized()` globalThis queue pattern to copy.
- `src/modules/ledger/index.ts` -- `listSecurities`, `getSecurity`, `isinSchema` (issuer-table test validates ISINs).
- `src/db/database-url.ts` -- home-dir default pattern for `DATA_DIR` fallback.
- New `src/modules/logos/` -- `index.ts` (exports), `logos.ts` (`fetchMissingLogos(deps?, db?)`, `saveManualLogo`, `listLogoVersions`, `readLogo`), `storage.ts` (dir, write/delete/read, file-name validation), `image.ts` (magic-byte sniff, size limits), `issuers.ts` (issuer keyword → ISIN table: UniCredit/HypoVereinsbank IT0005239360, Société/Societe Générale FR0000130809, Vontobel CH0012335540, Deutsche Bank DE0005140008, Commerzbank DE000CBK1001, BNP Paribas FR0000131104, Goldman Sachs US38141G1040, Morgan Stanley US6174464486, Citigroup US1729674242, J.P. Morgan/JPMorgan US46625H1005, UBS CH0244767585, HSBC GB0005405286, Xetra-Gold/Deutsche Börse DE0005810055), `providers/{shared,logo-dev,elbstream,coingecko}.ts`.
- `src/app/_actions/price-refresh.ts` -- `after()` scheduling pattern; add sibling `src/app/_actions/logo-fetch.ts` `scheduleLogoFetch()` and call it next to each `schedulePriceBackfill()` in `transactions.ts`, `migration.ts`, `corporate-actions.ts`, `depots.ts`.
- `src/instrumentation-node.ts` `startBackgroundJobs` -- also start one `fetchMissingLogos()` (fire-and-forget, caught); extend `src/instrumentation-node.test.ts`.
- `src/app/_components/securities/SecurityLogo.tsx` -- becomes client component reading new `LogoProvider` context (`src/app/_components/securities/LogoContext.tsx`); callers to pass `securityId`: `SecurityList.tsx:52`, `CashBookings.tsx:52`, `TransactionList.tsx:172`, `PositionsTable.tsx:72,324` (`SecurityName` gains `securityId`).
- `src/app/(app)/layout.tsx` -- load `listLogoVersions()` after the session check; wrap children in the provider; `layout.test.tsx` mocks.
- `src/app/_components/AppShell.tsx` -- attribution line.
- `src/app/_components/securities/SecurityList.tsx` -- add `LogoUploadButton` (new `LogoUploadDialog.tsx`) to the action row; dialog pattern `SecurityDialog.tsx` (`SecurityDialog`, `useDialog`, `TOUCH_TARGET`), `ManualPriceDialog.tsx`.
- New `src/app/_actions/logos.ts` -- `uploadLogoAction(prev, formData)` (fields `securityId`, `file` as File); pattern `src/app/_actions/prices.ts`.
- New `src/app/api/logos/[securityId]/route.ts` -- GET handler; proxy (`src/proxy.ts`) already gates `/api/*` with 401.
- `.env.example` -- describe `LOGO_DEV_API_KEY` (logo.dev publishable key `pk_…`) and `DATA_DIR` default.
- Tests: `test/helpers/test-db.ts`, `test/helpers/dom.tsx`, `test/helpers/next-mocks.ts`, `test/helpers/providers.ts` for patterns.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + new migration -- SecurityLogo model.
- `src/modules/logos/**` (+ tests) -- providers, chain, storage, services, issuer table; tests for every I/O matrix row (fake fetch asserting called URLs, temp DATA_DIR), issuer ISINs pass `isinSchema`, file-name validation rejects traversal.
- `src/app/api/logos/[securityId]/route.ts` (+ test) -- 401/404/200 with headers.
- `src/app/_actions/logos.ts` (+ test) -- unauthorized writes nothing; success revalidates; typed failures.
- `src/app/_actions/logo-fetch.ts` + call sites (+ extend existing action tests to assert scheduling and that a throwing fetch does not change the result).
- `src/instrumentation-node.ts` (+ test) -- start-up logo run, skipped during build.
- `LogoContext.tsx`, `SecurityLogo.tsx`, callers, `(app)/layout.tsx` (+ dom/page tests) -- logo img when versioned, initials otherwise, same size.
- `LogoUploadDialog.tsx`, `SecurityList.tsx` (+ dom tests) -- button label by state, dialog submit, error display, close on success.
- `AppShell.tsx` -- attribution; `.env.example`.

**Acceptance Criteria:**
- Given a Security created by a saved Transaction, when the response has been sent, then a background run stores its logo (or marker) without the action waiting for or failing on it.
- Given a stored logo, when any page shows that Security (Securities list, Positions, Transactions, cash bookings), then the 32px round logo is loaded from `/api/logos/<id>` and no provider URL appears in the HTML.
- Given a Security without logo, when it is shown, then deterministic initials render immediately in the same 32px box.
- Given the Securities page, when I upload a valid image for a Security, then it replaces the shown logo and no later fetch run overwrites it.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 30 findings — high 0, medium 4, low 16, false 10, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) 401/403 from a wrong logo.dev key counted as transient error, so no marker is ever written and every provider is re-queried on each trigger — `fetchImage` now treats 401/403 as not-found (warning kept); tests for 401/403/429.
  - `[low]` `[patch]` (blind) Certificate names mentioning two issuers resolved by table order (underlying instead of issuer) — `issuerIsin` now picks the earliest match in the name; tests added.
  - `[low]` `[patch]` (blind) Issuer table missed common short forms — added "HVB", "Citi", "Goldman" (word-bounded) with positive/negative tests.
  - `[medium]` `[patch]` (blind) `bareTicker` stripped `.DE`/`.F`, deviating from the spec's `/ticker/{symbol}` and risking another company's logo — removed; the Yahoo symbol is sent unchanged.
  - `[low]` `[reject]` (blind) Background-fetched logos appear only after the next reload/mutation (layout not re-rendered on soft navigation) — revalidating from inside `after()` adds new mechanics; a reload or the next write shows the logo; single user.
  - `[false]` `[reject]` (blind) Manual logos missing from backups — no export exists yet; AD-12 assigns manual-logo export (base64) to Epic 6.
  - `[low]` `[reject]` (blind) Upload and fetch in the same millisecond with the same extension share a file name — needs two writes for one Security within 1 ms; fixing changes the file-name/version scheme.
  - `[low]` `[reject]` (blind) Runs are queued, not coalesced — each extra run only re-reads candidates (markers/files skip); coalescing adds state for a single-user app.
  - `[low]` `[reject]` (blind) Upload > 6 MB shows the connection error instead of "größer als 1 MB" — rare; a client-side size branch adds UI logic.
  - `[low]` `[reject]` (blind) Uploads served unscaled, no dimension cap — the user's own ≤ 1 MiB file; re-encoding needs an image library.
  - `[low]` `[reject]` (blind) Hard-coded white image background / blank while loading — spec-conformant (image with initials as failure fallback); `#FFFFFF` already used for initials text.
  - `[low]` `[patch]` (blind) Untested paths — added tests for `readLogo` rejecting a disallowed content type and the dialog's `not-found` message; delete-action scheduling is now covered by the chained backfill test; DB-write-failure cleanup rejected (see verification-gap row); ISIN-change part false (the new Security has its own id and gets its own fetch).
  - `[low]` `[reject]` (blind) `LOGO_CONTENT_TYPES` duplicates the sniff types — no caller diverges today; cosmetic.
  - `[medium]` `[patch]` (edge) When MUI's internal preload fails, the Avatar shows white initials on the white logo background (invisible) — the Avatar keeps the name color, white sits only behind the `img`; dom test asserts both.
  - `[low]` `[reject]` (edge) FETCHED row whose file vanished is never re-fetched — only after manual deletion of files under DATA_DIR; fix adds fs checks per run.
  - `[low]` `[patch]` (edge) Mapping set/resolved after creation never triggers a logo attempt — resolved with the verification-gap ordering fix (mapping actions call `schedulePriceBackfill`, which now runs the logo fetch afterwards); an existing marker still waits 30 days by design.
  - `[low]` `[reject]` (edge) Same-millisecond file-name collision — same as the blind row.
  - `[low]` `[reject]` (edge) Logo files of deleted Securities stay on disk — Securities are rarely deleted; a sweep adds complexity; disk clutter only.
  - `[low]` `[reject]` (edge) CoinGecko image fetch follows redirects off the coingecko.com allowlist — URL comes from CoinGecko's own API; the body is still size-limited and magic-byte checked.
  - `[medium]` `[patch]` (edge) Non-German Yahoo suffixes not stripped — same root cause as the blind `bareTicker` row; resolved by sending the symbol unchanged.
  - `[false]` `[reject]` (edge) Dynamic import of `@/modules/logos` may reject in `startBackgroundJobs` — import failure of the app's own module is a build defect, not a reachable runtime state.
  - `[medium]` `[patch]` (verification-gap) Logo fetch ran in its own `after()` concurrently with the price backfill, so new Securities were chained before their mapping existed (no CoinGecko/ticker step, then a 30-day marker) — the logo fetch now runs in the backfill's `after()` callback after the backfill (also when it fails); separate call sites removed; `price-refresh.test.ts` proves order, failure tolerance and that refetch does not trigger logos.
  - `[low]` `[patch]` (verification-gap) Logo display on Positions/cash bookings unverified — `PositionsTable.dom.test.tsx` (desktop + phone) and new `CashBookings.dom.test.tsx` assert `img[src="/api/logos/<id>?v=1"]`.
  - `[low]` `[patch]` (verification-gap) `deleteIsinChangeAction` logo scheduling not asserted — superseded: scheduling now lives inside `schedulePriceBackfill`, which the action test asserts and `price-refresh.test.ts` covers.
  - `[low]` `[reject]` (verification-gap) File cleanup after a failed DB write untested — disk clutter only; needs a failing-db harness.
  - `[low]` `[patch]` (verification-gap) Test comments claimed "price backfill first, then logos" — removed with the ordering fix.
  - `[low]` `[patch]` (verification-gap) Mapping actions never trigger a logo attempt — same root cause as the ordering row; fixed there.
  - `[false]` `[reject]` (intent) Reading B (logo.dev key is a human-only action) not reflected in the diff — handled at finalization: status `awaiting-operator` with `operator_actions`; not a code defect.
  - `[false]` `[reject]` (intent) Certificates: underlying not attempted; "created or first held" implemented as a sweep — AD-19 allows "issuer or underlying, else none"; the sweep covers created and first-held Securities alike.
  - `[false]` `[reject]` (intent) Live providers, real `after()` and browser rendering not exercised; work uncommitted — the repo forbids live provider calls in tests; finalization commits the work.

## Design Notes

- Certificates: no issuer/underlying data exists on a Security, so the issuer is recognised from the name via a static table of common German certificate issuers mapped to the issuer's listed-share ISIN, then the normal ISIN chain runs; underlying detection is not attempted ("else none" per AD-19).
- logo.dev's image CDN takes the publishable key; the key travels only server-side. `fallback=404` stops logo.dev from returning generated monograms as hits.
- Markers prevent re-querying (Elbstream asks for sparing use) but expire after 30 days so a later-added key or new coverage is picked up.
- PNG-only fetches and no SVG upload avoid script-bearing images on the app's origin; the route's CSP `sandbox` is defence in depth.
- Elbstream's free tier requires a visible link on pages showing its logos, hence the app-shell attribution.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "img.logo.dev\|elbstream.com\|coingecko.com" -- src/app` -- expected: only attribution links (`AppShell.tsx`, the CoinGecko line on the Securities page), no image URLs.

## Auto Run Result

Status: awaiting-operator

**Summary:** New `logos` module with a `SecurityLogo` model (+ migration) that fetches a logo once per Security in the background — logo.dev (ISIN, Yahoo ticker, crypto) → Elbstream → CoinGecko image for crypto; certificates via an issuer table matched on the name — stores PNG/JPEG/WebP files under `<DATA_DIR>/logos`, writes a "nothing found" marker (retried after 30 days) and never overwrites a manual upload. Logos are served by the authenticated route `GET /api/logos/[securityId]` (nosniff, CSP sandbox, immutable cache); `SecurityLogo` shows them in every Security mention via a layout-level context, with name-colored initials as instant fallback. The Securities page offers "Logo hochladen"/"Logo ersetzen" (≤ 1 MiB, magic-byte check). The fetch runs once at server start and after every price backfill scheduled by a server action (same `after()` callback, after mapping resolution); failures are only logged. The app shell shows the Logo.dev/Elbstream attribution. Everything an agent can do is done; logo.dev needs a key only the operator can obtain (without it, Elbstream/CoinGecko are used).

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261026150000_add_security_logo/` — SecurityLogo model.
- `src/modules/logos/**` (+ tests) — services, provider adapters, storage, image sniffing, issuer table.
- `src/app/api/logos/[securityId]/route.ts` (+ test) — authenticated logo route.
- `src/app/_actions/logos.ts` (+ test) — upload action; `logo-fetch.ts` (+ test) — logged logo run.
- `src/app/_actions/price-refresh.ts` (+ test) — backfill callback runs the logo fetch afterwards.
- `src/app/_actions/{transactions,migration,corporate-actions,depots}.test.ts` — logos module mocked.
- `src/instrumentation-node.ts` (+ test) — start-up logo run.
- `src/app/(app)/layout.tsx` (+ test), `src/app/_components/securities/LogoContext.tsx` — logo versions context.
- `src/app/_components/securities/SecurityLogo.tsx` (+ dom test), callers in `SecurityList`, `PositionsTable`, `TransactionList`, `CashBookings` (+ dom tests).
- `src/app/_components/securities/LogoUploadDialog.tsx` (+ dom test), `labels.ts` — upload UI and messages.
- `src/app/_components/AppShell.tsx` — attribution; `.env.example` — `LOGO_DEV_API_KEY`, `DATA_DIR` docs.

**Review findings:** 30 total — 14 rows patched (4 medium: bad-key marker blocking, unchanged Yahoo ticker, invisible initials on preload failure, logo fetch racing mapping resolution; 10 low: issuer earliest match, issuer short names, test gaps on content type/not-found message/Positions/cash bookings, comments and mapping-action triggers folded into the ordering fix), 0 deferred, 16 rejected (10 false, 6+ low — reasons in the triage log: no backup export yet (Epic 6), same-millisecond file collisions, run coalescing, >6 MB upload message, image re-encoding, refresh-after-background-fetch, vanished files, orphan files, CoinGecko redirects, failing-db cleanup test, type duplication, import-failure, intent readings handled at finalization).

**Follow-up review recommendation:** true — patched counts: high 0, medium 4, low 10. Unverified risk: the chained backfill→logo `after()` callback and the logo.dev/Elbstream response behaviour (404 for unknown ids, PNG output) are only exercised against mocks/fakes, never under the real Next runtime or live providers.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (103 test files, 1529 tests; build OK). `git grep -n "img.logo.dev\|elbstream.com\|coingecko.com" -- src/app` — only attribution links (AppShell, CoinGecko line on the Securities page). Matrix audit: every I/O row covered by passing tests in `src/modules/logos/logos.test.ts`, `src/app/_actions/logos.test.ts`, `src/app/_actions/transactions.test.ts`/`price-refresh.test.ts` and `src/app/api/logos/[securityId]/route.test.ts`.

**Operator actions:** see frontmatter `operator_actions` (logo.dev publishable key).

**Residual risks:** logo.dev/Elbstream behaviour verified only from their docs (Elbstream's unknown-id response undocumented); Elbstream's free tier lists storing as a paid feature — the AD-19 decision to store stays the operator's call; a background-fetched logo shows after the next reload or write; orphan files remain when a Security is deleted; a "nothing found" marker blocks re-tries for 30 days even after a mapping change.

## Operator Confirmation

Confirmed 2026-10-26: the external actions this story owed were carried out.

- Create a free logo.dev account, copy its publishable key (pk_…) and set it as LOGO_DEV_API_KEY in the production .env, then restart the app.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
