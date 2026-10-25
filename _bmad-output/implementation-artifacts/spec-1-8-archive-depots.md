---
title: 'Story 1.8: Archive Depots'
type: 'feature'
created: '2026-10-25'
status: done
baseline_revision: '66a0c71afc7dba3f151b01d6c69e2c1e5f18f278'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Archive confirmation dialog and Reaktivieren button have no interaction tests (open, close on success, error Alert, initial focus on Abbrechen).
    evidence: |-
      vitest runs in the node environment with renderToStaticMarkup only; no jsdom/happy-dom/testing-library/playwright in the repo, so no test mounts ArchiveDepotButton/UnarchiveDepotButton. Inverting `if (result?.ok) onClose()`, dropping the failure Alert or removing the onEntered focus hook would pass npm test. The existing Create/Rename dialogs share the gap. Verified manually in a headless browser on 2026-10-25.
    location: >-
      src/app/_components/depots/DepotDialogs.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** A Depot Tommy no longer uses stays in every list and figure forever, and nothing defines which Securities count as "held" across Depots (AD-17), which later epics (prices, news, composition) need.

**Approach:** Add an `archived` flag to Depot (new migration), a pure core archive guard and `heldSecurities`, ledger `archiveDepot`/`unarchiveDepot` plus an archive check on every ledger write, and the UI: archive (with confirmation) and unarchive in Settings → Depots, a collapsed "Archiviert" group on the Depots and Settings lists, archived Depots left out of the Overview, and a read-only Depot detail.

## Boundaries & Constraints

**Always:**
- Schema: `Depot.archived Boolean @default(false)` via a new migration under `prisma/migrations/` (existing migrations untouched).
- `src/core/archive.ts` (pure, decimal strings, "today" passed in):
  - `isFlat(rows, asOf)`: true when every Security's net BUY−SELL quantity over rows dated ≤ `asOf` is exactly zero (exact decimal compare) and `cashBalance(rows, asOf)` rounds to zero at cent precision, i.e. `|cash| < 0.005` (decimal compare, ROUND_HALF_UP to 2 places gives 0.00; 0.005 and -0.005 are NOT flat). Cash is compared at cent precision because BUY/SELL amounts are stored unrounded (quantity × price), so a closed fractional-share Depot can keep a sub-cent remainder that displays as "0,00 €"; such a Depot is archivable and keeps that remainder after archiving (no balancing booking is written). Quantities stay exact-zero.
  - `canArchive(rows, today)`: `isFlat(rows, today) && isFlat(rows, lastDate)` where `lastDate` is the latest row date (no rows → true). A future-dated row that opens a Position or moves cash therefore blocks archiving.
  - `heldSecurities({ depots: { id, archived }[], trades }, today)`: sorted unique `securityId`s whose net BUY−SELL quantity over rows dated ≤ `today` is > 0 within one non-archived Depot (per Depot, not summed across Depots). Rows of unknown Depots are ignored. This is the only definition of "held".
- Ledger (`src/modules/ledger`, only writer):
  - `DepotSummary` gains `archived: boolean` and `archivable: boolean` (= `canArchive` over the Depot's rows with today's business date; computed on read, never stored). `listDepots` keeps name order and returns archived ones too.
  - `archiveDepot(id, db?)`: unknown → `not-found`; already archived → `ok` (idempotent); not `canArchive` → `{ ok: false, reason: "depot-not-flat" }`; else sets `archived = true`. Check and write in one DB transaction.
  - `unarchiveDepot(id, db?)`: unknown → `not-found`; else `archived = false` (idempotent).
  - Every write to an archived Depot is rejected with reason `depot-archived` and writes nothing: `recordTransaction` (target Depot), `updateTransaction` and `deleteTransaction` (the row's Depot), `renameDepot`. The check runs right after the Depot/row lookup, before other checks except validation.
  - `listHeldSecurities(today, db?)`: loads Depots and BUY/SELL rows and returns `heldSecurities(...)` (Security ids); exported for Epics 3+.
- Server actions (`src/app/_actions/depots.ts`): `archiveDepotAction` and `unarchiveDepotAction` (form field `id`), session required (`unauthorized` otherwise), `revalidatePath("/", "layout")` only on success.
- UI:
  - Overview (`/`): lists only non-archived Depots. No Depots at all → existing "Noch kein Depot." state; only archived ones → "Alle Depots sind archiviert." with a link "Zu den Depots" to `/depots`.
  - Depots page and Settings → Depots: non-archived Depots as today, then (only when any exist) a collapsed-by-default MUI `Accordion` titled "Archiviert (<n>)" listing archived Depots. Archived cards show name (link), Broker and Cash-Konto like active ones; no rename button.
  - Settings, active Depot card: rename button plus an "Archivieren" action (IconButton, `aria-label` `„<Name>" archivieren`, ≥ 44 px). When `archivable` is false it is disabled and the card shows the visible text "Depot hat noch Positionen oder Guthaben." Enabled, it opens a confirmation dialog (one level, full-screen below sm): title "Depot archivieren", text `Depot „<Name>" archivieren? Es zählt dann nicht mehr zur Übersicht und kann nicht mehr bebucht werden.`, buttons "Abbrechen" (autofocus) and "Archivieren"; success closes; a failure shows an Alert inside the dialog.
  - Settings, archived Depot card: "Reaktivieren" button (≥ 44 px) that submits `unarchiveDepotAction` directly; a failure shows an inline Alert on the card.
  - Depot detail of an archived Depot: all tabs viewable; a `Chip` "Archiviert" next to the Broker plus an info `Alert` "Archiviertes Depot – nur lesbar. Reaktivieren unter Einstellungen."; no "Neue Buchung" button (header or empty state), and Buchungen rows are not clickable and have no edit buttons.
  - German messages: `depot-not-flat` → "Depot hat noch Positionen oder Guthaben."; `depot-archived` → "Depot ist archiviert. Bitte zuerst reaktivieren." (Depot labels and Transaction labels).

**Never:**
- No stored Positions/balances/held set; no Prisma outside `src/modules/ledger` and `src/db`; no `number` for money or quantities.
- No delete of Depots, no archiving from the Depot detail page, no Period/valuation aggregates (Epic 4), no price/news consumers of `heldSecurities` yet (Epic 3).
- No edits to `sprint-status.yaml` or committed migrations; synthetic test data only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty Depot | no rows | `canArchive` true; archive ok; `archived: true` | — |
| Flat Depot | DEPOSIT 1000, BUY 10 @ 100, SELL 10 @ 100, WITHDRAWAL 1000 | archivable; archive ok | — |
| Open Position | BUY 10, cash 0 via DEPOSIT | not archivable | `depot-not-flat` |
| Cash left | DEPOSIT 0.01 | not archivable | `depot-not-flat` |
| Half-cent cash | DEPOSIT 0.005 (and separately: cash −0.005) | not archivable (rounds to 0,01 € / −0,01 €) | `depot-not-flat` |
| Sub-cent residual | DEPOSIT 200, BUY 3.412871 @ 43.95 (amount 149.99568045), SELL 3.412871 @ 43.95, WITHDRAWAL 199.9957 → cash 0.0043 (and separately a flat Depot with cash −0.0043) | archivable; archive ok; balance unchanged, nothing written but `archived` | — |
| Sub-unit quantity | BUY 1, SELL 0.99999999 (cash 0) | not archivable (quantities are exact) | `depot-not-flat` |
| Future Position | flat today, BUY dated after today | not archivable | `depot-not-flat` |
| Write to archived | record / update / delete / rename on archived Depot | nothing written | `depot-archived` |
| Unarchive | archived Depot → unarchive, then record DEPOSIT | ok, write succeeds | — |
| Re-archive | archive an archived Depot | ok, unchanged | — |
| Unknown id | archive / unarchive `nope` | nothing written | `not-found` |
| Held set | s1 held in active A; s2 held only in archived B; s3 bought and fully sold in A; s4 held only in a future-dated BUY | `["s1"]` | — |
| Held per Depot | s1 BUY 5 in active A; s1 BUY 5 and SELL 5 in active B | `["s1"]` (A counts) | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- `model Depot` (add `archived`). Migration: create via `DATABASE_URL=file:<scratch>/x.db npx prisma migrate dev --create-only --name archive_depot` (or hand-write `ALTER TABLE "Depot" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;` in a timestamped folder), then `npx prisma generate`. Example format: `prisma/migrations/20261025141837_add_depot/migration.sql`.
- `src/core/holdings.ts` -- `TradeRow`, private `apply`; reuse the row shape for net quantities. `src/core/cash.ts` -- `cashBalance(rows, asOf)`, `CashRow`. `src/core/decimal.ts` -- `ExactDecimal`. `test/architecture/core-imports.test.ts` -- core imports only core + `decimal.js`.
- `src/modules/ledger/depots.ts` -- `DepotSummary`, `DepotFailureReason`, `toSummary`/`currentBalance` (today via `businessDate(new Date())`), `CASH_SELECT` (extend with `securityId`, `quantity` for the guard), `listDepots`, `getDepot`, `renameDepot` (add archived check); add `archiveDepot`, `unarchiveDepot`, `listHeldSecurities`.
- `src/modules/ledger/transactions.ts:397` `writeTransaction` (depot lookup at :402 → add archived check), `updateTransaction` (:467, lookup `existing` → check its Depot), `deleteTransaction` (:520); `TransactionFailureReason`/`TradeFailureReason` (add `depot-archived`).
- `src/modules/ledger/index.ts` -- export the new functions/types.
- `src/modules/ledger/depots.test.ts`, `transactions.test.ts` -- temp-DB test pattern (`createTestDatabase`); existing `DepotSummary` `toEqual`s need the new fields.
- `src/app/_actions/depots.ts` (+ `depots.test.ts`) -- `createDepotAction`/`renameDepotAction` pattern, `UNAUTHORIZED`, `DepotActionState`.
- `src/app/_components/depots/labels.ts` (+ test) -- `DEPOT_ERROR_MESSAGES`, `depotErrorField` (new reasons → Alert, `undefined`).
- `src/app/_components/transactions/labels.ts:50` -- `MESSAGES` (add `depot-archived`).
- `src/app/_components/depots/DepotDialogs.tsx` -- `DepotDialog` shell, `useDialog`, `TOUCH_TARGET`, `RenameDepotButton`; add `ArchiveDepotButton` and `UnarchiveDepotButton` here.
- `src/app/_components/depots/DepotList.tsx` -- card list; `renamable` prop becomes Settings mode (rename + archive / unarchive); add the archived `Accordion` group (a wrapper component splitting active/archived is fine).
- `src/app/(app)/page.tsx`, `src/app/(app)/depots/page.tsx`, `src/app/(app)/settings/page.tsx` (+ their `page.test.tsx`) -- list rendering.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- `newTransaction`, `emptyState`, header; pass `readOnly` to `TransactionList`.
- `src/app/_components/transactions/TransactionList.tsx` -- add `readOnly?: boolean` (no row click, no action column, no dialog).
- `test/helpers/render-text.ts` -- `renderText`/`renderHtml` for page tests.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma` + new migration folder -- add `archived`; regenerate client.
- `src/core/archive.ts` (+ `archive.test.ts`) -- `isFlat`, `canArchive`, `heldSecurities`; tests cover every core matrix row (flat, open, cash, half-cent, sub-cent residual, sub-unit quantity, future, held set, per-Depot).
- `src/modules/ledger/depots.ts`, `transactions.ts`, `index.ts` (+ tests) -- summary fields, `archiveDepot`, `unarchiveDepot`, `listHeldSecurities`, `depot-archived` on record/update/delete/rename; tests for every ledger matrix row.
- `src/app/_actions/depots.ts` (+ test) -- archive/unarchive actions: success revalidates, `depot-not-flat` and unauthorized do not.
- `src/app/_components/depots/labels.ts`, `src/app/_components/transactions/labels.ts` (+ tests) -- new messages.
- `src/app/_components/depots/DepotDialogs.tsx`, `DepotList.tsx` -- archive confirm dialog, unarchive button, blocked reason, collapsed "Archiviert" group.
- `src/app/(app)/page.tsx`, `depots/page.tsx`, `settings/page.tsx`, `depots/[id]/page.tsx`, `TransactionList.tsx` (+ page tests) -- filtering, groups, read-only detail; page tests assert: Overview omits an archived Depot and shows "Alle Depots sind archiviert." when only archived exist; Depots/Settings render "Archiviert (1)"; Settings shows the disabled reason for a Depot with a Position; archived detail shows "Archiviert", no "Neue Buchung", no edit buttons.

**Acceptance Criteria:**
- Given a Depot with no open Positions and a cash balance that rounds to 0,00 € (|cash| < 0.005, including a sub-cent residual from unrounded BUY/SELL amounts), when "Archivieren" is confirmed in Settings → Depots, then it appears only in the collapsed "Archiviert" group, disappears from the Overview, and its detail page stays viewable without any write action.
- Given a Depot with an open Position or cash that does not round to 0,00 € (|cash| ≥ 0.005), when Settings → Depots renders, then its archive button is disabled and "Depot hat noch Positionen oder Guthaben." is shown.
- Given an archived Depot, when "Reaktivieren" is pressed, then it returns to the active list and Transactions can be booked again.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0.

## Spec Change Log

### 2026-10-25 — Escalation resolution (cash rule)
- Trigger: review intent_gap — exact-zero cash vs. AC "0,00 €"; unrounded BUY/SELL amounts leave invisible sub-cent residuals that blocked archiving.
- Decision (human): cash counts as zero when it rounds to 0,00 € (`|cash| < 0.005`); quantities stay exact-zero; the residual stays in the archived Depot, no balancing booking.
- Amended: `isFlat` rule, I/O matrix (Half-cent cash, Sub-cent residual, Sub-unit quantity rows), core test task, acceptance criteria, Design Notes.

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 22 findings — high 0, medium 1, low 13, false 8, maybe-false 0
- attempted change saved as `spec-1-8-archive-depots.patch` (same folder; applies cleanly on baseline `66a0c71afc7dba3f151b01d6c69e2c1e5f18f278`); code reverted. Because an intent_gap exists, patch and defer routes below were not applied.
- findings:
  - `[low]` `[reject]` (blind) `canArchive` misses a Position/cash opened and closed entirely in the future (BUY 2099-01, SELL 2099-02) — real, but needs two future-dated rows bracketing nothing today; the contract fixes the two-checkpoint rule and Design Notes accept the gap; fixing means adding per-date checks.
  - `[low]` `[patch]` (blind) read-only banner "Reaktivieren unter Einstellungen." is plain text, not a link to `/settings` — direct fix (wrap in `AppLink`); moot due to intent_gap.
  - `[low]` `[reject]` (blind) Overview "Alle Depots sind archiviert." state has no "Depot anlegen" — rare state (every Depot archived); the link reaches `/depots`, which has the create button.
  - `[low]` `[reject]` (blind) Depots page with only archived Depots shows just a collapsed accordion — rare state; the spec mandates collapsed-by-default; extra branch for negligible gain.
  - `[low]` `[reject]` (blind) focus falls to `<body>` after archiving because the trigger moves into the collapsed group — real, but focus management/live region adds new mechanics; same behaviour as the existing rename flow after revalidation.
  - `[false]` `[reject]` (blind) `aria-describedby`/`title` on the disabled archive button are unreachable — the visible reason text sits on the card next to the button, and screen readers' browse mode still announces disabled buttons with their description.
  - `[false]` `[reject]` (blind) `depotErrorField` defaults unknown reasons to the name field — every current reason maps correctly (tested); the archive dialog uses `depotErrorMessage` only; no current wrong outcome.
  - `[low]` `[reject]` (blind) `listDepots` loads `securityId`/`quantity` and runs `canArchive` on every list read; `today()` per Depot — single-user, small ledgers; per-Depot `today()` differs only across a midnight boundary within one request.
  - `[low]` `[reject]` (blind) archived detail still loads `listSecurities()` — one extra small query on a rarely visited page.
  - `[low]` `[defer]` (blind) no tests for `ArchiveDepotButton`/`UnarchiveDepotButton` interaction — grouped with verification-gap "archive dialog wiring" and intent "UI tests are static": repo has no DOM interaction harness (pre-existing); implementer verified in a browser; moot due to intent_gap.
  - `[low]` `[patch]` (blind) transaction server actions not tested against an archived Depot — a one-test addition in `src/app/_actions/transactions.test.ts`; moot due to intent_gap.
  - `[false]` `[reject]` (blind) `inTransaction` moved into `depots.ts` couples ledger files — both files are the same module; no caller diverges, no rule breaks.
  - `[false]` `[reject]` (blind) `heldSecurities(ledger, today)` differs from `heldSecurities(ledger)` and ignores corporate actions — "today" must be passed in (core purity rule, spec); corporate actions do not exist until Epic 2.
  - `[low]` `[reject]` (edge) `renameDepot` checks `archived` outside a DB transaction, so a concurrent archive could slip a rename through — single user, needs two simultaneous requests; wrapping rename in a transaction interacts with its P2002 handling, more than a direct fix.
  - `[false]` `[reject]` (edge) `listHeldSecurities` accepts a malformed `today` — no caller exists; every in-repo producer of "today" is `businessDate(new Date())`.
  - `[low]` `[patch]` (verification-gap) the Settings test never asserts the hidden `id` input of the Reaktivieren form — add an assertion for `name="id" value="<archived id>"`; moot due to intent_gap.
  - `[low]` `[defer]` (verification-gap) archive confirmation dialog wiring untested — grouped with the blind UI-tests row (no DOM harness, pre-existing); moot due to intent_gap.
  - `[false]` `[reject]` (intent) "excluded from every aggregate" enforced per caller, tested only on the Overview — the Overview list is the only aggregate that exists; it filters archived Depots (tested).
  - `[false]` `[reject]` (intent) `heldSecurities` has no consumer yet — intended; the spec defers consumers to Epic 3.
  - `[low]` `[defer]` (intent) UI criteria tested via SSR strings, not interaction — grouped with the blind UI-tests row; moot due to intent_gap.
  - `[medium]` `[intent_gap]` (intent) archive guard requires exact-zero cash while the story AC says "Cash Account balance of 0,00 €" — verified reachable: a BUY/SELL stores `amount = quantity × price` unrounded (`src/modules/ledger/transactions.ts:77`, e.g. 3.412871 × 43.95 = 149.99568045), so a closed fractional-share Depot can keep a sub-cent balance that displays as "0,00 €" while archiving stays disabled with "Depot hat noch Positionen oder Guthaben." and the user cannot see the residual to book it away. The intent-contract fixes "exact decimal compare"; the epics AC ("0,00 €") and AD-17 ("non-zero Cash Account balance") allow both readings. Unresolved: should the guard treat a balance that rounds to 0,00 € (|cash| < 0.005) as zero (archived Depot may then carry a sub-cent remainder), or keep exact zero and give the user a way to see/clear the residual (e.g. show it or offer a balancing booking)? Same question for fractional quantities that display as 0 but are non-zero (quantities show 8 decimals, so likely exact).

### 2026-10-25 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 16, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) archive/reactivate labels use „…“ while the pre-existing rename label uses ASCII quotes — the contract spells the archive label with „; aligning means changing the existing rename label and its tests, cosmetic only.
  - `[low]` `[reject]` (blind) archive dialog has no `aria-describedby` to its consequence text / not `alertdialog` — real but needs a new `DepotDialog` parameter; single-user app, consequence text is visible and read in browse mode.
  - `[false]` `[reject]` (blind) disabled archive button hides its reason from keyboard users — carried: the visible reason text sits on the card next to the button.
  - `[low]` `[patch]` (blind) "Archiviert" AccordionSummary has no `id`/`aria-controls`, so header and region are not linked (MUI only sets the region id from the summary's `aria-controls`) — fixed: `id="archived-depots-header"`, `aria-controls="archived-depots-content"`.
  - `[low]` `[reject]` (blind) banner link to `/settings` lands on the collapsed group — a deep link/auto-expand adds new mechanics; the group is one click away.
  - `[low]` `[reject]` (blind) focus falls to `<body>` and no feedback after archive/reactivate — carried: same as the existing rename flow; focus management adds new mechanics.
  - `[false]` `[reject]` (blind) archived Depots excluded only by per-caller filtering — carried: the Overview list is the only aggregate that exists and it filters (tested).
  - `[low]` `[reject]` (blind) `listDepots` loads quantities and runs `canArchive` on every list; `today()` per Depot — carried: small single-user ledgers; midnight skew within one request only.
  - `[low]` `[reject]` (blind) `depot-archived` in `DepotFailureReason` widens `createDepot`'s result type — type-only imprecision with no wrong runtime outcome; a separate rename reason type adds public surface.
  - `[low]` `[patch]` (blind) `listHeldSecurities(today, …)` shadows the module `today()` helper — fixed: parameter renamed to `asOf`.
  - `[low]` `[patch]` (blind) dead `typeof id === "string"` guard in `archiveDepot`/`unarchiveDepot` — fixed: guard removed, `id` used directly.
  - `[low]` `[defer]` (blind) no tests for the archive dialog / Reaktivieren button — carried; grouped with the verification-gap and intent rows below; recorded in `deferred` (no DOM interaction harness in the repo, pre-existing for all dialogs).
  - `[false]` `[reject]` (blind) `selected && !readOnly` guard in `TransactionList` is redundant — not redundant: a Depot archived while the list is mounted (revalidation) can flip `readOnly` with `selected` still set; the guard then hides the dialog.
  - `[low]` `[reject]` (edge) `canArchive` misses a Position/cash opened and closed entirely between today and the last row date — carried: Design Notes accept the gap; fixing means per-date checks beyond the contract's two-checkpoint rule.
  - `[low]` `[reject]` (edge) `renameDepot` archived check races a concurrent archive — carried: single user, needs two simultaneous requests; wrapping rename interacts with its P2002 handling.
  - `[low]` `[defer]` (verification-gap) archive/reactivate client flows (close on ok, error Alert, initial focus) untested — carried; grouped with the blind UI-tests row; manual headless-browser check done this pass.
  - `[low]` `[defer]` (intent) UI interaction guarantees tested only as SSR markup — carried; grouped with the blind UI-tests row.
  - `[false]` `[reject]` (intent) ledger held-set test archives B via a direct DB update, a state the service cannot produce — not a defect: it is the only way to exercise archived-exclusion at ledger level, and an archived Depot with a Position is reachable via the accepted between-checkpoints gap; core test covers the pure rule.
  - `[low]` `[reject]` (intent) one-transaction atomicity of archive vs. writes not tested — needs a concurrency harness; single user; the structure (check + write in `inTransaction`) is visible in the diff.
  - `[false]` `[reject]` (intent) rename guard unreachable from the UI — intended: archived cards have no rename button; the ledger guard is tested.
  - `[low]` `[reject]` (intent) Depots page with only archived Depots shows just the collapsed accordion — carried: rare state; collapsed-by-default is mandated.

## Design Notes

The guard checks today and the last row date so a Depot that is flat today but has a future-dated buy (or is non-flat today but closed by a future sell) cannot be archived into an inconsistent state. A Position that opens and closes entirely in the future between two checkpoints is ignored — no realistic path produces it. `heldSecurities` is per Depot so a negative net in one Depot (unreachable today) never cancels a real holding in another. Rename counts as a write because AD-17 makes an archived Depot read-only. Cash is judged at cent precision (what the user sees) because BUY/SELL amounts are stored unrounded; a sub-cent remainder in an archived Depot is accepted as immaterial, and AD-17's "non-zero Cash Account balance" is read as non-zero at cent precision.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0 (build with a scratch `DATABASE_URL`)
- `npm run dev` with synthetic auth env and a scratch `DATABASE_URL` -- expected: archive an empty Depot in Einstellungen (confirm dialog), it shows under "Archiviert", detail read-only, "Reaktivieren" restores it; a Depot with cash shows the disabled reason.


## Auto Run Result

Status: done

**Summary:** Depots can be archived and reactivated (AD-17). New `Depot.archived` column (migration `20261025180000_archive_depot`); pure `src/core/archive.ts` (`isFlat` with exact-zero quantities and cent-precision cash `|cash| < 0.005`, `canArchive` at today + last row date, per-Depot `heldSecurities`); ledger `archiveDepot`/`unarchiveDepot`/`listHeldSecurities`, `archived`/`archivable` on `DepotSummary`, `depot-archived` on record/update/delete/rename; archive/unarchive server actions; Settings archive confirmation dialog + Reaktivieren button, collapsed "Archiviert (n)" group on Depots and Settings, Overview without archived Depots ("Alle Depots sind archiviert."), read-only archived Depot detail.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261025180000_archive_depot/migration.sql` — `archived` flag.
- `src/core/archive.ts` (+ test) — archive guard and held set.
- `src/modules/ledger/depots.ts`, `transactions.ts`, `index.ts` (+ `depots.test.ts`) — summary fields, archive/unarchive, held set, write guards; `inTransaction` moved to `depots.ts`.
- `src/app/_actions/depots.ts` (+ test), `src/app/_actions/transactions.test.ts` — archive/unarchive actions; archived-Depot rejection through transaction actions.
- `src/app/_components/depots/DepotDialogs.tsx` — `ArchiveDepotButton` (confirm dialog, focus on Abbrechen), `UnarchiveDepotButton`.
- `src/app/_components/depots/DepotList.tsx` — Settings mode actions, blocked reason, `DepotGroups` with archived Accordion.
- `src/app/_components/depots/DepotLink.tsx` — `AppLink` helper.
- `src/app/_components/depots/labels.ts`, `src/app/_components/transactions/labels.ts` (+ tests) — German messages.
- `src/app/_components/transactions/TransactionList.tsx` — `readOnly` mode.
- `src/app/(app)/page.tsx`, `depots/page.tsx`, `settings/page.tsx`, `depots/[id]/page.tsx` (+ page tests) — filtering, groups, read-only detail.

**Review findings:** 21 findings (high 0, medium 0, low 16, false 5). Patches applied (3, all low): Accordion `id`/`aria-controls`; `listHeldSecurities` parameter renamed to `asOf`; dead id guard removed. Deferred (1 entry, low): no interaction tests for the archive dialog / Reaktivieren button (rows: blind UI tests, verification-gap, intent UI). Rejected: ASCII vs. German quotes in labels (contract-mandated, cosmetic); dialog `aria-describedby` (needs new parameter); disabled-button reason (false, carried); banner link to collapsed group (new mechanics); focus/feedback after archive (carried); per-caller filtering (false, carried); list-read cost and per-Depot `today()` (carried); widened `DepotFailureReason` (type-only); `TransactionList` guard (false, not redundant); between-checkpoint future Position (carried); rename race (carried); held-set test via direct DB update (false); atomicity untested (needs concurrency harness); rename guard unreachable from UI (false, intended); only-archived Depots page (carried).

**Follow-up review recommendation:** false — patched entries: high 0, medium 0, low 3.

**Verification:**
- `npm run lint && npm run typecheck && npm test && npm run build` (scratch `DATABASE_URL`) — all exit 0; 46 files / 661 tests passed, after the review patches as well.
- Matrix audit: every I/O matrix row covered by passing tests in `src/core/archive.test.ts` and `src/modules/ledger/depots.test.ts` (no skipped tests).
- Manual: `next dev` with synthetic auth and scratch DB, driven by headless Chromium — Depot with cash shows disabled archive button + "Depot hat noch Positionen oder Guthaben."; archiving an empty Depot opens "Depot archivieren" with the contract text, focus lands on "Abbrechen" (Enter cancels), confirm moves it to "Archiviert (1)", Overview omits it, detail shows the read-only Alert and no "Neue Buchung"; "Reaktivieren" restores it and "Neue Buchung" returns. 375 px Settings layout checked by screenshot.

**Residual risks:** archive dialog / Reaktivieren interactions have no automated tests (deferred); a Position opened and closed entirely between today and the last row date is not detected by `canArchive` (accepted in Design Notes); rename vs. concurrent archive is not atomic (single user).
