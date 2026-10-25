---
title: 'Missing Deposits and Fee-Aware Gain Comparison in the Parqet Migration (story 2-8)'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '40f336d3925c030ef8b62a097d3651d59d4b7fb0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The summary's "Parqet" cash figure is the proposals' balance minus funding, not the literal sum of the file's Cash rows, so a trade without any Cash row at its instant is hidden from the cash comparison.
    evidence: |-
      confirm.ts derives the file figure from preview.figures.cashBalance (proposals) minus the funding total; the explanation check reduces to |ledger − proposals' balance|. Story 2.7 already compared against the proposals' balance (pre-existing), and its deferred item "trade with no cash row gets no difference TAX" is the same gap. Settle with the operator's real-data migration (story 2.4): compare the summary's Parqet figure with Parqet's displayed balance.
    location: >-
      src/modules/migration/confirm.ts (cash comparison)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Story 2.7 books inflow-side group differences (cash rows show less going out / more coming in than the trades, e.g. a savings contribution invested directly) as negative TAX "refunds"; files with Cash rows get no funding, so the migrated Cash Account can go negative (Parqet's rows lack deposits); and the per-sale gain check reports every sale as a deviation by exactly its fees, because the ledger's FIFO gain deducts fees and Parqet's `realizedgains` does not.

**Approach:** The group reconciliation classifies a difference > €0.01 as inflow (→ one DEPOSIT before the group's trades) or outflow (→ positive TAX after them, as in 2.7); the reader applies minimal funding to every export; a pure core function attributes fees per sale (sell fee + consumed share of buy fees) and the summary labels fee-only gain differences "Gebühren" and the cash comparison explains missing deposits.

## Boundaries & Constraints

**Always:**
- `reconcileCashGroup` (`src/modules/migration/cash-groups.ts`): `difference = derived − cash` as today. |difference| ≤ 0.01 → `align` (unchanged). difference > 0.01 → `{ kind: "tax", tax: difference, securityKey }` (unchanged rule for the key). difference < −0.01 → `{ kind: "deposit", amount: −difference }` (canonical, > 0).
- Reader: a `deposit` result becomes one DEPOSIT proposal (amount = that, fee/tax "0", `securityKey` null, `records` = sorted union of the set's trade and cash records, marker `cashDifference: true`) placed at the set's chronologically FIRST leftover trade and pushed into `pending` before the trades so the stable sort sequences it directly before them. TAX results unchanged (positive tax only now).
- Funding (`withFunding`, core `fundingShortfalls`) runs for every export, with or without Cash rows, after the rounding clamp. Update the `funding` / `fundingCount` doc comments accordingly.
- Preview (`ParqetPreview`): `cashDifferenceCount`/`cashDifferenceTotal` count only `cashDifference` TAX proposals (Σ tax). New `missingDepositCount`/`missingDepositTotal` (canonical, "0" without) = `cashDifference` DEPOSITs plus, when the file has Cash rows, funding DEPOSITs. `fundingCount` = all funding DEPOSITs. Wizard notes (Alert `info`, only when count > 0, near the existing notes): `N fehlende Einzahlungen ergänzt (Summe <formatMoney>)` (N = 1: "1 fehlende Einzahlung ergänzt (…)") and `N Kontodifferenzen als Steuer gebucht (Summe …)` (N = 1: "1 Kontodifferenz als Steuer gebucht (…)"); the cash-less `fundingNote` stays as is.
- `src/core/fee-attribution.ts` (pure, core imports only): `saleFees(rows: FifoRow[], asOf, actions): Map<string, string>` keyed `` `${date}|${sequence}` `` per SELL = FIFO gain with every fee set to "0" minus FIFO gain with fees (i.e. sell fee + pro-rata buy fees of the consumed lots, through splits and ISIN changes). `classifyGainDifference(ledgerGain, fileGain, fees, tolerance = "0.01"): "equal" | "fees" | "deviation"`: |file − ledger| ≤ tol → equal; else |(file − ledger) − fees| ≤ tol → fees; else deviation.
- `listRealizedSales` (ledger `positions.ts`) adds `fees` to `RealizedSaleRecord` via `saleFees`.
- Summary: `Figure` gains optional `explained?: "fees" | "missing-deposits"`; an explained figure has `mismatch: false`. `SaleComparison.gain` is `explained: "fees"` when `classifyGainDifference` says fees. With Cash rows: `comparison.cash.file` = Parqet's own balance = preview cash balance minus the funding DEPOSITs' total; when funding was added and |ledger − file − fundingTotal| ≤ 0.01 → `explained: "missing-deposits"`. `MigrationSummary.funding: { count, total }` (count 0, total "0" without). `openingBalance` is offered when the file has no Cash rows OR funding was added.
- Summary view: the status cell shows "Gebühren" / "fehlende Einzahlungen" (secondary text, no warning icon) for explained figures; when the file has Cash rows and `funding.count > 0` an info Alert under the totals: "Parqet fehlen Einzahlungen: N ergänzte Einzahlungen (Summe …) erklären die Differenz." (N = 1: "1 ergänzte Einzahlung (Summe …) erklärt die Differenz."). Label helpers in `labels.ts`.

**Never:**
- No change to trade quantity/price/amount/fee to absorb differences; no change to phase-1 pairing, the rounding clamp, deliveries, duplicate matching or the ledger write path; no Prisma migration; no change to core `fifo` semantics (gross lot cost = amount + fee, proceeds = amount − fee).
- No real export data; synthetic ISINs (reuse `DE000SYNCA09`, `DE000SYNCB08`, `DE000SYNCC07`) in `*.csv.txt`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fee omitted | BUY 1000 fee 5, cash out 1000 | BUY unchanged; DEPOSIT 5 before it | — |
| Withheld tax | SELL 440, cash in 418 | SELL unchanged; TAX 22 after it | — |
| Contribution in rebalancing | SELL 220 fee 1, BUY 300, one cash in 19 | DEPOSIT 100 before both trades, no TAX | — |
| Within 0.01 | group difference 0.01 | align (unchanged) | — |
| Cash file goes negative | Σ cash rows −42 before a BUY | funding DEPOSIT 42 before the BUY | — |
| Fee-only gain diff | ledger 18.6, file 20, fees 1.4 | `fees`, not a mismatch | — |
| Other gain diff | ledger 20, file 30, fees 0 | `deviation`, mismatch | — |
| Partial lot fee | BUY 10 fee 2, SELL 2 fee 1 | fees 1.4 | — |

</intent-contract>

## Code Map

- `src/modules/migration/cash-groups.ts` -- `GroupReconciliation` :19 add `deposit` kind; branch at :50-52. Tests `cash-groups.test.ts` (negative-tax expectations become deposits).
- `src/modules/migration/parqet-reader.ts` -- `TransactionProposal` :25 (`funding` doc :54-58, `cashDifference` doc :59-63 now TAX or DEPOSIT); phase 2 loop :582-612 (`cashDifferences` push; deposit needs `at: group.trades[0]` and to go into `pending` before the trades loop :673); `pending.push(...cashDifferences)` :691 (TAX only); `withFunding` :442 doc; `proposals = cashRows.length === 0 ? withFunding(...)` :765 → always.
- `src/modules/migration/decisions.ts:79` `itemKey` -- unchanged; contribution DEPOSIT keys are the group union like 2.7's TAX (one result per group), funding keeps "f".
- `src/core/fifo.ts` -- `fifo`, `FifoRow` (reuse, unchanged); `src/core/corporate-actions.ts` `CorporateActions`; `test/architecture/core-imports.test.ts` purity.
- `src/modules/ledger/positions.ts:62-79` -- `RealizedSaleRecord`, `listRealizedSales` (rows already select `fee`).
- `src/modules/migration/preview.ts` -- `ParqetPreview` :75-101 fields; computed :204-208, :290-296.
- `src/modules/migration/confirm.ts` -- `Figure` :61, `SaleComparison` :71, `MigrationSummary` :82, `figure()` :115; reconciliation :376-411 (sales loop :383-397 → use `realized` `fees` + `classifyGainDifference`; cash figure :403; openingBalance :406).
- `src/app/_components/migration/labels.ts` -- `cashDifferenceNote` :136 (drop "wird/werden"), add `missingDepositNote`, `missingDepositsCashNote`, explained status text near `comparisonStatus` :257.
- `src/app/_components/migration/ParqetMigrationWizard.tsx` :123-132 notes; `ParqetSummaryView.tsx` `Status` :26, `FigureRow` :44, totals table :165-180.
- `src/modules/migration/index.ts` -- export new types if the UI needs them.
- Tests to update: `parqet-reader.test.ts` (:246, :401, :809, :922 negative-TAX cases → DEPOSIT; cash files that now get funding; funding describe :720), `preview.test.ts:63-66`, `confirm.test.ts` (:486-562 robust fixture: TAX count 3 total 26, missing deposits 1 / 5; `synthetic-export.csv.txt` records 4-5 → DEPOSIT 10), `labels.test.ts`, `ParqetMigrationWizard.test.tsx`, `src/app/_actions/migration.test.ts` if it asserts those figures.
- `_bmad-output/specs/spec-DepotManagement/parqet-export-format.md:27` -- quirk now says inflow → DEPOSIT, outflow → TAX (story 2.8); add a quirk: cash rows may lack deposits (funding for every export) and `realizedgains` excludes fees.

## Tasks & Acceptance

**Execution:**
- `src/modules/migration/cash-groups.ts` (+ test) -- `deposit` classification; matrix rows 1-4.
- `src/core/fee-attribution.ts` (+ test, inline rows) -- `saleFees`, `classifyGainDifference`; matrix rows 6-8 plus full-lot, multi-lot, split and ISIN-change sales.
- `src/modules/ledger/positions.ts` (+ existing test) -- `fees` on `RealizedSaleRecord`.
- `src/modules/migration/parqet-reader.ts` (+ test) -- contribution DEPOSIT placement/sequence, funding for files with Cash rows (matrix row 5), TAX only for outflow.
- `src/modules/migration/preview.ts` (+ test) -- `missingDepositCount/Total`, TAX-only `cashDifference*`.
- `src/modules/migration/confirm.ts` (+ test) -- explained figures, Parqet-own cash balance, `funding`, opening-balance offer.
- `labels.ts`, `ParqetMigrationWizard.tsx`, `ParqetSummaryView.tsx` (+ tests) -- notes, "Gebühren"/"fehlende Einzahlungen" status, cash note.
- `test/fixtures/parqet/synthetic-export-missing-deposits.csv.txt` + test in `confirm.test.ts` -- rows: 2024-01-02 cash in 1002; 2024-01-10 Buy A 10×100 fee 2 + cash out 1002; 2024-02-01 one instant: Sell A 2×110 fee 1 (realizedgains 20, chronologically first), Buy B 5×60, cash in 19; 2024-03-01 Sell A 3×120 fee 1 (realizedgains 60) + cash in 339; 2024-04-01 Buy C 4×100 + cash out 400; 2024-05-02 Sell C 4×105 (realizedgains 30) + cash in 420. Preview: no flags, `missingDepositCount` 2 / total 142 (contribution 100 before the Sell, funding 42 before Buy C), `cashDifferenceCount` 1 / total 20, no negative TAX. Confirm into an empty Depot: ok; positions A 5 (Cost Basis 501), B 5 (300); invested 801; ledger cash 420, file 378, cash `explained: "missing-deposits"`, not a mismatch; ledger cash ≥ 0 after every booked row; sales: both A sales `explained: "fees"` (fees 1.4 and 1.6), C a mismatch.
- Update the existing tests listed in the Code Map; update `parqet-export-format.md`.

**Acceptance Criteria:**
- Given an export whose group cash rows show more coming in than its trades explain, when previewed and confirmed, then a DEPOSIT precedes the trades, no TAX with negative tax is booked from a group difference, and the preview shows "N fehlende Einzahlungen ergänzt (Summe …)" separately from "N Kontodifferenzen als Steuer gebucht (Summe …)".
- Given any export (with or without Cash rows), when booked, then the Cash Account is never negative at any booked row, and with Cash rows the summary's cash row reads "fehlende Einzahlungen" with the note "Parqet fehlen Einzahlungen: …" instead of "Abweichung".
- Given sales whose ledger gain differs from `realizedgains` only by their attributable fees, when the summary is shown, then those rows read "Gebühren" and are not counted in "N × Abweichung".
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 32 findings — high 0, medium 0, low 22, false 9, maybe-false 1
- findings:
  - `[low]` `[patch]` (blind) Summary note "… erklärt die Differenz" shown beside an "Abweichung" cash status when the ledger differs beyond funding — reworded to "Parqet fehlen Einzahlungen: N zur Deckung ergänzte Einzahlungen (Summe …) sind im Parqet-Saldo nicht enthalten." (true in both cases; display condition unchanged).
  - `[low]` `[patch]` (blind) Preview "2 fehlende Einzahlungen" vs summary "1 ergänzte Einzahlung" read alike — the counts measure different things (only funding is absent from Parqet's balance); the reworded note now names "zur Deckung ergänzte" deposits.
  - `[low]` `[reject]` (blind) Preview cash 420 vs summary Parqet 378 — by design: the preview shows the resulting balance ("Ergebnis laut Datei", UX: resulting cash balance), the summary column is Parqet's own balance.
  - `[low]` `[reject]` (blind) Funding ignores the target Depot's existing cash — deliberate file-only rule as for 2.6 funding and the 2.7 clamp (preview/confirm/re-run consistency); migration targets an empty Depot; opening-balance alignment corrects the rest.
  - `[low]` `[reject]` (blind) `summary.funding` counts funding proposals skipped as duplicates on a re-run — those DEPOSITs are in the ledger from the first run, so the note and the cash explanation stay true.
  - `[low]` `[reject]` (blind) Depots migrated under 2.7 re-run: new DEPOSIT does not match the old negative TAX — only throwaway DBs hold 2.7 migrations; the operator migrates fresh after 2.8 and Depot deletion exists for re-runs.
  - `[false]` `[reject]` (blind) Same-day same-amount contribution/funding/real DEPOSITs match ambiguously — ambiguous matches go to a user decision (AD-15), never auto-dropped.
  - `[false]` `[reject]` (blind) Uncharged fee / tax refund on the inflow side becomes a DEPOSIT — the story's AC prescribes every inflow-side difference as DEPOSIT.
  - `[low]` `[reject]` (blind) `classifyGainDifference` default tolerance vs `MONEY_TOLERANCE`, no negative-difference test — both are 0.01; Parqet's `realizedgains` excludes fees (addendum evidence), so only file − ledger = fees applies; harm only on a hypothetical future change.
  - `[low]` `[reject]` (blind) `listRealizedSales` runs FIFO twice — single-user data volume; only the migration summary calls it.
  - `[low]` `[reject]` (blind) Linearity/rounding of `saleFees` untested with non-terminating values — any decimal residue is far below the 0.01 classification tolerance the value is used with.
  - `[false]` `[reject]` (blind) Import order in `labels.test.ts` fails an import-sort rule — no such rule is enabled; lint passes.
  - `[false]` `[reject]` (blind) sprint-status / EXPERIENCE.md not updated — sprint-status is orchestrator-owned; EXPERIENCE.md Flow 4 already lists the notes and "Gebühren".
  - `[low]` `[patch]` (edge) Note shown although cash still mismatches — same as the first blind row; reworded.
  - `[low]` `[reject]` (edge) Funding total ≤ 0.01 labels an equal balance "fehlende Einzahlungen" — the label is true (funding was added); fix adds a guard for a near-impossible case.
  - `[low]` `[reject]` (edge) Funding seeded at 0 for a non-empty Depot — same as the blind file-only row.
  - `[low]` `[reject]` (edge) Flagged inflow cash row excluded from funding, double cash if booked by hand — file-only rule; the 2.7 real run had 0 flags.
  - `[false]` `[reject]` (edge) Dividend/tax-refund inflow difference becomes DEPOSIT — AC-mandated, as above.
  - `[low]` `[reject]` (edge) Re-run over a 2.7 ledger duplicates the difference — same as the blind 2.7 row.
  - `[false]` `[reject]` (edge) Only one sign of fee difference recognized — Parqet excludes fees, ledger deducts them; the reverse sign would be a real deviation.
  - `[low]` `[reject]` (edge, claim) "never negative" not guaranteed with skipped/existing rows — same file-only rule; holds for the AC's empty-Depot scenario (tested row by row).
  - `[low]` `[patch]` (edge, claim) Note contradicts an Abweichung status — same as the first blind row; reworded.
  - `[low]` `[patch]` (verification-gap) No test for funding plus a residual cash mismatch — added a confirm test (manual DEPOSIT 10 first): cash `{ ledger 430, file 378, mismatch: true }`, funding `{1, 42}`.
  - `[low]` `[patch]` (verification-gap, other) Note vs Abweichung contradiction — same as the first blind row; reworded.
  - `[low]` `[reject]` (verification-gap, other) Preview 420 vs summary 378 — same as the blind preview-balance row.
  - `[low]` `[patch]` (intent) Same fixture shows 2/142 € in the preview and 1/42 € in the summary — same root as the second blind row; reworded.
  - `[maybe-false]` `[defer]` (intent) Cash explanation compares against the proposals' balance, not the literal Σ Cash rows — pre-existing since 2.7; deferred (medium, unverified) with what would settle it.
  - `[low]` `[reject]` (intent) Funding against a non-empty Depot untested — same file-only rule.
  - `[low]` `[reject]` (intent) UI checked by render-to-string, not a browser — project convention; the real components are rendered.
  - `[false]` `[reject]` (intent) Withheld tax modelled as a short cash row with tax 0 — matches the AC ("withheld tax is TAX with positive tax").
  - `[false]` `[reject]` (intent) 2.6/2.7 tests now check filtered views — follows from funding for every export; the funding itself is asserted in dedicated tests.
  - `[false]` `[reject]` (intent) Opening-balance offer for Cash-row files outside the criteria — specified in the spec to let the operator align the Cash Account (addendum handoff); additive.

## Design Notes

Fee attribution by difference: FIFO lot cost and sale proceeds are linear in fees, so `gain(fees = 0) − gain(actual)` is exactly sell fee + `buyFee × taken / lotQuantity` per consumed lot, including split/ISIN-change replay — no LotBook change needed.

Sign check: derived −81 (SELL +219, BUY −300), cash +19 → difference −100 → DEPOSIT 100; derived + 100 = cash. "Fehlende Einzahlungen" counts every deposit the file lacks (group contributions plus funding in files with Cash rows); a cash-less file keeps its funding in the existing "Export ohne Kontobewegungen" note. Parqet's own balance (file figure) = proposals' balance − funding total, since contribution DEPOSITs and difference TAXes already sum to the cash rows.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary.** Inflow-side group differences (cash rows show more coming in / less going out than the trades) are booked as one DEPOSIT sequenced before the group's trades; outflow-side differences stay a positive TAX after them, so no contribution becomes a negative TAX. Minimal funding now applies to every export, so the migrated Cash Account never goes negative. A pure core function attributes fees per sale (sell fee + consumed share of buy fees); the summary labels fee-only gain differences "Gebühren", compares cash with Parqet's own balance (without funding) and labels a funding-explained difference "fehlende Einzahlungen". The preview shows "N fehlende Einzahlungen ergänzt (Summe …)" separately from "N Kontodifferenzen als Steuer gebucht (Summe …)".

**Files changed.**
- `src/modules/migration/cash-groups.ts` (+ test) — `deposit` classification for inflow-side differences.
- `src/modules/migration/parqet-reader.ts` (+ test) — contribution DEPOSIT before the group, funding for every export.
- `src/core/fee-attribution.ts` (+ test) — `saleFees`, `classifyGainDifference`, `saleKey`.
- `src/modules/ledger/positions.ts` (+ test) — `fees` on `RealizedSaleRecord`.
- `src/modules/migration/preview.ts` (+ test) — `missingDepositCount/Total`, TAX-only `cashDifference*`.
- `src/modules/migration/confirm.ts` (+ test) — explained figures, Parqet's own cash balance, `funding`, opening-balance offer with funding.
- `src/app/_components/migration/labels.ts`, `ParqetMigrationWizard.tsx`, `ParqetSummaryView.tsx` (+ tests) — notes, "Gebühren" / "fehlende Einzahlungen" status, funding note.
- `src/core/funding.ts` — doc comment.
- `test/fixtures/parqet/synthetic-export-missing-deposits.csv.txt` — synthetic fixture (contribution, withheld tax, negative cash history, fee-bearing sales).
- `_bmad-output/specs/spec-DepotManagement/parqet-export-format.md` — quirks for 2.8.
- `_bmad-output/implementation-artifacts/epic-2-context.md` — recompiled (planning docs had changed).

**Review findings.** 32 findings: 7 rows patched (2 entries, both low: summary note reworded to be true and to name funding deposits; test for funding plus a residual cash mismatch), 1 deferred (cash figure derived from proposals, not the literal Σ Cash rows — pre-existing, medium unverified), 15 low and 9 false rejected — reasons per row in the Review Triage Log.

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 0, low 2.

**Verification.** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (67 files, 1099 tests) after the patches. Every I/O matrix row is covered by a passing test (cash-groups, reader, fee-attribution and confirm tests).

**Residual risks.** Funding, the clamp and the cash comparison work on the file alone (non-empty target Depots and re-runs over 2.7-era migrations are not considered). Inflow-side differences that are really fee waivers or tax refunds are booked as DEPOSITs (AC-mandated), which counts them as external flows. The real-data end-to-end migration (no negative cash, no negative TAX from contributions, only non-fee gain deviations) is owed as Story 2.4's operator verification.
