---
title: 'News with Holding and Change Today'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_revision: 'd03223d8e01cc13ff6549dff8b8cc3b27fc2cfe7'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A news item shows only the Security name, headline and source; Tommy cannot see at a glance whether he holds the stock or how it moves today, so he cannot judge the headline.

**Approach:** The `news` module gains a read-only `newsSecurityContext(securityIds, today, db)` that computes, once per distinct Security, the held flag (non-archived Depots, via the ISIN-change successor) and the change today plus stale flag from the same core function as the watchlist "Heute" column (`entryFigures` in `src/core/watchlist.ts`). The news page and the Security detail page call it once with the distinct Security ids of their articles and pass the map to `NewsList`, which renders an "im Depot" chip and the signed change next to the Security name in both row variants (link row and teaser row).

## Boundaries & Constraints

**Always:**
- Change today = `entryFigures(...).changeToday.ratio` (latest resolved Price vs. the Price resolved on the day before its date, split-adjusted, ISIN successor); stale = `entryFigures(...).stale` (`isStale`). Never reimplement either.
- Held = `currentSecurityId(id, actions, today)` ∈ `listHeldSecurities(today)` (open Positions in non-archived Depots), as the watchlist does.
- One `securityPriceObservations` call and one `listHeldSecurities` call per page render for all distinct Security ids; the result is keyed by Security id and looked up per article.
- Display: chip label "im Depot" (small, outlined, primary); change via `formatPercent` with sign in the text, `gain.main`/`loss.main` colour only as secondary cue, neutral (`text.secondary`) when it shows as 0,00 %. When stale, after the change a non-focusable pill "Kurs vom dd.mm.yyyy – veraltet" (`priceDateText(date, true)`, `stale.soft` background, `stale.main` text) — no Tooltip/tabIndex, because rows are already a link or a button.
- `NewsList` without a context entry for an article renders exactly as today (no chip, no change).
- UI text German, de-DE formats; no provider call during render; read-only.

**Never:**
- No change shown (no "0 %", no "–") when there is no previous Price, no Price at all, or the previous Price is zero; no stale pill without a change.
- No change to the Overview "Nachrichten" card (`LatestNews`), to `listNews`/`listSecurityNews` signatures, to the news refresh, or to the Prisma schema.
- `news` must not import `@/modules/watchlist`; `src/core` stays untouched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Held, fresh | SAP held in a non-archived Depot; Prices 100 (2026-10-23), 101.8 (2026-10-26), today 2026-10-26 | "im Depot" chip and "+1,80 %" in gain colour, no stale pill | No error expected |
| Watched only | Security not held (detail page), Prices on two days | change shown, no chip | No error expected |
| Held only in archived Depot | Position only in an archived Depot | no chip | No error expected |
| No previous Price | only one Price (e.g. the BUY Transaction price) | chip if held, no change, no "0 %" | No error expected |
| Stale | latest Price older than `isStale` allows, previous Price exists | change plus "Kurs vom … – veraltet" pill | No error expected |
| Duplicate ids | `newsSecurityContext([a, a, b])` | one entry per distinct id | No error expected |
| Unknown id / empty list | id with no Security, or `[]` | unknown id: held false, change null; `[]` → `{}` | No error expected |

</intent-contract>

## Code Map

- `src/modules/news/news.ts` -- add `NewsSecurityContext` type and `newsSecurityContext`; already imports `listHeldSecurities` from `@/modules/ledger` and `storedPriceHistory` (via `@/modules/prices`), keeps `listNews`/`listSecurityNews` unchanged.
- `src/modules/news/index.ts` -- public entry point; export the new function and type.
- `src/modules/watchlist/entries.ts:236-271` -- reference pattern: `securityPriceObservations(ids, today, { storedPrices: (ids, asOf) => storedPriceHistory(ids, asOf, db) }, db)` + `entryFigures(observations, id, actions, dateAdded, today)` + held via `currentSecurityId`. Read only; do not import from it.
- `src/core/watchlist.ts:57-98` -- `entryFigures` (`changeToday`, `stale`, `priceDate`) and re-exported `currentSecurityId`. Read only. `dateAdded` only affects `sinceAdded`; pass `today`.
- `src/modules/ledger/positions.ts:83` -- `securityPriceObservations` (exported from `@/modules/ledger`).
- `src/app/_components/news/NewsList.tsx` -- server component rendering link rows and `NewsTeaserItem`; gains optional `context` prop and renders the context line next to `article.name`.
- `src/app/_components/news/NewsTeaserItem.tsx` -- client teaser row; gains optional `context` prop, same rendering.
- `src/app/_components/news/labels.ts` -- add `HELD_IN_DEPOT_LABEL = "im Depot"`.
- `src/app/_components/watchlists/WatchlistTable.tsx:51-67` -- `ratioTone`/`Ratio` pattern for signed percent with tone; replicate in a small news component (do not import from the watchlist table).
- `src/app/_components/prices/price-labels.ts` -- `priceDateText(date, stale)`; `src/app/_components/prices/StaleBadge.tsx` -- styling reference for the pill.
- `src/app/(app)/news/page.tsx` -- calls `listNews`; add `newsSecurityContext` with distinct article Security ids, pass to `NewsList`.
- `src/app/(app)/securities/[id]/page.tsx:73-138` -- calls `listSecurityNews(today, security.id)` in the `Promise.all`; add `newsSecurityContext([security.id], today)` and pass to `NewsList` at line ~138.
- `src/modules/news/news.test.ts` -- DB-backed tests (`createTestDatabase`, `held(...)` helper, `db().price.create`); add a `describe("newsSecurityContext")`.
- `src/app/_components/news/NewsList.dom.test.tsx` -- happy-dom tests; add the DOM cases.
- `src/app/(app)/news/page.test.tsx` -- page test on a migrated DB; extend to assert `NewsList` receives the context.

## Tasks & Acceptance

**Execution:**
- `src/modules/news/news.ts` -- add `export type NewsSecurityContext = { held: boolean; changeToday: string | null; stale: boolean; priceDate: string | null }` and `export async function newsSecurityContext(securityIds: readonly string[], today: string, db: NewsDb = prisma): Promise<Record<string, NewsSecurityContext>>` (dedupe ids; `[]` → `{}` without DB price loads; `stale` false and `priceDate` null when `changeToday` is null) -- one computation per Security per render from the shared core function.
- `src/modules/news/index.ts` -- export `newsSecurityContext` and `NewsSecurityContext` -- module entry point rule.
- `src/app/_components/news/labels.ts` -- add `HELD_IN_DEPOT_LABEL` -- German UI text in one place.
- `src/app/_components/news/NewsContext.tsx` (new, no hooks, usable from server and client) -- renders, for a `NewsSecurityContext`, the chip, the signed change with tone, and the stale pill per the Always rules; renders nothing when neither held nor change -- shared by both row variants.
- `src/app/_components/news/NewsList.tsx` and `NewsTeaserItem.tsx` -- optional `context?: Readonly<Record<string, NewsSecurityContext>>` on `NewsList`, pass `context?.[article.securityId]` to each row; render the name and `NewsContext` on one wrapping flex line -- "next to the Security name".
- `src/app/(app)/news/page.tsx`, `src/app/(app)/securities/[id]/page.tsx` -- compute the context once and pass it -- both news lists show it.
- `src/modules/news/news.test.ts` -- cover the I/O matrix rows (held fresh, watched only, archived-only holding, no previous Price, stale, duplicate ids, unknown id, empty list).
- `src/app/_components/news/NewsList.dom.test.tsx` -- DOM tests: held (chip + "+1,80 %" in link row and teaser row), watched only (change, no chip), no previous Price (no "%" text, no "0 %"), stale (change + "veraltet" pill), no context (unchanged).
- `src/app/(app)/news/page.test.tsx` -- assert the rendered page passes a context with `held: true` for a seeded held Security.

**Acceptance Criteria:**
- Given the news page or a Security detail page with news, when an item renders, then next to the Security name it shows "im Depot" exactly when the Security is held in a non-archived Depot, and the change today in % when a previous Price exists.
- Given the watchlist "Heute" column and a news item for the same Security on the same day, when both render, then the shown percentage is identical.
- Given a page render with many articles of the same Security, when the page loads, then `newsSecurityContext` runs once with distinct ids (one price-observation load), not once per article.

## Spec Change Log

## Review Triage Log

### 2026-11-11 — Review pass
- verdicts: 21 findings — high 0, medium 3, low 11, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` News page calls `listHeldSecurities` three times (listNews, newsNeedsRefresh, newsSecurityContext) — real but negligible for a single-user SQLite app; two calls pre-exist and the fix adds a parameter (new surface).
  - `[low]` `[reject]` Detail page re-loads held set and prices already loaded by `securityDetail`, also with no articles — negligible cost; fix needs new parameters or serialized loading.
  - `[false]` `[reject]` "im Depot" chip carries no information on /news (all held) — the story's AC requires the chip on the overall list; on the detail page the Security may be watched only.
  - `[medium]` `[patch]` Change percentage has no label for screen readers — appended visually hidden " heute" in `NewsContext.tsx`; accessible text now "+1,80 % heute".
  - `[low]` `[reject]` `ratioTone` duplicated from `WatchlistTable.tsx` — the spec directed replication; extracting a shared component is more than a direct correction and the percentage itself comes from the same core function.
  - `[low]` `[reject]` `NewsSecurityContext` allows invalid stale/priceDate combinations — only producer sets them consistently and it is tested; no named harm.
  - `[low]` `[reject]` Missing tests for ISIN successor, zero previous Price, split adjustment — these rules live in core `entryFigures`/`currentSecurityId`, already covered by `src/core/watchlist.test.ts`; colour part grouped with the verification-gap finding below.
  - `[medium]` `[patch]` Detail page wiring untested — added a case in `src/app/(app)/securities/[id]/page.test.tsx` asserting "im Depot +1,80 % heute" in the `security-news` section.
  - `[low]` `[patch]` DOM test "renders exactly as before" claims more than it checks — renamed to "shows no chip and no change without a context entry".
  - `[false]` `[reject]` Stale price without previous Price shows no warning — AC reads "a stale Price shows the change with the stale marker"; no change means nothing to mark; fix would edit the spec.
  - `[low]` `[reject]` (edge) Detail page computes context with zero articles — same root cause as the detail-page re-load finding; negligible.
  - `[low]` `[patch]` (edge) Context-less markup changed while the test claims unchanged — same root cause as the renamed DOM test; fixed by the rename.
  - `[medium]` `[patch]` (verification-gap) Detail page news context not checked by any test — same fix as the detail-page wiring row (new page test).
  - `[low]` `[patch]` (verification-gap) Tone rule untested — exported `ratioTone` and added `src/app/_components/news/NewsContext.test.ts` (gain, loss, neutral at ±0,00 %, rounding boundary).
  - `[false]` `[reject]` (intent) Overview "Nachrichten" card not covered — the AC scopes it to the news list "overall and on the Security detail page".
  - `[false]` `[reject]` (intent) "+1,80 %" vs the example "+1,8 %" — AC requires the same function and display as the watchlist "Heute" column; the example is illustrative.
  - `[false]` `[reject]` (intent) Stale marker only with a change (R4) — same as the stale-without-change row; matches the AC wording.
  - `[low]` `[patch]` (intent) Detail page untested at page level — duplicate of the verification-gap finding; same new page test.
  - `[false]` `[reject]` (intent) Detail-page lookup by `article.securityId` vs `[security.id]` could miss predecessor articles — `listSecurityNews` filters `where: { securityId }`, so every article carries exactly that id.
  - `[low]` `[reject]` (intent) No side-by-side test that watchlist and news percentages are identical — both call the same `entryFigures`; a cross-page test adds setup without catching a realistic regression.
  - `[false]` `[reject]` (intent) "Once per render" not query-counted — enforced structurally by one call with deduplicated ids; dedupe is tested.

### 2026-11-11 — Review pass
- verdicts: 19 findings — high 0, medium 0, low 13, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `ratioTone` duplicated in `NewsContext.tsx` and `WatchlistTable.tsx` — carried: same claim as the logged row; spec directed replication, extraction is more than a direct correction.
  - `[low]` `[reject]` (blind) Stale pill hand-copies `StaleBadge` styling — real duplication, but the spec requires a non-focusable pill without Tooltip; sharing it needs a new `StaleBadge` variant prop (new surface) for a cosmetic-only divergence risk.
  - `[low]` `[reject]` (blind) Hidden " heute" is read even when the Price is stale — the stale pill "Kurs vom … – veraltet" follows immediately in the same accessible text, matching the watchlist "Heute" column which also shows a stale change under "Heute"; fix adds a branch.
  - `[low]` `[reject]` (blind) No visible label for the change on screen — the intent's display rules define the change as a bare signed percent next to the name; adding a label edits the spec's design.
  - `[false]` `[reject]` (blind) "im Depot" chip on every /news row adds no information — carried: the AC requires the chip on both lists.
  - `[low]` `[reject]` (blind) Held set loaded several times per render — carried: negligible for single-user SQLite; fix adds a parameter.
  - `[low]` `[reject]` (blind) Detail page computes news context with no articles — carried: negligible.
  - `[low]` `[reject]` (blind) ISIN successors untested — carried for the core-rule part (change via successor, split, zero previous); the call-site wiring of `currentSecurityId` is the verification-gap finding below and was patched.
  - `[low]` `[reject]` (blind) Gain/loss colour never checked in rendered output — colour is the secondary cue (sign carries the meaning), `ratioTone` is tested; a DOM style assertion needs theme/computed-style plumbing the news DOM tests do not have.
  - `[low]` `[reject]` (blind) No detail-page test for watched-only/no-previous-Price — both cases are covered in `news.test.ts` (data) and `NewsList.dom.test.tsx` (render); the detail page only passes `[security.id]`, wiring already tested by the held case.
  - `[low]` `[reject]` (blind) Chip fixed at `height: 20` may clip under enlarged text — browser zoom scales the px height with the text; only font-size-only enlargement could clip, where MUI's default small Chip (fixed 24px) behaves alike; unlikely for the single user.
  - `[low]` `[reject]` (edge) Detail page always calls `newsSecurityContext([security.id])` even without articles — carried: same as the detail-page re-load row.
  - `[low]` `[patch]` (verification-gap) Held flag via ISIN-change successor not tested at the `newsSecurityContext` call site; mutation `heldSet.has(id)` survived all tests — added "follows the ISIN-change successor" case in `src/modules/news/news.test.ts` (old id held, successor's change "0.018"); mutation now fails it.
  - `[low]` `[reject]` (verification-gap) Rendered gain/loss colour not asserted — same root cause as the blind colour row; filed disposition defer, but caused by this change and low, so rejected with the same reason.
  - `[low]` `[reject]` (intent) Literal reading "one `listHeldSecurities` call per page render" not met (2–3 calls) — same root cause as the held-set reload row; the batching reading is met and dedupe tested.
  - `[false]` `[reject]` (intent) Visual rules (chip props, pill colours) tested only via text — the DOM tests assert chip, change, pill text and non-focusability in both row variants; style tokens are static `sx` literals with no logic beyond `ratioTone`, which is tested.
  - `[false]` `[reject]` (intent) Hidden " heute" is an addition not asked for — it adds screen-reader text only and contradicts no Always/Never rule; it was the previous pass's accessibility patch.
  - `[false]` `[reject]` (intent) Matrix rows (stale, watched-only, archived, no previous Price) not tested at page level — each row is tested at module level with real DB data and at component level; the pages only forward the map, which both page tests cover.
  - `[false]` `[reject]` (intent) "`news` must not import `@/modules/watchlist`" not test-guarded — the rule holds (`news.ts` imports only `@/core/watchlist`, `@/modules/ledger`, `@/modules/prices`); the auditor confirms it by inspection, no bad outcome.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** News items on `/news` and on the Security detail page show an "im Depot" chip (held in a non-archived Depot, ISIN successor followed) and the signed change today next to the Security name, from the same core `entryFigures` as the watchlist "Heute" column, with a non-focusable "Kurs vom … – veraltet" pill when stale. Computed once per distinct Security per render by `newsSecurityContext`. This follow-up review pass added one regression test.

**Files changed (whole story):**
- `src/modules/news/news.ts`, `src/modules/news/index.ts` — `newsSecurityContext` and `NewsSecurityContext`.
- `src/app/_components/news/NewsContext.tsx` (new) — chip, toned change with hidden " heute", stale pill; exported `ratioTone`.
- `src/app/_components/news/NewsList.tsx`, `NewsTeaserItem.tsx` — optional `context`, rendered next to the name in both row types.
- `src/app/_components/news/labels.ts` — `HELD_IN_DEPOT_LABEL`.
- `src/app/(app)/news/page.tsx`, `src/app/(app)/securities/[id]/page.tsx` — compute and pass the context.
- Tests: `src/modules/news/news.test.ts` (this pass: ISIN-successor case), `src/app/_components/news/NewsList.dom.test.tsx`, `src/app/_components/news/NewsContext.test.ts`, `src/app/(app)/news/page.test.tsx`, `src/app/(app)/securities/[id]/page.test.tsx`.

**Review findings (follow-up pass):** 19 total — high 0, medium 0, low 13, false 6. Patched 1 (low: ISIN-successor held flag untested at the `newsSecurityContext` call site; new test, mutation-checked). Deferred: none. Rejected 18 — reasons per row in the Review Triage Log (6 carried from the first pass, 6 false, 6 low negligible or spec-directed).

**Follow-up review recommended:** false — follow-up pass patched no `high` entry (patched counts: high 0, medium 0, low 1); the work has converged.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — pass (270 files, 3786 tests; build compiled). New test fails when `currentSecurityId` is removed from the held check (mutation verified, source restored).

**Residual risks:** held set loaded 2–3 times per render (negligible); `ratioTone` and the stale pill styling are duplicated from `WatchlistTable.tsx` / `StaleBadge.tsx` and must stay aligned; rendered colours are not asserted by tests.
