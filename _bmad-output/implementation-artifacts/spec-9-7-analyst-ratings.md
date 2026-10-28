---
title: 'Analyst Ratings (story 9-7)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '1bab3e1ce04fb90db6cd452a4214ad3bb23eeac5'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** For a stock Tommy holds or watches he still needs another finance site to see what analysts recommend, their price targets and how that sentiment shifted recently.

**Approach:** Story 9.6's key-figures refresh also stores Yahoo's analyst data (`recommendationTrend`, `upgradeDowngradeHistory`, targets/mean/count from `financialData`) for held ∪ watched STOCKs, taken from an "Analysten-Symbol" (the home listing, resolved once by ISIN via Yahoo search, stored per Security, editable on the Securities page). Pure core functions map the consensus, compute chart shares and the target change; the Security detail page gets a separate card "Analystenbewertungen", the watchlist an optional column "Analysten", and MCP `get_watchlist` returns the data.

## Boundaries & Constraints

**Always:**
- Same schedule, freshness rule (≤ 1 request set per Security and Berlin day), cleanup and cascade as the 9.6 snapshot; analyst data lives in the same `SecurityKeyFigures` row (never exported, never input to a calculation). Only STOCK gets analyst data; ETF/FUND/CERTIFICATE/CRYPTO never request it and never show the card.
- Only symbols and the ISIN (search) leave the server (AD-13). Counts are integers; prices/targets/means are decimal strings (`decimalOf`), dates `YYYY-MM-DD` Berlin (`dateOf`); ratios/shares via `decimal.js` in core, never JS-number arithmetic (SVG geometry may convert a finished share string with `Number()`).
- Target change compares the target mean with `financialData.currentPrice` of the SAME analyst listing; currency = that listing's quote currency (`price.currency ?? summaryDetail.currency`), labelled by code when not EUR ("USD").
- The snapshot is atomic: when either request (mapping symbol or analyst symbol) fails transiently nothing is written; "no data" on the analyst request stores `analysts: null`.
- Consensus: mean ≤ 2,0 "Optimistisch", ≤ 3,0 "Neutral", else "Pessimistisch". The card renders only when `hasAnalystData` (current-month trend total > 0 or a target mean or a consensus mean); otherwise no card at all.
- `classification` still never imports `watchlist`; UI German, de-DE formats; colours from gain / cash (Halten) / loss tokens, never colour alone.

**Never:** exporting analyst data or the Analysten-Symbol; any currency conversion of targets; a `get_security` MCP tool (Epic 10); sorting by the "Analysten" column; investment advice wording beyond the hint; a request for a non-STOCK.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| German stock | SAP.DE (ISIN DE…), no analyst symbol | search resolves "SAP.DE" = mapping → ONE quoteSummary with key-figure + analyst modules; card shows consensus, chart, trend, Kursziel in € | – |
| Foreign stock on DE listing | APC.DE, ISIN US0378331005 | search resolves "AAPL"; key figures from APC.DE, analyst data from a second request for AAPL; Kursziel "USD", change vs AAPL `currentPrice` | – |
| Search finds no home listing | search result without matching symbol | analyst symbol = mapping symbol (stored, automatic) | – |
| Search transient error | network error | nothing stored for the symbol; analyst part skipped this run, retried next run; key figures still fetched | counted in `failed` |
| No analyst data | analyst listing "Quote not found" / empty trend & targets | `analysts: null`; no card, watchlist "–", MCP `analysts: null` | – |
| Manual symbol | user sets "NVDA" for a Security | stored as manual; never overwritten by resolution; snapshot no longer fresh → next run/button refetches | invalid symbol → "Ungültiges Symbol" |
| Clear manual symbol | user saves empty | manual flag cleared, symbol null → re-resolved next run | – |
| ETF / crypto | EUNL.DE, BTC | no analyst request, no card, no column value | – |
| Strong counts zero | buy 20, strongBuy 0 | label "Kaufen 20+0"; inner portion zero | – |
| Current price missing or 0 | `currentPrice` null | target change `null` → "–" | – |

</intent-contract>

## Code Map

- `prisma/schema.prisma` + new `prisma/migrations/20261104000000_add_analyst_ratings/migration.sql` -- `SecurityKeyFigures` gains `analystSymbol String?` (symbol the analyst part was fetched for) and `analysts String?` (JSON of `AnalystRatings`, null = none); `SecurityClassification` gains `analystSymbol String?` and `analystSymbolManual Boolean @default(false)`. Run `npx prisma generate`.
- `src/core/analyst-ratings.ts` (new, + test) -- types `RatingCounts {strongBuy,buy,hold,sell,strongSell: number}`, `AnalystRatings { trend: {period:"0m"|"-1m"|"-2m"|"-3m"} & RatingCounts [] (oldest→current), analystCount: number|null, consensusMean: string|null, target: {low,mean,median,high,currentPrice: string|null; currency: string|null}, changes: {date, firm, fromGrade|null, toGrade, action|null, priceTargetFrom|null, priceTargetTo|null}[] (newest first, ≤10) }`; `hasAnalystData`, `consensusMean(r)` (provider mean ?? count-weighted mean of the current month, 4 dp, null when total 0), `analystConsensus(mean) → "optimistic"|"neutral"|"pessimistic"`, `ratingShares(counts) → {buy,hold,sell: {share, strongShare}} | null` (shares of the total, `strongShare` = strong ÷ group total, decimal strings), `targetChange(target) → string|null` (mean ÷ currentPrice − 1, `ratioString`), `analystCountOf(r)` (analystCount ?? current total). Reuse `ReturnDecimal`/`ratioString` from `core/returns` like `core/key-figures.ts`.
- `src/modules/classification/providers/yahoo.ts` -- extend `QuoteSummaryModule` with `recommendationTrend`, `upgradeDowngradeHistory`; `ANALYST_MODULES = ["financialData","summaryDetail","price","recommendationTrend","upgradeDowngradeHistory"]`; `analystRatingsOf(raw) → Lookup<AnalystRatings|null>` (zod `section` pattern; `upgradeDowngradeHistory.history[].epochGradeDate` via `dateOf`, sort newest first, keep 10; null when `!hasAnalystData`). Add a classification-owned Yahoo `search` (copy the lazy-client pattern of `src/modules/prices/providers/yahoo.ts:34`, type `YahooSearch`) and `findHomeListing(isin, mappingSymbol, deps) → Lookup<string>`: suffix by ISIN country (`US`→ no dot; DE .DE, GB .L, FR .PA, NL .AS, CH .SW, IT .MI, ES .MC, SE .ST, DK .CO, NO .OL, FI .HE, BE .BR, AT .VI, PT .LS, IE .IR, JP .T, HK .HK, CA .TO, AU .AX), else first suffix-less (US) quote, else `mappingSymbol`; quotes with `isYahooFinance: false` ignored; symbols upper-cased and checked with `^[A-Za-z0-9.^=_-]{1,40}$`.
- `src/modules/classification/classification.ts` -- `ClassificationDeps.search?: YahooSearch`. In `refreshOne` and `refreshKeyFigures`: for a tracked STOCK with Yahoo mapping and ISIN whose row has no `analystSymbol`, call `findHomeListing` and persist it (automatic) on `SecurityClassification` (upsert, never touching manual flag of a manual row). `fetchedToday` additionally requires `snapshot.analystSymbol === analystSymbolOf(row)` for stocks. `providerFor`: when the analyst symbol equals the mapping symbol, add `ANALYST_MODULES` to the one request (dedupe); otherwise a second `fetchQuoteSummary(analystSymbol, ANALYST_MODULES)`; analyst "not-found" → `analysts: null`; any "error" → whole key-figures outcome `failed`. `storeKeyFigures` writes `analystSymbol` + `analysts`. `KeyFiguresSnapshot` gains `analysts: AnalystRatings|null` and `analystSymbol` (parsed defensively like `parseFigures`; non-STOCK → null). New `setAnalystSymbol(securityId, input, db)` → `{ok:true} | {ok:false, reason:"not-found"|"not-a-stock"|"symbol-invalid"}` (empty = automatic: clear symbol and manual flag) and `listAnalystSymbols(db) → Record<securityId, {symbol: string|null; manual: boolean}>`. Export both from `index.ts`.
- `src/app/_actions/classification.ts` -- new `setAnalystSymbolAction(securityId, symbol)` (session check, `revalidatePath("/securities")` + detail page; German messages) following `setClassificationAction`.
- `src/app/_components/securities/AnalystSymbolDialog.tsx` (new, + DOM test) and `SecurityList.tsx` (STOCK rows: line "Analysten-Symbol: AAPL" or "Analysten-Symbol: automatisch" and button "Analysten-Symbol"; dialog with text field, helper "Leer lassen = automatisch per ISIN ermitteln") ; `(app)/securities/page.tsx` loads `listAnalystSymbols()`. Follow `RegionSplitDialog.tsx` for dialog/action shape.
- `src/app/_components/security-detail/AnalystRatingsCard.tsx` (new, client, + DOM test) and `KeyFiguresCard.tsx` (export `SourceLine` for reuse) -- rendered right after `keyFiguresCard` in both layouts of `src/app/(app)/securities/[id]/page.tsx` when `security.assetType === "STOCK"` and `hasAnalystData`.
- `src/app/_components/watchlists/WatchlistTable.tsx`, `watchlist-cookie.ts`, `(app)/watchlists/page.tsx` -- column key `analysts` ("Analysten"), `WatchlistKeyFigures.analysts: {consensus: label; count: number} | null`; value "Optimistisch (31)" or "–".
- `src/modules/mcp/tools.ts` + `http.test.ts` -- `keyFiguresPayload` adds `analysts` (see Design Notes); `get_watchlist` description mentions analyst data.

## Tasks & Acceptance

**Execution:**
- Schema + migration -- columns above.
- `src/core/analyst-ratings.ts` + test -- mapping boundaries (2.0 → optimistic, 2.0001 → neutral, 3.0 → neutral, 3.01 → pessimistic), fallback mean from counts, shares sum to 1 and zero-total null, strong share, target change incl. null/zero price.
- Yahoo parser + home-listing tests with synthetic fixtures in Yahoo's recorded shape: `test/fixtures/providers/yahoo-quotesummary-analysts-sap-de.json` (with 4-month trend, history), `yahoo-quotesummary-analysts-aapl.json` (USD), `yahoo-search-apple.json` (APC.DE, AAPL, APC.F quotes), no-data via thrown "Quote not found"; assert only symbol/ISIN sent.
- Classification refresh tests -- SAP.DE one request containing all modules; APC.DE → two requests (APC.DE key figures, AAPL analyst modules); fresh skip when both symbols match today; manual symbol change → refetch; analyst error → nothing written; search error → key figures stored with `analystSymbol: null`, `failed` counted; ETF never searched; manual symbol never overwritten; `setAnalystSymbol` validation. Update existing tests that refresh a STOCK to inject a `search` fake (no live calls).
- `AnalystRatingsCard` + DOM test -- heading "Analystenbewertungen"; "Optimistisch · 51 Analysten"; SVG donut (`aria-hidden`) with three sectors sized by share, inner darker band = strong share; visible labels "Kaufen 20+11", "Halten 14", "Verkaufen 3+1" (normal+strong); visually-hidden `<table>` (caption "Analystenbewertungen aktuell", rows Kaufen/Halten/Verkaufen with Stark/Normal/Anteil) reachable by screen readers; trend = four stacked columns labelled "vor 3 Monaten", "vor 2 Monaten", "vor 1 Monat", "aktuell" (each with `aria-label` listing the five counts); Kursziel "Ø 270,00 €" + "Spanne 200,00 – 310,00 €" + change "+12,50 %" (non-EUR: "Ø 245,00 USD" with "USD"); collapsible "Letzte Änderungen" (button with `aria-expanded`, list "TT.MM.JJJJ · Firm · Buy → Hold · Kursziel 250 → 270"); source line "Yahoo Finance, Stand …" (stale pill) plus "· Daten von AAPL" when the analyst symbol differs from the mapping; hint "Einschätzungen von Analysten, keine Anlageberatung".
- Detail page + page test -- card for STOCK with data in both layouts; absent for ETF and for stock without data.
- Watchlist column + tests -- menu entry "Analysten", desktop cell and phone caption.
- MCP payload + test.
- Securities page dialog + DOM test.

**Acceptance Criteria:**
- Given SAP.DE held with data, when the scheduled run finishes, then exactly one `quoteSummary("SAP.DE", …)` carries the analyst modules and the detail page shows "Analystenbewertungen" with consensus, chart, trend, Kursziel and source/date.
- Given APC.DE watched, then the analyst symbol "AAPL" is stored, the card shows the Kursziel in "USD" with change vs the AAPL price, and the Securities page shows "Analysten-Symbol: AAPL" editable.
- Given an ETF or a stock without analyst data, then no "Analystenbewertungen" card is rendered.
- Given the "Analysten" column is switched on, then rows show "Optimistisch (31)" and the choice survives reload (cookie).
- Given Claude calls `get_watchlist`, then each entry's `key_figures.analysts` is the analyst object or null.
- Given an export, then it contains neither analyst data nor the Analysten-Symbol.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 34 findings — high 0, medium 0, low 22, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) automatic Analysten-Symbol never re-resolved after a mapping change — only the mapping-fallback case depends on the mapping (home listings are found by ISIN); rare, and the fix needs a stored resolution source; clearing the symbol on the Securities page re-resolves.
  - `[low]` `[patch]` (blind) resolution upsert can overwrite a manual symbol saved during the search — now a conditional `updateMany` (symbol null, not manual) plus create-if-missing; race test added.
  - `[low]` `[reject]` (blind) `findHomeListing` ignores `quoteType`, may pick ADR/non-equity — an ISIN search practically returns the equity's listings; the US fallback is the spec's choice (best coverage for e.g. Cayman/Bermuda ISINs).
  - `[false]` `[reject]` (blind) stocks without ISIN never get analyst data — `ensureSecurity` allows non-CRYPTO types only with an ISIN (`src/modules/ledger/securities.ts:105`); unreachable.
  - `[low]` `[reject]` (blind) manual symbol only format-checked, a typo hides the card — validating needs a live request; the Securities page shows the symbol for correction.
  - `[low]` `[reject]` (blind) Securities page does not distinguish automatic/manual; unchanged save makes it manual — the automatic symbol is never re-resolved anyway, so both behave the same; spec-defined label.
  - `[low]` `[reject]` (blind) watchlist count 0 / null vs card — needs a provider count 0 with a mean, or a mean without counts; unlikely; would change the column format.
  - `[low]` `[patch]` (blind) watchlist/MCP rely on the untested STOCK-only filter of `listKeyFigures` — same root as verification-gap 2; test added.
  - `[low]` `[patch]` (blind) Kursziel range with one end missing renders "200,00 – –" — range now "–" unless both ends exist; DOM test added.
  - `[low]` `[reject]` (blind) strong band radius linear instead of area-proportional — follows the spec's Design Notes; fix would edit the spec.
  - `[low]` `[reject]` (blind) legend swatches use 0.85 opacity, no two-tone legend — cosmetic; labels "normal+strong" and the hidden table carry the meaning; fix is a design addition.
  - `[low]` `[patch]` (blind) `analystsPayload` inserted between `keyFiguresPayload`'s JSDoc and its function — moved above with its own comment.
  - `[low]` `[reject]` (blind) hard-coded DOM ids in the card — the card renders once per page, like the other detail cards' fixed ids (`security-key-figures`).
  - `[low]` `[patch]` (blind) `TREND_ORDER` duplicates core `TREND_PERIODS` — provider now imports `TREND_PERIODS`.
  - `[low]` `[reject]` (blind) malformed counts → 0 at parse vs month dropped at read — needs a malformed Yahoo payload; unlikely.
  - `[false]` `[reject]` (blind) English grades / target without currency in "Letzte Änderungen" — provider content (like news), shown in the spec's own example "Buy → Hold · Kursziel 250 → 270".
  - `[low]` `[reject]` (blind) "Kennzahlen aktualisieren" reports updated after a search failure — key figures were updated (spec: "key figures still fetched"); the analyst part follows with the next run; rare.
  - `[low]` `[patch]` (edge) = blind manual-overwrite race — fixed as above.
  - `[low]` `[reject]` (edge) = blind automatic symbol not re-resolved — see above.
  - `[false]` `[reject]` (edge) = blind stock without ISIN — unreachable, see above.
  - `[low]` `[patch]` (edge) lowercase manual mapping symbol vs upper-cased analyst symbol → extra request and misleading "Daten von" — symbols now compared case-insensitively in `providerFor` and the card; tests added.
  - `[low]` `[reject]` (edge) ISIN country missing from `HOME_SUFFIX` picks a suffix-less quote — spec-defined fallback; for KY/BM issuers the US listing is the home listing.
  - `[low]` `[reject]` (edge) = blind non-equity symbols — see above.
  - `[low]` `[reject]` (edge) = blind refresh reports updated on search failure — see above.
  - `[low]` `[patch]` (edge) = blind partial range — fixed as above.
  - `[low]` `[reject]` (edge) = blind count 0/null — see above.
  - `[low]` `[patch]` (verification-gap) "· Daten von AAPL" suffix only tested on a stale snapshot — fresh-snapshot DOM case added.
  - `[low]` `[patch]` (verification-gap) STOCK-only filter of `listKeyFigures` untested — ETF-with-stored-analysts test added.
  - `[low]` `[patch]` (verification-gap) `refreshKeyFigures` with failing search untested — test added (updated, `analystSymbol` null, no analyst request).
  - `[low]` `[reject]` (verification-gap) chart geometry not asserted — the numbers come from tested core `ratingShares`; geometry is presentation.
  - `[false]` `[reject]` (verification-gap other) first-run counters shift updated→unchanged — `storeAutomatic` still writes the rule layer into the new row (its automatic columns are null); counters are log-only anyway.
  - `[false]` `[reject]` (intent) fixtures synthetic, not recorded — project policy requires synthetic fixtures in Yahoo's recorded shape.
  - `[false]` `[reject]` (intent) AD-13 "only symbols" vs ISIN search — the story requires resolution by ISIN; AD-13 permits ISINs.
  - `[false]` `[reject]` (intent) a classification row created only for the analyst symbol adds an empty row to exports — `exportClassifications` keeps only rows with manual values or a manual split; the export test confirms.

## Design Notes

MCP shape (snake_case): `analysts: { symbol, consensus: "optimistic"|"neutral"|"pessimistic", consensus_mean, analyst_count, trend: [{ period, strong_buy, buy, hold, sell, strong_sell }], price_target: { low, mean, median, high, currency, current_price, implied_change }, recent_changes: [{ date, firm, from_grade, to_grade, action, price_target_from, price_target_to }] } | null`.

The Analysten-Symbol is a re-resolvable provider setting on the classification row; `replaceAllClassifications` (restore) recreates rows without it, so it is re-resolved automatically and a manual override must be re-entered after a restore — accepted to keep the export schema unchanged ("analyst data is never exported").

Radial chart: donut, sectors start at 12 o'clock in order Kaufen · Halten · Verkaufen; each sector from inner radius r0 to R in the lighter tone (gain/loss at 45 % opacity, Halten `cash.main`); the strong part as a darker band from r0 to r0 + (R − r0) × strongShare in the full token colour.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Story 9.7 analyst ratings. The 9.6 key-figures refresh also stores Yahoo analyst data (4-month recommendation trend, analyst count, consensus mean, price targets with the listing's current price and currency, last 10 up-/downgrades) for held ∪ watched STOCKs in the same disposable `SecurityKeyFigures` row. The data comes from an "Analysten-Symbol" resolved once by ISIN via Yahoo search (home-country suffix, else US listing, else the mapping symbol), stored on `SecurityClassification` and editable on the Securities page; one shared request when it equals the mapping symbol, else a second request (APC.DE → AAPL). Pure `core/analyst-ratings` maps the consensus, computes chart shares and the target change. Detail page card "Analystenbewertungen" (both layouts, stocks with data only), watchlist column "Analysten", MCP `get_watchlist` `key_figures.analysts`.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261104000000_add_analyst_ratings/migration.sql` — analyst columns.
- `src/core/analyst-ratings.ts` (+test) — types, consensus, shares, target change.
- `src/modules/classification/providers/yahoo.ts` (+test, 3 fixtures) — `analystRatingsOf`, `findHomeListing`, Yahoo search.
- `src/modules/classification/classification.ts`, `index.ts` (+test) — resolution, shared/second request, snapshot, `setAnalystSymbol`, `listAnalystSymbols`.
- `src/app/_actions/classification.ts` (+test) — `setAnalystSymbolAction`.
- `src/app/_components/securities/AnalystSymbolDialog.tsx`, `SecurityList.tsx`, `labels.ts`, `(app)/securities/page.tsx` (+tests) — Analysten-Symbol editing.
- `src/app/_components/security-detail/AnalystRatingsCard.tsx`, `KeyFiguresCard.tsx`, `labels.ts`, `(app)/securities/[id]/page.tsx` (+tests) — the card.
- `src/app/_components/watchlists/WatchlistTable.tsx`, `watchlist-cookie.ts`, `(app)/watchlists/page.tsx` (+tests) — "Analysten" column.
- `src/modules/mcp/tools.ts`, `http.test.ts` — analysts payload.
- `src/modules/backup/export.test.ts` — export excludes analyst data and symbol.

**Review findings:** 34 reported; 7 distinct patches applied (all low: manual-symbol race, case-insensitive symbol compare, partial target range, misplaced JSDoc, duplicated trend order, plus 3 test gaps); 0 deferred; every rejected finding and its reason is in the triage log above.

**Follow-up review recommendation:** false — patched: high 0, medium 0, low 7.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all passed after the patches (3530 tests). A flaky DOM test (second click on a still-disabled button) was hardened. Every I/O matrix row is covered by a passing test.

**Residual risks:** Yahoo analyst field names (`epochGradeDate`, `currentPriceTarget`, `priorPriceTarget`) and search results are tested only against synthetic fixtures in Yahoo's shape; not exercised against live Yahoo or in a browser (chart look unverified). A manual Analysten-Symbol is lost on restore (documented); an automatic mapping-fallback symbol is not re-resolved after a mapping change.
