---
title: 'Composition (story 4-5)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '833015d3b48debafa6fdef3d1297b30578129a27'
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

**Problem:** Neither the Overview nor the Depot detail shows what the Portfolio or a Depot consists of (FR13 / CAP-13, UX-DR8, UX-DR21).

**Approach:** Add pure `src/core/composition.ts` that turns valued holdings plus cash into ordered segments with exact shares and display shares summing to 100,0 %, and a client `CompositionCard` (hand-drawn SVG donut + legend + view toggle) placed on the Overview (views Position · Typ · Depot) and in a new Depot detail tab "Zusammensetzung" (views Position · Typ).

## Boundaries & Constraints

**Always:**
- Composition is a snapshot as of today, independent of the Period selector — the same values as the Positions tab / Top-Positionen: `listPositions(depotId, today, db, { storedPrices: latestStoredPrices })` values plus the Depot's `cashBalance` (`DepotSummary`, as of today). Overview = non-archived Depots only (AD-17). Positions with `value === null` (no price) are left out.
- Total = Σ included Position values + Σ cash. Every segment's exact `share = amount / total` (decimal string); shares of all segments sum to exactly 1. `displayShare` = share rounded to 0,1 %-steps (ratio with 3 decimals) by largest remainder so the displayed values sum to exactly 100,0 % (ties of remainder: larger amount first, then segment order); if any segment amount is negative (negative cash) use plain half-up rounding instead.
- Segments: zero-amount segments are dropped; total ≤ 0 → no segments. Order: item segments by amount descending (tie: label `localeCompare(…, "de-DE")`), then "Sonstige", then cash "Guthaben" last. Cash is always its own segment (kind `cash`) in every view, including "Depot".
- Views: **Position** — one segment per Security (merged across Depots by Security id, label = Security name); more than 8 → top 8 + one "Sonstige" segment summing the rest. **Typ** — one segment per asset type, labels ETF, Fonds, Aktie, Zertifikat, Krypto, Unklassifiziert (UNCLASSIFIED; not "Nicht zugeordnet"). **Depot** (Overview only) — one segment per Depot = its Positions value (cash is in "Guthaben").
- Colors: non-cash segments in order take `chart.series1..series5`, cycling; cash takes `cash.main`; read from `(theme.vars ?? theme).palette` as `ValueChart` does.
- Donut: inline SVG (`viewBox 0 0 42 42`, circumference-100 circle, stroke segments via `stroke-dasharray`, starting at 12 o'clock); only segments with positive amount are drawn; the only number conversion is `Number(share)` at this presentation edge. `role="img"` with `aria-label` text alternative listing every segment: `Zusammensetzung nach <Position|Typ|Depot>: <label> <displayShare> (<amount>), …`.
- Legend: list of rows (swatch, label, `formatShare(displayShare)` e.g. `61,8 %`, `formatMoney(amount)`), each row a button ≥ 44 px with `aria-pressed`; activating it highlights its segment (highlighted segment thicker, others dimmed; `data-highlighted="true"` on the segment), activating again clears; switching view clears the highlight.
- View toggle: `ToggleButtonGroup` exclusive, `aria-label="Aufteilung"`, buttons "Position", "Typ", "Depot" (≥ 44 px); default "Typ" (mockup); state is client-only.
- Card: section labelled by `CardHeading` "Zusammensetzung"; no segments → `Keine Werte vorhanden.`.
- Overview layout per mockup: row 1 (md+: `1.5fr 1fr`) Top-Positionen | Zusammensetzung; row 2 (md+: `1.5fr 1fr`) Depots | Nachrichten; single column below md, in that order. `OverviewSkeleton` follows the same two rows. No-Transactions state unchanged (no composition card).
- Depot detail: `DEPOT_TABS` gains `{ value: "composition", label: "Zusammensetzung" }` after "Buchungen"; the page loads positions for tab `positions` or `composition`; works for archived Depots; empty Depot keeps the existing empty state.
- New `formatShare(ratio)` in `src/core/format.ts`: unsigned, 1 decimal, `"0.618"` → `61,8 %` (NBSP before %).

**Never:**
- No ETF look-through, sectors or countries; no persisted composition; no `number` arithmetic on amounts outside the SVG geometry; no new dependency (no x-charts PieChart needed); no change to existing Overview/Depot figures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thirds | three holdings 100 each, cash 0 | 3 segments, displayShares 0.334/0.333/0.333 (sum 1.000), no cash segment | — |
| Top 8 | 10 Securities + cash 50 | 8 items desc, "Sonstige" = sum of the 2 smallest, then "Guthaben" | — |
| Merge | same Security in Depot A (300) and B (200) | one Position segment 500 | — |
| By type | ETF 600, STOCK 300, UNCLASSIFIED 50, cash 50 | ETF 60,0 %, Aktie 30,0 %, Unklassifiziert 5,0 %, Guthaben 5,0 % | — |
| By Depot | A positions 700 + cash 100, B positions 200 | A 70,0 %, B 20,0 %, Guthaben 10,0 % | — |
| Negative cash | holdings 1000, cash −10 | Guthaben listed with negative share, not drawn; shares still sum to 1 | half-up rounding |
| Nothing | no Positions, cash 0 | `[]`; card shows `Keine Werte vorhanden.` | — |
| No price | Position with `value` null | excluded from all views | — |

</intent-contract>

## Code Map

- `src/core/composition.ts` (new) -- pure: `CompositionHolding = { securityId; securityName; assetType: string; depotId; depotName; value: string }`, `CompositionSegment = { key; kind: "item" | "other" | "cash"; label; amount; share; displayShare }`, `compositionByPosition(holdings, cash, labels, limit = 8)`, `compositionByAssetType(holdings, cash, labels)`, `compositionByDepot(holdings, cash, labels)`; `labels = { other: string; cash: string; assetType: (type: string) => string }` passed by the shell (core stays label-free). Imports only `./decimal` (`ExactDecimal`, `canonicalDecimal`). Enforced by `test/architecture/core-imports.test.ts`.
- `src/core/format.ts:56` -- `formatPercent` pattern; add `formatShare` beside it (+ `format.test.ts`).
- `src/modules/ledger/positions.ts:82` -- `listPositions` → `PositionRecord { value: string | null; security { id, name, assetType } }`.
- `src/modules/ledger/depots.ts:20` -- `DepotSummary.cashBalance` (as of today) from `listDepots` / `getDepot`.
- `src/app/(app)/(overview)/page.tsx` -- already loads `positionsByDepot` (latestStoredPrices) and `all` (`listDepots`); build holdings + cash here, compute three views via core, render `CompositionCard`; regroup the grid into the two mockup rows.
- `src/app/(app)/(overview)/page.test.tsx` -- `twoDepots()` fixture, `section()` helper with end marker; extend.
- `src/app/(app)/depots/[id]/page.tsx` -- tab dispatch; add composition branch (views Position, Typ). Tests in `page.test.tsx` beside it.
- `src/app/_components/depots/depot-tabs.ts` -- `DEPOT_TABS`.
- `src/app/_components/charts/ValueChart.tsx:24-31` -- theme color access pattern (`theme.vars ?? theme`, `palette.chart`, fallbacks for bare render).
- `src/theme/theme.ts:20-24,106-113` -- `palette.chart.series1..5`, `palette.cash`.
- `src/app/_components/overview/CardHeading.tsx`, `OverviewSkeleton.tsx` -- card heading; skeleton layout to update.
- `src/app/_components/transactions/labels.ts:23` -- `ASSET_TYPE_LABELS` (reuse for ETF/Fonds/Aktie/Zertifikat/Krypto; override UNCLASSIFIED → "Unklassifiziert").
- `test/helpers/dom.tsx` (`registerDomCleanup`) -- DOM tests use `// @vitest-environment happy-dom`.

## Tasks & Acceptance

**Execution:**
- `src/core/composition.ts` + `composition.test.ts` -- segment builders -- covers every I/O matrix row plus: shares sum exactly 1, ordering/tie rule, exactly 8 Securities → no "Sonstige".
- `src/core/format.ts` + test -- `formatShare`.
- `src/app/_components/composition/labels.ts` (+ test) -- `COMPOSITION_LABELS` (Sonstige, Guthaben, asset type labels incl. Unklassifiziert), view names, `compositionAriaLabel(viewLabel, segments)`, `segmentColorKeys(segments)`.
- `src/app/_components/composition/CompositionCard.tsx` + `CompositionCard.dom.test.tsx` -- client card; DOM tests: legend texts (percent + amount), aria-label text alternative, toggle switches view and clears highlight, legend click sets `aria-pressed` and `data-highlighted`, second click clears, cash segment drawn with the cash color and last, empty text, no Depot toggle when only two views given.
- `src/app/_components/depots/depot-tabs.ts`, `src/app/(app)/depots/[id]/page.tsx` (+ test) -- composition tab.
- `src/app/(app)/(overview)/page.tsx`, `OverviewSkeleton.tsx` (+ page test) -- card on Overview, regrouped rows; test: card present with three toggle buttons, default Typ legend percentages for `twoDepots()` sum to 100,0 % and amounts equal Positions + cash; archived Depot excluded.

**Acceptance Criteria:**
- Given the Overview with non-archived Depots holding Positions and cash, when "Zusammensetzung" renders, then a donut with legend shows the Typ view by default, the toggle offers Position, Typ and Depot, cash is the last segment "Guthaben" in the cash color, and the legend percentages sum to 100,0 % with amounts equal to the Positions-tab values plus cash.
- Given the Depot detail, when the tab "Zusammensetzung" is opened, then the same card shows only Position and Typ for that Depot's Positions and cash.
- Given a legend row, when it is tapped or activated by keyboard, then its segment is highlighted and the row is `aria-pressed="true"`; tapping again clears it.
- Given a screen reader, when the donut is reached, then its text alternative lists every segment with share and amount.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 27 findings — high 0, medium 1, low 22, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: Position view cycles 5 series colors over up to 9 segments (1/6, 2/7 … share a color) — spec-mandated cycling (DESIGN has only series-1..5 "in fixed order"); legend rows carry the label; changing it means editing this spec.
  - `[low]` `[reject]` Blind: with negative cash the legend shares exceed 100 % while the ring spans positives only — spec-defined behavior for a rare state (Cash Accounts are kept non-negative by booking/migration rules); a note would add UI surface for an edge case.
  - `[low]` `[patch]` Blind: pressing the undrawn negative "Guthaben" row dims every segment — fixed: effective highlight only when the key is a drawn segment of the current view (shared root with the two Edge rows below); DOM test added.
  - `[low]` `[reject]` Blind: total ≤ 0 shows "Keine Werte vorhanden." although Positions exist — needs negative cash exceeding all Positions; spec-defined; extra legend-only mode is new complexity.
  - `[low]` `[reject]` Blind: unpriced Positions excluded without a hint — spec decision; the resolver falls back to Transaction prices, so a Position without any price practically does not occur.
  - `[medium]` `[patch]` Blind: Depots card in the 1.5fr column clips its 5-column table at 900–~1150 px (240 px drawer) — fixed: `DepotPerformance` switches table/stacked rows at `lg` instead of `md` (row layout per spec kept).
  - `[low]` `[patch]` Blind: composition skeleton always row-direction while the card stacks at xs/md — fixed: skeleton uses the card's responsive direction/alignment.
  - `[low]` `[reject]` Blind: `cashById.get(id) ?? "0"` hides a mismatch — only reachable by archiving a Depot during the same render (same race rejected in 4-4); next render is correct.
  - `[false]` `[reject]` Blind: holdings mapping and color keys live in `labels.ts` — no named harm; the file is the composition presentation helper module like `overview/labels.ts`.
  - `[low]` `[patch]` Blind: `OverviewPage` doc comment outdated — fixed: mentions Zusammensetzung (today snapshot) and the two rows.
  - `[low]` `[patch]` Blind: news test slice unbounded — fixed: ends at the news card's closing `</section>`.
  - `[low]` `[reject]` Blind: no page/DOM test for >8 Securities with "Sonstige" — covered by the core test "keeps the top 8 by value, merges the rest into Sonstige"; the card renders segments generically.
  - `[low]` `[reject]` Blind: negative-cash displayShare sum not asserted — core test "lists negative cash … rounds half-up" pins the exact display values.
  - `[low]` `[patch]` Edge: stale highlight after a server refresh removes the segment dims everything — same root as the negative-row finding; fixed by the effective-highlight derivation.
  - `[low]` `[patch]` Edge: negative cash row highlight dims the donut — same root; fixed.
  - `[low]` `[reject]` Edge: total ≤ 0 with priced Positions shows the empty text — duplicate of the Blind row; rejected there.
  - `[low]` `[reject]` Edge: Depot archived between `listDepots` and `portfolioValuation` gets cash 0 — duplicate of the Blind `?? "0"` row; concurrent archive within one render.
  - `[low]` `[patch]` Verification gap: negative-cash donut geometry (rescale by positive sum) untested — fixed: test asserts both `stroke-dasharray` values and the second `stroke-dashoffset`.
  - `[low]` `[patch]` Verification gap: highlight asserted only via data attributes — fixed: test asserts `stroke-width` 8/6 and `stroke-opacity` 0.35/1 and the reset.
  - `[low]` `[reject]` Verification gap (other): Depot tab stored-price precedence untested — identical `listPositions(..., { storedPrices: latestStoredPrices })` expression as the tested Positions tab; Overview test covers stored prices.
  - `[low]` `[reject]` Intent: legend tap only verified in happy-dom, no browser — no browser runner in the repo; listed as residual risk.
  - `[false]` `[reject]` Intent: colors checked via CSS variable names, not rendered colors — the variable→token mapping is pinned by `src/theme/theme.test.ts`; the card test pins which variable each segment uses.
  - `[low]` `[reject]` Intent: Overview 100 % test recomputes with the same functions — the archived-Depot test ties composition total to the hero value (1.000 € = 100 € + 900 €); core tests pin the arithmetic independently.
  - `[low]` `[reject]` Intent: negative cash departs from a strict "sums to 100 %" — exact shares still sum to 1; only display rounding differs in a state the ledger keeps from occurring.
  - `[false]` `[reject]` Intent: legend shows percentage and amount unlike the mockup — the AC requires both; spines win over mockups.
  - `[low]` `[reject]` Intent: section boundaries in existing Overview tests moved with the layout — necessary for the new mockup order; the order itself is asserted by a dedicated test.
  - `[false]` `[reject]` Intent: process part (operator actions, sprint-status) — no human-only action in this story and `sprint-status.yaml` is untouched; no divergence.

## Design Notes

Snapshot as of today, not Period end: composition is an allocation ("what do I hold"), shown next to Top-Positionen which is already a today snapshot; a custom past Period would otherwise make the two cards disagree. When the Period ends today the total equals the hero "Gesamtwert" (same resolver, same cash).

"Depot" view keeps cash in "Guthaben" because the AC requires cash to be its own segment in every breakdown; Depot segments are therefore Positions value only.

Largest remainder example (units of 0,1 %): shares 1/3 each → 333.33 units → floors 333/333/333 (999) → one unit to the largest remainder; equal remainders → larger amount, then order → first segment: 33,4 / 33,3 / 33,3.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: Overview shows Top-Positionen | Zusammensetzung and Depots | Nachrichten on desktop, stacked on 375 px without horizontal scroll; legend tap highlights; Depot tab "Zusammensetzung" works.

## Auto Run Result

Status: done

**Summary:** Story 4.5 adds "Zusammensetzung". Pure `src/core/composition.ts` turns valued holdings plus cash into ordered segments (items by amount, "Sonstige", then "Guthaben" last) with exact shares summing to 1 and display shares rounded to 0,1 % by largest remainder so they sum to 100,0 % (half-up with negative cash). Views: by Position (merged across Depots, top 8 + Sonstige), by asset type (incl. Unklassifiziert), by Depot (Overview only; cash stays in Guthaben). A client `CompositionCard` draws an SVG donut (series colors, cash color), a legend of ≥ 44 px toggle rows (percentage + amount, tap highlights the segment) and the "Aufteilung" toggle (default Typ); the donut has a text alternative. Placed on the Overview (row 1 Top-Positionen | Zusammensetzung, row 2 Depots | Nachrichten, skeleton updated) and as Depot detail tab "Zusammensetzung" (Position, Typ). Composition is a today snapshot (Positions-tab values + cash), independent of the Period.

**Files changed:**
- `src/core/composition.ts` (+ test) — segment builders.
- `src/core/format.ts` (+ test) — `formatShare`.
- `src/app/_components/composition/CompositionCard.tsx` (+ DOM test), `labels.ts` (+ test) — card, labels, holdings mapping, colors, text alternative.
- `src/app/(app)/(overview)/page.tsx` (+ test) — composition card, two-row layout.
- `src/app/(app)/depots/[id]/page.tsx` (+ test), `src/app/_components/depots/depot-tabs.ts` — composition tab.
- `src/app/_components/overview/OverviewSkeleton.tsx` — skeleton rows.
- `src/app/_components/overview/DepotPerformance.tsx` — table/stacked breakpoint `md` → `lg` (review patch).

**Review findings:** 27 — patched 9 rows in 7 fixes (medium 1: Depots table clipped in the narrower column; low: highlight reconciliation ×3 rows, skeleton direction, doc comment, news test bound, negative-cash geometry test, highlight styling test). Deferred: none. Rejected: 18 (4 false; low: color cycling, negative-cash display, empty text at total ≤ 0 ×2, unpriced Positions hint, cash fallback race ×2, Sonstige page test, negative display sum test, Depot tab stored prices, browser-only checks, recomputing test, strict 100 % reading, moved test boundaries) — reasons in the Review Triage Log.

**Follow-up review recommendation:** false — first pass patched high 0, medium 1, low 8 (fewer than two medium, no high).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (129 files, 1787 tests) after patches. Matrix audit: every I/O row covered by passing tests (core `composition.test.ts` for Thirds/Top 8/Merge/By type/By Depot/Negative cash/Nothing; `labels.test.ts` "leaves out those without a value" for No price).

**Residual risks:** Not inspected in a real browser (donut rendering, legend tap, 375 px overflow, narrow 1fr composition column at md). Position view repeats series colors beyond five segments by design.
