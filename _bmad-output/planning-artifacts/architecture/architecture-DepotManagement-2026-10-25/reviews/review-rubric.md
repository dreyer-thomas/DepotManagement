---
title: Rubric review — ARCHITECTURE-SPINE (DepotManagement)
reviewed: _bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md
source: _bmad-output/planning-artifacts/prds/prd-DepotManagement-2026-10-25/prd.md (+ addendum.md)
date: 2026-10-25
verdict: PASS WITH FIXES (revise before epic breakdown)
---

# Rubric Review — Architecture Spine, DepotManagement

## Verdict

**Pass with fixes.** The spine is well shaped. The paradigm is clear (ledger-only truth, functional core, one write path). The ADs are mostly enforceable and aimed at real seams between epics, and PRD coverage is complete (FR-1..FR-18 and all NFRs map to an AD). The weak spots fall into three groups:
- Three rules that, as written, produce wrong numbers or contradict the PRD: split adjustment against already-adjusted provider history, duplicate matching on restore/migration, and Decimal storage on SQLite.
- Two divergence points left undefined: "invested capital"/Period Gain/Loss, and corporate-action scope.
- An operational envelope that is thin, with DB migrations in prod, DB-file backup and backup schema evolution all only loosely deferred.

None of these needs a redesign. Each is a sentence-level fix in an existing AD.

## Checklist results

| Criterion | Result | Notes |
| --- | --- | --- |
| Fixes the real divergence points for epics, misses none | Partial | Missing: invested-capital / Period Gain/Loss definition (F4), corporate-action scope (F5), cross-module DB transaction (F7), backup schema evolution (F8), Transaction edit semantics (F9). |
| Every AD Rule enforceable and prevents its stated divergence | Partial | AD-7 does not prevent mixing adjusted/unadjusted prices (F1). AD-3 has a wrong universal duplicate check (F2). AD-5 storage claim is not true on SQLite (F3). AD-9 `transaction` price source conflicts with AD-1/AD-2 (F6). |
| Nothing under Deferred lets two units diverge | Mostly | "UI/chart library" deferral is fine. "DB file backups" and DB-migration application are deferred without a constraint (F8, F10). Provider deferral contradicts the deployment diagram (F11). |
| Named tech plausibly current | Yes (unverified) | Node 24 LTS, Next.js 16.x, React 19.2, Prisma 7 with driver adapters, MUI 9, zod 4, vitest 5 are all a plausible October 2026 set. Exact patch versions were not checked against registries. Note that Next.js 16 renamed `middleware.ts` to `proxy.ts` (relevant to F12). |
| Covers the PRD's capabilities | Yes | Capability map is complete. PRD Open Question 1 (price sources) is only partly answered (F11). PRD Open Question 2 is carried forward as an open question. |
| Altitude dimensions decided / deferred / open | Partial | Operational envelope gaps: when migrations run in prod, how the live SQLite file is backed up, local-to-prod data move, config variable names (F10). |
| Bloat (non-invariants) | Minor | See the Bloat section. Small amount, low cost. |

## Findings

Severity: **High** = will produce wrong numbers or contradictory implementations across epics. **Medium** = likely divergence or a PRD conflict. **Low** = clarity or hygiene.

### F1 — High — AD-7 split handling double-adjusts provider history
AD-7 says Prices before a split are never modified and core split-adjusts Prices on read. Yahoo (the de-facto primary provider) returns history that is **already split-adjusted** as of fetch time. The result:
- Prices fetched before a split are stored unadjusted.
- Prices backfilled after the split arrive adjusted.
- Core then adjusts all of them again.

This is exactly the "split-adjusted and unadjusted data mixed in the DB" that AD-7 claims to prevent. Transaction prices (as-traded) and manual Prices add a third basis.
**Fix:** add one sentence to AD-7/AD-9 that fixes the stored basis. Recommended: "All stored Prices are as-traded (unadjusted). Provider adapters must return unadjusted closes; if the source only offers adjusted history, the adapter un-adjusts it using the Security's CorporateActions before returning it, and recording a split triggers a full history refetch for that Security." Alternatively, store `adjustedAsOf` per provider Price row and have the resolver normalise. Either way, pick exactly one basis.

### F2 — High — AD-3 runs the FR-6 duplicate match on every write path, including restore and migration
As written, manual entry, import confirmation, Parqet migration and restore all run the duplicate match before persisting.
- **Restore:** legitimate identical rows (several savings-plan buys on one day, which FR-6 itself names) would be flagged or dropped. That breaks FR-16's "identical" round trip.
- **Migration:** Parqet history is full of such rows, so review would be flooded.
- **Manual entry:** the PRD never says a manual entry is blocked as a duplicate.

**Fix:** keep the single service, but make the duplicate policy an explicit parameter per path. For example:
- `import`: match against ledger; ambiguous matches go to review.
- `manual`: warn only.
- `migration`: match against existing ledger only, not within the file.
- `restore`: none. Bulk insert in one transaction after schema validation.

### F3 — High — AD-5 "stored as Prisma Decimal" is not exact on SQLite
SQLite has no decimal type. A Prisma `Decimal` column becomes `DECIMAL`, which has NUMERIC affinity. SQLite coerces numeric text to INTEGER or REAL (IEEE double, about 15 significant digits). "Decimals end to end" therefore silently passes through a float at rest. Any SQL-side `SUM`/`ORDER BY` on these columns also runs in float. This undercuts the "correctness over features" NFR and the €0.01 duplicate match.
**Fix:** change the AD-5 rule to "money, quantity and price columns are stored as canonical decimal strings (Prisma `String`, validated by zod, converted to `decimal.js` in the shell/core boundary). No SQL aggregation or numeric comparison on them; all arithmetic happens in core." The alternative is scaled integers (`BigInt`) with a fixed scale per column, e.g. quantity 1e-8. Either way, state it as a rule.

### F4 — High — "Invested capital" and Period Gain/Loss are undefined
FR-10 and FR-11 show invested capital. FR-15 must reconcile invested capital with Parqet. FR-12 needs Gain/Loss "for a selectable Period". Nothing in the spine defines either number. The overview epic, the chart epic and the migration reconciliation can each pick a different definition: cost basis of open lots, net deposits, or cumulative buys minus sells. Realized versus unrealized Gain/Loss over a Period that starts mid-holding is just as open.
**Fix:** extend AD-10 with definitions owned by one core function each:
- `investedCapital(date)` = FIFO Cost Basis of open lots, matching Parqet's definition.
- Period Gain/Loss = (end value − start value) − net external flows in the Period, split into realized (FIFO sales in the Period), unrealized (change in unrealized gain), dividends, fees, and taxes shown separately.

Confirm the invested-capital definition against a Parqet screen before FR-15 reconciliation.

### F5 — Medium — Corporate-action scope: Depot-level row, Security-level effect
In the ERD a CorporateAction hangs off both DEPOT and SECURITY. Split adjustment of Prices, however, is a Security-level effect. If the same Security is held in two Depots and the split is recorded in only one, core gets two different adjusted price series for one Security. Users would also have to enter the same split twice.
**Fix:** in AD-7, state that splits are Security-scoped (one row, applied to all Depots and to Prices). ISIN changes are Security-scoped for the link and ratio. Lot moves happen per Depot automatically. Parqet migration de-duplicates corporate actions coming from several Depot files.

### F6 — Medium — AD-9 stores `transaction`-sourced Prices, which conflicts with AD-1 and AD-2
A Price with source `transaction` is derived from ledger data, yet it is written to the `prices`-owned Price table. Every Transaction edit or delete in `ledger` must then update `prices` rows. Either `ledger` writes another module's model (breaking AD-2), or the two drift (breaking AD-1).
**Fix:** the Price table stores only `manual | provider`. The core resolver takes Transaction prices as a separate input read from the ledger at compute time, with precedence unchanged: manual > provider > transaction > carry-forward.

### F7 — Medium — No rule for one DB transaction across modules
Restore must replace ledger rows (owned by `ledger`) and Prices/ProviderMappings (owned by `prices`) "in one transaction". Import confirmation updates ImportItem status and writes ledger rows. AD-2 forbids touching another module's models, and says nothing about how a transaction spans module services. Epics will improvise: one passes the Prisma client around, another nests transactions, a third accepts partial writes.
**Fix:** add to AD-2: "Module service functions that write take an optional transaction client (`tx: Prisma.TransactionClient`). The orchestrating caller opens `prisma.$transaction` and passes it down. Services never open their own transaction when given one."

### F8 — Medium — Backup `schemaVersion` has no evolution rule
AD-12 introduces `schemaVersion` but does not say whether restore accepts older versions. Every later epic that changes the schema could break restore of earlier exports. That is a cross-epic divergence point, and it is the user's only off-box safety net.
**Fix:** add to AD-12: "Restore accepts the current and all earlier `schemaVersion`s via a chain of pure upgrade functions in `modules/backup`. Any Prisma migration that changes an exported entity bumps `schemaVersion` and adds an upgrader plus a round-trip test." Also: restore writes an automatic export of the current data before replacing it.

### F9 — Medium — AD-1 "a correction is a Transaction" reads as append-only, but FR-2 requires edit and delete
One epic may implement in-place edit and delete (as FR-2 says). Another may implement reversal bookings because of AD-1's wording.
**Fix:** reword to "Quantities and balances are never edited directly; they change only by adding, editing or deleting Transactions (edit and delete in place are allowed, FR-2)." Add the sequence-number assignment rule from AD-8: new rows get `max(sequence)+1` for that Depot and date, and changing a date reassigns the sequence.

### F10 — Medium — Operational envelope is under-decided
Status of each operational dimension:
- **Deployment and environments:** decided at diagram level (local `next dev`, prod `next start` behind Nginx on 127.0.0.1, one process). Not covered: how data moves from local to prod (JSON export/restore vs copying the DB file), and config variable names. The names are a real cross-module seam: auth, prices, news and db each read env.
- **DB migrations:** "Prisma migrations only, immutable" is fine for dev. When they are applied in prod (`prisma migrate deploy` before start, never on app boot from multiple places) is deferred without a constraint.
- **Backup of the DB file:** deferred to the deployment story with only "respect AD-13". Copying a live SQLite file (especially in WAL mode) can produce a corrupt copy.
- **Operations:** no stated SQLite pragmas (journal mode, busy timeout). There is also no health or last-price-fetch visibility beyond FR-7 staleness, which is acceptable for a single user.

**Fix:**
- Add a short "Operational envelope" block (or extend AD-13): the env var names (`DATABASE_URL`, `SESSION_SECRET`, `AUTH_USER`, `AUTH_PASSWORD_HASH`, `NEWS_API_KEY`, …).
- `prisma migrate deploy` runs in the deploy script before the process starts, and the app never migrates itself.
- SQLite runs in WAL mode with a busy timeout.
- Scheduled DB-file backups use `VACUUM INTO` or the better-sqlite3 `backup()` API to a dated file outside the repo, with N kept. A JSON export (FR-16) is the portable, off-box format.
- Local-to-prod move is done via JSON export/restore.

The deferred systemd/deploy-script detail can stay deferred.

### F11 — Medium — Price-provider strategy partly unanswered and internally inconsistent
PRD Open Question 1 must be resolved before implementation. AD-9 fixes the interface, but not which provider serves which asset type. The deployment diagram shows onvista and "CoinGecko / Binance" as live dependencies. Deferred says onvista only comes in if Yahoo breaks. "CoinGecko / Binance" is still an either-or. Certificates are not addressed (manual fallback is implied but not stated).
**Fix:** add a one-line initial mapping policy to AD-9: stocks/ETFs → Yahoo (EUR listing, e.g. `.DE`/XETRA); crypto → CoinGecko (EUR); certificates → manual unless Yahoo resolves the ISIN. Remove onvista from the diagram (or mark it deferred). Also add a `fetchedAt` timestamp to provider Prices: FR-7 requires a "timestamp of the latest Price", while AD-8 gives Prices only a business date.

### F12 — Low — Auth enforcement point not fixed
AD-13 requires auth "on every page and route except login" but does not say where it is enforced. Some epics will rely on a central check and others on per-handler checks. Next.js 16 uses `proxy.ts`, and the 2025 middleware-bypass CVE shows that relying on it alone is risky.
**Fix:** require both: `proxy.ts` redirects unauthenticated requests, *and* every server action and route handler calls `requireSession()` from `modules/auth`.

### F13 — Low — AD-10 tax treatment versus tax refunds
The addendum notes that negative `tax` is a refund (loss offset). AD-10 treats taxes as an external outflow. Refunds then have to be external inflows, or returns will jump on refund dates.
**Fix:** "TAX rows with negative amount are external inflows." Fold this into the existing Open Question.

### F14 — Low — Minor consistency nits
- Frontmatter `binds` omits the NFRs, which AD-13 binds.
- Parqet's `TransferIn`/`TransferOut` naming is not a Transaction type. Good, but state that `SPLIT`/`ISIN_CHANGE` are the CorporateAction types so the naming table is complete.
- After restore, ImportBatch file hashes are gone (staging is excluded). That is acceptable, because FR-6 matching still catches re-imports. One line would say this is intended.

## Deferred-list check

| Deferred item | Divergence risk | Assessment |
| --- | --- | --- |
| Certificate/German-ETF provider if Yahoo breaks | Low (AD-9 adapter seam) | OK, but contradicts the diagram (F11). |
| Snapshot/caching tables | None (AD-1 binds) | OK. |
| finanzen.net zero parser, spin-offs, mergers with cash | Low | OK. The parser registry and CorporateAction type leave room. |
| UI structure, chart library, layout | Low | OK. Chart payloads are already bounded by AD-5 (number only at the edge). |
| Deployment automation, DB-file backups | Medium | Needs constraints (F10). Backup method and migration timing are not cosmetic. |
| Multi-currency, multi-user | None | OK. "No currency columns" is a conscious v1 lock-in. |

## Bloat (content that is not an invariant)

Small amount. Trim or move to the addendum or to stories if you want the spine terser:
- **AD-11:** the initial news-provider set is a choice, not an invariant. The invariant is "provider pattern, outside the ledger, not backed up". Keep the set in Open Questions only.
- **AD-13:** `bcrypt` and `jose` names belong in Stack. "Fetch on start, then daily" is FR-7 behaviour.
- **AD-4:** "tested against anonymised real text fixtures" duplicates the Tests convention.
- **AD-6:** the Parqet rounding rule is migration-epic detail (one unit), although it does affect Cash Account reconciliation. Acceptable.
- **Logging:** "journald in prod" is deployment detail.
- **Deployment diagram:** lists external services; fine, but must match the AD-9 policy (F11).

## Strengths worth keeping
- AD-1 plus the "delete every cache table → identical results" test is a crisp, checkable invariant.
- AD-3/AD-4 (stage, then one write path) closes the most likely import/migration/manual divergence.
- AD-8 `(date, sequence)` ordering with corporate actions first, and "today" passed into core, gives deterministic FIFO.
- AD-9 single price resolver used by every view prevents chart/overview disagreement.
- The Capability → Architecture map is complete and traceable.
