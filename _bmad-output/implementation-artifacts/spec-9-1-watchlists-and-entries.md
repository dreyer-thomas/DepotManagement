---
title: 'Watchlists and Entries (story 9-1)'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '158aa2be1ff7c5ccf46bdaa101924beba617095f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Tommy has no place to park investment ideas: a Security can only be followed when it is held, so ideas get lost and their price development since the idea is invisible.

**Approach:** A new `watchlist` module owns `Watchlist` and `WatchlistEntry` (AD-2). A new "Watchlists" surface (drawer between Wertpapiere and Einstellungen, under "Mehr" on phones) manages several named lists and their entries; per entry the pure core computes the resolved Price, stale flag, change today and change since added (split-adjusted), and sorts. Watchlist Securities join the price targets like benchmarks, wired in by the app layer because `prices` must not depend on `watchlist`.

## Boundaries & Constraints

**Always:**
- List name: required (trimmed, NFC), ≤ 60 chars, unique case-insensitively (like Depot names). Lists ordered by creation (`position`, max+1).
- Entry: one Security per list (DB unique `(watchlistId, securityId)`); a Security may be on several lists. Note plain text ≤ 2000 chars (empty allowed). Date added: business date `YYYY-MM-DD`, ≤ today, default today.
- Unknown ISIN / crypto symbol via "Neue Security anlegen" is created only through `ledger.ensureSecurity` (AD-16), in the same DB transaction as the entry.
- "Change since added" = resolved Price today ÷ resolved Price on the date added − 1, both resolved over observations carried to today's units (`adjustedPrice`, so a split after the date added is neutral); carry-forward per AD-9; `null` ("–") when either Price is missing or zero.
- "Change today" = latest resolved Price vs. the resolved Price on the day before that Price's date (last trading-day change): €/unit difference and ratio; `null` without a previous Price.
- Stale = core `isStale(latestPriceDate, today)` — applies to every entry with a Price.
- "im Bestand" chip only when `listHeldSecurities(today)` contains the Security; watchlist Securities never enter Positions, totals or analyses.
- Price targets: watched Securities are fetched from `watchlistHistoryStart(earliest date added, today)` = `benchmarkStartDate(earliestAdded, today)` (earlier of `3J` preset start and the earliest date added, minus the 10-day base buffer); when also held, the earlier of that and its first activity date. A Security on no list and not held is no longer planned; its stored Prices stay.
- Removing an entry or deleting a list never deletes a Security or its Prices.
- Money/prices/ratios as decimal strings via `decimal.js`; server actions check the session first (`UNAUTHORIZED` pattern); UI text German.
- Columns `source` (`APP` | `MCP`, default `APP`) and nullable `clientName` exist on WatchlistEntry now; this story only writes `APP`; the row shows chip "via Claude" when `source = MCP`.

**Never:**
- No buy action from a watchlist; no Security-detail changes (story 9.2), no export/restore of watchlists (9.3), no MCP/OAuth (9.4/9.5), no news-set change.
- `prices` never imports `@/modules/watchlist`; `watchlist` never touches ProviderMapping/Price/Security tables directly.
- Never store computed figures (price, changes) on entries; never edit committed migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create list | name "Ideen" | list created at the end, opened | — |
| Duplicate list name | "ideen" when "Ideen" exists | refused | `name-taken` → "Name ist schon vergeben" |
| Name too long / empty | 61 chars / "  " | refused | `name-too-long` / `name-empty` |
| Delete non-empty list | list with 3 entries | confirm dialog names list and "3 Einträge"; entries removed, Securities and Prices kept | — |
| Add existing Security | Security already on this list | refused | `already-on-list` → "Steht schon auf dieser Liste" |
| Add same Security to another list | on list A, add to B | succeeds | — |
| New Security | unknown ISIN + name + type | `ensureSecurity` creates it, entry added, backfill scheduled | ledger reasons (isin-invalid, name-empty …) shown on fields |
| Note too long | 2001 chars | refused | `note-too-long` |
| Date added in future / invalid | tomorrow / "31.02." | refused | `date-invalid` |
| Move entry | to list where Security already is | refused | `already-on-list` |
| No Price | Security without any Price | Price "–", changes "–", no stale badge | — |
| Split after date added | 1:4 split between date added and today; unadjusted stored Prices 100 → 26 | since added = 26 / 25 − 1 = +4 % | — |
| Sort | default | date added desc; ties by name; nulls last for change sorts in both directions | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- add `Watchlist`, `WatchlistEntry`, enum `WatchlistEntrySource`; `Security.watchlistEntries` relation (entry → Security `onDelete: Cascade`, so the ledger restore's `security.deleteMany` keeps working until 9.3).
- `prisma/migrations/` -- latest is `20261031000000_add_target_allocation`; add `20261101000000_add_watchlist/migration.sql` (match `prisma migrate diff` output style of earlier migrations).
- `src/modules/rebalancing/{index,targets,backup}.ts` -- template for a small owned-model module: `XxxDb = Prisma.TransactionClient`, typed result unions, `now` injection, header comment on ownership.
- `src/modules/ledger/depots.ts:46-75` -- name schema (`normalize NFC, trim, min/max`), case-insensitive `nameKey`/`isNameTaken`, P2002 handling: copy the pattern.
- `src/modules/ledger/securities.ts:135` `ensureSecurity(identifier, details, db)` -- idempotent creation; `getSecurity`, `listSecurities`.
- `src/modules/ledger/positions.ts:46` `lineageObservations` (not exported) + `loadCorporateActions` (`./corporate-actions`) -- add an exported ledger service `securityPriceObservations(securityIds, asOf, { storedPrices }, db)` → `{ observations, actions }`; export from `src/modules/ledger/index.ts`.
- `src/modules/ledger/depots.ts` `listHeldSecurities(today, db)` -- the held set.
- `src/core/security.ts:243` `adjustedObservations` (private) -- export it for reuse by `core/watchlist`.
- `src/core/prices.ts` `resolvePrice`, `isStale`; `src/core/benchmarks.ts` `benchmarkStartDate`; `src/core/returns.ts` `ReturnDecimal`, `ratioString`; `src/core/dates.ts` `addDays`, `isBusinessDate`.
- `src/modules/prices/prices.ts:103-140` `heldPlans` -- add `PriceDeps.watched?: (today, db) => Promise<ReadonlyMap<string, string>>` (securityId → first history date); merge ids into `targets` and take the earlier date into `firstDates`; works when `firstLedger` is null. `refreshPrices`/`backfillHeldPrices` pass deps through unchanged.
- `src/instrumentation-node.ts:47-56`, `src/app/_actions/prices.ts:42`, `src/app/_actions/price-refresh.ts:39` -- the three price-run call sites; pass `{ watched: watchlistPriceTargets }`.
- `src/app/_components/navigation.ts` (+ `navigation.test.ts`, `AppShell.dom.test.tsx`) -- drawer: …Wertpapiere, Watchlists, Einstellungen; moreItems: Import, Wertpapiere, Watchlists, Einstellungen; `/watchlists` maps to "Mehr".
- `src/app/_actions/depots.ts` -- server-action pattern (zod `formText`, `getSession`, `revalidatePath`); `schedulePriceBackfill()` after adding an entry or moving its date earlier.
- `src/app/_components/securities/security-options.ts`, `src/app/_actions/new-security-input.ts`, `src/app/_components/transactions/TransactionDialog.tsx:249-323`, `transactions/labels.ts` (`ASSET_TYPE_LABELS`, `NEW_SECURITY_ASSET_TYPES`) -- the Security Autocomplete with "Neue Security anlegen" fields to mirror in the entry form.
- `src/app/_components/charts/chart-preference.ts:57-71` + `src/app/_actions/chart-preference-cookie.ts` -- client-written UI cookie pattern for "last opened list".
- `src/app/_components/positions/PositionsTable.tsx`, `prices/StaleBadge.tsx` (`PriceDate`), `securities/SecurityLogo.tsx`, `positions/GainLossPill.tsx` -- table/stacked-row, price-date and logo patterns to mirror.
- `src/app/(app)/depots/page.tsx`, `src/app/(app)/settings/page.tsx` -- page skeleton (`PageTitle`, LogoProvider is in the app layout).
- `test/helpers/test-db.ts`, `test/helpers/dom.tsx`, `test/helpers/next-mocks.ts` -- DB and DOM test helpers.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/20261101000000_add_watchlist/migration.sql` -- models `Watchlist { id, name @unique, position Int @unique, createdAt }`, `WatchlistEntry { id, watchlistId (Cascade), securityId (Cascade), note String @default(""), dateAdded, position Int, source WatchlistEntrySource @default(APP), clientName String?, createdAt; @@unique([watchlistId, securityId]); @@index([securityId]) }`; run `npx prisma generate`.
- `src/core/watchlist.ts` + `src/core/watchlist.test.ts` -- pure `WATCHLIST_NAME_MAX_LENGTH=60`, `WATCHLIST_NOTE_MAX_LENGTH=2000`, `entryFigures(observations, securityId, actions, dateAdded, today)` → `{ price, priceDate, source/fetchedAt/provider, stale, changeToday: {perUnit, ratio}|null, sinceAdded: ratio|null }`, `sortWatchlistEntries(rows, key, direction)` (keys `name|changeToday|sinceAdded|dateAdded`, default `dateAdded desc`, nulls last, tie name then id), `watchlistHistoryStart(earliestAdded, today)`, `firstNoteLine(note)`; tests cover every matrix row incl. the split case and carry-forward.
- `src/core/security.ts` -- export `adjustedObservations`.
- `src/modules/ledger/positions.ts`, `src/modules/ledger/index.ts` -- `securityPriceObservations` export (+ test in `positions.test.ts`).
- `src/modules/watchlist/{index,watchlists,entries}.ts` + `watchlist.test.ts` -- services `listWatchlists`, `createWatchlist`, `renameWatchlist`, `deleteWatchlist` (returns deleted entry count), `addWatchlistEntry({ watchlistId, security: {id}|{new: NewSecurityInput}, note, dateAdded }, today, db, now)` (ensureSecurity inside one transaction), `updateWatchlistEntry(id, { note, dateAdded, watchlistId })`, `removeWatchlistEntry`, `watchlistView(today, db)` (lists + entries with Security, figures, held flag, logo-ready fields), `watchlistPriceTargets(today, db)`; typed failure reasons from the matrix; tests on a throwaway DB.
- `src/modules/prices/prices.ts` (+ `prices.test.ts`) -- `watched` dep in `heldPlans` as in Code Map; tests: watched-only Security planned from `watchlistHistoryStart`, held+watched takes the earlier date, dropped Security no longer fetched but Prices kept.
- `src/instrumentation-node.ts`, `src/app/_actions/prices.ts`, `src/app/_actions/price-refresh.ts` -- pass `watched: watchlistPriceTargets` (update their tests where they assert call args).
- `src/app/_actions/watchlists.ts` (+ test) -- server actions for all services; revalidate `/watchlists`; `schedulePriceBackfill()` after add / date change.
- `src/app/_components/navigation.ts` (+ tests) -- nav entry "Watchlists" (`/watchlists`, icon `VisibilityOutlined`).
- `src/app/_components/watchlists/` -- `labels.ts` (+ test; German failure messages, "N Einträge"), `WatchlistTabs` (tabs ≥ sm, select below, writes cookie `dm_watchlist`), `WatchlistDialogs` (create/rename/delete-confirm), `WatchlistEntryDialog` (Autocomplete + new-Security fields, note, date added; edit mode adds list select and "Entfernen"), `WatchlistTable` (desktop table + phone stacked rows; columns per AC; sortable headers; row links to `/securities/<id>`), with `*.dom.test.tsx` for the dialogs and table.
- `src/app/(app)/watchlists/page.tsx` (+ `page.test.tsx`) -- reads `?list=` else cookie else first list; empty state with "Watchlist anlegen"; toolbar "Wertpapier hinzufügen", rename, delete.

**Acceptance Criteria:**
- Given the app shell, when viewed ≥ md, then "Watchlists" sits between Wertpapiere and Einstellungen in the drawer; below md it is listed under "Mehr" and `/watchlists` highlights "Mehr".
- Given no watchlist, when opening `/watchlists`, then an empty state offers "Watchlist anlegen".
- Given lists A then B, when opening `/watchlists`, then tabs (select on phones) show A, B in creation order; after opening B, a later visit without `?list=` opens B (cookie).
- Given an entry, when viewing the list, then the row shows logo, name, ISIN/symbol, Price with date/stale badge, change today (% and €/unit), change since added (%), date added, first note line, "im Bestand" when held, and clicking it opens `/securities/<id>`.
- Given entries, when clicking a sortable header (name, change today, since added, date added), then rows reorder via `sortWatchlistEntries`; default is date added newest first.
- Given an entry, when editing note/date or moving it to another list, or removing it, then the change persists and the Security and its Prices remain.
- Given a watched, unheld Security with a mapping, when a price run executes, then its history is fetched from `watchlistHistoryStart`; after it leaves every list, the next run no longer plans it.
- Given the full suite, when running `npm run lint && npm run typecheck && npm test && npm run build`, then all pass, including `test/architecture/core-imports.test.ts`.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 29 findings — high 0, medium 1, low 24, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: watchlistPriceTargets plans the pre-ISIN-change id, so an unheld successor is never priced — rare (ISIN change on a watched, unheld Security); fix needs corporate actions in the target loader, more than a direct correction.
  - `[low]` `[patch]` Blind: "im Bestand" checks the original id after an ISIN change — `held` now uses core `currentSecurityId` (re-exported from `core/security`, also used by `entryFigures`).
  - `[low]` `[reject]` Blind: a throwing `watched` loader aborts the price run — it is a local DB query; a DB failure breaks `listHeldSecurities` in the same run anyway; a guard adds a branch for an unlikely case.
  - `[low]` `[reject]` Blind: no lower bound on date added (e.g. 1900 → long backfill) — providers return only what exists; a min-date rule adds validation surface for a rare typo.
  - `[low]` `[reject]` Blind: "Heute" may compare with a weeks-old carried Price — the spec defines carry-forward on purpose; only transient before the first backfill.
  - `[low]` `[reject]` Blind: concurrent create may hit the `position` unique and 500 — single-user app; retry logic not worth it.
  - `[false]` `[reject]` Blind: non-string note maps to `note-too-long` — every caller (the server action via `formText`) passes strings; unreachable today.
  - `[low]` `[reject]` Blind: `watchlist-not-found` on move shows an Alert, field branch unused — Alert still shows the right message; cosmetic.
  - `[low]` `[reject]` Blind: add dialog offers Securities already on the list — the AC prescribes the "Steht schon auf dieser Liste" refusal; behaviour as specified.
  - `[low]` `[reject]` Blind: name-field `autoFocus` may be overridden by the focus trap — identical to the existing Depot dialogs pattern (`DepotDialogs.tsx:134`).
  - `[low]` `[reject]` Blind: "Entfernen" has no confirmation — not required by the AC; Security and Prices stay.
  - `[low]` `[reject]` Blind: note limit only enforced on submit — server validates with a German message; client limit would diverge from the trimmed NFC count.
  - `[low]` `[reject]` Blind: `listSecurities` loaded twice per page — negligible cost at single-user scale.
  - `[low]` `[reject]` Blind: entry `position` not unique per list — only used as a stable order; single-user.
  - `[low]` `[patch]` Edge: after a `not-found` delete the open dialog retargets the fallback list — Rename/Delete buttons keyed by the selected list id in `page.tsx`.
  - `[low]` `[reject]` Edge: ISIN successor not in price targets — same as the first Blind row.
  - `[low]` `[patch]` Edge: held flag ignores ISIN successor — same fix as the second Blind row.
  - `[low]` `[reject]` Edge: throwing `watched` loader fails the run — same as Blind row 3.
  - `[low]` `[reject]` Edge: "Heute" over a long gap — same as Blind row 5.
  - `[low]` `[reject]` Edge: position race on create — same as Blind row 6.
  - `[low]` `[patch]` Edge: stale remove error hides a later update error — update action now resets `removeState` first.
  - `[medium]` `[patch]` Verification gap: no restore test with existing watchlist entries (cascade) — added case in `src/modules/backup/restore.test.ts` asserting ok, 0 entries, list kept.
  - `[low]` `[patch]` Verification gap (other): held flag / ISIN successor — covered by the `currentSecurityId` fix; target-loader part rejected as Blind row 1.
  - `[low]` `[reject]` Intent: phone select of the tabs untested — standard MUI select switch; visual only.
  - `[low]` `[reject]` Intent: remembered list only tested as cookie write + read halves — a browser round trip is out of unit-test reach; both halves are covered.
  - `[false]` `[reject]` Intent: "Steht schon auf dieser Liste" not shown in a dialog test — `WatchlistEntryDialog.dom.test.tsx` "shows 'Steht schon auf dieser Liste' on the Security field".
  - `[low]` `[reject]` Intent: no end-to-end price run with `watchlistPriceTargets` — `prices.test.ts` covers `watched`, `watchlist.test.ts` covers the loader, call sites assert the wiring.
  - `[false]` `[reject]` Intent: "change today" reading and 10-day buffer narrow the AC — defined by the spec, not a defect.
  - `[false]` `[reject]` Intent: work uncommitted — committed at finalize.


## Design Notes

Dependency direction: spine AD-2 has `watchlist → prices`, so `prices` learns about watched Securities only through an injected `watched` loader that the app layer (instrumentation, server actions) wires to `watchlistPriceTargets`. Example:

```ts
// src/app/_actions/price-refresh.ts
(today) => backfillHeldPrices(today, { watched: watchlistPriceTargets }),
```

"Change today" deliberately compares the latest Price with the one resolved on the day before its date, so on weekends it shows the last trading day's move rather than "–".

Until story 9.3, a restore deletes Securities and thereby cascades watchlist entries away (lists remain empty); 9.3 adds watchlists to export/restore.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for Roboto).

## Auto Run Result

Status: done

**Summary:** Story 9.1 implemented: `watchlist` module (Watchlist, WatchlistEntry; create/rename/delete lists, add/edit/move/remove entries, `ensureSecurity` for new Securities in one transaction), pure `core/watchlist` (figures incl. split-neutral "since added", last-trading-day "Heute", sorting, history start), watched Securities injected into price runs (`PriceDeps.watched`, wired by instrumentation and the two price actions; `prices` never imports `watchlist`), Watchlists surface (nav entry, tabs/select with `dm_watchlist` cookie, dialogs, sortable table + phone rows, empty state).

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261101000000_add_watchlist/migration.sql` — new models/enum, cascades.
- `src/core/watchlist.ts` (+test) — figures, sort, history start, limits; `src/core/security.ts` — export `adjustedObservations`.
- `src/modules/ledger/positions.ts`, `index.ts` (+test) — `securityPriceObservations`.
- `src/modules/watchlist/*` (+test) — services, view, price targets.
- `src/modules/prices/prices.ts` (+test) — `watched` dep in `heldPlans`.
- `src/instrumentation-node.ts`, `src/app/_actions/prices.ts`, `src/app/_actions/price-refresh.ts` (+tests) — wire `watchlistPriceTargets`.
- `src/app/_actions/watchlists.ts` (+test) — server actions.
- `src/app/_components/navigation.ts`, `AppShell.dom.test.tsx` — nav entry.
- `src/app/_components/watchlists/*` (+tests) — labels, cookie, tabs, dialogs, entry dialog, table.
- `src/app/(app)/watchlists/page.tsx` (+test) — page.
- `src/modules/backup/restore.test.ts` — restore with existing entries.

**Review:** 4 patch entries applied (1 medium: restore test; 3 low: held flag after ISIN change, keyed list dialogs, stale remove error). The implementer's new `currentSecurityId` duplicated the existing `core/security` helper; replaced by a re-export. 0 deferred. 25 rejected — reasons per row in the Review Triage Log. Patched counts by verdict: high 0, medium 1, low 3 → follow-up review not recommended.

**Verification:** `npm run lint` ✓, `npm run typecheck` ✓, `npm run build` ✓ (route `/watchlists`). `npm test`: 3147/3152 passed; the 5 failures are timeouts in untouched tests (xirr speed, ReturnHeatmap, Parqet wizard, ClassificationDialog, TransactionDialog) under machine load 7–11, a different set each run; all pass when rerun in isolation. All story tests (core, module, actions, components, page, prices, ledger, restore, architecture) pass. Matrix audit: every I/O row covered by a passing test.

**Residual risks:** Until story 9.3 a restore deletes all watchlist entries (lists stay empty). An ISIN change on an unheld watched Security leaves the successor unpriced. Full-suite timing flakiness under load is pre-existing and environmental.
