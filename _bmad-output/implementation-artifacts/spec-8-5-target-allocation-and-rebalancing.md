---
title: 'Story 8.5: Target Allocation and Rebalancing'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
deferred: []
baseline_revision: 'dc7369ceb4b1cb9e2ca61c947f25b9e8d38fe9e4'
---

<intent-contract>

## Intent

**Problem:** Tommy has no way to state a robo-advisor-style target mix (equity regions plus asset classes) and see how far his Portfolio or a Depot is off, nor concrete, tax-aware trades to get back on target.

**Approach:** A new tab Analysen › "Zielallokation" (scope Portfolio or one Depot) stores target percentages and a threshold per scope (new `rebalancing` module, exported/restored), maps every holding and cash balance to ten segments with a pure core function (funds via their region split, story 8.4), and builds an advisory proposal — deposit distribution, buys, and sells chosen lowest-tax-first, each sale's gain and tax estimated with the story 8.3 `taxPreview` — all pure core functions. Nothing is booked.

## Boundaries & Constraints

**Always:**
- Segments, in this order (keys / German labels): `equityUsa` Aktien USA, `equityEurope` Aktien Europa, `equityJapan` Aktien Japan, `equityPacificExJapan` Aktien Pazifik ohne Japan, `equityEmerging` Aktien Schwellenländer, `bonds` Anleihen, `commodities` Gold/Rohstoffe, `realEstate` Immobilien, `crypto` Krypto, `cash` Geldmarkt/Cash.
- Mapping (effective classification, manual wins, read only via `@/modules/classification`): type `CRYPTO` or asset class Krypto → crypto; Geldmarkt → cash; every cash balance → cash; Anleihen → bonds; Rohstoffe → commodities; Immobilien → realEstate; Aktien → by region: an effective split distributes the value (`distributeByRegion`; USA/Europa/Japan/Pazifik ohne Japan/Schwellenländer to the matching segment, Sonstige → unassigned); otherwise the single region: USA and Nordamerika → equityUsa, Europa → equityEurope, Asien-Pazifik → equityJapan if the country is "Japan" else equityPacificExJapan, Schwellenländer → equityEmerging, Welt/unknown → unassigned. Every other asset class (Gemischt, Derivate, unknown) → unassigned.
- Segment values + unassigned = scope value exactly (positions with a price + cash, same values as the Aufteilung tab). Shares, targets and trades refer to the **assignable** value (scope value − unassigned); unassigned holdings are listed, never traded.
- Targets: percent per segment (empty = 0), each ≥ 0, ≤ 100, ≤ 2 decimals, sum exactly 100; threshold in points (default `2`), ≥ 0, ≤ 100, ≤ 2 decimals. Stored per scope (`portfolio` or a Depot id); validated completely before any write.
- Deposit D (optional, ≥ 0, ≤ 2 decimals) is distributed greedily to the segments with the largest deficit `target% × (A + D) − actual` first (ties in segment order), each up to its deficit, until D is used.
- After the deposit, a segment whose deviation `(actual + deposit share)/(A + D) × 100 − target%` has an absolute value below the threshold is "im Rahmen": no rebalancing trade (it still gets its deposit share). Out-of-range segments trade to exactly `target% × (A + D)`. Trade amounts are rounded half-up to cents; a 0,00 € trade is no trade.
- Buy instrument = the largest holding (slice value) of that segment in scope — a Security, or the cash balance ("Als Guthaben halten"); none → "Kein Bestand".
- Sells: candidates are the segment's holding slices (Security per Depot, capped at the slice value; cash slices of the cash segment). Repeatedly take the candidate whose next FIFO lot has the lowest taxable gain ratio `(price − lot cost per unit) / price × (1 − Teilfreistellung)` (losses first, then cash at 0, then small gains), up to the remaining need, the slice, and the lot. A holding sold in two segments consumes its lots across both. Quantity = amount / price rounded half-up to 6 decimals, capped at the remaining quantity.
- Each Security sale's gain and tax come from appending a hypothetical SELL row (today, after the Depot's last sequence, fee 0, tax 0) to that Depot's ledger rows: gain from `fifo`, tax = increase of today's-year `estimated` for that broker in `taxPreview` versus the same input without this sale (sales applied cumulatively in proposal order, so allowance left and loss pots are respected and the per-sale taxes sum to the proposal total). Cash "sales" have gain 0 and tax 0. All Depots of the broker (archived included) feed the tax input.
- Money as decimal strings via `decimal.js`; `src/core` pure; UI German, de-DE formats, touch targets ≥ 44 px, signed amounts shown with sign/label (never colour alone). Everything labelled as an estimate/advice; nothing booked.

**Never:**
- Booking trades, writing ledger rows, storing proposals or results.
- Changing the tax rules of `core/tax`, the Aufteilung tab or the region-split rules.
- Choosing instruments the scope does not hold; fractional-share or broker minimum rules; trading unassigned holdings.
- Editing committed migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mapping | World ETF 1.000 € (rule split 72/15/6/4/–/3), US stock 500 €, bond ETF 300 €, cash 200 € | USA 1.220, Europa 150, Japan 60, Pazifik 40, Anleihen 300, Cash 200; unassigned 30 (Sonstige); A = 1.970; sum 2.000 | — |
| Single region | stock Asien-Pazifik/Japan; stock Asien-Pazifik/Australien; stock Nordamerika; stock region null; certificate Derivate | Japan; Pazifik ohne Japan; USA; unassigned; unassigned | — |
| Deposit | A 1.000 (USA 700, Europa 300), targets USA 50 / Europa 50, D 1.000 | deficits on 2.000: Europa 700, USA 300 → Europa gets 700, USA 300 | — |
| Threshold | A 1.000: USA 610, Europa 390; targets 60/40, threshold 2 | both im Rahmen (1 point); no trades | — |
| Rebalance | A 1.000: USA 700, Europa 300; targets 50/50; no deposit | sell 200 USA, buy 200 Europa (largest Europa holding) | — |
| Lot order | USA holdings: stock A lot gain ratio +20 %, stock B lot −10 %; sell 150 € | sells B first (loss) up to its slice, then A | — |
| Tax | comdirect allowance 100, sale gain 300 (stock), no other income this year | gain 300, tax = 25 % × 200 + Soli = 52,75 | — |
| Teilfreistellung | equity fund gain 1.000, allowance 0 | taxable 700 → tax 184,63 (175 + 9,63) | — |
| No targets | scope without stored targets | table shows actual €/% only, proposal "Noch keine Zielallokation gespeichert." | — |
| Invalid targets | sum 99,5; a negative, non-numeric or 3-decimal value; threshold invalid | `{ok:false, reason:"target-sum"}` / `"target-invalid"` (with segment) / `"threshold-invalid"`; nothing written | German error |
| Invalid deposit | `?deposit=abc` or negative | treated as 0 and a German hint "Ungültiger Betrag" | — |
| Old export | schema-4 file | upgrades to 5 with `targetAllocations: []` | — |

</intent-contract>

## Code Map

- `src/core/tax.ts` -- `taxPreview(input)` → `TaxYear[]` newest first (`years[0]` = today's year), per broker `estimated`; `TaxPreviewInput.depots: {broker, rows: GainsRow[]}[]`, `securities: Record<id, TaxSecurity>` (`category`, `teilfreistellung`). Reuse unchanged; pass only the selling Depot's broker's depots to keep it cheap.
- `src/core/fifo.ts` -- `fifo(rows, asOf, actions)` → `{securityId, lots: {quantity, costBasis}[], sales: {sequence, gain}[]}`; lots in FIFO order (units beyond lots carry zero cost: treat a missing remainder as a zero-cost lot). `GainsRow = FifoRow & {tax}` in `src/core/gains-analysis.ts`.
- `src/core/region-split.ts` -- `SPLIT_REGIONS`, `RegionWeights`, `distributeByRegion` (slices sum exactly). `src/core/classification.ts` -- `Classification` (`type`, `assetClass.value`, `region.value`, `country.value`), `ASSET_CLASSES`, `REGIONS` (`Welt, Europa, USA, Nordamerika, Asien-Pazifik, Schwellenländer`); country label "Japan".
- `src/core/decimal.ts` `ExactDecimal`, `canonicalDecimal`, `isDecimalString`; `src/core/decimal-input.ts` `parseDecimalInput` (de-DE); `src/core/format.ts` `formatMoney`, `formatShare`, `formatPercentagePoints`, `formatQuantity`.
- `src/modules/tax/preview.ts` -- `taxPreviewInput()` drops `depotId`; keep it (`depots: {depotId, broker, rows}`) so the proposal can append rows per Depot (`taxLedgerInput` already has it).
- `src/modules/classification/index.ts` -- `listClassifications()`, `listRegionSplits()` (`Record<id, {effective: {weights} | null}>`). `src/modules/tax/settings.ts` -- validate-then-upsert pattern, typed `{ok:false, reason}`; `backup.ts` -- module export/replace model.
- `prisma/schema.prisma` (TaxAllowance model style, `/// UTC ISO timestamp` comment); latest migration `20261030000000_add_region_split` (header-comment style).
- `src/modules/backup/schema.ts` (`EXPORT_SCHEMA_VERSION = 4`, `exportFileSchema`), `upgrade.ts` `UPGRADES`, `export.ts:49`, `restore.ts:129,146`, `consistency.ts:50,113-119`, `index.ts`. Version-pinned tests: `src/modules/backup/{upgrade,export,restore,consistency}.test.ts`, `src/app/api/export/route.test.ts`, `src/app/_actions/backup.test.ts`, `src/app/_components/backup/{ExportButton,RestoreButton}.dom.test.tsx`, `test/helpers/backup-seed.ts`. Settings page "Datensicherung" text lists exported data (`src/app/(app)/settings/page.tsx`).
- `src/app/(app)/analyses/page.tsx` -- panel functions (`allocationPanel` loads positions with `latestStoredPrices`, `compositionHoldings`, cash balances via `depot.cashBalance`), tab ternary; `searchParams` type. `src/app/_components/analyses/labels.ts` `ANALYSIS_TABS`, `analysisHref`; `AnalysisFilters.tsx` (dimension only on allocation; Bereich shown). Tests: `page.test.tsx` (module mocks via `vi.hoisted`), `labels.test.ts`, `AnalysisFilters.dom.test.tsx`.
- `src/app/_actions/tax.ts` + `src/app/_components/tax/{AllowanceForm.tsx, TaxView.tsx, labels.ts}` -- `useActionState` form, session check, `revalidatePath`, table/card layout, scope hint, signed amounts.

## Tasks & Acceptance

**Execution:**
- `src/core/rebalancing.ts` (+ `rebalancing.test.ts`) -- `SEGMENTS`, `type Segment`; `segmentSlices(value, classification-like {type, assetClass, region, country}, split | null) → {segment: Segment | null, value, weight}[]`; `parseTargets(targets: Partial<Record<Segment, unknown>>, threshold: unknown) → {ok:true, targets: Record<Segment,string>, threshold} | {ok:false, reason, segment?}`; `distributeDeposit(actual, targets, deposit)`; `rebalancing(input)` → `{total, assignable, unassigned: {value, holdings}, segments: SegmentRow[], proposal: null | {deposit, buys, sells, inRange, totalBuys, totalSells, totalTax, cashLeft}}` where `cashLeft = deposit + totalSells − totalBuys`. Every matrix row except UI/backup rows is a hand-calculated test, plus lot sharing across two segments and a sale whose loss lowers the tax (negative tax).
- `src/modules/tax/preview.ts` (+ test) -- keep `depotId` on depots.
- `prisma/schema.prisma` + `prisma/migrations/20261031000000_add_target_allocation/migration.sql` -- `TargetAllocation {id, scope String @unique, weights String (JSON segment→percent, non-zero only), threshold String, updatedAt String}` (comment: owned by rebalancing, story 8.5; scope `portfolio` or a Depot id, no FK). Run `npx prisma generate`.
- `src/modules/rebalancing/{targets.ts, backup.ts, index.ts}` (+ tests on a test DB) -- `getTargetAllocation(scope) → {targets, threshold} | null`; `setTargetAllocation(scope, targets, threshold)` (scope `portfolio` or an existing Depot via `@/modules/ledger`, else `scope-not-found`; `parseTargets`; upsert); `exportTargetAllocations()` (only rows whose scope is `portfolio` or an existing Depot) / `replaceAllTargetAllocations(records, tx)`.
- `src/modules/backup/{schema,upgrade,export,restore,consistency,index}.ts` + every version-pinned test and `test/helpers/backup-seed.ts` -- version 5, `targetAllocations: [{id, scope, weights: {segment: decimal}, threshold}]` after `teilfreistellungOverrides`; upgrade step 4 adds `[]`; consistency: ids, unique scope, scope is `portfolio` or a Depot id, weights valid and sum 100; restore writes after the tax settings and logs the count; a 4→5 upgrade test and an export/restore round trip.
- `src/app/_actions/rebalancing.ts` (+ test) -- `setTargetAllocationAction` reads `scope`, `target-<segment>`, `threshold`; session check; revalidates `/analyses`.
- `src/app/_components/rebalancing/{labels.ts, TargetForm.tsx, TargetAllocationView.tsx}` (+ dom tests) -- form with ten `%` fields (prefilled), live "Summe: x %", threshold field "Schwelle (Prozentpunkte)", "Speichern", "Gespeichert.", German errors (`target-sum`: "Die Zielwerte müssen zusammen 100 % ergeben."); table Segment | Ist | Ist % | Ziel % | Abweichung (Pkt.) | Abweichung (€) with "im Rahmen" chip, a "Nicht zugeordnet" row listing its holdings when > 0, and a "Summe" row = scope value; GET form "Neue Einzahlung" (`deposit`, keeps `tab`/`scope`) with "Berechnen"; "Rebalancing-Vorschlag": Käufe (segment, amount, instrument), Verkäufe (segment, Security/Guthaben, Depot, quantity, amount, "geschätzter Gewinn", "geschätzte Steuer"), "Im Rahmen" segments, totals (Käufe, Verkäufe, geschätzte Steuer gesamt, Saldo Guthaben), hint "Vorschlag – es wird nichts gebucht. Steuern geschätzt nach Freistellungsauftrag und Verlusttöpfen (siehe Analysen › Steuern)."
- `src/app/_components/analyses/{labels.ts, AnalysisFilters.tsx}`, `src/app/(app)/analyses/page.tsx` (+ tests) -- tab `{value:"targets", label:"Zielallokation"}` after Steuern; Bereich shown; `targetsPanel` loads positions (stored prices), cash, classifications, region splits, tax input, targets and `?deposit=` and renders the view.
- `src/app/(app)/settings/page.tsx` (+ test) -- Datensicherung text also lists "Zielallokationen".

**Acceptance Criteria:**
- Given Analysen › Zielallokation for the Portfolio, when Tommy saves targets summing to 100 % and a threshold, then they are stored for that scope, shown again after reload, and a Depot scope keeps its own targets.
- Given an MSCI World ETF, a US stock, a bond ETF and cash, when he opens the tab, then the table shows each segment's actual €, actual %, target %, deviation in points and €, "im Rahmen" where within the threshold, and the rows plus "Nicht zugeordnet" sum to the scope value.
- Given a "Neue Einzahlung" and overweight segments, when he presses "Berechnen", then the proposal lists buys (with instrument) and sells (lowest tax first, each with estimated gain and tax) and the total tax; nothing is booked.
- Given an export with target allocations, when restored, then they are back; a schema-4 file restores with none.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 28 findings — high 0, medium 1, low 21, false 6, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: a proposal can sell a multi-region fund in one segment and suggest it as the buy instrument of another (World ETF sold for USA, bought for Europa; page test) — fixed: the buy row shows "Wird in diesem Vorschlag auch verkauft – Kauf und Verkauf gegeneinander aufrechnen."; DOM test added (both rules are the story's literal instrument and lot rules, so a hint rather than a new selection rule).
  - `[low]` `[reject]` Blind: table "im Rahmen" (before deposit, on A) can differ from the proposal's in-range list (after deposit) — by design: the table shows the current state, the proposal its own basis; aligning them needs a second set of columns.
  - `[low]` `[patch]` Blind: cash buy without a positive cash balance showed "Kein Bestand" — fixed: the cash segment falls back to "Als Guthaben halten"; test expectation updated.
  - `[low]` `[patch]` Blind: the uncontrolled deposit field kept a stale amount after a scope change — fixed with `key={scope|depositText}`.
  - `[false]` `[reject]` Blind: export copies invalid stored weights — rows are written only by `setTargetAllocation` and restore, both validated through `parseTargets`/the export schema; unreachable.
  - `[low]` `[reject]` Blind: positions without a price are left out silently — same rule as the Aufteilung tab and composition card ("same values as the Aufteilung tab"); a hint is new UI scope.
  - `[low]` `[reject]` Blind: a fund sold in two segments gives two sell rows; 6-decimal rounding of each — rare (needs two overweight regions of one fund); merging rows adds aggregation logic; rounding error ≤ 1e-6 units.
  - `[low]` `[reject]` Blind: tax estimate reruns fifo/taxPreview per sale — single user, few sales per proposal, only the selling broker's Depots; measured page tests are fast.
  - `[false]` `[reject]` Blind: a sale whose Depot is missing from the tax input shows gain/tax 0 — `taxLedgerInput` loads every Depot (archived included), so every scope Depot is present.
  - `[low]` `[reject]` Blind: "portfolio" scope string defined in three places — all equal `"portfolio"`, page test exercises the Portfolio path end to end through the mocks; no change planned.
  - `[low]` `[reject]` Blind: Depot targets orphaned on Depot delete, archived Depots keep theirs — harmless by design (no FK; export filters orphans; archived Depots are not a scope).
  - `[low]` `[reject]` Blind: "Gespeichert." stays after further edits — same pattern as the 8.3 AllowanceForm; cosmetic.
  - `[low]` `[reject]` Blind: missing tests for overdrawn cash, unmet sell need, two brokers, negative tax in the view — unmet need is unreachable beyond half a cent (positive slices ≥ segment value); same-broker multi-Depot test added under the verification-gap row; the rest are unlikely edge cases.
  - `[low]` `[patch]` Edge: a piece whose quantity rounds to 0 at 6 decimals was listed as a 0-unit sale — fixed: such pieces produce no sell row; core test added.
  - `[low]` `[patch]` Edge: that 0-unit SELL made `estimateTaxes` count its whole amount as gain — same root cause, fixed by the same skip.
  - `[false]` `[reject]` Edge: export with invalid weights fails — duplicate of the Blind row; unreachable for the same reason.
  - `[low]` `[patch]` Edge: empty zero-target segments got an "im Rahmen" chip in the table while the proposal excludes them — fixed: `inRange` null for target 0 and value 0; test adjusted.
  - `[low]` `[reject]` Edge: negative assignable value (overdraft larger than holdings) flips shares — not a realistic Depot state; a guard adds a branch.
  - `[false]` `[reject]` Edge: `takeSells` shortfall when candidates run out — lots always cover the holding (zero-cost remainder lot) and positive slices sum to at least the segment value, so the need is met up to half a cent of rounding.
  - `[low]` `[patch]` Verification gap: Teilfreistellung never changes the sell order in a test — added: fund 0.20 × 0.7 = 0.14 sold before a stock at 0.15.
  - `[low]` `[patch]` Verification gap: no test with two Depots of the same broker — added: d2's realized gain uses up the allowance, the d1 sale's gain comes from d1's lots (300) and its tax rises to 79,13.
  - `[low]` `[patch]` Verification gap: zero-cost remainder lot untested — added: units beyond the FIFO lots are sold last and the sells reach the trade.
  - `[low]` `[patch]` Verification gap (other): table vs proposal "im Rahmen" for empty zero-target segments — same root cause as the Edge row; fixed there.
  - `[low]` `[reject]` Intent: no cross-layer test save → reload → page — layered tests are the project's pattern (module test on a DB for storage per scope, page test for the panel wiring), as in 8.3/8.4.
  - `[false]` `[reject]` Intent: percentages on the assignable value instead of the scope value — the intent contract and Design Notes decide this; the table rows plus "Nicht zugeordnet" sum to the scope value as CAP-26 requires.
  - `[low]` `[reject]` Intent: the deposit share is merged into each segment's buy, not shown separately — the AC asks for buys per segment; a breakdown is extra UI.
  - `[low]` `[reject]` Intent: an in-range segment can still receive its deposit share — the AC distributes the deposit to the most underweight segments first; "no trade" refers to rebalancing trades (intent contract).
  - `[false]` `[reject]` Intent: lot ranking by taxable gain ratio is only a proxy for lowest tax — for a fixed sell amount the greedy ratio order minimizes taxable gain (fractional-knapsack optimal) and so the tax, including allowance use; the reported tax comes from `taxPreview`.

## Design Notes

- **Assignable basis.** Sonstige split shares (Canada, Israel …), Welt funds without split and mixed/derivative/unknown holdings fit no segment. Counting them in the basis would make buys exceed sells by their value; so percentages and trades use the assignable value and the table shows them as "Nicht zugeordnet" (fix via the Securities page).
- **Threshold is literal**: in-range segments do not trade, so buys and sells need not balance; the difference appears as "Saldo Guthaben" (stays as / comes from cash).
- **Segment trades are approximate for multi-region funds** (buying a World ETF for "Aktien USA" adds only its US share); the instrument is a suggestion, as the story states.
- **Tax by difference** keeps AD-21 (one function): `estimated(with sales 1..i) − estimated(with sales 1..i−1)` for the broker and today's year.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass (with a throwaway `DATABASE_URL`).

## Auto Run Result

Status: done

**Summary:** New tab Analysen › "Zielallokation" (scope Portfolio or one Depot). Targets for ten segments and a threshold (default 2 points) are stored per scope by the new `rebalancing` module and included in export/restore (schema version 5, upgrade 4→5). A pure core function maps holdings and cash to segments (funds by region split, story 8.4; unassignable parts shown as "Nicht zugeordnet"), builds the segment table, distributes a "Neue Einzahlung" to the largest deficits, and proposes buys (largest holding as instrument) and sells (lowest taxable gain ratio first, FIFO lots shared across segments), each sale with estimated gain (`fifo`) and tax (difference of `taxPreview`, story 8.3). Nothing is booked.

**Files changed:**
- `src/core/rebalancing.ts` (+ test) -- segments, mapping, target validation, deposit distribution, proposal with lot selection and tax estimates.
- `src/modules/tax/preview.ts` (+ test) -- keeps `depotId` per Depot.
- `prisma/schema.prisma`, `prisma/migrations/20261031000000_add_target_allocation/` -- `TargetAllocation` table.
- `src/modules/rebalancing/{targets,backup,index}.ts` (+ test) -- read/save targets per scope, export/replace.
- `src/modules/backup/{schema,upgrade,export,restore,consistency,index}.ts` (+ tests), `test/helpers/backup-seed.ts`, `src/app/api/export/route.test.ts`, `src/app/_actions/backup.test.ts` -- schema version 5 with `targetAllocations`.
- `src/app/_actions/rebalancing.ts` (+ test) -- `setTargetAllocationAction`.
- `src/app/_components/rebalancing/{labels.ts, TargetForm.tsx, TargetAllocationView.tsx}` (+ tests) -- form, segment table, deposit form, proposal.
- `src/app/_components/analyses/{labels.ts, AnalysisFilters.tsx}`, `src/app/(app)/analyses/page.tsx` (+ tests) -- tab and `targetsPanel`.
- `src/app/(app)/settings/page.tsx` (+ test) -- Datensicherung text lists "Zielallokationen".

**Review:** 28 findings; patched 1 medium (buy instrument also sold → hint) and 9 low rows (cash-buy fallback, stale deposit field, 0-unit sales, "im Rahmen" for empty zero-target segments, three missing tests; duplicates included); deferred none; rejected 12 low and 6 false with reasons in the triage log.

**Follow-up review recommendation:** false (patched: high 0, medium 1, low 9).

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all pass (229 files, 3075 tests) against a throwaway DATABASE_URL.

**Residual risks:** segment trades for multi-region funds are approximate (instrument is a suggestion); the threshold rule can leave buys and sells unbalanced (shown as "Saldo Guthaben"); not exercised in a running browser (component and page tests only).
