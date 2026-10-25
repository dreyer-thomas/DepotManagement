---
title: 'Story 1.3: Create and Rename Depots'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '8d13be59b290fa9b564cda15144d2c96b0d65927'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** There is no data model yet: Tommy cannot create a Depot, so no later story (Transactions, Positions, Cash Account, archive) has anything to book into.

**Approach:** Add the `Depot` Prisma model (with the `Broker` enum) and a new migration, a `ledger` module that is the only writer of Depots (`createDepot`, `renameDepot`, `listDepots`, `getDepot`, zod-validated, typed `{ ok: false, reason }` results), and the German UI: Overview empty state, Depots list, Depot detail page `/depots/[id]`, and a "Depots" section in Settings with create and rename dialogs driven by server actions.

## Boundaries & Constraints

**Always:**
- Schema: `enum Broker { COMDIRECT DEUTSCHE_BANK FINANZEN_ZERO }`; `model Depot { id String @id @default(cuid()); name String @unique; broker Broker }`. New migration folder under `prisma/migrations/`; the baseline migration stays untouched.
- Name rules (ledger zod schema): trimmed; non-empty; at most 60 characters; unique case-insensitively (`toLocaleLowerCase("de-DE")` compare against existing names, excluding the Depot being renamed). Renaming to the own name (any case) is allowed. A DB unique violation (Prisma `P2002`) maps to `name-taken`.
- Ledger result shape: `{ ok: true, depot } | { ok: false, reason }`, reason ∈ `name-empty | name-too-long | name-taken | broker-invalid | not-found`. Writing services take an optional Prisma client/transaction client (defaults to the `@/db` singleton). Expected failures never throw.
- `DepotSummary` = `{ id, name, broker, cashBalance }`; `cashBalance` is the decimal string `"0"` until Transactions exist (story 1.6 replaces it with `core/cash`); never stored.
- `listDepots()` sorts by name with `localeCompare(…, "de-DE")`.
- Broker labels (German UI): `COMDIRECT` → "comdirect", `DEUTSCHE_BANK` → "Deutsche Bank", `FINANZEN_ZERO` → "finanzen.net zero".
- UI microcopy: empty Overview "Noch kein Depot." with buttons "Depot anlegen" (opens the create dialog) and "Aus Parqet übernehmen" (disabled); create dialog title "Depot anlegen", fields "Name" and "Broker", submit "Anlegen"; rename dialog title "Depot umbenennen", submit "Speichern"; cancel "Abbrechen". Inline field errors: `name-empty` "Bitte einen Namen eingeben.", `name-too-long` "Höchstens 60 Zeichen.", `name-taken` "Ein Depot mit diesem Namen gibt es bereits.", `broker-invalid` "Bitte einen Broker wählen."; `not-found` shows Alert "Depot nicht gefunden.". Balance formatted with `formatMoney` → "0,00 €".
- Dialogs: Enter submits, Esc/"Abbrechen" closes, on error the input is kept and the dialog stays open, on success it closes; full-screen below `sm`; touch targets ≥ 44 px; no optimistic writes.
- After a successful write the server action calls `revalidatePath("/", "layout")`.
- Server actions validate `FormData` and call only `ledger`; pages read only via `ledger`; every action checks `getSession()` and returns `{ ok: false, reason: "unauthorized" }` without writing when there is no session (UI Alert "Sitzung abgelaufen. Bitte erneut anmelden.").

**Never:**
- No archive (story 1.8), no Transactions, Securities or tabs content (stories 1.4–1.6), no Broker change after creation, no delete.
- No Prisma access outside `src/modules/ledger` and `src/db`; no stored balance column.
- No edits to `_bmad-output/implementation-artifacts/sprint-status.yaml` or to the baseline migration.
- Tests never touch `~/.depotmanagement`: they use a temp SQLite file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | name `"  Comdirect Depot "`, broker `COMDIRECT` | stored name `Comdirect Depot`; listed; cash `0,00 €` | — |
| Empty name | `"   "` | not stored | `name-empty`, inline under Name |
| Too long | 61 chars | not stored | `name-too-long` |
| Duplicate | existing `Comdirect Depot`, new `comdirect depot` | not stored | `name-taken` |
| Bad broker | `broker=FOO` or missing | not stored | `broker-invalid` |
| Rename | `Comdirect Depot` → `Hauptdepot` | name updated everywhere on next render | — |
| Rename same/case | `Hauptdepot` → `HAUPTDEPOT` (own name) | allowed, updated | — |
| Rename to other's name | another Depot named `ZERO` | unchanged | `name-taken` |
| Rename unknown id | id not in DB | unchanged | `not-found` |
| Detail unknown id | `GET /depots/xyz` | Next 404 page | `notFound()` |
| No session | action called without valid cookie | nothing written | `unauthorized` |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- only generator + sqlite datasource; add enum + model. Run `npx prisma generate` afterwards.
- `prisma/migrations/20261025000000_baseline/` -- immutable, empty. Create the new migration with `DATABASE_URL=file:<scratch>/m.db npx prisma migrate dev --name add_depot --create-only` (or `migrate diff`), never against `~/.depotmanagement`.
- `src/db/index.ts` -- exports `prisma` singleton and `createPrismaClient(url)`; the singleton resolves `DATABASE_URL` at import, so tests must set `process.env.DATABASE_URL` (via `vi.hoisted`) before importing anything that imports `@/db`.
- `src/db/generated/prisma/client` -- generated types: `PrismaClient`, `Prisma.TransactionClient`, `Broker` enum, `Prisma.PrismaClientKnownRequestError`.
- `src/core/format.ts:50` -- `formatMoney(value)` for "0,00 €".
- `src/app/_components/Placeholder.tsx` -- `PageTitle` (reuse) and `Placeholder` (settings/overview stop using it).
- `src/app/(app)/page.tsx`, `src/app/(app)/depots/page.tsx`, `src/app/(app)/settings/page.tsx` -- placeholders to replace.
- `src/app/login/LoginForm.tsx`, `src/app/login/actions.ts` -- `useActionState` + zod + server action pattern to mirror.
- `src/modules/auth/index.ts` -- `getSession()` for action guards.
- `test/helpers/next-mocks.ts` -- `createRequestFakes`, `expectRedirect`, `findElement` for server component/action tests; `src/app/(app)/layout.test.tsx` shows mocking `next/headers` and auth env.
- `src/app/_components/navigation.ts` -- `isActive("/depots", "/depots/abc")` already true; no change.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_depot/migration.sql` -- Broker enum + Depot model; generated migration SQL.
- `test/helpers/test-db.ts` -- `createTestDatabase()` → `{ url, client, cleanup }`: temp dir file, applies every `prisma/migrations/*/migration.sql` in order via `better-sqlite3` `exec`, returns `createPrismaClient(url)`.
- `src/modules/ledger/depots.ts` -- zod name/broker schemas, `createDepot(input, db?)`, `renameDepot(id, input, db?)`, `listDepots(db?)`, `getDepot(id, db?)`, `BROKERS` list; `src/modules/ledger/index.ts` re-exports the public API and types (`Broker`, `DepotSummary`, `DepotResult`, `DepotFailureReason`).
- `src/modules/ledger/depots.test.ts` -- every ledger row of the I/O matrix against a test DB, plus sorting and `cashBalance` `"0"`.
- `src/app/_components/depots/labels.ts` -- `brokerLabel`, `depotErrorMessage(reason)` (German texts above).
- `src/app/_actions/depots.ts` -- `"use server"` `createDepotAction`, `renameDepotAction` (`(prev, formData) → DepotActionState`), session guard, zod `FormData` parsing, `revalidatePath("/", "layout")` on success; `src/app/_actions/depots.test.ts` covers success, field error, unauthorized (mocks `next/headers`, `next/cache`, temp DB).
- `src/app/_components/depots/DepotDialogs.tsx` -- client `CreateDepotButton` (button + dialog with Name TextField and Broker select) and `RenameDepotButton` (icon button labelled `"<name>" umbenennen` + dialog prefilled with the name).
- `src/app/_components/depots/DepotList.tsx` -- server-renderable list of Depot cards/rows: name (link to `/depots/<id>`), broker label, "Cash-Konto" balance; optional rename buttons (settings).
- `src/app/(app)/page.tsx` -- no Depots: empty state card ("Noch kein Depot.", `CreateDepotButton` labelled "Depot anlegen", disabled "Aus Parqet übernehmen"); otherwise page title + `DepotList`.
- `src/app/(app)/depots/page.tsx` -- title "Depots", `CreateDepotButton`, `DepotList` or the same empty text.
- `src/app/(app)/depots/[id]/page.tsx` -- `getDepot`; `notFound()` if missing; title = name, broker label, "Cash-Konto 0,00 €", empty-state card "Noch keine Buchungen." with disabled "Neue Buchung" (enabled by story 1.4).
- `src/app/(app)/settings/page.tsx` -- title "Einstellungen", section "Depots" with `CreateDepotButton` and `DepotList` with rename buttons.
- Page tests (`page.test.tsx` next to each changed page) -- render the server components against a temp DB via `findElement`/text search: empty vs. listed Overview, detail not-found, detail texts.

**Acceptance Criteria:**
- Given a logged-in user and an empty DB, when `/` is opened, then "Noch kein Depot." with "Depot anlegen" and a disabled "Aus Parqet übernehmen" is shown.
- Given the create dialog, when "Hauptdepot" + "comdirect" is submitted, then the dialog closes and the Depot appears on `/`, `/depots` and `/settings` with "Cash-Konto 0,00 €", and `/depots/<id>` shows "Hauptdepot", "comdirect" and "Noch keine Buchungen." with "Neue Buchung".
- Given an existing Depot, when it is renamed in Settings, then the new name shows on every surface; an empty or duplicate name shows the inline error and keeps the dialog open with the entered text.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0, and `npm start` against a fresh `DATABASE_URL` applies the new migration.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 14, false 11, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) `DepotDialog` comment claims Esc does not close while a write is pending, but it does — comment corrected to the actual behavior; the pending window is milliseconds, so no new logic.
  - `[low]` `[reject]` (blind) client dialogs have no DOM tests (Enter/Esc/close on success/keep input/full-screen) — the repo has no DOM test setup (same call as story 1.2); the error mapping part is covered by the new `labels.test.ts`.
  - `[low]` `[patch]` (blind) `DepotErrorReason` duplicated the ledger reasons by hand — now `DepotFailureReason | "unauthorized"`.
  - `[low]` `[patch]` (blind) Depot names rendered as `h2` beside the Settings section heading `h2` — names now render as `<p>` with the same styling.
  - `[low]` `[patch]` (blind) names not Unicode-normalised, NFC/NFD twins bypass the uniqueness checks — schema normalises to NFC before trim/length; `nameKey` normalises; ledger test added.
  - `[low]` `[reject]` (blind) detail page queries the Depot twice (metadata + page) — one indexed SQLite read extra per request is negligible; `cache()` adds a wrapper.
  - `[low]` `[reject]` (blind) "Noch kein Depot." card repeated on three pages — three short literals; extracting a component is a refactor without user-facing effect.
  - `[false]` `[reject]` (blind) `parse()` casts arbitrary zod messages to reasons — every check in `depotNameSchema`/`brokerSchema` carries an explicit reason message (type, min, max, enum); `trim`/`normalize` cannot fail, so no default message is reachable.
  - `[low]` `[reject]` (blind) a non-string name is reported as `name-empty` — all current callers pass strings (actions coerce via `formText`); a distinct reason adds a branch for an unreachable case.
  - `[low]` `[patch]` (blind) untested edges: rename-unauthorized revalidation, `generateMetadata` unknown id, rename empty name via action — assertions/tests added in `depots.test.ts` and `[id]/page.test.tsx`.
  - `[false]` `[reject]` (blind) dialog title id shared by all rename buttons — a closed MUI Dialog renders nothing (not `keepMounted`) and only one dialog can be open, so no duplicate ids exist in the DOM.
  - `[low]` `[patch]` (edge) Esc/backdrop closes mid-write — same root cause as the blind comment row; comment corrected.
  - `[low]` `[reject]` (edge) concurrent case-only duplicates race past the pre-check — single user, accepted in Design Notes; fixing needs a transaction or a `lower(name)` index migration.
  - `[low]` `[patch]` (edge) NFC/NFD twins — same fix as the blind normalisation row.
  - `[low]` `[reject]` (edge) 60-char limit counts UTF-16 units, so emoji count double — emoji-heavy Depot names are unlikely; a code-point refine adds a branch.
  - `[false]` `[reject]` (edge) migrations folder without `migration.sql` breaks the test helper — Prisma always writes `migration.sql` per folder and committed migrations are immutable; `migration_lock.toml` is a file and filtered by `isDirectory`.
  - `[low]` `[patch]` (verification-gap) Depot link `href` never asserted — `depots/page.test.tsx` now asserts `href="/depots/<id>"`.
  - `[low]` `[patch]` (verification-gap) reason → German message/field mapping never executed — new `labels.test.ts` table over all six reasons.
  - `[low]` `[reject]` (intent) dialog behavior exercised only at the server-action level — same as the blind DOM-test row.
  - `[false]` `[reject]` (intent) inline rename errors only checked as reason codes — `labels.test.ts` now pins the code → field/text mapping and the actions return those codes; DepotForm wires them into `helperText`.
  - `[false]` `[reject]` (intent) new name not verified on every surface after rename — all pages are dynamic (`ƒ` in build output) and read `listDepots`/`getDepot` per request; page tests render after a rename through the ledger; implementer verified live renames over HTTP.
  - `[false]` `[reject]` (intent) page tests do not exercise "logged in" — the `(app)` layout and proxy guards are tested by story 1.2; pages have no auth logic of their own.
  - `[false]` `[reject]` (intent) `prisma migrate deploy` never run — run against a scratch `DATABASE_URL`: both migrations applied; `npm start` against a fresh DB also applied them (implementer).
  - `[false]` `[reject]` (intent) no evidence the verification commands ran — lint, typecheck, test (192 passed) and build all exit 0 (see Auto Run Result).
  - `[false]` `[reject]` (intent) "Neue Buchung" disabled instead of a usable action — the AC requires the action to be shown; the Transaction form is story 1.4 per the epic dependency order, so a working action is impossible here; the awaiting-operator reading does not apply (no human action outside the repo).

## Design Notes

Uniqueness is case-insensitive in the service because SQLite `@unique` is case-sensitive and Prisma cannot declare a `NOCASE` collation; the DB constraint stays as the exact-match backstop. With a single user and a handful of Depots, the read-then-write race is accepted; `P2002` still maps to `name-taken`.

Reason codes stay language-neutral in `ledger`; German text lives in the app layer so migration/import can reuse the codes.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0
- `DATABASE_URL=file:<scratch>/v.db npx prisma migrate deploy` -- expected: both migrations applied
- `npm run dev` with synthetic auth env and a scratch `DATABASE_URL`; log in via curl, then fetch `/`, `/depots`, `/settings`, `/depots/<id>` -- expected: texts from the ACs

**Manual checks (if no CLI):**
- Dialogs are full-screen below `sm` and close on Esc.

## Auto Run Result

Status: done

**Summary:** Added the first ledger model. Prisma `Broker` enum and `Depot` model (new migration `20261025141837_add_depot`, baseline untouched) and a `ledger` module (`createDepot`, `renameDepot`, `listDepots`, `getDepot`) with zod validation: names NFC-normalised, trimmed, 1–60 chars, unique case-insensitively (DB unique index as backstop, `P2002` → `name-taken`), typed `{ ok: false, reason }` results. Server actions with a session guard and `revalidatePath("/", "layout")`. German UI: Overview empty state ("Noch kein Depot.", "Depot anlegen", disabled "Aus Parqet übernehmen") or Depot list; `/depots` list; `/depots/[id]` with name, Broker, "Cash-Konto 0,00 €", "Noch keine Buchungen." and disabled "Neue Buchung" (404 for unknown ids); Settings → Depots with create and rename dialogs. Cash balance is the constant `"0"` until story 1.6.

**Files changed:**
- `prisma/schema.prisma`, `prisma/migrations/20261025141837_add_depot/migration.sql` -- Broker enum, Depot model.
- `src/modules/ledger/{depots,index}.ts` (+ test) -- Depot services.
- `src/app/_actions/depots.ts` (+ test) -- create/rename server actions.
- `src/app/_components/depots/{DepotDialogs,DepotList,DepotLink}.tsx`, `labels.ts` (+ test) -- dialogs, list, link, German labels and errors.
- `src/app/(app)/page.tsx`, `depots/page.tsx`, `depots/[id]/page.tsx`, `settings/page.tsx` (+ tests) -- pages.
- `test/helpers/{test-db,migrated-db-file,render-text}.ts`, `test/setup.ts`, `vitest.config.ts` -- temp migrated DBs, text rendering, test `DATABASE_URL` default.
- `package.json`, `package-lock.json` -- `@types/better-sqlite3` 9.6.0 (dev, exact).

**Review findings:** 25 findings (high 0, medium 0, low 14, false 11). Patches applied: 10 low rows in 8 fixes (dialog comment, derived error-reason type, Depot names no longer headings, NFC normalisation + test, action/metadata test gaps, link href assertion, labels mapping test). Deferred: none. Rejected: 11 false (zod messages all explicit; no duplicate dialog ids; migration folders always have SQL; inline-error mapping now tested; pages dynamic so every surface reads fresh; auth guards tested in 1.2; migrate deploy run; commands run; "Neue Buchung" needs story 1.4 and no operator action applies) and 4 low (no DOM test setup ×2; double detail query negligible; repeated empty-state literal; non-string name reason; case-only race accepted; emoji length).

**Follow-up review recommendation:** false — patched entries: high 0, medium 0, low 8.

**Verification:** `npm run lint`, `npm run typecheck` exit 0; `npm test` 24 files / 192 tests passed; `npm run build` exit 0 (`/depots/[id]` dynamic). `prisma migrate deploy` against a scratch DB applied both migrations. Live `next start` with synthetic auth and a scratch DB: `/`, `/depots`, `/settings` show "Noch kein Depot." / "Depot anlegen" (Overview also the disabled "Aus Parqet übernehmen"); after inserting a Depot, `/` lists it with "comdirect", `/depots/d1` shows name, Broker, "Noch keine Buchungen." and "Neue Buchung"; `/depots/xyz` returns 404. The implementer also exercised create/rename and the error reasons through the server actions over HTTP.

**Residual risks:** the client dialogs (close on success, keep input on error, Esc, full-screen below `sm`) are verified only by build and code reading — no DOM tests exist; Esc closes a dialog mid-write and would hide a failure; `next build` creates `~/.depotmanagement/` when `DATABASE_URL` is unset (directory only).
