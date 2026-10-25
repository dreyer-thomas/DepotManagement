---
title: 'Securities page and provider mapping'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: 'df72d4a30bb300da2502ada4e9c09e8fd5ba795c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/specs/spec-DepotManagement/data-sources.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** "Wertpapiere" is a placeholder; no Security has a price source, so Stories 3.2–3.4 have nothing to fetch by, and a Security's asset type cannot be corrected after creation.

**Approach:** Add a `prices` module owning a new `ProviderMapping` model plus a mapping resolver (OpenFIGI Xetra → Yahoo search fallback; certificates → onvista by ISIN; crypto → CoinGecko id by symbol), a `ledger` service to change a Security's type, and a real Securities page listing every Security with logo placeholder, identifier, type, mapping, and dialogs to edit the mapping and the type. Missing mappings are resolved once, triggered from the page after it renders.

## Boundaries & Constraints

**Always:**
- `prices` owns `ProviderMapping` and reads Securities only via `@/modules/ledger` exports; only `ledger` writes `Security.assetType` (AD-2, AD-16). Writing services accept an optional Prisma tx client (`db` param, default `prisma`) like `ledger`.
- At most one mapping row per Security (`securityId @unique`). A row is either mapped (`provider` + `symbol` both set) or a "not found" marker (both null) recording that auto-resolution already ran.
- Auto-resolution touches only Securities without any row: a definitive "not found" writes the null marker; a transient provider failure (network, timeout, HTTP ≥ 400, 429, schema mismatch) writes nothing so a later run retries. It never overwrites an existing row.
- Outbound requests carry only an ISIN (+ exchange code `GY`) or a crypto symbol, plus the optional API key header (AD-13). Keys only from env `OPENFIGI_API_KEY` / `COINGECKO_API_KEY`; empty = unset. Every fetch has a timeout (10 s). Never log keys.
- Provider responses are validated with zod; expected failures are typed results, never thrown to the UI.
- Tests never touch the network: providers take an injected `fetch` / `search` and are tested against recorded responses in `test/fixtures/providers/`.
- UI text German; buttons ≥ 44 px; works at phone width; no optimistic writes; server actions check the session like `src/app/_actions/depots.ts`.

**Never:**
- No Price model, price fetching, scheduler, stale flags, manual Prices, logo fetching or "Kurse aktualisieren" button (Stories 3.2–3.6).
- No automatic failover between providers at price time; no re-resolution of existing rows on type change.
- No network calls during page render or `next build`; no provider calls from the browser.
- Never offer `UNCLASSIFIED` as a target type; never allow a type that breaks CRYPTO ⇔ cryptoSymbol.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stock/ETF on Xetra | ISIN, OpenFIGI returns a `GY` listing with ticker `SAP` | Row `YAHOO` / `SAP.DE`, origin `AUTO` | — |
| Not on Xetra | OpenFIGI "No identifier found"; Yahoo search returns `.DE` or `.F` quote | Row `YAHOO` / that symbol (`.DE` preferred over `.F`) | — |
| No German listing | OpenFIGI not found; Yahoo quotes only non-`.DE`/`.F` or none | Null marker row ("Keine Kursquelle gefunden") | — |
| OpenFIGI down | OpenFIGI 429/5xx/timeout; Yahoo finds `.DE` | Row `YAHOO` / symbol | If Yahoo also not found or fails: no row, counted as failed |
| Certificate | assetType `CERTIFICATE` | Row `ONVISTA` / ISIN, no network call | — |
| Crypto | cryptoSymbol `BTC`; CoinGecko search coins list | Row `COINGECKO` / id of first coin whose symbol equals `BTC` case-insensitively (e.g. `bitcoin`) | None matching → null marker; failure → no row |
| Manual edit | provider + symbol for a Security | Upsert row, origin `MANUAL`; replaces any existing row | Invalid provider/symbol → field error, input kept |
| Type change | ISIN Security → ETF | `assetType` updated via ledger | CRYPTO for ISIN, non-CRYPTO for crypto, `UNCLASSIFIED`, unknown id → typed failure |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add enums `PriceProvider { YAHOO ONVISTA COINGECKO }`, `MappingOrigin { AUTO MANUAL }`, model `ProviderMapping` (owned by `prices`), back-relation on `Security`.
- `prisma/migrations/` -- latest is `20261025210000_add_fund_asset_type`; never edit committed ones. Generate SQL with `prisma migrate diff` against a temp `DATABASE_URL`.
- `src/modules/ledger/securities.ts` -- `ASSET_TYPES`, `ISIN_ASSET_TYPES`, `assetTypeSchema`, `SECURITY_SELECT`, `listSecurities(db)` (sorted de-DE). Add type change here; reuse the CRYPTO ⇔ cryptoSymbol rule of `validateSecurity` (line ~104).
- `src/modules/ledger/index.ts` -- export new service/types. `LedgerDb` type lives in `./depots`.
- `src/modules/ledger/securities.test.ts` -- test style: `createTestDatabase()` per test, pass `db()`.
- `src/app/(app)/securities/page.tsx` -- currently `<Placeholder>`; replace. `PageTitle` from `@/app/_components/Placeholder`.
- `src/app/(app)/depots/page.tsx` + `page.test.tsx` -- server page pattern and page test using `useMigratedDatabaseForSingleton`, `findElement`, `renderText`.
- `src/app/_actions/depots.ts` + `depots.test.ts` -- server-action pattern (`getSession`, `UNAUTHORIZED`, zod `formText`, `revalidatePath`) and its test harness (`createRequestFakes`, mocked `next/headers`/`next/cache`).
- `src/app/_components/depots/DepotDialogs.tsx` + `DepotDialogs.dom.test.tsx` -- dialog shell (full-screen < sm), controlled inputs kept after error, `useActionState`, `TOUCH_TARGET`; DOM test helpers in `test/helpers/dom.tsx`.
- `src/app/_components/securities/SecurityLogo.tsx` -- 32 px initials logo; reuse as the logo placeholder.
- `src/app/_components/migration/labels.ts` -- `securityTypeLabel` (`UNCLASSIFIED` → "Typ unbekannt"); `ParqetMigrationWizard.tsx:254` shows the warning-chip precedent.
- `next.config.ts` -- `serverExternalPackages`; add `yahoo-finance2` if the build bundling fails.
- `.env.example` -- already lists `OPENFIGI_API_KEY`, `COINGECKO_API_KEY` (no change needed).
- `test/architecture/core-imports.test.ts` -- nothing provider-related may go into `src/core`.

## Tasks & Acceptance

**Execution:**
- `package.json` -- add `yahoo-finance2` exact `4.0.5` (spine stack pin) -- Yahoo search fallback.
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_provider_mapping/migration.sql` -- `ProviderMapping { id cuid, securityId String @unique (relation, onDelete Cascade), provider PriceProvider?, symbol String?, origin MappingOrigin, updatedAt String /* UTC ISO */ }`; run `npx prisma generate` -- AC1/AC2 storage.
- `src/modules/ledger/securities.ts`, `index.ts` -- `changeSecurityType(securityId: unknown, assetType: unknown, db?)` → `{ ok: true, security } | { ok: false, reason: "not-found" | "asset-type-invalid" }`; allowed targets: ISIN Security → STOCK/ETF/FUND/CERTIFICATE, crypto Security → CRYPTO; export `allowedAssetTypes(security)` helper for the UI -- AD-16 single writer.
- `src/modules/prices/providers/openfigi.ts` -- `lookupXetraTickers(isins, { fetch, apiKey })`: POST `https://api.openfigi.com/v3/mapping`, jobs `{ idType: "ID_ISIN", idValue, exchCode: "GY" }`, chunks of 10 (100 with key), header `X-OPENFIGI-APIKEY` only when set; per ISIN → `{ status: "found", ticker } | "not-found" | "error"`; tickers must match `^[A-Z0-9.-]{1,20}$` after upper-casing else not-found.
- `src/modules/prices/providers/yahoo.ts` -- `findGermanListing(isin, { search })`; default `search` = `new YahooFinance({ suppressNotices: ["yahooSurvey"] })` `.search(isin, { quotesCount: 10, newsCount: 0 })`; pick first `.DE`, else first `.F`, else not-found; thrown error → error.
- `src/modules/prices/providers/coingecko.ts` -- `findCoinId(symbol, { fetch, apiKey })`: GET `https://api.coingecko.com/api/v3/search?query=<SYMBOL>`, header `x-cg-demo-api-key` only when set; first coin with matching symbol.
- `src/modules/prices/mappings.ts` -- `resolveMapping(security, providers)` (pure decision over provider results per I/O matrix), `resolveMissingMappings(deps?, db?)` → `{ mapped, notFound, failed: { securityId, name }[] }` (creates rows only for Securities without a row; unique-violation race = skip), `resolveMappingFor(securityId, …)` for the per-row retry (only when the row is absent or a null marker), `setMapping(securityId, { provider, symbol }, db?)` (zod: provider in enum, symbol trimmed 1–40 chars `^[A-Za-z0-9.^=_-]+$`; reasons `not-found`, `provider-invalid`, `symbol-invalid`), `listSecuritiesWithMappings(db?)` (ledger `listSecurities` joined with rows). Deps default to real fetch/env.
- `src/modules/prices/index.ts` -- module public API (only entry point for other code).
- `src/app/_actions/securities.ts` -- `resolveMissingMappingsAction()`, `resolveMappingAction(state, formData)`, `setMappingAction(state, formData)`, `changeSecurityTypeAction(state, formData)`; session check, `revalidatePath("/securities")` on success.
- `src/app/_components/securities/` -- `SecurityList.tsx` (rows: `SecurityLogo`, name, ISIN or symbol, type chip — warning "Typ unbekannt" for `UNCLASSIFIED` —, mapping "Yahoo Finance · SAP.DE" / "Keine Kursquelle gefunden" / "Kursquelle wird ermittelt …", buttons "Kursquelle bearbeiten", "Typ ändern", and "Automatisch suchen" when null marker), `MappingDialog.tsx`, `TypeDialog.tsx`, `MappingAutoResolver.tsx` (client; on mount, once, if pending > 0: calls the action, shows LinearProgress "Kursquellen werden ermittelt …", then `router.refresh()`; on failures shows Alert naming the Securities with "Erneut versuchen"), `labels.ts` (provider labels, error messages).
- `src/app/(app)/securities/page.tsx` -- server page: title, empty state "Noch keine Wertpapiere.", list, auto-resolver, caption "Data provided by CoinGecko" linking `https://www.coingecko.com`.
- Tests: `test/fixtures/providers/{openfigi,yahoo-search,coingecko-search}-*.json` (recorded responses for public ISINs, e.g. SAP `DE0007164600`, iShares Core MSCI World `IE00B4L5Y983`; plus not-found shapes); `src/modules/prices/providers/*.test.ts`, `mappings.test.ts` (all matrix rows, request privacy: body/URL contain only ISIN/`GY`/symbol, key header only when set, chunking, no overwrite of existing rows, transient → no row), `src/modules/ledger/securities.test.ts` (type change), `src/app/_actions/securities.test.ts`, `src/app/(app)/securities/page.test.tsx`, `src/app/_components/securities/*.dom.test.tsx` (dialogs keep input on error, chip, resolver runs once).

**Acceptance Criteria:**
- Given Securities exist, when I open "Wertpapiere", then every Security is listed with logo placeholder, name, ISIN or crypto symbol, asset type and its mapping (provider + symbol) or a no-source text.
- Given Securities without a mapping row, when the page has rendered, then the auto-resolver runs once, the rows are created per the I/O matrix, and the page refreshes to show them; a second visit makes no provider call for those Securities.
- Given a Security, when I save provider "Yahoo Finance" and symbol "EUNL.DE" in "Kursquelle bearbeiten", then exactly one mapping row exists for it with that provider/symbol and origin `MANUAL`, and auto-resolution never overwrites it.
- Given an ISIN Security, when I choose "ETF" in "Typ ändern", then `ledger` stores `ETF` and the list shows it; the dialog offers only types valid for the identifier, never "Typ unbekannt".
- Given an `UNCLASSIFIED` Security, when the list renders, then it shows a "Typ unbekannt" chip.
- Given no session, when any securities action is called, then it returns `unauthorized` and writes nothing.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 32 findings — high 0, medium 3, low 21, false 8, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) Failed lookup leaves "Kursquelle wird ermittelt …" on rows with no run active — `mappingLabel(null)` now reads "Kursquelle noch nicht ermittelt"; page-level Alert keeps the retry.
  - `[low]` `[reject]` (blind) No overall deadline for serial Yahoo fallbacks — only bites when OpenFIGI and Yahoo both hang; fix needs concurrency/deadline machinery; unlikely in everyday use.
  - `[false]` `[reject]` (blind) P2003 if a Security is deleted mid-run — no code path deletes Securities (restore not built yet).
  - `[low]` `[patch]` (blind) Provider failures never logged — one `console.warn` per failure path in the three adapters (provider + cause, no keys).
  - `[low]` `[reject]` (blind) `setMapping` accepts providers that don't fit the identifier — deliberate user override (e.g. Yahoo `BTC-EUR` for crypto is valid); a bad pick surfaces as a fetch error in 3.2/3.3.
  - `[false]` `[reject]` (blind) Both-set-or-both-null not enforced — every writer (`rowData`, `setMapping`) writes both or neither; no path produces a partial row.
  - `[low]` `[reject]` (blind) `setMapping` ignores injected clock — developer-only; fix adds a parameter.
  - `[low]` `[reject]` (blind) Saved mapping cannot be reset to automatic — user can overwrite it manually (AC satisfied); reset adds new surface.
  - `[low]` `[patch]` (blind) Yahoo fallback ignores `isYahooFinance` — quotes flagged `isYahooFinance: false` are skipped; test added.
  - `[low]` `[patch]` (blind) "Erneut versuchen" offered on expired session — retry action omitted for `unauthorized`; dom test added.
  - `[low]` `[patch]` (blind) Untested paths (real yahooSearch options, unauthorized resolver, form failure branches) — grouped with verification-gap rows below; form action-failed branches left untested (low, mirrors tested Depot dialogs).
  - `[false]` `[reject]` (blind) yahoo-finance2 build risk unaddressed — `npm run build` passes with the dynamic import; implementer also ran the production build against live providers.
  - `[low]` `[reject]` (edge) Serial Yahoo fallbacks with 10 s timeouts — same root as the deadline finding above; rejected.
  - `[low]` `[reject]` (edge) CoinGecko 429 doesn't stop further crypto requests — few crypto Securities in practice; fix adds rate-limit state.
  - `[medium]` `[patch]` (edge) Rows show "wird ermittelt" indefinitely — same root as first row; same fix.
  - `[low]` `[patch]` (edge) `resolveMappingAction` doesn't revalidate on `already-mapped` — now revalidates `/securities` for that reason too; action test added.
  - `[false]` `[reject]` (edge) Marker row vanishes between findUnique and updateMany — needs Security deletion, which no path performs.
  - `[false]` `[reject]` (edge) Security deleted between getSecurity and update in `changeSecurityType` — no deletion path.
  - `[low]` `[patch]` (edge) OpenFIGI first GY entry with invalid ticker shadows a later valid one — selects first GY entry passing `TICKER`; test added.
  - `[low]` `[patch]` (edge) CoinGecko first symbol match with invalid id shadows a later valid one — selects first match passing `COIN_ID`; test added.
  - `[false]` `[reject]` (edge) Security with neither ISIN nor crypto symbol gets CRYPTO offered — `ensureSecurity` requires exactly one identifier; such rows cannot exist.
  - `[low]` `[reject]` (edge) Manual mapping with mismatched provider — same as the blind `setMapping` row; rejected.
  - `[low]` `[reject]` (edge) Type change across CERTIFICATE keeps old AUTO mapping — "resolve once" per intent; user edits the mapping in the same row.
  - `[low]` `[patch]` (verification-gap) `SecurityList` → `allowedAssetTypes` wiring untested — new `SecurityList.dom.test.tsx` asserts offered options for ISIN and crypto rows.
  - `[low]` `[patch]` (verification-gap) Resolver `unauthorized` branch untested — dom test added (message, no retry, no refresh).
  - `[medium]` `[patch]` (verification-gap) `resolveMappingFor` race guards untested; a regression could overwrite a MANUAL mapping — two Proxy race tests added asserting `already-mapped` and MANUAL row unchanged.
  - `[low]` `[patch]` (verification-gap) Options to real `yahoo.search` not asserted — action test asserts quotesCount/newsCount, `validateResult: false` and timeout signal.
  - `[false]` `[reject]` (intent) Operator-action clause should apply for API keys — `OPENFIGI_API_KEY`/`COINGECKO_API_KEY` are optional; every provider works keyless and no AC needs a key.
  - `[false]` `[reject]` (intent) Fixture provenance unverified — fixtures carry genuine FIGIs/ids recorded live on 2026-10-26 for public instruments.
  - `[low]` `[patch]` (intent) Real Yahoo path never exercised — grouped with the yahoo-options row; options now asserted.
  - `[low]` `[reject]` (intent) Page lifecycle not tested end to end — repo has no browser e2e harness; each hop is tested separately.
  - `[low]` `[reject]` (intent) Fixtures reshaped per ISIN; `.F` fallback has only synthetic quotes — decision logic covered; recording a `.F`-only instrument adds little.

### 2026-10-26 — Review pass (follow-up)
- verdicts: 30 findings — high 0, medium 0, low 10, false 20, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) OpenFIGI error lets Yahoo lock in a `.F` symbol for a Xetra-listed Security — the matrix row "OpenFIGI down" mandates the Yahoo fallback, and Yahoo search for a Xetra-listed ISIN returns its `.DE` quote, which is preferred; `.F` only wins when Yahoo has no `.DE`; a fix needs re-resolution state.
  - `[false]` `[reject]` (blind) Type change never revisits the AUTO mapping — carried: intent "Never: no re-resolution of existing rows on type change".
  - `[low]` `[reject]` (blind) No reset to automatic / no delete of a mapping — carried: user can overwrite manually (AC satisfied); reset adds new surface.
  - `[low]` `[reject]` (blind) Symbol not checked against provider; manual symbols not normalised — carried: deliberate user override; one row per Security (`securityId @unique`), so `sap.de` and `SAP.DE` cannot coexist for one Security.
  - `[false]` `[reject]` (blind) Half-filled rows classified inconsistently — carried: every writer (`rowData`, `setMapping`) writes both or neither.
  - `[low]` `[reject]` (blind) Resolver run has no time or rate budget — carried: same root as the serial-deadline row of the first pass.
  - `[false]` `[reject]` (blind) Permanent failures retried on every visit — intent lists schema mismatch and HTTP errors as transient that "write nothing so a later run retries"; the code does exactly that.
  - `[false]` `[reject]` (blind) Auto-resolution only runs on page visit — intent: "triggered from the page after it renders"; Design Notes hand `resolveMissingMappings` to 3.2/3.3.
  - `[low]` `[patch]` (blind) `changeSecurityTypeAction` revalidates only `/securities` while the type is also shown in transaction/corporate-action dialogs — now `revalidatePath("/", "layout")` like every other ledger-writing action; action test updated.
  - `[false]` `[reject]` (blind) `setMapping` ignores injected clock; unchanged save flips AUTO→MANUAL — clock part carried (rejected low); MANUAL on save is the matrix row "Manual edit → origin MANUAL; replaces any existing row".
  - `[low]` `[reject]` (blind) Resolving services accept a tx client and make network calls inside it — no caller passes a tx; the `db` param is an intent constraint; only bites a future misuse.
  - `[false]` `[reject]` (blind) CoinGecko first exact-symbol match stored unchecked — intent matrix: "id of first coin whose symbol equals `BTC`"; implemented as specified.
  - `[low]` `[reject]` (blind) Missing tests (429+`.F`, type change with AUTO row, half row, MANUAL after type change, long-list attribution) — behaviours are intent-excluded, unreachable, or covered (`resolveMappingFor` refuses mapped rows regardless of type; race tests); adding them buys little.
  - `[low]` `[reject]` (edge) Esc/backdrop closes the dialog mid-save, hiding a later error — same as the established Depot dialog pattern; the save still completes and revalidates; fix threads `pending` into the shell (new prop).
  - `[false]` `[reject]` (edge) P2003 if a Security is deleted mid-run — carried: no code path deletes Securities.
  - `[false]` `[reject]` (edge) Security/marker deleted during "Automatisch suchen" — carried: no deletion path.
  - `[false]` `[reject]` (edge) Security deleted between `getSecurity` and update in `changeSecurityType` — carried: no deletion path.
  - `[false]` `[reject]` (edge) `new YahooFinance(...)` throwing leaves a rejected promise cached — the constructor runs with constant options, so it either never throws or throws on every attempt; clearing the cache would not make a later search succeed.
  - `[false]` `[reject]` (edge) Half-filled row hides "Automatisch suchen" — carried: no writer produces a half-filled row.
  - `[low]` `[reject]` (edge) Serial Yahoo lookups with 10 s timeouts keep the progress bar up — carried: same root as the deadline row.
  - `[false]` `[reject]` (edge) Mapping text "Kursquelle noch nicht ermittelt" differs from spec copy — deliberate first-pass patch (misleading pending label); the only fix is editing this build's spec.
  - `[false]` `[reject]` (verification-gap) Yahoo constructor failure caches rejected promise — same claim as the edge row above; same refutation.
  - `[low]` `[reject]` (intent) Real `yahoo-finance2` requests never exercised (D2) — carried: options and timeout signal are asserted; tests must not touch the network.
  - `[low]` `[reject]` (intent) Render → action → service → refresh chain untested end to end — carried: no browser e2e harness; each hop tested.
  - `[false]` `[reject]` (intent) "Automatisch suchen" overwrites marker rows, against "never overwrites" — that rule binds auto-resolution (`resolveMissingMappings`, which skips every existing row); the user-triggered retry replaces only a marker, guarded by `updateMany where provider: null`.
  - `[false]` `[reject]` (intent) Mapped-or-marker invariant not in the schema (C2) — carried: enforced by every writer; no path writes a partial row.
  - `[false]` `[reject]` (intent) Symbol syntax rule (E2) — consistent with "Invalid provider/symbol → field error"; the dialog shows it as a field error.
  - `[false]` `[reject]` (intent) Coin-id filter (F2) — first-pass patch; still returns the first valid exact-symbol match, as the matrix requires.
  - `[low]` `[reject]` (intent) No test asserts logs omit keys — grep: no `console.*` call receives `apiKey`; a log-capture test adds little.
  - `[false]` `[reject]` (intent) Logo placeholder untested in this diff — `SecurityLogo` predates this story with its own coverage, and `SecurityList` renders it per row.

## Design Notes

- Resolution runs from a client effect, not during render, so page load never waits on providers and `next build` never calls them. Stories 3.2/3.3 will call `resolveMissingMappings` before fetching.
- The null-marker row is what makes "resolve once" hold for definitive misses without hammering OpenFIGI (25 req/min keyless). Transient failures leave no row and are retried on the next page open.
- CoinGecko prices are fetched by coin id, so the mapping stores the id (`bitcoin`), found via search by symbol; search results are ordered by market-cap rank, so the first exact-symbol match is the right coin.
- `.DE` is the Xetra suffix on Yahoo; OpenFIGI `GY` ticker `T` maps to `T.DE`.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "COINGECKO_API_KEY\|OPENFIGI_API_KEY" -- src` -- expected: read only from `process.env` in `src/modules/prices`.

## Auto Run Result

Status: done

**Summary:** Follow-up review pass on the story 3-1 implementation (`prices` module with `ProviderMapping`, mapping resolver, manual mapping edit, `ledger.changeSecurityType`, real "Wertpapiere" page). Four review layers ran against the diff since `df72d4a30bb300da2502ada4e9c09e8fd5ba795c`; one low finding patched.

**Files changed (this pass):**
- `src/app/_actions/securities.ts` — `changeSecurityTypeAction` revalidates `("/", "layout")`, like other ledger writes.
- `src/app/_actions/securities.test.ts` — asserts the new revalidation.

**Review findings:** 30 total — 1 patched (low), 0 deferred, 29 rejected (20 false, 9 low; reasons per row in the triage log). Rejected lows: Yahoo `.F` after OpenFIGI error, no reset to automatic, provider/symbol mismatch, no run budget, tx-client misuse, extra tests, dialog close mid-save, serial timeouts (carried), live Yahoo requests (carried), e2e chain (carried), log-capture test.

**Follow-up review recommendation:** false — follow-up pass, no `high` patched (patched counts: high 0, medium 0, low 1).

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all pass (82 test files, 1240 tests; build OK). `git grep` for the API key names: read from env only in `src/modules/prices/mappings.ts` (plus tests).

**Residual risks:** unchanged from the first pass — ETFs without Xetra listing on OpenFIGI and only a London quote on Yahoo need a manual `.DE` entry; serial Yahoo fallbacks have no overall deadline; Yahoo behaviour is verified only against recorded/mocked responses.
