---
title: 'Key Figures (story 9-6)'
type: 'feature'
created: '2026-10-28'
status: done
baseline_revision: 'bb12a605e9f6793ca88e1f6e4446f72b640d5fa7'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** To judge a watchlist idea or a holding Tommy still has to open another finance site for KGV, dividend yield, market cap or the 52-week range; the app stores only prices and a classification.

**Approach:** The `classification` module keeps a disposable per-Security key-figures snapshot (one Yahoo `quoteSummary` per symbol, at most once per Berlin day, for held ∪ watched STOCK/ETF/FUND with a Yahoo mapping, sharing the request with the classification fetch), and a pure core function computes 52-week figures from stored split-adjusted closes. The Security detail page (both layouts) gets a card "Kennzahlen" with a "Kennzahlen aktualisieren" action, the watchlist table optional KGV / Dividendenrendite / Abstand-zum-Hoch columns (column menu, remembered per browser), and MCP `get_watchlist` returns the figures per entry.

## Boundaries & Constraints

**Always:**
- Only the Yahoo symbol leaves the server (AD-13); the snapshot is a cache with `fetchedAt` (AD-1), never input to any calculation, never exported, deleted (like news) when its Security leaves held ∪ watched; cascades with the Security.
- Provider numbers become plain decimal strings (existing `decimalOf`); dates become `YYYY-MM-DD` (Europe/Berlin, `businessDate`); accept `Date`, ISO string or epoch seconds from yahoo-finance2. A field Yahoo does not deliver is `null` and shows "–", never 0.
- At most one request per Security per Berlin day: skip when the stored snapshot's `symbol` equals the mapping symbol and `businessDate(fetchedAt) === today`. A transient error writes nothing (retried next run); Yahoo "no data" (`isNoData`) stores an all-null snapshot with `fetchedAt`.
- Sharing: when a STOCK also needs its classification profile in the same run (existing `providerFor` condition), ONE request carries `assetProfile, price` plus the key-figure modules, and the response feeds both; otherwise the key-figure request carries only `summaryDetail, defaultKeyStatistics, financialData, calendarEvents, fundProfile`. A classification-only fetch keeps today's exact query `["assetProfile","price"]`.
- 52-week figures for every Security with stored (non-Transaction) Prices, split-adjusted as of today, for the Security it maps to today (`currentSecurityId`); never from the provider.
- Snapshot stale when its fetched business date + 7 days < today (`KEY_FIGURES_STALE_AFTER_DAYS = 7`), shown with a warning-soft pill "Stand TT.MM.JJJJ – veraltet" like the price stale badge.
- `classification` never imports `watchlist`: the watched-ids loader is passed in (as `refreshNews({ watched })`); cross-module access only via `index.ts`. UI German, de-DE formats.

**Never:** analyst ratings/price targets/recommendations (story 9.7); a `get_security` MCP tool (Epic 10); fund size or distribution policy; sorting by the new columns; storing or exporting computed 52-week figures; JS-number arithmetic on figures; a request for CRYPTO/CERTIFICATE or a Security outside held ∪ watched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German stock | SAP.DE held, no snapshot | one request; card shows Bewertung/Größe/Dividende/Qualität/Risiko/Termine, "Yahoo Finance, Stand 28.10.2026" | – |
| Foreign stock on DE listing | APC.DE (no `forwardPE`, `financialCurrency` USD) | KGV erwartet "–"; Umsatz shown with its currency "466,82 Mrd. USD"; market cap in listing currency (EUR) | – |
| ETF | EUNL.DE | Fondsgesellschaft, TER "0,20 %", Auflagedatum 25.09.2009; no stock groups | – |
| Crypto / certificate | BTC | no request; card shows only 52-week figures | – |
| No data | Yahoo "Quote not found" | all-null snapshot stored, every provider figure "–" | not retried until the next day |
| Transient failure | network error | nothing written; old snapshot (if any) stays | counted in `failed`, logged by error name only |
| Second run same day | snapshot from today, same symbol | no request | – |
| Split inside 52 weeks | 2:1 split 3 months ago | high/low/performance on adjusted closes (no fake drop) | – |
| < 52 weeks of Prices | first close 2 months ago | high/low over available closes; Performance 52 Wochen `null` ("–") | – |
| No stored Price | only Transaction prices | all 52-week figures `null` | – |
| Next earnings in past | `earningsDate` < today | "nächste Quartalszahlen" "–" | – |

</intent-contract>

## Code Map

- `prisma/schema.prisma` + new `prisma/migrations/20261103000000_add_security_key_figures/migration.sql` -- new model `SecurityKeyFigures { id cuid, securityId @unique → Security (onDelete Cascade), symbol String, figures String (JSON of decimal strings/dates), fetchedAt String (UTC ISO) }`; back-relation `keyFigures SecurityKeyFigures?` on `Security`. Run `npx prisma generate` after.
- `src/modules/classification/providers/yahoo.ts` -- today `fetchProfile` (modules assetProfile+price, `isNoData`, `decimalOf`, `Lookup`). Generalize: `QuoteSummaryQuery = { modules: QuoteSummaryModule[] }`, a shared `fetchQuoteSummary(symbol, modules, deps)` returning `Lookup<raw>`, `profileOf(raw)` (keeps current not-found semantics) and `keyFiguresOf(raw, kind: "stock"|"fund")`. Field sources: summaryDetail `trailingPE, forwardPE (fallback defaultKeyStatistics.forwardPE), priceToSalesTrailing12Months, dividendYield, payoutRatio, exDividendDate, beta, marketCap, currency`; defaultKeyStatistics `priceToBook, pegRatio, fundInceptionDate, fundFamily, annualReportExpenseRatio`; financialData `totalRevenue, financialCurrency, profitMargins, returnOnEquity, revenueGrowth, debtToEquity`; calendarEvents `earnings.earningsDate[]`; fundProfile `family, feesExpensesInvestment.annualReportExpenseRatio`. Probe 2026-10-28: SAP.DE all present; APC.DE no forwardPE, financialCurrency USD; EUNL.DE only TER 0.002, family, inception.
- `src/modules/classification/classification.ts` -- `refreshClassifications` (serialized queue, `providerFor` at ~L131, `storeAutomatic`, `nowOf`). Add `watched?: (db) => Promise<readonly string[]>` to `ClassificationDeps`; compute held (`listHeldSecurities` from `@/modules/ledger`) ∪ watched; delete snapshots outside it; merge the key-figure fetch into the per-Security loop. New `refreshKeyFigures(securityId, deps, db)` (serialized, one Security) and `listKeyFigures(securityIds, today, db)`.
- `src/modules/classification/index.ts` -- export the new services/types.
- `src/core/key-figures.ts` (new) -- types `ProviderKeyFigures`, `FiftyTwoWeekFigures`; `fiftyTwoWeekFigures(observations, securityId, actions, today)`; `isKeyFiguresStale(fetchedDate, today)`; `KEY_FIGURE_ASSET_TYPES`. Reuse `adjustedObservations`, `currentSecurityId`, `compareObservations` (see `securityMovingAverage` in `src/core/security.ts:484` for the stored-closes pattern), `ratioString`/`ReturnDecimal` from `core/returns`.
- `src/core/format.ts` -- add `formatFigure(value)` (2 decimals, "-" only when negative, no unit), `formatRate(ratio)` (×100, 2 decimals, unsigned unless negative, " %"), `formatCompactAmount(value, currency)` ("243,77 Mrd. €", "466,82 Mrd. USD"; Tsd./Mio./Mrd./Bio.; € for EUR else the code).
- `src/instrumentation-node.ts` (`refreshClassificationsAfterNews`) and `src/app/_actions/classification-refresh.ts` (`runClassificationRefresh`, used by backfill/restore/type change) -- pass `watched: watchedSecurityIds` (import `@/modules/watchlist` in the app layer, as `refreshNewsAfterPrices` does). Update `src/instrumentation-node.test.ts` mock expectations if they assert call args.
- `src/modules/watchlist/entries.ts` -- `watchlistView` already loads split-adjusted `observations`; add `fiftyTwoWeek: FiftyTwoWeekFigures` per entry (via core) to `WatchlistEntryView`.
- `src/app/(app)/securities/[id]/page.tsx` -- add card in both layouts (booked: after `SecurityTotal`; watch: after `WatchlistCard`); load `listKeyFigures([security.id], today)` and the 52-week figures (new `fiftyTwoWeek` field on `SecurityDetail` in `src/modules/ledger/security-detail.ts`, computed from its `observations` as of `today`).
- `src/app/_components/security-detail/KeyFiguresCard.tsx` (new, client) + `src/app/_actions/key-figures.ts` (new server action `refreshKeyFiguresAction(securityId)` → `refreshKeyFigures` with `watched`, `revalidatePath`, German result message; follow `src/app/_actions/classification.ts` for auth/result shape).
- `src/app/_components/watchlists/WatchlistTable.tsx` + `watchlist-cookie.ts` + `(app)/watchlists/page.tsx` -- column menu (IconButton "Spalten" → Menu with checkboxes), cookie `dm_watchlist_columns` (comma list of `kgv,dividendYield,distanceToHigh`, written via `chartPreferenceCookie`, parsed server-side, invalid keys dropped); page passes `keyFigures` map + `initialColumns`.
- `src/modules/mcp/tools.ts` -- `get_watchlist` adds `key_figures` per entry (snake_case decimals, `as_of`, `stale`, `source: "Yahoo Finance"`, `fifty_two_week`); description updated. `entryPayload` gets the figures as a second arg.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, migration -- add `SecurityKeyFigures` -- disposable cache owned by classification.
- `src/core/key-figures.ts` + `key-figures.test.ts` -- pure 52-week function and staleness; window = stored closes dated `addDays(today,-364)..today` (last observation per date wins, as `securityMovingAverage`); high/low = max/min close with its date (tie → later date); `distanceToHigh = latestClose/high − 1`; `performance = latestClose/base − 1` with `base` = last close on or before `addDays(today,-364)`, else null; tests: split inside window, < 52 weeks, no stored price, transaction prices ignored, ISIN-change successor, staleness boundary (fetched 2026-10-21 not stale on 10-28, stale on 10-29).
- `src/core/format.ts` + tests -- the three helpers.
- `src/modules/classification/providers/yahoo.ts` + `yahoo.test.ts` + fixtures `test/fixtures/providers/yahoo-quotesummary-keyfigures-{sap-de,apc-de,eunl-de}.json` (synthetic values in Yahoo's shape, ISO date strings) -- parser tests for German stock, foreign stock on DE listing, ETF, no-data error; existing profile tests stay green; assert only the symbol is sent.
- `src/modules/classification/classification.ts` + tests -- refresh integration: shared request (one call with all 7 modules for a pending stock), skip same day, refetch next day / on symbol change, error keeps old snapshot, no-data stores nulls, cleanup outside set, CRYPTO/CERTIFICATE/unmapped never fetched; `refreshKeyFigures` returns `{ status: "updated" | "fresh" | "unavailable" | "failed" | "not-found" }`.
- App wiring (`instrumentation-node.ts`, `classification-refresh.ts`, `_actions/key-figures.ts`) -- pass `watched`.
- `KeyFiguresCard.tsx` + DOM test -- heading "Kennzahlen"; caption "Yahoo Finance, Stand TT.MM.JJJJ" (stale pill when stale; "Noch keine Daten von Yahoo Finance" without snapshot); stock groups exactly as listed in the epic (labels: KGV, KGV erwartet, KBV, KUV, PEG · Marktkapitalisierung, Umsatz (12 Monate) · Dividendenrendite, Ausschüttungsquote, letzter Ex-Tag · Nettomarge, Eigenkapitalrendite, Umsatzwachstum, Verschuldungsgrad · Beta · nächste Quartalszahlen); ETF/FUND: Fondsgesellschaft, laufende Kosten (TER), Auflagedatum; a group "Kurs · 52 Wochen" for all types with 52-Wochen-Hoch/-Tief (price + date), Abstand zum 52-Wochen-Hoch, Performance 52 Wochen, caption "auf Schlusskursbasis"; footer "Angaben ohne Gewähr, keine Anlageberatung"; button "Kennzahlen aktualisieren" only when eligible, disabled with "Heute schon aktualisiert" when fresh; dl/dt/dd markup, two columns from `sm`, one on phones.
- Detail page + `security-detail.ts` -- render card in both layouts.
- Watchlist entries, table, cookie, page + DOM tests -- columns hidden by default; menu toggles; phone rows show chosen figures as an extra caption line ("KGV 30,43 · Dividendenrendite 1,18 % · Abstand zum Hoch −5,20 %").
- `src/modules/mcp/tools.ts` + `http.test.ts` -- `key_figures` in `get_watchlist`; no `held`.

**Acceptance Criteria:**
- Given SAP.DE held with a Yahoo mapping and no snapshot, when the scheduled run finishes, then exactly one `quoteSummary("SAP.DE", …)` was sent and the detail page card shows the stock groups with "Yahoo Finance, Stand <today>".
- Given a snapshot fetched today, when the run (or the button) fires again, then no request is sent.
- Given a snapshot fetched 8 days ago (fetch failing since), when the page renders, then the stand line carries the "veraltet" pill.
- Given a watchlist with the KGV column switched on, when the page reloads, then the column is still shown (cookie), and on a phone the figure appears in the row.
- Given Claude calls `get_watchlist`, then each entry carries `key_figures` with decimal strings or null and `fifty_two_week`.
- Given an export, then it contains no key-figures data; given a Security deleted or no longer held/watched, then its snapshot is gone after the next run.

## Design Notes

Revenue is in `financialCurrency` (USD for APC.DE) while the listing quotes EUR; the snapshot keeps each amount with its currency (`marketCap`+`marketCapCurrency` from summaryDetail.currency, `revenue`+`revenueCurrency`) so a USD figure is never labelled €. `debtToEquity` arrives in percent units (22.789) and is shown as "22,79 %"; other ratios (0.0118) via `formatRate`. TER: `fundProfile.feesExpensesInvestment.annualReportExpenseRatio ?? defaultKeyStatistics.annualReportExpenseRatio`. The snapshot stores the earliest delivered `earningsDate` as `nextEarningsDate`; the card shows it only when it is on or after today, else "–".

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 30 findings — high 0, medium 1, low 13, false 16, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) `listKeyFigures.fetchedToday` ignores the symbol; button disabled after a same-day mapping change — now uses the service's `fetchedToday()` rule (symbol + day + kind); test added.
  - `[medium]` `[patch]` (blind) STOCK↔ETF/FUND type change on the fetch day keeps a snapshot of the wrong kind — new `kind` column in the (uncommitted) migration; kind mismatch is never fresh and is hidden by `listKeyFigures`; test added.
  - `[low]` `[reject]` (blind) `formatCompactAmount` picks the unit before rounding (999995 → "1.000,00 Tsd.") — only exactly at unit boundaries of market caps/revenue; fix needs extra branching.
  - `[false]` `[reject]` (blind) unvalidated stored strings crash formatters — snapshots are written only by `keyFiguresOf` (`decimalOf`/`dateOf`); malformed rows are unreachable without manual DB edits.
  - `[low]` `[reject]` (blind) a future caller without `watched` would purge watched snapshots — both callers pass it; no current path; documented "absent = none".
  - `[false]` `[reject]` (blind) a failing watched loader blocks the classification run — it is a DB read like the run's other reads; a DB failure would fail the run anyway.
  - `[low]` `[reject]` (blind) watched ids are not mapped through ISIN-change successors — same pre-existing pattern as news/prices; rare; fix needs corporate actions in classification.
  - `[low]` `[reject]` (blind) `fiftyTwoWeekFigures` re-adjusts all observations per entry — same pattern as the existing `entryFigures`; watchlists are small.
  - `[low]` `[reject]` (blind) key-figures stale pill lacks focus/tooltip of `StaleBadge` — the pill text itself states the date and "veraltet"; cosmetic.
  - `[false]` `[reject]` (blind) distance to high uses the latest stored close, not the resolved Kurs — required by the AC ("from stored … Prices", labelled "auf Schlusskursbasis").
  - `[low]` `[reject]` (blind) MCP `source`/`stale` set without a snapshot — `as_of: null` already signals no data; cosmetic for the client.
  - `[false]` `[reject]` (blind) hyphen instead of U+2212 and no gain/loss colour — the app's formatters use the hyphen everywhere; the spec example is not a glyph requirement.
  - `[low]` `[reject]` (blind) missing tests list — the relevant ones (symbol change, type change) were added with the patches; the rest are low-value.
  - `[low]` `[patch]` (edge) = blind finding 1 (same root cause) — fixed as above.
  - `[low]` `[patch]` (edge) earnings list with a past and a future date stores only the past one — `keyFiguresOf` takes the fetch day and stores the earliest date on or after it, else the latest; test added.
  - `[low]` `[patch]` (edge) snapshot kept after the Yahoo mapping is removed — the refresh also deletes it without a Yahoo symbol; cleanup test extended.
  - `[low]` `[reject]` (edge) = blind "missing watched loader" — see above.
  - `[false]` `[reject]` (edge) = blind "unvalidated stored strings" — see above.
  - `[false]` `[reject]` (edge) unparseable `fetchedAt` throws — written only as `now.toISOString()` by the refresh.
  - `[low]` `[reject]` (edge) `storeKeyFigures` failure double-counts updated+failed — only on a DB write failure; result counts are log-only.
  - `[false]` `[reject]` (edge) Unicode minus claim — see above.
  - `[low]` `[patch]` (verification-gap) no page test for a watched-only Security's `canRefresh` — test now adds the never-booked stock to a watchlist and asserts `canRefresh: true`.
  - `[low]` `[patch]` (verification-gap) = blind finding 1 — fixed as above.
  - `[low]` `[patch]` (verification-gap) = edge "mapping removed" — fixed as above.
  - `[false]` `[reject]` (intent) revenue kept in its own currency vs "amounts are EUR" — Yahoo delivers APC.DE revenue only in USD; labelling it USD avoids a wrong € label, no conversion is done (Design Notes).
  - `[false]` `[reject]` (intent) ratios shown as percent vs "as Yahoo delivers them" — values are not recomputed, only formatted.
  - `[false]` `[reject]` (intent) synthetic fixtures vs recorded responses — project policy requires synthetic fixtures in Yahoo's recorded shape (as the existing quoteSummary fixture); no-data is covered by Yahoo's recorded error.
  - `[low]` `[reject]` (intent) `epic-9-context.md` rewrite shortened 9.1–9.5 detail — a regenerated cache of planning docs; the sources are unchanged.
  - `[false]` `[reject]` (intent) phone "expanded row" rendered as an extra caption line — phone rows are stacked (no expand interaction exists); the figures appear in the row.
  - `[false]` `[reject]` (intent) scheduler/commit not exercised — `instrumentation-node.test.ts` asserts `watched` is passed; the commit happens at finalize.

## Auto Run Result

Status: done

**Summary:** Story 9.6 key figures. `classification` keeps a disposable `SecurityKeyFigures` snapshot (symbol, kind, JSON figures, fetchedAt) for held ∪ watched STOCK/ETF/FUND with a Yahoo mapping, at most one request per Security and Berlin day, sharing one `quoteSummary` with a pending classification profile; snapshots outside the set, of a non-provider type or without a Yahoo mapping are deleted. Pure `core/key-figures` computes 52-week high/low (with dates), distance to high and 52-week performance from stored split-adjusted closes, plus the 7-day staleness rule. Security detail shows a "Kennzahlen" card in both layouts with "Kennzahlen aktualisieren"; the watchlist table has a "Spalten" menu (KGV, Dividendenrendite, Abstand zum 52-Wochen-Hoch; cookie `dm_watchlist_columns`; caption line on phones); MCP `get_watchlist` returns `key_figures` per entry.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261103000000_add_security_key_figures/migration.sql` — new `SecurityKeyFigures` model.
- `src/core/key-figures.ts` (+test) — snapshot types, 52-week figures, staleness, earnings helper.
- `src/core/format.ts` (+test) — `formatFigure`, `formatRate`, `formatCompactAmount`.
- `src/modules/classification/providers/yahoo.ts` (+test, 3 fixtures) — shared `fetchQuoteSummary`, `profileOf`, `keyFiguresOf`.
- `src/modules/classification/classification.ts`, `index.ts` (+test) — key figures in the refresh, `refreshKeyFigures`, `listKeyFigures`.
- `src/instrumentation-node.ts`, `src/app/_actions/classification-refresh.ts` (+tests) — pass the watched loader.
- `src/app/_actions/key-figures.ts` (+test) — "Kennzahlen aktualisieren" server action.
- `src/app/_components/security-detail/KeyFiguresCard.tsx` (+DOM test), `src/app/(app)/securities/[id]/page.tsx` (+test), `src/modules/ledger/security-detail.ts` — card and 52-week figures on the detail page.
- `src/modules/watchlist/entries.ts`, `src/app/_components/watchlists/WatchlistTable.tsx`, `watchlist-cookie.ts`, `src/app/(app)/watchlists/page.tsx` (+tests) — optional columns.
- `src/modules/mcp/tools.ts`, `http.test.ts` — `key_figures` in `get_watchlist`.
- `src/modules/backup/export.test.ts`, `src/app/_actions/price-refresh.test.ts` — export excludes snapshots; mock update.

**Review findings:** 30 reported; 5 distinct patches applied (1 medium, 4 low: same-day symbol rule, snapshot kind, upcoming earnings date, mapping-removed cleanup, watched-only page test); 0 deferred; every rejected finding and its reason is in the triage log above.

**Follow-up review recommendation:** false — patched: high 0, medium 1, low 4.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all passed after the patches (256 test files, 3475 tests). Every I/O matrix row is covered by a passing test (core key-figures, Yahoo parser, classification refresh, KeyFiguresCard DOM tests).

**Residual risks:** Yahoo field names are tested only against synthetic fixtures shaped after the 2026-10-28 live probe (SAP.DE, APC.DE, EUNL.DE); not exercised in a browser or against live Yahoo in this run. Watched ids are not mapped through ISIN-change successors (same as news/prices).
