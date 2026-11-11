---
title: 'Warnings for Crossed Marks'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_revision: '51a6ca98b0e6360c907685d1bfd321868e57a799'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3-price-marks-on-the-detail-page.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A crossed stop or target is only visible on the Security's own detail page (12.3); Tommy has no single place listing every breach and no hint in the securities list or the watchlist table.

**Approach:** A new marks-module read `breachedPriceMarks(today)` returns every Security whose marks are breached (from `priceMarksView`, i.e. `core/price-marks` `priceMarkState`) with name and held flag. The dashboard renders a card "Kursmarken erreicht" only when that list is non-empty; the securities list and the watchlist table show a warning icon with tooltip and accessible text at breached Securities.

## Boundaries & Constraints

**Always:**
- Breach comes only from `PriceMarkState.breached` (`priceMarksView`); no screen compares prices itself (AD-24). No acknowledgement, nothing stored: the warning is derived on every render, so it disappears when the Price returns or the mark is changed/cleared.
- `breachedPriceMarks(today, db)`: loads all PriceMark rows, maps each row's Security to `currentSecurityId` (ISIN successor), calls `priceMarksView` on those distinct ids, keeps `state.breached !== "none"`; per item `{ securityId, name, held, marks, state }` (held = in `listHeldSecurities(today)`, non-archived Depots), sorted by name (`de-DE`). No provider call.
- Dashboard card (`section`, heading h2 `Kursmarken erreicht` via `CardHeading`) placed right after `StaleAlert` and before `ValueSummary`; also rendered in the "Noch keine Buchungen" branch (after `Header`). Absent (not rendered at all) when the list is empty. Not shown in the "Noch kein Depot" / "Alle Depots sind archiviert" branches.
- Card row: `SecurityLogo`, name as `SecurityLink` to the detail page, breach pill `breachPillText(breach, priceDate)` (same pill look as the detail card — extract `BreachPill` to `src/app/_components/price-marks/BreachPill.tsx` and reuse it in `PriceMarksCard`), chip `im Depot` when held (outlined primary, like news), caption = the breached mark's row text (`stopRowText` / `targetRowText`: mark value and distance), right side `formatMoney(state.price)` as the latest Price.
- Warning icon (`WarningAmberOutlined`, colour `stale.main`) in a new client component `PriceMarkWarning` (`src/app/_components/price-marks/PriceMarkWarning.tsx`): MUI `Tooltip` with title `breachPillText(...)`, wrapper `span` with `role="img"`, `aria-label` = same text, `tabIndex={0}`. Placed right after the Security name in the securities list card and in the watchlist `SecurityCell` (both layouts).
- Securities list: page passes `breaches` (`Record<securityId, { breach: "stop" | "target"; priceDate: string }>`, from `breachedPriceMarks`) to `SecurityList`; the "Nur Probleme" `problem` flag is unchanged.
- Watchlist table: page derives the same `breaches` shape from its existing `priceMarksView(securityIds)` result and passes it to `WatchlistTable`.

**Never:** No push/e-mail, no acknowledgement or dismiss button, no stored breach flag, no change to `core/price-marks` breach semantics, no schema change, no MCP changes (12.5), no new design tokens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Breached stop, held | FIXED stop 90, latest 85, held | card row: pill `Stopp unterschritten · Kurs vom …`, `im Depot`, `Stopp · 90,00 € · +5,9 %`, `85,00 €`; icon in list | — |
| Reached target, watched | target 120, latest 125, only on a watchlist | card row with `Ziel erreicht · Kurs vom …`, no `im Depot`; icon in watchlist table and list | — |
| None breached | marks set, price between | no card, no icons | — |
| No marks / no Price | — | no card, no icons (`breached` is `none`) | — |
| Mark cleared / price returns | state `none` on next render | card row and icon gone | — |
| ISIN change | marks on predecessor, successor current | item keyed by successor id | — |

</intent-contract>

## Code Map

- `src/modules/marks/marks.ts` -- `priceMarksView` (l.123), `rowsFor`, `loadActions`, `ROW_SELECT`; add `breachedPriceMarks` + type `BreachedPriceMark`; export from `index.ts`. `listHeldSecurities` (`src/modules/ledger/depots.ts:209`) and `listSecurities`/`getSecurity` via `@/modules/ledger`.
- `src/core/price-marks.ts` -- `PriceMarkState`, `PriceMarkBreach` (read-only).
- `src/app/(app)/(overview)/page.tsx` -- `StaleAlert` placement, "Noch keine Buchungen" branch, `today`.
- `src/app/_components/overview/TopPositions.tsx` -- row layout (logo, link, caption, right value) to mirror; `CardHeading.tsx`.
- `src/app/_components/security-detail/PriceMarksCard.tsx` -- `BreachPill` to extract.
- `src/app/_components/price-marks/labels.ts` -- `breachPillText`, `stopRowText`, `targetRowText`; add `BREACHED_MARKS_HEADING = "Kursmarken erreicht"`.
- `src/app/_components/news/labels.ts` -- `HELD_IN_DEPOT_LABEL` ("im Depot").
- `src/app/(app)/securities/page.tsx`, `src/app/_components/securities/SecurityList.tsx` (name Typography l.~100, `problem` l.162).
- `src/app/(app)/watchlists/page.tsx` (marks via `priceMarksView`), `src/app/_components/watchlists/WatchlistTable.tsx` (`SecurityCell` l.109, props l.410).
- `src/app/_components/security-detail/SecurityLink.tsx`, `src/app/_components/securities/SecurityLogo.tsx`.
- Tests: `src/modules/marks/marks.test.ts` (helpers `security`, `price`, `set`), `src/app/(app)/(overview)/page.test.tsx` (`renderText`, `findElement`), `src/app/(app)/securities/page.test.tsx`, `src/app/(app)/watchlists/page.test.tsx`, `SecurityList.dom.test.tsx`, `WatchlistTable.dom.test.tsx`.

## Tasks & Acceptance

**Execution:**
- `src/modules/marks/marks.ts`, `index.ts` (+ test) -- `breachedPriceMarks(today, db)`; tests: breached stop held, reached target watched-only, not breached excluded, no Price excluded, predecessor row keyed by successor, sorted by name.
- `src/app/_components/price-marks/BreachPill.tsx`, `PriceMarksCard.tsx` -- extract the pill unchanged.
- `src/app/_components/price-marks/PriceMarkWarning.tsx` (+ DOM test) -- icon, tooltip, accessible name.
- `src/app/_components/overview/BreachedMarks.tsx` (+ DOM test) -- the card; rows for breached stop (held) and reached target (watched); links to `/securities/<id>`.
- `src/app/(app)/(overview)/page.tsx` (+ test) -- load `breachedPriceMarks(today)`, render card per the rules; test present with a breach, absent without.
- `src/app/(app)/securities/page.tsx`, `SecurityList.tsx` (+ tests) -- `breaches` prop, icon; DOM test that "Nur Probleme" count ignores a breach.
- `src/app/(app)/watchlists/page.tsx`, `WatchlistTable.tsx` (+ tests) -- `breaches` prop, icon in `SecurityCell`.

**Acceptance Criteria:**
- Given at least one breached mark, when the dashboard renders, then "Kursmarken erreicht" lists each breached Security with logo, linked name, breach pill, mark, latest Price and distance, held ones with "im Depot".
- Given no breached mark, when the dashboard renders, then the card is absent.
- Given a breached Security, when the securities list or the watchlist table renders, then a warning icon with tooltip and accessible text "Stopp unterschritten · Kurs vom …" / "Ziel erreicht · Kurs vom …" sits at it, and "Nur Probleme" is unaffected.
- Given a breach that ends (Price back or mark cleared), when the screens render again, then card row and icons are gone.

## Spec Change Log

## Review Triage Log

### 2026-11-11 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 18, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `BreachedPriceMark.state.priceDate` stays nullable; consumers guard null differently — a breach implies a Price (core sets `breached` only with a latest Price), so the guards are dead code, no user-visible effect.
  - `[low]` `[reject]` (blind) State → `{ breach, priceDate }` mapping written twice (securities, watchlists) — both read `PriceMarkState.breached` from `priceMarksView`; no divergence shown.
  - `[low]` `[reject]` (blind) ISIN-change predecessor row in the securities list has no icon while a watchlist entry on the predecessor does — rare (ISIN change + breached mark + looking at the old ISIN row); the successor row carries the icon; fix needs a full-list `priceMarksView` or extra mapping.
  - `[low]` `[reject]` (blind) `breachedPriceMarks` reloads rows/actions/securities — single-user SQLite, negligible; merging needs a new module API.
  - `[low]` `[patch]` (blind) Sort by name has no tie-breaker — added `securityId` as secondary key in `breachedPriceMarks`.
  - `[low]` `[reject]` (blind) Trailing stop not tested in the breached paths — breach and row text for trailing stops are covered by core and 12.3 label tests; test-only gap.
  - `[low]` `[reject]` (blind) "Noch kein Depot" / "Alle Depots archiviert" branches untested for the card — test-only gap; the branches return before the load.
  - `[low]` `[reject]` (blind) Section and list both labelled "Kursmarken erreicht" — same pattern as the existing Top-Positionen card; cosmetic for screen readers.
  - `[low]` `[patch]` (blind) Latest Price amount unlabelled for screen readers — added visually hidden "Letzter Kurs " prefix; DOM and page tests updated.
  - `[low]` `[reject]` (blind) Securities/watchlists page tests compute today separately from the page (midnight flake) — same pattern as the existing tests in those files; rare.
  - `[low]` `[reject]` (blind) Overview test asserts one long text incl. logo initials — brittle but correct; test-only.
  - `[low]` `[reject]` (blind) Icon click guard only tested on desktop layout — same component in both layouts; test-only gap.
  - `[low]` `[reject]` (blind) Watchlist page test checks props, not rendered icon — rendering covered by the WatchlistTable DOM test; test-only.
  - `[low]` `[reject]` (edge) Predecessor row in securities list lacks icon — same as the blind ISIN row; rare, fix adds complexity.
  - `[low]` `[reject]` (intent) Card hidden when no Depot exists or all are archived — onboarding states; unlikely with breached marks; fix needs extra loading in early branches.
  - `[low]` `[reject]` (intent) Uneven page-level coverage across securities/watchlists — the AC cases are covered across page and DOM tests together; test-only.
  - `[false]` `[reject]` (intent) "Both absent" read as "nothing breached" — the AC's "both absent" is the card/icons being absent; covered by the overview page test and module tests (no marks, not breached).
  - `[low]` `[reject]` (intent) "Mark changed" ending a breach not tested — state is recomputed on every render; cleared and Price-back cases are tested.
  - `[false]` `[reject]` (intent) Only the name links, not the whole row — the AC asks each entry to link to the detail page; the name link does.
  - `[low]` `[reject]` (intent) Tests render static HTML, not hydration — tooltip and focus covered by the PriceMarkWarning DOM test.
  - `[false]` `[reject]` (intent) Process surface divergence — none found; not a defect.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Breached price marks are now visible outside the detail page: the dashboard shows a card "Kursmarken erreicht" (only while at least one stop or target is crossed) listing each Security with logo, linked name, breach pill, "im Depot" when held, the crossed mark with distance and the latest Price; the securities list and the watchlist table (both layouts) show a warning icon with tooltip and accessible text. All screens read the breach from `core/price-marks` via `priceMarksView`; nothing is stored, no acknowledgement; "Nur Probleme" is unchanged.

**Files changed:**
- `src/modules/marks/{marks.ts,index.ts}` (+ test) — `breachedPriceMarks(today)` and type `BreachedPriceMark`.
- `src/app/_components/price-marks/BreachPill.tsx` — pill extracted from `PriceMarksCard` (unchanged look); `PriceMarksCard.tsx` reuses it.
- `src/app/_components/price-marks/PriceMarkWarning.tsx` (+ DOM test) — warning icon with tooltip, accessible name, keyboard focus.
- `src/app/_components/price-marks/labels.ts` — `BREACHED_MARKS_HEADING`.
- `src/app/_components/overview/BreachedMarks.tsx` (+ DOM test) — the dashboard card.
- `src/app/(app)/(overview)/page.tsx` (+ test) — card after the stale Alert, also before the first Transaction.
- `src/app/(app)/securities/page.tsx`, `src/app/_components/securities/SecurityList.tsx` (+ tests) — `breaches` prop and icon.
- `src/app/(app)/watchlists/page.tsx`, `src/app/_components/watchlists/WatchlistTable.tsx` (+ tests) — `breaches` from the existing marks view, icon in both layouts.

**Review findings:** 21 — high 0, medium 0, low 18, false 3. Patched: 2 low (sort tie-breaker; hidden "Letzter Kurs" label). Deferred: none. Rejected: all others — reasons per row in the Review Triage Log.

**Follow-up review recommended:** false — patched counts: high 0, medium 0, low 2.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — pass (278 files, 3917 tests; build compiled), re-run after the patches.

**Residual risks:** an ISIN-change predecessor row in the securities list shows no icon (the successor row does); the card is not shown in the "Noch kein Depot" / "Alle Depots archiviert" states; marks are re-read on each of the three pages per render.
