---
title: 'onvista eod_history: skip null closes and timestamps instead of failing the schema'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: '67b99d1c8da15994e9be00d1d71ab7c426e8f42d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `eodSchema` in the onvista price adapter requires `z.array(z.number())` for `datetimeLast` and `last`, so a single `null` entry (a gap day on a thinly traded certificate) makes the whole eod_history response a `schema` failure and the certificate gets no prices at all (DW-11).

**Approach:** Accept nullable numbers in both arrays (keeping the equal-length refinement) and skip every index pair where the timestamp or the close is `null`, mirroring how the Yahoo adapter drops null closes. Cover it with a unit test built from the recorded Xetra-Gold eod response with gap entries nulled.

## Boundaries & Constraints

**Always:** Keep the equal-length refinement (`datetimeLast.length === last.length`) — mismatched lengths still return `schema`. Keep existing behavior for non-null data (EUR check, `close > 0` filter, Berlin-date bucketing with last-of-date wins, range limiting, `not-found` when nothing remains). Tests use the recorded fixture; no live provider calls.

**Never:** No edits to the recorded fixture files, to `shared.ts`/`types.ts`, to other adapters, or to `_bmad-output/implementation-artifacts/deferred-work.md`. Do not accept non-numeric non-null values (strings, objects) — those remain `schema`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Null close | recorded eod with `last[1] = null` (2026-10-02) | 16 closes, 2026-10-02 missing, others unchanged | No `schema` failure |
| Null timestamp | recorded eod with `datetimeLast[2] = null` (2026-10-05) | that pair skipped; remaining closes returned | No `schema` failure |
| All entries null | `datetimeLast: [null]`, `last: [null]` | `{ ok: false, reason: "not-found" }` | as for an empty range |
| Length mismatch | `datetimeLast: [null]`, `last: []` | `{ ok: false, reason: "schema" }` | unchanged |
| Non-number entry | `last: ["1.0"]` | `{ ok: false, reason: "schema" }` | unchanged |

</intent-contract>

## Code Map

- `src/modules/prices/providers/onvista.ts:21-24` -- `eodSchema`; change both arrays to `z.array(z.number().nullable())`, keep `.loose()` and `.refine`.
- `src/modules/prices/providers/onvista.ts:60-66` -- `forEach` over `datetimeLast`; add an early return when `seconds === null || close === null` before the existing `!(close > 0)` check and `businessDate(new Date(seconds * 1000))`.
- `src/modules/prices/providers/onvista.ts:26-30` -- adapter doc comment; mention that null entries are skipped.
- `src/modules/prices/providers/yahoo.ts:95,137-138` -- reference only: Yahoo uses `z.number().nullable().optional()` and `continue`s on null closes.
- `src/modules/prices/providers/onvista.test.ts` -- existing tests; `routes(query, eod)` helper and the `{ ...(recorded("onvista-eod-xetra-gold") as object), isoCurrency: "USD" }` pattern for deriving a modified recorded response.
- `test/fixtures/providers/onvista-eod-xetra-gold.json` -- read-only; 17 entries, index 0 = 2026-10-01 (119.05), 1 = 2026-10-02 (118.35), 2 = 2026-10-05 (118.69), 16 = 2026-10-23 (114.81).

## Tasks & Acceptance

**Execution:**
- `src/modules/prices/providers/onvista.ts` -- make `datetimeLast`/`last` entries nullable and skip index pairs with a null timestamp or close; update the doc comment -- a gap day must not discard the whole history.
- `src/modules/prices/providers/onvista.test.ts` -- add a test deriving an eod body from the recorded Xetra-Gold response with `last[1] = null` and `datetimeLast[2] = null`, asserting 15 closes are returned without 2026-10-02 and 2026-10-05 and first/last closes unchanged; add an all-null case returning `not-found`; add `["a non-number close", …, json({ isoCurrency: "EUR", datetimeLast: [1], last: ["1.0"] })]` to the `schema` table -- covers the I/O matrix.

**Acceptance Criteria:**
- Given an eod_history response whose arrays contain null entries for some days, when `fetchHistory` runs, then it returns `ok: true` with the closes of all non-null days in the range and never `reason: "schema"`.
- Given the unchanged recorded Xetra-Gold responses, when the existing onvista tests run, then they all still pass unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 12 findings — high 0, medium 0, low 5, false 7, maybe-false 0
- findings:
  - `[false]` `[reject]` Null-timestamp tests would pass without the `seconds === null` guard (null * 1000 = epoch, before any range) — deleting the guard fails `tsc` (`seconds * 1000` on `number | null`), so the regression is caught by `npm run typecheck`; the schema change itself is pinned by the tests (reverting it yields `schema`).
  - `[false]` `[reject]` `close === null` half of the guard is runtime-redundant with `!(close > 0)` — true but harmless: it narrows the type for `canonicalDecimal(String(close))`; no bad outcome.
  - `[false]` `[reject]` `fetchLatest` untested with trailing nulls — `latestClose` (shared.ts) takes the last element of the `fetchHistory` result, which never contains null entries; same code path already tested.
  - `[false]` `[reject]` Last-of-date-wins untested together with nulls — the early return precedes `byDate.set`, so a null entry cannot overwrite an earlier close; no bad outcome.
  - `[low]` `[reject]` All-null history returns `not-found` like an unknown ISIN — pre-existing semantics (an empty in-range history already maps to `not-found`); a new reason adds public surface for a rare case.
  - `[low]` `[reject]` Combined gap test overlaps the per-field `it.each` — the combined case is what the intent asks for (a gap day with both nulls); per-field cases cover separate matrix rows; overlap is cosmetic.
  - `[low]` `[patch]` New schema row "arrays of different length with null entries" placed away from its sibling — moved it directly after "arrays of different length"; onvista tests 21/21 pass.
  - `[low]` `[reject]` Fixture-derived tests use unchecked casts — same pattern as the existing USD test (`as object`); a fixture change fails loudly through the length/date assertions.
  - `[false]` `[reject]` (intent-alignment) No live observation of onvista nulls (ledger R2) — the bundle intent explicitly directs accepting and skipping nulls; AGENTS.md forbids live providers in tests; accepting nulls is harmless if onvista never emits them.
  - `[false]` `[reject]` (intent-alignment) "Recorded-response style" met by mutating the recorded fixture in memory — no recorded gap-day response exists; deriving from the recording is the established pattern in this test file.
  - `[false]` `[reject]` (intent-alignment) No service-level test in `prices.ts` — the service consumes the adapter's `DailyClose[]` unchanged; the failure mode (`schema`) originates and is now fixed at the adapter boundary.
  - `[low]` `[reject]` (intent-alignment) Schema omits Yahoo's `.optional()` — JSON arrays cannot hold `undefined`, so `.optional()` on array elements has no effect.

## Verification

**Commands:**
- `npx vitest run src/modules/prices/providers/onvista.test.ts` -- expected: all tests pass
- `npm run lint && npm run typecheck && npm test` -- expected: success

## Auto Run Result

Status: done

**Summary:** The onvista adapter now accepts `null` entries in `eodSchema.datetimeLast`/`last` (equal-length refinement kept) and skips index pairs whose timestamp or close is null, so a gap day no longer turns the whole certificate history into a `schema` failure (DW-11).

**Files changed:**
- `src/modules/prices/providers/onvista.ts` -- nullable array entries in `eodSchema`, null pairs skipped, doc comment updated.
- `src/modules/prices/providers/onvista.test.ts` -- combined gap-day test (null close + null timestamp, 15 closes), per-field null tests (16 closes each), all-null `not-found` test, two new `schema` cases (length mismatch with nulls, string close).

**Review findings:** 12 findings; 1 patch applied (low: moved a schema-table row next to its sibling); 0 deferred; 11 rejected (7 false, 4 low) — reasons in the Review Triage Log.

**Follow-up review recommendation:** false — patched: high 0, medium 0, low 1.

**Verification:** `npx vitest run src/modules/prices/providers/onvista.test.ts` 21/21 passed; `npm run lint` ok; `npm run typecheck` ok; `npm test` 261 files / 3626 tests passed.

**Residual risks:** Whether onvista actually emits `null` for gap days remains unobserved; the change is defensive and does not handle other gap shapes (omitted entries, strings), which still return `schema`.
