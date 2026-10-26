---
title: 'Depot Reconciliation and Holding Corrections (story 2-9)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '1a25a91eef1ebbe39b3b84518c2247e3bbe9f5bc'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tommy's migrated Depots differ from his broker statements in some holdings (trades after the Parqet export, an export ending early). He has no way to check every Position and the Cash Account against a statement, and the only way to fix a holding is a fake BUY/SELL that moves cash and books realized Gain/Loss.

**Approach:** A persisted reconciliation run per Depot (statement date, one row per Position held on that date plus the Cash Account, statement value + "stimmt" check, progress, finish) owned by the `ledger` module; a new Transaction type `ADJUSTMENT` ("Bestandskorrektur") that changes FIFO lots without cash or realized gain and counts at market value as an external flow in TTWROR/XIRR; cash differences are booked as DEPOSIT/WITHDRAWAL with the note "Kontoabgleich".

## Boundaries & Constraints

**Always:**
- **ADJUSTMENT shape (AD-14 amended):** `securityId` required; `quantity` signed, ≠ 0, ≤ 8 decimals; `price` = unit cost ≥ 0, required when quantity > 0, stored `null` when < 0; `amount`/`fee`/`tax` = "0". Cash effect 0 (`core/cash`).
- **One replay rule for every lot book:** `replayEvents` includes ADJUSTMENT rows with a Security; +q adds a lot of q costing `q × price` (dated at the row), −q consumes |q| from the oldest lots at their Cost Basis (`LotBook.sell`) and is never a sale (no `FifoSale`, no realized gain, not in `saleFees`). Applies in `core/fifo` (`applyTrade`), `core/holdings` (`applyEvent`, `firstOversell` treats a negative ADJUSTMENT like a SELL), `core/archive` (`netQuantities`) and `core/valuation`. Every ledger query that loads rows for a replay (`type: { in: ["BUY","SELL"] }` in `checkHoldings`, `checkActionHoldings`, `listHeldSecurities`, `listRealizedSales`) includes ADJUSTMENT; price observations (`lineageObservations`, `latestTradePrices`) stay BUY/SELL only — a unit cost is not a market price.
- **Holding guard:** a negative ADJUSTMENT beyond `sellableAt` its position is `sell-exceeds-holding` (message for ADJUSTMENT: "Korrektur übersteigt Bestand (x Stück)."); edits/deletes that break a later SELL/negative ADJUSTMENT are `later-sell-exceeds-holding` as today.
- **Returns (AD-10):** `ValuationPoint` gains optional `adjustmentValue` (signed Σ market value of the day's ADJUSTMENTs = quantity × the price the series uses for that Security that day, 0 without a price) and `adjustmentCost` (signed Cost Basis they added/removed); absent = "0"; `sumValuationSeries` sums them. `ttwror` counts a positive `adjustmentValue` as that day's inflow and a negative one as outflow; `periodCashFlows` adds it to the date's external flow; `periodPerformance` adds Σ `adjustmentValue` to `netExternalFlows` and subtracts Σ (`adjustmentValue − adjustmentCost`) from `unrealized`, so `gain = realized + unrealized + dividends − fees` stays exact and a correction alone changes neither gain nor TTWROR. `securityPerformance` does the same with its flows; `securityTotal` XIRR adds each ADJUSTMENT as investor flow −(quantity × resolver price as of its date, adjusted like `computePositions`; 0 without a price). `portfolioPerformance` works through the summed series.
- **Transaction note:** new nullable `Transaction.note` (≤ 200 chars, trimmed, empty → null) on `RecordTransactionInput`/`TransactionRecord`; `updateTransaction` keeps the stored note when `note` is undefined. The Transaction list and the cash bookings show it as a caption.
- **Manual form:** ADJUSTMENT is selectable last in the type list ("Bestandskorrektur"), sections security (required), date, quantity (signed, label "Stück (±)") and price (label "Einstandskurs je Stück", optional for a negative quantity); cash preview "+0,00 €"; split-adjusted quantity display like BUY/SELL.
- **Reconciliation storage (ledger, new Prisma migration):** `ReconciliationRun { id, depotId (cascade with Depot), statementDate, status OPEN|FINISHED, createdAt, finishedAt? }`, `ReconciliationRow { id, runId (cascade), securityId? (null = Cash Account), statementValue? (canonical decimal), checked }` with `@@unique([runId, securityId])` plus a service-level lookup for the cash row (SQLite NULLs are distinct). User-entered, never derived; app values are computed on read.
- **Ledger service** (`src/modules/ledger/reconciliation.ts`, all writes in one DB transaction, expected failures `{ ok: false, reason }`, archived Depot → `depot-archived`): `getReconciliation(depotId)` → open run view (statement date, rows, progress) or null, plus `lastReconciled` (statement date of the most recently finished run); `openReconciliation(depotId, statementDate, today)` (`date-invalid`, `date-in-future`, `run-open` when one is open); `saveReconciliationRow(runId, securityId | null, { statementValue?, checked? })` (`run-not-found`, `run-finished`, `value-invalid`: Position ≥ 0 and ≤ 8 decimals, cash any decimal); `finishReconciliation(runId, now)`; `bookReconciliationCorrection(runId, securityId | null, unitCost?)` books through `recordTransaction` (same tx, `allowDuplicate: true`) on the statement date: Position → ADJUSTMENT with quantity = statement − app, unit cost = `unitCost` or the Position's average purchase price on the statement date (`price-invalid` when neither exists); Cash → DEPOSIT (diff > 0) or WITHDRAWAL of |statement − app| (exact, unrounded) with note "Kontoabgleich"; `no-difference` when the row has no statement value or matches.
- **Pure core** `src/core/reconciliation.ts`: rows = Positions held on the statement date (quantity > 0, `computePositions` with no prices) ∪ Securities with a saved row (app quantity 0 if no longer held), sorted by Security name (de-DE) then the Cash row (`cashBalance` on the statement date). Row status: `reconciled` when checked or the statement value equals the app value (quantity exact; cash when |difference| < 0.005), `difference` when a value is entered and differs (difference = statement − app), else `open`. Progress `{ reconciled, total }`.
- **UI** (German, de-DE, no optimistic writes, modal depth ≤ 1, no hover-only actions, status never by colour alone): Depot detail gets a ⋮ menu (aria-label "Depot-Aktionen") with "Depot abgleichen" (non-archived only) linking to `/depots/[id]/reconcile`, and shows "Zuletzt abgeglichen am <dd.mm.yyyy>" and, while a run is open, a link "Abgleich fortsetzen (Stichtag …)". The reconcile page without an open run shows a "Stichtag" date input (default today, ≤ today) and "Abgleich starten"; with a run: header "Stichtag …" + "x von y abgeglichen", table rows (Wertpapier/Cash-Konto, "Laut App", statement input saved on blur/Enter, "stimmt" checkbox, status: ✅ "abgeglichen" / "Differenz +2 Stück" / "Differenz −12,34 €" / "offen"), on `difference` rows "Buchungen ansehen" (link `/securities/<id>?depot=<depotId>#security-transactions`; Position rows only) and "Korrektur buchen" (dialog: Position shows the signed quantity and, for +, the prefilled editable unit cost; Cash shows "Einzahlung"/"Auszahlung" amount and note "Kontoabgleich"); "Abgleich abschließen" asks once ("Noch n Zeilen offen. Trotzdem abschließen?") when rows are not reconciled, then returns to Depot detail. An archived Depot's page is read-only.
- **Duplicates on the Security detail:** `SecurityTransactions` marks rows that `matchDuplicates` (with the recorded ISIN changes) finds another matching row for with the caption "mögliches Duplikat".
- **Export/restore hand-off:** Epic 6 has no export yet; add "ReconciliationRuns with their rows" to the Story 6.1 export list in `epics.md` and to AD-12's export list so Epic 6 carries runs and ADJUSTMENT rows.

**Never:**
- No stored positions, balances or differences; no change to BUY/SELL/other types' semantics, the duplicate definition, migration/import parsers or their proposal type lists; no editing committed Prisma migrations.
- No export/restore implementation (Epic 6); no reconciliation of Securities the app never held on the statement date (book a BUY/delivery instead); no change of an open run's statement date (finish and start a new run).
- No real financial data; synthetic ISINs (`DE000SYNCA09`, `DE000SYNCB08`) only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Positive correction | BUY 10 @ 100 fee 0; ADJ +2 price 100 | Position 12, Cost Basis 1200, cash unchanged, no sale | — |
| Negative correction | BUY 10 @ 100 (d1), BUY 10 @ 120 (d2); ADJ −15 | 5 left, Cost Basis 600, realized 0 | — |
| Correction beyond holding | holding 5; ADJ −6 | not booked | `sell-exceeds-holding`, available 5 |
| Returns unaffected | deposit 1000, BUY 10 @ 100, price 100 throughout, ADJ +2 @ 100 | gain 0, TTWROR 0, netExternalFlows 200, identity holds | — |
| Cash sub-cent | app 100.004, statement 100,00 | row reconciled | — |
| Cash correction | app 100, statement 112,34 | DEPOSIT 12.34 note "Kontoabgleich" on statement date; row ✅ | — |
| Held position corrected to 0 | app 5, statement 0 → correction −5 | row stays (saved), app 0 = statement 0 → ✅ | — |
| Second run | run OPEN for Depot | none created | `run-open` |
| Finish with open rows | 2 of 5 open | confirm once, run FINISHED, "Zuletzt abgeglichen am" = statement date, next run empty | — |
| Future statement date | statementDate > today | none created | `date-in-future` |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- `TransactionType` enum :42 (+ADJUSTMENT), `Transaction` :71 (+`note String?`), `Depot` :22 (+`reconciliationRuns`), `Security` (+back-relation); new models after `CorporateAction`. New migration dir `prisma/migrations/20261027000000_reconciliation/` (generate with `prisma migrate diff`, `DATABASE_URL` at a temp file); rerun `npx prisma generate`.
- `src/core/corporate-actions.ts:134-143` `replayEvents` filter (add ADJUSTMENT); `LotBook.buy/sell` :231-261 reuse unchanged.
- `src/core/fifo.ts:36-47` `applyTrade` (ADJUSTMENT: +buy cost q×price, −`book.sell`, return null); doc comments :1-4, :52-61.
- `src/core/holdings.ts:29-36` `applyEvent`, :108-118 `firstOversell`.
- `src/core/archive.ts:30-40` `netQuantities` (duplicated buy/sell branch).
- `src/core/cash.ts:28-48` `effect` (ADJUSTMENT → 0; keep throwing on unknown types).
- `src/core/valuation.ts` -- `ValuationPoint` :20, `valuationSeries` :147-196 (compute the day's adjustment value with `prices.priceOn(row.securityId, day)` and cost while applying events), `sumValuationSeries` :221.
- `src/core/returns.ts` -- `inOutByDate` :71, `ttwror` :95, `periodCashFlows` :213, `periodPerformance` :259 (identity), `portfolioPerformance` :331.
- `src/core/security.ts` -- `securityPerformance` :99-141, `securityTotal` :280-330 (`investorFlows`), `securitySeries` :52 (spread keeps the new fields).
- `src/core/positions.ts` `computePositions` (average price on the statement date), `src/core/duplicates.ts` `matchDuplicates`, `src/core/format.ts` `formatQuantity`/`formatMoney`/`formatDate`.
- `src/modules/ledger/transactions.ts` -- `TRANSACTION_TYPES` :143, `RecordTransactionInput` :106, `validateTransaction` :194-268 (new ADJUSTMENT branch; `needsSecurity`), `checkHoldings` :318-346 (query types, negative ADJUSTMENT like SELL with |q|), `rowData` :400, `toRecord` :552, `TransactionRecord` :25 (+note), `updateTransaction` keeps note.
- `src/modules/ledger/corporate-actions.ts:142`, `depots.ts:213`, `positions.ts:153` -- replay queries add ADJUSTMENT; `positions.ts:55,:118` stay BUY/SELL.
- `src/modules/ledger/depots.ts:195` `deleteDepot` -- runs go by cascade (verify in test).
- `src/modules/ledger/index.ts` -- export the reconciliation service and types.
- `src/modules/ledger/security-detail.ts` -- history records (`SecurityTransactionRecord` has `depotId`) for the duplicate caption.
- `src/app/_actions/transactions.ts:57-89` `usedFields`/`figures` (ADJUSTMENT → quantity, price). New `src/app/_actions/reconciliation.ts` (session check, `revalidatePath("/", "layout")`, pattern of `depots.ts`/`transactions.ts`).
- `src/app/_components/transactions/` -- `labels.ts` (label "Bestandskorrektur", order, ADJUSTMENT messages/fields), `TransactionType.tsx` ICONS (e.g. `TuneOutlined`), `transaction-form.ts` `FORM_SECTIONS`/`initialValues`, `cash-preview.ts` `figures`, `TransactionDialog.tsx` (quantity/price labels for ADJUSTMENT), `TransactionList.tsx:68-83` `QuantityText` + note caption; `src/app/_components/cash/CashBookings.tsx` note caption.
- `src/app/(app)/depots/[id]/page.tsx` -- title row :153-163 (⋮ menu), info row :164-171 (last reconciled / continue link). New `src/app/(app)/depots/[id]/reconcile/page.tsx` and `src/app/_components/reconciliation/` (page view, row, correction dialog, labels.ts).
- `src/app/_components/security-detail/SecurityTransactions.tsx` + `src/app/(app)/securities/[id]/page.tsx` (pass ISIN changes) -- duplicate caption.
- Tests alongside each file (`*.test.ts(x)`, vitest; DB tests via `test/helpers`, see `src/modules/ledger/transactions.test.ts`); `test/architecture/core-imports.test.ts` keeps `src/core` pure.
- `_bmad-output/planning-artifacts/epics.md:861` and `ARCHITECTURE-SPINE.md:128` -- export lists (hand-off).

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + new migration -- ADJUSTMENT, `note`, reconciliation models.
- `src/core/corporate-actions.ts`, `fifo.ts`, `holdings.ts`, `archive.ts`, `cash.ts` (+ tests) -- ADJUSTMENT replay and zero cash effect; matrix rows 1-3.
- `src/core/valuation.ts`, `returns.ts`, `security.ts` (+ tests) -- adjustment value/cost per point, flows in TTWROR/XIRR/net flows/unrealized; matrix row 4, a negative-correction case, a correction without price, Portfolio sum, security period and total XIRR.
- `src/core/reconciliation.ts` (+ test) -- rows, status, difference, progress; matrix rows 5, 7.
- `src/modules/ledger/transactions.ts` and replay queries (+ tests) -- ADJUSTMENT validation/record/edit/delete, holding guard, note persisted and kept on edit.
- `src/modules/ledger/reconciliation.ts`, `index.ts` (+ test) -- service functions and failures; matrix rows 6, 8-10; correction default unit cost; Depot deletion removes runs.
- `src/app/_actions/reconciliation.ts`, `transactions.ts` (+ tests) -- actions.
- Transaction components (+ tests) -- type label/icon/form/preview/list note.
- Depot detail ⋮ menu and status lines, reconcile page and components, Security detail duplicate caption (+ render tests per project convention).
- `epics.md`, `ARCHITECTURE-SPINE.md` -- export hand-off.

**Acceptance Criteria:**
- Given a non-archived Depot, when I choose ⋮ "Depot abgleichen" and start a run for a statement date, then the page lists every Position held on that date plus the Cash Account with app value, statement input and "stimmt" check, shows "x von y abgeglichen", and entered values and checks are still there after a reload.
- Given a differing Position row, when I book the correction, then an ADJUSTMENT "Bestandskorrektur" appears in the Transaction history on the statement date with the signed difference, cash and realized Gain/Loss are unchanged, it can be edited and deleted like any Transaction, and the row shows ✅.
- Given a differing Cash row, when I book the correction, then a DEPOSIT or WITHDRAWAL with note "Kontoabgleich" is booked on the statement date and the row shows ✅.
- Given an open run, when I finish it (confirming once if rows are open), then Depot detail shows "Zuletzt abgeglichen am <statement date>" and the next run starts with no entries.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 26 findings — high 0, medium 1, low 21, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) No way to discard an open run started with a wrong Stichtag — spec excludes changing the date; finishing and starting a correct run overrides "Zuletzt abgeglichen" (most recently finished run wins); a discard needs new service/UI surface.
  - `[low]` `[reject]` (blind) "One open run" / "one cash row" enforced only in the service — single-user app, writes run in one DB transaction; a race needs two simultaneous submits; partial indexes are added complexity outside the Prisma schema.
  - `[low]` `[patch]` (blind) Negative correction blocked by a later SELL shows "Korrektur übersteigt Bestand (2 Stück)" next to 10 Stück — reworded to "Korrektur übersteigt den verfügbaren Bestand (höchstens N Stück, spätere Verkäufe eingerechnet)."
  - `[false]` `[reject]` (blind) A checked "stimmt" hides a differing statement value — the AC prescribes ✅ for a row "that I check"; the check is the user's explicit acceptance.
  - `[low]` `[patch]` (blind) `securityTotal` ignores ADJUSTMENT in `totalInvested`/`returnRatio` — positive corrections now add quantity × unit cost to `totalInvested` (test: 1160). The all-time unrealized keeps the corrected units at their unit cost (corrections stand for missing history), unlike the period figures which neutralise the jump.
  - `[low]` `[patch]` (blind) AD-14 text contradicts itself (quantity/price only BUY/SELL, securityId list, cash effect) and lacks `note` — AD-14 rule text corrected.
  - `[false]` `[reject]` (blind) sprint-status.yaml not updated — orchestrator-owned per the invocation.
  - `[low]` `[reject]` (blind) Depot detail replays the run on every render — single-user data volume; a light status query is new surface.
  - `[low]` `[reject]` (blind) `openReconciliation` takes `createdAt` from `new Date()` — only an ordering tiebreak, never shown; signature change for no user-facing harm.
  - `[low]` `[patch]` (blind) Cash row `value-invalid` message talks about Stück — cash rows now get "Bitte einen gültigen Betrag eingeben."
  - `[low]` `[reject]` (blind) Note not shown/editable in the edit dialog — note is shown in the Transaction and cash lists; an editor field is added complexity beyond the AC.
  - `[low]` `[patch]` (blind) Typing a value then clicking "stimmt" loses the click (checkbox disabled while the blur-save is pending) — `|| pending` dropped from the checkbox; whole-layout revalidation left as is (project-wide pattern).
  - `[low]` `[reject]` (blind) No tests combining splits/ISIN changes with corrections — consistent by construction: the reconciliation app value, the correction quantity and `investorFlows` all use units/prices as of the row's own date (`computePositions`/`securityPrice` as of that date).
  - `[low]` `[reject]` (edge) Concurrent "Abgleich starten" creates two open runs — same as the blind uniqueness row.
  - `[low]` `[patch]` (edge) `securityTotal` markup/invested — grouped with the blind `securityTotal` row; `totalInvested` patched.
  - `[low]` `[reject]` (edge) Cash dialog shows the rounded amount while the exact difference is booked — app-wide money display is cent-rounded; the booked row also displays rounded and the balance then equals the statement exactly (spec).
  - `[low]` `[reject]` (edge) Clearing the prefilled unit cost books the average price — the default is the AC's own value; a guard adds a branch for a rare action.
  - `[low]` `[reject]` (edge) ADJUSTMENT on an old Security after its ISIN change is priced 0 — reconciliation rows use the current Security; only a manual entry against a retired ISIN reaches it (same pre-existing pattern as SELL).
  - `[low]` `[patch]` (edge) Chained same-date ISIN changes missed in `runRows` name lookup — replaced the single pass with `securityLineage`.
  - `[medium]` `[patch]` (verification-gap) No DB-level `depotValuation`/`portfolioValuation` test with a positive ADJUSTMENT — added (adjustmentValue 200, adjustmentCost 160, gain/TTWROR 0).
  - `[low]` `[patch]` (verification-gap) Nothing checks the unit cost stays out of price observations — added (`latestTradePrices`/`listPositions` price 100 after +2 @ 80).
  - `[low]` `[patch]` (verification-gap) LOT_TYPES replay queries untested at DB level — added split refusal, `listHeldSecurities` and `listRealizedSales` cases.
  - `[low]` `[reject]` (verification-gap, other) `clampRoundingOversells` ADJUSTMENT branch untested — unreachable today (migration never produces ADJUSTMENT).
  - `[false]` `[reject]` (intent) Export/restore not built — no export exists yet (Epic 6 backlog); Story 6.1 and AD-12 now list reconciliation runs and ADJUSTMENT rows.
  - `[low]` `[reject]` (intent) Criteria verified by service/render tests, not a browser — project convention; real components and actions are rendered and exercised.
  - `[false]` `[reject]` (intent) Extra scope (note, signed quantity format) — the note is required by the AC ("with the note Kontoabgleich"), the signed format by the "Differenz +2 Stück" status.

## Design Notes

Why the series carries the correction: an external flow must equal exactly the value change the correction causes in the series, so it is priced with the same resolver call (`PriceCursor.priceOn`) on the same day; then `V(d) − flow` is untouched and TTWROR/gain see no jump. Identity check for +q at cost c, market value m: ΔV = m, flow m → gain 0; Δ(positionsValue − invested) = m − c, minus (m − c) → unrealized 0. For −q: ΔV = −m, flow −m, Δ(pv − inv) = −m + c, minus (−m + c) → 0.

Cash rows compare at half a cent (like `core/archive` `isFlat`) because BUY amounts are stored unrounded; the correction books the exact difference so the balance then equals the statement.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary.** New Transaction type `ADJUSTMENT` ("Bestandskorrektur"): signed quantity, unit cost for +, no cash effect; FIFO adds a lot (+) or removes the oldest units at Cost Basis without a sale (−), in every lot replay (FIFO, holdings guard, archive/held, valuation, migration clamp). The valuation series carries each correction's market value and moved Cost Basis, so TTWROR, XIRR, net external flows and unrealized (Depot, Portfolio, Security) treat it as an external flow and a correction alone changes neither gain nor TTWROR. A persisted reconciliation run per Depot (ledger-owned `ReconciliationRun`/`ReconciliationRow`): rows per Position held on the statement date plus the Cash-Konto, statement input, "stimmt", progress, "Korrektur buchen" (ADJUSTMENT at the average price by default, or DEPOSIT/WITHDRAWAL with note "Kontoabgleich"), "Buchungen ansehen", "Abgleich abschließen" with one confirmation, "Zuletzt abgeglichen am …" on Depot detail (⋮ "Depot abgleichen"). Transactions gained an optional `note`. The Security history marks possible duplicates. Export/restore hand-off recorded in Story 6.1 and AD-12.

**Files changed.**
- `prisma/schema.prisma`, `prisma/migrations/20261027000000_reconciliation/` — ADJUSTMENT, `Transaction.note`, reconciliation models.
- `src/core/corporate-actions.ts`, `fifo.ts`, `holdings.ts`, `archive.ts`, `cash.ts`, `rounding.ts` — ADJUSTMENT replay, zero cash effect.
- `src/core/valuation.ts`, `returns.ts`, `security.ts` — correction flows in the series and returns; `totalInvested`.
- `src/core/reconciliation.ts`, `src/core/format.ts` — run rows/status/progress; signed quantity format.
- `src/modules/ledger/transactions.ts`, `reconciliation.ts` (new), `positions.ts`, `depots.ts`, `corporate-actions.ts`, `cash.ts`, `valuation.ts`, `index.ts` — ADJUSTMENT validation/guard, note, reconciliation service, replay queries.
- `src/app/_actions/reconciliation.ts` (new), `transactions.ts` — server actions.
- `src/app/_components/reconciliation/*` (new), `depots/DepotActionsMenu.tsx` (new), `transactions/*`, `cash/CashBookings.tsx`, `security-detail/SecurityTransactions.tsx`; pages `depots/[id]`, `depots/[id]/reconcile` (new), `securities/[id]` — UI.
- `epics.md`, `ARCHITECTURE-SPINE.md` — export hand-off, AD-14 text; `epic-2-context.md` recompiled.
- Tests alongside (`src/core/adjustment.test.ts`, `reconciliation.test.ts`, ledger/action/component tests).

**Review findings.** 26 findings: 9 patched (1 medium, 8 low), 0 deferred, 17 rejected (4 false, 13 low) — reasons in the Review Triage Log above.

**Follow-up review recommendation:** false — patched entries: medium 1 (a missing DB-level test, now added), low 8; no high patched.

**Verification.** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (169 files, 2318 tests; build includes `/depots/[id]/reconcile`). All 10 I/O-matrix rows are covered by passing tests.

**Residual risks.** Not exercised in a real browser (render/DOM tests only). Loaders that feed ADJUSTMENT rows into a replay must select `price` (core throws otherwise; all current loaders do, DB-level valuation test added). No operator actions are owed.
