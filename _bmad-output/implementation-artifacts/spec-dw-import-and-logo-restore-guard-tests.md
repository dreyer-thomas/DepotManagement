---
title: 'Guard tests: BOOKED batch discard keeps files; logo restore never overwrites'
type: 'chore'
created: '2026-10-29'
status: 'done'
baseline_revision: '0ad74e24464c8c01cb6b29512efb4740b687c439'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['multiple-goals']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Two existing guards are unexercised by tests (DW-12, DW-18): `discardImportBatch` refusing a non-OPEN (BOOKED) batch must leave its rows *and* its stored files under `<dataDir>/imports/<batchId>`; `replaceAllLogos` must bump the epoch instead of overwriting a logo file named `<securityId>-<now epoch>.<ext>` that already exists.

**Approach:** Test-only. Add one import test where a staged batch with its files is flipped to BOOKED and a refused discard leaves rows and files intact; extend the existing BOOKED-batch test with the file-directory assertion that holds there. Add two restore tests driving `restoreExport` with a pre-existing colliding `sec-b-<NOW epoch>.png`: success writes to `<NOW epoch + 1>`; a logos-step rollback leaves the pre-existing file byte-identical.

## Boundaries & Constraints

**Always:** Synthetic fixtures only; reuse existing helpers (`stage`, `doc`, `batchFiles`, `env`, `writeLogo`, `PNG`, `NOW`, `expectRejected`, `restoreInto`); match surrounding test style; tests must fail if the respective guard is removed.

**Never:** Edit production code; edit the deferred-work ledger or sprint board; hit live providers; add new fixture files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| BOOKED batch with files, discard | Staged batch with 1 PDF, status set to BOOKED directly in DB | `{ ok: false, reason: "not-found" }`; batch row, item row and `batchFiles(batchId)` unchanged | No error |
| Booked via `bookImportBatch`, discard | Existing test | Refused; rows kept; `imports/<batchId>` still absent (booking already removed it, discard did not recreate/alter anything) | No error |
| Restore, colliding logo file | `logos/sec-b-<NOW ms>.png` exists with distinct bytes | ok; restored row `fileName` = `sec-b-<NOW ms + 1>.png` with `PNG` bytes | No error |
| Restore rollback, colliding logo file | Same file + `fail_logo` trigger | `restore-failed`; snapshot (incl. the colliding file's bytes) unchanged | Written file discarded, pre-existing kept |

</intent-contract>

## Code Map

- `src/modules/import/batches.ts:764` `discardImportBatch` -- filters `status: "OPEN"`; deletes `imports/<id>` only after a successful delete. Read-only.
- `src/modules/import/batches.test.ts:631` -- existing BOOKED test ("refuses a second booking and review writes on a BOOKED batch..."); `batchFiles` helper at :84 (throws/empty on missing dir — check its body); `dataDir` at :43; `interceptedDb` test at ~:670 shows flipping status via `db().importBatch.update`.
- `src/modules/logos/restore.ts` `replaceAllLogos` -- `while (existsSync(...)) epoch += 1`; `removePrevious()` deletes every pre-existing file after commit (so on success the colliding file is gone by design); `discardWritten()` on failure.
- `src/modules/backup/restore.test.ts` -- `NOW` :13, `restoreInto` :37, main success test ~:200 (asserts `sec-b` logo), `expectRejected` :389 (snapshot includes `filesBelow(dataDir)`), logos-step rollback test :529 (`fail_logo` trigger).
- `test/helpers/backup-seed.ts` -- `PNG`, `writeLogo(dataDir, fileName)` (writes PNG bytes).

## Tasks & Acceptance

**Execution:**
- `src/modules/import/batches.test.ts` -- in the existing BOOKED test add `expect(existsSync(join(dataDir, "imports", batchId))).toBe(false)` after the refused discard; add a sibling test "refusing to discard a BOOKED batch keeps its rows and stored files" that stages one doc, records `batchFiles(batchId)`, sets status BOOKED via `db().importBatch.update`, asserts discard returns not-found, batch + item still exist and `batchFiles(batchId)` equals the recorded list -- covers DW-12 (booking itself removes files, so files can only be observed on a batch marked BOOKED directly).
- `src/modules/backup/restore.test.ts` -- in `describe("restoreExport")` add a test that seeds the source, pre-creates `logos/sec-b-${NOW.getTime()}.png` in the target with bytes distinct from `PNG`, restores, and asserts the `sec-b` row's `fileName` is `sec-b-${NOW.getTime() + 1}.png` with `PNG` content; in `describe("rejects without changing anything")` add a test that pre-creates the same colliding file, installs the `fail_logo` trigger and calls `expectRejected(..., { backup: true })` -- covers DW-18.

**Acceptance Criteria:**
- Given the new/extended tests, when `npm test` runs, then they pass.
- Given the `status: "OPEN"` filter in `discardImportBatch` is removed (mentally/temporarily), then the new import test fails; given the epoch `while` loop in `replaceAllLogos` is removed, then both new restore tests fail.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 13 findings — high 0, medium 0, low 8, false 5, maybe-false 0
- findings:
  - `[low]` `[patch]` Success collision test never asserts the logos dir after commit — added `readdirSync(logos)` equals `[logo.fileName]`.
  - `[low]` `[patch]` Only one bump step exercised (`if` instead of `while` would pass) — pre-created `NOW+1` too, expect `NOW+2`; verified an `if` now fails the test.
  - `[low]` `[patch]` Rollback test proves survival only via snapshot — added explicit `readFileSync(...)` equals `OTHER_PNG` assertion.
  - `[false]` `[reject]` Rollback test relies on logos dir existing — `seedOtherData` in `beforeEach` writes a fetched logo; if that changed, `writeFileSync` fails loudly with ENOENT, not silently.
  - `[low]` `[reject]` Tests hard-code `sec-b`/`.png` from the seed — same as the existing restore tests; seed changes are rare and the fix adds derivation logic.
  - `[low]` `[reject]` Two logos-step failure tests duplicate trigger setup — cosmetic; matches the surrounding per-case test style.
  - `[low]` `[patch]` `existsSync(...).toBe(false)` after refused discard reads as a discard check — added comment that booking already removed the files and the refused discard leaves that unchanged.
  - `[low]` `[patch]` New BOOKED-discard test does not assert status is still BOOKED — replaced the count check with `status` `toBe("BOOKED")`.
  - `[low]` `[reject]` No test for discarding an unknown id while other batch files exist — outside the DW-12/DW-18 guards; new test, not a direct correction.
  - `[false]` `[reject]` (intent) DW-12 test reaches BOOKED via direct DB write, not booking — booking deletes `imports/<batchId>`, so the literal reading is unsatisfiable; documented in Design Notes.
  - `[false]` `[reject]` (intent) DW-12 adds a sibling test instead of only extending the existing one — same refutation; existing test was extended with the assertion that holds there.
  - `[false]` `[reject]` (intent) DW-18 survival only observed on rollback — `removePrevious()` deletes all previous files after a successful commit by design; survival is asserted explicitly on rollback.
  - `[false]` `[reject]` (intent) Guard observed via `restoreExport`, not `replaceAllLogos` directly — intent allowed either test location; outer surface is stronger.

## Design Notes

DW-12's intent asked to extend the existing BOOKED test with a files-still-exist assertion, but `bookImportBatch` deletes `imports/<batchId>` on success, so that test cannot show files surviving. The sibling test marks a staged batch BOOKED directly (same technique as the existing `interceptedDb` test) so the files are present when discard is refused. DW-18's "pre-existing file survives" is only observable on rollback, because a successful restore deliberately removes all previous logo files after commit.

## Verification

**Commands:**
- `npx vitest run src/modules/import/batches.test.ts src/modules/backup/restore.test.ts` -- expected: all pass
- `npm run lint && npm run typecheck && npm test` -- expected: success

## Auto Run Result

Status: done

**Summary:** Test-only change closing DW-12 and DW-18. A BOOKED import batch (marked directly while its stored files exist) refuses discard and keeps rows, status and files; the existing booked-batch test also notes the dir stays absent. A logo restore with pre-existing `sec-b-<NOW>.png` and `sec-b-<NOW+1>.png` writes `sec-b-<NOW+2>.png`; a logos-step rollback leaves the colliding file byte-identical.

**Files changed:**
- `src/modules/import/batches.test.ts` -- new "refusing to discard a BOOKED batch keeps its rows and stored files" test; absence assertion with comment in the existing BOOKED test.
- `src/modules/backup/restore.test.ts` -- `OTHER_PNG`; success collision test (double bump) and rollback collision test.

**Review:** 13 findings; 5 low patched (0 high, 0 medium patched), 0 deferred; rejected: 3 low (hard-coded seed ids, duplicated trigger setup, unknown-id discard test — negligible/out of guard scope) and 5 false (logos dir dependency fails loudly; 4 intent-alignment divergences explained in Design Notes). Follow-up review recommended: false.

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (261 files, 3629 tests) pass. Implementer temporarily removed the `status: "OPEN"` filter and the epoch `while` loop (and tried `if`): the new tests fail; production files restored.

**Residual risks:** The BOOKED-with-files state is synthetic (unreachable via the app); the test exercises the discard guard in isolation.
