---
title: 'Security Detail without a Holding (story 9-2)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '366a9cc2e36a794e38295b41094b44e6660faa9b'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A Security without Transactions opens to a bare "Noch keine Buchungen" card, so a watchlist idea cannot be judged (no chart, news, classification), the detail page offers no way to put a Security on a watchlist, and the Securities page cannot tell watchlist-only Securities from holdings.

**Approach:** Give never-booked Securities a "watch" layout on `/securities/[id]` (header with Price, stale badge and Period change; price chart with moving-average overlay; 14-day news; classification; "Auf Watchlists" card with inline edit), add "Zur Watchlist" and list chips to every Security detail, add watched Securities to the news set through an injected loader, and mark watchlist-only Securities on the Securities page.

## Boundaries & Constraints

**Always:**
- "Booked" (`detail.depots.length > 0`) keeps today's full layout unchanged, plus "Zur Watchlist" and chips. Not booked → watch layout; holding/Transaction blocks (DepotSwitcher, SecurityHero, KPIs, SecurityTotal, Heatmap, FifoLots, SecurityTransactions) are omitted, and `NO_TRANSACTIONS_TEXT` is no longer shown.
- Period change in the header is pure core: end = resolved Price as of `to`; base = resolved Price as of `from − 1`, else the first Price dated within `from..to`; both split/ISIN-adjusted as of `to`; result `{ perUnit, ratio } | null` (`null` without end or base, or base zero). Decimal strings via `decimal.js`.
- `MAX` for a Security without Transactions starts at the earliest stored/known Price date of its chain (else today); other presets unchanged.
- Watch-layout chart offers only "Kurs" (no "Wert"/"Performance"/"Drawdown"; no toggle group when one mode), with the existing 200/38 moving-average overlay and cookies.
- News: `refreshNews` targets and keeps the cache of held ∪ watched Securities via an injected `watched` loader (`news` must not import `watchlist`); `listNews`/`newsNeedsRefresh`/news page/overview stay held-only. The detail page (both layouts) reads its 14-day articles through a new `listSecurityNews(today, securityId)` that ignores the held set.
- "Auf Watchlists" card (watch layout, only when on ≥ 1 list): per entry list name (link `/watchlists?list=<id>`), date added, change since added (`entryFigures`, "–" when null), full note (pre-wrapped), "via Claude" chip when `source = MCP`, and "Bearbeiten" opening the 9.1 `EditWatchlistEntryDialog`.
- "Zur Watchlist" button on every detail page: dialog with list select (default first list not containing the Security), note, date added (default today), Security fixed; duplicate shows "Steht schon auf dieser Liste" as an Alert; no lists → info text with link "Watchlist anlegen" to `/watchlists`. List chips (each linking to `/watchlists?list=<id>`) under the title when on lists.
- Securities page: chip "Watchlist" on a Security that is on ≥ 1 list and not in `listHeldSecurities(today)`.
- Watchlist server actions additionally revalidate `/securities` and `/securities/[id]` (page).
- Server actions check the session first; UI text German, de-DE formats.

**Never:**
- No export/restore (9.3), no MCP (9.4); no change to Positions, totals, analyses or the held set; watched Securities never count as held.
- No new Prisma model or migration; `news` never imports `@/modules/watchlist`; `watchlist` never reads Transaction/Price tables directly.
- No buy action from the watch layout.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Watch layout | Security on list "Ideen", no Transactions, Prices | header, Kurs chart + MA, news, classification, "Auf Watchlists"; no Hero/KPIs/Transactions | — |
| Once held | sold Security with Transactions | full layout as today + chips/"Zur Watchlist" | — |
| Never booked, not on a list | Security without Transactions | watch layout without "Auf Watchlists" card | — |
| No Price | no observations | "Kein Kurs vorhanden.", change "–", chart omitted | — |
| Period change | base 100 on `from−1`, end 110 | +10,00 € / +10 % | — |
| Base inside Period | first Price on `from+3` = 50, end 60 | +10,00 € / +20 % | — |
| Split in Period | 1:4 split, unadjusted 100 → 26 | base adjusted 25 → +4 % | — |
| MAX without rows | first Price 2025-03-01 | `from` = 2025-03-01 | — |
| Add from detail | list without the Security | entry created, chip appears | — |
| Duplicate | list already has it | refused | Alert "Steht schon auf dieser Liste" |
| No lists | 0 watchlists | dialog shows link "Watchlist anlegen" | — |
| News set | watched, unheld Security | `refreshNews` fetches it and keeps its cache; news page does not list it | — |
| Securities page | on a list, not held / held and on a list | chip "Watchlist" / no chip | — |

</intent-contract>

## Code Map

- `src/app/(app)/securities/[id]/page.tsx` -- the detail page; `booked` switch at the bottom; header row with `PeriodSelector` (only when booked today) and `SecurityActions`.
- `src/modules/ledger/security-detail.ts:104` `securityDetail` -- `firstDate` from scope rows → `resolvePeriod`; `lineageObservations(chain, actions, …)`; returns `price`, `priceSeries`, `movingAverages`. Add `priceChange` and the MAX fallback (`to` of `resolvePeriod` does not depend on `firstDate`, so resolve once with `null`, load observations, then re-resolve with the earliest chain observation date when there are no rows).
- `src/core/security.ts` -- `securityPrice`, `adjustedObservations`, `securityPriceSeries:375`; add pure `securityPriceChange(observations, securityId, actions, from, to)` (+ tests in `src/core/security.test.ts`). `src/core/watchlist.ts` has a private `changeRatio` pattern to mirror.
- `src/core/period.ts:49` `resolvePeriod` -- MAX uses `firstDate`.
- `src/app/_components/security-detail/SecurityChart.tsx:71` -- modes filter; make "value" depend on non-empty `valuePoints`, hide the `ToggleButtonGroup` when only one mode.
- `src/app/_components/security-detail/PriceLine.tsx`, `positions/GainLossPill.tsx` (`gain`, `ratio`, `ratioLabel`), `security-detail/labels.ts` (`NO_TRANSACTIONS_TEXT`, `NO_PRICE_TEXT`), `core/format` (`formatMoney`, `formatDate`) -- header pieces; new `security-detail/WatchHeader.tsx` (Price `figureHero`, `PriceLine`, pill with €/unit and ratio labelled by `periodLabel(period)`, chart slot).
- `src/modules/news/news.ts:149` `refreshNews` (held set at :157, cache delete :158-161, `staleOf` :162), `:228` `listNews` -- add `RefreshNewsOptions.watched?: (db: NewsDb) => Promise<readonly string[]>` and `listSecurityNews(today, securityId, db)` → `NewsListArticle[]`; export from `src/modules/news/index.ts`; tests in `news.test.ts`.
- `src/instrumentation-node.ts:19-25` `refreshNewsAfterPrices`, `src/app/_actions/news.ts:18` -- pass `{ watched: watchedSecurityIds }` (update their tests' call-arg assertions).
- `src/modules/watchlist/entries.ts:216` `watchlistView` -- template for figures (`securityPriceObservations`, `entryFigures`, `storedPriceHistory`); add `securityWatchlistEntries(securityId, today, db)` → `{ id, watchlistId, watchlistName, note, dateAdded, source, clientName, sinceAdded }[]` in list order, and `watchedSecurityIds(db)` (distinct entry Security ids); export from `index.ts`; tests in `watchlist.test.ts`. `listWatchlists` for the dialog's lists.
- `src/app/_actions/watchlists.ts` -- `WATCHLISTS_PATH` revalidations at :55/:63/:75/:106/:132/:135/:145; add `revalidatePath("/securities")` and `revalidatePath("/securities/[id]", "page")` beside them (helper).
- `src/app/_components/watchlists/WatchlistEntryDialog.tsx` -- `AddEntryForm:106` (hidden `watchlistId`/`securityId` fields, `NoteAndDate`, `placement`), `EditWatchlistEntryDialog:366`, `EditableWatchlistEntry`; add exported `AddToWatchlistButton({ security, lists, onLists, today })`. `labels.ts` maps `already-on-list` → field `security`: this form shows it as Alert. `WatchlistDialogs.tsx` `useDialog`.
- `src/app/_components/securities/ClassificationDialog.tsx` (`ClassificationButton`), `securities/labels.ts` `classificationSummary`, `src/modules/classification` `listClassifications`, `core/classification` `effective` -- classification card (summary + button), like `SecurityList.tsx:67/94/118`.
- `src/app/(app)/securities/page.tsx`, `src/app/_components/securities/SecurityList.tsx:80-93` -- add `watchlistOnly?: ReadonlySet<string>`/record prop and chip "Watchlist" next to the type chip; page loads `watchedSecurityIds()` and `listHeldSecurities(today)`.
- `src/app/_components/news/NewsList.tsx`, `overview/CardHeading.tsx` -- news section as today.
- Tests: `src/app/(app)/securities/[id]/page.test.tsx` (mocks modules; extend), `security-detail/SecurityDetail.dom.test.tsx`, `securities/SecurityList.dom.test.tsx`, `watchlists/*.dom.test.tsx`, `test/helpers/{test-db,dom,next-mocks}.ts`.

## Tasks & Acceptance

**Execution:**
- `src/core/security.ts` (+ `security.test.ts`) -- `securityPriceChange` per Boundaries; tests for the three Period-change matrix rows and null cases.
- `src/modules/ledger/security-detail.ts` (+ test) -- `priceChange` field; MAX fallback for Securities without rows.
- `src/modules/news/news.ts`, `index.ts` (+ `news.test.ts`) -- `watched` option in `refreshNews` (targets, cache retention, `onlyStale`), `listSecurityNews`.
- `src/modules/watchlist/entries.ts`, `index.ts` (+ `watchlist.test.ts`) -- `securityWatchlistEntries`, `watchedSecurityIds`.
- `src/instrumentation-node.ts`, `src/app/_actions/news.ts` (+ tests) -- wire `watched: watchedSecurityIds`.
- `src/app/_actions/watchlists.ts` (+ test) -- revalidate Securities paths.
- `src/app/_components/security-detail/SecurityChart.tsx` (+ dom test) -- price-only mode without toggle.
- `src/app/_components/security-detail/WatchHeader.tsx`, `WatchlistCard.tsx` ("Auf Watchlists" with edit dialog), `WatchlistChips.tsx` (+ dom tests).
- `src/app/_components/watchlists/WatchlistEntryDialog.tsx` (+ dom test) -- `AddToWatchlistButton` ("Zur Watchlist").
- `src/app/(app)/securities/[id]/page.tsx` (+ `page.test.tsx`) -- layouts per Boundaries; `PeriodSelector` on both layouts; news via `listSecurityNews`; classification card in the watch layout.
- `src/app/_components/securities/SecurityList.tsx`, `src/app/(app)/securities/page.tsx` (+ tests) -- "Watchlist" chip.

**Acceptance Criteria:**
- Given a watchlist Security without Transactions, when its detail page opens from the watchlist row, then header (Price, stale badge, Period change), Kurs chart with "Gleitender Durchschnitt", "Nachrichten · 14 Tage", classification and "Auf Watchlists" render and no Hero/KPI/"Gesamt seit Erstkauf"/Heatmap/lots/Transactions block appears.
- Given a Security that was held and is sold, when its detail page opens, then the full layout of story 4.6/4.7 still renders.
- Given any Security detail, when clicking "Zur Watchlist" and submitting list, note and date, then the entry exists, the page shows the list chip, and the watchlist page lists it.
- Given an entry in "Auf Watchlists", when editing its note via "Bearbeiten", then the full new note shows on the card.
- Given the Securities page, when a Security is only on watchlists, then it shows chip "Watchlist"; a held one does not.
- Given the full suite, when running `npm run lint && npm run typecheck && npm test && npm run build`, then all pass, including `test/architecture/core-imports.test.ts`.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 22 findings — high 0, medium 0, low 16, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: a newly watched Security gets news only on the next scheduled run — the daily scheduled run (`instrumentation-node.ts` price scheduler → `refreshNewsAfterPrices`) fills it within a day; an on-add or detail-page refresh trigger adds new provider-calling paths, more than a direct correction.
  - `[low]` `[reject]` Blind: `newsNeedsRefresh` checks held Securities only, so stale watched caches never trigger the news page's auto refresh — same root as the row above; spec keeps the news page held-only; fixing needs a new parameter and call-site wiring.
  - `[low]` `[reject]` Blind: news page refresh result may name a failed watched Security — only on a provider failure for a watched idea; the message stays understandable; filtering adds a branch.
  - `[low]` `[patch]` Blind: watch layout never shows the stale hint / "Kurs manuell eintragen" (hardcoded `held={false}`), `PriceLine` doc outdated — `WatchHeader` gained `fetched`, page passes `entries.length > 0`, `PriceLine` doc says "held or watched"; DOM test for stale + watched added.
  - `[low]` `[reject]` Blind: "Zur Watchlist" defaults to a duplicate when the Security is on every list — submit shows "Steht schon auf dieser Liste" as specified; a hint/disabled state adds a branch for a rare state.
  - `[low]` `[reject]` Blind: `listClassifications()` loads all rows; `listSecurityNews` re-reads the Security — negligible at single-user scale.
  - `[false]` `[reject]` Blind: Securities-page test uses the UTC date, so `dateAdded` may exceed Berlin today — Europe/Berlin is always ahead of UTC, so the UTC date is never after the Berlin business date.
  - `[low]` `[reject]` Blind: brittle whitespace-collapsed header assertion — test style only; no user harm.
  - `[low]` `[reject]` Blind: no end-to-end test of note-after-edit / chip-after-add — the halves are covered (page renders entries from the DB, dialog submits the action); Next re-renders the current page after any `revalidatePath` in an action (`action-handler.js` `pathWasRevalidated` → page render).
  - `[low]` `[patch]` Blind: booked test name promises a news check it never makes — test now seeds an own and a foreign article and asserts only the own one in `security-news`.
  - `[low]` `[reject]` Edge: watched-only / no holdings news trigger — same as Blind row 1/2.
  - `[low]` `[reject]` Edge: last Price before `from` gives 0 % instead of "–" — carry-forward per AD-9 and the spec's base rule; the held layout's Period figures behave the same; the stale badge flags the old Price.
  - `[low]` `[reject]` Edge: default list when on every list — same as Blind row 5.
  - `[low]` `[reject]` Edge: entries on an ISIN-change relative are missed by chips/card — rare (ISIN change of a watched Security), same residual as 9.1; needs chain resolution in the service.
  - `[low]` `[patch]` Verification gap: revalidation of `/securities/[id]` not asserted after rename/delete/update/remove — `mockClear` before each action and assertions added in `watchlists.test.ts`.
  - `[low]` `[patch]` Verification gap: classification card never tested with a stored classification — watch-layout test stores sector "Halbleiter" via `setManualClassification` and asserts it in `security-classification`.
  - `[false]` `[reject]` Verification gap (other): classification action does not revalidate the detail page, card stays stale — Next re-renders the current page whenever an action revalidated any path (`node_modules/next/dist/server/app-render/action-handler.js:926`, `skipPageRendering` false when `pathWasRevalidated`).
  - `[false]` `[reject]` Intent: held Security opened from a watchlist gets no "Auf Watchlists"/classification card — EXPERIENCE.md places the card in the variant "no longer held or only on a watchlist"; the AC keeps the held layout for once-held Securities.
  - `[false]` `[reject]` Intent: "Watchlist" chip on a sold-out Security contradicts its full detail layout — the AC chip exists so non-holdings are not mistaken for holdings; a sold-out watched Security is not a holding, and the AC keeps its blocks.
  - `[false]` `[reject]` Intent: watched news not on `/news` — the AC places the 14-day news on the Security detail page; AD-17 only adds them to the fetched set.
  - `[false]` `[reject]` Intent: modal instead of in-card edit — the AC says "through the 9.1 form", which is the 9.1 edit dialog.
  - `[low]` `[reject]` Intent: no browser-level test — server-rendered page tests on a migrated DB are the project's page-level surface; no browser harness exists.

## Design Notes

AD-17 puts watchlist Securities into the news *set* (what is fetched and cached). The news page and overview teaser stay scoped to holdings (their copy and `securities` filter speak of holdings); watched news surfaces on the Security detail page. `news` learns watched ids only through the injected loader, mirroring 9.1's `PriceDeps.watched`:

```ts
// src/instrumentation-node.ts
await refreshNews({ watched: watchedSecurityIds });
```

The classification and "Auf Watchlists" cards appear only in the watch layout; booked pages gain only "Zur Watchlist" and the chips, so story 4.6/4.7 pages stay as they are.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for Roboto).

## Auto Run Result

Status: done

**Summary:** Story 9.2 implemented: never-booked Securities get a watch layout on `/securities/[id]` (Price header with stale badge and pure-core Period change, Kurs-only chart with the 200/38 moving average, "Auf Watchlists" with inline edit through the 9.1 dialog, 14-day news, classification card); booked Securities keep the 4.6/4.7 layout. Every detail page gets "Zur Watchlist" and list chips; `MAX` for a Security without rows starts at its earliest Price. Watched Securities join the news set through an injected `watched` loader (`news` never imports `watchlist`); the detail page reads its own articles via `listSecurityNews`. The Securities page marks watchlist-only Securities with "Watchlist".

**Files changed:**
- `src/core/security.ts` (+test) — `securityPriceChange`.
- `src/modules/ledger/security-detail.ts` (+test) — `priceChange`, MAX fallback without rows.
- `src/modules/news/news.ts`, `index.ts` (+test) — `watched` option in `refreshNews`, `listSecurityNews`.
- `src/modules/watchlist/entries.ts`, `index.ts` (+test) — `securityWatchlistEntries`, `watchedSecurityIds`.
- `src/instrumentation-node.ts`, `src/app/_actions/news.ts` (+tests) — wire `watched`.
- `src/app/_actions/watchlists.ts` (+test) — revalidate `/securities` and `/securities/[id]`.
- `src/app/_components/security-detail/SecurityChart.tsx` (+test) — no "Wert" without value points; no toggle for one mode.
- `src/app/_components/security-detail/{WatchHeader,WatchlistCard,WatchlistChips}.tsx`, `Watch.dom.test.tsx`; `PriceLine.tsx` doc — new watch-layout pieces.
- `src/app/_components/watchlists/WatchlistEntryDialog.tsx` (+test) — `AddToWatchlistButton` ("Zur Watchlist").
- `src/app/(app)/securities/[id]/page.tsx` (+test) — layouts.
- `src/app/(app)/securities/page.tsx`, `src/app/_components/securities/SecurityList.tsx` (+tests) — "Watchlist" chip.

**Review:** 22 findings (high 0, medium 0, low 16, false 6). 4 low patches applied (stale hint for watched Prices, booked-page news assertion, revalidation assertions, stored-classification test). 0 deferred. 18 rejected — reasons per row in the Review Triage Log. Patched counts by verdict: high 0, medium 0, low 4 → follow-up review not recommended.

**Verification:** `npm run lint` ✓, `npm run typecheck` ✓, `npm run build` ✓. `npm test` (full, after patches): 3162/3176 passed; the 14 failures are timeouts/speed checks in 9 files untouched by this diff (Depot detail page, ReturnHeatmap, RestoreButton, Parqet wizard, ClassificationDialog, TransactionDialog, xirr speed, valuation, hash-password) under machine load; a different set each run, and all 9 files pass (133/133) when run on their own. All story-related tests pass (55 files, 520 tests incl. `test/architecture`). Matrix audit: every I/O row covered by a passing test.

**Residual risks:** A newly watched Security has no news until the next daily scheduled run (the news page's auto refresh still triggers on held Securities only). Entries on an ISIN-change relative do not show on the successor's detail page. Not checked in a browser.
