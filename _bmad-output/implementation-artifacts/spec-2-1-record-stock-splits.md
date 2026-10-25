---
title: 'Record Stock Splits (story 2-1)'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '0f0dacdab56457c36a368ad39c25bd11c8cd2687'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      SplitDialog (and the split list it filters per Security) has no interaction test; only static server rendering, server actions and labels are tested.
    evidence: |-
      No jsdom/happy-dom/testing-library in the repo (same tooling gap as DW-3). Passing splits={[]} or inverting the `own` filter in SplitDialog.tsx would pass npm test and make split edit/delete unreachable in the UI. Settle by adding DOM test tooling or extracting the list rendering into a server-renderable, testable piece.
    location: >-
      src/app/_components/corporate-actions/SplitDialog.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** A stock split (e.g. 1:4) changes how many units of a Security every holder owns, but the ledger has no way to record it, so after a split Positions, FIFO lots, sell limits, Prices and archive checks mix pre- and post-split units and become wrong.

**Approach:** Add a Security-scoped `CorporateAction` model (type `SPLIT`, effective date, ratio old:new) written only by `ledger`. One pure core function adjusts BUY/SELL quantities (× new/old) and per-unit prices (× old/new) of rows dated **before** the effective date, on read; every quantity/price consumer in core (FIFO, Positions, price resolution, sell guards, flat/held checks) goes through it. A row menu on each Position offers "Corporate Action → Split" with a dialog that also lists, edits and deletes that Security's splits.

## Boundaries & Constraints

**Always:**
- Stored Transactions (and prices) are never modified by a split; adjustment happens only on read in `src/core` (AD-7). Total Cost Basis and cash are unaffected by splits.
- A split dated D applies before every Transaction dated D (AD-8): a row is adjusted by split S iff `row.date < S.date <= asOf`. Several splits multiply.
- A split applies in every Depot (it is stored on the Security, no `depotId`).
- Ratio is `old:new`, both positive integers (no leading zeros, ≤ 6 digits), `old ≠ new`; input text like `1:4`, `1 : 4`; reverse splits (`10:1`) allowed. Stored as canonical TEXT `ratioOld` / `ratioNew`.
- Decimal strings + `ExactDecimal` only; when combining several splits, multiply all `new` and all `old` terms first, then divide once (`quantity × Πnew / Πold`).
- Ledger write rules: zod/typed validation, typed `{ ok: false, reason }` results, one DB transaction, optional `db` client param, nothing written on failure. At most one split per (Security, date) → `split-exists`.
- A split create/edit/delete that would make any SELL in any Depot exceed the then-held (adjusted) quantity, where it did not before, is rejected with `later-sell-exceeds-holding` (+ `date` of that SELL).
- UI text German, de-DE formats, Enter submits / Esc closes, modal depth 1, touch targets ≥ 44px, works at phone width.

**Never:**
- No ISIN changes (story 2.2), no price-provider refetch (Epic 3 — prices module does not exist yet), no Parqet import of splits.
- No split rows in the Cash Account or as Transactions; no `TransactionType` change.
- No SQL arithmetic on decimals; no editing of committed migrations; no `Date.now()` in core.
- Do not change the duplicate matcher or the Transaction edit dialog's values (the dialog edits stored, unadjusted values).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Split between buys + partial sell | BUY 10 @ 100 (2024-01-02, fee 0), split 1:4 on 2024-03-01, BUY 20 @ 30 (2024-04-01), SELL 30 @ 35 (2024-05-01) | FIFO lots as of 2024-06-01: first lot fully sold (40 adj. units ≥ 30 → takes 30 of 40, cost 750), remaining lots: 10 units cost 250 (2024-01-02), 20 units cost 600; sale costBasis 750, gain 1050−750=300 | — |
| Split on same date as a BUY | BUY 5 on 2024-03-01, split 1:2 on 2024-03-01 | BUY not adjusted (5 units) | — |
| Positions after split | BUY 10 @ 400, split 1:4, today after split | quantity 40, costBasis 4000, averagePrice 100; price from the pre-split BUY shown as 100 | — |
| Split dated in the future | split date > today | Positions/today views unaffected | — |
| Multiple splits | 1:2 then 1:3 | factor 6 for rows before both | — |
| SELL after split | held 10 pre-split, split 1:4, SELL 40 after split | accepted; SELL 41 → `sell-exceeds-holding`, `available: "40"` | typed failure |
| Delete split with dependent sell | as above with SELL 40 booked | delete → `later-sell-exceeds-holding`, date of the SELL | nothing written |
| Invalid ratio | `0:4`, `4:4`, `1,5:3`, `abc`, `` | `ratio-invalid` | typed failure |
| Unknown security / split id | bad ids | `security-not-found` / `split-not-found` | typed failure |
| Bad date | `2024-02-30` | `date-invalid` | typed failure |
| Duplicate date | second split same Security+date | `split-exists` | typed failure |
| Flat / held with split | BUY 10, split 1:2, SELL 20 | Depot flat (archivable), Security not held | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add `enum CorporateActionType { SPLIT }` and `model CorporateAction { id cuid, securityId → Security (onDelete: Restrict), type, date String, ratioOld String, ratioNew String, @@unique([securityId, type, date]), @@index([securityId]) }` + back-relation `corporateActions` on `Security`; comment "Owned by the ledger module (AD-7)". New migration folder `prisma/migrations/20261025190000_add_corporate_action/migration.sql` (generate with `DATABASE_URL=file:<scratchpad>/x.db npx prisma migrate dev --create-only --name add_corporate_action` and rename the folder, or hand-write; format like `20261025143146_add_security_and_transaction`). Then `npx prisma generate`.
- `src/core/corporate-actions.ts` (new) -- `Split = { securityId; date; ratioOld; ratioNew }`; `parseSplitRatio(text)`; factor/adjust helpers: `adjustTrades(rows, splits, asOf)` (quantity × Πnew/Πold, `price` (if present on the row) × Πold/Πnew for rows of that Security dated `< split.date` with `split.date <= asOf`), plus a single-value helper for display (`splitAdjustment(securityId, date, quantity, splits, asOf)` → adjusted quantity or `null` when no split applies). Use a far-future sentinel asOf (e.g. `"9999-12-31"`) for "all splits" in guards.
- `src/core/fifo.ts:44` `fifo(rows, asOf)` → add required `splits` param; adjust trades first. Sale `quantity` is then in the asOf basis (fine).
- `src/core/positions.ts:27` `computePositions(rows, observations, today)` → add `splits`; pass to `fifo`; adjust each `PriceObservation.price` by splits between observation date and `today` before `resolvePrice` (`src/core/prices.ts:20` itself stays split-agnostic).
- `src/core/holdings.ts` `sellableAt`/`sellableQuantity`/`firstOversell` → add `splits` param. Compute in the "all splits" basis, then convert `available` back to the basis of `position.date` (divide by that row's factor). The quantity compared must be the added SELL adjusted the same way (or compare in its own basis).
- `src/core/archive.ts` `isFlat`/`canArchive`/`heldSecurities`/`netQuantities` → add `splits`, adjust quantities as of `asOf`.
- Core tests: `src/core/corporate-actions.test.ts` (new), extend `fifo.test.ts`, `positions.test.ts`, `holdings.test.ts`, `archive.test.ts` (existing calls pass `[]`).
- `src/modules/ledger/corporate-actions.ts` (new) -- `SplitRecord = { id; security: SecuritySummary; date; ratioOld; ratioNew }`; `recordSplit({ securityId, date, ratio }, db)`, `updateSplit(id, { date, ratio }, db)`, `deleteSplit(id, db)`, `listSplits(db)` (all, ordered by date); internal `loadSplits(db, securityIds?)` returning core `Split[]` for other ledger files. Failure reasons: `security-not-found | date-invalid | ratio-invalid | split-exists | split-not-found | later-sell-exceeds-holding`. Guard: for every Depot with BUY/SELL of the Security, `firstOversell(after) && !firstOversell(before)` using `holdings.firstOversell` with the split set before/after the change. Reuse `inTransaction` from `./depots`.
- `src/modules/ledger/transactions.ts:318` `checkHoldings` -- load the Security's splits and pass them to `sellableAt`/`firstOversell`.
- `src/modules/ledger/positions.ts:36` -- load splits for `securityIds`, pass to `computePositions`.
- `src/modules/ledger/depots.ts` -- `toSummary`/`archiveDepot`/`listHeldSecurities` pass splits (load all splits once per call; `depotRows` callers).
- `src/modules/ledger/index.ts` -- export the new service functions and types.
- `src/modules/ledger/*.test.ts` -- temp-DB pattern (`test/helpers/test-db.ts`, `createTestDatabase`); add `corporate-actions.test.ts`.
- `src/app/_actions/corporate-actions.ts` (new, + test) -- `saveSplitAction` (create when no `splitId`, else update) and `deleteSplitAction`, session check like `src/app/_actions/depots.ts` (`UNAUTHORIZED`), zod `formText`, `revalidatePath("/", "layout")` or the paths `transactions.ts` uses.
- `src/app/_components/corporate-actions/SplitDialog.tsx` (new) + `labels.ts` (+ test) -- dialog titled "Split – {Security name}": fields "Verhältnis (alt:neu)" (placeholder `1:4`) and "Gültig ab" (date), list "Erfasste Splits" (date + ratio, Bearbeiten / Löschen per row, delete asks for confirmation inline), German error messages per reason. Follow `src/app/_components/depots/DepotDialogs.tsx` (`DepotDialog`, `useDialog`, `TOUCH_TARGET`) patterns.
- `src/app/_components/positions/PositionsTable.tsx` -- add a trailing action column (desktop) / trailing button (phone) with a kebab `IconButton` (`aria-label="Aktionen für {name}"`) opening an MUI `Menu` with item "Corporate Action → Split"; new props `splits: SplitRecord[]`, `readOnly?: boolean` (no menu when read-only). Keep cash row column count in sync (`POSITION_SORT_KEYS.length` + 1).
- `src/app/_components/transactions/TransactionList.tsx` -- new prop `splits`; for BUY/SELL rows a split adjusts as of `today`, show the adjusted quantity plus a caption "split-bereinigt (gebucht: {original} Stück)".
- `src/app/(app)/depots/[id]/page.tsx` -- load `listSplits()` and pass to `PositionsTable` (+ `readOnly`) and `TransactionList`; tests in `page.test.tsx` / `PositionsTable.test.tsx` use `test/helpers/render-text.ts`.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + new migration -- CorporateAction model -- AD-7 storage.
- `src/core/corporate-actions.ts` + test -- ratio parsing and split adjustment -- the single adjustment definition.
- `src/core/fifo.ts`, `positions.ts`, `holdings.ts`, `archive.ts` + tests -- thread `splits` through; I/O matrix cases incl. the epic's required "split between two buys + partial sell" FIFO test -- correctness on read.
- `src/modules/ledger/corporate-actions.ts` + test, `index.ts` -- split CRUD with validation and oversell guard -- only ledger writes CorporateActions.
- `src/modules/ledger/transactions.ts`, `positions.ts`, `depots.ts` + tests -- load and pass splits -- sell guard, Positions and archive/held respect splits.
- `src/app/_actions/corporate-actions.ts` + test -- server actions -- UI write path.
- `src/app/_components/corporate-actions/SplitDialog.tsx`, `labels.ts` + test -- dialog with list/edit/delete -- user surface.
- `src/app/_components/positions/PositionsTable.tsx` + test, `TransactionList.tsx`, `src/app/(app)/depots/[id]/page.tsx` + test -- row menu entry and adjusted display.

**Acceptance Criteria:**
- Given a Depot with an open Position, when I open the Positions tab, then each Position row has an actions menu containing "Corporate Action → Split" which opens the split dialog for that Security.
- Given I submit ratio `1:4` and an effective date, when the save succeeds, then one CorporateAction row exists for the Security (no Transaction or price row changed) and the Positions tab of every Depot holding it shows quantity × 4, average price ÷ 4, unchanged Cost Basis.
- Given a recorded split, when I edit its ratio/date or delete it in the dialog, then the next page load reflects the change; a change that would oversell a later SELL is refused with a German message naming that SELL's date.
- Given a BUY dated before a split, when I view the Transactions tab, then its quantity is shown split-adjusted with the caption showing the booked quantity.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 14, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: uneven reverse split (e.g. 3:1) makes `sellableAt` return a 1000-digit value rounded up; selling the displayed amount is refused — only reachable with reverse-split ratios whose old term has factors other than 2/5 on non-divisible holdings (rare); fix needs a rounding policy, not a direct correction.
  - `[low]` `[reject]` Blind: fractional leftovers of an uneven reverse split can never be sold to exactly zero (Position/Depot never flat) — same rare case; user workaround: book the cash-in-lieu SELL pre-split; cash-in-lieu support is beyond a direct correction.
  - `[low]` `[reject]` Blind: non-terminating adjusted values travel as up-to-1000-digit strings — display always goes through formatQuantity/formatMoney; cosmetic payload size only, same rare case.
  - `[low]` `[reject]` Blind: a split dated between an archived Depot's BUY and closing SELL can make it non-flat silently — requires a SELL booked in pre-split units after the split date (inconsistent data; the guard refuses booking the post-split quantity before the split exists); fix needs a new failure reason.
  - `[false]` `[reject]` Blind: an existing oversell disables the guard for the whole Depot — every ledger write path (transactions and splits) refuses to create an oversell, so the "before" state never contains one.
  - `[low]` `[reject]` Blind: circular import depots.ts ↔ corporate-actions.ts — only call-time bindings are used, build/tests pass; refactor to a shared file is more than a direct correction with no everyday harm.
  - `[low]` `[reject]` Blind: split dialog only reachable from an open Position — matches the story's entry point (row menu of a held Security); editing a closed Security's split is rare; Position detail (story 4.6) adds another entry.
  - `[low]` `[reject]` Blind: no feedback when a split has no effect (future-dated / before first buy) — future splits are legitimate; cosmetic, fix adds UI branches.
  - `[low]` `[defer]` Blind: UI layer (SplitDialog, QuantityText) barely tested — grouped with the dialog-test gap; QuantityText future-date case patched (see below); dialog interaction deferred (no DOM tooling, pre-existing as DW-3).
  - `[low]` `[reject]` Blind: splits loaded several times per render — single-user SQLite, negligible cost.
  - `[false]` `[reject]` Blind: AD-9 refetch / restore follow-ups not recorded — already acceptance criteria of stories 3.2 (refetch on split change) and 6.1 (export includes CorporateActions) in epics.md.
  - `[low]` `[reject]` Blind: saveSplitAction ignores securityId when editing — unreachable through the UI (dialog lists only its Security's splits), single-user app; adds a check + reason.
  - `[low]` `[reject]` Edge: available rounded up for reverse splits (same root cause as the first Blind finding) — rejected for the same reason.
  - `[low]` `[reject]` Edge: residue after reverse split prevents closing (same root cause as the second Blind finding) — rejected for the same reason.
  - `[low]` `[reject]` Edge: forward split makes an archived Depot hold a Position again (same as the archived-Depot Blind finding) — rejected for the same reason.
  - `[false]` `[reject]` Edge: a split reopening Positions in an active Depot without warning — that is the intended effect: the split applies in every Depot holding the Security and the Position then shows the correct holding.
  - `[low]` `[patch]` Verification gap: `listDepots` passing splits to the archive guard is untested — added `listDepots(db())` `archivable: true` assertion to the "archive and held set with splits" test.
  - `[low]` `[patch]` Verification gap: Buchungen `today` cut-off untested — added page test with a split dated 2099-01-01 asserting "10 Stück" and no "split-bereinigt".
  - `[low]` `[defer]` Verification gap: nothing checks recorded splits reach the split dialog — deferred (needs DOM test tooling); recorded in frontmatter `deferred`.
  - `[low]` `[defer]` Intent alignment: interactive menu/dialog path tested only via static rendering, server actions and ledger — same root cause as the dialog-test gap; deferred.
  - `[false]` `[reject]` Intent alignment: change uncommitted / status in-review — finalize commits the work and sets status done; the operator-actions clause does not apply (no human-only acceptance criteria).

## Design Notes

Factor for a row (`ratioOld:ratioNew`, e.g. `1:4`): `num = Π ratioNew`, `den = Π ratioOld` over splits of the same Security with `row.date < split.date <= asOf`. Quantity → `q × num / den`; price → `p × den / num`; amount, fee, tax unchanged → Cost Basis unchanged. Non-terminating results (e.g. `3:1` on 10 units) rely on `ExactDecimal` precision like the existing `averagePrice` division.

Sell guard basis: with `END = "9999-12-31"`, adjust all rows to the final basis, compute the running minimum as today, then `available = min / factor(position.date → END)` so the message stays in the units the user is typing for that date.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed, including new core and ledger tests.

**Manual checks (if no CLI):**
- `npm run dev`, record BUY 10 @ 400 in a Depot, add split 1:4 dated after it via the Position row menu: Positions show 40 units, average price 100 €; Transactions tab shows "40 Stück" with "split-bereinigt (gebucht: 10 Stück)".

## Auto Run Result

Status: done

**Summary:** Stock splits are recorded as Security-scoped `CorporateAction` rows (type SPLIT, date, ratio old:new) written only by `ledger`. Core adjusts BUY/SELL quantities and observed prices of rows dated before the split on read (one definition in `src/core/corporate-actions.ts`, exact scaled basis for guards/FIFO/flat checks); FIFO, Positions, sell guards and archive/held checks use it. Each Position row has a menu "Corporate Action → Split" opening a dialog to record, edit and delete splits; Buchungen show split-adjusted quantities with the booked quantity as caption.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261025190000_add_corporate_action/migration.sql` — CorporateAction model + migration.
- `src/core/corporate-actions.ts` (+ test) — ratio parsing, split adjustment and exact scaled basis.
- `src/core/fifo.ts`, `positions.ts`, `holdings.ts`, `archive.ts` (+ tests) — take `splits`.
- `src/modules/ledger/corporate-actions.ts` (+ test), `index.ts` — recordSplit/updateSplit/deleteSplit/listSplits with oversell guard.
- `src/modules/ledger/transactions.ts`, `positions.ts`, `depots.ts` — load and pass splits.
- `src/app/_actions/corporate-actions.ts` (+ test) — server actions.
- `src/app/_components/corporate-actions/SplitDialog.tsx`, `labels.ts` (+ test) — split dialog.
- `src/app/_components/positions/PositionsTable.tsx` (+ test), `src/app/_components/transactions/TransactionList.tsx`, `src/app/(app)/depots/[id]/page.tsx` (+ test) — row menu and adjusted display.

**Review findings:** 21 findings; 2 patched (both low: test gaps for `listDepots` archivable with splits and the Buchungen future-split cut-off); 3 deferred as one entry (SplitDialog interaction untested — no DOM test tooling); 16 rejected (7 false, 9 low not worth a non-trivial fix — reasons in the triage log).

**Follow-up review recommendation:** false — patched entries: high 0, medium 0, low 2.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all passed (50 files, 725 tests) after patches. Manual browser check not performed.

**Residual risks:** uneven reverse splits (e.g. 3:1 on non-divisible holdings) give non-terminating quantities: the sellable amount can be refused at 8 decimals and a fractional residue cannot be closed (workaround: book the cash-in-lieu SELL before the split). A split spanning an archived Depot's buy/sell can silently make it non-flat. Price-history refetch on split changes is due in Epic 3 (story 3.2).

