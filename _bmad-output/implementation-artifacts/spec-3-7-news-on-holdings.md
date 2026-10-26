---
title: 'News on holdings'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '57b434e9829855dbc5640000294b874ea4c69a50'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** "Nachrichten" (`/news`) is a placeholder; there is no news fetching, cache or list for held Securities (FR14, AD-11).

**Approach:** New `news` module that fetches headlines per held Security (AD-17) from Google News RSS (de + en) and `yahoo-finance2` search news, merges and de-duplicates them into a per-Security cache, refreshes with the daily scheduler run and on page open when older than 4 hours, and a `/news` page listing the last 14 days newest first with logo, name, source, date, external link and a Security filter.

## Boundaries & Constraints

**Always:**
- Only `news` reads/writes its models; it reaches `ledger`/`prices` only via their `index.ts` (`listHeldSecurities`, `listSecurities`, `listSecuritiesWithMappings`). Writing services accept an optional Prisma tx client. New Prisma migration; existing migrations untouched.
- Models: `enum NewsProvider { GOOGLE_NEWS YAHOO }`; `NewsArticle` (`id`, `securityId` FK cascade, `url`, `title`, `source`, `publishedAt` UTC ISO string, `provider`, `fetchedAt` UTC ISO; `@@unique([securityId, url])`); `NewsFetch` (`securityId` PK + FK cascade, `fetchedAt` UTC ISO) = last successful refresh of that Security.
- Query terms (never ISIN, never quantities/values/Depot data): `newsTerm(name)` = Security name with trailing legal-form tokens stripped repeatedly (case-insensitive: AG, SE, KGaA, GmbH, Inc, Corp, Corporation, plc, NV, N.V., SA, S.A., Ltd, Co, Holding, Holdings; trailing `.`/`,`/`&` and extra spaces removed); empty result → original name. Google: `"<term>" when:14d`. Yahoo: the YAHOO mapping symbol if the Security is mapped to YAHOO, else the term.
- Google News RSS: `https://news.google.com/rss/search?q=<encoded>&hl=de&gl=DE&ceid=DE:de` and `…&hl=en-US&gl=US&ceid=US:en`; injected `FetchLike`, 10 s timeout. Parse `<item>`s without a new dependency: `title`, `link`, `pubDate` (RFC 822), `source` text; decode XML entities (named, `&#N;`, `&#xH;`) and CDATA; strip a trailing ` - <source>` from the title. Non-2xx, network error, timeout or a body without `<channel` → provider error; a valid empty channel → zero articles.
- Yahoo: `search(query, { quotesCount: 0, newsCount: 10 }, { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(10 s) } })`, own lazily loaded client (copy the loader from `prices/providers/yahoo.ts`, do not import it); validate with zod (`news[]` with `title`, `publisher`, `link`, `providerPublishTime` as Date, epoch seconds/ms number or ISO string). Throw/schema mismatch → provider error.
- Every article: `url` must parse as `http:`/`https:` (else dropped); title/source trimmed, empty dropped, capped at 300/100 chars; unparsable date dropped.
- Refresh `refreshNews({ onlyStale?, now?, deps? }, db?)` (serialized on a globalThis queue): held set = `listHeldSecurities(businessDate(now))`; `onlyStale` limits it to held Securities without `NewsFetch` or `fetchedAt` older than `NEWS_MAX_AGE_HOURS = 4`. Per Security (sequentially): query Google de, Google en, Yahoo. If all three failed → nothing written for it (stays stale, retried later). Otherwise merge successful results: keep articles whose Berlin business date is in the window (`addDays(today, -13)` … `today`), de-duplicate by URL or normalized title (lowercase, whitespace collapsed) keeping the first in provider order Google de → Google en → Yahoo, keep the newest `NEWS_PER_SECURITY_LIMIT = 30`, and in one DB transaction replace that Security's articles and upsert its `NewsFetch`. Every run also deletes articles/fetch rows of Securities no longer held. Result `{ updated, failed: { securityId, name }[] }`; never throws for provider failures; logs never contain URLs with terms, amounts or keys.
- Read `listNews(today, securityId?, db?)` → `{ securities: { id, name }[] (held, name de-DE sorted), articles: { id, securityId, name, title, url, source, publishedAt }[] }` — only held Securities, only the 14-day window, newest `publishedAt` first (tie: title); unknown/non-held `securityId` → unfiltered. `newsNeedsRefresh(now)` → true when any held Security is stale (as above).
- Scheduler: `startBackgroundJobs` starts the price scheduler with a run that executes `refreshPrices(today)` and afterwards (also when it failed) a full `refreshNews()` whose failure is only logged.
- Page open: `/news` (server component, reads `searchParams.security`) renders cached data immediately; when `newsNeedsRefresh` it renders client `NewsAutoRefresh` (pattern `MappingAutoResolver`) which once after mount calls `refreshNewsAction()` (session check → `UNAUTHORIZED`; `refreshNews({ onlyStale: true })`, `revalidatePath("/news")`) and then `router.refresh()`. Progress text "Nachrichten werden aktualisiert …" with LinearProgress; failure Alert "Nachrichten konnten nicht aktualisiert werden." or, for partial failures, "Nachrichten für N Wertpapiere konnten nicht geladen werden." with "Erneut versuchen" (not for unauthorized).
- UI: PageTitle "Nachrichten"; filter select labelled "Wertpapier" with "Alle Wertpapiere" + held Securities, navigating to `/news?security=<id>` / `/news` (hidden when nothing is held); list rows: `SecurityLogo` + Security name, headline, meta "<source> · dd.mm.yyyy" (Berlin date of `publishedAt`), whole row is an `<a href target="_blank" rel="noopener noreferrer">` with ≥ 44 px height and an accessible name containing the headline; empty state "Keine Nachrichten der letzten 14 Tage." Works at phone width.

**Never:**
- No ISIN, quantity, value or Depot data in any outbound news request; no browser request to a news provider except the user clicking an article link.
- No news in ledger data or in any backup; no change to `src/core`, price fetching logic or logos; no overview/position-detail news widgets (Epic 4); no XML dependency.
- Tests never hit live providers (synthetic recorded RSS/JSON fixtures, fake `fetch`/`search`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | SAP SE held, de/en feeds + Yahoo news | merged, deduped, newest first; `NewsFetch` set | — |
| Same article twice | same URL in de and en, same title in Yahoo | stored once, as GOOGLE_NEWS | — |
| Window | articles 13 days old and 20 days old | 13-day kept, 20-day dropped | — |
| Partial failure | Google 503, Yahoo ok | Yahoo articles replace cache, `NewsFetch` updated | logged |
| Total failure | all three fail | previous cache untouched, no `NewsFetch` update, Security in `failed` | logged |
| Bad items | `javascript:` link, missing date, empty title | item dropped | — |
| Malformed feed | 200 HTML without `<channel` | provider error | — |
| Not held | Security sold out / Depot archived | not queried; its cached rows deleted on next run | — |
| Only stale | one Security refreshed 1 h ago, one 5 h ago | only the 5 h one queried | — |
| Query privacy | Security with ISIN DE0007164600, name "SAP SE" | Google `q` = `"SAP" when:14d`; ISIN in no URL | — |
| Unauthorized action | no session | `{ ok:false, reason:"unauthorized" }`, no fetch | typed result |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add `NewsProvider`, `NewsArticle`, `NewsFetch` (+ `newsArticles NewsArticle[]`, `newsFetch NewsFetch?` relations on Security; comment "owned by the news module (AD-11)", pattern `SecurityLogo` at ≈line 180). New `prisma/migrations/20261026180000_add_news/` via `prisma migrate dev --create-only` against a temp `DATABASE_URL`, then `npx prisma generate`.
- `src/modules/ledger/index.ts` -- `listHeldSecurities(asOf, db)` (ids, `depots.ts:209`), `listSecurities(db)` (`id,name,isin,cryptoSymbol,assetType`).
- `src/modules/prices/index.ts` -- `listSecuritiesWithMappings(db)` → `mapping: { provider, symbol } | null` (YAHOO symbol for the Yahoo query).
- `src/modules/prices/providers/shared.ts` -- `FetchLike`, `PROVIDER_TIMEOUT_MS`, `Lookup` patterns; copy what is needed into `src/modules/news/providers/shared.ts` (module boundary).
- `src/modules/prices/providers/yahoo.ts:18-40` -- lazy `yahoo-finance2` client and `search` call to mirror.
- `src/modules/prices/prices.ts:48-58` -- `serialized()` globalThis queue; `src/modules/prices/mappings.ts` `inTransaction` helper pattern for optional tx.
- `src/core/dates.ts` -- `businessDate(Date)`, `addDays`; `src/core/format.ts` -- `formatDate`.
- New `src/modules/news/` -- `index.ts`, `news.ts` (`refreshNews`, `listNews`, `newsNeedsRefresh`, constants), `terms.ts` (`newsTerm`), `providers/{shared,google-news,yahoo}.ts` (`google-news.ts` holds the RSS parser).
- `src/instrumentation-node.ts` `startBackgroundJobs` -- pass `run` to `startPriceScheduler` composing `refreshPrices` + news (import `refreshPrices` from `@/modules/prices`); extend `src/instrumentation-node.test.ts` (mock `@/modules/news`; existing mock of `@/modules/prices/prices` keeps working).
- New `src/app/_actions/news.ts` (+ test) -- `refreshNewsAction()`; pattern `resolveMissingMappingsAction` in `src/app/_actions/securities.ts:39`.
- `src/app/(app)/news/page.tsx` (+ `page.test.tsx`) -- replace Placeholder; pattern `src/app/(app)/securities/page.tsx` and its test (`useMigratedDatabaseForSingleton`, `renderText`/`renderHtml`, mocks).
- New `src/app/_components/news/{NewsAutoRefresh,NewsFilter,NewsList}.tsx`, `labels.ts` (+ dom tests) -- patterns `MappingAutoResolver.tsx`, `SecurityLogo.tsx` (`securityId`, `name`), `TOUCH_TARGET` from `securities/SecurityDialog.tsx`, `test/helpers/dom.tsx`.
- `test/helpers/providers.ts` -- add `recordedText(name)` for `test/fixtures/providers/<name>` text files; new synthetic fixtures `google-news-rss-sap-de.xml`, `google-news-rss-sap-en.xml`, `google-news-rss-empty.xml`, `yahoo-search-news-sap.json` (fictitious headlines, `example.com`-style article URLs).

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + migration -- news cache models.
- `src/modules/news/providers/*` (+ tests with recorded fixtures) -- URL building, parsing, entity/CDATA decoding, title suffix strip, item validation, error mapping.
- `src/modules/news/terms.ts` (+ test) -- legal-form stripping examples.
- `src/modules/news/news.ts`, `index.ts` (+ real-DB tests) -- every I/O matrix row, pruning, cap, ordering, filter, `newsNeedsRefresh`, serialization.
- `src/instrumentation-node.ts` (+ test) -- news after price run, also after a failed price run; failure logged.
- `src/app/_actions/news.ts` (+ test) -- unauthorized / success with revalidate.
- `src/app/_components/news/*` (+ dom tests) and `src/app/(app)/news/page.tsx` (+ test) -- list, filter navigation, empty state, auto-refresh states, external link attributes.

**Acceptance Criteria:**
- Given held Securities with cached headlines, when I open "Nachrichten", then I see the last 14 days newest first, each with the Security logo and name, source, date and a link opening the original article in a new tab.
- Given the filter, when I choose a Security, then only its headlines are shown; "Alle Wertpapiere" shows all again.
- Given a cache older than 4 hours, when I open the page, then cached headlines show immediately and the refresh runs once after render, then the list updates.
- Given the daily scheduler run, when it executes, then news is refreshed after the price run even if the price run failed.
- Given no headlines in the window, when I open the page, then it shows "Keine Nachrichten der letzten 14 Tage."

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 20, false 5, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) Page-open refresh queries all providers strictly one after another, so ~30 holdings keep the progress bar running for tens of seconds — the three lookups of one Security now run concurrently (`Promise.all`); Securities stay sequential (politeness to the unofficial endpoints) and the merge order Google de → en → Yahoo is unchanged.
  - `[low]` `[reject]` (blind) Securities whose providers all fail are retried on every page open without backoff — only when all three providers fail for a Security (practically a network outage); a cooldown needs new state.
  - `[low]` `[reject]` (blind) A partial failure replaces a good cache with the surviving provider's articles for 4 h — spec matrix row; only after a transient Google failure; keeping per-provider rows adds merge branches.
  - `[low]` `[reject]` (blind) Empty-state text shows under the progress bar on the very first visit / says "no news" when nothing is held — first visit only; the text stays factually true; a loading-aware empty state needs client/server coordination.
  - `[low]` `[patch]` (blind) `newsTerm` missed KG, LLC, A/S, ASA, AB, Oyj, S.p.A., Aktiengesellschaft, Limited (test locked in the unchanged KG name) — tokens added; tests now expect "Muster", "Novo Nordisk" etc.
  - `[low]` `[reject]` (blind) ETFs/certificates send long exact-phrase names to Google that rarely match — two cheap requests; Yahoo covers ETFs via ticker; asset-type branching is a new rule.
  - `[low]` `[reject]` (blind) Synthetic fixtures use direct article URLs while real Google items are redirect URLs, so cross-edition URL de-dupe may not fire — identical headlines are still removed by the normalized-title de-dupe; parsing does not depend on the URL form.
  - `[low]` `[reject]` (blind) The page computes the held set twice (`listNews` + `newsNeedsRefresh`) — single user, a few ms; sharing it needs a new service signature.
  - `[low]` `[patch]` (blind) New-tab links not announced to screen readers — visually hidden " (öffnet in neuem Tab)" added to every link (`NEW_TAB_HINT`), asserted in the dom test.
  - `[low]` `[reject]` (blind) Control characters / lone surrogates decoded, 300/100-char slicing can split a surrogate pair — needs such entities or > 300-char titles from Google/Yahoo; fix adds sanitising guards.
  - `[low]` `[reject]` (blind) Feed body size unbounded; lazy item regex quadratic on many unclosed `<item` tags — requires a malformed multi-MB body from Google; a byte cap adds stream handling.
  - `[low]` `[reject]` (blind) Scheduled run does a full refresh even right after a page refresh / after each restart, and the price-run log waits for news — spec rule (daily full refresh); restarts are rare; at most ~90 extra requests.
  - `[low]` `[reject]` (blind) Missing tests: tx-client branch of `inTransaction`, prune with nothing held, held Security missing from the mapping list — no caller passes a tx client yet; a wrong prune leaves only rows `listNews` already ignores; the missing-Security case is unreachable except for a delete racing the run (false part).
  - `[low]` `[reject]` (blind) Expired-session alert has no login link — same behaviour as `MappingAutoResolver`; the proxy redirects to login on the next navigation.
  - `[low]` `[reject]` (edge) Filter navigation remounts `NewsAutoRefresh` and re-runs the refresh — same root cause as the no-backoff row: after a successful run nothing is stale and the component is not rendered; only all-provider failures repeat.
  - `[false]` `[reject]` (edge) A Yahoo search could ignore the timeout via the crumb/cookie fetch — `yahoo-finance2` `yahooFinanceFetch.js:60-74` passes the module `fetchOptions` (incl. the signal) to `getCrumb`, which spreads them into every fetch (`getCrumb.js:77-117`).
  - `[low]` `[reject]` (edge) A `fetchedAt` in the future (clock moved back) is never stale — needs a backwards clock jump; the next scheduled full refresh rewrites it anyway.
  - `[low]` `[reject]` (edge) Unbounded response body — same root cause as the blind size-limit row.
  - `[low]` `[reject]` (edge) A DB write failure for one Security (deleted mid-run) rejects the whole run — needs a Security deletion during a refresh; the next run recovers; a per-Security catch adds a branch.
  - `[false]` `[reject]` (edge) Links go to Google redirects, not the original article — the redirect opens the original article (documented in Design Notes); the de-dupe part is covered by the fixture row above.
  - `[low]` `[reject]` (edge) "Refresh runs once after render" claim breaks on remount — same root cause as the no-backoff row.
  - `[low]` `[patch]` (verification-gap) The real `yahooNewsSearch` options were never exercised — new `src/modules/news/providers/yahoo-client.test.ts` mocks `yahoo-finance2` and asserts `quotesCount: 0`, `newsCount: 10`, `validateResult: false` and an AbortSignal.
  - `[false]` `[reject]` (intent) Live providers and the real Next runtime/scheduler are not exercised — the repo forbids live provider calls in tests; synthetic fixtures are policy; no human-only action exists, so no awaiting-operator.
  - `[false]` `[reject]` (intent) "Not backed up" is not verified — no backup/export exists yet; Epic 6 (AD-12) must exclude the news tables.
  - `[false]` `[reject]` (intent) Orchestration state (commit, final status) not in the diff — handled at finalization.

## Design Notes

- De-duplication is per Security: an article matching two holdings appears once under each, so the filter stays correct.
- Google News links are Google redirect URLs that open the original article; resolving them would need extra requests per article.
- `when:14d` limits Google results server-side; the local window filter is still authoritative. Quoted terms keep multi-word names precise; ETFs with long names mostly get Yahoo results via their ticker.
- A minimal RSS parser avoids a new dependency for one fixed, simple feed format; synthetic fixtures pin it.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "news.google.com" -- src/app` -- expected: no matches (provider URLs only in `src/modules/news`).

## Auto Run Result

Status: done

**Summary:** New `news` module (AD-11/AD-17) with `NewsArticle`/`NewsFetch` cache models (+ migration). Per held Security it queries Google News RSS (de + en, exact-phrase name term with legal forms stripped, `when:14d`) and `yahoo-finance2` search news (Yahoo ticker or name term) — never the ISIN — merges and de-duplicates by URL/normalized title, keeps the 14-day Berlin window and the newest 30, and replaces the Security's cache in one transaction (all-provider failure leaves the cache untouched and stale). The daily price scheduler run refreshes news afterwards (also after a failed price run). `/news` renders the cache immediately, refreshes stale Securities once after render via `refreshNewsAction`, and lists headlines newest first with logo, name, source, date and a new-tab link, a "Wertpapier" filter (`?security=`) and the empty state "Keine Nachrichten der letzten 14 Tage.". No human-only action is required (no API key).

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261026180000_add_news/` — news cache models.
- `src/modules/news/{index,news,terms}.ts`, `providers/{shared,google-news,yahoo}.ts` (+ tests, incl. `yahoo-client.test.ts`) — providers, RSS parser, refresh/list services.
- `src/instrumentation-node.ts` (+ test), `src/instrumentation.test.ts` — news refresh after the scheduled price run.
- `src/app/_actions/news.ts` (+ test) — on-open refresh action.
- `src/app/(app)/news/page.tsx` (+ test), `src/app/_components/news/{NewsAutoRefresh,NewsFilter,NewsList,labels}` (+ tests) — news page.
- `test/helpers/providers.ts`, `test/fixtures/providers/{google-news-rss-*.xml,yahoo-search-news-sap.json}` — synthetic recorded fixtures.

**Review findings:** 25 total — 4 patched (all low: concurrent per-Security lookups, more legal forms, screen-reader new-tab hint, real Yahoo client options test), 0 deferred, 21 rejected (5 false: Yahoo crumb timeout, Google redirect links, three intent-auditor rows on live/backup/orchestration; 16 low — reasons per row in the triage log: no-backoff retries and remount re-runs, partial-failure cache replacement, first-visit empty state, ETF exact-phrase misses, fixture URL realism, double held-set computation, text sanitising, body size cap, scheduler full refresh, missing tx/prune tests, session alert link, future fetchedAt, per-Security DB failure).

**Follow-up review recommendation:** false — patched counts: high 0, medium 0, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (114 test files, 1601 tests; build OK). `git grep -n "news.google.com" -- src/app` — no matches. Matrix audit: every I/O row covered by passing tests in `src/modules/news/news.test.ts`, `providers/google-news.test.ts`, `providers/yahoo.test.ts` and `src/app/_actions/news.test.ts`.

**Residual risks:** Google News RSS and Yahoo news response shapes are pinned only by synthetic fixtures (never checked live); Google item links are redirect URLs; a refresh of many stale holdings still takes several seconds (Securities processed one by one); a Security whose providers all fail is re-queried on every page open; Epic 6 backup/restore must exclude and clear the news tables.
