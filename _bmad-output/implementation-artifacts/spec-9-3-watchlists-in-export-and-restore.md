---
title: 'Watchlists in Export and Restore (story 9-3)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '3cbe52ed7ae00dc6a32747be1ccc2f84921b6a35'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Story 9.4 must clear its OAuth clients, grants and tokens inside the restore transaction and keep them out of the export.
    evidence: |-
      The restore dialog and README already say connected apps must reconnect after a restore, but no OAuth tables exist yet,
      so nothing in code or tests enforces it; once 9.4 adds the tables, restore must delete them (backup/restore.ts) or the text becomes untrue.
    location: >-
      src/modules/backup/restore.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** The JSON export (story 6.1) does not contain watchlists, and a restore (story 6.2) keeps the target's watchlists while their entries vanish with the replaced Securities, so ideas do not survive a restore or a move to the server.

**Approach:** Bump the export to `schemaVersion` 6 with a `watchlists` key (lists with nested entries), add a pure 5 → 6 upgrade step that yields empty watchlists, let the `watchlist` module export and replace its rows inside the restore transaction, check watchlist consistency before writing, and extend the restore confirmation text to say connected apps must reconnect.

## Boundaries & Constraints

**Always:**
- Export record per list: `id`, `name`, `position`, `createdAt`, `entries`: [`id`, `securityId`, `note`, `dateAdded`, `position`, `source` (`APP`/`MCP`), `clientName`, `createdAt`]; lists sorted by `position`, entries by `position` then `id`. Stored strings verbatim; key `watchlists` last in the file.
- Schema: name 1..`WATCHLIST_NAME_MAX_LENGTH` (60), note ≤ `WATCHLIST_NOTE_MAX_LENGTH` (2000, empty allowed), `dateAdded` business date, positions integers, `clientName` non-empty or null, timestamps as strings; strict objects.
- Consistency (pure, in `checkConsistency`): unique list ids, entry ids (across all lists), list positions and list names (case-insensitive like the app: NFC + `toLocaleLowerCase("de-DE")`); entry `securityId` resolves to `securities`; one entry per (list, Security).
- Upgrade: `UPGRADES[5]` adds `watchlists: []` and sets `schemaVersion: 6`; pure, like the existing steps.
- Restore replaces watchlists (delete all lists and entries, create the file's rows with their ids) inside the existing restore transaction, after `replaceAllLedger`; a failure rolls everything back. Restore never merges watchlists.
- The `watchlist` module owns `exportWatchlists(db)` / `replaceAllWatchlists(records, db)` (exported from `index.ts`); `backup` calls only these.
- `RESTORE_WARNING` gains: "Verbundene Apps (z. B. Claude) müssen danach neu verbunden werden."

**Never:**
- No OAuth client/grant/token data in the export (none exists yet; story 9.4 adds the tables and must clear them on restore).
- No new Prisma model or migration; no change to the daily DB-file backup (it copies the whole database already).
- No `dateAdded ≤ today` check in restore (consistency stays pure without "today"); no change to the held set or any figure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Export | 2 lists, entries incl. a watchlist-only Security and an MCP entry | `schemaVersion: 6`, `watchlists` sorted, all fields verbatim | — |
| Empty | no lists | `watchlists: []` | — |
| Round trip | export → restore into empty instance | byte-identical export; watchlist-only Security, its entry, note, source, clientName back | — |
| Replace | target has other lists/entries | afterwards exactly the file's lists | — |
| v5 file | no `watchlists` key | upgraded to `[]`; target's lists removed | — |
| Dangling entry | entry `securityId` not in `securities` | rejected | `inconsistent` at `watchlists.i.entries.j.securityId`, nothing written |
| Duplicate | same Security twice on a list / list names equal ignoring case / same position | rejected | `inconsistent` with the field path |
| Bad field | name > 60, note > 2000, bad date, unknown key | rejected | `schema-invalid` with path |

</intent-contract>

## Code Map

- `src/modules/backup/schema.ts` -- `EXPORT_SCHEMA_VERSION` 5 → 6; add `watchlistEntryRecordSchema`, `watchlistRecordSchema` (import limits from `@/core/watchlist`), `watchlists` last in `exportFileSchema`; header comment.
- `src/modules/backup/upgrade.ts` -- `UPGRADES` add step 5.
- `src/modules/backup/consistency.ts` -- add watchlist checks (pattern: `reconciliationRuns` nested rows, `unique`, `resolves`, `key`).
- `src/modules/backup/export.ts:34` `createExport` -- read `exportWatchlists(tx)`, add `watchlists` key last.
- `src/modules/backup/restore.ts:118-127` -- call `replaceAllWatchlists(file.watchlists, tx)` after `replaceAllLedger`; add count to the success `console.info`; header comment of `index.ts` module list.
- `src/modules/ledger/restore.ts:20` -- `security.deleteMany()` cascades entries (FK `onDelete: Cascade`); `replaceAllWatchlists` still deletes entries then lists explicitly.
- `src/modules/rebalancing/backup.ts` -- template for the new `src/modules/watchlist/backup.ts` (`exportWatchlists`, `replaceAllWatchlists`, own `WatchlistExport` type); `src/modules/watchlist/watchlists.ts` `WatchlistDb`; `prisma/schema.prisma:433-469` Watchlist/WatchlistEntry columns.
- `src/app/_components/backup/labels.ts:11` `RESTORE_WARNING`; `RestoreButton.dom.test.tsx:32` asserts the text.
- `README.md:108-150` -- export table: add `watchlists` row; restore "Replaced" list mentions watchlists and the reconnect note.
- Tests: `src/modules/backup/{export,upgrade,consistency,restore}.test.ts` (version literal 5, key list, "until story 9.3" test at `restore.test.ts:151` becomes the replace test), `test/helpers/backup-seed.ts` (add `seedWatchlists(c)` with a watchlist-only Security `sec-d` and its Price; keep `seedFullLedger` unchanged), `src/modules/watchlist/watchlist.test.ts`. `grep -rn "schemaVersion: 5\|toBe(5)" src test` for other literals.

## Tasks & Acceptance

**Execution:**
- `src/modules/watchlist/backup.ts`, `index.ts` (+ tests in `watchlist.test.ts`) -- export reader and replace writer.
- `src/modules/backup/schema.ts`, `upgrade.ts`, `consistency.ts`, `export.ts`, `restore.ts`, `index.ts` -- version 6 per Boundaries.
- `test/helpers/backup-seed.ts` -- `seedWatchlists`.
- `src/modules/backup/*.test.ts` -- update literals; tests for every matrix row (export shape, upgrade 5→6 and 1→6, consistency failures, round trip with the watchlist-only Security, replace, v5 file).
- `src/app/_components/backup/labels.ts` (+ `RestoreButton.dom.test.tsx`) -- reconnect sentence.
- `README.md` -- document `watchlists` and the reconnect note.

**Acceptance Criteria:**
- Given watchlists with entries, when exporting via `GET /api/export`, then the file has `schemaVersion: 6` and every list with its entries (Security reference, note, date added, position).
- Given an export with watchlists including a Security only on a watchlist, when restoring it into an empty instance, then a new export is byte-identical and the watchlist page data (`watchlistView`) shows the entry.
- Given a version-5 file, when restoring, then it succeeds and the instance has no watchlists.
- Given the restore dialog, when opened, then its text states that connected apps must reconnect.
- Given the full suite, when running `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 27 findings — high 0, medium 0, low 22, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: watchlist names/notes not NFC-trimmed on restore (blank or "Ideen " names) — only a hand-edited file reaches it (exports come from the app, which trims); the fix adds schema refinements.
  - `[low]` `[reject]` Blind: entry positions not unique per list / not positive — app always assigns max + 1; only hand-edited files; export order stays deterministic through the id tie-break.
  - `[low]` `[reject]` Blind: `source`/`clientName` not cross-checked — only hand-edited files; adds a cross-field rule.
  - `[low]` `[defer]` Blind: nothing forces 9.4 to clear OAuth data on restore while the text already promises reconnection — no OAuth table exists yet; recorded in `deferred` for 9.4.
  - `[low]` `[patch]` Blind: README says "a version-5 file has none" though versions 1–5 all upgrade to none — reworded to "a file older than version 6".
  - `[low]` `[patch]` Blind: README hard-codes the version (`6`) — row now points to `EXPORT_SCHEMA_VERSION` in `schema.ts`.
  - `[low]` `[reject]` Blind: restore log counts lists, not entries — the log does not count nested rows elsewhere either (reconciliation rows); informational only.
  - `[low]` `[reject]` Blind: field-by-field mapping in `exportWatchlists` and hand-written export types — mirrors `rebalancing/backup.ts`; restore direction is type-checked and export drift fails the strict schema in `export.test.ts`.
  - `[low]` `[reject]` Blind: backup round trip has no empty list — `replaceAllWatchlists` round-trips an empty list in `watchlist.test.ts`; no different code path.
  - `[low]` `[reject]` Blind: failure test triggers only on entry inserts — the whole step runs in the same transaction; another trigger adds no new branch.
  - `[low]` `[reject]` Blind: redundant `console.error` spy in the failure test — same pattern as the neighbouring logos-step test; harmless.
  - `[low]` `[reject]` Blind: no restore test of a v1–v4 file wiping watchlists — the upgrade chain 1→6 is unit-tested and v5 restore is tested end to end; same code path.
  - `[false]` `[reject]` Blind: spec committed with review placeholders/line refs — status and logs are filled at finalize; editing the spec is not a code fix.
  - `[low]` `[reject]` Edge: whitespace-only/untrimmed list name — same as Blind row 1.
  - `[low]` `[reject]` Edge: duplicate entry positions in one list — same as Blind row 2.
  - `[low]` `[reject]` Edge: position ≤ 0 or beyond Int32 — out-of-range fails inside the transaction as `restore-failed` and rolls back; only hand-edited files.
  - `[low]` `[reject]` Edge: future `dateAdded` accepted — only hand-edited files; checking needs "today" in the pure consistency check (spec Never).
  - `[low]` `[reject]` Edge: `source`/`clientName` contradiction — same as Blind row 3.
  - `[low]` `[patch]` Verification gap: entry tie-break "position, then id" untested — added "orders entries of equal position by id" in `watchlist.test.ts`.
  - `[low]` `[reject]` Verification gap (other): names/notes not normalized on restore — same as Blind row 1.
  - `[low]` `[reject]` Verification gap (other): name-key rule duplicated in `consistency.ts` — fix needs a new shared export in `core/watchlist`; the rule is stable and both sides are tested for case/NFC.
  - `[low]` `[reject]` Intent: `GET /api/export` not tested with watchlist data — the route only serializes `createExport()` (route.ts), which is tested with watchlists.
  - `[low]` `[reject]` Intent: restore server action not tested with watchlist data — the action passes the file to `restoreExport`, which has the round-trip test.
  - `[false]` `[reject]` Intent: OAuth exclusion is documentation only — no OAuth table exists, so the export cannot contain OAuth data; clearing on restore is 9.4's (deferred row above).
  - `[false]` `[reject]` Intent: reconnect sentence missing from the success message — the AC says "restore confirmation text", which is the confirm dialog (`RESTORE_WARNING`).
  - `[false]` `[reject]` Intent: daily DB-file backup will contain OAuth tables — the AC's "not exported" concerns the JSON export; the DB file is a raw recovery copy and no OAuth table exists yet.
  - `[false]` `[reject]` Intent: operator branch (`awaiting-operator`) not used — no AC needs a human action outside the repo; reconnecting is runtime guidance.

## Design Notes

Nested entries mirror `reconciliationRuns.rows` but without a redundant `watchlistId` (the parent is the list). `source`/`clientName` are kept so "via Claude" survives a round trip; they reference no OAuth row. Entries are written after the ledger because they reference Securities; watchlist-only Securities are ordinary `securities` records, so no extra handling is needed.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for Roboto).

## Auto Run Result

Status: done

**Summary:** Story 9.3 implemented: the JSON export is `schemaVersion` 6 with a final `watchlists` key (lists by position with nested entries: Security reference, note, date added, position, source, client name, timestamps). A pure upgrade step turns files of version 1–5 into empty watchlists. Restore checks watchlist consistency (unique ids/positions, case-insensitive unique names, resolvable Securities, one entry per Security and list) before writing and replaces all watchlists in the same DB transaction as the ledger through the `watchlist` module's `replaceAllWatchlists`. The restore dialog says connected apps (e.g. Claude) must reconnect. No OAuth data exists or is exported.

**Files changed:**
- `src/modules/watchlist/backup.ts`, `index.ts` (+ `watchlist.test.ts`) — `exportWatchlists`, `replaceAllWatchlists`.
- `src/modules/backup/schema.ts` — version 6, watchlist record schemas.
- `src/modules/backup/upgrade.ts` — step 5 → 6.
- `src/modules/backup/consistency.ts` — watchlist checks.
- `src/modules/backup/export.ts`, `restore.ts`, `index.ts` — read and replace watchlists; log count.
- `src/app/_components/backup/labels.ts` — reconnect sentence in `RESTORE_WARNING`.
- `test/helpers/backup-seed.ts` — `seedWatchlists` (watchlist-only Security `sec-d`, MCP entry).
- `src/modules/backup/{export,upgrade,consistency,restore}.test.ts`, `src/app/_actions/backup.test.ts`, `RestoreButton.dom.test.tsx` — version 6, matrix tests, round trip with `watchlistView`.
- `README.md` — `watchlists` key, OAuth note, restore wording.

**Review:** 27 findings (high 0, medium 0, low 22, false 5). 3 low patches applied (README version wording ×2, entry tie-break test). 1 deferred (9.4 must clear OAuth data on restore). 23 rejected — reasons per row in the Review Triage Log. Patched counts by verdict: high 0, medium 0, low 3 → follow-up review not recommended.

**Verification:** `npm run lint` ✓, `npm run typecheck` ✓, `npm run build` ✓. `npm test` full: 3186–3190/3200 passed in two runs; the 10–14 failures are 5 s timeouts / speed checks in files untouched by this diff (Depot detail page, ReturnHeatmap, Parqet wizard, IsinChangeDialog, ClassificationDialog, TransactionDialog, xirr speed) plus `RestoreButton.dom.test.tsx` (text-only change), under load average ~15 (another bmad-loop process and a game running); every failing file passes when run alone. After the review patches: backup, watchlist, export route, restore action, restore dialog and architecture tests 202/202 ✓. Matrix audit: every I/O row covered by a passing test.

**Residual risks:** Hand-edited export files can restore untrimmed names, duplicate entry positions or future dates added (the app never writes them). Until 9.4 clears OAuth data on restore, the reconnect sentence describes a future state. Not checked in a browser.
