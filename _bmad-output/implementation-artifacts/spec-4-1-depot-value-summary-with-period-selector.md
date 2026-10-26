---
title: 'Depot value summary with Period selector (story 4-1)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: 'fc67f74191670be687739a3558c1fcfd3448bc7b'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Depot detail page shows Positions, Cash Account and Transactions but no summary: no total value, invested capital, dividends or taxes for a chosen Period, and core has no daily valuation series that later stories (4.2 returns, 4.3 chart, 4.4 Overview, 4.6 Security page) can read.

**Approach:** Add pure core functions for Period resolution and one daily valuation series per Depot (value = Σ Position values via the price resolver + cash via `core/cash`, invested capital = FIFO Cost Basis of open Positions), a ledger read service that loads a Depot's inputs and calls them, and on the Depot detail page a hero card ("Gesamtwert") plus a KPI row (Investiertes Kapital, Dividenden, Guthaben, Steuern gezahlt) driven by a global Period selector persisted in a cookie.

## Boundaries & Constraints

**Always:**
- Every figure on the page comes from the one series / core functions; shell only loads and renders (AD-1, AD-10). Decimal strings + `decimal.js` in core; no rounding of intermediates; formatting only via `core/format` (AD-5).
- Series points: one per calendar day `from..to` inclusive, each `{date, value, positionsValue, cash, investedCapital}`; Position quantities and prices as of that day follow corporate actions dated on or before it (same semantics as `computePositions(rows, observations, day, actions)`), prices from `resolvePrice` (manual > provider > Transaction of any Depot, carried forward). An open Position without any resolvable price contributes `0`.
- Period: presets `1M`, `YTD`, `1J`, `3J`, `MAX`, plus custom `from..to`. `to` = today for presets; `1M`/`1J`/`3J` = `to` minus 1 month / 1 year / 3 years (day clamped to month end); `YTD` = Jan 1 of `to`'s year; `MAX` = the Depot's first ledger date (today when none). Custom: both business dates, `from ≤ to ≤ today`. Default and fallback for missing/invalid stored value: `1J`.
- Period figures cover rows dated `from..to` inclusive: dividends = Σ `amount` of DIVIDEND rows (gross); taxes paid = Σ signed `tax` of all rows (paid minus refunds). Hero value, invested capital and cash are those of the series point at `to`.
- Period choice stored in one cookie (path `/`, `SameSite=Lax`, ~1 year) via an authenticated server action; serialized as `1M|YTD|1J|3J|MAX` or `custom:YYYY-MM-DD:YYYY-MM-DD`; parsing/validation is a pure core function. The cookie is global so Overview (4.4) and Security detail (4.6) reuse it.
- UI German, de-DE formats; touch targets ≥ 44 px; no horizontal scroll at phone width.

**Never:**
- No stored valuation or snapshot table, no Prisma migration. No TTWROR/XIRR/Gain-Loss pill (4.2), no chart (4.3), no Overview changes (4.4), no composition (4.5).
- `src/core` imports nothing but its own files and `decimal.js`; no `Date.now()` in core. Ledger module never imports `prices` (inject a loader as `listPositions` does). No live provider calls in tests.
- Archived Depots: no write action; the summary still renders read-only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Carried-forward price | BUY 10 @ 100 on D1, provider price 110 on D3, none on D4 | D4 value = 10 × 110 + cash(D4) | — |
| Split mid-Period | BUY 10 @ 100, split 1:2 on D2, provider 55 on D3 | D1 value 1000 + cash; D3 value = 20 × 55 + cash | — |
| Day before first row | Period starts before Depot's first Transaction | points value 0, cash 0, invested 0 | — |
| Fully sold | all units sold before `to` | invested 0, value = cash | — |
| Tax refund | TAX row tax −20 and DIVIDEND tax 15 in Period | taxes paid = −5 | — |
| Invalid cookie | `custom:2026-13-01:x`, `to` > today or `from > to` | treated as default `1J` | parse returns `null` |
| Custom saved | user picks Von 01.01.2026 Bis 30.06.2026 | cookie `custom:2026-01-01:2026-06-30`, page refreshes with figures at 2026-06-30 | invalid dialog input blocked with message, nothing saved |
| Empty Depot | no Transactions | existing empty state only, no hero/KPIs | — |

</intent-contract>

## Code Map

- `src/core/positions.ts` -- `computePositions(rows, observations, today, actions)`: per-day reference semantics (adjusts observations via `adjustedPrice` as of `today`, FIFO via `fifo`); the test oracle for the series.
- `src/core/prices.ts` -- `resolvePrice`, `PriceObservation`; O(n) per call — the series must not call it per day over all observations (see Design Notes).
- `src/core/corporate-actions.ts` -- `adjustedPrice`, `replayEvents`, `actionEvents`, `CorporateActions`, `NO_CORPORATE_ACTIONS`.
- `src/core/fifo.ts` -- `fifo(rows, asOf, actions)` lots → invested capital (Σ lot `costBasis`).
- `src/core/cash.ts` -- `cashBalance(rows, asOf)`, `cashEffect`; `CashRow` shape (signed `tax`).
- `src/core/dates.ts` -- `addDays`, `isBusinessDate`; add a month-arithmetic helper here.
- `src/modules/ledger/positions.ts` -- `listPositions`: template for loading rows, ISIN lineage, Transaction price observations (all Depots), injected `StoredPriceLoader`.
- `src/modules/prices/prices.ts:311` -- `latestStoredPrices` (latest only); add a history loader returning every stored Price `≤ asOf` for given Securities as `PriceObservation`s (same mapping of source/provider).
- `src/modules/ledger/index.ts`, `src/modules/prices/index.ts` -- public entry points to extend.
- `src/app/(app)/depots/[id]/page.tsx` -- Depot detail page; add header selector, hero, KPI row above the tabs. Existing tests in `page.test.tsx` (real migrated SQLite via `test/helpers/migrated-db-file`).
- `src/app/_actions/news.ts` -- server-action pattern (`getSession` guard, `UNAUTHORIZED` result).
- `src/app/login/actions.ts:54`, `src/modules/auth/index.ts:26` -- cookie read/write pattern via `next/headers`.
- `src/theme/theme.ts` -- palette `primary`, `accent`, `cash`, `chart.series4`; typography `figureHero`, `figureKpi`.
- `src/core/format.ts` -- `formatMoney`, `formatDate`.
- Mockup `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/mockups/overview-desktop.html` lines 51–70 -- pill group, hero, KPI labels/subtexts.

## Tasks & Acceptance

**Execution:**
- `src/core/dates.ts` -- add `addMonths(date, months)` (day clamped to month end) -- Period presets.
- `src/core/period.ts` (+ test) -- `PeriodSelection`, `DEFAULT_PERIOD` (`1J`), `parsePeriod(text, today)`, `serializePeriod`, `resolvePeriod(selection, today, firstDate)` → `{from, to}`, `periodLabel` (preset label or `01.01.2026 – 30.06.2026`) -- pure Period rules.
- `src/core/valuation.ts` (+ test) -- `ValuationRow` (FifoRow & CashRow), `valuationSeries(rows, observations, actions, from, to)`, `investedCapital(rows, asOf, actions)` (the single invested-capital function), `periodFlows(rows, from, to)` → `{dividends, taxesPaid}` -- AD-10 series.
- `src/modules/prices/prices.ts`, `index.ts` (+ test) -- `storedPriceHistory(securityIds, asOf)` loader -- full history for carry-forward.
- `src/modules/ledger/valuation.ts`, `index.ts` (+ test) -- `depotValuation(depotId, selection, today, db, { storedPrices })` → `{ from, to, series, dividends, taxesPaid }`; loads all the Depot's rows, corporate actions, Transaction price observations of the ISIN lineage, injected stored prices; first ledger date for `MAX` -- read-only shell.
- `src/app/_actions/period.ts` (+ test) -- `setPeriodAction(text)`: session guard, `parsePeriod`, set cookie, `{ok}`; `readPeriod()` helper for server components (invalid → default) -- persistence.
- `src/app/_components/period/PeriodSelector.tsx` (+ dom test) -- client pill group (`ToggleButtonGroup`, `aria-label="Zeitraum"`) 1M · YTD · 1J · 3J · Max · Benutzerdefiniert; custom opens a Dialog with "Von"/"Bis" date fields, validation message, "Übernehmen"; calls the action then `router.refresh()` -- UX-DR4.
- `src/app/_components/valuation/ValueSummary.tsx` -- hero card ("Gesamtwert", `figureHero`, "Stand {date}" when `to` ≠ today) and KPI row: Investiertes Kapital (primary, "Cost Basis offener Positionen"), "Dividenden · {label}" (accent), Guthaben (cash), "Steuern gezahlt · {label}" (series-4, "separat ausgewiesen"); 4 px colored top border; `xs` 2×2 grid, `md` one row -- UX-DR5/6.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- header row with title and selector; render `ValueSummary` above tabs when the Depot has Transactions (also archived) -- AC surface.

**Acceptance Criteria:**
- Given a Depot with Transactions and Prices, when its detail page renders, then the hero shows "Gesamtwert" = Positions value + cash at Period end and the KPI row shows invested capital, dividends (Period), cash and taxes paid (Period), with the Period's label in the dividend/tax captions.
- Given a stored Period cookie, when the Depot page renders, then the selector marks that Period and all figures reflect it; given a pill click, the cookie is updated and the page refreshes.
- Given an archived Depot with history, when its page renders, then the summary appears and no write action exists.
- Given core tests on sample days (incl. carried-forward Prices, a split, an ISIN change, a SELL), then each series point's `value` equals Σ `computePositions(rows, obs, day, actions)` values + `cashBalance(rows, day)` and `investedCapital` equals Σ their Cost Basis.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 28 findings — high 0, medium 5, low 11, false 12, maybe-false 0
- findings:
  - `[false]` `[reject]` Blind: "summary above tabs" check matches the KPI caption "offener Positionen" — if the tabs moved above the summary, the first "Positionen" would be the tab and the assertion would fail; the check works.
  - `[low]` `[patch]` Blind: archived-header regex `(?:.* )?` too loose — now matches the exact selector labels.
  - `[medium]` `[patch]` Blind: pending cleared before un-awaited `router.refresh()` lands (pill flicker, second save) — refresh now runs in `useTransition`, pending cleared inside it; selector locked until the refreshed render.
  - `[low]` `[patch]` Blind: Abbrechen/backdrop close active during a custom save — disabled/ignored while busy; test added.
  - `[low]` `[reject]` Blind: negative "Steuern gezahlt" (net refund) has no special label — spec defines taxes paid as paid minus refunds; a refund-only Period is rare and relabelling adds branching.
  - `[low]` `[reject]` Blind: full stored-price history loaded on every render — single-user SQLite, tens of thousands of rows at most; a bounded loader adds surface for no observed slowness.
  - `[false]` `[reject]` Blind: `investedCapital` duplicates the series' invested capital — both go through the same `openHoldings`/`totalCost` helpers in `core/valuation.ts`; one implementation.
  - `[low]` `[reject]` Blind: optional `storedPrices` lets callers drift — mirrors the established `listPositions` injection convention; no caller omits it on a page.
  - `[medium]` `[patch]` Blind: PeriodSelector failure paths untested — grouped with verification-gap finding 2; tests added.
  - `[low]` `[patch]` Blind: wall-clock perf bound flaky — bound raised to 10000 ms (still catches per-day full resolve).
  - `[false]` `[reject]` Blind: error Snackbar never auto-hides — matches project convention (`PriceRefreshButton` keeps errors open, `autoHideDuration` null).
  - `[false]` `[reject]` Blind: `period-cookie.ts` is not a server action but lives in `_actions/` — `_actions/` already holds non-action helpers (`new-security-input.ts`); keeping `readPeriod` out of the `"use server"` file avoids exposing it as an action.
  - `[false]` `[reject]` Blind: long custom-range captions overflow on phones — captions contain spaces and wrap normally (no `noWrap`); figures have `overflowWrap: anywhere`.
  - `[medium]` `[patch]` Edge: pill jumps back before refresh — same root cause as Blind pending finding; fixed there.
  - `[low]` `[patch]` Edge: dialog cancellable mid-save — same root as Blind Abbrechen finding; fixed there.
  - `[low]` `[reject]` Edge: client `today` stale past midnight blocks a valid range — needs the page open across midnight; server re-validates; reload fixes it.
  - `[low]` `[reject]` Edge: MAX with a mistyped year like 0026 loops for ~730k days — requires a malformed but valid-looking ledger date the date input practically never produces; guard adds complexity.
  - `[false]` `[reject]` Edge: `addMonths` year < 0 malformed string — unreachable from 4-digit business dates within the presets' ≤ 36-month offsets except the case above.
  - `[false]` `[reject]` Edge: PageTitle replacement — reviewer itself found no regression; Stack supplies the margin.
  - `[medium]` `[patch]` Verification gap: 1J page test depends on the real clock (fails from 2027-03-02) — clock pinned to 2026-10-26 with fake Date timers.
  - `[medium]` `[patch]` Verification gap: no test for a failed dialog save or rejected preset save — two tests added (dialog stays open with message, no refresh; preset shows "Verbindung fehlgeschlagen").
  - `[low]` `[patch]` Verification gap (other): perf test wall-clock bound — same as Blind perf finding; fixed there.
  - `[false]` `[reject]` Intent: selector not on Overview / Security page — the choice is stored globally (cookie path `/`) and persists across sessions; Overview has no Period-dependent figure yet (4.4) and the Security page does not exist (4.6).
  - `[false]` `[reject]` Intent: archived "last values" readings — archiving requires a flat Depot (`core/archive.isFlat`), so value, cash and invested capital at the Period end equal the values at the last activity under either reading.
  - `[low]` `[reject]` Intent: dividends/taxes from `periodFlows`, not from the series — they are flows over the same rows and window as the series; no divergence nameable; 4.2 adds per-day flows.
  - `[false]` `[reject]` Intent: hero lacks pill/XIRR/chart — those are stories 4.2/4.3 per the story's own ACs.
  - `[false]` `[reject]` Intent: colored borders / 2×2 grid only styled, not asserted — present in `ValueSummary.tsx` sx; render-to-text tests cannot observe layout; no defect.
  - `[false]` `[reject]` Intent: no end-to-end click→cookie→render test — action, cookie read and page are each tested; observation, not a defect.

### 2026-10-26 — Review pass (follow-up)
- verdicts: 23 findings — high 0, medium 2, low 12, false 9, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: custom Period has no lower bound (Von 0026-01-01) and is not clamped to the first ledger date — measured: a series from 0001-01-01 to 2026-10-26 (740k points) takes ~0.4 s, and only the point at `to` reaches the page; clamping would contradict the matrix row "Day before first row → 0"; a deliberately ancient date is rare and a bound adds a guard.
  - `[false]` `[reject]` Blind: no opening value for 4.2; `series[0]` and `periodFlows` overlap on `from` — no consumer exists in this story; the point semantics (end of day) and the flow window are fixed by the spec; 4.2 defines its start value.
  - `[low]` `[reject]` Blind: hero/Guthaben at `to` while the Positionen/Cash-Konto tabs show today — figures at `to` are what the spec requires, and the hero shows "Stand {date}" when `to` ≠ today; relabelling the tabs adds UI for a custom-Period-only case.
  - `[low]` `[reject]` Blind: no page test asserting Gesamtwert = Σ Positions table + cash — the core oracle pins series = `computePositions` + `cashBalance` on every day, and `storedPriceHistory` has its own mapping tests; the residual drift is loader-level and not met in everyday use.
  - `[low]` `[reject]` Blind: `depotValuation` awaited after the `Promise.all` and reloads rows — local SQLite, a few ms per render; restructuring the page's loading adds surface for no observed delay.
  - `[low]` `[reject]` Blind: `PriceCursor` rebuilds on corporate-action dates of all Securities and rescans `actionDates` per call — rebuilds happen only on action dates inside the Period; a single user's corporate actions number in the tens; the 3-year perf test passes.
  - `[low]` `[reject]` Blind: `storedPriceHistory` has no lower date bound — carried: same claim as the first pass's "full stored-price history loaded on every render", rejected low.
  - `[low]` `[reject]` Blind: keyboard focus lost because the busy group is `disabled` — real in browsers, but needs keyboard-only use of a single-user app; the fix (aria-disabled plus click guards or focus restore) is more than a direct correction.
  - `[false]` `[reject]` Blind: the saved custom range is visible only in the pill's `title` — the range is shown in the KPI captions "Dividenden · 01.01.2026 – 30.06.2026" and "Steuern gezahlt · …" (`ValueSummary.tsx:72,74`), plus "Stand" on the hero.
  - `[low]` `[patch]` Blind: `eventDate` duplicated in `core/valuation.ts` and `core/corporate-actions.ts` — exported the `corporate-actions` helper and removed the copy in `valuation.ts`.
  - `[medium]` `[patch]` Blind: the price cursor is never tested starting after a corporate action (the usual 1M/YTD case on a Depot with an older split) — added oracle runs of the full fixture from 2026-01-13 (after the split) and 2026-01-21 (after the ISIN change); both match `computePositions` daily and equal the long series' points.
  - `[low]` `[reject]` Blind: backdrop click during a save untested — backdrop and Escape go through the same `onClose` guard, which the Escape case covers; a regression that splits them is unlikely.
  - `[low]` `[reject]` Edge: custom Von 0001-01-01 loops ~740k days — same root as the Blind lower-bound finding; measured ~0.4 s.
  - `[low]` `[reject]` Edge: client `today` stale past midnight refuses the real date as Bis — carried: same claim as the first pass's Edge finding, rejected low.
  - `[medium]` `[patch]` Verification gap: pill lock while a preset save is pending not tested — added "keeps the clicked preset selected and locks the pills while its save is running" (never-resolving action: 1M pressed, YTD disabled, a second click sends no second save).
  - `[low]` `[reject]` Verification gap (other): `reason: "invalid"` branch ("Zeitraum ungültig.") untested — reachable only when the server refuses a range the client accepted (midnight edge); unlikely to be met.
  - `[false]` `[reject]` Intent: series uses its own `PriceCursor`, not `resolvePrice` — the spec's Design Notes prescribe the cursor; the oracle test checks equality with `computePositions` (which calls `resolvePrice`) on every day, including two sources on one day and another Depot's Transaction price.
  - `[false]` `[reject]` Intent: `valuationSeries` does not call `investedCapital` — carried: same claim as the first pass's Blind finding; both use the shared `openHoldings`/`totalCost` helpers.
  - `[false]` `[reject]` Intent: the selector stays active on archived Depots — the action writes only a global viewer-preference cookie, no Depot or ledger data; "no write action" concerns the Depot.
  - `[false]` `[reject]` Intent: the empty Depot hides the selector as well — matches "existing empty state only".
  - `[false]` `[reject]` Intent: MAX when the only row is future-dated gives today..today — `to` is today for presets and nothing before today exists, so the single all-zero point is the correct answer.
  - `[false]` `[reject]` Intent: carry-forward/split/refund matrix rows proven at core/ledger level, not on the page — the page renders `series.at(-1)` and `periodFlows` unchanged; the click→cookie→render chain is the first pass's carried "no end-to-end test" row.
  - `[false]` `[reject]` Intent: touch targets and no horizontal scroll not asserted — present in `sx` (`minHeight`/`minWidth` 44, `flexWrap`, `maxWidth: 100%`, 2×2 grid); render-to-text tests cannot observe layout; no defect.

## Design Notes

Holdings and Cost Basis change only on event dates (Transactions, corporate actions). Build the series by walking days: recompute FIFO holdings (`fifo(rows, day, actions)`) only when an event falls on the day (plus at `from`), and resolve each held Security's price per day with per-Security observation lists sorted by `(date, source rank, sequence, id)` and a moving cursor; adjust only the chosen observation with `adjustedPrice(…, asOf = day)`. Observations of Securities whose lots an ISIN change carried into the held Security count for it (as `computePositions` does). Cash: running balance advanced by `cashEffect` of rows per day. A 3-year series must render without noticeable delay; correctness is pinned by the oracle test against `computePositions`.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Depot detail page has a global Period selector (1M · YTD · 1J · 3J · Max · Benutzerdefiniert, cookie `dm_period`, default 1J) in the header and a hero card ("Gesamtwert") plus KPI row (Investiertes Kapital, Dividenden, Guthaben, Steuern gezahlt) fed by a pure daily valuation series per Depot (`core/valuation`). This follow-up review pass added two tests and removed one duplicated helper.

**Files changed (story):**
- `src/core/dates.ts` — `addMonths` (day clamped).
- `src/core/period.ts` — Period parse/serialize/resolve/label.
- `src/core/valuation.ts` — `valuationSeries`, `investedCapital`, `periodFlows`.
- `src/core/fifo.ts`, `src/core/prices.ts`, `src/core/corporate-actions.ts` — export `applyTrade`, `compareObservations`, `eventDate` for reuse.
- `src/modules/prices/prices.ts`, `index.ts` — `storedPriceHistory` loader.
- `src/modules/ledger/positions.ts` — extracted `securityLineage`/`lineageObservations` (behaviour unchanged).
- `src/modules/ledger/valuation.ts`, `index.ts` — `depotValuation` read service.
- `src/app/_actions/period.ts`, `period-cookie.ts` — authenticated cookie write; `readPeriod` for server components.
- `src/app/_components/period/PeriodSelector.tsx` — pill group + custom range dialog.
- `src/app/_components/valuation/ValueSummary.tsx` — hero + KPI cards.
- `src/app/(app)/depots/[id]/page.tsx` — header selector and summary above tabs (also archived Depots).
- Tests for each of the above.

**Follow-up pass changes:**
- `src/core/corporate-actions.ts`, `src/core/valuation.ts` — one exported `eventDate`, duplicate removed.
- `src/core/valuation.test.ts` — oracle runs starting after the split and after the ISIN change.
- `src/app/_components/period/PeriodSelector.dom.test.tsx` — pill-lock test during a pending preset save.

**Review findings (follow-up pass):** 23 findings — high 0, medium 2, low 12, false 9. Patched: 3 entries (medium 2: cursor-after-action oracle test, pill-lock test; low 1: `eventDate` duplicate). Deferred: none. Rejected: 11 low (lower bound on custom Von, Blind and Edge — measured ~0.4 s for 740k days; tabs vs `to` figures — "Stand" shown; summary/table agreement test; sequential valuation load; cursor rebuild cost; stored-price lower bound (carried); focus loss on disabled pills; backdrop-click test; midnight `today` (carried); untested "invalid" branch) and 9 false, each with its reason in the triage log.

**Follow-up review recommended:** false — follow-up pass with no `high` patched (patched: high 0, medium 2, low 1).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — pass after patches (119 files, 1672 tests; build compiled).

**Residual risks:** full stored-price history loaded per render (fine at single-user scale); custom-range dialog validates against the server-rendered `today`; keyboard focus drops to the page while the selector is busy; selector appears on Overview/Security detail only in stories 4.4/4.6.
