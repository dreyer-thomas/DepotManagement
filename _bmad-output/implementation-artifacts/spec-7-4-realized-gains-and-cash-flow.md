---
title: 'Story 7.4: Realized Gains and Cash Flow'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '6ccbe7b11db30fd9a51bb233cfd160d957f07e3e'
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

**Problem:** The Analysen page has Aufteilung and Rendite, but Tommy cannot see what his sales earned per month/year, nor how much money he put in or took out (FR-22, CAP-22).

**Approach:** A third tab "Gewinne" on `/analyses`: for the chosen scope (Portfolio or one non-archived Depot) one pure core function buckets the ledger per month and per year into realized Gain/Loss (FIFO per Depot, AD-10), dividends, fees, taxes and Deposits/Withdrawals, and lists every sale with its gain. The tab shows a realized-gains bar chart (month view for a chosen year / year view over all years) with switchable dividend and fee layers and taxes listed separately, the five best and worst sales, and a "Kapitalfluss" bar chart of net Deposits − Withdrawals.

## Boundaries & Constraints

**Always:**
- Inputs: per Depot in scope its ledger rows (`securityId, type, date, sequence, quantity, price, amount, fee, tax`) plus the recorded corporate actions; Portfolio = non-archived Depots (AD-17). Rows dated after `today` are ignored. FIFO runs per Depot (`fifo(rows, today, actions)`), never across Depots.
- Per bucket (month `YYYY-MM` and year `YYYY`): `realized` = Σ `sale.gain` of FIFO sales dated in it (trade fees already inside, tax excluded — same as `periodPerformance.realized`); `dividends` = Σ gross DIVIDEND `amount`; `fees` = Σ `fee` of FEE and DIVIDEND rows (same as `periodPerformance.fees`); `taxes` = Σ `tax` of all rows (net, refunds negative; same as `periodFlows.taxesPaid`); `deposits` = Σ DEPOSIT `amount`; `withdrawals` = Σ WITHDRAWAL `amount`; `netCashFlow` = deposits − withdrawals. Migration funding and reconciliation cash corrections ("Kontoabgleich") are DEPOSIT/WITHDRAWAL rows and therefore included; holding corrections (ADJUSTMENT) and taxes are not part of Kapitalfluss.
- Months: every month from the first ledger month to today's month (zeros where nothing happened); years: first ledger year to today's year. Year bucket = sum of its month buckets exactly.
- Sale record: `depotId`, `securityId`, `date`, `sequence`, `quantity` (as booked on the SELL row, canonical), `proceeds`, `costBasis`, `gain`, `gainRatio` = gain / costBasis (`null` when costBasis is 0). Best = sales with gain > 0 by gain descending, worst = gain < 0 by gain ascending, five each, tie-break by date then sequence; gain = 0 is in neither list.
- UI controls (client state, not in URL): view "Monate" / "Jahre" (toggle, default Monate), "Jahr" select (years newest first, default today's year; only in Monate view), switches "Dividenden" and "Gebühren" (default off). The view/year selection applies to the gains chart, the best/worst lists (selected year in Monate, all sales in Jahre) and the Kapitalfluss chart.
- Gains chart: bars "Realisiert" per bucket coloured gain/loss by sign; dividends (positive) and fees (shown as negative bars) as extra series when switched on. Below it a summary for the selected range: Realisiert, Dividenden, Gebühren, "Gezahlte Steuern" (taxes, never in the chart) — signed money values.
- Kapitalfluss chart: net bars per bucket; summary Einzahlungen, Auszahlungen, Netto for the selected range.
- Every chart has a text alternative (`role="figure"` + `aria-label` with the per-bucket values) and a compact table ("Zeitraum" + values) so values never rely on colour or hover; gain/loss always signed (UX-DR21), WCAG 2.2 AA, controls ≥ 44 px, German labels, de-DE formats via `core/format`.
- Money exact via `decimal.js` strings; `Number(...)` only for chart coordinates; `src/core` pure, "today" passed in; ledger stays the only DB reader.
- Scope in the URL as in 7.2/7.3; the "Gewinne" tab hides the "Dimension" select; switching tabs keeps scope and dimension.

**Never:** storing any figure; a second FIFO or cash-effect definition; FIFO across Depots; provider calls; the Dividenden tab (7.5); changing Aufteilung/Rendite or existing Overview/Depot figures; taxes inside the bars.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hand reference | Depot: 2026-01-10 DEPOSIT 2000; BUY 10 @100 fee 1 (amount 1000); 2026-03-05 SELL 4 amount 480 fee 2 tax 5; 2026-03-20 DIVIDEND 30 fee 0.5 tax 7.5; 2026-04-02 WITHDRAWAL 300; today 2026-04-30 | Jan: deposits 2000, net +2000; Mar: realized 480−2−400.4 = 77.6, dividends 30, fees 0.5, taxes 12.5; Apr: withdrawals 300, net −300; year 2026: realized 77.6, dividends 30, fees 0.5, taxes 12.5, net 1700; Feb all zero | — |
| Sale % | the SELL above | quantity 4, proceeds 478, costBasis 400.4, gain 77.6, gainRatio 77.6/400.4 | — |
| Best/worst | gains +50, +10, 0, −5, −20 and 6 more positive | best: top 5 positive desc; worst: −20, −5; 0 in neither | — |
| Two Depots (Portfolio) | Security X bought in A @100, in B @200, each sells 1 @150 | gains +50 (A) and −50 (B), not one merged FIFO | — |
| Split | BUY 10, split 1:2, SELL 20 | sale quantity 20 (as booked), gain from FIFO | — |
| Corrections | ADJUSTMENT +2; DEPOSIT 12.34 note "Kontoabgleich" | ADJUSTMENT: no realized, no flow; deposit counted in Kapitalfluss | — |
| Future-dated row | SELL dated after today | ignored everywhere | — |
| Tax refund | TAX row tax −20 | taxes −20 in its month | — |
| No Transactions | scope without rows | "Noch keine Transaktionen." | — |
| Year view | rows in 2024 and 2026 | years 2024, 2025 (zeros), 2026 | — |

</intent-contract>

## Code Map

- `src/core/fifo.ts:76-120` -- `fifo(rows, asOf, actions)` → per Security `sales: FifoSale[]` (`date, sequence, quantity` split-adjusted to asOf, `proceeds, costBasis, gain`); `FifoRow` (price needed for ADJUSTMENT).
- `src/core/fee-attribution.ts:14` -- `saleKey(date, sequence)`; `(depotId, date, sequence)` is unique (`prisma/schema.prisma:95`), so a sale maps back to its row for the booked quantity.
- `src/core/returns.ts:259-310` -- `periodPerformance` definitions of realized / fees to mirror; `src/core/valuation.ts:224` `periodFlows` (dividends, taxesPaid).
- `src/core/corporate-actions.ts` -- `CorporateActions` type; `src/core/decimal.ts` `ExactDecimal`, `canonicalDecimal`.
- `src/core/return-heatmap.ts` + `.test.ts` -- style for month keys, "today" filter, test fixtures.
- `src/core/format.ts` -- `formatMoney` (sign option), `formatPercent`, `formatQuantity`, `formatDate`, `formatMonth`.
- `src/modules/ledger/valuation.ts` -- private `loadRows` (selects exactly the needed columns) and the non-archived Depot query used by `returnSeries` (:251-277); `loadCorporateActions` from `./corporate-actions`; exports via `src/modules/ledger/index.ts:80-81`.
- `src/modules/ledger/securities.ts:161` -- `listSecurities` (id → name for the sale lists).
- `src/app/(app)/analyses/page.tsx` (+ `page.test.tsx` module mocks) -- tab dispatch (`returnsPanel` pattern).
- `src/app/_components/analyses/labels.ts` (+ test) -- `ANALYSIS_TABS`, `HEATMAP_MONTH_LABELS`, `HEATMAP_EMPTY_TEXT`; `AnalysisFilters.tsx` shows "Dimension" only when `tab === "allocation"` (no change needed; verify).
- `src/app/_components/analyses/ReturnHeatmap.tsx`, `AllocationView.tsx` -- Card/`CardHeading`, `SecurityLogo`, `SecurityLink` row patterns.
- `src/app/_components/charts/ValueChart.tsx` + `.dom.test.tsx` -- `@mui/x-charts` usage, theme colours via `(theme.vars ?? theme).palette` (`gain`, `loss`, `series1..5`), happy-dom size mock for chart tests.
- `src/app/_components/security-detail/labels.ts:52` -- `ratioTone` (tone as displayed).

## Tasks & Acceptance

**Execution:**
- `src/core/gains-analysis.ts` (+ `gains-analysis.test.ts`) -- `GainsRow` (FifoRow + `tax`); `gainsAnalysis(depots: readonly { depotId: string; rows: readonly GainsRow[] }[], actions, today)` → `{ months: GainsBucket[]; years: GainsBucket[]; sales: GainsSale[] }` (`GainsBucket` = `period` + the seven amounts as decimal strings; months/years ascending; sales by date, sequence); `bestAndWorstSales(sales, n = 5)` → `{ best, worst }` -- one pure definition; tests cover every matrix row (hand reference exact strings) and year = Σ months.
- `src/modules/ledger/gains.ts` + `index.ts` -- `gainsInput(scope: ReturnScope, db?)` → `{ depots: { depotId, rows }[], actions, securityNames: Record<string, string> }` (Portfolio = non-archived Depots) -- read-only ledger loader; add a ledger DB test (`gains.test.ts`) for scope selection and archived exclusion following `valuation.test.ts`.
- `src/app/_components/analyses/labels.ts` (+ test) -- tab `{ value: "gains", label: "Gewinne" }`; labels for views, layers, summaries, table headers, list headings ("Beste Verkäufe", "Schlechteste Verkäufe"), empty texts ("Keine Verkäufe mit Gewinn." / "Keine Verkäufe mit Verlust." / "Keine Verkäufe im Zeitraum."); pure helpers to pick buckets for the view/year and to build chart aria-labels.
- `src/app/_components/analyses/GainsView.tsx` (+ `GainsView.dom.test.tsx`) -- client component: controls, "Realisierte Gewinne" card (BarChart + summary + table), best/worst lists (logo, Security link, date, quantity, signed gain abs and %), "Kapitalfluss" card (BarChart + summary + table); empty text "Noch keine Transaktionen."; tests for view/year/layer switching, summaries, lists and empty state.
- `src/app/(app)/analyses/page.tsx` (+ `page.test.tsx`) -- on tab `gains` load `gainsInput` and render `GainsView` with `gainsAnalysis(...)`, security names and `today`; other tabs untouched.

**Acceptance Criteria:**
- Given `/analyses?tab=gains`, when I pick a scope, then the URL holds it and the tab shows the realized-gains chart, best/worst sales and Kapitalfluss for that scope only.
- Given the Monate view and a year, when I switch to Jahre, then the gains chart, lists and Kapitalfluss show one bucket per year over all years.
- Given the switches "Dividenden" / "Gebühren", when turned on, then the chart gets that series; taxes stay in the summary only.
- Given a Depot, then the year's realized, dividends, fees and taxes equal that Depot's `depotValuation` figures for the same calendar year (to the cent).
- Given the Aufteilung and Rendite tabs, then their behaviour is unchanged.
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 16, false 7, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: taxes labelled "Gezahlte Steuern" and shown signed (+) unlike the app ("Steuern gezahlt", unsigned in `ValueSummary.tsx:181`) — label renamed to "Steuern gezahlt", taxes formatted unsigned in summary and table.
  - `[low]` `[patch]` Blind: fees negated by string editing in `GainsView` and by Decimal in `labels.ts` — one Decimal-based `negateAmount` in `labels.ts` used by both, with its own test.
  - `[low]` `[reject]` Blind: some strings ("Netto-Zufluss", "(Gewinn)", "Stk.") not in `GAINS_LABELS` — cosmetic code organisation, no user-visible harm.
  - `[low]` `[patch]` Blind: sales card has no visible heading when the range has no sales — empty branch now shows a "Verkäufe" CardHeading naming the section.
  - `[false]` `[reject]` Blind: booked-quantity lookup silently falls back to split-adjusted quantity — `(depotId, date, sequence)` is unique (`prisma/schema.prisma:95`) and every FIFO sale comes from a SELL row of the same Depot's rows, so the lookup cannot miss.
  - `[low]` `[reject]` Blind: Portfolio same-date ties compare per-Depot sequences before depotId — deterministic; only orders equal-gain sales on one date across Depots, rare and harmless.
  - `[low]` `[reject]` Blind: year-fallback on scope change and table headers/links untested — fallback is a one-line expression; adding DOM cases for rare paths not worth it.
  - `[low]` `[reject]` Blind: layer switch labels "Dividenden"/"Gebühren" lack a verb — announced as switches next to the chart; understandable in context.
  - `[low]` `[reject]` Blind: y-axis width 72 may clip values ≥ 1 Mio € — monthly sums of a private portfolio rarely reach that; values are also in table and aria-label.
  - `[low]` `[reject]` Blind: legend lists empty gain/loss and inflow/outflow series — cosmetic; filtering adds branches.
  - `[low]` `[reject]` Blind: `gainsInput` loads all Securities for names — single-user SQLite, small table.
  - `[false]` `[reject]` Blind: exported `loadRows` lets a select change silently alter gains input — `GainsRow` requires every field, so removing a column fails typecheck in `gains.ts`; extra columns are ignored.
  - `[low]` `[reject]` Edge: AC says taxes "in the summary only" but the value table has a taxes column — the table belongs to the textual summary under the chart; taxes are never bars, which is what the intent asks ("taxes paid shown separately"); the fix would be a spec edit.
  - `[low]` `[patch]` Verification gap: chart series only checked via aria-label — DOM test now records `BarsChart` props and asserts series ids/values (gain/loss split, dividends layer, negative fees, inflow/outflow).
  - `[low]` `[patch]` Verification gap: no FEE-type row in tests — core test adds a FEE row and checks month, year and `periodPerformance` parity.
  - `[low]` `[patch]` Verification gap: table cell signs unasserted — March Gebühren `-0,50 €` and April Auszahlungen `-300,00 €` cells asserted.
  - `[false]` `[reject]` Verification gap (other): `loadRows` has no orderBy — `fifo`/`replayEvents` sort by `(date, sequence)`, bucketing is order-independent and `sales` are sorted explicitly.
  - `[low]` `[reject]` Intent: charts verified by text alternative, not rendered bars — now partly covered by the series-props test; real rendering residual risk recorded.
  - `[low]` `[reject]` Intent: range totals (`sumGainsBuckets`) summed in `labels.ts`, not core — exact Decimal sum of core buckets; a month range equals core's year bucket, no second definition of any figure.
  - `[low]` `[reject]` Intent: migration funding covered only by a hand-made DEPOSIT row — the Parqet reader books funding as `type: "DEPOSIT"` (`parqet-reader.ts:454,607`), the same rows the analysis sums.
  - `[false]` `[reject]` Intent: one shared Monate/Jahre toggle instead of both charts at once — AC asks for per month of a chosen year and per year; both are reachable; Kapitalfluss follows the same switch.
  - `[false]` `[reject]` Intent: lists range-scoped and "worst" only loss-making sales — all-time lists are shown in Jahre view; a gain as "worst sale" is not a meaningful reading.
  - `[false]` `[reject]` Intent: ADJUSTMENT excluded from "corrections" — AC defines Kapitalfluss as Deposits − Withdrawals; reconciliation cash corrections are DEPOSIT/WITHDRAWAL rows and included.
  - `[false]` `[reject]` Intent: no running-app check — counted under the rendered-bars row above; the only populated database holds real data (AGENTS.md policy).

## Design Notes

Hand reference: lot cost = 1000 + 1 = 1001 for 10 units; selling 4 consumes 1001 × 4/10 = 400.4; proceeds = 480 − 2 = 478; gain = 77.6. Taxes in March = 5 (sale) + 7.5 (dividend) = 12.5.

Kapitalfluss follows the AC wording "Deposits − Withdrawals"; taxes and ADJUSTMENT market values are external flows for returns (heatmap detail) but not money Tommy put in, so they stay out here.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done

**Summary:** Story 7.4 adds the tab "Gewinne" to `/analyses`. For the Portfolio (non-archived Depots) or one Depot, the pure `core/gains-analysis` buckets the ledger per month (first ledger month..today) and per year into realized Gain/Loss (FIFO per Depot), gross dividends, fees (FEE + DIVIDEND), net taxes, Deposits, Withdrawals and net Kapitalfluss, and lists every sale (booked quantity, proceeds, Cost Basis, gain, ratio). The tab has a Monate/Jahre toggle with a Jahr select, a realized-gains bar chart (gain/loss coloured) with switchable Dividenden/Gebühren layers, a summary with "Steuern gezahlt" separate, the five best and worst sales, and a Kapitalfluss bar chart with Einzahlungen/Auszahlungen/Netto. Every chart has a text alternative and a value table.

**Files changed:**
- `src/core/gains-analysis.ts` (+test) -- month/year buckets, sales, `bestAndWorstSales`.
- `src/modules/ledger/gains.ts`, `index.ts`, `valuation.ts` (+`gains.test.ts`) -- `gainsInput(scope)` loader; `loadRows` shared.
- `src/app/_components/analyses/labels.ts` (+test) -- "Gewinne" tab, labels, range helpers, aria-labels, `negateAmount`.
- `src/app/_components/analyses/GainsView.tsx` (+dom test) -- the tab UI.
- `src/app/_components/charts/BarsChart.tsx` -- `@mui/x-charts` bar chart wrapper; `test/architecture/chart-imports.test.ts` allows it.
- `src/app/(app)/analyses/page.tsx` (+test) -- loads gains data only on the Gewinne tab.

**Review findings:** 23 (high 0, medium 0, low 16, false 7, maybe-false 0).
- **Patched (6, all low):** tax label/sign, single Decimal negation, visible "Verkäufe" heading when empty, chart-series test, FEE-row test, table-cell sign test.
- **Deferred:** none.
- **Rejected:** hard-coded strings, Portfolio tie order, untested year fallback, switch label wording, y-axis width, legend empty series, loading all Security names, tax column in table, UI-side range sums, migration-funding test depth, real-browser check (low, reasons in triage log); quantity fallback, `loadRows` typing/order, toggle/list/ADJUSTMENT readings, running-app duplicate (false).

**Follow-up review:** not recommended (`false`); patched: high 0, medium 0, low 6.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` all passed after the patches (199 test files, 2705 tests; build lists `/analyses`). Every I/O matrix row is covered by a passing core, ledger, DOM or page test; the ledger test confirms the year's realized, dividends, fees and taxes equal `depotValuation` for that calendar year.

**Residual risks:**
- Not checked in a real browser (bar rendering, colours, phone layout); the only populated database holds real data.
- Large monthly sums (≥ 1 Mio €) may crowd the y-axis labels.
- No operator action is required.
