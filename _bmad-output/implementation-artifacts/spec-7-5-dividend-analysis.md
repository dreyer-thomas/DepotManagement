---
title: 'Story 7.5: Dividend Analysis'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: 'eaf4a60e6dc0b005e3b5ce1f746fe600c1a32304'
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

**Problem:** The Analysen page has Aufteilung, Rendite and Gewinne, but Tommy cannot follow his passive income: dividends per month/year/Security, the last 12 months' income and yield, and what to expect next (FR-22, CAP-22).

**Approach:** A fourth tab "Dividenden" on `/analyses`: one pure core function turns the scope's ledger (Portfolio or one non-archived Depot) and today's Positions into dividend buckets per month and year (gross and net), a running total per year, totals per Security, trailing-12-month income and yield, and an estimate of the next 12 months' payments. The tab shows a KPI row, a gross/net toggle and the views Monate (selected year), Jahre, Kumuliert, Wertpapiere and Erwartet.

## Boundaries & Constraints

**Always:**
- Inputs per Depot in scope: its ledger rows (the `GainsRow` columns, as `gainsInput` loads them) and today's Positions (`securityId`, `quantity`, `value | null`, from `listPositions` with stored prices as on the Aufteilung tab); plus the corporate actions. Portfolio = non-archived Depots (AD-17). Rows dated after `today` are ignored.
- A payment = a DIVIDEND row with a Security: `gross` = `amount`, `net` = `amount − tax − fee` of that row (refunds, i.e. negative tax, raise net). Standalone TAX/FEE rows are not attributed to dividends.
- Buckets: months from the first ledger month to today's month, years from the first ledger year to today's year (zeros where nothing was paid), each with `gross` and `net`; a year = Σ its months exactly. Cumulative = running total of the years (ascending).
- Per Security: all-time `count`, `gross`, `net`, `lastDate` per Security id as booked (Portfolio: summed across Depots), ordered by gross descending, then Security id.
- Trailing 12 months = the "1J" Period `[addMonths(today, −12), today]` (`core/period` `resolvePeriod`), so trailing gross equals the Overview/Depot "Dividenden · 1J" figure. Paying Positions = today's Positions (per Depot) of the Securities that paid in that window, each payment's Security carried to today's Security via `adjustedQuantity` (splits, ISIN changes). `payingValue` = Σ their values; yield = income ÷ `payingValue` (gross and net); yield `null` when there is no paying Position, `payingValue` is 0, or a paying Position has no value. Income includes payments of Securities no longer held (literal AC).
- Estimate: every payment dated in `(addMonths(today, −12), today]` whose today's Security is still held in the same Depot yields one expected payment dated `addMonths(date, 12)`, amount = gross / net × `currentQuantity ÷ heldAtPayment`, where `heldAtPayment` = units of the paid Security in that Depot from FIFO over the rows before the DIVIDEND row (by `(date, sequence)`) with actions as of the payment date, carried to today's units via `adjustedQuantity`. When `heldAtPayment` is 0 the factor is 1. Expected payments are ordered by date, then Depot, Security; expected month buckets run from today's month to the month of `addMonths(today, 12)`.
- UI controls (client state, not in URL): view toggle "Monate" / "Jahre" / "Kumuliert" / "Wertpapiere" / "Erwartet" (default Monate), "Jahr" select (years newest first, default today's year; only in Monate), toggle "Brutto" / "Netto" (default Brutto) applying to every figure, KPI and the estimate.
- KPI row: "Einkommen 12 Monate", "Dividendenrendite 12 Monate" (`–` when null) and "Erwartet 12 Monate (Schätzung)". The Erwartet view carries a visible note "Schätzung: Zahlungen der letzten 12 Monate in denselben Monaten, mit aktuellem Bestand." and its heading says "Schätzung".
- Charts via `BarsChart` with `role="figure"` aria-label listing the values and a value table ("Zeitraum" + amount); Wertpapiere and Erwartet also as lists (logo, Security link, count / based-on date, amount). Money via `core/format`, German labels, controls ≥ 44 px, WCAG 2.2 AA; dividend colour = theme accent (DESIGN.md).
- Money exact via `decimal.js` strings; `Number(...)` only for chart coordinates; `src/core` pure, "today" passed in; ledger stays the only DB reader; scope in the URL as in 7.2–7.4; the tab hides "Dimension".

**Never:** storing any figure; a second definition of Period "1J" or of FIFO; provider calls or fetched dividend calendars; changing Aufteilung/Rendite/Gewinne or Overview/Depot figures; presenting the estimate without the "Schätzung" label.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hand reference | Depot: 2025-01-02 BUY 10 X (amount 500); 2025-11-15 DIVIDEND X 20 tax 5 fee 0.5; 2026-03-01 BUY 10 X (amount 600); 2026-05-10 DIVIDEND X 40 tax 10; X today 20 units, value 2000; today 2026-10-27 | months 2025-01..2026-10; 2025-11 gross 20 net 14.5; 2026-05 gross 40 net 30; years 2025 20/14.5, 2026 40/30; cumulative 2025 20/14.5, 2026 60/44.5; X: count 2, gross 60, net 44.5, last 2026-05-10; trailing gross 60, net 44.5, payingValue 2000, yield 0.03 / 0.02225 | — |
| Estimate | same | 2026-11-15 gross 40 net 29 (held 10, now 20); 2027-05-10 gross 40 net 30; total 80 / 59 | — |
| Split | BUY 10 Y; 2025-12-01 DIVIDEND Y 10; split 1:2 2026-01-15; today 20 units | expected 2026-12-01 gross 10 (factor 1) | — |
| Sold | Z paid 2026-02-01, all Z sold 2026-06-01 | Z in trailing income, not in payingValue, no expected payment | — |
| Window edges | payment exactly on `addMonths(today,−12)` | in trailing income (1J), not in the estimate | — |
| No price | paying Position value null | yield null (`–`) | — |
| Two Depots | X paid in A and B, held only in B | income both; payingValue = B's X; estimate only for B's payment | — |
| Tax refund | DIVIDEND 10 tax −2 | net 12 | — |
| No dividends | ledger without DIVIDEND rows | zero buckets, empty lists ("Noch keine Dividenden."), KPI 0, yield `–`, no expected payments ("Keine erwarteten Zahlungen.") | — |
| No Transactions | scope without rows | "Noch keine Transaktionen." | — |
| Future row | DIVIDEND after today | ignored | — |

</intent-contract>

## Code Map

- `src/core/gains-analysis.ts` -- template: `GainsRow`, month range (`monthRange`, `monthKey`), "today" filter, year = Σ months, test style in `gains-analysis.test.ts`.
- `src/core/fifo.ts:84` -- `fifo(rows, asOf, actions)` → lots per Security (for `heldAtPayment`: Σ lot quantities of the paid Security).
- `src/core/corporate-actions.ts:338` -- `adjustedQuantity(securityId, date, quantity, actions, asOf)` → today's Security id and units.
- `src/core/period.ts:49` -- `resolvePeriod({ kind: "preset", preset: "1J" }, today, null)`; `src/core/dates.ts:74` `addMonths`.
- `src/core/valuation.ts:224` -- `periodFlows` (dividends over `[from, to]`) — parity target for trailing gross.
- `src/core/decimal.ts` -- `ExactDecimal`, `canonicalDecimal`; `src/core/ledger-order.ts` `compareLedgerOrder`.
- `src/modules/ledger/gains.ts` -- `gainsInput(scope)` (rows incl. tax, actions, securityNames) — reuse unchanged.
- `src/modules/ledger/positions.ts:82` -- `listPositions(depotId, today, db, { storedPrices })` → `PositionRecord` (`security.id`, `quantity`, `value`).
- `src/app/(app)/analyses/page.tsx` -- `allocationPanel` (positions per Depot in scope) and `gainsPanel` patterns; tab dispatch.
- `src/app/(app)/analyses/page.test.tsx` -- module mocks (`gainsInput`, `listPositions`, `latestStoredPrices`).
- `src/app/_components/analyses/labels.ts` (+ test) -- `ANALYSIS_TABS`, `GAINS_*` helpers (`gainsBucketShortLabel`, `gainsBucketLabel`, `gainsYears`) to reuse.
- `src/app/_components/analyses/GainsView.tsx` (+ dom test) -- controls, `Summary`, `ValueTable`, row/list patterns, `BarsChart` series and props-recording test.
- `src/app/_components/charts/BarsChart.tsx` -- the only bar chart wrapper.
- `src/theme/theme.ts:33` -- `palette.accent` (dividend colour).

## Tasks & Acceptance

**Execution:**
- `src/core/dividend-analysis.ts` (+ `dividend-analysis.test.ts`) -- `dividendAnalysis(depots: readonly { depotId; rows: readonly GainsRow[]; positions: readonly { securityId; quantity; value: string | null }[] }[], actions, today)` → `{ months, years, cumulative: DividendBucket[]; bySecurity: DividendSecurity[]; trailing: { from, to, gross, net, payingValue, grossYield, netYield }; expected: ExpectedDividend[]; expectedMonths: DividendBucket[] }` (`DividendBucket` = `period, gross, net`) -- one pure definition; tests cover every matrix row with exact strings, year = Σ months, and trailing gross = `periodFlows(...).dividends` for 1J.
- `src/app/_components/analyses/labels.ts` (+ test) -- tab `{ value: "dividends", label: "Dividenden" }`; `DIVIDEND_VIEWS`, `DIVIDEND_LABELS`, empty/estimate texts; helpers for view buckets, amount by mode (gross/net), and chart aria-labels.
- `src/app/_components/analyses/DividendsView.tsx` (+ `DividendsView.dom.test.tsx`) -- client component: controls, KPI row, chart card per bucket view (BarsChart + value table + range total), Wertpapiere list, Erwartet card (note, chart by month, list); empty states; tests for view/year/mode switching, KPI values, estimate label and lists.
- `src/app/(app)/analyses/page.tsx` (+ `page.test.tsx`) -- on tab `dividends` load `gainsInput` and `listPositions` per Depot in scope (stored prices) and render `DividendsView` with `dividendAnalysis(...)`, names and `today`; other tabs untouched.

**Acceptance Criteria:**
- Given `/analyses?tab=dividends`, when I pick a scope, then the URL holds it and the KPI row and views show that scope's dividends only.
- Given the views, when I switch Monate (with a year) / Jahre / Kumuliert / Wertpapiere / Erwartet, then the matching chart or list is shown; the Brutto/Netto toggle switches every amount, KPI and estimate.
- Given the Erwartet view, then it is visibly labelled as an estimate (heading and note).
- Given a Depot, then its 12-month gross income equals that Depot's "1J" dividends (`periodFlows`).
- Given the Aufteilung, Rendite and Gewinne tabs, then their behaviour is unchanged.
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 28 findings — high 0, medium 1, low 23, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: yield numerator includes income of sold Securities while the denominator only counts held paying Positions — the spec deliberately follows the literal AC ("income ÷ current value of the paying Positions"); changing it is a spec edit.
  - `[low]` `[reject]` Blind: the inclusive "1J" window is 366 days, so an annual payer on the same date can count twice — chosen so trailing gross equals the Overview/Depot "Dividenden · 1J" figure; changing it is a spec edit.
  - `[low]` `[reject]` Blind: the estimate is not scaled when nothing was held at payment — factor 1 is the spec's defined fallback; its missing test is patched under the verification-gap row.
  - `[low]` `[reject]` Blind: `heldAtPayment` re-runs FIFO per trailing payment (O(payments × rows)) — only trailing-12-month payments of a single-user ledger; negligible.
  - `[low]` `[reject]` Blind: per-Security list keys by booked Security id, so an ISIN change shows old and new rows — spec says "per Security id as booked"; `securityNames` holds every Security, so the old name shows, not a raw id.
  - `[low]` `[reject]` Blind: range totals and the expected KPI are summed in `labels.ts`, not core — exact Decimal sums of core values, no second definition (same reasoning as story 7.4).
  - `[low]` `[reject]` Blind: `DividendsView` borrows `Summary`/`ValueTable` from `GainsView` — reuse instead of duplication; no named caller that would diverge.
  - `[low]` `[patch]` Blind: `DIVIDEND_LABELS.period` / `.security` unused — deleted.
  - `[low]` `[reject]` Blind: Erwartet chart has 13 month buckets under "12 Monate" — the KPI sums exactly the payments dated in (today, today + 12 months]; the buckets are the calendar months that window touches, as the spec defines.
  - `[low]` `[reject]` Blind: one unpriced paying Position hides the yield without a reason — spec defines `–` for that case; adding a hint is new UI.
  - `[low]` `[reject]` Blind: standalone TAX/FEE rows are never subtracted from net — spec decision (net from the DIVIDEND row itself), documented in the core docstring.
  - `[low]` `[patch]` Blind: expected-list DOM assertion depended on SecurityLogo initials — now asserts caption and amount with `toContain`.
  - `[low]` `[reject]` Blind: untested edges (same-day BUY order, split on payment date, negative net, year fallback) — split on the payment date checked by reading: FIFO as of the payment date applies it, `adjustedQuantity` only applies splits dated after it, so no double adjustment; the rest are rare display paths.
  - `[medium]` `[patch]` Edge: Erwartet chart categories repeat ("Okt" for today's month and the same month next year), collapsing two bands into one — expected-view categories now carry a two-digit year (`Okt 26` … `Okt 27`); DOM test asserts all 13 are unique.
  - `[low]` `[reject]` Edge: two Securities with the same name collapse in the Wertpapiere chart — Security names are practically unique; values remain in the list and aria-label.
  - `[low]` `[patch]` Edge: expected-list React key collides for two same-day payments of one Security in one Depot — index appended to the key.
  - `[low]` `[reject]` Edge: held 0 at payment returns the raw amount — same as the Blind row above (spec fallback).
  - `[low]` `[reject]` Edge: ISIN change dated on the payment day with the dividend booked under the old id loses value/estimate — replay applies the change first, so such a booking is itself inconsistent; very rare.
  - `[false]` `[reject]` Edge: a DIVIDEND without a Security would break parity with `periodFlows` — the ledger rejects DIVIDEND without a Security (`src/modules/ledger/transactions.ts:307`), and every writer goes through it.
  - `[low]` `[patch]` Verification gap: factor-1 fallback (`heldAtPayment` 0) untested — core test added (dividend 12 before the BUY → expected 2027-01-10 gross/net 12).
  - `[low]` `[reject]` Verification gap: "Jahr" fallback after a scope change untested — one-line guard identical to `GainsView`, rejected there for the same reason.
  - `[false]` `[reject]` Intent: Brutto/Netto toggle also switches the KPIs — goes beyond the AC wording without contradicting it; no bad outcome.
  - `[false]` `[reject]` Intent: "per Security" implemented all-time — the AC binds only the month view to a selected year; all-time per Security is a direct reading.
  - `[low]` `[reject]` Intent: estimate and paying set per Depot, not across the scope — FIFO and holdings are per Depot (AD-10); a payment from a Depot that sold is not "held" there.
  - `[low]` `[reject]` Intent: income and estimate windows differ by one day — same as the Blind window row.
  - `[low]` `[reject]` Intent: some totals computed in `labels.ts` — same as the Blind totals row.
  - `[low]` `[reject]` Intent: page test mocks `listPositions` — `listPositions` has its own ledger DB tests; the page test checks the wiring.
  - `[false]` `[reject]` Intent: work not committed — commit happens at finalization of this run.

## Design Notes

Hand reference net: 2025-11-15 → 20 − 5 − 0.5 = 14.5; 2026-05-10 → 40 − 10 = 30. Yield 60 / 2000 = 0.03, net 44.5 / 2000 = 0.02225. Estimate: on 2025-11-15 10 units were held, today 20 → factor 2 → gross 40, net 29.

The estimate window is half-open at the start so a payment exactly one year ago is not projected onto today; trailing income keeps the inclusive "1J" Period so it matches the Overview KPI.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Story 7.5 adds the tab "Dividenden" to `/analyses`. For the Portfolio (non-archived Depots) or one Depot, the pure `core/dividend-analysis` turns the ledger and today's Positions into gross/net dividend buckets per month and year, a running total per year, all-time totals per Security, the trailing-12-month income ("1J" Period, equal to the Overview "Dividenden · 1J") with the yield over today's paying Positions, and an estimate of the next 12 months (each payment of the last 12 months one year later, scaled by today's holding ÷ holding at payment). The tab has a KPI row (Einkommen 12 Monate, Dividendenrendite 12 Monate, Erwartet 12 Monate (Schätzung)), a Brutto/Netto toggle for every figure and the views Monate (with Jahr), Jahre, Kumuliert, Wertpapiere and Erwartet (heading and note mark it as an estimate). Every chart has a text alternative and a value table.

**Files changed:**
- `src/core/dividend-analysis.ts` (+test) -- buckets, cumulative, per Security, trailing income/yield, estimate.
- `src/app/_components/analyses/labels.ts` (+test) -- "Dividenden" tab, views, modes, texts and helpers.
- `src/app/_components/analyses/DividendsView.tsx` (+dom test) -- the tab UI.
- `src/app/_components/analyses/GainsView.tsx` -- exports `Summary` and a generic `ValueTable` for reuse (no behaviour change).
- `src/app/(app)/analyses/page.tsx` (+test) -- loads ledger rows and today's Positions only on the Dividenden tab.

**Review findings:** 28 (high 0, medium 1, low 23, false 4, maybe-false 0).
- **Patched (5):** unique Erwartet chart categories (medium); unused labels removed, robust expected-list assertion, unique expected-list key, factor-1 fallback test (low).
- **Deferred:** none.
- **Rejected:** yield numerator, 1J window length, factor-1 behaviour, FIFO re-run cost, ISIN rows per Security, totals in `labels.ts`, shared Gains components, 13 expected buckets, silent `–` yield, standalone TAX/FEE, untested rare edges, duplicate names, same-day ISIN change, year-fallback test, per-Depot estimate, duplicate window/totals rows, mocked `listPositions` (low, reasons in triage log); DIVIDEND without Security, toggle on KPIs, all-time per Security, uncommitted work (false).

**Follow-up review:** not recommended (`false`); patched: high 0, medium 1, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` all passed after the patches (201 test files, 2733 tests; build lists `/analyses`). Every I/O matrix row is covered by a passing core or DOM test; the core test asserts trailing gross equals `periodFlows(...).dividends` for "1J".

**Residual risks:**
- Not checked in a real browser (bar rendering, phone layout of five view buttons); the only populated database holds real data.
- Yield includes income of Securities sold within the window (literal AC reading).
- No operator action is required.
