---
title: 'Prices for certificates and crypto'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '489fc7ad768d07a7b886ee411119357971329091'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      onvista eod_history entries with a null close or timestamp would make the whole certificate history a `schema` failure.
    evidence: |-
      `eodSchema` requires `z.array(z.number())` for `datetimeLast` and `last`; the recorded Xetra-Gold response has no nulls and it is unknown whether onvista ever emits them. Settle by observing a live eod_history response with a gap day (e.g. a thinly traded turbo); if nulls occur, accept nullable entries and skip them as the Yahoo adapter does.
    location: >-
      src/modules/prices/providers/onvista.ts:21
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Only Securities mapped to Yahoo get Prices; held certificates (mapped `ONVISTA` by ISIN) and crypto (mapped `COINGECKO` by coin id) are skipped by every price run, so they show only Transaction prices and go stale, and a failed run always reports provider `YAHOO`.

**Approach:** Add three AD-9 `PriceAdapter`s — onvista (unofficial JSON by ISIN), CoinGecko (`market_chart`, ≤ 365 days) and Binance (`klines`, `<SYMBOL>EUR`, 1d) — and let the existing backfill/refresh services plan and store Prices for every mapped provider, with a one-time Binance backfill for crypto history older than CoinGecko's 365-day window.

## Boundaries & Constraints

**Always:**
- Every adapter implements `PriceAdapter` (`fetchHistory` + `fetchLatest` = last close of the last 7 days), takes an injected `fetch` (`FetchLike`), sends only `Accept: application/json` (no spoofed User-Agent), uses `AbortSignal.timeout(PROVIDER_TIMEOUT_MS)`, validates responses with zod, returns typed `PriceFetch` results and never throws. HTTP 404 (onvista, CoinGecko) / Binance `400` with body `code: -1121` → `not-found`; other non-OK → `network`; thrown fetch → `network`; schema mismatch → `schema`; no close in range → `not-found`.
- Closes: positive values only, stored as `canonicalDecimal(String(value))` (provider numbers) resp. `canonicalDecimal(kline[4])` (Binance strings); at most one per date (the last wins), ascending, limited to `[from, to]`. No split un-adjustment outside Yahoo (adapters ignore `ctx.splits`).
- onvista (`providers/onvista.ts`, symbol = ISIN): `GET https://api.onvista.de/api/v1/instruments/query?searchValue=<ISIN>` → first `list` entry whose `isin` equals the symbol case-insensitively (`entityType` `/^[A-Z_]+$/`, `entityValue` `/^\d+$/`; none → `not-found`), then `GET https://api.onvista.de/api/v1/instruments/<entityType>/<entityValue>/eod_history?range=MAX&startDate=<from>`; `isoCurrency !== "EUR"` → `currency`; `datetimeLast` (unix seconds) and `last` must be equal-length number arrays; date = `businessDate(new Date(seconds * 1000))`.
- CoinGecko (`providers/coingecko.ts`, symbol = coin id): `GET https://api.coingecko.com/api/v3/coins/<id>/market_chart?vs_currency=eur&days=<N>&interval=daily`, header `x-cg-demo-api-key` only when `COINGECKO_API_KEY` is set; `N` = UTC days from `from` to the UTC date of `now()` plus 1, clamped to `1..365`. A point `[ms, price]` is dated by the UTC calendar date of `ms − 1` (the 00:00 UTC point closes the previous UTC day; an intraday point dates today).
- Binance (`providers/binance.ts`, symbol `<SYMBOL>EUR`, `/^[A-Z0-9]{1,20}EUR$/` else `not-found` without a request): `GET https://api.binance.com/api/v3/klines?symbol=<S>&interval=1d&startTime=<ms>&endTime=<ms>&limit=1000`, `startTime`/`endTime` = UTC midnight of `from`/`to`; kline dated by the UTC date of its open time `k[0]`; paginates while a page has 1000 rows (next `startTime` = last open time + 1 day).
- Service: plans cover held Securities mapped to `YAHOO`, `ONVISTA` or `COINGECKO` (symbol not null), same full/incremental rules as today; the adapter is chosen by the plan's provider; `storeHistory`, `recordFailure`, the log line and `PriceRunFailure.provider` use the plan's provider (no hard-coded `YAHOO`). `refetchPriceHistory` stays Yahoo-only (splits only affect Yahoo).
- Crypto backfill (one-time): a full COINGECKO plan whose Security has a `cryptoSymbol`, whose `from` is more than 364 days before `to` and whose CoinGecko result starts after `from` also fetches Binance for `[from, day before the first CoinGecko date]` and stores both in one replace. Binance `not-found` → store CoinGecko closes, `historyFrom = from` (older dates fall back to Transaction prices). Other Binance failure → store CoinGecko closes, keep `historyFrom` null (next run retries the backfill), log a warning, no `fetchError`, not counted as failed. CoinGecko failure → the plan fails as today. Incremental crypto refreshes call only CoinGecko.
- Privacy: only the ISIN, onvista's instrument id, the coin id or `<SYMBOL>EUR` plus dates leave the server; logs carry provider, symbol and reason only.
- `src/core` untouched except if a pure helper is needed; module rules hold; tests never touch the network.

**Never:**
- No automatic failover between providers (a failing onvista/CoinGecko Security is only flagged; manual Price remains the fallback).
- No new Prisma migration, no UI change beyond what follows from the provider-aware failure data (attribution `Data provided by CoinGecko` already exists on the Securities page and its test stays green).
- No manual-price list/edit (3.5), logos (3.6), news (3.7); no Binance call outside a full crypto backfill.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Certificate | Recorded onvista query + eod for `DE000A0S9GB0`, from `2026-10-01`, to `2026-10-23` | 17 closes, `2026-10-01` → `119.05`, `2026-10-23` → `114.81` | — |
| Unknown ISIN | Recorded empty query list | `not-found`, no history request | — |
| Non-EUR listing | eod with `isoCurrency: "USD"` | `currency` | — |
| Crypto recent | Recorded `bitcoin` chart (fetched 2026-10-26 00:15 UTC) | `2026-10-16` → `72537.3051996502` … `2026-10-25` → `72126.50530116288`, `2026-10-26` → `71371.56349320017` | — |
| Unknown coin | Recorded 404 | `not-found` | — |
| Binance | Recorded `BTCEUR` 2024-01-01..05 | `2024-01-01` → `40113.43` … `2024-01-05` → `40463.66` | Recorded `-1121` → `not-found` |
| Old crypto holding | Held BTC, first BUY 2024-01-01, today 2026-10-23 | One full replace with Binance closes before the first CoinGecko date plus CoinGecko closes; `historyFrom = 2024-01-01` | Binance network → CoinGecko rows only, `historyFrom` null, retried next run |
| Failed certificate | onvista network failure | `failed: [{ provider: "ONVISTA", … }]`, mapping `fetchError = "network"`, existing rows kept | — |

</intent-contract>

## Code Map

- `src/modules/prices/providers/types.ts` -- `PriceAdapter`, `PriceFetch`, `DailyClose`, `PriceFetchFailure`; unchanged.
- `src/modules/prices/providers/shared.ts` -- `PROVIDER_TIMEOUT_MS`, `FetchLike`, `envKey`, `readJson`; reuse.
- `src/modules/prices/providers/yahoo.ts:96-144` -- reference adapter: zod schema, `byDate` map (last wins), range filter, `fetchLatest` over 7 days.
- `src/modules/prices/providers/coingecko.ts` -- has `findCoinId` (search, demo header pattern); add the price adapter here.
- `src/modules/prices/prices.ts` -- `yahooMappings` (Yahoo-only filter, replace with provider-aware mappings for plans; keep a Yahoo-only lookup for `refetchPriceHistory`), `Plan`, `heldPlans`, `storeHistory` (`provider: "YAHOO"` in `where`, `historyFrom` only when `full`), `recordFailure` (hard-coded `YAHOO`), `runPlans` (creates only the Yahoo adapter), `PriceDeps` (already has `fetch`, `env`, `now` via `MappingDeps`).
- `src/modules/prices/mappings.ts:66-79` -- `resolveMapping` already maps CERTIFICATE → `ONVISTA`/ISIN and crypto → `COINGECKO`/coin id (covered in `mappings.test.ts`); `createProviders` shows `fetch`/`env` defaults (`globalThis.fetch`, `process.env`).
- `src/modules/ledger` -- `listSecurities`/`getSecurity` give `cryptoSymbol`; `ensureSecurity({ cryptoSymbol }, { name, assetType: "CRYPTO" })` for tests.
- `src/core/decimal.ts` -- `canonicalDecimal`; `src/core/dates.ts` -- `addDays`, `businessDate`, `isBusinessDate`.
- `src/modules/prices/index.ts` -- export the new adapters (`onvistaPrices`, `coingeckoPrices`, `binancePrices`).
- `src/modules/prices/prices.test.ts:51-80` -- `mapTo`, `charts`, `deps` helpers; test at line 204 ("other providers … are skipped") must change: ONVISTA/COINGECKO are now fetched.
- `test/helpers/providers.ts` -- `recorded`, `fakeFetch` (requires a timeout signal; reply function per call for URL routing), `json`.
- `test/fixtures/providers/` -- recorded live on 2026-10-26 (public market data): `onvista-query-xetra-gold.json`, `onvista-query-not-found.json`, `onvista-eod-xetra-gold.json` (eod from 2026-10-01, 17 rows), `coingecko-market-chart-bitcoin.json` (days=10), `coingecko-market-chart-not-found.json` (HTTP 404 body), `binance-klines-btceur.json` (2024-01-01..05), `binance-klines-invalid-symbol.json` (HTTP 400 body).
- `src/app/(app)/securities/page.tsx:42-46`, `page.test.tsx:56` -- CoinGecko attribution already rendered and tested.
- `src/app/_components/securities/labels.ts` -- `PROVIDER_LABELS` (onvista, CoinGecko) used by the failure row and snackbar; no change expected.

## Tasks & Acceptance

**Execution:**
- `src/modules/prices/providers/onvista.ts` (+ `onvista.test.ts`) -- `onvistaPrices({ fetch })` adapter per Boundaries; tests with recorded fixtures: closes, request URLs (privacy), not-found query, currency, schema, 404, network, range filter, `fetchLatest`.
- `src/modules/prices/providers/coingecko.ts` (+ `coingecko.test.ts`) -- `coingeckoPrices({ fetch, apiKey, now })` adapter; tests: recorded chart dated per the UTC rule, `days` computation incl. clamp to 365, demo header only with key, 404 not-found, schema, network.
- `src/modules/prices/providers/binance.ts` (+ `binance.test.ts`) -- `binancePrices({ fetch })` adapter; tests: recorded klines, invalid symbol (recorded `-1121`), malformed symbol without request, pagination over a synthetic 1000-row page, network.
- `src/modules/prices/prices.ts` (+ `prices.test.ts`) -- provider-aware plans, adapters per provider, provider in store/failure, crypto Binance backfill rules; tests: held certificate and held crypto get PROVIDER rows, old crypto holding uses Binance once (second run makes no Binance call), Binance not-found vs network outcomes, onvista failure reported with provider `ONVISTA`, existing Yahoo tests unchanged in behavior.
- `src/modules/prices/index.ts` -- export the adapters.

**Acceptance Criteria:**
- Given a held CERTIFICATE Security auto-mapped to onvista, when `refreshPrices(today)` runs against recorded onvista responses, then its PROVIDER rows hold the recorded EUR closes from its first activity date and its mapping records `fetchedAt` and `historyFrom`.
- Given a held CRYPTO Security mapped to CoinGecko whose first BUY is more than 365 days ago, when the first full backfill runs, then rows exist from Binance for the older dates and from CoinGecko for the last 365 days, and a later `refreshPrices` calls only CoinGecko.
- Given an onvista or CoinGecko fetch failure, when a price run ends, then that Security is in `failed` with its own provider, its mapping has `fetchError`, its existing rows are kept, no other provider is tried and other Securities are still updated.
- Given the Securities page, when it renders, then `Data provided by CoinGecko` is visible.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 27 findings — high 0, medium 1, low 16, false 7, maybe-false 3
- findings:
  - `[low]` `[reject]` (blind) A persistent non-`not-found` Binance failure (e.g. HTTP 451 geo-block) keeps `historyFrom` null, so every run does a full CoinGecko replace plus a Binance call, unflagged — the spec's chosen retry rule; costs two extra requests per day for one crypto holding, Binance EUR pairs are reachable from Germany; changing it edits the spec's rule.
  - `[low]` `[reject]` (blind) Coins without a Binance `<SYMBOL>EUR` pair permanently lack history older than 365 days, with no signal — the spec's intended outcome (older dates fall back to Transaction prices); a "partial history" state adds new state.
  - `[maybe-false]` `[reject]` (blind) A certificate whose onvista default listing is not EUR fails with `currency` forever — unknown whether German certificates ever default to a non-EUR notation (the recorded one is EUR); if true only low (manual Price / mapping edit remain), fix adds notation selection.
  - `[low]` `[reject]` (blind) onvista instrument id is looked up on every refresh (two requests per certificate) — a few requests per day at single-user scale; caching needs new stored state.
  - `[low]` `[reject]` (blind) CoinGecko calls are not paced; many crypto holdings could hit HTTP 429 — Demo key allows ~30/min, a single user holds a handful of coins; pacing adds new machinery.
  - `[low]` `[reject]` (blind) Crypto closes dated by UTC day, not Europe/Berlin, and today's intraday point is stored as today's close — deliberate and recorded in Design Notes (CoinGecko/Binance candles are UTC; the two sources splice without gap); Yahoo also stores today's intraday bar, which the 7-day overlap replaces.
  - `[maybe-false]` `[reject]` (blind) onvista ignores `ctx.splits`, and split edits never refetch onvista history — certificates practically never split; unknown whether onvista eod is adjusted; if true only low.
  - `[low]` `[reject]` (blind) `getSecurity` throwing inside `withCryptoBackfill` discards fetched CoinGecko closes and records a COINGECKO `unexpected` failure — needs a local SQLite read error mid-run; the outcome is safe (rows kept, retried next run); same class rejected in 3.3.
  - `[false]` `[reject]` (blind) Test gaps (Binance schema at service level, `refetchPriceHistory` for non-Yahoo, crypto/cert `backfillHeldPrices`, onvista currency end-to-end, crypto without `cryptoSymbol`, long onvista history) — `refetchPriceHistory` for an ONVISTA mapping is tested ("does nothing for a Security not mapped to Yahoo", `prices.test.ts`); the other paths are the same code exercised by adapter tests and the service tests through `refreshPrices`/`heldPlans`.
  - `[low]` `[patch]` (blind) `binance.test.ts` case labelled "HTTP 418 / other errors" replies with HTTP 429 — label renamed to "HTTP 429".
  - `[low]` `[reject]` (edge) Persistent Binance failure retried forever — same as the first blind row.
  - `[low]` `[reject]` (edge) After an earlier BUY moves first activity back, a Binance network failure during the new full plan deletes previously stored Binance rows until a retry succeeds — needs a backdated crypto BUY coinciding with a Binance outage; self-heals on the next run (historyFrom stays null); keeping old rows adds a storage branch.
  - `[low]` `[reject]` (edge) Incremental CoinGecko plan reaching back more than 365 days (re-bought after a long sell-out) leaves a gap — the gap lies in the sold-out period where the Position holds nothing, so no valuation uses it; fix adds a planning branch.
  - `[low]` `[reject]` (edge) `getSecurity` throwing in the backfill — same as the blind row.
  - `[maybe-false]` `[defer]` (edge) Null entries in onvista eod arrays fail the whole history as `schema` — unverified (recorded data has none); if true medium; deferred with what would settle it.
  - `[medium]` `[patch]` (verification-gap) No service-level test proves `COINGECKO_API_KEY` reaches the CoinGecko price request — added a `refreshPrices` test asserting `x-cg-demo-api-key: cg-key` with the key set and no header for a blank key; mutation (dropping the key in `createAdapters`) fails it.
  - `[low]` `[reject]` (verification-gap, other) Failed Binance backfill deletes older stored rows — same as the edge first-activity row.
  - `[false]` `[reject]` (intent) Reading B (awaiting-operator for the CoinGecko Demo key) — the key is already set in the operator's `.env` (`COINGECKO_API_KEY` non-empty) and the code also works keyless; nothing is owed.
  - `[false]` `[reject]` (intent) Changes uncommitted — finalization commits them.
  - `[false]` `[reject]` (intent) "Mapping defaults to onvista for certificates" not exercised in the refresh flow — covered by `mappings.test.ts` (`resolveMapping` CERTIFICATE → ONVISTA, `resolveMissingMappings` turbo row) and `refreshPrices` resolves missing mappings first (existing test).
  - `[low]` `[reject]` (intent) `fetchLatest` is never called by the service — the AD-9 interface requires it and it is tested per adapter; the service fetches history up to today, as for Yahoo since 3.2.
  - `[low]` `[reject]` (intent) No test that a failed onvista/CoinGecko Security shows the stale flag — `securityPriceInfo`/stale badge are provider-agnostic and tested in 3.3.
  - `[false]` `[reject]` (intent) CoinGecko attribution not exercised — `src/app/(app)/securities/page.test.tsx:56` asserts it and passed in this run.
  - `[low]` `[reject]` (intent) "One-time" Binance backfill is retried after a network failure — it still succeeds at most once; the retry is the spec's fail-soft choice.
  - `[low]` `[reject]` (intent) Crypto rows use the UTC date convention — same as the blind UTC row.
  - `[false]` `[reject]` (intent) Live provider contract unverified — tests must never hit live providers (AGENTS.md); fixtures were recorded live on 2026-10-26.
  - `[false]` `[reject]` (intent) No check that Yahoo is not tried for a failing Security — the failure test asserts `chart` is called exactly once (for SAP) and no Binance request.

## Design Notes

- Crypto dates use the UTC day (CoinGecko's and Binance's daily candles are UTC); the 00:00 UTC CoinGecko point equals Binance's close of the previous UTC day, so both sources date the same instant identically and splice without a gap or overlap.
- onvista accepts Node's default `fetch` User-Agent (curl's is rate-limited); `range=MAX&startDate=<from>` returns everything from `from` to now in one call, without choosing a notation (onvista's default listing).
- Binance failure other than `not-found` keeps `historyFrom` null instead of failing the plan, so recent CoinGecko prices are never withheld because of the old-history source.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "Number(\|parseFloat" -- src/modules/prices` -- expected: no numeric arithmetic on prices.

## Auto Run Result

Status: done

**Summary:** Certificates mapped to onvista and crypto mapped to CoinGecko now get Prices in every price run (scheduler, "Kurse aktualisieren", backfill after ledger writes). Three new AD-9 adapters — onvista (unofficial JSON: ISIN query + `eod_history`), CoinGecko (`market_chart`, ≤ 365 days, Demo key header from `COINGECKO_API_KEY`) and Binance (`klines`, `<SYMBOL>EUR`, 1d, paginated) — return typed fail-soft results. The price service plans all three providers, records failures under the plan's own provider (no more hard-coded `YAHOO`), and runs a one-time Binance backfill for crypto history older than CoinGecko's window. No automatic failover; the CoinGecko attribution on the Securities page already existed and its test passes.

**Files changed:**
- `src/modules/prices/providers/onvista.ts` (+ test) — onvista price adapter by ISIN.
- `src/modules/prices/providers/coingecko.ts` (+ test) — CoinGecko price adapter next to the existing coin-id search.
- `src/modules/prices/providers/binance.ts` (+ test) — Binance klines adapter for the old-history backfill.
- `src/modules/prices/providers/shared.ts` — JSON GET with timeout, UTC date helpers, sorted closes, shared `fetchLatest`.
- `src/modules/prices/prices.ts` (+ test) — provider-aware plans, adapters per provider, provider in store/failure/log, crypto Binance backfill; split refetch stays Yahoo-only.
- `src/modules/prices/index.ts` — exports the new adapters.
- `test/fixtures/providers/{onvista,coingecko-market-chart,binance-klines}-*.json` — responses recorded live on 2026-10-26 (public market data: Xetra-Gold ETC, BTC).

**Review findings:** 27 total — 2 patches applied (medium 1: service-level test that `COINGECKO_API_KEY` reaches the CoinGecko price request; low 1: Binance test label), 1 deferred (onvista null entries, unverified), 24 rejected (7 false, 15 low, 2 maybe-false; reasons in the triage log — mainly: Binance failures retried daily by design, missing EUR pair leaves pre-365-day history to Transaction prices, onvista default notation and per-run lookup, no CoinGecko pacing, deliberate UTC dating for crypto, DB-error edge in the backfill, gap during a long sell-out).

**Follow-up review recommendation:** false — first pass patched no `high` and only one `medium` (patched counts: high 0, medium 1, low 1).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (94 test files, 1388 tests; build OK; no live network in tests). `git grep -n "Number(\|parseFloat" -- src/modules/prices` — no matches. Matrix audit: every row covered by a passing test. One matrix cell is a planning arithmetic error: the "Crypto recent" row lists `2026-10-25 → 72126.50530116288`, but the binding Always rule (point dated by the UTC date of `ms − 1`, which the row's own first value `2026-10-16 → 72537.30…` requires) dates that point `2026-10-24` and gives `2026-10-25 → 71362.90754813094`; the test asserts the rule-consistent values.

**Operator actions:** none — the AC's CoinGecko Demo key is already set in the operator's `.env` (`COINGECKO_API_KEY` non-empty), and the adapter also works keyless.

**Residual risks:** onvista's API is unofficial and may change or rate-limit (curl's default User-Agent is already refused; Node's `fetch` is accepted); a coin without a Binance EUR pair has no provider history older than 365 days; a persistent non-`not-found` Binance failure repeats the full crypto replace daily; onvista eod nulls (deferred) would fail a certificate as `schema`; live provider behaviour is verified only against recorded responses.
