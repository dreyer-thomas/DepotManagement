---
title: 'Export all data (story 6-1)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '3dff9143dfbd5621e509e976bd9e4b3667fa0a95'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Non-transactional writes from other requests run inside any open interactive transaction on the shared better-sqlite3 connection and roll back with it.
    evidence: |-
      @prisma/adapter-better-sqlite3 dist/index.mjs: the mutex is acquired only in startTransaction; plain queries use the same client and execute inside the open BEGIN. Pre-existing for every interactive transaction (ledger batch, logos, reconciliation); the export adds one more read-only transaction that rolls back only on a DB error.
    location: >-
      src/modules/backup/export.ts (inTransaction)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** All portfolio data lives only in the app's SQLite file; Tommy cannot take it out in an open format, so it is locked in and story 6.2 (restore) has nothing to consume.

**Approach:** A new `backup` module assembles one versioned JSON document from export readers exported by `ledger`, `prices` and `logos`, validates it against a zod schema, and an authenticated route handler `GET /api/export` serves it as a download that Settings links to with an "Exportieren" button. The schema is documented in the README.

## Boundaries & Constraints

**Always:**
- Top-level JSON: `schemaVersion: 1`, then `depots`, `securities`, `providerMappings`, `transactions`, `corporateActions`, `reconciliationRuns` (each with its `rows`), `prices`, `logos`. Every stored column of these models is exported as stored (ids, `sequence`, `note`, nullables as `null`); no relations, no derived values.
- Decimals and dates are the stored strings, byte for byte (e.g. `"1.50000"` stays `"1.50000"`); never parse to `number` or `Decimal`.
- Deterministic output: arrays sorted by a stable key (Design Notes); no export timestamp inside the file, so the same data always yields byte-identical content (6.2 round-trip).
- `logos` holds only MANUAL SecurityLogo rows whose file is readable: `{ id, securityId, contentType, fetchedAt, data }` with `data` = base64 of the file bytes.
- Each module reads only its own tables: `ledger` (Depot, Security, Transaction, CorporateAction, ReconciliationRun/Row), `prices` (ProviderMapping, Price), `logos` (SecurityLogo + files). `backup` imports only their index entry points. All reads run inside one Prisma interactive transaction for a consistent snapshot.
- The zod schema in `src/modules/backup/schema.ts` is the contract; the export output is parsed with it before it is served.
- File name `depotmanagement-export-<YYYYMMDD-HHMMSS>.json`, timestamp in Europe/Berlin local time of the request.
- Route: 401 JSON without a session (re-checked in the handler like `/api/logos`), `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- UI text German; button touch target ≥ 44 px.

**Never:**
- Export caches, ImportBatch/ImportItem, NewsArticle/NewsFetch, FETCHED SecurityLogo rows or fetched logo files.
- Implement restore, BACKUP_DIR writes or the daily backup (stories 6.2/6.3).
- Log amounts, quantities or file content; add a schema migration; touch `sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full ledger | Depots, Securities, BUY/SELL/ADJUSTMENT with note, split + ISIN change, finished run with cash + position rows, mapping, MANUAL + PROVIDER prices, manual logo | Every row appears with all columns as stored; decimals unchanged | No error expected |
| Excluded data | Fetched logo, "nothing found" marker, news article, NewsFetch, open ImportBatch with item | None of them appear; `logos` contains only the manual logo | No error expected |
| Empty instance | No rows | `schemaVersion: 1` and every array empty | No error expected |
| Manual logo file missing | MANUAL row, file deleted from `DATA_DIR/logos` | Logo omitted, rest exported | `console.warn` without ids or data |
| No session | Request without valid cookie | 401 `{ "error": "unauthorized" }`, no data | — |
| Same data twice | Two exports, unchanged DB | Identical JSON bodies | — |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- read-only: column lists of Depot, Security, Transaction, CorporateAction, ReconciliationRun/Row, ProviderMapping, Price, SecurityLogo (MANUAL vs FETCHED, `fileName`/`contentType` null = marker).
- `src/modules/ledger/index.ts` -- entry point; add export of the new reader. `LedgerDb = Prisma.TransactionClient` (`depots.ts:13`); services take `db: LedgerDb = prisma` as last arg.
- `src/modules/prices/index.ts`, `src/modules/prices/mappings.ts:15` -- `PricesDb`; add reader export.
- `src/modules/logos/index.ts`, `src/modules/logos/logos.ts:187` (`readLogo`: row → `logosDir(env)` + `readLogoFile`, content-type whitelist `LOGO_CONTENT_TYPES`) -- reuse for the manual-logo reader; `LogoDeps.env` carries `DATA_DIR`.
- `src/app/api/logos/[securityId]/route.ts` + `route.test.ts` -- pattern for an authenticated route handler, `SECURITY_HEADERS`, session faking with `createRequestFakes`, `useMigratedDatabaseForSingleton`, `saveManualLogo`.
- `src/proxy.ts` -- already answers `/api/*` without session with 401; nothing to change.
- `src/app/(app)/settings/page.tsx` + `page.test.tsx` -- add the export section; test pattern with `renderHtml`/`renderText`.
- `src/app/_components/migration/ParqetMigrationLink.tsx` -- pattern for a client button-link component (server components cannot pass components as props).
- `src/core/dates.ts:26-37` -- Intl `formatToParts` Europe/Berlin pattern for the file-name timestamp (implement in the module, not core).
- `test/helpers/test-db.ts` -- `createTestDatabase()` for module tests with injected `db`.
- `README.md` -- "Source tree" mentions modules; add a "Data export" section documenting the schema.

## Tasks & Acceptance

**Execution:**
- `src/modules/ledger/export.ts` -- `exportLedgerData(db)` returns `{ depots, securities, transactions, corporateActions, reconciliationRuns }` (runs with `rows`) with explicit `select`s and the sort orders from Design Notes; export from `index.ts` -- ledger owns these tables.
- `src/modules/prices/export.ts` -- `exportPriceData(db)` returns `{ providerMappings, prices }`; export from `index.ts`.
- `src/modules/logos/export.ts` -- `exportManualLogos(deps, db)` returns MANUAL logos with base64 `data`, skipping rows without a usable file (missing, unreadable, empty, invalid name or content type) with one data-free count warning (wording "unusable", not "unreadable"); export from `index.ts`.
- `src/modules/backup/schema.ts` -- zod v4 strict schemas per record and `exportFileSchema` (`schemaVersion: z.literal(1)`), exported `EXPORT_SCHEMA_VERSION` and inferred `ExportFile` type.
- `src/modules/backup/export.ts` -- `createExport(deps?, db?)` runs the three readers in one interactive transaction, assembles keys in the fixed order, validates with `exportFileSchema.safeParse`; on failure it logs only the issue paths and codes (never values) and throws; `serializeExport(file)` is the one serialization (`JSON.stringify(file, null, 2)`) the route and story 6.2 use; `exportFileName(now: Date)` builds the Berlin-time name.
- `src/modules/backup/index.ts` -- module entry point (comment: owns export/restore/DB backup; reaches others only via their entry points).
- `src/app/api/export/route.ts` -- `GET`: session check → `createExport()` → `serializeExport()` + headers; unexpected failure → 500 `{ error: "export-failed" }` with `no-store`/`nosniff`, no `Content-Disposition`, and a name-only log.
- `src/app/_components/backup/ExportButton.tsx` -- client component: MUI `Button` (download icon, label "Exportieren", `minHeight: 44`) that `fetch`es `/api/export` on click, disabled while running. 200 → read the blob, take the file name from `Content-Disposition`, save it via an object URL on a temporary `<a download>` and revoke the URL. 401 → `window.location.assign("/login?next=%2Fsettings&expired=1")`. Any other status or a network error → MUI `Alert` (severity error) below the button: "Export fehlgeschlagen. Bitte erneut versuchen."; a new click clears it. Never saves a non-200 body as a file.
- `src/app/(app)/settings/page.tsx` -- new section "Datensicherung" (h2, id `settings-backup`) after Parqet with one German sentence and `ExportButton`.
- `README.md` -- "Data export" section: how to export, file name, top-level keys, record fields, string decimals/dates, excluded data, `schemaVersion` policy; update the `modules/` line in Source tree.
- Tests: `src/modules/backup/export.test.ts` (matrix rows 1–4, 6, schema parse, sort orders, file name incl. summer/winter time, zero-byte logo file skipped, schema failure logs paths/codes but no values; exclusion test seeds distinctive marker strings in news/staging rows and asserts they are absent), `src/app/api/export/route.test.ts` (401, 200 headers, filename regex, body equals `serializeExport` output and parses with schema, 500 path: body, headers, no `Content-Disposition`, log without the error message), `src/app/_components/backup/ExportButton.dom.test.tsx` (stubbed `fetch`: 200 saves with the header file name, 401 navigates to login, 500 and network error show the Alert and save nothing), `src/app/(app)/settings/page.test.tsx` (the section contains `ExportButton`).

**Acceptance Criteria:**
- Given data in the ledger, when Tommy clicks "Exportieren" in Settings, then the browser downloads `depotmanagement-export-<YYYYMMDD-HHMMSS>.json` containing `schemaVersion` and all data listed above.
- Given the downloaded file, when it is parsed with `exportFileSchema`, then it validates, and decimals/dates equal the stored strings and ids/sequences equal the stored ones.
- Given the README, when a reader looks for the export format, then a "Data export" section describes every top-level key, the record fields and what is excluded.

## Spec Change Log

### 2026-10-26 — Loopback 1 (review pass 1)
- **Trigger:** Blind Hunter — the plain `<a href="/api/export" download>` lets an expired session (401) or a failed export (500) reach the browser as a "download" with no German error; EXPERIENCE.md requires an Alert on server errors (`bad_spec`, medium).
- **Amended:** ExportButton task (fetch + blob + Alert + 401 redirect), route task (500 headers, `serializeExport`), backup export task (`safeParse`, path/code-only failure log, `serializeExport`), logos task (skip empty/unusable files, wording), Tests task (route 500 path, ExportButton DOM test, zero-byte logo, marker-based exclusion test), Design Notes (transaction claim, download rationale).
- **Known-bad state avoided:** error JSON saved as an "export" file or a silent failed download; an opaque `ZodError` log; a zero-byte logo file failing the whole export; serialization duplicated between route and 6.2.
- **KEEP:** the prior attempt `spec-6-1-export-all-data.patch` (same folder) passed lint/typecheck/2365 tests/build and must be the base: module split (`ledger`/`prices`/`logos` export readers via their `index.ts`, `backup` module with `schema.ts`/`export.ts`/`index.ts`), the strict zod schemas and key order, sort orders, Berlin `exportFileName` with `hourCycle: "h23"` and its winter/summer/DST tests, the full-ledger seed with non-canonical decimals, the empty-instance and byte-identity tests, the README "Data export" section and the "Datensicherung" settings section text.

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 27 findings — high 0, medium 4, low 11, false 11, maybe-false 1
- findings:
  - `[medium]` `[bad_spec]` Blind: plain download link saves/loses 401/500 bodies with no German error — confirmed: `ExportButton` was `<a href="/api/export" download>`, proxy answers 401 JSON; amended ExportButton task to fetch + blob + Alert + login redirect (Loopback 1).
  - `[low]` `[bad_spec]` Blind: one invalid row fails the export with only `ZodError` in the log — writers store canonical decimals, so the block itself is unproven, but the log is undiagnosable; amended to `safeParse` + path/code-only log.
  - `[low]` `[bad_spec]` Blind: serialization lives in the route, 6.2 needs the same bytes — amended: `serializeExport` in `backup`.
  - `[false]` `[reject]` Blind: schema lacks referential/uniqueness/AD-14 invariants — export input comes from the DB, whose FKs and unique indexes already hold them; restore-side validation is story 6.2.
  - `[low]` `[reject]` Blind: `timestamp` is `min(1)` while README says UTC ISO — values are exported as stored; tightening adds a new failure mode for no user-visible gain.
  - `[false]` `[reject]` Blind: logo records lack size/magic-byte checks — exported bytes come only from `saveManualLogo`, which sniffs and bounds them; restore checks belong to 6.2.
  - `[low]` `[bad_spec]` Blind: skip warning says "unreadable file" for every skip reason — amended wording to "unusable" (folded into the logos task).
  - `[medium]` `[bad_spec]` Blind: route 500 path untested (plus snapshot, invalid-token, nested-schema gaps) — 500 path confirmed untested, added to Tests task; the other sub-gaps are low and covered by existing auth/proxy tests or the schema's strictness.
  - `[low]` `[bad_spec]` Blind: `Synthetic"` exclusion assertion is fragile — confirmed it relies on quote escaping; Tests task now requires distinctive markers.
  - `[false]` `[reject]` Blind: route test cleanup misses child tables — no test in that file seeds Transactions/Prices, so no Restrict failure occurs.
  - `[low]` `[reject]` Blind: `"use client"` on ExportButton unnecessary — moot: the amended button needs client state.
  - `[medium]` `[defer]` Edge: non-transactional writes from other requests join the export's `BEGIN` on the shared connection and roll back with it — confirmed in `@prisma/adapter-better-sqlite3` (mutex only in `startTransaction`); pre-existing for every interactive transaction in the app (e.g. ledger batch); the export transaction only rolls back on a DB error.
  - `[low]` `[reject]` Edge: logo file reads hold the mutex > 2 s — manual logos are few and bounded by `UPLOAD_MAX_BYTES`; reads take milliseconds.
  - `[low]` `[bad_spec]` Edge: zero-byte logo file fails `z.base64().min(1)` and the whole export — unreachable via `saveManualLogo` but a truncated file is plausible; amended logos task to skip empty files.
  - `[low]` `[bad_spec]` Edge: one bad row → opaque 500 (same root cause as Blind row 2) — same amendment.
  - `[false]` `[reject]` Edge: `getSession()` throws on invalid `SESSION_SECRET` — the app refuses to start with invalid auth config (README "Login"); same pattern as `/api/logos`.
  - `[false]` `[reject]` Edge: `createExport` with a TransactionClient is not atomic — it then runs inside the caller's transaction, which is atomic by definition.
  - `[low]` `[bad_spec]` Edge (claim): "consistent snapshot" comment overclaims on the shared connection — amended Design Notes to require the accurate wording.
  - `[medium]` `[bad_spec]` Verification gap: route 500 `export-failed` path has no test (same root as Blind row 8) — pre-verified; added to Tests task.
  - `[false]` `[reject]` Intent: click → download never tested end to end — route and component are each tested at their surface; the amended DOM test now drives the click against the response contract.
  - `[false]` `[reject]` Intent: browser may not keep the `Content-Disposition` name — the amended button sets the name itself from the header.
  - `[false]` `[reject]` Intent: field-level content checked at module layer only — the route serves `serializeExport(createExport())` unchanged; the route test compares bodies.
  - `[low]` `[reject]` Intent: missing manual logo gives only a log signal — the file is gone, there is nothing to export; README documents it; a UI signal adds surface no AC asks for.
  - `[medium]` `[bad_spec]` Intent: failure behaviour of the click unspecified (same root as Blind row 1) — same amendment.
  - `[low]` `[reject]` Intent: README can drift from `schema.ts` — documentation test would add machinery; README names the schema as the binding contract.
  - `[false]` `[reject]` Intent: round-trip identity only tested at module layer — 6.2 owns the round-trip test; 6.1 guarantees deterministic bytes, tested.
  - `[maybe-false]` `[reject]` Intent: "caches" could include ProviderMapping fetch metadata — the AC explicitly includes ProviderMappings and AD-12 lists the excluded caches (news, fetched logos, staging); would only be low if true.

### 2026-10-26 — Review pass
- verdicts: 22 findings — high 0, medium 3, low 9, false 9, maybe-false 1
- findings:
  - `[false]` `[reject]` Blind: import `fileHash` history is lost, so re-upload warnings vanish after restore — the story AC explicitly excludes import staging; the hash only ever warns (AD-4).
  - `[low]` `[reject]` Blind: skipped manual logo reported only in the server log — carried: same claim as pass 1 (file is gone, README documents it).
  - `[false]` `[reject]` Blind: schema lacks DB uniqueness/reference/invariant rules — carried: export input is DB-constrained; restore-side validation is 6.2.
  - `[low]` `[reject]` Blind: `timestamp` only `min(1)` (and ratio/ISIN invariants) — carried: values are exported as stored.
  - `[medium]` `[patch]` Blind: object URL revoked synchronously after `link.click()` can abort the download in Safari/older Firefox — confirmed in `saveBlob`; fixed: revoke deferred by `REVOKE_DELAY_MS` (40 s), DOM test uses fake timers.
  - `[low]` `[reject]` Blind: a large export holds the transaction mutex and can make concurrent transactional writes hit `maxWait` — single user, one daily job; reading tens of thousands of rows takes well under the window; the fix is a restructure.
  - `[low]` `[reject]` Blind: export held in memory several times — single-user data sizes; streaming adds machinery no AC asks for.
  - `[low]` `[reject]` Blind: missing tests (fallback file name, 403/204, double click, DST repeated hour) — double click is prevented by `disabled`; the others are cosmetic edge cases with no data impact.
  - `[false]` `[reject]` Blind: local `Node` type shadows the DOM global in the settings test — lint and typecheck pass; no named harm.
  - `[false]` `[reject]` Blind: Alert repeats `role="alert"`, no busy indicator — the attribute is redundant but harmless; the disabled button is the busy state.
  - `[false]` `[reject]` Blind: hard-coded `next=/settings` in the 401 redirect — the button is only rendered on Settings.
  - `[false]` `[reject]` Blind: `ManualLogoExport.contentType` typed `string` — values are filtered by `LOGO_CONTENT_TYPES` before export; no runtime outcome differs.
  - `[medium]` `[patch]` Edge: synchronous `revokeObjectURL` (same root as Blind row 5) — same fix.
  - `[false]` `[reject]` Edge: `getSession()` rejecting outside the try — carried: the app refuses to start with invalid auth config.
  - `[medium]` `[defer]` Edge (claim): ledger and prices sections may come from different DB states on the shared connection — carried: already deferred in pass 1.
  - `[low]` `[bad_spec]` Edge (claim): one bad legacy row fails the whole export — carried: amended in Loopback 1 (`safeParse`, path/code log).
  - `[low]` `[patch]` Verification gap: MANUAL logo with unsupported/null `contentType` skip is untested — pre-verified; added a test (gif + null rows, no throw, one data-free warning).
  - `[low]` `[patch]` Verification gap: sort orders of providerMappings, logos and reconciliationRuns not pinned — pre-verified; added a reverse-order test.
  - `[maybe-false]` `[reject]` Intent: ProviderMapping fetch metadata counted as "caches" — carried.
  - `[false]` `[reject]` Intent: proxy's own 401 for `/api/*` not tested here — covered by `src/proxy.test.ts`.
  - `[false]` `[reject]` Intent: button and route never connected in one test — carried.
  - `[low]` `[reject]` Intent: README can drift from `schema.ts` — carried.

## Design Notes

Sort orders (all by unique keys): depots, securities by `id`; transactions by `depotId, date, sequence`; corporateActions by `securityId, type, date`; reconciliationRuns by `id`, rows by `id`; providerMappings by `securityId`; prices by `securityId, date, source`; logos by `securityId`.

No `exportedAt` inside the file: the timestamp lives in the file name; this keeps export → restore → export byte-identical for 6.2. Pretty-printed JSON (2 spaces) keeps the open file human-readable.

Interactive transaction: `prisma.$transaction(async (tx) => …, { timeout: … })` — reuse the module-local `inTransaction` idea; readers accept the tx client. The better-sqlite3 adapter serializes transactions with each other only (one shared connection), so comments must claim "no other transaction interleaves", not a consistent snapshot against every write.

Download via `fetch` + blob instead of a bare link: a link with `download` hands a 401/500 body to the browser, which may save it as a file that looks like a backup and shows no German error (EXPERIENCE.md: a server error shows an Alert).

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** "Exportieren" in Settings → "Datensicherung" fetches `GET /api/export` (session-checked) and saves `depotmanagement-export-<YYYYMMDD-HHMMSS>.json` (Europe/Berlin). The file is one strict, zod-validated, deterministic JSON document (`schemaVersion: 1`) with Depots, Securities, ProviderMappings, Transactions (incl. ADJUSTMENT and notes), CorporateActions, ReconciliationRuns with rows, all Prices and manual logos as base64; caches, staging, news and fetched logos are excluded. 401 redirects to the login, other failures show a German Alert. README documents the format.

**Files changed:**
- `src/modules/backup/{schema,export,index}.ts` — new module: zod export schema, `createExport`, `serializeExport`, `exportFileName`.
- `src/modules/ledger/export.ts`, `src/modules/prices/export.ts`, `src/modules/logos/export.ts` (+ their `index.ts`) — per-module export readers of their own tables.
- `src/app/api/export/route.ts` — authenticated download route (401/500 JSON, attachment headers).
- `src/app/_components/backup/ExportButton.tsx` — fetch + blob download, 401 redirect, error Alert, deferred URL revoke.
- `src/app/(app)/settings/page.tsx` — "Datensicherung" section.
- `README.md` — "Data export" section; source-tree line.
- Tests: `src/modules/backup/export.test.ts`, `src/app/api/export/route.test.ts`, `src/app/_components/backup/ExportButton.dom.test.tsx`, `src/app/(app)/settings/page.test.tsx`.

**Review findings:** pass 1 (27 findings) → one `bad_spec` loopback (download error handling, serialization, logging, tests); 1 item deferred (shared-connection transaction behaviour of the better-sqlite3 adapter, pre-existing). Pass 2 (22 findings) → 3 patches (deferred object-URL revoke [medium], unsupported-content-type logo test [low], sort-order test [low]); no new defers. Every rejected finding and its reason is in the Review Triage Log above.

**Follow-up review recommended:** false — pass 2 patched 0 high, 1 medium, 2 low.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (173 test files, 2374 tests). Every I/O matrix row is covered by passing tests.

**Residual risks:** the deferred adapter behaviour (writes outside a transaction join an open interactive transaction); the strict schema makes an export fail loudly (with a path/code log) if a stored row ever breaks it; the whole export is built in memory.

