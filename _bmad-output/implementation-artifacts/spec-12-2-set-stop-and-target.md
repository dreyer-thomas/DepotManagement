---
title: 'Set Stop and Target'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_revision: '1bf0f45de7b2e10c05873b86a9430d0212b3ce3c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Stop-loss and price-target recommendations for held or watched stocks live only as free text in watchlist notes; there is no structured place to record them and nothing can evaluate them.

**Approach:** A new `PriceMark` table (one row per Security) owned by a new `marks` module whose service is the only write path; a pure `src/core/price-marks.ts` validates input and derives the state (effective stop, distances, `breached`) on read. The app edits marks in a dialog "Kursmarken bearbeiten" (Security detail page actions menu) and in the watchlist "Eintrag bearbeiten" dialog, with the EUR analyst-target suggestion; export/restore carry `priceMarks` (schema version 7).

## Boundaries & Constraints

**Always:**
- Stop: `FIXED` (EUR price > 0) or `TRAILING` (percent, 1 ≤ p ≤ 50, decimals allowed). Target: EUR price > 0. Each mark has an optional source (trimmed, ≤ 200 chars, empty → `null`) and a set date `YYYY-MM-DD` ≤ today (default today). Decimals stored as canonical strings; UI input parsed with `parseDecimalInput` (German format).
- Stop above / target below the latest Price is a non-blocking warning in the form, never an error.
- `priceMarkState(marks, observations, actions, today)` in core: latest = `resolvePrice` over `adjustedObservations(..., today)` for `currentSecurityId(marks.securityId, actions, today)`. Fixed stop and target are carried to today's units with `adjustedPrice(marks.securityId, setDate, value, actions, today)`. Trailing effective stop = high × (1 − p/100), high = max of the resolved Price as of the set date (in today's units) and every `tradingDayCloses` close dated after the set date and the latest Price — so it never falls; `null` without any of them. Distance = mark ÷ latest − 1 (`ratioString`), `null` without latest or latest 0. `breached` = `stop` if latest ≤ effective stop, else `target` if latest ≥ target, else `none` (equal = breached; no latest → `none`).
- ISIN change: a mark stored on a predecessor applies to the Security it maps to today (`currentSecurityId`); reading a Security prefers its own row, else a predecessor row; writing upserts the row of the current Security and deletes predecessor rows mapping to it, in one transaction.
- Service `setPriceMarks(securityId, patch, today)`: `patch.stop` / `patch.target` — omitted = unchanged, `null` = cleared, object = set (validated by core); both cleared → row deleted. Unknown Security → `not-found`.
- Export `priceMarks: [{ id, securityId, stop: {type, value, source, setDate} | null, target: {price, source, setDate} | null }]`; restore writes them after the ledger; upgrade 6→7 adds `priceMarks: []`; consistency: unique ids, `securityId` resolves and is unique.
- UI German, de-DE; analyst mean target offered as button "Analystenziel übernehmen (245,00 €)" only when its currency is `EUR` (fills the target price); other currency → hint "Analystenziel: 245,00 USD – andere Währung, nicht übernehmbar" without button; no target → nothing.

**Never:** No breach display, card, chart lines, dashboard or MCP tool (stories 12.3–12.5). Marks never feed valuations, returns, tax, ledger or Prices. No stored derived state. No provider call. No edit of existing migrations or tables beyond the new relation field on `Security`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fixed stop | stop FIXED 90, latest 100 | effective 90, distance −0.1, none | — |
| Stop edge | stop FIXED 100, latest 100 | breached `stop` | — |
| Target edge | target 120, latest 120 | breached `target` | — |
| Trailing | 10 %, set 2026-10-01, closes after: 110, 120, 105 | high 120, effective 108, latest 105 → `stop` | — |
| High before set date | close 200 on 2026-09-20, set 2026-10-01 (resolved 100 then) | 200 ignored; high from 100 and later closes | — |
| Split after set date | FIXED 90 set before 1:2 split, latest 50 | effective 45, no false breach | — |
| Missing Prices | no observations | price null, distances null, effective trailing null, `none` | — |
| Invalid input | "abc", "0", trailing 60, source 201 chars, future date | — | `price-marks-invalid` with field + problem, nothing written |

</intent-contract>

## Code Map

- `src/core/watchlist.ts` -- `entryFigures` pattern: adjusted observations + `currentSecurityId` + `resolvePrice`.
- `src/core/security.ts` -- `adjustedObservations`, `currentSecurityId`, `securityChain`.
- `src/core/corporate-actions.ts:305` -- `adjustedPrice` (split/ISIN to today's units).
- `src/core/key-figures.ts:123` -- `tradingDayCloses` (stored closes, adjusted, one per date).
- `src/core/decimal-input.ts`, `src/core/decimal.ts`, `src/core/returns.ts` (`ratioString`, `ReturnDecimal`), `src/core/dates.ts` (`isBusinessDate`).
- `src/modules/ledger` -- `securityPriceObservations(ids, today, { storedPrices }, db)`, `getSecurity`, `listIsinChanges`; `src/modules/prices` -- `storedPriceHistory`.
- `src/modules/watchlist/{index,backup,entries}.ts` -- module/backup pattern to mirror.
- `prisma/schema.prisma` (`Security` model l.57), `prisma/migrations/20261101000000_add_watchlist/migration.sql` -- migration style.
- `src/modules/backup/{schema,export,restore,upgrade,consistency}.ts` + tests -- version 6 → 7, `priceMarks` key after `watchlists`.
- `src/app/_components/watchlists/WatchlistEntryDialog.tsx` (`EditEntryForm`), `WatchlistTable.tsx` (renders `EditWatchlistEntryDialog`), `src/app/(app)/watchlists/page.tsx` (loads `listKeyFigures`), `src/app/_actions/watchlists.ts` (`updateWatchlistEntryAction`).
- `src/app/_components/security-detail/SecurityActions.tsx` (kebab menu), `src/app/(app)/securities/[id]/page.tsx` (loads `listKeyFigures([id])`; analyst target at `snapshot.analysts.target.{mean,currency}`).
- `test/helpers/test-db` -- `createTestDatabase` for DB tests.

## Tasks & Acceptance

**Execution:**
- `src/core/price-marks.ts` (+ `.test.ts`) -- types (`PriceMarks`, `StopMark`, `TargetMark`, `PriceMarksPatch`, `PriceMarkState`, `PriceMarksInvalid { ok:false; reason:"price-marks-invalid"; field; problem }`), constants (`PRICE_MARK_SOURCE_MAX_LENGTH = 200`, percent bounds), `checkPriceMarksPatch(patch, today)`, `parsePriceMarksForm(raw strings, today)` (German decimals → full patch), `priceMarkWarnings(marks, latest)`, `priceMarkState(...)` -- one pure source of truth; tests cover the matrix plus ISIN change and validation.
- `prisma/schema.prisma` + `prisma/migrations/20261111000000_add_price_mark/migration.sql` -- `PriceMark { id, securityId @unique (cascade), stopType PriceMarkStopType?, stopValue, stopSource, stopSetDate, targetPrice, targetSource, targetSetDate, updatedAt }` all TEXT/nullable; enum `PriceMarkStopType { FIXED TRAILING }`.
- `src/modules/marks/{marks.ts,backup.ts,index.ts}` (+ `marks.test.ts`) -- `getPriceMarks`, `priceMarksView(ids, today)` → `Record<id, { marks: PriceMarks | null; state: PriceMarkState }>`, `setPriceMarks`, `exportPriceMarks`, `replaceAllPriceMarks`; DB tests: set, partial patch, clear/delete, not-found, ISIN follow (read + write), view state.
- `src/modules/backup/*` (+ tests, other `schemaVersion: 6` fixtures) -- version 7, `priceMarks` schema/export/restore/upgrade/consistency; old v6 export restores with no marks.
- `src/app/_components/price-marks/{PriceMarkFields.tsx,PriceMarksDialog.tsx,form-fields.ts,labels.ts}` (+ DOM test) -- controlled fields (stop kind select "Kein Stopp/Fester Kurs/Nachlaufend", value/percent, source, date; target price, source, date; warnings; analyst suggestion) and the standalone dialog.
- `src/app/_actions/price-marks.ts` (+ test) -- `setPriceMarksAction` (session check, parse, service, revalidate `/`, `/securities`, `/securities/[id]`, `/watchlists`).
- `src/app/_actions/watchlists.ts`, `WatchlistEntryDialog.tsx`, `WatchlistTable.tsx`, `src/app/(app)/watchlists/page.tsx` -- edit dialog embeds the fields; action validates marks before the entry update, writes them after it; page passes marks + analyst targets per Security.
- `SecurityActions.tsx`, `src/app/(app)/securities/[id]/page.tsx` -- menu item "Kursmarken bearbeiten …" opening `PriceMarksDialog` with current marks, latest Price, analyst target.

**Acceptance Criteria:**
- Given a held or watched Security, when I save stop/target in either dialog, then `priceMarksView` returns them and reopening the dialog shows them; clearing both removes the row.
- Given an analyst mean target in EUR, when the dialog opens, then "Analystenziel übernehmen (…)" fills the target; in USD only the hint shows.
- Given an export with marks, when restored, then the marks are identical; a v6 export restores without error and without marks.

## Spec Change Log

## Review Triage Log

### 2026-11-11 — Review pass
- verdicts: 29 findings — high 0, medium 4, low 15, false 10, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) Unchanged save after an ISIN change writes predecessor-unit values onto the successor (false breach) — `getPriceMarks`/`priceMarksView` now return marks carried to the current Security (`carryPriceMarks`); marks.test.ts asserts successor units and unchanged state on re-save.
  - `[low]` `[reject]` (blind) Form warnings compare stored set-date-unit values with today's Price after a split — real but needs a split after the set date (rare); fix needs adjusted values plumbed into the form (new branch/props); misleading hint only, no data change.
  - `[low]` `[reject]` (blind) Entry saved but marks write fails in `updateWatchlistEntryAction` — reachable only if the Security vanishes between two calls (only a restore deletes Securities); fix needs a cross-module transaction.
  - `[low]` `[patch]` (blind) `WatchlistTable` fallback renders empty marks fields and clears marks on a note save — fallback is now `undefined` (fields omitted, marks unchanged).
  - `[low]` `[reject]` (blind) Restore loses the `updatedAt` tie-break between several predecessor rows — needs two predecessor rows for one Security, which the service never leaves; fix adds export surface.
  - `[false]` `[reject]` (blind) Export silently drops partly filled rows — no writer creates partial rows (service and restore always write complete marks).
  - `[low]` `[reject]` (blind) Whole `PriceMark` table and corporate actions loaded per read — one row per Security, single-user SQLite; negligible.
  - `[low]` `[patch]` (blind) Source fields accept > 200 characters until save — added `maxLength` to both source inputs.
  - `[low]` `[reject]` (blind) Consistency check accepts predecessor and successor rows both present — read prefers the current Security's row; unlikely, fix adds chain checks.
  - `[low]` `[reject]` (blind) Several UI paths untested (hand-edited date, alerts, midnight-sensitive page test) — generic; the table forwarding gap is patched below; the page test pattern pre-exists.
  - `[false]` `[reject]` (blind) Revalidating after `not-found` undocumented — deliberate, same pattern as `updateWatchlistEntryAction` (refresh a stale page).
  - `[false]` `[reject]` (blind) `checkStop` accepts arrays — an array has no valid `type`, so it is refused as `stopType invalid`.
  - `[medium]` `[patch]` (edge) Successor dialog prefilled with predecessor row — same root cause as the ISIN re-save row; same fix.
  - `[medium]` `[patch]` (edge) Note-only edit of a successor's entry rewrites marks in wrong units — same root cause; same fix.
  - `[low]` `[reject]` (edge) Split warning false positive — same as the blind split-warning row.
  - `[low]` `[reject]` (edge) Existing value shown in set-date units after a split — same root cause as the split-warning row; rare, display only.
  - `[low]` `[reject]` (edge) Partial write when marks write returns not-found — same as the blind partial-write row.
  - `[low]` `[reject]` (edge) Stale snapshot overwrites newer marks (MCP/other tab) — single user, no MCP writer yet; optimistic locking is new surface.
  - `[low]` `[reject]` (edge) `carryPriceMarks` mis-handles successor splits dated between set date and ISIN change — needs a successor that split before the ISIN change existed; fix adds date-dependent filtering.
  - `[medium]` `[patch]` (edge, claim) Reopened dialog shows raw predecessor values — same root cause; same fix.
  - `[low]` `[patch]` (verification-gap) `WatchlistTable` forwarding of `priceMarks[securityId]` untested — added DOM cases in `WatchlistTable.dom.test.tsx` (stop 90 shown; no marks → no fields).
  - `[low]` `[reject]` (verification-gap other) Entry saved while marks write fails — same as the blind partial-write row.
  - `[false]` `[reject]` (intent a) Menu item not limited to held/watched — every Security with a detail page is held, formerly held or watched; no harm.
  - `[false]` `[reject]` (intent b) Only the edit dialog gets the fields — the edit dialog satisfies "set, change or clear" from the watchlist entry dialog.
  - `[false]` `[reject]` (intent c) MCP not wired — the MCP tool is story 12.5; the service accepts the MCP patch shape.
  - `[false]` `[reject]` (intent d) Trailing high includes the Price in effect on the set date and the latest Price — a reading of "since the set date"; earlier highs never count, tested.
  - `[false]` `[reject]` (intent e) Warning direction flipped versus literal AC text — the literal text describes the normal case; the warning semantics match the epic context.
  - `[false]` `[reject]` (intent f) Set date moves to today on a level change; v6 restore replaces marks — sensible default and replace-semantics restore.
  - `[false]` `[reject]` (intent g) Required unit tests live in core — the AC asks for unit tests; DB-level cases also exist.

## Design Notes

The trailing high includes the Price in effect on the set date (resolved, carried forward) so a mark set on a weekend has an effective stop immediately; earlier, higher closes never count. Watchlist "Eintrag bearbeiten" is the entry dialog that gains the fields (the add dialogs stay unchanged); the detail page entry point is a kebab-menu item, story 12.3 adds the card button reusing `PriceMarksDialog`.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Price marks per Security: new `PriceMark` table (migration `20261111000000_add_price_mark`), `marks` module as the only write path, pure `core/price-marks` for validation, warnings and the derived state (effective fixed/trailing stop in today's units, distances, `breached`, ISIN-change carry). Editing via "Kursmarken bearbeiten …" in the detail page actions menu and in the watchlist "Eintrag bearbeiten" dialog, with the EUR analyst-target suggestion. Export schema version 7 with `priceMarks`; v6 exports upgrade with none.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261111000000_add_price_mark/` — table and enum.
- `src/core/price-marks.ts` (+ test) — validation, form parsing, warnings, state, carry.
- `src/modules/marks/` (+ test) — `getPriceMarks`, `priceMarksView`, `setPriceMarks`, export/restore writers.
- `src/modules/backup/*` (+ tests), `test/helpers/backup-seed.ts`, `src/app/_actions/backup.test.ts` — version 7, `priceMarks`.
- `src/app/_components/price-marks/` (+ DOM tests) — fields, dialog, labels, form names.
- `src/app/_actions/price-marks.ts` (+ test), `src/app/_actions/watchlists.ts` (+ test) — server actions.
- `WatchlistEntryDialog.tsx`, `WatchlistTable.tsx`, `src/app/(app)/watchlists/page.tsx`, `SecurityActions.tsx`, `src/app/(app)/securities/[id]/page.tsx` (+ tests) — UI wiring.

**Review findings:** 29 — high 0, medium 4, low 15, false 10. Patched: 1 medium entry (ISIN predecessor marks returned in successor units; 4 medium rows) and 3 low (table fallback, table forwarding test, source maxLength). Deferred: none. Rejected: 21 — reasons per row in the Review Triage Log.

**Follow-up review recommended:** false — first pass patched 0 high and 1 medium entry (patched counts: high 0, medium 1, low 3).

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — pass (274 files, 3872 tests; build compiled).

**Residual risks:** form warnings and shown values use stored set-date units when a split happened after the set date (misleading hint only); entry update and marks write in the watchlist dialog are not one transaction; `carryPriceMarks` is inexact if a successor split before its ISIN change.
