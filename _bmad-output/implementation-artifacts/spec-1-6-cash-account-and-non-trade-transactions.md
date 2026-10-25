---
title: 'Story 1.6: Cash Account and Non-Trade Transactions'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '97797170954d1397b14e6f3e7efa079b35f185b7'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Only buys and sells can be booked; dividends, fees, taxes, deposits and withdrawals cannot, the Cash Account balance is a hard-coded `"0"`, the "Cash-Konto" tab is a placeholder and the Positions table has no Cash row, so value moving between Positions and cash is not explainable.

**Approach:** Add pure `core/cash` (one cash-effect formula per AD-14 type plus a running balance), extend the ledger write path to all seven types, compute every Depot's `cashBalance` from its Transactions, let the Transaction form adapt to all types with a live cash effect, and render the Cash Account tab (balance + booking history) and a pinned Cash row in the Positions table.

## Boundaries & Constraints

**Always:**
- `src/core/cash.ts` is the single cash definition (AD-6/AD-14): `cashEffect(row)` with BUY `−(amount+fee+tax)`, SELL/DIVIDEND `+amount−fee−tax`, FEE `−fee`, TAX `−tax`, DEPOSIT `+amount`, WITHDRAWAL `−amount`; a negative tax (refund) raises cash. `cashBookings(rows)` returns entries in `(date, sequence)` order (via `compareLedgerOrder`) each with `cashEffect` and `balance` (running, after the entry); `cashBalance(rows, asOf)` = sum of effects of rows with `date ≤ asOf`. Pure, `ExactDecimal`, canonical strings; no JS `number`.
- Ledger write path (only `src/modules/ledger` writes): new `recordTransaction(input, db?)` accepting all seven types, same contract as `recordTrade` (validate, resolve/create Security only after all checks, append sequence per Depot+date, one DB transaction, typed `{ ok: false, reason }` failures, nothing written on failure). BUY/SELL keep today's rules unchanged, including the sell guard. Non-trade rules, normalised to AD-14 (`quantity`/`price` null):
  - DIVIDEND: Security required (existing or new); `amount` > 0; `tax` signed (default 0); `fee` ≥ 0 (default 0).
  - FEE: `fee` > 0; `amount = 0`, `tax = 0`; Security optional.
  - TAX: `tax` ≠ 0 (negative = refund); `amount = 0`, `fee = 0`; Security optional.
  - DEPOSIT/WITHDRAWAL: `amount` > 0; `fee = 0`, `tax = 0`; a supplied Security → `security-not-allowed`.
  - No balance guard: cash may go negative.
  `recordTrade` stays exported and behaves as before (BUY/SELL only, other types `type-invalid`), delegating to the shared code.
- `DepotSummary.cashBalance` (getDepot, listDepots, create/rename results) = `cashBalance(transactions, today)` where today is `businessDate(new Date())` computed in the module; `listDepots` must not run one query per Depot.
- `ledger.listCashBookings(depotId, db?)`: read-only; the Depot's bookings newest first, each `{ id, type, date, sequence, security: SecuritySummary | null, cashEffect, balance }`.
- Form (German, decimal comma, controlled inputs, Enter submits): type chosen first from all seven types (Kauf, Verkauf, Dividende, Gebühr, Steuer, Einzahlung, Auszahlung; a ToggleButtonGroup that wraps or a select — touch targets ≥ 44 px). Fields per type: BUY/SELL unchanged (Security, Datum, Stück, Kurs, Gebühren, Steuern); DIVIDEND: Security (required), Datum, "Bruttobetrag", "Steuern"; FEE: "Betrag", Security (optional), Datum; TAX: "Betrag" with helper "Negativ = Erstattung", Security (optional), Datum; DEPOSIT/WITHDRAWAL: "Betrag", Datum. Hidden fields are not submitted. Below the fields a live line "Cash-Effekt: <signed money>" (`formatMoney(…, { sign: true })`, `aria-live="polite"`) computed with `core/cash` from the parsed inputs (BUY/SELL amount = Stück × Kurs); "–" while required inputs are empty or unparseable. Server action maps form fields to `recordTransaction` and revalidates `/` (layout) on success; every new failure reason has a German message and field mapping.
- Cash Account tab ("Cash-Konto"): balance card "Saldo" with `cashBalance` as of today, then the booking history newest first as a semantic table: Datum, Art (type icon + label), Security (logo + name, empty for none), "Cash-Effekt" (signed, gain/loss text color plus sign, never color alone), "Saldo" (running). Depot without Transactions → same empty state as the other tabs ("Noch keine Buchungen." + the only "Neue Buchung").
- Positions tab: when Positions are shown, a Cash row is pinned below all sorted rows (desktop table and phone stacked rows), never sorted: wallet icon (`aria-hidden`) + "Cash-Konto", value = current balance in the Wert column, other cells empty; visually distinct via a `palette.cash.main` left border / soft background. 
- Transaction list (Buchungen): a type icon per type (no cart for non-trades), "Betrag" shows the event value (amount; fee for FEE; tax for TAX), and a new "Cash-Effekt" column (signed); empty Security cell for none.
- Figures with tabular numerals; de-DE formats via `src/core/format.ts`.

**Never:**
- No schema change or migration (all types and columns exist); no stored balance; no Prisma outside `src/modules/ledger` and `src/db`.
- No edit/delete, duplicate warning, archive guard or `heldSecurities` (stories 1.7, 1.8); no KPI cards, Overview totals or composition (Epic 4); no per-share dividend entry.
- No edits to `sprint-status.yaml`; synthetic test data only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| BUY effect | amount 1000, fee 5, tax 0 | `-1005` | — |
| SELL effect | amount 1560, fee 3, tax 10 | `1547` | — |
| DIVIDEND effect | amount 50, tax 12.5 | `37.5`; with tax `-2` (refund) → `52` | — |
| FEE / TAX effect | FEE fee 4.9; TAX tax 7; TAX tax -3.5 | `-4.9`; `-7`; `3.5` | — |
| DEPOSIT / WITHDRAWAL | amount 2000; amount 300 | `2000`; `-300` | — |
| Running balance | DEPOSIT 2000 (01-05), BUY 10 @ 100 fee 5 (01-10), DIVIDEND 50 tax 12.5 (03-01), FEE 4.9 (03-02), TAX -3.5 (03-03), WITHDRAWAL 300 (03-04), passed shuffled | balances `2000`, `995`, `1032.5`, `1027.6`, `1031.1`, `731.1`; Saldo `731,10 €` | — |
| Future-dated | above + DEPOSIT 100 dated after today | listed in history; current balance stays `731.1` | — |
| Overdraw | WITHDRAWAL larger than balance | booked; negative balance shown `-…` | — |
| Invalid non-trade | DIVIDEND without Security; DEPOSIT amount 0; FEE 0; TAX 0; DEPOSIT with Security | not written | `security-required`; `amount-invalid`; `fee-invalid`; `tax-invalid`; `security-not-allowed` |
| Live effect | form BUY Stück `10`, Kurs `100`, Gebühren `4,90` | "Cash-Effekt: −1.004,90 €" | empty Stück → "–" |

</intent-contract>

## Code Map

- `src/core/ledger-order.ts` -- `compareLedgerOrder`; reuse for cash ordering.
- `src/core/decimal.ts` -- `ExactDecimal`, `canonicalDecimal`, `isDecimalString`.
- `src/core/decimal-input.ts` -- `parseDecimalInput` (German input, signed); pure, usable in the client for the live effect.
- `src/core/format.ts:51` -- `formatMoney(v, { sign })`; `formatDate`.
- `src/modules/ledger/transactions.ts` -- `validateTrade`/`writeTrade`/`recordTrade`, `TradeFailureReason`, `decimal()` helper, `TRANSACTION_INCLUDE`, `toRecord`, `listTransactions`; generalise into `recordTransaction` here (keep the security resolve-then-create order and sequence assignment).
- `src/modules/ledger/depots.ts:62` -- `toSummary` returns constant `cashBalance: "0"` (comment announces this story); `getDepot`, `listDepots`, `createDepot`, `renameDepot` use it.
- `src/modules/ledger/index.ts` -- re-export `recordTransaction`, `listCashBookings` and new types.
- `src/modules/ledger/positions.ts` -- pattern for a read service with `db: LedgerDb = prisma`.
- `src/app/_actions/transactions.ts` -- `recordTradeAction`, zod `tradeForm`, `FIELD_REASONS`, `newSecurityInput`; extend for an `amount` field and all types (calls `recordTransaction`).
- `src/app/_components/transactions/form-fields.ts` -- `TRADE_FIELDS` (add `amount`).
- `src/app/_components/transactions/labels.ts` -- `TRANSACTION_TYPE_LABELS`, `MESSAGES`/`FIELDS` maps (`type-invalid` message mentions only Kauf/Verkauf — update), `TransactionField`.
- `src/app/_components/transactions/TransactionDialog.tsx` -- `TransactionForm` (type toggle limited to BUY/SELL, `decimalField`, Autocomplete with "Neue Security anlegen"); adapt fields per type and add the live cash line.
- `src/app/_components/transactions/TransactionList.tsx` -- `TypeCell` (cart/sell icons only), columns; add cash effect.
- `src/app/_components/positions/PositionsTable.tsx` -- desktop table + phone stacked rows sharing sort state; add the pinned Cash row (new prop `cashBalance`).
- `src/app/(app)/depots/[id]/page.tsx` -- tab content; `cash` currently the placeholder branch; header already shows `depot.cashBalance`.
- `src/app/(app)/depots/[id]/page.test.tsx:107` -- placeholder `it.each` for `cash` must go; `recordTrade` setup pattern.
- `src/theme/theme.ts` -- `palette.cash` (`main`, `contrastText`), `palette.gain/loss` (`main`, `soft`).
- `test/helpers/render-text.ts`, `test/helpers/migrated-db-file.ts`, `test/helpers/test-db.ts` -- server render and temp-DB helpers.

## Tasks & Acceptance

**Execution:**
- `src/core/cash.ts` (+ test) -- `cashEffect`, `cashBookings`, `cashBalance`; tests cover every type's formula, tax refunds (DIVIDEND and TAX), the running-balance and future-dated matrix rows, exact strings.
- `src/modules/ledger/transactions.ts` (+ test) -- `recordTransaction` per the rules; `recordTrade` delegates; tests for each type's happy path (stored AD-14 shape: quantity/price null, amount 0 for FEE/TAX), each invalid matrix row, new Security on a DIVIDEND, sequence shared with trades on the same date, BUY/SELL tests unchanged.
- `src/modules/ledger/cash.ts` (+ test) -- `listCashBookings`; `src/modules/ledger/depots.ts` (+ test) -- real `cashBalance` (incl. future-dated exclusion, `listDepots` with several Depots); `index.ts` exports.
- `src/app/_components/transactions/form-fields.ts`, `labels.ts` (+ test), `src/app/_actions/transactions.ts` (+ test) -- amount field, messages and field mapping for every reason, action passes per-type values (e.g. DEPOSIT "Betrag" → amount, FEE → fee, TAX → tax, DIVIDEND Bruttobetrag/Steuern) to `recordTransaction`.
- `src/app/_components/transactions/cash-preview.ts` (+ test) -- pure `cashPreview(type, inputs)` → signed formatted text or "–", used by the form; covers the live-effect matrix row and each type.
- `src/app/_components/transactions/TransactionDialog.tsx` -- all types, adaptive fields, live line.
- `src/app/_components/cash/CashBookings.tsx` -- balance card and history table.
- `src/app/_components/transactions/TransactionList.tsx`, `src/app/_components/positions/PositionsTable.tsx` (+ test) -- icons, value and cash-effect columns; pinned Cash row in both layouts, stays last after any sort.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- Cash-Konto tab content and empty state; Positions pass the balance; tests: running-balance matrix rendered on the Cash-Konto tab (Saldo `731,10 €`, entries newest first with `+2.000,00 €` … `−300,00 €`), header Cash-Konto shows the real balance, Cash row is last in Positionen, Buchungen shows non-trade rows with their cash effect.

**Acceptance Criteria:**
- Given a Depot, when Dividende, Gebühr, Steuer, Einzahlung or Auszahlung is chosen in "Neue Buchung", then only that type's fields show, the cash effect updates live, and "Buchen" stores the Transaction and the dialog closes.
- Given booked Transactions, when `/depots/<id>?tab=cash` opens, then the current Saldo and the booking history with each entry's cash effect and running Saldo show; the Depot header, Depots list and the Positions Cash row show the same balance.
- Given the Positions table, when any sort is applied, then the Cash row stays at the bottom and looks distinct.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 24 findings — high 0, medium 0, low 22, false 2, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) the last submit's error survives a type switch (BUY quantity error shown as Alert on Einzahlung) — failure now shown only while the current type equals the submitted type (`errorPlacement` in new `transaction-form.ts`).
  - `[low]` `[reject]` (blind) live preview shows a figure for inputs the ledger rejects (DEPOSIT 0/negative, FEE 0, negative Kurs) — spec asks "–" only for empty/unparseable input; the ledger still rejects with a field message on submit; adding per-type sign rules duplicates ledger validation for a rare typo.
  - `[low]` `[reject]` (blind) Cash history gives no hint for future-dated rows whose running Saldo exceeds the card — Design Notes choose as-of-today balance with all rows listed; a marker is new UI (needs `today` plumbing) for a rare case.
  - `[low]` `[reject]` (blind) page `today` and `depots.ts` `businessDate(new Date())` are computed separately — only differs for a request straddling Berlin midnight; fixing adds an `asOf` parameter to every Depot read.
  - `[low]` `[patch]` (blind) a Depot with Transactions but no open Positions shows no Cash row on Positionen — PositionsTable is now always rendered; with no Positions it shows a "Keine offenen Positionen." row above the pinned Cash row (both layouts); tests for a cash-only and an all-sold Depot.
  - `[low]` `[reject]` (blind) unknown type with unparseable amount returns `amount-invalid` instead of `type-invalid` — the form only submits the seven types; a hand-crafted POST still gets a typed failure and nothing is written.
  - `[low]` `[reject]` (blind) stray quantity/price on non-trades are dropped while stray fee/tax/amount are rejected; non-string Security ids count as none — documented on `RecordTransactionInput` ("ignored"); all callers are typed in-repo code passing strings; importers (Epic 5) normalise to AD-14 first.
  - `[low]` `[reject]` (blind) per-type field mapping exists in action, preview, dialog and labels — sections/error routing now live in one tested helper (patch above); the remaining action/preview `figures` duplication is two short switches covered by their own tests.
  - `[low]` `[reject]` (blind) `TRANSACTION_TYPE_ORDER` duplicates the ledger's `TRANSACTION_TYPES` — the client form cannot import ledger runtime values (would pull Prisma into the client bundle); `Record<TransactionType, …>` tables are type-checked complete.
  - `[low]` `[patch]` (blind) TransactionDialog untested; DepotList balance only module-tested — grouped with the verification-gap row (helper + table tests); DepotList only formats `depot.cashBalance`, which `depots.test.ts` covers.
  - `[low]` `[reject]` (blind) Cash-Konto tab reads the Depot's rows three times — a single user's Depot; same pattern accepted in story 1.5; merging changes service signatures.
  - `[low]` `[reject]` (blind) `initialSort` test-only prop; Cash row cells derived from sort keys — every column is a sort key today; the prop is optional and harmless.
  - `[low]` `[patch]` (edge) Cash row missing without open Positions — same root cause as the blind row; fixed there.
  - `[low]` `[reject]` (edge) preview accepts 0/negative values — duplicate of the blind preview row.
  - `[low]` `[reject]` (edge) unknown type + bad amount → `amount-invalid` — duplicate of the blind row.
  - `[low]` `[reject]` (edge) FEE/TAX with non-string Security id silently booked without Security — duplicate of the blind stray-input row.
  - `[low]` `[reject]` (edge) DEPOSIT with an invalid new ISIN reports `isin-invalid` instead of `security-not-allowed` — the form never sends a Security for DEPOSIT; still rejected, nothing written.
  - `[low]` `[reject]` (edge) two "today" computations around midnight — duplicate of the blind row.
  - `[false]` `[reject]` (edge, claim) spec shows typographic minus `−300,00 €` but UI renders `-300,00 €` — the spec mandates `formatMoney`, which emits a hyphen-minus project-wide (stories 1.4/1.5); fix would edit this spec.
  - `[low]` `[patch]` (edge, claim) header/list/Cash row "same balance" fails for a cash-only Depot — same root cause as the Cash-row patch.
  - `[low]` `[patch]` (verification-gap) the type-adaptive dialog (sections, hidden fields, error routing) had no test — extracted `transaction-form.ts` (sections, visible fields, Security requirement, `errorPlacement`) used by the dialog, with a table-driven test over all seven types.
  - `[low]` `[patch]` (intent) AC1 verified only at pure-function/action level, not the rendered dialog — same root cause as the verification-gap row; no DOM test setup exists, so the logic moved into the tested helper.
  - `[low]` `[patch]` (intent) cash-but-no-Positions shows no Cash row — same root cause as the Cash-row patch.
  - `[false]` `[reject]` (intent) "visually distinct" only checked by marker attribute and icon — distinctness is a styling property (cash border + tint) that static render tests cannot judge; no defect claimed in the rendering itself.

## Design Notes

Current balance is as of today (future-dated rows excluded), matching Positions; the history still lists future rows so nothing booked is hidden. FEE/TAX use their own column as the value (AD-14 puts the standalone value in `fee`/`tax` with `amount = 0`), so the form's single "Betrag" field maps to `fee` or `tax` for those types.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0 (build with a scratch `DATABASE_URL`)
- `npm run dev` with synthetic auth env and a scratch `DATABASE_URL`; book the running-balance matrix, fetch `/depots/<id>?tab=cash` -- expected: Saldo `731,10 €` and six history rows

**Manual checks (if no CLI):**
- Form type switch hides/shows fields; Cash row distinct on phone layout.

## Auto Run Result

Status: done

**Summary:** All seven Transaction types can be booked. New pure `core/cash` (`cashEffect`, `cashBookings`, `cashBalance`) is the single AD-14 cash definition; `ledger.recordTransaction` extends the write path to DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL (`recordTrade` delegates, BUY/SELL unchanged); `DepotSummary.cashBalance` is computed as of today; `ledger.listCashBookings` gives the history with running balance. The "Neue Buchung" form adapts its fields per type and shows the cash effect live; the Cash-Konto tab shows Saldo and booking history; Positionen has a pinned Cash row (also for Depots without open Positions); Buchungen shows per-type icons, event value and cash effect.

**Files changed:**
- `src/core/cash.ts` (+ test) -- cash effect per type, running bookings, balance as of a date.
- `src/modules/ledger/transactions.ts` (+ test) -- `recordTransaction` for all types, `security-not-allowed`, `recordTrade` delegates.
- `src/modules/ledger/cash.ts` (+ test) -- `listCashBookings`.
- `src/modules/ledger/depots.ts` (+ test) -- real `cashBalance` (one query in `listDepots`).
- `src/modules/ledger/index.ts` -- exports.
- `src/app/_actions/transactions.ts` (+ test) -- `recordTransactionAction`, per-type field mapping, `amount` field.
- `src/app/_components/transactions/form-fields.ts`, `labels.ts` (+ test) -- amount field, type order, messages and field mapping per type.
- `src/app/_components/transactions/cash-preview.ts` (+ test) -- live cash-effect text.
- `src/app/_components/transactions/transaction-form.ts` (+ test) -- per-type sections, Security requirement, error placement.
- `src/app/_components/transactions/TransactionDialog.tsx` -- all types, adaptive fields, live line.
- `src/app/_components/transactions/TransactionType.tsx` -- type icon/label, signed cash-effect text.
- `src/app/_components/transactions/TransactionList.tsx` -- icons, event value, Cash-Effekt column.
- `src/app/_components/cash/CashBookings.tsx` -- Saldo card and history table.
- `src/app/_components/positions/PositionsTable.tsx` (+ test) -- pinned Cash row, empty-positions row.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- Cash-Konto tab, Positions always with Cash row.

**Review findings:** 24 (high 0, medium 0, low 22, false 2).
- Patches applied: 3 entries (8 rows), all low — Cash row without open Positions; stale error after type switch; dialog logic extracted into tested `transaction-form.ts`.
- Deferred: none.
- Rejected: 16, each with its reason in the triage log (2 false; 14 low — duplicates, rare cases or fixes that add guards/parameters).

**Follow-up review recommendation:** false. First pass, patched by verdict: high 0, medium 0, low 3.

**Verification:**
- `npm run lint && npm run typecheck && npm test && npm run build` exit 0 after patches; 44 files / 537 tests passed (build with a scratch `DATABASE_URL`).
- Implementer ran `npm run dev` against a scratch DB with the running-balance matrix (rows inserted directly into SQLite): Cash-Konto Saldo `731,10 €` with six rows; header, Depots list and Positions Cash row all `731,10 €`.
- Matrix audit: every row covered by passing core, ledger, preview or page tests.

**Residual risks:**
- The dialog (type switching, live line, wrapping toggle group on phones) was not exercised in a real browser; its logic is covered by pure-helper tests only.
- Live preview shows a figure for zero/negative values the ledger then rejects.
- Future-dated rows appear in the history without a marker; their running Saldo can exceed the card's as-of-today Saldo.
