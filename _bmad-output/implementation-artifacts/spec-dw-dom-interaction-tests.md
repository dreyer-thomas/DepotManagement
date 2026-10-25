---
title: 'DOM interaction tests for client dialogs and the Parqet migration wizard'
type: 'chore'
created: '2026-10-25'
status: 'done'
baseline_revision: '69311104022f9f62db36c28f830640f0a6e09f28'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** vitest runs only in the `node` environment with `renderToStaticMarkup`; no client handler of the Transaction, Depot archive/unarchive, split, ISIN-change dialogs or the Parqet migration wizard is ever executed in a test (deferred-work DW-2..DW-7). Breaking a handler (inverting `if (result?.ok) onClose()`, dropping a failure Alert, passing `splits={[]}`, sending empty decisions) passes `npm test`; DW-2 (React 19 form reset possibly clearing MUI Select/Autocomplete after a failed submit) is unverified.

**Approach:** Add happy-dom + Testing Library as exact-pinned devDependencies, opted in per test file with a `// @vitest-environment happy-dom` docblock so all existing tests keep `node`. Write interaction test files that mount the real components with the server-action modules mocked via `vi.mock`, and fix any component defect the tests reveal.

## Boundaries & Constraints

**Always:** Exact version pins (no `^`/`~`): `happy-dom@21.0.4`, `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.2`, `@testing-library/user-event@14.6.8`. Server actions are mocked per file (`vi.mock("@/app/_actions/…")`); no test DB writes through actions, no network. Queries by role/label/text as a user sees them (German UI strings). Each DOM test file calls Testing Library `cleanup` after each test (vitest globals are off). Migration wizard tests may build realistic `ParqetPreview` objects from the existing synthetic fixtures via `createTestDatabase` + `previewParqetMigration` (as `ParqetMigrationWizard.test.tsx` does) or hand-built objects typed as `ParqetPreview`. Component fixes stay minimal and keep existing behavior/labels.

**Never:** No global switch of `test.environment` away from `node`; no jsdom in addition to happy-dom; no Playwright/browser runner; no snapshot tests; no edits to `_bmad-output/implementation-artifacts/deferred-work.md`; no real financial data; no changes to server actions, modules or `src/core`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Transaction failed submit (DW-2) | "Neue Buchung": type Kauf, Security "Neue Security anlegen" + ISIN, Name, Art "ETF" (MUI Select), Datum, Stück "0", Kurs, Gebühren, Steuern; `saveTransactionAction` → `{ok:false, reason:"quantity-invalid"}`-style failure | Dialog stays open; every field incl. Autocomplete text, Art select and toggle type keeps its value; field error shown | If values are lost, fix the component |
| Archive success | click "„X“ archivieren", action → `{ok:true}` | dialog opens, focus on "Abbrechen" after entering, closes after submit | — |
| Archive failure | action → failure | dialog stays, `role=alert` with German message | — |
| Reaktivieren | click button; action → failure, then `{ok:true}` | Alert shown on failure; action called with `id` | — |
| Split list | splits of two Securities | only the opened Security's splits listed; Bearbeiten prefills form and sends `splitId`; Löschen → confirm → `deleteSplitAction(id)` | — |
| ISIN change via menu | PositionsTable row menu → "Corporate Action → ISIN-Wechsel" | IsinChangeDialog for that Security opens; record sends `oldSecurityId`/`newSecurityId`; field error mapped; edit/delete reachable | — |
| Wizard preview | file + Depot, submit | pending label "Wird gelesen …", then preview title rendered; failure → Alert with `previewFailureMessage`; thrown action → `ACTION_FAILED_MESSAGE` | — |
| Wizard confirm | "Übernehmen" | `confirmParqetAction` FormData has same File, Depot id, decisions JSON incl. a changed classification; `decisions-open` → new preview, previous decisions carried, Alert; ok → summary | — |
| Wizard reset | change file or Depot after preview | preview, summary, error cleared | — |
| Opening balance | summary with `openingBalance`, enter Saldo, submit | `openingBalanceAction` FormData has depotId, date, asOf, balance; success status shown, inputs disabled | — |

</intent-contract>

## Code Map

- `package.json` -- add 4 devDependencies (exact pins); `npm install` updates `package-lock.json`.
- `vitest.config.ts` -- stays `environment: "node"`; per-file docblock opts into happy-dom. `test/setup.ts` runs for all files (DATABASE_URL only; harmless in happy-dom).
- `src/app/_components/transactions/TransactionDialog.tsx` -- `TransactionForm` (controlled state, `useActionState` + `<form action>` → React 19 auto form reset after action); `TransactionDialog`/`NewTransactionButton` exports. Security Autocomplete has no `name`; Art is `TextField select name=assetType`. Field names in `./form-fields.ts` `TRADE_FIELDS`. Error→field mapping in `./labels.ts` `transactionErrorField`.
- `src/app/_components/depots/DepotDialogs.tsx` -- `ArchiveDepotButton` (initial focus via `slotProps.transition.onEntered` → `cancelRef`), `ArchiveForm`, `UnarchiveDepotButton`; messages `./labels.ts` `depotErrorMessage`. Existing static test `DepotDialogs.test.tsx` stays.
- `src/app/_components/corporate-actions/SplitDialog.tsx` -- `own` filter, `SplitRow` edit/delete with inline confirm; `deleteSplitAction(id)`, `saveSplitAction(prev, fd)`.
- `src/app/_components/corporate-actions/IsinChangeDialog.tsx` -- form with Autocomplete of other Securities, `isinChangesOf` listing, `ISIN_CHANGE_FIELDS`, `isinChangeErrorField`.
- `src/app/_components/positions/PositionsTable.tsx:67-110,345-400` -- `RowActions` kebab ("Aktionen für {name}", rendered in desktop and phone layouts) with menu items "Corporate Action → Split" / "→ ISIN-Wechsel" opening the dialogs.
- `src/app/_components/migration/ParqetMigrationWizard.tsx:325-450` -- `submit` (previewParqetAction(null, FormData)), `reset`, `confirm(asIs)` (FormData file/depotId/decisions; `decisions-open` → `carryDecisions`), `ConfirmBar`; pending label "Wird gelesen …".
- `src/app/_components/migration/OpeningBalanceForm.tsx` -- rendered by `ParqetSummaryView` when `summary.openingBalance`; calls `openingBalanceAction(FormData)`.
- `src/modules/migration/decisions.ts` -- `initialDecisions`, `carryDecisions`, `submittedDecisions`, `openDecisions` (pure, not mocked).
- `src/app/_components/migration/ParqetMigrationWizard.test.tsx:1-90` -- reuse pattern for building previews/summaries from `test/fixtures/parqet/*.csv.txt` via `createTestDatabase`.
- `src/app/_actions/{transactions,depots,corporate-actions,migration}.ts` -- action signatures/result types to mock (read-only).

## Tasks & Acceptance

**Execution:**
- `package.json` / `package-lock.json` -- add `happy-dom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` with exact pins via `npm install -D -E` -- DOM tooling.
- `test/helpers/dom.tsx` -- small shared helper: `renderWithTheme` wrapping MUI `ThemeProvider` only if needed, and a `cleanup` hook; keep minimal -- avoid repetition across DOM test files.
- `src/app/_components/transactions/TransactionDialog.dom.test.tsx` -- DW-2 failed-submit value retention (incl. Autocomplete, Art select, type toggle); also success closes dialog -- settle DW-2.
- `src/app/_components/depots/DepotDialogs.dom.test.tsx` -- archive open/initial focus/success-close/failure-Alert; Reaktivieren failure Alert and submitted id -- DW-3.
- `src/app/_components/corporate-actions/SplitDialog.dom.test.tsx` -- per-Security filtering, edit (prefill + `splitId` sent, resets after save), delete confirm → `deleteSplitAction` -- DW-4.
- `src/app/_components/corporate-actions/IsinChangeDialog.dom.test.tsx` -- open via PositionsTable menu item, record with selected Security, field error mapping, list edit/delete reachable -- DW-5.
- `src/app/_components/migration/ParqetMigrationWizard.dom.test.tsx` -- preview pending/success/failure/throw; confirm re-send; decisions-open carry-over; reset on file and Depot change; opening-balance submit -- DW-6, DW-7.
- Any component under `src/app/_components/**` -- minimal fix only if a test reveals a defect; record it in Design Notes.

**Acceptance Criteria:**
- Given the repo, when `npm test` runs, then all existing node-environment tests still pass and the new `*.dom.test.tsx` files run under happy-dom and pass.
- Given any of the mutations named in DW-3..DW-7 (inverting `if (result?.ok) onClose()` in ArchiveForm, removing the archive failure Alert or the `onEntered` focus hook, passing `splits={[]}` or inverting the `own` filter, removing the ISIN-Wechsel menu item, sending empty decisions or dropping `carryDecisions` in `confirm`), when `npm test` runs, then at least one new test fails.
- Given `npm run lint && npm run typecheck && npm run build`, when run, then all succeed.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 23 findings — high 0, medium 1, low 13, false 9, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) `unauthorized` action results are never exercised in DOM tests — not in the bundle's enumerated test list; the message mapping is covered by label tests; adding tests is new scope, not a correction.
  - `[low]` `[reject]` (blind) `as Awaited<ReturnType<…>>` casts on success mocks can hide shape drift — developer-only, no current component reads an unmocked field; harm speculative.
  - `[false]` `[reject]` (blind) reset row only partly covered — `reset()` is one function shared by both handlers; each of its setters is asserted via at least one trigger and dropping either handler's call fails the preview assertion.
  - `[low]` `[reject]` (blind) missing failure paths (generic confirm `ok:false`, opening-balance failure, split field error) — not in the intent's list; extra tests are added scope.
  - `[low]` `[reject]` (blind) wizard DOM tests build previews through a temp test DB — explicitly allowed by the spec, same pattern as the existing wizard test; no defect.
  - `[low]` `[reject]` (blind) some expectations hardcode dates next to derived values — cosmetic; fixture changes would fail loudly.
  - `[low]` `[reject]` (blind) 20 s timeouts only on two Transaction tests may hint at flakiness elsewhere — full suite passed repeatedly (12 runs by implementer, 3 more here); speculative.
  - `[low]` `[reject]` (blind) duplicated `vi.mock` factories — hoisted per-file factories; sharing adds indirection for little gain.
  - `[low]` `[reject]` (blind) Code Map/Design Notes don't match the built helper or record DW-2's outcome — fix is a spec edit; outcome recorded in Auto Run Result instead.
  - `[false]` `[reject]` (blind) mutation checks unrecorded / focus test might not fail without the hook — implementer and verification-gap layer both removed the `onEntered` hook and saw the test fail; results recorded in Auto Run Result.
  - `[false]` `[reject]` (blind) `package-lock.json` missing from the diff — excluded from the review diff for size only; it is modified and committed with the change.
  - `[false]` `[reject]` (blind) phone layout row menu never exercised — desktop and phone both render the same `RowActions` component (PositionsTable.tsx:211,306); removing a menu item affects both.
  - `[false]` `[reject]` (blind) ISIN edit/delete results unchecked — the edit payload is asserted with exact `toEqual` (so no `newSecurityId`); after delete the row only disappears on server revalidation, which is mocked away.
  - `[low]` `[reject]` (edge) archive focus test could race if Fade `onEntered` fires before `trapRoot.focus()` on a slow run — would only be low (intermittent test failure, not a product defect); no flake observed across repeated runs.
  - `[false]` `[reject]` (edge) `isinChangesOf` newSecurity clause not covered through the dialog — `labels.test.ts:75-88` covers both clauses; a mutation there fails `npm test`.
  - `[medium]` `[patch]` (verification-gap) "Alle wie in Parqet übernehmen" (`confirm(true)`) never clicked; switching to `confirm()` stayed green — added a DOM test asserting the sent decisions equal `submittedDecisions(preview, initialDecisions(preview), true)` with non-empty `flags`, same File and Depot; mutation now fails it.
  - `[false]` `[reject]` (intent) DW-2 asks for a browser, gets happy-dom — the bundle intent explicitly names happy-dom + Testing Library as the settling tooling.
  - `[false]` `[reject]` (intent) initial focus partly simulated — removing the hook still fails the test (verified twice).
  - `[false]` `[reject]` (intent) Create/Rename dialogs not covered — the bundle intent enumerates Archive/Reaktivieren only.
  - `[low]` `[reject]` (intent) page-level `splits={[]}` wiring not exercised — the ledger entry locates the gap in SplitDialog/PositionsTable boundary, which is covered; page wiring is out of the enumerated list.
  - `[low]` `[reject]` (intent) `chooseFile` bypasses the native file input — happy-dom limitation documented in the helper; the component path from `input.files` to FormData is exercised.
  - `[low]` `[reject]` (intent) decisions-open scenario is constructed — built from real fixture previews; behaviour under test (carry-over) is fully exercised.
  - `[low]` `[reject]` (intent) DW-2 outcome not recorded in the diff — recorded in Auto Run Result.

## Design Notes

React 19 resets a `<form action={fn}>` after the action settles (also on failure). Controlled inputs survive because React keeps `defaultValue` in sync with `value`; the DW-2 test asserts this for MUI's hidden Select input and the Autocomplete's text input rather than assuming it.

MUI transitions in happy-dom: Dialog open/close uses `Fade` with timeouts; use `waitFor`/`waitForElementToBeRemoved` (or `findBy*`) rather than fake timers. Select/Menu open via `userEvent.click` on the combobox, then pick `role="option"`/`menuitem`. Media query `down("sm")` is false without `matchMedia` support; that is acceptable.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.
- Temporarily apply one DW mutation per area locally (not committed) and run the matching `*.dom.test.tsx` -- expected: it fails.

## Auto Run Result

Status: done

**Summary:** Added happy-dom + Testing Library (exact pins) as per-file opt-in DOM test tooling and 28 interaction tests covering DW-2..DW-7. No component defect was found, so no source component changed. DW-2 is settled as not a bug: after a failed submit every "Neue Buchung" value (type toggle, Security Autocomplete "Neue Security anlegen", ISIN, Name, Art select, Datum, Stück, Kurs, Gebühren, Steuern) survives React 19's form reset and a resubmit sends identical FormData.

**Files changed:**
- `package.json` / `package-lock.json` — devDependencies happy-dom 21.0.4, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.8.
- `test/helpers/dom.tsx` — `registerDomCleanup`, `formEntries`, `chooseFile` (happy-dom FormData-compatible file selection).
- `src/app/_components/transactions/TransactionDialog.dom.test.tsx` — DW-2 value retention; success closes.
- `src/app/_components/depots/DepotDialogs.dom.test.tsx` — DW-3 archive focus/success/failure, Reaktivieren.
- `src/app/_components/corporate-actions/SplitDialog.dom.test.tsx` — DW-4 per-Security list, record, edit, delete, delete failure.
- `src/app/_components/corporate-actions/IsinChangeDialog.dom.test.tsx` — DW-5 menu item, record, field error, edit, delete.
- `src/app/_components/migration/ParqetMigrationWizard.dom.test.tsx` — DW-6/DW-7 preview pending/success/failure/throw, confirm re-send, as-is confirm, decisions-open carry-over, resets, opening balance.

**Review findings:** 23 total — 1 patch applied (medium: as-is confirm path test), 0 deferred, 22 rejected (9 false, 13 low; reasons in the Review Triage Log).

**Follow-up review recommendation:** false — patched: high 0, medium 1, low 0.

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (72 files, 1131 tests), `npm run build` all pass. Mutation probes: implementer applied 15 mutations (all DW-named ones incl. inverted archive onClose, removed failure Alert, removed onEntered hook, `splits={[]}`, inverted `own` filter, removed ISIN-Wechsel item, empty decisions, dropped carryDecisions) — each failed a test; review independently re-ran 10 and found `confirm(true)`→`confirm()` uncaught (now caught); orchestrator re-checked dropping `carryDecisions` fails.

**Residual risks:** happy-dom is not a real browser (focus-trap ordering is simulated in the archive focus test; native file input replaced by `chooseFile`). MUI Fade timing could in theory make the focus test flaky on a heavily loaded machine.
