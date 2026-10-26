---
title: 'All-time Performance and Price Chart with Trades (story 4-7)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '631cdeb8a2027fa277b6cf6e80dede79eff80eca'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-6-security-detail-page.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Security detail page (4-6) shows only Period figures and a value chart: Tommy cannot see what a holding earned in total since the first buy, nor when he bought and sold against the price history (FR-19).

**Approach:** Add pure core functions for the all-time Security total (per Depot, summed for "Alle Depots", Security XIRR) and for a split-adjusted daily price series plus trade markers; extend `securityDetail` to return them; render a card "Gesamt seit Erstkauf" and replace the hero chart with a client `SecurityChart` that toggles "Kurs" (price line + buy/sell markers) and "Wert" (existing `ValueChart`).

## Boundaries & Constraints

**Always:**
- **Scope** = the 4-6 scope unchanged (selected Depot, or "Alle Depots" = non-archived booking Depots; chain rows incl. ISIN-change relatives; FIFO per Depot).
- **All-time total (core, as of `today`, independent of the Period):** per Depot from all its chain rows: realized = Σ FIFO sale gains (`fifo(rows, today, actions)`); value/Cost Basis from `computePositions(rows, observations, today, actions)`; unrealized = value − Cost Basis; dividends = Σ DIVIDEND `amount`; fees = Σ `fee` of DIVIDEND/FEE rows (trade fees live in cost/proceeds, as in 4-6); taxesPaid = Σ signed `tax` of all rows; total = realized + unrealized + dividends − fees (taxes separate, AD-10); totalInvested = Σ BUY `amount + fee`; returnRatio = total ÷ totalInvested; XIRR = `xirr` over investor-view flows: BUY −(amount+fee), FEE −fee, SELL and DIVIDEND +(amount−fee), plus +current value dated `today` when > 0; taxes ignored. "Alle Depots": amounts summed, XIRR over the merged flows and the summed current value. Value `null` (open Position without price) → unrealized, total, returnRatio, XIRR `null`; returnRatio `null` when totalInvested is 0.
- **Card "Gesamt seit Erstkauf"** (section, heading via `CardHeading`), placed after the KPIs: rows Realisiert, Unrealisiert, Dividenden, Gebühren (as `−fees`), **Gesamt** (bold), then separated "Steuern gezahlt" (note "nicht in Gewinn/Verlust enthalten"), "Investiert gesamt" (unsigned), "Rendite auf Investiert" (`formatPercent`, signed with arrow ▲/▼ like `GainLossPill`, or `–`), "XIRR" (`formatPercent` or `–`). Signed amounts with `formatMoney(…, { sign: true })`; `–` for `null`.
- **Price series (core):** for each date `from..to` the resolver price of the price Security (`currentSecurityId(id, actions, to)`) over observations adjusted with `adjustedPrice(…, to)` (same as `securityPrice`), `null` before the first observation; one pass (sort + carry forward), not `resolvePrice` per day.
- **Trade markers (core):** every BUY/SELL scope row dated `from..to`, with Depot name, `type`, `date`, quantity and price per unit adjusted to the price Security's units as of `to` (price = row `price` ?? amount ÷ quantity, via `adjustedPrice`; quantity via a new `adjustedQuantity` in `core/corporate-actions.ts`, the inverse factors of `adjustedPrice`), and `adjusted: boolean`.
- **Chart toggle:** `ToggleButtonGroup` (`aria-label="Diagramm"`, buttons "Kurs" / "Wert", ≥ 44 px, `CompositionCard` pattern), default "Kurs", local state. "Wert" = the current `ValueChart` of the series, unchanged. "Kurs": x-charts `LineChart` like `ValueChart` (same axis/tick/grid helpers, primary 3 px line, no area, no invested line) with two mark-only series (no line): buys `shape: "triangle"`, sells `shape: "diamond"`, distinct theme colors, y = the day's price (trade price when the day has none). Axis tooltip (mouse, touch, keyboard): date, `Kurs <price>`, then one line per trade that day: `Kauf`/`Verkauf` · Depot · `<qty> Stück à <price>` (`split-bereinigt` when adjusted). `role="figure"` with aria-label `Kursverlauf <from> – <to>: Kurs von X auf Y, N Käufe, M Verkäufe`. Price `null` everywhere → text `Kein Kursverlauf vorhanden.` instead of the chart.
- Amounts cross into the client as decimal strings; `Number(...)` only for plot coordinates.

**Never:** no stored figures; no new dependency; no change to Period figures, KPIs or other pages; no `number` money math; no `Date.now()` in core; no edit of the 4-6 intent behaviors except the hero chart slot.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fully sold | BUY 10 @100 fee 1 (2025-01-02), SELL 10 @120 fee 1 (2026-01-02) | realized 198, unrealized 0, total 198, invested 1001, ratio ≈ 0,1978, XIRR ≈ 0,1978 (one year), value 0 | — |
| Two Depots | A: BUY 10 @100, B: BUY 5 @120; price 110 today | Alle Depots: invested 1600, unrealized 50, total 50; Depot A: unrealized 100 | — |
| Dividend + fee | held, DIVIDEND 20 fee 1 tax 5, FEE 2 | dividends 20, fees 3, taxes 5, total includes 20 − 3, taxes not | — |
| Split | BUY 10 @100 (price 100), split 1:2 later | price series before split 50, marker qty 20 à 50 `split-bereinigt`, total unaffected | — |
| No price | open Position, no observation resolvable | unrealized/total/ratio/XIRR `–` | — |
| Period independence | custom Period 1M | card identical to MAX; markers only within Period | — |

</intent-contract>

## Code Map

- `src/core/security.ts` -- add `SecurityTotal` type, `securityTotal(depotRows: readonly (readonly ValuationRow[])[], observations, actions, today)` (one entry per scope Depot, summed), `securityPriceSeries(observations, securityId, actions, from, to)` → `{date, price: string|null}[]`, `securityTrades(rows: TradeRow[], actions, asOf)` (TradeRow = BUY/SELL row with `price: string|null`, `depotName`). Reuse `fifo`, `computePositions` (`positions.ts:36`), `xirr`/`CashFlow` (`returns.ts:141`), `periodFlows`, `adjustedPrice`, `compareObservations` (`prices.ts`).
- `src/core/corporate-actions.ts:275` -- `adjustedPrice`; add `adjustedQuantity(securityId, date, quantity, actions, asOf)` next to it.
- `src/modules/ledger/security-detail.ts` -- load observations as of `today` (≥ `to`; resolver ignores later dates); add `total`, `priceSeries`, `trades` to `SecurityDetail`; records carry `price` (`TRANSACTION_INCLUDE` rows).
- `src/app/_components/charts/ValueChart.tsx`, `value-chart.ts` -- model for the new `PriceChart.tsx` + `price-chart.ts` (plot data with `null`s, tooltip lines, aria label); reuse `utcDate`, `tickDates`, `tickLabel`, `spanDays`.
- `src/app/_components/security-detail/SecurityHero.tsx` -- `chart` slot replaces the inline `ValueChart`; new client `SecurityChart.tsx` (toggle). `SecurityTotal.tsx` (card, server-safe) using `BreakdownRow`-like rows (`ValueSummary.tsx:45`, export if reused), `GainLossPill`/`gainLossTone`.
- `src/app/(app)/securities/[id]/page.tsx` -- pass chart data and render the card after `SecurityKpis`.
- `src/app/_components/composition/CompositionCard.tsx:182` -- toggle pattern. Tests: `ValueChart.dom.test.tsx` (happy-dom size mock, keyboard tooltip), `SecurityDetail.dom.test.tsx`, `src/core/security.test.ts`, `src/modules/ledger/security-detail.test.ts`, `src/app/(app)/securities/[id]/page.test.tsx`.

## Tasks & Acceptance

**Execution:**
- `src/core/corporate-actions.ts` (+ test) -- `adjustedQuantity`.
- `src/core/security.ts` + `security.test.ts` -- total, summing, price series, trades; tests cover every matrix row (fully sold, two Depots, dividend + fee, split, no price) plus a hand-checked XIRR.
- `src/modules/ledger/security-detail.ts` + test -- new fields; custom Period leaves `total` equal to MAX; trades limited to Period and scope.
- `src/app/_components/charts/price-chart.ts` + test, `PriceChart.tsx` + DOM test -- labels, plot data, markers, keyboard tooltip with trade lines.
- `src/app/_components/security-detail/SecurityChart.tsx`, `SecurityTotal.tsx`, `SecurityHero.tsx`, `labels.ts` (+ DOM tests) -- toggle default Kurs, switch to Wert, card rows and `–`.
- `src/app/(app)/securities/[id]/page.tsx` + `page.test.tsx` -- card heading and figures, toggle present, sold Security card.

**Acceptance Criteria:**
- Given the Security page for any scope, when it renders, then "Gesamt seit Erstkauf" shows realized, unrealized, dividends, fees, total, taxes, total invested, return % and XIRR, identical for every Period selection.
- Given the hero chart, when "Wert" is chosen, then the 4-6 value chart shows; when "Kurs", the price line with one marker per trade day and kind, and keyboard arrow navigation shows date, Depot, quantity and price.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 30 findings — high 0, medium 0, low 21, false 9, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: "Alle Depots" all-time total omits archived Depots — scope is the 4-6 / AD-17 rule (archived excluded from aggregates); an archived Depot stays selectable on its own; changing it edits this spec.
  - `[false]` `[reject]` Blind: observations loaded as of today may change past-Period figures, untested — the existing 4-6 custom-Period test now receives a provider price dated after `to` (2026-10-20) and still asserts snapshot value 1050 and price 105 as of 2026-06-30, and passes.
  - `[low]` `[reject]` Blind: `adjustedObservations` duplicates a block in `computePositions` — duplication existed inline in 4-6 `securityPrice`; extraction across modules adds surface for no observed drift.
  - `[low]` `[reject]` Blind: FIFO run twice per Depot in `securityTotal` — single-user, negligible cost; merging needs restructuring `computePositions`.
  - `[low]` `[reject]` Blind: `ratioTone` reimplements `gainLossTone` for percentages — different rounding scale (percent vs cents) is intended; no diverging caller.
  - `[low]` `[reject]` Blind: card negates fees in the shell — a sign flip for display, same as 4-6 `feesContribution` semantics; moving it to core adds a field.
  - `[low]` `[reject]` Blind: "Steuern gezahlt" shown signed — identical to the existing 4-6 `Breakdown` row; consistency across cards.
  - `[low]` `[reject]` Blind: no legend for buy/sell markers — markers differ by shape, tooltip and aria-label name them; DESIGN.md charts carry no legend.
  - `[low]` `[reject]` Blind: price chart has no y-axis — DESIGN.md area-chart style (horizontal grid only), same as `ValueChart`; values in the tooltip.
  - `[low]` `[reject]` Blind: chart types duplicated between core and app — no drift observed; typecheck catches field mismatches at the page mapping.
  - `[low]` `[patch]` Blind: test gaps (two-Depot XIRR weak, no ISIN-change trade case, future-dated rows) — added NPV-zero check for merged flows, ISIN-change `securityTrades` test, future-rows test.
  - `[low]` `[reject]` Blind: `adjusted` false for a 1:1 ISIN change — numbers are unchanged, so "split-bereinigt" would be wrong; the row's Security is shown in "Buchungen".
  - `[low]` `[reject]` Blind: aria-label range starts before the first priced day — label format is mandated by the spec (`<from> – <to>`); only for Periods starting before the first price.
  - `[false]` `[reject]` Blind: "Wert" mode can be empty while "Kurs" is not — both series span `from..to` and are empty only together (`from > to`), where `SecurityChart` renders nothing.
  - `[false]` `[reject]` Blind: spec status/logs stale — reviewed mid-run; finalization fills them.
  - `[low]` `[reject]` Edge: new-ISIN page with a Period ending before the change shows no price history — same root as the 4-6 rejected "price before ISIN change" row; rare custom Period, fix adds a branch.
  - `[low]` `[reject]` Edge: 1:1 ISIN-change trade lacks adjustment note — duplicate of the Blind `adjusted` row.
  - `[low]` `[reject]` Edge: trades hidden when no day in the Period has a price — every BUY/SELL with a price is itself an observation; only priceless trades and no other price, practically unreachable.
  - `[low]` `[reject]` Edge: SELL beyond open lots overstates realized — pre-existing FIFO rule ("units sold beyond open lots carry zero cost") used by every view.
  - `[low]` `[patch]` Verification gap: "Alle Depots" XIRR only checked > 0 — replaced with NPV ≈ 0 over −1000 / −600 / +1650 merged flows.
  - `[low]` `[patch]` Verification gap: future-dated rows excluded from total untested — added "ignores rows dated after today" test.
  - `[low]` `[patch]` Verification gap: page test toggle regex passes regardless of pressed state — now asserts the pressed buttons are exactly `["Kurs"]`.
  - `[false]` `[reject]` Intent: operator clause might apply — no human-only action exists in this story.
  - `[low]` `[reject]` Intent: markers only for trades within the Period vs "every BUY and SELL" — the chart's x-range is the Period; out-of-range trades cannot be placed.
  - `[low]` `[reject]` Intent: same-day same-kind trades share a marker — tooltip lists each trade; spec Design Notes.
  - `[false]` `[reject]` Intent: XIRR fee treatment diverges from the epic — gross figures per AD-10/FIFO (cost = amount + fee, proceeds = amount − fee).
  - `[false]` `[reject]` Intent: null XIRR without price not covered by epic — a defined edge case, not a divergence.
  - `[low]` `[reject]` Intent: axis tooltip rather than a marker tooltip — the axis tooltip on a marker's date shows its trades; keyboard-reachable.
  - `[low]` `[reject]` Intent: no real-browser check — no browser runner in the repo; residual risk.
  - `[false]` `[reject]` Intent: verification commands not evidenced / run not finalized — they ran (lint, typecheck, 1870 tests, build pass); finalization follows.

## Design Notes

Markers sit on the price line (y = that day's resolver price) so buy and sell series stay index-aligned with the dates; the exact trade price is in the tooltip. Several trades of one day and kind share one marker; the tooltip lists each.

Security XIRR flows (investor view, `CashFlow`): `BUY 1000 fee 1 → -1001`; `SELL 1200 fee 1 → +1199`; `DIVIDEND 20 fee 1 → +19`; current value 1100 → `+1100` on today.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: Security page, toggle Kurs/Wert, hover/keyboard over markers, 375 px without horizontal scroll.

## Auto Run Result

Status: done

**Summary:** Story 4.7 extends the Security page. Pure core `securityTotal` computes the all-time result as of today (independent of the Period) per scope Depot and summed: realized (FIFO), unrealized, dividends, fees, taxes separate, total, total invested (Σ BUY amount + fee), return on invested and a Security XIRR over investor flows plus current value; `null` figures without a price. `securityPriceSeries` gives the split/ISIN-adjusted daily resolver price in one pass; `securityTrades` gives buy/sell markers with adjusted quantity/price (new `adjustedQuantity`). The page shows a card "Gesamt seit Erstkauf" after the KPIs, and the hero chart now toggles "Kurs" (price line, triangle buys, diamond sells, keyboard tooltip with date, Depot, quantity, price) and "Wert" (unchanged value chart), default "Kurs".

**Files changed:**
- `src/core/corporate-actions.ts` (+ test) — `adjustedQuantity`.
- `src/core/security.ts` (+ test) — `securityTotal`, `securityPriceSeries`, `securityTrades`, shared observation adjustment.
- `src/modules/ledger/security-detail.ts` (+ test) — `total`, `priceSeries`, `trades`; observations as of today.
- `src/app/_components/charts/PriceChart.tsx`, `price-chart.ts` (+ tests) — price chart with trade markers.
- `src/app/_components/security-detail/SecurityChart.tsx`, `SecurityTotal.tsx`, `SecurityHero.tsx`, `labels.ts` (+ tests) — toggle, card, chart slot, labels.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) — wiring.
- `test/architecture/chart-imports.test.ts` — `PriceChart.tsx` allowed as second chart wrapper (library stays in `charts/`).

**Review findings:** 30 — patched 4 rows in 1 fix round (low: two-Depot XIRR exact check, future-rows test, ISIN-change trade test, toggle pressed assertion). Deferred: none. Rejected: 26 (9 false; 17 low: archived Depots in total, dup adjustment block, double FIFO, ratio tone, shell fee sign, signed taxes, no legend, no y-axis, dup chart types, 1:1 ISIN adjusted flag ×2, aria range, ISIN past Period, priceless trades, FIFO short sells, Period-limited markers, shared markers, axis tooltip, browser check) — reasons in the Review Triage Log.

**Follow-up review recommendation:** false — patched high 0, medium 0, low 4.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (137 files, 1870 tests) after patches. Matrix audit: Fully sold, Two Depots, Dividend + fee, Split, No price in `src/core/security.test.ts` (+ DOM `–` test); Period independence in `security-detail.test.ts` and the page test.

**Residual risks:** Not inspected in a real browser (marker look, touch tooltip, 375 px). The chart-library guard now allows two wrapper files instead of one. A new-ISIN page with a custom Period ending before the ISIN change shows no price history.
