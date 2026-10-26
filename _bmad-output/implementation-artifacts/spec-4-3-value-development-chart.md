---
title: 'Value development chart (story 4-3)'
type: 'feature'
created: '2026-10-26'
status: done
baseline_revision: '571b97e6ce2ea60824fdf008c303c5811a8987a9'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Depot hero card shows value, gain/loss pill, XIRR and breakdown for the Period, but no chart of value and invested capital over that Period (FR11, UX-DR7), so trends are invisible.

**Approach:** Choose `@mui/x-charts` (MIT, MUI-native, built-in keyboard navigation with axis tooltip) and wrap it in one client component `ValueChart` under `src/app/_components/charts/`. The Depot page passes the existing `depotValuation(...).series` (decimal strings, one point per day `from..to`) to `ValueSummary`, which renders `ValueChart` inside the hero card below the pill/XIRR line; numbers are created only inside the wrapper (AD-5).

## Boundaries & Constraints

**Always:**
- Dependency: `@mui/x-charts` pinned exactly to `9.15.0` (≥ 2 weeks old; peers `@mui/material ^9`, React 19 satisfied). No other chart dependency.
- Data: the chart plots exactly the `series` points of the same `depotValuation` call that feeds the KPIs (no second series, no resampling, no smoothing that moves values — use a linear curve). Value = `point.value`, invested = `point.investedCapital`, x = `point.date` (time scale, de-DE ticks `formatDate`-style, e.g. `01.2026`/`25.10.` — compact, no overlap at phone width).
- Presentation edge: the props crossing into the client component are decimal strings (`{ date, value, invested }[]`); `Number(...)` happens only inside the wrapper for plotting coordinates. Tooltip and any displayed amount are formatted from the original strings via `core/format` (`formatMoney`, `formatDate`) looked up by data index — so a tooltip on date `d` shows exactly the text the KPI shows for a Period ending on `d`.
- Look (DESIGN.md `area-chart`): value as 3 px `primary` line with vertical gradient fill `primary` 35 % → 0 %; invested capital dashed `chart.invested` line, no fill; light horizontal grid only (no vertical grid); no point marks; tooltip in a rounded `surface` card. Colors from the MUI theme palette (`primary.main`, `chart.invested`) so dark mode follows; gradient id unique per instance (`useId`).
- Tooltip (axis trigger, crosshair line): content = date (`25.10.2026`), "Wert" amount, "Investiert" amount. Mouse hover, touch tap and keyboard (focus the chart, arrow keys move day by day) all show it. The chart is focusable (`tabIndex 0` or library default) and has an accessible name.
- Text alternative: the chart element has `role="img"`-equivalent accessible name, e.g. `Wertentwicklung 01.01.2026 – 26.10.2026: Wert von 10.000,00 € auf 12.345,67 €, investiertes Kapital von 9.000,00 € auf 9.500,00 €` (first and last point, `formatMoney`/`formatDate`).
- Size: fixed height ≈ 200 px (≈ 160 px on xs), full card width, responsive; no horizontal page scroll at phone width.
- One series point (Period of one day): still renders (single point is fine) without throwing. Archived Depots show the chart too (read-only page, same data).
- Reusable API for 4.4/4.6/4.7: `ValueChart({ points, ariaLabel? })` with no Depot-specific logic; `ValueSummary` gains an optional `series` prop (when absent, no chart — keeps existing callers/tests valid).

**Never:**
- No computation of financial figures in the shell or wrapper beyond `Number()` for coordinates; no change to `src/core` math, no stored results, no Prisma migration.
- No Overview/Portfolio chart (4.4), no Kurs/Wert toggle or trade markers (4.7), no composition (4.5).
- No marking of carried-forward days. No live provider calls in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal Period | 1J series, 366 points | area + dashed line over the Period; accessible name with first/last values | — |
| Tooltip equals KPI | series contains date `d` with value `"12345.675"` | tooltip "Wert 12.345,68 €" — same string as `formatMoney` on the KPI for a Period ending `d` | — |
| Single point | custom Period from = to | renders, no throw | — |
| Keyboard | chart focused, ArrowRight | tooltip appears with date, Wert, Investiert of a data point | — |
| Empty Depot | no Transactions | no `ValueSummary`, no chart (unchanged) | — |

</intent-contract>

## Code Map

- `src/modules/ledger/valuation.ts` -- `depotValuation` → `DepotValuation.series: ValuationPoint[]` (`date`, `value`, `investedCapital`, decimal strings, `from..to`); read-only for this story.
- `src/core/valuation.ts:17-23` -- `ValuationPoint` type.
- `src/app/_components/valuation/ValueSummary.tsx` -- server-rendered hero + KPI row; add optional `series` prop and render `<ValueChart>` inside the hero `CardContent` after the pill/XIRR `Stack`, before `Breakdown`. Existing test `ValueSummary.test.ts`.
- `src/app/(app)/depots/[id]/page.tsx:~150` -- `ValueSummary` call; add `series={valuation.series}`; `page.test.tsx` renders the page via `test/helpers/render-text` (`renderText`/`renderHtml` = `renderToStaticMarkup`), so `ValueChart` must server-render without throwing (if x-charts cannot SSR, render a same-size placeholder box on the server and mount the chart after hydration — keep the accessible name in the SSR markup either way).
- `src/core/format.ts` -- `formatMoney`, `formatDate`; reuse for tooltip, ticks, aria label.
- `src/theme/theme.ts:107` -- `palette.chart.invested` (+ `ChartColors` type); `primary.main`.
- `src/app/_components/period/PeriodSelector.dom.test.tsx` -- DOM test pattern (`// @vitest-environment happy-dom`, `registerDomCleanup`, Testing Library, `userEvent`).
- `test/helpers/dom.tsx`, `test/helpers/providers.ts` -- DOM test helpers (theme provider if needed).
- Mockup `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/mockups/overview-desktop.html:57-64` -- chart placement/height inside the hero card.

## Tasks & Acceptance

**Execution:**
- `package.json` / `package-lock.json` -- `npm install --save-exact @mui/x-charts@9.15.0` -- chart library chosen in this story.
- `src/app/_components/charts/value-chart.ts` (+ `value-chart.test.ts`) -- pure helpers: `chartAriaLabel(points)`, `tooltipLines(point)` → `{ date, value, invested }` display strings via `core/format`, `toPlotData(points)` → `{ dates: Date[], values: number[], invested: number[] }` -- one place for the presentation-edge conversion; unit-test formatting equals `formatMoney`/`formatDate`, single point, label text.
- `src/app/_components/charts/ValueChart.tsx` (+ `ValueChart.dom.test.tsx`) -- `"use client"` wrapper around x-charts `LineChart` (area value series with gradient, dashed invested series, horizontal grid, axis tooltip with custom content from `tooltipLines`, keyboard navigation) -- the one reusable chart component; DOM test (happy-dom, explicit width/height) asserts accessible name, focusability, and that keyboard navigation (focus + ArrowRight) shows a tooltip with date, "Wert" and "Investiert" texts matching the series strings.
- `src/app/_components/valuation/ValueSummary.tsx` (+ test) -- optional `series` prop, chart inside hero card -- UX-DR7 placement.
- `src/app/(app)/depots/[id]/page.tsx` (+ `page.test.tsx`) -- pass `series`; page test asserts the chart's accessible name appears in the hero with the first/last series values and that its last value text equals the "Gesamtwert" text; archived Depot also shows it.
- `src/modules/ledger/valuation.test.ts` -- add a consistency test: for a Depot with prices on several dates, the `series` point on date `d` of a 1J Period equals (`value`, `investedCapital`) of the last point of a custom Period ending on `d` -- "chart value on any date = KPI for that date".

**Acceptance Criteria:**
- Given a Depot with history and a stored Period, when its detail page renders, then the hero card contains the value chart whose accessible name states the Period and the first/last value and invested capital, and the last value equals the "Gesamtwert".
- Given the chart is focused by keyboard, when the user presses an arrow key, then a tooltip shows the date, "Wert" and "Investiert" of a series point, formatted exactly like the KPI figures.
- Given any date `d` inside the Period, when the chart point for `d` is compared with the KPI figures of a Period ending on `d`, then value and invested capital are identical.
- Given `npm ls @mui/x-charts`, then exactly `9.15.0` is installed and `ValueChart` is the only module importing `@mui/x-charts`.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 26 findings — high 0, medium 1, low 19, false 6, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: axis `valueFormatter` ignores its context — verified in `@mui/x-charts/LineChart/seriesConfig/descriptionGetter.js`: the keyboard/screen-reader description calls the x formatter with `location: 'tooltip'` (gave `25.10.` without year) and the series formatter (gave raw floats, not `formatMoney`). Fixed: `chartFormatters(points)` — ticks compact, everything else `formatDate` / `formatMoney` from the decimal strings by index; unit-tested.
  - `[low]` `[patch]` Blind: long Periods mix `01.2026` and `15.01.` ticks (d3 picks weekly ticks for e.g. YTD in March) — fixed with `tickDates`: spans > 62 days tick only month starts, thinned to ≤ 6; unit-tested (70 days, 3 years).
  - `[low]` `[patch]` Blind: no test enforces "ValueChart is the only `@mui/x-charts` importer" — added `test/architecture/chart-imports.test.ts`.
  - `[low]` `[reject]` Blind: mouse/touch tooltip untested — same tooltip slot as the tested keyboard path with axis trigger for all pointers; a pointer test needs faked SVG geometry in happy-dom; manual check listed in Verification.
  - `[low]` `[patch]` Blind: colors/look untested (grey fallback claimed dead) — fallback is reachable (bare render without the app theme, e.g. `ValueSummary.test.ts`), so that part is false; the untested look is real: structural SVG assertions added (gradient, value area with `url(#id)`, dashed invested line, no vertical grid, no marks).
  - `[low]` `[reject]` Blind: `role="figure"` lets screen readers read tick texts — the figure carries the accessible name and keeps the library's focusable element reachable (`img` would hide it); extra tick texts are harmless; fix adds aria plumbing into library internals.
  - `[low]` `[patch]` Blind: consistency test only compares Periods with the chart's `from` — added comparisons against MAX and one-day Periods (`from = to = d`).
  - `[false]` `[reject]` Blind: empty `series` untested — both guards return nothing for an empty array; no bad outcome nameable.
  - `[low]` `[reject]` Blind: `gesamtwert!` gives an unclear failure message; archived regex accepts any end date — test still fails loudly on a mismatch; the archived Period ends on the unpinned "today"; test-only cosmetics.
  - `[false]` `[reject]` Blind: `useMemo` ineffective / ordering unchecked — `ValueSummary` is a server component; the client receives a stable deserialized `points` prop, so the memo holds across client re-renders; series come ordered and unique from `valuationSeries` by construction.
  - `[low]` `[patch]` Edge: 1–3-day Periods get sub-day utc ticks with repeated labels — `tickDates` uses the plotted dates for spans ≤ 62 days; unit-tested (1 point, 3 days).
  - `[low]` `[patch]` Edge: single point has a zero-width domain with stray tick — same root as the row above; fixed by the same `tickDates`.
  - `[low]` `[patch]` Edge: weekly tick on the 1st mixes formats — same root as the Blind mixed-format row; fixed.
  - `[low]` `[reject]` Edge: ≤ 62-day Period crossing New Year shows ticks without year — Period header and tooltip carry the full date; adding a year branch is complexity for a cosmetic case.
  - `[low]` `[reject]` Edge: valuation test reads `point.value` without `toBeDefined` — fails loudly with a TypeError; test-only.
  - `[low]` `[reject]` Edge: `gesamtwert` undefined gives a misleading message — same as the Blind test-message row; test-only.
  - `[low]` `[patch]` Verification gap: chart look not pinned by any test — same root as the Blind look row; structural assertions added.
  - `[low]` `[patch]` Verification gap: x-charts import rule only checked by grep — same root as the Blind import row; architecture test added.
  - `[low]` `[patch]` Intent: chart look not exercised by tests — same root as the Blind look row; fixed.
  - `[low]` `[reject]` Intent: mouse/touch only manual — same as the Blind mouse/touch row.
  - `[false]` `[reject]` Intent: keyboard only tested in happy-dom — the test drives the real library code; no defect claimed.
  - `[low]` `[reject]` Intent: "chart = KPI on any date" split across ledger test and formatting tests — both links are proven (series identity per date; tooltip text from the same strings via `formatMoney`), the page test ties the last value to "Gesamtwert"; no bad outcome nameable beyond test structure.
  - `[false]` `[reject]` Intent: page test passes without server-side SVG — the server deliberately renders a sized box (chart draws after measuring); the SVG is asserted in the DOM test.
  - `[false]` `[reject]` Intent: reuse by Overview/Position pages not shown — those pages do not exist yet (4.4/4.6); the API has no Depot-specific logic.
  - `[low]` `[patch]` Intent: AD-5 single-importer rule not enforced — same root as the Blind import row; fixed.
  - `[false]` `[reject]` Intent: operator branch not triggered — no AC needs a human outside the repo; correct.

## Design Notes

Why `@mui/x-charts`: same vendor/theme system as MUI 9 (palette, dark mode, sx), MIT community tier covers line/area, ships keyboard navigation with axis tooltip (WCAG requirement) — avoids hand-rolling focus management. Recharts/visx would need a second styling system and own keyboard handling.

Exact tooltip text: x-charts hands formatters a JS `number`; formatting that number could differ from the KPI in the last cent (`12345.675` as float). Formatting from the original decimal string by `dataIndex` keeps tooltip and KPI byte-identical.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.
- `grep -rl "@mui/x-charts" src` -- expected: only `src/app/_components/charts/ValueChart.tsx`.

**Manual checks (if no CLI):**
- `npm run dev`, open a Depot with history: area chart with gradient and dashed invested line in the hero card; hover/tab+arrows shows the tooltip; phone width has no horizontal scroll.

## Auto Run Result

Status: done

**Summary:** Story 4.3 adds the value development chart to the Depot hero card. Chart library chosen: `@mui/x-charts` 9.15.0 (pinned), wrapped in one reusable client component `ValueChart({ points, ariaLabel? })`. It plots exactly the `depotValuation` series that feeds the KPIs: value as 3 px primary line with 35 % → 0 % gradient fill, invested capital dashed, horizontal grid only, axis tooltip (mouse, touch, keyboard) with date, "Wert", "Investiert" formatted from the original decimal strings — byte-identical to the KPI texts. Numbers are created only in `toPlotData` (AD-5).

**Files changed:**
- `package.json` / `package-lock.json` — `@mui/x-charts` 9.15.0 exact.
- `src/app/_components/charts/value-chart.ts` (+ test) — presentation-edge helpers: plot data, tooltip lines, aria label, tick dates/labels, x-charts formatters.
- `src/app/_components/charts/ValueChart.tsx` (+ DOM test) — the one chart wrapper; DOM test covers name, focus, keyboard tooltip text, SVG structure, single point.
- `src/app/_components/valuation/ValueSummary.tsx` (+ test) — optional `series` prop; chart between XIRR line and breakdown.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) — passes `series`; label with Period and first/last values, last value = "Gesamtwert", archived Depot too.
- `src/modules/ledger/valuation.test.ts` — chart point on date d equals the KPI end point of Periods ending on d (same start, MAX, one-day).
- `test/architecture/chart-imports.test.ts` — only `ValueChart.tsx` may import `@mui/x-charts`.

**Review findings:** 26 — patched 5 entries (medium 1: screen-reader/tooltip formatters; low 4: tick dates, import architecture test, SVG look assertions, consistency test against other Period starts). Deferred: none. Rejected: 15 rows (mouse/touch untested — library-shared tooltip path, manual check; figure role reading tick texts; test-message cosmetics; New-Year ticks without year; split chart=KPI proof; plus 6 false claims) — reasons in the Review Triage Log.

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 1, low 4 (first pass: no high, fewer than two medium).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (124 files, 1726 tests) after patches; `npm ls @mui/x-charts` → 9.15.0; `grep -rl "@mui/x-charts" src` → only `ValueChart.tsx`.

**Residual risks:** Not inspected in a real browser (gradient, dark mode, phone width, mouse/touch tooltip unverified by eye). Server render shows an empty sized box until the client measures width. Styling depends on x-charts class names / `data-series` attributes (now pinned by the DOM test).
