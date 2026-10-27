---
title: 'Story 7.2: Allocation Analysis'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '7a3f63a23ecbca7c66b9beb509bf4340baef51d3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 7.1 classifies every Security, but nothing shows the Portfolio or a Depot split by those dimensions, so diversification cannot be judged (FR-21, UX-DR8).

**Approach:** A new "Analysen" page (`/analyses`) with a tab "Aufteilung": scope selector (Portfolio or one non-archived Depot) and dimension selector (Anlageklasse, Wertpapiertyp, Sektor, Branche, Region, Land, Unternehmensgröße, Währung), both held in the URL. A pure core function groups today's priced Positions by the dimension's effective classification value, adds cash as its own segment, and lists the Positions per segment; the page draws it with the existing donut/legend pattern plus a Position list for the selected segment.

## Boundaries & Constraints

**Always:**
- Snapshot of today, same inputs as the existing composition: `listPositions(depotId, today, undefined, { storedPrices: latestStoredPrices })` per Depot, Positions with `value === null` left out, cash = each Depot's `cashBalance`. Portfolio = all non-archived Depots (AD-17).
- Classification values read only via `listClassifications()` from `@/modules/classification` (AD-20); `effective value` is used (manual wins). Dimension "Wertpapiertyp" groups by `Classification.type` (ledger `assetType`) labelled via `ASSET_TYPE_LABELS`, with `UNCLASSIFIED` → "Unbekannt".
- A `null` value (or a missing classification) → segment "Unbekannt"; company size "–" → label "Nicht zutreffend". Other values are shown as stored.
- Cash ("Guthaben") is its own segment in every dimension, last; segment shares (exact and display) sum to 100 % of the scope's value incl. cash — reuse `core/composition`'s `finalize` (largest-remainder display shares, negative cash handling).
- Segment order: classified groups by amount desc (ties de-DE label), then "Unbekannt", then "Guthaben". No "Sonstige" merging.
- Each listed Position: logo, name (link to Security detail via `SecurityLink` with its `depotId`), Depot name (Portfolio scope only), value, share of the scope total (exact decimal `value / total`, shown with `formatShare`). Sorted by value desc. Same Security in two Depots = two rows.
- Money as decimal strings via `decimal.js`; `src/core` stays pure; German UI text; touch targets ≥ 44 px; selectors keyboard-operable; donut keeps its `aria-label` text alternative.

**Never:** storing allocation figures; reading the `SecurityClassification` table outside the classification module; provider calls during render; ETF look-through; other analysis tabs (7.3–7.5 add them); changing the existing Overview/Depot composition cards' behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Depot A: SAP (sector Technologie) 600, ETF World (sector null) 300; cash 100; dimension sector | Technologie 600 (60,0 %), Unbekannt 300 (30,0 %), Guthaben 100 (10,0 %) | — |
| Portfolio merge | same sector in Depots A and B | one segment with the summed amount; its list shows both Positions with Depot names | — |
| Manual wins | SAP manual region "Welt", automatic "Europa" | SAP counted under "Welt" | — |
| Type dimension | STOCK, ETF, UNCLASSIFIED holdings | "Aktie", "ETF", "Unbekannt" | — |
| Company size "–" | ETF with companySize "–" | segment "Nicht zutreffend" | — |
| Unpriced Position | value null | not in any segment or list | — |
| Negative cash | cash −50 | Guthaben −50 listed, not drawn (existing donut rule) | — |
| Nothing held | no priced Positions, cash 0 | "Keine Werte vorhanden." | — |
| Bad URL params | `?scope=unknown&dimension=foo` | Portfolio scope, dimension Anlageklasse | — |
| Archived Depot id as scope | `?scope=<archived id>` | falls back to Portfolio | — |
| No Depots | none (or all archived) | message with link to Depots | — |

</intent-contract>

## Code Map

- `src/core/composition.ts` -- `CompositionHolding`, `CompositionSegment`, `finalize`, `ordered`, `group`, `cashDraft` (private): export what the new allocation builder needs, or add the builder here; behavior of the existing builders must not change.
- `src/core/composition.test.ts` -- test style for share sums / display shares.
- `src/app/_components/composition/CompositionCard.tsx` -- private `Donut`/`Legend`, `segmentColor`; export `Donut` and `Legend` (or an equivalent shared piece) for reuse; legend row tap toggles `highlighted`.
- `src/app/_components/composition/labels.ts` -- `compositionHoldings(depot, positions)`, `COMPOSITION_LABELS`, `segmentColorKeys`, `compositionAriaLabel`.
- `src/modules/classification/index.ts` -- `listClassifications()` → `Record<securityId, Classification>`; `Classification[dim].value`, `.type` (`src/core/classification.ts:45-53`, `DIMENSIONS` at :22).
- `src/app/_components/transactions/labels.ts:33` -- `ASSET_TYPE_LABELS`.
- `src/app/_components/navigation.ts` (+ `navigation.test.ts`, `AppShell.dom.test.tsx`, `MoreLinks.tsx`, `src/app/(app)/more/page.test.tsx`) -- add `analyses` item: drawer between Depots and Import, first in `moreItems`; `activeBottomHref("/analyses")` → `/more`.
- `src/app/_components/depots/DepotTabs.tsx`, `depot-tabs.ts` -- URL-driven tab pattern (`?tab=`, `NextLink` tabs, tab/panel ids) to copy for the Analysen tabs.
- `src/app/_components/overview/TopPositions.tsx` -- row pattern: `SecurityLogo`, `SecurityLink`, tabular figures.
- `src/app/(app)/(overview)/page.tsx` -- loading pattern: `listDepots` (filter archived), `businessDate(new Date())`, `listPositions(..., { storedPrices: latestStoredPrices })`, cash from `depot.cashBalance`; its `page.test.tsx` shows the module-mocking test style for server pages.
- `src/app/_components/Placeholder.tsx` -- `PageTitle`.
- `src/core/format.ts:61` -- `formatShare(ratio)`, `formatMoney`.

## Tasks & Acceptance

**Execution:**
- `src/core/allocation.ts` (+ `allocation.test.ts`) -- `allocation(holdings: AllocationHolding[], cash: CompositionCash, labels: { cash; unknown })` where `AllocationHolding = CompositionHolding & { group: string | null }` → `{ segments: CompositionSegment[]; positions: Record<segmentKey, AllocationPosition[]> }` (`AllocationPosition` = securityId, securityName, depotId, depotName, value, share); keys `group:<label>` / `unknown` / `cash`; uses composition's share logic -- one pure decision, tested for every matrix row incl. sum of shares = 1 and display shares = 1.000.
- `src/core/composition.ts` -- export the reused internals (no behavior change; existing tests stay green).
- `src/app/_components/analyses/labels.ts` (+ test) -- `ANALYSIS_TABS` (only `allocation` "Aufteilung"), `ALLOCATION_DIMENSIONS` (key `type | assetClass | sector | industry | region | country | companySize | currency` → German label, order as in the AC), parsers `analysisScope(raw, depotIds)` / `allocationDimension(raw)` with fallbacks, `groupOf(classification | undefined, dimension)` → label or null (type labels, "–" → "Nicht zutreffend"), `ALLOCATION_LABELS` (cash "Guthaben", unknown "Unbekannt").
- `src/app/_components/composition/CompositionCard.tsx` -- export `Donut`/`Legend` (and color helper) unchanged in behavior.
- `src/app/_components/analyses/AllocationView.tsx` (+ dom test) -- client: card with heading "Aufteilung nach {dimension}", donut + legend (tap row selects segment, tap again deselects), below it the selected segment's Position list (logo, linked name, Depot name in Portfolio scope, value, share) or, for "Guthaben", the text "Guthaben der Cash-Konten – keine Positionen."; empty text "Keine Werte vorhanden."; selection resets on scope/dimension change.
- `src/app/_components/analyses/AnalysisFilters.tsx` (+ dom test) -- client: two labelled selects "Bereich" (Portfolio + non-archived Depots) and "Dimension"; changing one navigates (`router.replace`) to `/analyses?tab=allocation&scope=…&dimension=…` keeping the other.
- `src/app/(app)/analyses/page.tsx` (+ `page.test.tsx`) -- server: metadata title "Analysen", `PageTitle`, tab bar (URL-driven, one tab), filters, `AllocationView`; loads depots, Positions, classifications; no-Depot / all-archived message with `AppLink` to `/depots`.
- `src/app/_components/navigation.ts` + tests above -- "Analysen" entry (icon e.g. `DonutSmallOutlined`).

**Acceptance Criteria:**
- Given the app shell on ≥ md, then the drawer lists "Analysen" between "Depots" and "Import"; given a phone, then "Mehr" lists "Analysen" and `/analyses` highlights "Mehr".
- Given `/analyses` with Depots holding priced Positions, when I choose scope and dimension, then the URL holds both and the donut legend shows each segment's label, % and amount with shares summing to 100,0 %.
- Given a legend row is tapped, then the Positions of that segment are listed with logo, name linking to the Security detail (`securityHref(securityId, depotId)`), value and share.
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 27 findings — high 0, medium 0, low 21, false 5, maybe-false 1
- findings:
  - `[low]` `[patch]` Blind: "Aufteilung" tab link drops the dimension — `AnalysisTabs` takes `dimension` and keeps it in the href; page passes it.
  - `[low]` `[reject]` Blind: no `loading.tsx` for `/analyses` — Next keeps the previous page until render finishes; a skeleton is new surface the spec did not ask for.
  - `[low]` `[reject]` Blind: filters have no pending state — fix adds `useTransition` state; single-user SQLite renders fast.
  - `[low]` `[reject]` Blind: negative cash larger than holdings shows "Keine Werte vorhanden." — same rule as the existing composition card (`finalize` returns [] for total ≤ 0); unlikely.
  - `[low]` `[reject]` Blind: a priced Position worth 0 is listed — it is still a held Position of that group; needs a 0 price to occur.
  - `[false]` `[reject]` Blind: Wertpapiertyp ignores the ledger asset type when the classification is missing — `listClassifications` returns an entry for every Security (`src/modules/classification/classification.ts:204`), with `type` from `assetType`.
  - `[low]` `[reject]` Blind: a manual value "Guthaben" or untrimmed variants create confusing/split segments — manual free text is a 7.1 design choice; unlikely for one user; fix adds normalisation.
  - `[low]` `[reject]` Blind: tapping a negative "Guthaben" row does nothing — identical to the existing composition card behaviour.
  - `[low]` `[reject]` Blind: colours repeat after 5 segments — accepted in Design Notes (no "Sonstige"); legend rows disambiguate; a larger palette is a design-token change.
  - `[low]` `[patch]` Blind: default Anlageklasse dimension only tested with all-"Unbekannt" — page-test fixture now has asset classes; default view asserts Aktien/Gemischt/Unbekannt/Guthaben.
  - `[low]` `[reject]` Blind: keyboard/a11y gaps in tests (legend keyboard, share label, heading total) — legend is the existing `ButtonBase` (keyboard-operable); cosmetic.
  - `[low]` `[reject]` Blind: `SHARE_DECIMALS` duplicated, minor test gaps — exporting the constant adds core surface; drift risk negligible.
  - `[low]` `[patch]` Edge: tab link drops dimension — same fix as above.
  - `[low]` `[reject]` Edge: > 5 groups share colours — same as above.
  - `[maybe-false]` `[reject]` Edge: empty/whitespace effective value gives a blank row — would need evidence that a stored value can be ""; 7.1 maps manual "" to automatic; if true only low.
  - `[low]` `[reject]` Edge: group equal to "Guthaben" — same as above.
  - `[false]` `[reject]` Edge: type dimension with missing classification → Unbekannt — same refutation as above.
  - `[low]` `[reject]` Edge: case/space variants split a group — same as above (manual free text).
  - `[low]` `[reject]` Edge: a rejecting `listPositions`/`listClassifications` fails the page — same pattern as Overview and Depot pages; the app error boundary handles it.
  - `[low]` `[patch]` Edge (claim): "URL holds scope and dimension" broken by tab links — same fix as above.
  - `[low]` `[patch]` Verification gap: tab bar not asserted by any test — page test asserts `AnalysisTabs` props, the tab href with scope and dimension, and tab id ↔ panel `aria-labelledby`.
  - `[low]` `[patch]` Verification gap (other): tab link drops dimension — same fix as above.
  - `[low]` `[patch]` Verification gap (other): default-dimension fixture — same fix as above.
  - `[low]` `[reject]` Intent: segments are tapped via legend rows, not donut arcs — UX-DR8 defines the legend row as the tap target ("legend tap highlights segment"); SVG arcs are not keyboard-reachable; adding arc handlers changes the shared `Donut`.
  - `[false]` `[reject]` Intent: cash always its own segment instead of "where meaningful" — satisfies the AC (own segment, shares sum to 100 % of scope value); rationale in Design Notes.
  - `[false]` `[reject]` Intent: breakpoint placement tested only at array level — `AppShell` renders the drawer/bottom nav from these arrays and its DOM test covers both lists.
  - `[false]` `[reject]` Intent: unpriced Positions excluded narrows "100 % of the scope's value" — a Position without a price has no current value; same rule as composition (story 4-5).

## Design Notes

"Cash as its own segment where meaningful": cash is shown as "Guthaben" in every dimension, matching UX-DR8 ("cash always its own segment") and the AC that shares sum to 100 % of the scope's value — splitting cash into "Geldmarkt" or "EUR" would mix it into Security groups and make the Position list incomplete.

No "Sonstige" merging: every group stays tappable with its own Position list; colors cycle through series 1–5 as in the composition card.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Story 7.2 adds the "Analysen" page (`/analyses`) with the tab "Aufteilung". Scope (Portfolio or one non-archived Depot) and dimension (Anlageklasse, Wertpapiertyp, Sektor, Branche, Region, Land, Unternehmensgröße, Währung) live in the URL. The pure `core/allocation` groups today's priced Positions by the effective classification (manual wins, read via `listClassifications`), adds cash as "Guthaben", and lists each segment's Positions; shares reuse composition's exact/largest-remainder logic and sum to 100 %. "Analysen" sits in the drawer between Depots and Import and first under "Mehr".

**Files changed:**
- `src/core/allocation.ts` (+test) -- allocation segments and per-segment Position lists.
- `src/core/composition.ts` -- exports `Draft`, `group`, `ordered`, `finalize`, `cashDraft` (no behaviour change).
- `src/app/_components/composition/CompositionCard.tsx` -- exports `Donut`, `Legend`, `segmentColor`.
- `src/app/_components/analyses/labels.ts` (+test) -- tabs, dimensions, URL parsers, `groupOf`, labels.
- `src/app/_components/analyses/AllocationView.tsx` (+dom test) -- donut, legend, selected segment's Position list.
- `src/app/_components/analyses/AnalysisFilters.tsx` (+dom test) -- "Bereich" and "Dimension" selects.
- `src/app/_components/analyses/AnalysisTabs.tsx` -- URL-driven tab bar keeping scope and dimension.
- `src/app/(app)/analyses/page.tsx` (+test) -- server page.
- `src/app/_components/navigation.ts`, `navigation.test.ts`, `AppShell.dom.test.tsx` -- "Analysen" nav entry.

**Review findings:** 27 findings (high 0, medium 0, low 21, false 5, maybe-false 1).
- **Patched (3 entries, all low):** tab link keeps the dimension; tab bar asserted in the page test; default Anlageklasse view tested with real asset classes.
- **Deferred:** none.
- **Rejected:** loading skeleton, filter pending state, negative cash > holdings, zero-value Positions, label collisions/normalisation of manual text, negative-cash tap, colour cycling > 5 segments, a11y test gaps, duplicated constant, blank values (maybe-false), page error handling, donut-arc tapping (legend is the UX-DR8 target), and the false findings (type fallback ×2, cash "where meaningful", breakpoint tests, unpriced Positions). Reasons in the triage log.

**Follow-up review:** not recommended (`false`); patched: high 0, medium 0, low 3.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` all passed after the patches (194 test files, 2650 tests; build lists `/analyses`). Every I/O matrix row is covered by core, label, DOM or page tests.

**Residual risks:**
- Not checked in a real browser.
- With more than five groups (Land, Branche) segment colours repeat; the legend disambiguates.
- No operator action is required.
