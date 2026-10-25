<!-- bmad:context -->
<!-- Verified 2026-10-25 against f40d45a. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## DepotManagement

Self-hosted, single-user portfolio tracker replacing Parqet: Depots, Transactions, FIFO Gain/Loss, TTWROR/XIRR, Parqet migration, broker PDF import. Next.js 16 (App Router) + Prisma 7 + SQLite + MUI 9, TypeScript. Greenfield: no code before Story 1.1. Planning lives in `_bmad-output/`; the architecture spine is the binding contract.

## Policy

- Public repo: never commit or read real financial data (Parqet exports, broker PDFs, databases, backups) or secrets; use synthetic, anonymised fixtures only.
- Never add `.gitignore` exceptions for `*.csv`/`*.pdf`; name test fixtures `*.csv.txt` / `*.txt` under `test/fixtures/` instead.
- Committing and pushing directly to `main` is allowed (single maintainer).
- Commit subjects in English, imperative; for story work append the story key, e.g. `Add app shell (story 1-1)`.
- English for code, comments, docs, commits and PRs; UI text is German (de-DE formats).

## Where things are

- Architecture invariants AD-1..AD-19: `_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md` — read before touching ledger, prices, import, migration, money or dates.
- What to build: `_bmad-output/specs/spec-DepotManagement/SPEC.md` and its companions (glossary, Parqet format, data sources).
- Look and behavior: `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/` (`DESIGN.md`, `EXPERIENCE.md`, `mockups/`).
- Stories and acceptance criteria: `_bmad-output/planning-artifacts/epics.md`; progress: `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## Running and verifying

- Node 24 LTS (`engines >=24.11 <25`).
- Install Prisma with exact pins — `prisma@7.10.1 @prisma/client@7.10.1 @prisma/adapter-better-sqlite3@7.10.1`; the `prisma` `latest` tag is an 8.x release candidate.
- Use `better-sqlite3@12.11.1`, not 13.x — the Prisma adapter requires `^12.6`.
- Apply migrations with `prisma migrate deploy` in the deploy/start script; the app never migrates itself.
- Set `NEXT_TELEMETRY_DISABLED=1`.
- TODO after Story 1.1: verify dev, test, lint and typecheck commands and their caveats here.

## Conventions that differ from defaults

- Money, quantities, prices: TEXT decimal strings computed with `decimal.js`; never JS `number`, Prisma `Decimal` (SQLite stores it as REAL) or SQL arithmetic on them.
- Positions, balances, Cost Basis, returns are computed on read by `src/core`; never store or directly edit them — corrections are Transactions.
- Only the `ledger` module writes ledger rows; import, migration, manual entry and restore all call its service.
- `src/core` is pure: no Prisma, network, file I/O or `Date.now()`; it imports only its own files and `decimal.js`; pass "today" in.
- Dates are business dates `YYYY-MM-DD` (Europe/Berlin), never timestamps; order by `(date, sequence)`.
- Never edit a committed Prisma migration; add a new one.
- Tests never hit live providers; use recorded responses.

<!-- /bmad:context -->
