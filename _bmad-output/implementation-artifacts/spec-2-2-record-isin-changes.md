---
title: 'Record ISIN Changes (story 2-2)'
type: 'feature'
created: '2026-10-25'
baseline_revision: '3843caceac840ff727373b22f9efbaee1ca22d1d'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-record-stock-splits.md'
warnings: ['oversized']
deferred:
  - summary: >-
      IsinChangeDialog and the "Corporate Action → ISIN-Wechsel" menu item have no interaction test; only labels, the listing filter, server actions, ledger and static page rendering are tested.
    evidence: |-
      No jsdom/happy-dom/testing-library in the repo (same tooling gap as DW-3/DW-4). PositionsTable.test.tsx only counts the "Aktionen für …" buttons; the closed MUI Menu items and the dialog (record/edit/delete, error-to-field mapping) are never rendered in tests. Settle by adding DOM test tooling.
    location: >-
      src/app/_components/corporate-actions/IsinChangeDialog.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** When a Security is replaced by another (ISIN change, possibly with a ratio other than 1:1), the ledger cannot express it: the old Security stays an open Position forever, the new one has no lots, and a later sell of the new Security has no Cost Basis or is refused.

**Approach:** Extend `CorporateAction` with type `ISIN_CHANGE` (old Security, new Security, effective date, old quantity : new quantity), written only by `ledger`. Core replays each Depot's ledger as one chronological event stream (corporate actions before Transactions on the same date): an ISIN change moves the old Security's open FIFO lots — original purchase dates and Cost Basis kept, quantities × new/old — into the new Security. FIFO, Positions, price resolution, sell guards and flat/held checks all use that replay; `core/duplicates` resolves Securities through ISIN changes. The Position row menu gets "Corporate Action → ISIN-Wechsel" with a dialog to record (select or create the new Security), edit and delete ISIN changes.

## Boundaries & Constraints

**Always:**
- Stored Transactions and Prices are never modified (AD-7); everything is computed on read in pure `src/core` (decimal.js only, "today" passed in).
- Ordering (AD-8): events by date; on one date first splits, then ISIN changes (in the order given; the ledger passes them ordered by `(date, id)`), then Transactions by sequence. An action dated D affects only rows dated before D.
- ISIN change A→B on D (old quantity `o`, new quantity `n`, both decimals > 0, ≤ 8 decimal places): in every Depot, A's open lots at D move into B's lot queue with their original `(date, sequence)` and Cost Basis, quantity × n/o; B's queue stays ordered by `(date, sequence)` (moved and own lots merged). A's held quantity becomes 0 at D. A's SELLs before D stay sales of A.
- Exactness: quantities through splits and ISIN changes stay exact (no division until output, e.g. fractions of decimal products), so flat checks and selling a full holding work like story 2.1.
- Splits keep every 2.1 behavior; a split of a Security only affects lots while they are in that Security.
- Ledger writes: zod/typed validation, typed `{ ok: false, reason }`, one DB transaction, optional `db` param, nothing written on failure; a new Security only via `ensureSecurity` inside that transaction.
- Any corporate-action create/edit/delete (split or ISIN change) or Transaction write that would make a SELL in any Depot exceed the then-held quantity, where it did not before, is refused (`later-sell-exceeds-holding` + that SELL's date); guards see the whole ISIN-change lineage (selling A before D reduces what B holds after D).
- UI German, de-DE formats, Enter submits / Esc closes, modal depth 1, touch targets ≥ 44px, works at phone width.

**Never:**
- No Parqet import (2.3), no price-provider refetch (Epic 3), no new Transaction types, no Cash Account effect.
- No SQL arithmetic on decimals; no editing of committed migrations; no `Date.now()` in core.
- The Transaction list keeps showing A's rows as A (history visible); no re-labelling of stored rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1:1 change + partial sell | A: BUY 10 @ 100 (2024-01-02), BUY 10 @ 120 (2024-02-01); change A→B 1:1 on 2024-03-01; SELL B 15 @ 130 (2024-04-01) | sale cost 1600, gain 350; B lot 2024-02-01: 5 units, cost 600; no A Position | — |
| Non-1:1 change + partial sell | as above, change o=10 n=5; SELL B 7 @ 260 (2024-04-01) | B lots before sell: 5 (1000, 2024-01-02), 5 (1200, 2024-02-01); sale cost 1480, gain 340; remaining 3 units cost 720 | — |
| Positions / price after change | A: BUY 10 @ 100, change o=10 n=5 later, today after it | only B: quantity 5, Cost Basis 1000, price 200 (A's observation adjusted), value 1000 | — |
| B already held | B: BUY 4 (2023-06-01), A: BUY 10 (2022-01-03), SELL B 4 (2023-09-01); change A→B 1:1 (2024-03-01) | SELL B 2023 consumes only B's lot; after D B holds 10 (A's 2022 lot) | — |
| Same-date row | A: BUY 5 on D, change on D | BUY stays A (A Position 5) | — |
| Future change | change date > today | Positions/today views unaffected | — |
| Split then change | A: BUY 10, split 1:2, then change o=2 n=1 | B holds 10 units, same Cost Basis | — |
| Chain | A→B (D1, 1:1), B→C (D2, o=1 n=3) | A's lots in C × 3, original dates | — |
| Sell old after change | SELL A after D | `sell-exceeds-holding`, `available: "0"` | typed failure |
| Change would oversell | A: BUY 10, SELL A 5 after D, then record change on D | `later-sell-exceeds-holding` (date of that SELL) | nothing written |
| Delete with dependent sell | 1:1 change, SELL B 10 after D booked | delete → `later-sell-exceeds-holding` | nothing written |
| Validation | old = new; o or n `0`, `-1`, `abc`, >8 decimals; bad date; unknown ids; same old Security + date twice | `same-security`, `old-quantity-invalid`/`new-quantity-invalid`, `date-invalid`, `security-not-found`/`isin-change-not-found`, `isin-change-exists` | typed failure |
| Duplicate via old ISIN | ledger: DIVIDEND B 50 on 2024-05-01; change A→B before; candidate DIVIDEND A 50 same date/Depot | `duplicate` | advisory |
| Flat / held | A: BUY 10, change 1:1, SELL B 10 | Depot flat; neither A nor B held | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- `CorporateActionType` add `ISIN_CHANGE`; `CorporateAction` add `newSecurityId String?` + relation `newSecurity Security? @relation("IsinChangeTarget", ..., onDelete: Restrict)` (existing relation becomes named, e.g. `"CorporateActionSecurity"`; back-relations on `Security`), `@@index([newSecurityId])`. For ISIN_CHANGE, `securityId` = old Security and `ratioOld`/`ratioNew` hold the canonical old/new quantity (update the model comment). New migration `prisma/migrations/20261025200000_add_isin_change/migration.sql` (generate with `DATABASE_URL=file:<scratchpad>/x.db npx prisma migrate dev --create-only --name add_isin_change`, rename folder), then `npx prisma generate`.
- `src/core/corporate-actions.ts` -- currently splits only, with an "exact scaled basis" (`scaleTrades`, `splitScale`, `splitDivisor`, `ALL_SPLITS`) used by fifo/holdings/archive. Add `IsinChange = { oldSecurityId; newSecurityId; date; oldQuantity; newQuantity }`, `CorporateActions = { splits; isinChanges }`, `NO_CORPORATE_ACTIONS`, and the shared chronological replay (see Design Notes). Keep `parseSplitRatio`, `splitAdjustment` (Transaction list display, splits only) and a price helper that follows splits and ISIN changes (`row of A dated < D` → B, price × o/n). Remove helpers that become unused, with their tests.
- `src/core/fifo.ts:44` `fifo(rows, asOf, splits)` → `actions: CorporateActions`; built on the replay. Sale `quantity` = SELL quantity split-adjusted as of `asOf` for its own Security (as now).
- `src/core/positions.ts:27` `computePositions(..., splits)` → `actions`; observations adjusted to the Security/units they map to as of `today`.
- `src/core/holdings.ts` -- `sellableAt(trades, securityId, position, actions)` / `sellableQuantity(...)`: min over the future of the lineage's held quantity in the position's units; `firstOversell(trades, actions)` drops the `securityId` param: first SELL (any Security, ledger order) after which its Security's held quantity is negative.
- `src/core/archive.ts` -- `isFlat`/`canArchive`/`heldSecurities` take `actions`; net quantities from the replay.
- `src/core/duplicates.ts` -- `matchDuplicates(candidate, rows, isinChanges = [])`; compare `currentSecurity(id, isinChanges)` on both sides: follow changes from the Security in date order (each next change dated after the previous one) to the last.
- Core tests: extend `corporate-actions.test.ts`, `fifo.test.ts` (epic-required 1:1 and non-1:1 + partial sell), `positions.test.ts`, `holdings.test.ts`, `archive.test.ts`, `duplicates.test.ts`; existing calls pass `NO_CORPORATE_ACTIONS` / `{ splits, isinChanges: [] }`.
- `src/modules/ledger/corporate-actions.ts` -- 2.1 split CRUD + `loadSplits`. Replace `loadSplits` with `loadCorporateActions(db)` (all splits + ISIN changes ordered by `(date, id)`, filtered by `type`). Replace `checkHoldings` with one guard over all Depots' BUY/SELL rows (grouped by Depot) comparing `firstOversell` with the before/after action sets; use it for splits too. Add `IsinChangeRecord = { id; oldSecurity; newSecurity: SecuritySummary; date; oldQuantity; newQuantity }`, `recordIsinChange({ oldSecurityId, newSecurity: { id } | { new: NewSecurityInput }, date, oldQuantity, newQuantity }, db)`, `updateIsinChange(id, { date, oldQuantity, newQuantity }, db)` (Securities stay), `deleteIsinChange(id, db)`, `listIsinChanges(db)`. Reasons: `security-not-found | same-security | date-invalid | old-quantity-invalid | new-quantity-invalid | isin-change-exists | isin-change-not-found | later-sell-exceeds-holding | SecurityFailureReason`. Split functions must ignore ISIN_CHANGE rows (`split-not-found`) and vice versa. Validate quantities with `isDecimalString` + `QUANTITY_MAX_DECIMALS` like `transactions.ts:207`.
- `src/modules/ledger/transactions.ts:318` `checkHoldings` -- load all the Depot's BUY/SELL rows and `loadCorporateActions`; `sellableAt` for an added SELL, then `firstOversell(after) && !firstOversell(before)`. `checkDuplicates` (`:356`) passes `isinChanges`.
- `src/modules/ledger/positions.ts`, `depots.ts` (`toSummary`, `archiveDepot`, `listHeldSecurities`, `listDepots`, `getDepot`) -- pass `loadCorporateActions` results.
- `src/modules/ledger/index.ts` -- export new functions/types.
- `src/modules/ledger/corporate-actions.test.ts` -- temp-DB pattern (`test/helpers/test-db.ts`); add ISIN-change cases; `transactions.test.ts`/`positions.test.ts`/`depots.test.ts` cover sell guard, Positions and archive across a change.
- `src/app/_components/transactions/TransactionDialog.tsx:59-83` -- move `SecurityOption`, `NEW_OPTION`, `optionLabel`, `filterSecurityOptions` to `src/app/_components/securities/security-options.ts` and import them in both dialogs.
- `src/app/_actions/corporate-actions.ts` (+ test) -- add `saveIsinChangeAction` (create without `isinChangeId`, else update) and `deleteIsinChangeAction`; parse quantities with `parseDecimalInput` (unparseable → `old-quantity-invalid`/`new-quantity-invalid`); new Security fields as in `src/app/_actions/transactions.ts:59` `newSecurityInput`; session check, `revalidatePath("/", "layout")` on success.
- `src/app/_components/corporate-actions/IsinChangeDialog.tsx` (new) + `labels.ts` (+ test) -- title "ISIN-Wechsel – {name}"; fields "Neue Security" (Autocomplete of other Securities + "Neue Security anlegen" → "ISIN oder Krypto-Symbol", "Name", "Art"), "Gültig ab", "Alte Stückzahl", "Neue Stückzahl"; list "Erfasste ISIN-Wechsel" (changes where this Security is old or new: date, "Alt → Neu", `o : n` via `formatQuantity`) with Bearbeiten (date + quantities) / Löschen with inline confirmation; German message per reason. Mirror `SplitDialog.tsx`.
- `src/app/_components/positions/PositionsTable.tsx:316` -- second menu item "Corporate Action → ISIN-Wechsel"; new props `isinChanges: IsinChangeRecord[]`, `securities: SecuritySummary[]`.
- `src/app/(app)/depots/[id]/page.tsx:62` -- load `listIsinChanges()` and pass with `securities`; tests via `test/helpers/render-text.ts`.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + new migration -- ISIN_CHANGE storage -- AD-7.
- `src/core/corporate-actions.ts`, `fifo.ts`, `positions.ts`, `holdings.ts`, `archive.ts`, `duplicates.ts` + tests -- replay with lot moves, all I/O matrix core rows -- correctness on read, AD-15.
- `src/modules/ledger/corporate-actions.ts`, `transactions.ts`, `positions.ts`, `depots.ts`, `index.ts` + tests -- ISIN-change CRUD, shared guard, actions passed everywhere -- only ledger writes.
- `src/app/_components/securities/security-options.ts`, `TransactionDialog.tsx` -- shared Security option helpers.
- `src/app/_actions/corporate-actions.ts` + test -- server actions.
- `src/app/_components/corporate-actions/IsinChangeDialog.tsx`, `labels.ts` + test, `PositionsTable.tsx` + test, `src/app/(app)/depots/[id]/page.tsx` + test -- user surface.

**Acceptance Criteria:**
- Given an open Position, when I open its row menu, then "Corporate Action → ISIN-Wechsel" opens the ISIN-change dialog for that Security.
- Given I select an existing or new Security and enter date, old and new quantity, when saving succeeds, then exactly one CorporateAction (ISIN_CHANGE) links old and new Security (a new Security created via `ensureSecurity`), no Transaction changes, and the Depot page shows the new Security's Position with the moved Cost Basis and no Position of the old Security, while the Transactions tab still lists the old Security's rows.
- Given a recorded ISIN change, when I edit or delete it in the dialog, then the next page load reflects it; a change that would oversell a SELL is refused with a German message naming that SELL's date.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 18, false 7, maybe-false 0
- findings:
  - `[false]` `[reject]` Blind: Depot-wide `firstOversell(after) && !firstOversell(before)` lets an existing oversell of one Security mask new ones — every ledger write path (Transactions, splits, ISIN changes) refuses to create an oversell, so the "before" state never contains one (same refutation as story 2.1).
  - `[low]` `[reject]` Blind: cyclic changes (A→B then B→A) not refused — replay handles them deterministically (date, then id order); rare; fix adds reachability validation and a new reason.
  - `[low]` `[reject]` Blind: `currentSecurity` does not follow a same-date chain A→B, B→C that the replay follows — two chained changes on one date are very rare; a `>=` fix needs loop protection (more than a direct correction); duplicates are advisory.
  - `[low]` `[reject]` Blind: `currentSecurity` ignores row dates (false duplicate for same-amount A and B rows on one pre-change date) — intended per AD-15 (an incoming old ISIN dated after the change must resolve to the current Security); collision is rare and advisory only.
  - `[false]` `[reject]` Blind: ISIN_CHANGE row with null `newSecurityId` silently dropped / crashes the dialog — only `recordIsinChange` writes such rows and it always sets `newSecurityId`; the state is unreachable.
  - `[low]` `[defer]` Blind: spec'd tests missing (PositionsTable menu item, IsinChangeDialog, ledger guard/Positions/archive in transactions/positions/depots tests) — ledger cases exist in `corporate-actions.test.ts` (sell guard, Transaction edit lineage guard, Positions, archive); the UI interaction gap is real → deferred (no DOM test tooling).
  - `[false]` `[reject]` Blind: same-date A-adjusted and B price observations resolved by input order — `resolvePrice` orders by `(date, sequence, id)`, deterministic regardless of input order.
  - `[low]` `[reject]` Blind: guards load and replay all BUY/SELL rows per write — single-user SQLite, negligible cost.
  - `[low]` `[reject]` Blind: no hint that the old Security was replaced when selling it after the change — UX nicety; correct refusal (`available 0`) already given; fix adds UI branches.
  - `[low]` `[reject]` Blind: ISIN change only recordable from an open Position — matches the story's entry point (Position row menu); Position detail (story 4.6) adds another.
  - `[low]` `[patch]` Blind: raw invisible U+FFFF in `PENDING_SECURITY_ID` — rewritten as `"\uffffpending-security"`.
  - `[low]` `[patch]` Blind: relative import placed between alias imports in `src/app/_actions/transactions.ts`; over-long `checkDuplicates` comment — import moved after `@/modules/ledger`, comment rewrapped.
  - `[false]` `[reject]` Edge: Depot-wide oversell masking — same refutation as the Blind finding (no write path creates an oversell).
  - `[low]` `[reject]` Edge: same-date chain in `currentSecurity` — same as the Blind finding.
  - `[low]` `[reject]` Edge: resolve only changes after the row date — same as the Blind finding (contradicts AD-15's incoming-old-ISIN case).
  - `[false]` `[reject]` Edge: null `newSecurityId` dropped — unreachable, as above.
  - `[low]` `[reject]` Edge: target Security already replaced earlier (lots land on a dead ISIN) — user picks a replaced Security as target; rare; fix adds validation and a reason.
  - `[low]` `[defer]` Edge: PositionsTable test does not cover the ISIN-Wechsel menu item — grouped with the UI interaction gap; deferred.
  - `[low]` `[reject]` Edge: duplicate resolution differs from replay — same root causes as the same-date-chain / row-date findings.
  - `[false]` `[reject]` Edge: split/ISIN edits can create an oversell under an existing one — same refutation (no prior oversell exists).
  - `[low]` `[patch]` Verification gap: `listPositions` lineage price loading untested — added ledger test pricing B from its own later BUY in another Depot (price 150, value 1500).
  - `[low]` `[patch]` Verification gap: price through an A→B→C chain untested — added `adjustedPrice` chain test (price 400) and `computePositions` C Position test.
  - `[false]` `[reject]` Verification gap (other): Depot-wide guard — same refutation as above.
  - `[low]` `[defer]` Intent alignment: row menu → dialog path checked only via server actions and button presence — same UI tooling gap; deferred.
  - `[low]` `[reject]` Intent alignment: duplicates resolve by Security id, not raw ISIN string — mapping an incoming ISIN string to a Security is the importer's lookup (2.3); core resolution through ISIN changes is in place and tested.

## Design Notes

Replay (one Depot): build events `[...actions dated ≤ asOf, ...rows dated ≤ asOf]` sorted by date, then kind (split < ISIN change < Transaction), then sequence / given order. Keep per Security an ordered lot queue (FIFO) or a net quantity (guards, flat/held), each quantity an exact fraction:

```
split X old:new      → every quantity of X: num × new, den × old
change A→B (o, n)    → each A lot: num × n, den × o; merge into B by (date, sequence); A empty
BUY X q              → push lot q/1 ; SELL X q → consume from X's queue (compare num vs q × den)
```

`sellableAt` for a SELL of S at p: lineage = S, g = 1 (units per p-unit); minimum starts at held(S) just before p; after each later event follow splits/changes of the lineage Security (`g × new/old`, lineage = B on a change) and take `min(held(lineage) / g)`; result ≥ 0, divided once on output.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed, including the new core, ledger, action and component tests.

**Manual checks (if no CLI):**
- `npm run dev`: BUY 10 @ 100 of A, row menu → ISIN-Wechsel → new Security B, 10 → 5: Positions show only B (5 Stück, Einstand 1.000 €); Buchungen still list A's Kauf.

## Auto Run Result

Status: done

**Summary:** ISIN changes are recorded as `CorporateAction` rows of type ISIN_CHANGE (old Security, new Security, date, old:new quantity) written only by `ledger`. Core replays each Depot's ledger as one event stream (splits, then ISIN changes, then Transactions per date) with an exact lot book: an ISIN change moves the old Security's open lots (original dates and Cost Basis, quantities × new/old) into the new Security, merged by purchase date. FIFO, Positions (prices carried over), sell guards (lineage-aware), archive/held checks and `core/duplicates` (old Security resolved to its current one) use it. The Position row menu offers "Corporate Action → ISIN-Wechsel" with a dialog to record (select or create the new Security), edit and delete changes.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261025200000_add_isin_change/` — ISIN_CHANGE type + `newSecurityId`.
- `src/core/corporate-actions.ts` (+ test) — replay, `LotBook`, `adjustedPrice`; old split-only scaled-basis helpers removed.
- `src/core/fifo.ts`, `positions.ts`, `holdings.ts`, `archive.ts`, `duplicates.ts` (+ tests) — take `CorporateActions`; lineage guards; ISIN resolution.
- `src/modules/ledger/corporate-actions.ts` (+ test), `transactions.ts`, `positions.ts`, `depots.ts`, `index.ts` — ISIN-change CRUD, shared all-Depot guard, actions loaded everywhere.
- `src/app/_actions/corporate-actions.ts` (+ test), `new-security-input.ts`, `transactions.ts` — server actions, shared new-Security parsing.
- `src/app/_components/corporate-actions/IsinChangeDialog.tsx`, `form-fields.ts`, `labels.ts` (+ test), `securities/security-options.ts`, `transactions/TransactionDialog.tsx`, `positions/PositionsTable.tsx`, `src/app/(app)/depots/[id]/page.tsx` (+ test) — UI.

**Review findings:** 25 findings; 4 patched (all low: U+FFFF escape, import order/comment wrap, two price-resolution test gaps); 3 deferred as one entry (UI interaction tests — no DOM tooling); 18 rejected (7 false, 11 low not worth a non-trivial fix — reasons in the triage log).

**Follow-up review recommendation:** false — patched entries: high 0, medium 0, low 4.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all passed (50 files, 786 tests) after patches. Manual browser check not performed.

**Residual risks:** same-date chained ISIN changes resolve differently in duplicates than in the replay; cyclic changes and targets that were themselves replaced are not refused; non-terminating ratios show rounded quantities (as with uneven splits); the dialog and menu have no interaction test.
