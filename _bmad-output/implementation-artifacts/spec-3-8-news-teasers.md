---
title: 'News teasers'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '03003de948b98d8628be44d55eac05d9994ce8e3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** News items only carry a headline and send the user straight to overloaded article sites; Google News RSS has no text, so nothing can be read in the app first (Story 3.8, Addendum L, CAP-14).

**Approach:** Add a fourth news provider, the unofficial Yahoo Finance RSS feed per Yahoo symbol (stocks and crypto), storing the item description as a cleaned, trimmed `teaser` and keeping only items that mention the Security; de-duplication prefers items with a teaser; "Nachrichten" and Security detail render teaser items as keyboard-accessible accordions with "Zum Artikel".

## Boundaries & Constraints

**Always:**
- Only `news` reads/writes its models. New Prisma migration (`prisma migrate dev --create-only` against a temp `DATABASE_URL`, then `npx prisma generate`): `NewsArticle.teaser String?` (plain text, `null` = no teaser) and enum value `NewsProvider.YAHOO_RSS`. Existing migrations untouched.
- Yahoo symbol of a held Security: the YAHOO `ProviderMapping` symbol when `assetType` is STOCK or UNCLASSIFIED; for CRYPTO the YAHOO mapping symbol if any, else `<cryptoSymbol upper-case>-EUR` when `cryptoSymbol` is set. ETF, FUND, CERTIFICATE and Securities without a Yahoo symbol are not queried by this provider. Only the symbol leaves the server (AD-13).
- URL: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=<encodeURIComponent(symbol)>&region=DE&lang=de-DE`; injected `FetchLike`, `PROVIDER_TIMEOUT_MS`. Reuse the RSS helpers of `google-news.ts` (`textContent`, `decodeEntities`, item/element parsing) — extract them to `providers/rss.ts` instead of duplicating. Item: `title`, `link`, `pubDate`, `source` element text if present else `"Yahoo Finance"`, `description` → teaser.
- Teaser cleanup (`teaserText`): text content (CDATA/entities decoded), then tags removed again and entities decoded again (descriptions are often entity-encoded HTML), whitespace collapsed, trimmed; empty → `null`. Longer than `TEASER_MAX_LENGTH = 600`: cut after the last sentence end (`.`, `!`, `?` followed by whitespace) at or before 600 if that leaves ≥ 200 characters, else at the last whitespace before 600 with `…` appended (result ≤ 600 chars incl. `…`).
- Name filter (`mentionsSecurity`), RSS items only: keep an item when its title or teaser contains `newsTerm(name)` case-insensitively on word boundaries (Unicode letters/digits as word chars), or the symbol base (part before the first `.` or `-`, e.g. `SAP.DE` → `SAP`, `BTC-EUR` → `BTC`) as a case-sensitive whole word.
- Failure: non-2xx, network error, timeout, body without `<channel`, or a channel with zero items → provider error (`NEWS_ERROR`) for that Security only, logged without URL/symbol. A run's RSS requests are spaced: consecutive RSS requests start at least `YAHOO_RSS_SPACING_MS = 1000` apart (injected `sleep` dep, default `setTimeout`-based; tests inject a no-op/recording fake). Fetch frequency is the existing rule (daily full run + page open when older than `NEWS_MAX_AGE_HOURS`).
- Merge: lookups Google de → Google en → Yahoo search → Yahoo RSS (when queried). "All failed" means every queried provider failed. De-duplicate by URL or normalized title: on a duplicate, an item with a non-null teaser replaces an earlier one without; otherwise the first wins. Window, newest-30 cap and ordering unchanged. Google and Yahoo search items have `teaser: null`.
- `listNews` articles gain `teaser: string | null`; `clearNews` and the restore path keep purging everything (teasers are cache, not backed up, AD-11/AD-12).
- UI (`NewsList`, used by `/news` and Security detail): item without teaser — unchanged row link. Item with teaser — a button row (`aria-expanded`, `aria-controls`, ≥ 44 px, Enter/Space toggle) with logo, name, headline, meta "<source> · dd.mm.yyyy" and a visible marker "Kurztext" (small icon + text) plus expand icon; expanded panel (`role="region"`, labelled by the button) shows the teaser, "<source> · dd.mm.yyyy" and a link "Zum Artikel" (`target="_blank" rel="noopener noreferrer"`, `NEW_TAB_HINT`). Several items may be open at once. Works at phone width; German labels in `labels.ts`.

**Never:**
- No fetch or scraping of article pages, no following/circumventing redirects or consent walls (AD-11); no ISIN, quantity, value or Depot data in requests; no browser call to Yahoo.
- No teaser in backup/export; no change to `src/core`, prices or Overview `LatestNews` behaviour; no XML dependency; no name filter on Google/Yahoo-search items.
- Tests never hit Yahoo: synthetic fixtures only (`test/fixtures/providers/yahoo-rss-*.xml`, fictitious text, `example.com` URLs).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | SAP SE (STOCK, YAHOO `SAP.DE`), RSS with 3 matching items | items stored as YAHOO_RSS with teasers; request only `s=SAP.DE` | — |
| Entity HTML | description `&lt;p&gt;SAP &amp;amp; Co&lt;/p&gt;` | teaser `SAP & Co` | — |
| Long teaser | 900-char description, sentence end at 480 | cut after that sentence | — |
| No sentence end | 900 chars, no `.!?` | cut at word, ends with `…`, ≤ 600 | — |
| Unrelated item | title/teaser without "SAP" | dropped | — |
| Duplicate | same normalized title from Google de and RSS | one row, RSS with teaser | — |
| Old item | RSS item 20 days old | dropped | — |
| ETF | ETF with YAHOO mapping | no RSS request | — |
| Crypto | CRYPTO `BTC`, COINGECKO mapping | RSS `s=BTC-EUR` | — |
| RSS fails | 503 / HTML / empty channel, Google ok | Google items stored, Security not in `failed` | warn logged |
| Spacing | two stock Securities | second RSS request after `sleep(≥1000)` | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma:245-266` -- `NewsProvider` enum, `NewsArticle` model; add `YAHOO_RSS`, `teaser String?` (doc comment). Latest migration `prisma/migrations/20261028000000_add_security_classification` → new one sorts after it.
- `src/modules/news/news.ts` -- `refreshNews` (≈line 125: per-Security `Promise.all` of lookups; add RSS lookup + spacing), `merge` (≈line 103: teaser-wins rule), `listNews` (select `teaser`), `NewsListArticle` (+`teaser`), `NewsDeps` (+`sleep`), `ProviderArticle`. `security` from `listSecuritiesWithMappings` carries `assetType`, `cryptoSymbol`, `mapping`.
- `src/modules/news/providers/shared.ts` -- `FetchedArticle` gains optional `teaser?: string | null`; `toArticle` passes it through (helpers stay pure).
- `src/modules/news/providers/google-news.ts` -- move `decodeEntities`, `textContent`, `element`, item iteration into new `providers/rss.ts`; keep exports used by `google-news.test.ts` working (re-export or update imports).
- New `src/modules/news/providers/yahoo-rss.ts` (+ test) -- `yahooRssUrl`, `teaserText`, `parseYahooRss`, `searchYahooRss(symbol, fetch)`.
- `src/modules/news/terms.ts` -- `newsTerm`; add `mentionsSecurity(text, name, symbol)` here (+ `terms.test.ts`) and `yahooSymbol(security)`.
- `src/modules/news/index.ts` -- export new constants (`TEASER_MAX_LENGTH`, `YAHOO_RSS_SPACING_MS`) if used outside.
- `src/modules/news/news.test.ts:34-40` -- `googleFetch` routes by `hl`; Yahoo RSS URLs have no `hl` → route `feeds.finance.yahoo.com` separately (default reply: an Error, so existing expectations hold) and pass `sleep` fake in `run`.
- `test/helpers/providers.ts` -- `recordedText`, `fakeFetch`; new fixtures `yahoo-rss-sap.xml` (matching, unrelated, old, entity-HTML, long items), `yahoo-rss-empty.xml`.
- `src/app/_components/news/NewsList.tsx` + `NewsList.dom.test.tsx` -- server component today; teaser rows need state → new client `NewsTeaserItem.tsx` ("use client", pattern `SecurityLogo.tsx`), `NewsList` delegates. `labels.ts` (+ test): `TEASER_MARKER = "Kurztext"`, `READ_ARTICLE_LABEL = "Zum Artikel"`.
- `src/app/(app)/news/page.test.tsx`, `src/app/(app)/securities/[id]/page.test.tsx:198-215` -- seed one row with `teaser` and assert marker/teaser markup; existing `createMany` rows stay valid (`teaser` optional).
- `src/app/_components/overview/LatestNews.tsx` -- read-only; type change only.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + new migration -- teaser column, enum value.
- `src/modules/news/providers/rss.ts`, `google-news.ts` -- shared RSS parsing, Google behaviour unchanged (its tests stay green).
- `src/modules/news/providers/yahoo-rss.ts` (+ test, fixtures) -- URL, parsing, teaser cleanup and trimming, error rows of the matrix.
- `src/modules/news/terms.ts` (+ test) -- `mentionsSecurity`, `yahooSymbol` examples (STOCK, UNCLASSIFIED, ETF, CRYPTO with/without mapping).
- `src/modules/news/news.ts`, `index.ts` (+ `news.test.ts`) -- RSS lookup, name filter, spacing, teaser-wins de-dupe, `listNews` teaser, every matrix row against the real test DB.
- `src/app/_components/news/{NewsTeaserItem,NewsList,labels}.tsx|ts` (+ dom tests) -- accordion, keyboard toggle, marker, "Zum Artikel" link attributes, non-teaser rows unchanged.
- `src/app/(app)/news/page.test.tsx`, `src/app/(app)/securities/[id]/page.test.tsx` -- teaser item rendered on both surfaces.

**Acceptance Criteria:**
- Given a cached item with a teaser, when I open "Nachrichten" or the Security detail page, then the item shows the "Kurztext" marker and is a collapsed button; activating it by click, Enter or Space expands the teaser with source, date and a "Zum Artikel" link opening the article in a new tab, and activating it again collapses it.
- Given a cached item without a teaser, when I activate it, then the original article opens in a new tab as before.
- Given a refresh, when Yahoo RSS is unreachable for one Security, then the news page still loads and that Security keeps its Google/Yahoo-search headlines.
- Given a restore or the 14-day window, when news is purged, then teasers go with their headlines.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 18, false 7, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) RSS spacing slept a full second before every RSS request after the first, adding ≥ 1 s per stock/crypto holding to a page-open refresh — `rssLookup` now records the last RSS start (`Date.now()`) and sleeps only the remainder of `YAHOO_RSS_SPACING_MS`.
  - `[low]` `[patch]` (blind) Second tag strip in `teaserText` removed prose with literal `<`/`>` ("Umsatz < Prognose, Marge > 20 %") — only tag-shaped text (`<\/?[a-zA-Z][^>]*>`) is stripped now; test added.
  - `[low]` `[reject]` (blind) Sentence-end cut fires on German ordinals ("26. Oktober") — only for descriptions > 600 chars (Yahoo descriptions are 2–4 sentences); fix adds an abbreviation/ordinal guard.
  - `[low]` `[reject]` (blind) `merge` keeps two same-title rows when the URL matches entry A and the title a different entry B — needs an RSS item sharing a URL with one item and a title with another; Google links are redirect URLs, so URL matches with RSS practically never occur; fix adds branches.
  - `[low]` `[reject]` (blind) Short/numeric symbol bases (O, T, 7203) match unrelated headlines — the feed is already per symbol and AD-9 prefers Xetra symbols (≥ 2–4 chars); a length guard adds a rule.
  - `[low]` `[patch]` (blind) `TEASER_MAX_LENGTH`, `mentionsSecurity`, `yahooSymbol` exported from the module index without an outside consumer — exports removed.
  - `[low]` `[patch]` (blind) `visuallyHidden` re-exported from `NewsList` only for `LatestNews` — `LatestNews` imports it from `labels`, re-export dropped.
  - `[low]` `[reject]` (blind) `NewsTeaserItem` duplicates the row header markup of `NewsList`; panel repeats the meta line — the meta line in the panel is required by the AC ("teaser with source and date"); extracting a shared header is a refactor, not a correction.
  - `[low]` `[reject]` (blind) No phone-width/44 px tests, rotate transition ignores reduced motion — happy-dom has no layout; a 150 ms icon rotation is negligible.
  - `[low]` `[reject]` (blind) `toArticle` passes a teaser through unchecked — the only teaser producer (`teaserText`) enforces the rules; no other caller passes one.
  - `[false]` `[reject]` (blind) Privacy assertion no longer covers RSS calls — the RSS test pins the exact URL `…?s=SAP.DE&region=DE&lang=de-DE`, which excludes the ISIN; the crypto test pins `s=BTC-EUR`.
  - `[low]` `[reject]` (edge) Same as the blind URL/title merge row — same root cause and reason.
  - `[low]` `[patch]` (edge) RSS feed with only unrelated items while Google and Yahoo search fail left the Security unflagged and replaced its cache with nothing — a filtered-empty RSS result is now a provider error (warn logged); test added.
  - `[low]` `[reject]` (edge) Short symbol bases — same as the blind row.
  - `[low]` `[patch]` (edge) Double-encoded tags (`&amp;lt;b&amp;gt;`) survived as literal `<b>` — tags are stripped again after the second decode; test added.
  - `[low]` `[reject]` (edge) Hard/word cut can split a surrogate pair — needs an emoji exactly at the 600-char cut; same rejection as in story 3-7.
  - `[low]` `[patch]` (verification-gap) Spacing test could not tell whether the second RSS fetch waits for the sleep — the test now uses a deferred sleep and asserts one RSS call until release, then two; delay asserted in (0, 1000].
  - `[low]` `[patch]` (verification-gap) "First wins" between two teaser duplicates untested — new refresh test with two same-title RSS items, both with teasers; only the first is stored.
  - `[low]` `[reject]` (verification-gap other) URL/title split merge — same root cause as the blind row.
  - `[false]` `[reject]` (intent) Yahoo symbol narrower than "ProviderMapping or Yahoo search" — AD-9 stores a Yahoo-search-resolved symbol as the YAHOO ProviderMapping, so mapping-based lookup covers both.
  - `[false]` `[reject]` (intent) Real-time spacing not exercised — covered by the patched deferred-sleep test; tests never run real time or live providers by policy.
  - `[false]` `[reject]` (intent) Page load with failing RSS not tested at page level — the pages only read the cache; provider failures are confined to `refreshNews`, tested at module level, and `refreshNews` never throws for provider failures.
  - `[false]` `[reject]` (intent) Accordion, 44 px and phone width only in happy-dom — interaction (click/Enter/Space/multi-open) is tested; layout is `sx`-only and not measurable in tests; no human-only action needed.
  - `[false]` `[reject]` (intent) Restore purge of teasers not exercised — teasers are a column of `NewsArticle`, which `clearNews` (tested, used by restore) deletes entirely.
  - `[false]` `[reject]` (intent) Status reporting not in the diff — written at finalization; no operator action exists, so `done`, not `awaiting-operator`.

## Design Notes

- Crypto has a COINGECKO mapping, not a Yahoo one; Yahoo's crypto ticker convention `<SYMBOL>-EUR` derives the symbol without an extra lookup request. Stocks reuse the YAHOO mapping that AD-9 resolved via OpenFIGI or Yahoo search.
- Empty RSS channel counts as failure (AC: "failing, empty or malformed") unlike Google, where an empty channel is valid; only all-provider failure marks the Security `failed`.
- Accordion sketch: `<li><button aria-expanded={open} aria-controls={panelId}>…headline… <span>Kurztext</span></button><div id={panelId} role="region" hidden={!open}>teaser · meta · <a target="_blank">Zum Artikel</a></div></li>`.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass, no live network in tests.
- `git grep -n "feeds.finance.yahoo.com" -- src/app` -- expected: no matches.

## Auto Run Result

Status: done

**Summary:** A fourth news provider reads the unofficial Yahoo Finance RSS headline feed per Yahoo symbol (YAHOO mapping for STOCK/UNCLASSIFIED; CRYPTO via YAHOO mapping or `<SYMBOL>-EUR`; ETF/FUND/CERTIFICATE skipped), stores the item description as a cleaned plain-text `teaser` (≤ 600 chars, cut at sentence or word), keeps only items that mention the Security's name term or symbol, spaces RSS requests ≥ 1 s apart, and counts failing/empty/malformed/irrelevant feeds as a per-Security provider failure. De-duplication now lets an item with a teaser replace an earlier headline-only duplicate. "Nachrichten" and the Security detail page render teaser items as keyboard-accessible accordions with a "Kurztext" marker and a "Zum Artikel" link (new tab); headline-only items open the article as before. Teasers are cache rows, purged with the window and on restore, never backed up. No human-only action is required (no API key).

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261028100000_add_news_teaser/` — `NewsArticle.teaser`, `NewsProvider.YAHOO_RSS`.
- `src/modules/news/providers/rss.ts` (new) — RSS helpers extracted from `google-news.ts` (+ test import update).
- `src/modules/news/providers/yahoo-rss.ts` (+ test) — feed URL, parser, `teaserText`, error mapping.
- `src/modules/news/providers/shared.ts` — optional `teaser` on fetched articles.
- `src/modules/news/terms.ts` (+ test) — `yahooSymbol`, `mentionsSecurity`.
- `src/modules/news/news.ts`, `index.ts` (+ `news.test.ts`) — RSS lookup, filter, spacing, teaser-wins merge, `listNews` teaser.
- `src/app/_components/news/NewsTeaserItem.tsx` (new), `NewsList.tsx`, `labels.ts` (+ tests), `src/app/_components/overview/LatestNews.tsx` — accordion UI, labels, `visuallyHidden` location.
- `src/app/(app)/news/page.test.tsx`, `src/app/(app)/securities/[id]/page.test.tsx` — teaser item on both surfaces.
- `test/fixtures/providers/yahoo-rss-sap.xml`, `yahoo-rss-empty.xml` — synthetic feeds.

**Review findings:** 25 total — 8 patched (all low: remainder-only spacing, tag-shaped strip, double-encoded tags, filtered-empty RSS as failure, deferred-sleep spacing test, teaser-vs-teaser first-wins test, unused index exports, `visuallyHidden` re-export), 0 deferred, 17 rejected (7 false: RSS privacy assertion, Yahoo-search symbol reading, real-time spacing, page-level RSS failure, browser layout, restore purge, status reporting; 10 low: ordinal sentence cut, URL/title split merge ×3, short symbol bases ×2, duplicated header markup, layout/reduced-motion tests, unchecked teaser in `toArticle`, surrogate split — reasons per row in the triage log).

**Follow-up review recommendation:** false — patched counts: high 0, medium 0, low 8.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (210 test files, 2869 tests; build OK). `git grep -n "feeds.finance.yahoo.com" -- src/app` — no matches. Matrix audit: every I/O row covered by passing tests in `news.test.ts`, `providers/yahoo-rss.test.ts` and `terms.test.ts`.

**Residual risks:** The Yahoo RSS feed is unofficial and pinned only by synthetic fixtures (description encoding and `<source>` presence never checked live); long teasers may be cut after a German ordinal ("26."); very short ticker bases could let unrelated feed items through the name filter.
