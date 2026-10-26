---
title: 'Portfolio overview (story 4-4)'
type: 'feature'
created: '2026-10-26'
baseline_revision: '49c97c176ef95b51ab8c1219c710271c34707ed6'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/mockups/overview-desktop.html'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** "Übersicht" only lists the Depots (`DepotList`); there is no Portfolio-wide value, Gain/Loss, TTWROR/XIRR, chart, KPIs, top Positions, Depot comparison or headlines (FR10–FR12, FR18, UJ-1).

**Approach:** Add a pure core aggregation that sums the per-Depot valuation series and performances of all non-archived Depots over one common Period and computes Portfolio TTWROR/XIRR from the summed series; a ledger read `portfolioValuation` that resolves that common Period and returns the Portfolio plus each Depot's `DepotValuation`; and rebuild the Overview page per `mockups/overview-desktop.html`, reusing `ValueSummary` (hero + KPI row + `ValueChart`), `PeriodSelector`, `SecurityLogo`, `GainLossPill`, `StaleBadge`, the news listing and the Transaction dialog.

## Boundaries & Constraints

**Always:**
- Portfolio = non-archived Depots only (AD-17). Common Period: `resolvePeriod(selection, today, firstDate)` with `firstDate` = earliest Transaction date over those Depots; every Depot is evaluated over exactly that `from..to`, so all series share dates.
- Portfolio figures are sums of the per-Depot results of the same `depotValuation`-equivalent computation (AD-10): series points summed field by field (`value`, `positionsValue`, `cash`, `investedCapital`), `start` summed, and `gain`, `realized`, `unrealized`, `dividends`, `fees`, `feesContribution`, `taxesPaid`, `netExternalFlows` summed (FIFO stays per Depot — never run FIFO over the merged rows). Portfolio `ttwror` = `ttwror(summedStart, summedSeries, allRows)`; Portfolio `xirr` = `xirr` over the summed start value, the merged rows' external flows by date and the summed end value — same construction as `periodPerformance` (extract it into one shared core helper, used by both).
- Per-Depot row figures equal what that Depot's detail page shows for the same stored Period (including `MAX`, where the common `from` may precede the Depot's first date: zero-valued leading days must not change gain, TTWROR or XIRR — assert it in a test).
- All math in `src/core` with decimal strings (`ExactDecimal`); the shell only formats. No stored results, no Prisma migration, no `Date.now()` in core.
- Layout (mockup): header row with "Übersicht" (h1) and `PeriodSelector`; stale Alert; hero + KPI row via `ValueSummary` (section label "Portfoliowert" instead of "Depotwert" via a new optional prop, default unchanged); then a two-column grid on `md+` (single column below): card "Top-Positionen" | card "Nachrichten"; then card "Depots" full width. Composition (4.5) is not added.
- Stale Alert above the KPIs (i.e. directly under the header, above the hero card as in the mockup): shown when N ≥ 1 held Securities (non-archived Depots) have a stale latest price per `securityPriceInfo(today)[id].stale`; text `Kurse für N Wertpapiere veraltet.` (N = 1: `Kurs für 1 Wertpapier veraltet.`) plus link "Wertpapiere ansehen" → `/securities`; stale colors (`stale.soft` / `stale.main`), text not color alone.
- Top-Positionen: open Positions of all non-archived Depots as of today (`listPositions(..., { storedPrices: latestStoredPrices })`, same as the Depot Positions tab), one row per Depot Position, sorted by value descending (no price last), top 5. Row: `SecurityLogo`, name, `StaleBadge` when its price is stale (`isStale`), caption `<asset type label> · <Depot name> · <formatQuantity> Stück` (crypto: `<quantity> <cryptoSymbol>`), right side value (`formatMoney`, "–" without price) and `GainLossPill(gain, gainRatio)`. Not linked (Security detail is 4.6). None held: "Keine offenen Positionen.".
- Nachrichten: `listNews(today).articles.slice(0, 3)` — logo, headline as external link (new tab, `rel="noopener noreferrer"`, visually hidden new-tab hint as `NewsList`), `articleMeta(source, publishedAt)`; empty: `NEWS_EMPTY_TEXT`; link "Alle Nachrichten" → `/news`. No provider call and no auto-refresh on this page.
- Depots card: per non-archived Depot (name order as `listDepots`): name, Wert (Period end value), "G/V · <periodLabel>" as `GainLossPill(gain, null)`, TTWROR, XIRR (`formatPercent`, "–" when `null`, sign + arrow, never color alone). `md+`: a real `<table>` with column headers; each row opens `/depots/<id>` (name cell is the link; the link's hit area covers the row). Below `md`: stacked rows, each one link (≥ 44 px) to the Depot with name + value on the first line, pill + `TTWROR … · XIRR …` on the second. Only one of the two variants is displayed per breakpoint (CSS `display`).
- Loading: a route-level `loading.tsx` scoped to the Overview only (move the Overview into route group `src/app/(app)/(overview)/`), rendering MUI `Skeleton`s in the same layout (header, hero, KPI 2×2/4, two cards, Depots card), `aria-busy` region labelled "Übersicht wird geladen".
- Phone (`< md`): no horizontal page scroll; existing bottom navigation; FAB "+" (`aria-label="Neue Buchung"`, fixed bottom-right above the bottom navigation incl. safe-area inset, hidden from `md`). With one non-archived Depot it opens the existing `TransactionDialog` for it; with several it first opens a menu "Depot wählen" listing them, then the dialog for the chosen one. Desktop has no FAB.
- States kept: no Depot → existing empty state ("Noch kein Depot." + "Depot anlegen" / "Aus Parqet übernehmen"); only archived Depots → existing "Alle Depots sind archiviert." card. Non-archived Depots but no Transaction in any of them → header without PeriodSelector, card "Noch keine Buchungen." + FAB, and the Depots card (values 0,00 €, TTWROR/XIRR "–"); no hero, no alert, no top Positions, no news card.

**Never:**
- No Composition donut (4.5), no Security detail links (4.6), no benchmark. No changes to the Depot detail page behaviour, no change to `core/returns` / `core/valuation` results for a single Depot (pure refactor of the shared XIRR-flow helper only).
- No live provider calls (prices, news, logos) during render or in tests; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two Depots | A and B with trades, Deposits, a dividend, a tax; Period 1J | Portfolio value/invested/cash/dividends/taxes/gain/realized/unrealized = A + B exactly; series point on each date = A + B | — |
| Portfolio returns | same | TTWROR/XIRR equal `ttwror`/`xirr` computed by hand-built summed series and merged flows; one Depot alone → Portfolio returns = that Depot's | — |
| MAX, staggered starts | A starts 2024-01-10, B 2025-06-01 | common `from` = 2024-01-10; B's row gain/TTWROR/XIRR equal `depotValuation(B, MAX)` | — |
| Archived Depot | C archived with value | excluded from Portfolio, top Positions, Depots card and stale count | — |
| Empty Depot | D without Transactions next to A | D in Depots card with 0,00 € and "–"; Portfolio = A | — |
| Stale | 2 held Securities priced 5 days ago, 1 fresh | Alert "Kurse für 2 Wertpapiere veraltet." with link to `/securities` | — |
| No stale | all fresh | no Alert | — |
| > 3 headlines | 5 articles in window | 3 newest shown | — |

</intent-contract>

## Code Map

- `src/core/valuation.ts:17-23` -- `ValuationPoint`; add `sumValuationSeries(parts: readonly (readonly ValuationPoint[])[]): ValuationPoint[]` (pointwise sum; throws if lengths or dates differ; empty input → `[]`).
- `src/core/returns.ts` -- `periodPerformance` (end of file) builds `cashFlows` inline from `start`, `flowsByDate`, `end`: extract `periodCashFlows(rows, start, series): CashFlow[]` and reuse; add `portfolioPerformance(parts: readonly { rows: readonly ValuationRow[]; start: ValuationPoint; series: readonly ValuationPoint[]; performance: PeriodPerformance }[]): { start: ValuationPoint; series: ValuationPoint[]; performance: PeriodPerformance }` (sums + Portfolio `ttwror`/`xirr`). Tests in `src/core/returns.test.ts`, `src/core/valuation.test.ts`.
- `src/modules/ledger/valuation.ts` -- `depotValuation` (resolves Period per Depot via its first date). Refactor body into an internal `valuationOver(depotId, from, to, db, storedPrices)` that also returns the rows; `depotValuation` keeps its signature/behaviour. Add `portfolioValuation(selection, today, db = prisma, { storedPrices })` → `PortfolioValuation = { from; to; start; series; dividends; taxesPaid; performance; hasTransactions: boolean; depots: { id; name; valuation: DepotValuation }[] }` over non-archived Depots (`db.depot.findMany({ where: { archived: false } })`, sorted by name `localeCompare(…, "de-DE")`). Export both from `src/modules/ledger/index.ts`. Tests in `src/modules/ledger/valuation.test.ts` (existing helpers/fixtures there).
- `src/modules/ledger/positions.ts:82` -- `listPositions(depotId, today, db, { storedPrices })` → `PositionRecord` (`value`, `gain`, `gainRatio`, `priceDate`, `priceSource`, `priceFetchedAt`, `priceProvider`, `security { id, name, assetType, cryptoSymbol }`).
- `src/modules/prices/prices.ts:400` -- `securityPriceInfo(today)` → `stale` already restricted to held (non-archived) Securities; `latestStoredPrices`, `storedPriceHistory` loaders.
- `src/modules/news/news.ts:187` -- `listNews(today)` → `articles` newest first (held Securities, 14-day window).
- `src/app/(app)/page.tsx` + `page.test.tsx` -- current Overview (empty/archived states, `DepotList`); move both to `src/app/(app)/(overview)/` (fix relative imports: test helpers gain one `../`), rebuild page; add `loading.tsx` there.
- `src/app/(app)/depots/[id]/page.tsx` -- reference composition: `readPeriod(today)`, `PeriodSelector`, `ValueSummary` props from `valuation.series.at(-1)`, `periodLabel(period)`.
- `src/app/_components/valuation/ValueSummary.tsx` -- add optional `label` prop (section `aria-label`, default "Depotwert").
- `src/app/_components/positions/GainLossPill.tsx`, `src/app/_components/prices/StaleBadge.tsx` (`StaleBadge`, `PriceDateInfo` from `price-labels.ts`), `src/app/_components/positions/PositionsTable.tsx:52-62` (`priceInfo` pattern), `src/app/_components/securities/SecurityLogo.tsx`, `src/app/_components/transactions/labels.ts:23` (`ASSET_TYPE_LABELS`), `src/core/format.ts` (`formatMoney`, `formatPercent`, `formatQuantity`).
- `src/app/_components/news/NewsList.tsx`, `src/app/_components/news/labels.ts` (`articleMeta`, `NEW_TAB_HINT`, `NEWS_EMPTY_TEXT`) -- headline row pattern.
- `src/app/_components/transactions/TransactionDialog.tsx:460` -- `TransactionDialog({ open, onClose, formKey, depot, securities, today })` for the FAB.
- `src/app/_components/AppShell.tsx` -- `BOTTOM_NAV_HEIGHT = 56`; main padding-bottom already leaves room; FAB must sit above the bottom nav.
- `test/helpers/render-text.ts`, `test/helpers/next-mocks.ts` (`findElement`), `test/helpers/dom.tsx` -- page/DOM test helpers.

## Tasks & Acceptance

**Execution:**
- `src/core/valuation.ts` (+ test) -- `sumValuationSeries` -- one summing rule for Portfolio series.
- `src/core/returns.ts` (+ test) -- extract `periodCashFlows`; add `portfolioPerformance`; tests: two Depots (sums exact, `gain = realized + unrealized + dividends − fees` holds), single Depot (identical to its own performance), Portfolio TTWROR/XIRR against hand-computed summed inputs, Deposit in one Depot not a gain.
- `src/modules/ledger/valuation.ts`, `src/modules/ledger/index.ts` (+ test) -- `portfolioValuation`; tests: matrix rows "Two Depots", "MAX staggered starts" (row = `depotValuation`), "Archived Depot", "Empty Depot", none-with-Transactions (`hasTransactions` false).
- `src/app/_components/valuation/ValueSummary.tsx` (+ test) -- optional `label`.
- `src/app/_components/overview/StaleAlert.tsx`, `TopPositions.tsx`, `LatestNews.tsx`, `DepotPerformance.tsx`, `OverviewSkeleton.tsx` (+ `labels.ts` with `staleAlertText(n)` and tests) -- Overview sections, server-renderable (client only where needed).
- `src/app/_components/overview/NewTransactionFab.tsx` (+ `NewTransactionFab.dom.test.tsx`) -- client FAB; DOM test: one Depot opens dialog "Neue Buchung" directly; two Depots open menu, choosing one opens the dialog.
- `src/app/(app)/(overview)/page.tsx`, `loading.tsx`, `page.test.tsx` (moved) -- rebuilt Overview; page tests: hero "Gesamtwert" equals Portfolio sum text, KPI row, chart label present, Depots card rows link to `/depots/<id>` with value/TTWROR/XIRR texts equal to each Depot's `depotValuation` formatting, archived Depot absent, stale Alert text and link, top Positions order and cap of 5, 3 newest headlines, empty/archived/no-Transactions states, `loading.tsx` renders Skeletons with the busy label.

**Acceptance Criteria:**
- Given two non-archived Depots with history and a stored Period, when "Übersicht" renders, then the hero shows the Portfolio "Gesamtwert", gain/loss pill with TTWROR, XIRR, chart and breakdown, the KPI row shows invested capital, dividends, cash, taxes, and every amount equals the sum of the two Depots' detail-page figures for that Period.
- Given the Depots card, when a row is activated (click or keyboard), then `/depots/<id>` opens, and its value, G/V, TTWROR and XIRR texts equal that Depot's hero texts.
- Given a held Security with a stale price, when the Overview renders, then the stale Alert with count and "Wertpapiere ansehen" link appears above the hero/KPIs; without stale prices it is absent.
- Given a phone width, when the Overview renders, then the FAB "+" and bottom navigation are present, content stacks into one column and the Depots card uses stacked link rows.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 25 findings — high 0, medium 1, low 15, false 9, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: phone FAB covers the last ~56 px of content (AppShell padding only clears the bottom nav) — fixed: `NewTransactionFab` renders a phone-only, aria-hidden 72 px spacer with the FAB.
  - `[false]` `[reject]` Blind: FAB importing `BOTTOM_NAV_HEIGHT` from `AppShell` pulls the shell into its bundle — `AppShell` is already loaded on every page by the `(app)` layout; no extra code ships.
  - `[low]` `[reject]` Blind: `visuallyHidden` exported from the `NewsList` component file — no named harm beyond style; moving it is churn without benefit.
  - `[low]` `[reject]` Blind: Positions/news/stale loads wait for `portfolioValuation`; corporate actions loaded per Depot — real but a handful of local SQLite reads for a single-user app; the Overview skeleton covers the wait; restructuring adds complexity.
  - `[false]` `[reject]` Blind: Top-Positionen React key uses the Depot name — `Depot.name` is unique and a rename re-renders the server page; keys stay unique.
  - `[false]` `[reject]` Blind: `topPositions` tie order undefined — `Array.prototype.sort` is stable and the input order (Depot name order, then `listPositions` order) is deterministic.
  - `[low]` `[patch]` Blind: page-test `section()` slice runs to the end of the page, so KPI texts could match later cards — fixed: helper takes an end marker; KPI slice stops at `overview-top-positions`.
  - `[low]` `[patch]` Blind: no Overview test with a non-default stored Period — same root as the verification-gap Period row; fixed by the MAX cookie test.
  - `[low]` `[patch]` Blind: hero TTWROR/XIRR values not asserted on the page — fixed: hero test asserts `formatPercent` of `portfolioValuation(...).performance.ttwror/xirr` (both non-null).
  - `[low]` `[reject]` Blind: zero-leading-days core test sits in the `portfolioPerformance` describe without calling it — cosmetic placement; the Portfolio MAX case is covered in the ledger test "evaluates every Depot from the earliest first date for MAX".
  - `[false]` `[reject]` Blind: Portfolio `dividends`/`taxesPaid` taken from `performance` may diverge from `periodFlows` — `periodPerformance` returns exactly `periodFlows(rows, from, to)`'s values, the same call `DepotValuation` uses; there is no second computation.
  - `[low]` `[reject]` Blind: `position: relative` on `<tr>` unsupported in old WebKit — all current engines support it; single-user app on a current browser; the name link itself still works everywhere.
  - `[low]` `[reject]` Blind: no test that the FAB is hidden from `md` — plain MUI `display` breakpoint sx; happy-dom does not evaluate it meaningfully; covered by the manual check.
  - `[low]` `[reject]` Edge: a Depot archived between `listDepots` and `portfolioValuation` shows "Noch keine Buchungen." — needs a concurrent archive in the same render; next refresh is correct.
  - `[low]` `[reject]` Edge: FAB keeps a Depot that a refresh removed/archived — the ledger refuses bookings into archived Depots; extra state reconciliation for a near-impossible case.
  - `[false]` `[reject]` Edge: Broker and per-Depot cash no longer on the Overview — intended: the Overview follows the mockup's Depots table (value, G/V, TTWROR, XIRR); cash is in the KPI row, Broker on the Depot page.
  - `[low]` `[patch]` Verification gap: stored Period never set in page tests — fixed: test with `PERIOD_COOKIE = MAX` asserts `G/V · Max` and Depot rows equal `depotValuation(id, MAX)`.
  - `[low]` `[patch]` Verification gap: Top-Positionen stored-price use untested — fixed: `twoDepots()` test asserts Apple at `1.814,00 €` (stored 181,4).
  - `[low]` `[patch]` Verification gap: StaleBadge in Top-Positionen untested — fixed: stale test asserts two badges (SAP SE, Mercedes AG), none for Apple Inc.
  - `[false]` `[reject]` Intent: grid differs from the mockup (Nachrichten beside Top-Positionen, Depots full width) — composition is story 4.5; the remaining cards keep the mockup's order and look.
  - `[low]` `[reject]` Intent: layout, tap, skeleton timing and phone overflow only checked via SSR HTML/happy-dom — no browser runner in the repo; listed as residual risk and manual check.
  - `[low]` `[reject]` Intent: logos in Top-Positionen/Nachrichten not asserted — `SecurityLogo` is rendered unconditionally in both rows and has its own DOM tests; no bad outcome named.
  - `[false]` `[reject]` Intent: Top-Positionen not built on the core held set — positions come from `listPositions` of non-archived Depots (open quantity > 0), the same held definition; stale count uses `securityPriceInfo`, which uses `listHeldSecurities`.
  - `[false]` `[reject]` Intent: Top-Positionen pill shows amount and percent instead of percent only — consistent with the Positions table pill; mockup detail, spines win.
  - `[false]` `[reject]` Intent: hero TTWROR/XIRR values unchecked — duplicate of the Blind hero row, patched there.

## Design Notes

Why a common Period instead of summing each Depot's own `depotValuation`: for `MAX` every Depot would start on its own first date, so series dates would not align and the chart/TTWROR could not be summed. Zero-valued leading days are neutral: `ttwror` skips days with denominator 0, `xirr` drops zero amounts, `gain = V(to) − 0 − flows`.

Portfolio TTWROR is not a weighted average of Depot TTWRORs — it must be chained over the summed daily values with all external flows, which is why `portfolioPerformance` gets the merged rows.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`, open "/" with two Depots: layout matches the mockup (minus composition); phone width (375 px) has no horizontal scroll, FAB above bottom nav; Depot rows navigate; Skeleton appears on slow load.

## Auto Run Result

Status: done

**Summary:** Story 4.4 rebuilds "Übersicht" as the Portfolio overview. Core sums the per-Depot valuation series and Gain/Loss split of all non-archived Depots over one common Period (`sumValuationSeries`, `portfolioPerformance`; FIFO stays per Depot) and chains Portfolio TTWROR / solves XIRR over the summed series with all external flows (shared `periodCashFlows` helper, also used by `periodPerformance`). The ledger read `portfolioValuation` resolves that Period (MAX = earliest first date) and returns Portfolio plus per-Depot valuations; per-Depot figures equal the Depot pages. The page shows header + Period selector, stale Alert, hero/KPI row ("Portfoliowert"), Top-Positionen (top 5, logos, stale badge), the three newest headlines, and the Depots card (table on md+, stacked link rows on phones), with Skeleton loading, a phone FAB "+" (Depot choice menu with several Depots) and the empty/archived/no-bookings states.

**Files changed:**
- `src/core/valuation.ts` (+ test) — `sumValuationSeries`.
- `src/core/returns.ts` (+ test) — `periodCashFlows` extracted, `portfolioPerformance`.
- `src/modules/ledger/valuation.ts`, `index.ts` (+ test) — `valuationOver` refactor, `portfolioValuation`.
- `src/app/(app)/(overview)/page.tsx`, `loading.tsx`, `page.test.tsx` — Overview moved into a route group and rebuilt; old `src/app/(app)/page.tsx`/test removed.
- `src/app/_components/overview/*` — `StaleAlert`, `TopPositions`, `LatestNews`, `DepotPerformance`, `OverviewSkeleton`, `NewTransactionFab` (+ DOM test), `CardHeading`, `labels.ts` (+ test).
- `src/app/_components/valuation/ValueSummary.tsx` (+ test) — optional section `label`.
- `src/app/_components/AppShell.tsx`, `news/NewsList.tsx` — export `BOTTOM_NAV_HEIGHT`, `visuallyHidden` for reuse.

**Review findings:** 25 — patched 6 entries (medium 1: FAB covering page end; low 5: KPI test slice, stored-Period test, hero TTWROR/XIRR values, stored prices and stale badge in Top-Positionen). Deferred: none. Rejected: 19 rows (9 false claims; low: request waterfall, `visuallyHidden` location, misplaced core test, old-WebKit `tr` positioning, FAB breakpoint test, archive race, FAB stale Depot, browser-only checks, logo assertions) — reasons in the Review Triage Log.

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 1, low 5 (first pass: no high, fewer than two medium).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (126 files, 1755 tests) after patches. Matrix audit: every I/O row covered by passing core, ledger or page tests (archived-Depot exclusion of top Positions/stale count added during verification).

**Residual risks:** Not inspected in a real browser (mockup fidelity, 375 px overflow, FAB placement, whole-row click overlay, Skeleton during streaming). Each Overview render computes every non-archived Depot's daily series plus positions; long MAX histories may be slow (Skeleton covers it).
