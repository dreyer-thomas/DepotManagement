---
title: 'Gain/Loss and return metrics (story 4-2)'
type: 'feature'
created: '2026-10-26'
status: done
baseline_revision: 'ced6c9c095d5ea722ad96ca14c276350af333c28'
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

**Problem:** The Depot hero card (story 4.1) shows only "Gesamtwert"; there is no Period Gain/Loss, no realized/unrealized split and no TTWROR/XIRR, so performance cannot be judged the way Parqet shows it.

**Approach:** Add a pure `src/core/returns.ts` that derives, from the same daily valuation series plus the Period's rows, the Period Gain/Loss (change in value − net external flows), its split (realized, unrealized, dividends, fees; taxes separate), TTWROR and XIRR. `depotValuation` adds a start point (end of the day before `from`) and the performance; the hero card renders a gain/loss pill (amount + TTWROR), XIRR beside it and an expandable breakdown.

## Boundaries & Constraints

**Always:**
- External flow of a row (into the Depot, signed): DEPOSIT `+amount`, WITHDRAWAL `−amount`, and for every row `−tax` (signed `tax`: a refund is an inflow). Net external flows of the Period = Σ over rows dated `from..to`. Dividends, fees, trades are internal.
- Start value = series value at end of `addDays(from, −1)` (0 before the Depot's first row, e.g. `MAX`). `gain = V(to) − V(start) − netExternalFlows`.
- Split, all over rows dated `from..to`: realized = Σ `gain` of `fifo(rows, to, actions)` sales dated in the Period (FIFO per sale, buy fees in Cost Basis, sell fees in proceeds); unrealized = (positionsValue − investedCapital) at `to` − the same at start; dividends = gross DIVIDEND `amount` (as `periodFlows`); fees = Σ `fee` of FEE and DIVIDEND rows (trade fees already sit in realized/unrealized); taxesPaid as `periodFlows`. Identity, exact in decimals: `gain = realized + unrealized + dividends − fees`.
- TTWROR: inflows count at the start of their day, outflows at the end. Per day split the external flows of the rows dated `d` by sign: `in(d)` = Σ positive flows (DEPOSIT, tax refunds), `out(d)` = Σ |negative flows| (WITHDRAWAL, taxes paid), each row's flow parts classified separately (e.g. a DIVIDEND's tax is an outflow). For each series day `d` with previous point `p` (start point first): `numerator = V(d) + out(d)`, `denominator = V(p) + in(d)`; if `denominator > 0` and `numerator ≥ 0` multiply the chain by `numerator / denominator`, else skip the day (never reset). `ttwror = Π − 1`, not annualised; `null` when no day was multiplied.
- XIRR (annualised): cash flows from the investor's view — `−V(start)` on the start date, `−F(d)` on each day with a non-zero flow, `+V(to)` on `to`; flows dated on their booking date `d` (not shifted to match the TTWROR intraday timing); exponent `days since start date / 365`. Generic exported solver `xirr(flows)` (reused by 4.7). Convergence tolerance sized for display (relative ≈ 1e-12 on the rate, not 1e-30) so a `MAX` Period with hundreds of flow dates stays fast; the root bracket expands beyond 1e7 (bounded) so solvable 1–2-day Periods do not return `null`. `null` when the flows lack both a positive and a negative amount or no root is found.
- Return ratios computed with `decimal.js` in a lower-precision clone (≈ 40 significant digits) local to `core/returns` — never `ExactDecimal` (precision 1000 makes `ln`/`exp` far too slow) and never JS `number`. Results are decimal strings (ratio, `0.1142` = 11,42 %). Money amounts stay exact (`ExactDecimal`).
- UI per UX-DR5/DR21: hero shows under the value `GainLossPill` with text `+14.238,55 € · TTWROR +11,42 %` (tone from the gain amount; arrow + sign; without TTWROR only the amount), next to it plain text `XIRR +10,87 %` (`XIRR –` when `null`). Below, a collapsed MUI `Accordion` "Aufschlüsselung" (summary ≥ 44 px) listing Realisiert, Unrealisiert, Dividenden, Gebühren (shown as negative contribution — core returns the signed contribution, the shell does not negate) — then separated "Steuern gezahlt" with note "nicht in Gewinn/Verlust enthalten", and one caption "Ordergebühren stecken in realisiert/unrealisiert." Breakdown amounts signed (`formatMoney(…, { sign: true })`), neutral text color. All formatting via `core/format`. Valid markup: no `Divider`/`div` as a direct child of `<dl>` (split the list around the separator).

**Never:**
- No stored results, no Prisma migration, no chart (4.3), no Overview/Portfolio aggregation (4.4), no Security-level figures (4.6/4.7).
- `src/core` imports only its own files and `decimal.js`; no `Date.now()`. Shell computes no figure. Tests never hit live providers.
- No color without sign and arrow on gain/loss figures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reference (hand-calculated) | 2021-01-01 DEPOSIT 1000 + BUY 10 @100 (start V 1000, cash 0); Period 2021-01-02..2023-01-01; price 110 on 2021-12-31; 2022-01-01 DEPOSIT 1100 + BUY 10 @110; price 121 on 2023-01-01 | V(to) 2420; gain 320 (= unrealized); TTWROR `0.21`; XIRR `0.1` (±1e-9) | — |
| Deposit not gain | DEPOSIT 5000 in Period, nothing else | gain 0, TTWROR 0 | — |
| Tax refund | TAX row with tax −20 in Period, no other activity | gain 0, taxesPaid −20, net external flows +20 | — |
| No flows | prices move, no DEPOSIT/WITHDRAWAL/tax in Period | `(1 + xirr)^(days/365) = 1 + ttwror` (days = `to` − start date) within 1e-9; TTWROR = V(to)/V(start) − 1 | — |
| Sale + dividend + fee | SELL with gain, DIVIDEND amount 30 fee 1 tax 5, FEE 2 | realized = FIFO sale gain; dividends 30; fees 3; taxesPaid 5; identity holds | — |
| Empty start | `MAX`, first row DEPOSIT on `from` | start V 0; first day's denominator = deposit | — |
| Nothing invested | Period with V 0 throughout and no flows | gain 0; TTWROR `null`; XIRR `null`; pill shows `0,00 €` neutral, "XIRR –" | no throw |
| Full withdrawal | WITHDRAWAL of entire value on a day | that day counts as `(0 + W) / V(p)` (its price move only); following days with denominator 0 skipped; no division by zero | — |
| Liquidation on a down day | V(p) 1000 all positions; on `d` SELL for 990 and WITHDRAWAL 990; nothing after | day factor `990 / 1000`; TTWROR −0,01 (not −1) | — |
| Liquidation on an up day | V(p) 1000; on `d` SELL for 1010 and WITHDRAWAL 1010 | day factor `1010 / 1000`; gain kept (TTWROR +0,01) | — |
| Overdrawn | a day with `V(d) + out(d) < 0` (FEE exceeding the Depot value) | that day skipped; chain keeps its sign | no throw |

</intent-contract>

## Code Map

- `src/core/valuation.ts` -- `valuationSeries(rows, observations, actions, from, to)`, `ValuationPoint` {value, positionsValue, cash, investedCapital}, `ValuationRow`, `periodFlows(rows, from, to)` → {dividends, taxesPaid}; reuse, do not duplicate these definitions.
- `src/core/fifo.ts` -- `fifo(rows, asOf, actions)` → per Security `sales[]` with `date`, `gain` (proceeds − consumed Cost Basis).
- `src/core/cash.ts` -- `CashRow` (unsigned `amount`, `fee` ≥ 0, signed `tax`); cash effect per type (basis of the identity: ΔV − flows = ΔU + realized + dividends − fees).
- `src/core/decimal.ts` -- `ExactDecimal` (precision 1000), `canonicalDecimal`; add the returns clone in `returns.ts`, not here.
- `src/core/dates.ts` -- `addDays`; day difference for the XIRR exponent (add a `daysBetween` helper if none exists).
- `src/core/valuation.test.ts` -- fixture/oracle style to follow for core tests.
- `src/modules/ledger/valuation.ts` -- `depotValuation` → `DepotValuation`; compute the series from `addDays(from, −1)` and split into `start` + `series` (series stays `from..to` for 4.3); load `actions` already present.
- `src/modules/ledger/valuation.test.ts` -- test-db pattern (`createTestDatabase`, `book(...)`).
- `src/app/_components/positions/GainLossPill.tsx` -- `GainLossPill({gain, ratio})`, `gainLossText`, `gainLossTone`; add optional `ratioLabel` (e.g. `"TTWROR"`) → `+X € · TTWROR +Y %`. Existing test `GainLossPill.test.ts`.
- `src/app/_components/valuation/ValueSummary.tsx` -- hero card + KPI row; server-rendered; add performance prop.
- `src/app/(app)/depots/[id]/page.tsx:86-160` -- passes valuation to `ValueSummary`; `page.test.tsx` renders via `test/helpers/render-text` (`renderText`/`renderHtml`), real migrated SQLite, cookie jar for the Period, clock pinned.
- `src/core/format.ts` -- `formatMoney(v, {sign})`, `formatPercent(ratio)` (always signed).
- Mockup `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/mockups/overview-desktop.html` line ~52 -- pill + meta line layout.

## Tasks & Acceptance

**Execution:**
- `src/core/dates.ts` (+ test) -- `daysBetween(from, to)` if missing -- XIRR exponent.
- `src/core/returns.ts` (+ `returns.test.ts`) -- `externalFlow(row)`, `ttwror(start, series, rows)`, `xirr(flows: {date, amount}[])` (Newton safeguarded by bisection over an expanding bracket on `(−1, …)`; deterministic, bounded iterations), `periodPerformance(rows, start, series, actions)` → `{ gain, realized, unrealized, dividends, fees, taxesPaid, netExternalFlows, ttwror, xirr }` -- AD-10 metrics; tests cover every matrix row plus the identity on a mixed fixture (split, ISIN change, SELL) and a 3-year daily series with ~50 flow days completing quickly.
- `src/modules/ledger/valuation.ts`, `index.ts` (+ test) -- `DepotValuation` gains `start: ValuationPoint` and `performance: PeriodPerformance`; test the reference scenario through the DB (gain, TTWROR, XIRR) -- one series feeds all metrics.
- `src/app/_components/positions/GainLossPill.tsx` (+ test) -- optional `ratioLabel` -- hero pill text.
- `src/app/_components/valuation/ValueSummary.tsx` -- pill + XIRR line under the value; "Aufschlüsselung" accordion per Always -- UX-DR5.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- pass `valuation.performance`; page tests assert pill text with TTWROR, "XIRR", breakdown labels/amounts, arrow present for gain and loss, and the archived Depot still shows them; pin exact XIRR text in every scenario (not prefix/regex only) and guard hero-HTML slicing (`indexOf` must be found) so negative assertions cannot pass vacuously -- AC surface.

**Acceptance Criteria:**
- Given a Depot with history and a stored Period, when its detail page renders, then the hero shows the gain/loss pill (signed amount, arrow, `TTWROR` ratio), `XIRR` beside it, and the "Aufschlüsselung" with Realisiert, Unrealisiert, Dividenden, Gebühren and separately Steuern gezahlt, all for that Period.
- Given a Period with a loss, when the page renders, then the pill has the loss tone, a downward arrow and a "-" sign.
- Given core tests, then the reference case yields TTWROR 0,21 and XIRR 0,1, a Deposit is not gain, a tax refund is an external flow, a no-flow Period satisfies the TTWROR/XIRR equivalence, and `gain = realized + unrealized + dividends − fees` holds exactly.

## Spec Change Log

### 2026-10-26 — Escalation resolution (intent gap, flow timing)
- TTWROR flow timing changed from "all flows at start of day" to "inflows at start, outflows at end" (`(V(d)+out)/(V(p)+in)`); skip when denominator ≤ 0 or numerator < 0, never reset. Reason: the start-of-day rule produced TTWROR −100 % or dropped gains on same-day SELL + WITHDRAWAL.
- XIRR keeps flows on booking date `d`; Design Notes' "same grid" claim reworded.
- Matrix: Full withdrawal row updated; liquidation down/up day and overdrawn rows added.
- Review patches carried into the contract/tasks: display-sized XIRR tolerance, wider bracket, core returns signed fee contribution, no `Divider` inside `<dl>`, page tests pin XIRR and guard slicing.
- Decided with the human; re-drive from scratch (saved patch not restored).

## Review Triage Log

### 2026-10-26 — Review pass
- attempted change saved as [spec-4-2-gain-loss-and-return-metrics.patch](spec-4-2-gain-loss-and-return-metrics.patch) (all `src/` changes since `ced6c9c095d5ea722ad96ca14c276350af333c28`); code reverted.
- verdicts: 29 findings — high 3, medium 1, low 15, false 10, maybe-false 0
- findings:
  - `[high]` `[intent_gap]` Blind: same-day SELL + WITHDRAWAL breaks TTWROR under the contract's start-of-day rule — verified by the formula: V(p) 1000 in positions, SELL at 990 and WITHDRAWAL 990 on day d → denominator 10 > 0, V(d) 0 → chain × 0, TTWROR −100 % for the whole Period (a Depot transfer or liquidation on a down day); on an up day the denominator is ≤ 0 and the day's gain is dropped. The rule sits inside `<intent-contract>` and no planning artifact fixes a flow-timing convention.
  - `[low]` `[intent_gap]` Blind: XIRR dates a flow on `d` while TTWROR treats it as start of `d` (end of `d−1`), contradicting the Design Notes' "same grid" claim — one-day discount shift; resolution depends on the same open timing convention.
  - `[false]` `[reject]` Blind: XIRR `null` for a Period whose flows all fall on one date — zero elapsed time has no annualised rate; `null` → "XIRR –" is the correct answer.
  - `[low]` `[reject]` Blind: total loss shows TTWROR −100 % but "XIRR –" — needs the whole Depot incl. cash at 0 €; special-casing −1 adds a branch for a case not met in everyday use.
  - `[low]` `[patch]` Blind: annualised XIRR beyond the 1e7 grid end returns `null` (confirmed by the verification-gap layer: 1-day +5 % → `null`) — only custom 1–2-day Periods reach it; fix is extending the grid list. Moot: intent_gap halts this pass.
  - `[low]` `[reject]` Blind: pill tone from the gain amount can contradict a negative TTWROR — the contract sets tone from the gain amount and every figure keeps its own sign; changing it edits this build's spec.
  - `[low]` `[patch]` Blind: `ValueSummary` negates `fees` with `ExactDecimal` (shell computes) — direct fix possible. Moot: intent_gap halts this pass.
  - `[low]` `[patch]` Blind: loss/archived/1J page tests do not pin the XIRR value (prefix or regex only) — test-only. Moot: intent_gap halts this pass.
  - `[low]` `[patch]` Blind: `heroHtml` slices with unchecked `indexOf`, so negative arrow assertions can pass vacuously — test-only. Moot: intent_gap halts this pass.
  - `[false]` `[reject]` Blind: hardcoded accordion ids collide with several `ValueSummary` on a page — exactly one `ValueSummary` renders per page today; no collision occurs.
  - `[false]` `[reject]` Blind: `xirr` returns an unconverged rate after `MAX_ITERATIONS` — the iteration is bisection-safeguarded inside a bracket ≤ 1e7 wide; 300 halvings shrink it far below the 1e-30 tolerance, so the loop exits converged.
  - `[low]` `[reject]` Blind: 5000 ms wall-clock bound in the perf test may flake — measured runtime is far below it; same convention as story 4.1's perf test.
  - `[false]` `[reject]` Blind: flows walked twice in `periodPerformance` — both sums go through the single `flowOf` definition; no divergence nameable.
  - `[low]` `[reject]` Blind: ledger test compares XIRR via `Number()` — test-only tolerance check, no production effect.
  - `[high]` `[intent_gap]` Edge: V(d) = 0 with a positive denominator pins the chain at 0 → TTWROR −100 % — same root as the first Blind row (liquidation day under the start-of-day rule).
  - `[low]` `[reject]` Edge: negative V(d) (cash overdrawn by FEE/TAX) flips the chain's sign — needs fees exceeding the whole Depot value; a guard adds a branch for a case not met in everyday use.
  - `[high]` `[intent_gap]` Edge: denominator ≤ 0 but V(d) ≠ 0 drops that day's gain — same root as the first Blind row.
  - `[low]` `[patch]` Edge: short Period's annualised root outside the grid → "XIRR –" — same root as the Blind grid row. Moot.
  - `[low]` `[reject]` Edge: two roots inside one grid interval → `null` — needs alternating-sign flow schedules rare for a Depot; subdividing adds complexity.
  - `[medium]` `[patch]` Edge: MAX with thousands of taxed dividends (each a flow date) makes XIRR take seconds per render (implementer measured ~430 ms for 400 flows) — tolerance 1e-30 is far tighter than the displayed 2 decimals; loosening it is a direct fix. Moot: intent_gap halts this pass.
  - `[false]` `[reject]` Edge: pill drops the TTWROR label when `ttwror` is `null` — the contract specifies "without TTWROR only the amount".
  - `[low]` `[patch]` Edge: `Divider` rendered as a bare `div` inside `<dl>` (invalid content model) — direct fix (split the list). Moot.
  - `[low]` `[patch]` Verification gap (other): solvable 1-day Periods return `null` because of the fixed grid — same root as the Blind grid row. Moot.
  - `[false]` `[reject]` Intent: expanding the accordion is not exercised in a browser — uncontrolled MUI Accordion; the collapsed button and the details markup are asserted; no defect.
  - `[false]` `[reject]` Intent: loss tone color not asserted — tone comes from `gainLossTone`, unit-tested; render-to-text tests cannot observe color.
  - `[false]` `[reject]` Intent: "taxes paid shown separately" read as excluded from the gain — matches AD-10 ("taxes shown separately") and FR12.
  - `[false]` `[reject]` Intent: every day chained rather than only between flows — mathematically equivalent; reviewer agrees.
  - `[low]` `[patch]` Intent: page pins concrete TTWROR/XIRR only in one scenario — same as the Blind page-test row. Moot.
  - `[false]` `[reject]` Intent: Portfolio scope and Parqet `realizedgains` match (FR12 whole) — the story's AC names the Depot page; Portfolio is story 4.4.

### 2026-10-26 — Review pass
- verdicts: 27 findings — high 0, medium 0, low 18, false 7, maybe-false 2
- findings:
  - `[low]` `[reject]` Blind: XIRR of 1–2-day Periods is huge and unlabelled ("p. a." missing) — the contract fixes the text `XIRR +10,87 %` and requires solvable 1–2-day Periods not to be null; a label or minimum-length guard edits this build's spec.
  - `[low]` `[reject]` Blind: "Steuern gezahlt +9,00 €" sign convention reads as a gain — the contract says taxesPaid as `periodFlows` with signed formatting; changing it edits this build's spec.
  - `[false]` `[reject]` Blind: collapsed-accordion regex can match an earlier `aria-expanded="false"` button; `<dl>` count page-wide — the only other expandable buttons (ColorModeToggle, PositionsTable) render `aria-expanded` as undefined when closed, so no earlier match exists; a new `<dl>` would make the count fail loudly, not pass vacuously.
  - `[low]` `[patch]` Blind: "Nothing invested" (null TTWROR/XIRR) never rendered at page level — same root as the verification-gap row; page test added asserting `0,00 € XIRR –`, no TTWROR, no arrow.
  - `[low]` `[reject]` Blind: overdrawn day skipped makes TTWROR 0 while gain is negative — contract-mandated skip rule (matrix row "Overdrawn"); changing it edits this build's spec.
  - `[low]` `[reject]` Blind: realized (since purchase) vs. unrealized (since start) looks odd in short Periods — the split is defined that way by the contract and the identity holds; a caption edits the spec's UI text.
  - `[false]` `[reject]` carried — Blind: hardcoded accordion ids collide with several `ValueSummary` on a page — exactly one `ValueSummary` renders per page today; no collision occurs.
  - `[low]` `[patch]` Blind: `xirr` may return an unconverged rate; docstring "nearest to 0 wins" is wrong — the docstring misstates the alternating-by-index bracket search: comment corrected; the unconverged part is maybe-false (Newton is bisection-safeguarded within the bracket; non-convergence in 200 steps not shown) and would only be low.
  - `[low]` `[reject]` Blind: second full-history FIFO pass per render — measured runtime is small (3-year daily perf test well under bound); merging passes is a refactor, not a direct fix.
  - `[low]` `[reject]` carried — Blind: ledger test compares XIRR via `Number()` — test-only tolerance check, no production effect.
  - `[false]` `[reject]` Blind: unused `PeriodPerformance` re-export in `ledger/index.ts` — it is the type of the exported `DepotValuation.performance`; exporting it beside `DepotValuation` follows the barrel pattern; no harm nameable.
  - `[low]` `[reject]` carried — Blind: wall-clock bounds in perf tests may flake — measured runtime is far below them; same convention as story 4.1's perf test.
  - `[low]` `[patch]` Edge: LEFT_GRID stopped at 1+r = 1e-10, so a 1-day loss beyond ≈ −6 % returned null — grid extended down to 1+r = 1e-38; convergence near −1 now measured relative to 1+r (the new −10 % test exposed early stopping); core test added.
  - `[low]` `[reject]` Edge: numerator 0 with denominator > 0 pins the chain at 0 (−100 %) — contract multiplies when `numerator ≥ 0`; a total loss of the whole Depot incl. cash is the intended −100 %; changing it edits this build's spec.
  - `[low]` `[reject]` Edge: astronomically large XIRR text overflows the hero on phones — only custom 1–2-day Periods reach it; a cap/hide guard adds a branch the contract does not ask for.
  - `[maybe-false]` `[reject]` Edge: unconverged rate returned after MAX_ITERATIONS — would need a sum-of-exponentials NPV where safeguarded Newton neither converges nor shrinks the bracket within 200 steps; if true only low (displayed rate slightly off).
  - `[low]` `[patch]` Edge: right grid scanned first, so a far positive root can win over a nearer negative one, against the docstring — same root as the Blind docstring row; docstring corrected (the contract does not constrain root choice).
  - `[low]` `[patch]` Verification gap: "XIRR –" for a nothing-invested Period not checked where it renders — page test added (Deposit + full Withdrawal in 2025, Period 2026-01).
  - `[low]` `[patch]` Intent: `BreakdownRow` `div` sat directly inside `<dl>` (literal reading of the contract's markup rule) — rows now render `dt`/`dd` directly in a two-column grid `dl`; page test fails on any non-`dt`/`dd` child.
  - `[false]` `[reject]` Intent: core returns both `fees` (positive) and `feesContribution` — satisfies both the matrix ("fees 3") and the UI rule (core returns the signed contribution); no defect.
  - `[low]` `[reject]` Intent: tax shown as positive amount paid — same as the Blind tax-sign row; contract-defined.
  - `[false]` `[reject]` Intent: `−tax` on DEPOSIT/WITHDRAWAL would break the identity — `src/modules/ledger/transactions.ts:244` rejects a non-zero tax on DEPOSIT/WITHDRAWAL, so such rows cannot exist.
  - `[low]` `[patch]` Intent: nearest-root docstring — same root as the Blind docstring row; corrected.
  - `[false]` `[reject]` Intent: up-day liquidation and overdrawn tested on hand-made points, not a real series — `ttwror` is the unit the rows specify; the down-day liquidation also runs through `valuationSeries`; no bad outcome claimed.
  - `[maybe-false]` `[reject]` Intent: `from > to` branch in `depotValuation` untested — `resolvePeriod` rejects custom `from > to` (`src/core/period.ts:35`); reachability via MAX unproven; if true only low (defensive branch).
  - `[false]` `[reject]` carried-style — Intent: 44 px summary height and neutral color not asserted — render-to-text tests cannot observe styles; `minHeight: 44` and no color prop are in the code.
  - `[low]` `[patch]` Intent: "Nothing invested" UI only via helpers — same root as the verification-gap row; page test added.

## Design Notes

Why inflows at start, outflows at end: the first Deposit day has `V(prev) = 0`; counting the inflow in the denominator gives a defined return. Counting outflows at the end keeps a same-day SELL + WITHDRAWAL (Depot transfer, closing) measured against the full prior value, so the day's real move counts instead of collapsing the chain to 0 or dropping the day. XIRR keeps flows on their booking date (standard XIRR practice); it uses the same start date, so with no flows both metrics describe the same growth (`(1+x)^(n/365) = 1+TTWROR`). With flows they may differ by the one-day timing — accepted.

Identity derivation (why fees = FEE + DIVIDEND fees): ΔV − flows = ΔPositionsValue + Σ internal cash effects; ΔPositionsValue = ΔU + ΔInvested; buys add `amount+fee` to Invested and remove it from cash, sells remove consumed Cost Basis from Invested and add `amount − fee` → realized; what remains is dividend `amount`, minus dividend fees and FEE rows.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Story 4.2 adds Period performance to the Depot detail page. Pure `src/core/returns.ts` derives Gain/Loss (ΔV − net external flows), its split (realized, unrealized, dividends, fees; taxes separate, exact identity), TTWROR (inflows at start, outflows at end of day, skip-not-reset) and XIRR (generic safeguarded Newton/bisection solver, 40-digit decimal clone, tolerance 1e-12, bracket up to 1e100 and down to 1+r = 1e-38). `depotValuation` computes one series from the day before `from` and returns `start` + `performance`; the hero card shows the gain/loss pill with TTWROR, XIRR beside it and a collapsed "Aufschlüsselung".

**Files changed:**
- `src/core/returns.ts` — new: externalFlow, ttwror, xirr, periodPerformance.
- `src/core/returns.test.ts` — new: every matrix row, identity on a mixed fixture, solver and performance tests.
- `src/core/dates.ts` / `dates.test.ts` — `daysBetween` helper.
- `src/modules/ledger/valuation.ts` / `valuation.test.ts` / `index.ts` — `start` + `performance` from one series; reference scenario through the DB.
- `src/app/_components/positions/GainLossPill.tsx` / test — optional `ratioLabel` ("TTWROR").
- `src/app/_components/valuation/ValueSummary.tsx` / new test — pill + XIRR line + breakdown accordion (two grid `<dl>`s around the separator).
- `src/app/(app)/depots/[id]/page.tsx` / `page.test.tsx` — pass performance; page tests for gain, loss, 1J, archived, nothing invested; exact XIRR pinned; guarded hero slicing.

**Review findings:** 27 — patches applied 9 rows in 5 entries (all low): nothing-invested page test, LEFT_GRID extended towards −1 with convergence relative to 1+r, XIRR docstring corrected, `dt`/`dd` directly inside `<dl>`. Deferred: none. Rejected: 18 rows (reasons in the Review Triage Log: contract-defined behaviour, false claims, carried rows, maybe-false low).

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 0, low 5 entries.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (121 files, 1706 tests) after patches.

**Residual risks:** XIRR for 1–2-day custom Periods annualises to very large or near −100 % values (contract-defined, unlabelled); wall-clock bounds in two perf tests; TTWROR skips overdrawn days by design.
