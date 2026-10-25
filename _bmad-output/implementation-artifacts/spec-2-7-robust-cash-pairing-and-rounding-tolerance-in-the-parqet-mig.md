---
title: 'Robust Cash Pairing and Rounding Tolerance in the Parqet Migration (story 2-7)'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '5e784a45d3882effc4c3af6359fe8c8fea7a12a2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      An unrelated Cash DEPOSIT/WITHDRAWAL sharing an instant with a mismatching leftover trade is absorbed into the group and booked as part of a difference TAX instead of a deposit.
    evidence: |-
      parqet-reader.ts phase 2 adds every unused cash row of the instant to the group (as the AC's "remaining trades and cash rows of the group are reconciled together" prescribes). Date-only events carry synthetic times (00:00Z/06:00Z), so a mismatching dividend and a deposit on the same day can share an instant. Cash balance still matches; the inflow is classified as tax refund (affects TTWROR/XIRR and tax totals). Visible before booking via the "Kontodifferenzen … (Summe …)" note. Separating them needs an intent decision (heuristic); settle with the operator's real-data migration (story 2.4).
    location: >-
      src/modules/migration/parqet-reader.ts (phase 2 grouping)
    severity: medium
  - summary: >-
      A trade with no cash row at its instant in a file that has Cash rows gets no difference TAX, so the Cash Account would not follow Parqet's cash rows there.
    evidence: |-
      Spec requires >= 1 unused cash row for phase 2 (unchanged 2.3-2.6 behavior). Unknown whether real ROBIN / finanzen.net zero exports contain such trades; the correct-course analysis listed none. Settle by the operator's real-data migration: a cash mismatch in the 2.4 reconciliation would reveal it.
    location: >-
      src/modules/migration/parqet-reader.ts (phase 2, group.cash.length === 0)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** A trade whose Parqet cash row differs from its derived cash effect by more than €0.01 (fee omitted, withheld tax missing, dividend difference, one net cash row for a rebalancing instant) is flagged `cash-pair-mismatch` and skipped, so later sells fail with "Verkauf übersteigt Bestand". Parqet also rounds fractional sell quantities, so a sell can exceed the holding by a few ten-thousandths and stop booking.

**Approach:** The reader reconciles trades and cash rows per instant as a group: 1:1 pairing within €0.01 first (unchanged), then the group's leftovers together; every trade is booked with Parqet's figures and a group difference above €0.01 becomes one standalone TAX proposal. A pure core function clamps sells that exceed the file's holding by ≤ 0.001 units and subtracts the shortfall from the next BUY. The preview announces both.

## Boundaries & Constraints

**Always:**
- Group = all parsed trades (BUY/SELL/DIVIDEND/TAX-cost rows) and Cash TransferIn/TransferOut rows with the same `instant`. Phase 1 = today's 1:1 pairing (closest same-direction cash row, ≤ €0.01, `alignToCash`), unchanged.
- Phase 2, per instant with ≥ 1 unpaired trade of non-zero cash effect AND ≥ 1 unused cash row, and no flagged trade row at that instant (`tradeFlags`): all those leftovers form the reconciled set. `cash` = Σ signed cash rows (in +, out −), `derived` = Σ `cashEffect` of the leftover trades, `difference = derived − cash`.
  - |difference| ≤ 0.01: align the leftover trade with the largest |effect| (ties: chronologically first) so the set's derived total equals `cash` (amount; tax for a TAX row — same formula as `alignToCash`, `originalAmount`/`originalTax` set when changed). Its `records` gain the set's cash records.
  - |difference| > 0.01: add one TAX proposal: amount "0", fee "0", tax = canonical `difference` (negative = refund), `securityKey` = the leftover trades' Security when they all share one non-null key, else null; `records` = sorted union of the set's trade and cash records; marker `cashDifference: true`; placed at the chronologically last trade of the set and pushed after the trades so the stable sort sequences it directly after them. Trades keep quantity, price, amount, fee, tax and their own `records`.
  - Used cash rows never become DEPOSIT/WITHDRAWAL. Unused cash rows at instants without leftover trades stay DEPOSIT/WITHDRAWAL; at an instant with a flagged trade row they still join that flag (today's behavior), and its leftover trades are booked unreconciled.
- Remove `cash-pair-mismatch` from `FLAG_REASONS`, the reader and `flagReasonLabel`.
- The grouping/difference logic is a pure, exported, unit-tested function in `src/modules/migration/cash-groups.ts` (input: leftover trades with their cash effects and cash rows of one instant; output: alignment or TAX figures); the reader calls it.
- `src/core/rounding.ts` (pure; imports only core files): `clampRoundingOversells<T extends ReplayRow>(rows, actions, tolerance = "0.001")` replays rows with every corporate action (`replayEvents`, `LotBook`, `ALL_ACTIONS`) and returns `Map<T, string>` of new quantities. A SELL whose quantity exceeds the net held quantity at that point by > 0 and ≤ tolerance, with held > 0 and held representable in ≤ 8 decimals, gets quantity = held; the shortfall is carried per Security (a later split scales it ×new/old, an ISIN change moves it ×n/o to the new Security; dropped if it then needs > 8 decimals). The next BUY of that Security whose quantity is greater than the carry gets quantity − carry and the carry clears; a BUY not greater than the carry stays unchanged and the carry moves on. Larger oversells are left untouched.
- Reader applies it after sequencing, before funding, over the proposals (`securityId` = `securityKey`) with the file's splits/ISIN changes; adjusted proposals keep amount, fee, tax and price and record `originalQuantity` (string). Amount and cash are unchanged, so funding is unaffected.
- Preview fields: `cashDifferenceCount`, `cashDifferenceTotal` (canonical Σ tax of `cashDifference` proposals, "0" without), `roundingCount` (SELL proposals with `originalQuantity`). Wizard notes (Alert `info`, near the existing "Rundung angeglichen" line), only when count > 0: `N Kontodifferenzen werden als Steuer gebucht (Summe <formatMoney(total)>)` (N = 1: "1 Kontodifferenz wird als Steuer gebucht (…)") and `N Rundungsreste ausgeglichen` (N = 1: "1 Rundungsrest ausgeglichen"); label helpers in `src/app/_components/migration/labels.ts`.
- Confirmation books the adjusted proposals through the existing `recordBatch` path unchanged; a SELL exceeding by > 0.001 still fails with the existing `booking-failed` / "Verkauf übersteigt Bestand" message.

**Never:**
- No change to quantity, price, amount or fee to absorb a cash difference > €0.01; no changes to duplicate matching, funding, transfers/deliveries, reconciliation figures or the ledger service; no Prisma migration.
- No clamp computed against the target Depot's existing ledger (file only, like funding).
- No real export data; synthetic ISINs with valid check digits in `*.csv.txt`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fee omitted | BUY 1000 fee 5, cash out 1000 | BUY unchanged; TAX −5 (Security of the BUY) after it | — |
| Withheld tax | SELL 440, cash in 418 | SELL unchanged; TAX 22 | — |
| Dividend mismatch | DIVIDEND 20 tax 3, cash in 15 | DIVIDEND unchanged; TAX 2 | — |
| Rebalancing | BUY 250, BUY 200, SELL 360 (3 Securities), one cash out 92 | 3 trades unchanged; TAX 2, securityKey null | — |
| Group within 0.01 | same trades, cash out 90.01 | SELL amount 359.99 (`originalAmount` 360), no TAX | — |
| 1:1 pair ≤ 0.01 | unchanged from today | aligned, no TAX | — |
| Cash row at instant without trades | cash in 500 | DEPOSIT 500 | — |
| Rounding oversell | hold 1, SELL 1.0008, later BUY 0.0016, SELL 0.0008 | SELL 1 (`originalQuantity` 1.0008), BUY 0.0008, final 0 | — |
| Oversell > 0.001 | hold 1, SELL 1.002 | quantity unchanged | booking stops: "Verkauf übersteigt Bestand" |
| Held 0 | no lots, SELL 0.0005 | unchanged | booking stops |
| BUY ≤ carry | carry 0.0008, BUY 0.0005, BUY 1 | first BUY unchanged, second 0.9992 | — |
| Split before carry consumed | carry 0.0008, split 1:2, BUY 3 | BUY 2.9984 | — |

</intent-contract>

## Code Map

- `src/modules/migration/parqet-reader.ts` -- `FLAG_REASONS` :83 (drop mismatch), `TransactionProposal` :23 (add `cashDifference?: true`, `originalQuantity?: string`), `PAIR_TOLERANCE` :150, `effectOf`/`closest`/`alignToCash` :389-418 (reuse), pairing loop :506-534 (keep phase 1, replace mismatch branch with phase 2), flagged-trade cash absorption :536-542 (run before phase 2 or exclude flagged instants), `pending` build :601-679 (`mismatched` skip goes away; push TAX proposals after trades), `sequenced`/`withFunding` :679-680 (insert clamp between).
- `src/core/corporate-actions.ts` -- `ReplayRow` :91, `replayEvents` :134, `LotBook` (`net`, `buy`, `sell`, `apply`), `ALL_ACTIONS`; `src/core/holdings.ts` `applyEvent` shows the replay loop pattern. `src/core/decimal.ts` `canonicalDecimal`, `ExactDecimal`. `test/architecture/core-imports.test.ts` enforces purity.
- `src/modules/migration/decisions.ts:78` `itemKey` -- no change needed (TAX records are a unique union); verify keys stay unique in a test.
- `src/modules/migration/preview.ts` -- `ParqetPreview` :75 add the three fields, built ~:274.
- `src/app/_components/migration/ParqetMigrationWizard.tsx` -- notes near :116 ("Rundung angeglichen"); `labels.ts` :55-66 `flagReasonLabel` (drop case), :133 `fundingNote` as template; `formatMoney` from `src/core/format.ts`.
- Tests to update (mismatch expectations become a booked BUY + TAX): `parqet-reader.test.ts:237-277,374-378`, `preview.test.ts:65-71`, `confirm.test.ts:125-131` (and cash/count figures of `synthetic-export.csv.txt` records 4-5: BUY 10×9.9 amount 99 fee 1 with cash out 90 → TAX −10), `decisions.test.ts:46` (use another reason), `labels.test.ts`, `ParqetMigrationWizard.test.tsx`, `src/app/_actions/migration.test.ts` if it asserts that fixture's figures.
- Fixtures in `test/fixtures/parqet/` (format: see `synthetic-export-cashless.csv.txt`; cash rows `TransferIn/TransferOut;…;Cash`, positive amounts, same `datetime` as their trade).

## Tasks & Acceptance

**Execution:**
- `src/modules/migration/cash-groups.ts` (+ test) -- pure group reconciliation (difference, alignment target, TAX figures and Security choice); matrix rows 1-6.
- `src/core/rounding.ts` (+ test, inline rows) -- `clampRoundingOversells`; matrix rows 8-12 plus multi-Security independence and ISIN-change carry.
- `src/modules/migration/parqet-reader.ts` (+ test) -- phase 2, TAX proposals, flag removal, clamp application; tests: each mismatch pattern booked with no flag, flagged-trade instant keeps cash on the flag, cash-only instant unchanged, cash-less file unchanged.
- `src/modules/migration/preview.ts` (+ test) -- `cashDifferenceCount`, `cashDifferenceTotal`, `roundingCount`.
- `src/app/_components/migration/labels.ts`, `ParqetMigrationWizard.tsx` (+ tests) -- two notes (singular/plural), absent at 0; remove mismatch label.
- `test/fixtures/parqet/synthetic-export-robust-pairing.csv.txt` + test in `src/modules/migration/confirm.test.ts` -- rows: 2024-01-02 cash in 10000; 2024-01-10 Buy A 10×100 fee 5 + cash out 1000; 2024-02-10 Sell A 4×110 + cash in 418; 2024-03-01 Dividend A 20 tax 3 + cash in 15; 2024-04-01 one instant Buy B 5×50, Buy C 2×100, Sell A 3×120 + one cash out 92; 2024-05-02 Buy D 1×50 + cash out 50; 2024-06-03 Sell D 1.0008×50 (amount 50.04) + cash in 50.04; 2024-07-01 Buy D 0.0016×50 (0.08) + cash out 0.08; 2024-07-02 Sell D 0.0008×50 (0.04) + cash in 0.04; `realizedgains` FIFO-consistent. Preview: no flags, `cashDifferenceCount` 4, `roundingCount` 1. Confirm into an empty Depot: ok; positions A 3 (Cost Basis 301.5), B 5 (250), C 2 (200), D none; invested 751.5; ledger cash at export date = Σ signed cash rows; no position/invested/cash/sale mismatch; a variant with Sell D 1.002 fails `booking-failed` for that SELL.
- Update the existing tests listed in the Code Map.

**Acceptance Criteria:**
- Given an export with mismatching cash rows, when previewed, then no row is flagged for a cash mismatch and the preview shows "N Kontodifferenzen werden als Steuer gebucht (Summe …)"; after "Übernehmen" every trade is booked with Parqet's quantity, price, amount and fee and the Cash Account equals the sum of the file's cash rows.
- Given a fractional sell exceeding the file's holding by ≤ 0.001, when previewed, then "N Rundungsreste ausgeglichen" is shown and booking succeeds with final quantities equal to the file's net quantities.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 25 findings — high 0, medium 2, low 14, false 8, maybe-false 1
- findings:
  - `[medium]` `[defer]` (blind) Unrelated deposit at a mismatching trade's instant becomes part of a difference TAX — real (all unused cash rows of the instant join the group, as the AC prescribes); cash balance correct, classification wrong; visible via the preview note; fix needs an intent-level heuristic — deferred.
  - `[low]` `[reject]` (blind) Clamped quantities will not match later broker-PDF imports by quantity (Epic 5) — the AC mandates booking the held quantity and reducing the next BUY; Epic 5's duplicate design must account for it (residual risk).
  - `[false]` `[reject]` (blind) Absorbing BUY's price × quantity ≠ amount — the AC requires "amount unchanged"; the ledger does not require price × quantity = amount, Cost Basis is the amount.
  - `[low]` `[reject]` (blind) Signed total can net offsetting differences to 0 — the AC asks for "the total"; offsetting differences in one file are unlikely and the count is shown.
  - `[low]` `[reject]` (blind) "Summe -10,00 €" for a refund reads oddly — the total is the signed tax as specified; cosmetic wording.
  - `[false]` `[reject]` (blind) No per-row list of generated TAXes/clamps — the AC specifies count notes only; TAX rows appear in the booking counts and ledger.
  - `[false]` `[reject]` (blind) roundingCount counts only SELLs — each Rundungsrest is one clamped SELL; the BUY absorbs the same residue.
  - `[false]` `[reject]` (blind) Unused carry after a full sell-out is untested and breaks "final = file net" — covered in core ("clamps at exactly the tolerance", no later BUY); the ledger ends at 0, the physically correct holding (Parqet's net would be negative).
  - `[low]` `[reject]` (blind) Clamp ignores corrected flags and the target Depot's ledger — deliberate file-only rule (spec Never), same trade-off as 2.6 funding; needs a manual correction of a rare flag on the same Security.
  - `[low]` `[reject]` (blind) Difference TAX can match an existing TAX in a non-empty target Depot as duplicate — only migrating into a Depot with same-day TAX of that Security; re-run behavior is correct (tested).
  - `[low]` `[patch]` (blind) Parqet format Quirks doc not updated — added two quirk bullets to `parqet-export-format.md`; historical story 2.5 AC text and the generated epic context left as is.
  - `[low]` `[patch]` (blind) Reader-level test gaps — added reader tests for a 1:1 pair plus a leftover group at one instant and for the ISIN-change clamp wiring; both-direction netting and TAX-cost leftovers stay covered by `cash-groups.test.ts`.
  - `[low]` `[reject]` (edge) Align branch with opposite-direction cash can produce a negative amount — needs a leftover trade below 1 cent net against an opposite cash row; a guard adds a branch for a case not seen in real data.
  - `[medium]` `[defer]` (edge) Unrelated deposit absorbed into TAX — same root cause as the first blind finding, deferred with it.
  - `[low]` `[reject]` (edge) Corrected flagged rows not replayed by the clamp — same as the blind finding above.
  - `[false]` `[reject]` (edge) Carry taken from a delivery BUY — a delivery BUY is "the next BUY of the same Security" per the AC; amount and the delivery DEPOSIT stay consistent (cash unchanged).
  - `[low]` `[reject]` (edge, claim) "every trade booked with Parqet's amount" contradicted by alignment — ≤ €0.01 amount alignment is the AC's retained rule (AD-6); the failing negative-amount case is the rejected row above.
  - `[low]` `[patch]` (verification-gap) ISIN-change wiring into the clamp untested at reader level — added reader test (10 old → 5 new, SELL 5.0005 clamped to 5).
  - `[low]` `[patch]` (verification-gap) No re-run test for clamped quantities — extended the robust-fixture confirm test: second preview reports every proposal (clamped SELL, reduced BUY, 4 TAXes) as duplicate, second confirm books 0.
  - `[maybe-false]` `[defer]` (intent R1b) Trades without any cash row at an instant get no TAX — would be medium if real exports contain such trades; settled by the operator's real-data run — deferred.
  - `[false]` `[reject]` (intent R2b) TAX Security chosen from leftover trades only — the AC's "group" is the reconciled remainder; paired trades are already reconciled.
  - `[low]` `[reject]` (intent R3b) Holding measured on the file, not the target Depot — deliberate (spec Never), identical for the AC's empty-Depot scenario; keeps preview, confirm and re-runs consistent.
  - `[false]` `[reject]` (intent R5) Grouping by instant is not a separate function — the AC allows `src/modules/migration`; grouping lives in the pure reader there and the difference logic in `cash-groups.ts`, both unit-tested.
  - `[low]` `[reject]` (intent) Wizard not rendered with the robust preview; German stop text not asserted — notes are tested via labels and wizard rendering; the stop message is the unchanged 2.4 label (tested there).
  - `[false]` `[reject]` (intent R6) Real-data check should make 2.7 awaiting-operator — 2.7's ACs are all synthetic-fixture checks; the real ROBIN / finanzen.net zero migration is Story 2.4's operator verification per the change proposal.

## Design Notes

TAX sign check: TAX cash effect is −tax, so derived + (−(derived − cash)) = cash. Example rebalancing: derived = −250 − 200 + 360 = −90, cash = −92 → tax 2.

The clamp runs on the file alone (as funding does), so preview, confirmation and a re-run produce the same quantities and duplicate keys. The ledger holds `shortfall` more than Parqet's net until the next BUY absorbs it.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary.** The Parqet reader no longer flags `cash-pair-mismatch`. After the unchanged 1:1 pairing within €0.01, each instant's leftover trades and unused cash rows are reconciled together: within €0.01 the largest trade's amount is aligned, above it one standalone TAX (tax = derived − cash, Security when all leftover trades share one) is sequenced after the trades, so every trade keeps Parqet's quantity, price, amount and fee and the Cash Account follows the cash rows. A pure core function clamps SELLs exceeding the file's holding by ≤ 0.001 units to the held quantity and subtracts the shortfall from the next larger BUY (through splits and ISIN changes). The preview shows "N Kontodifferenzen werden als Steuer gebucht (Summe …)" and "N Rundungsreste ausgeglichen".

**Files changed.**
- `src/modules/migration/cash-groups.ts` (+ test) — pure group reconciliation (alignment or TAX figures).
- `src/core/rounding.ts` (+ test) — `clampRoundingOversells`.
- `src/modules/migration/parqet-reader.ts` (+ test) — phase-2 groups, difference TAX proposals, flag removal, clamp before funding.
- `src/modules/migration/preview.ts` (+ test) — `cashDifferenceCount`, `cashDifferenceTotal`, `roundingCount`.
- `src/app/_components/migration/labels.ts`, `ParqetMigrationWizard.tsx` (+ tests) — two notes, mismatch label removed.
- `src/modules/migration/confirm.test.ts`, `decisions.test.ts`, `src/app/_actions/migration.test.ts` — updated expectations; robust-fixture end-to-end, oversell > 0.001 and re-run tests.
- `test/fixtures/parqet/synthetic-export-robust-pairing.csv.txt` — synthetic fixture (fee omitted, withheld tax, dividend, rebalancing, 0.0008 rounding oversell).
- `_bmad-output/specs/spec-DepotManagement/parqet-export-format.md` — quirks for 2.7 patterns.
- `_bmad-output/implementation-artifacts/epic-2-context.md` — recompiled (planning docs had changed).

**Review findings.** 25 findings: 4 patches applied (all low: two reader tests, re-run test, format doc), 2 entries deferred (unrelated deposit absorbed into a difference TAX — medium; trades without a cash row get no TAX — medium unverified), 11 low and 8 false rejected — reasons per row in the Review Triage Log.

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 0, low 4.

**Verification.** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (66 files, 1080 tests) after the patches. Every I/O matrix row is covered by a passing test.

**Residual risks.** The clamp and the group reconciliation work on the file alone (non-empty target Depots and corrected flags are not considered). Clamped quantities will not match broker documents by quantity in Epic 5. A same-instant unrelated deposit can be classified as tax (deferred). The real ROBIN / finanzen.net zero migration (expect zero flags and zero oversells) is owed as Story 2.4's operator verification.
