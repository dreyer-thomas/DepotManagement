---
title: 'Story 1.1: Project Starter and App Shell'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '3ec0ddea7f8cb74a20e4c0c5b2d98b44e45ea81d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The repository holds only planning documents; no runnable code exists, so no later story has a stack, theme, shell, format helpers or architecture guard to build on.

**Approach:** Scaffold a Next.js 16 App Router + Prisma 7 (better-sqlite3 adapter) + MUI 9 TypeScript project with the exact spine pins and Structural Seed, a "Minze" MUI theme with light/dark color schemes, a responsive navigation shell with placeholder pages, pure de-DE format helpers in `src/core`, a test-enforced `src/core` import guard, and README/AGENTS docs including the project Definition of Done.

## Boundaries & Constraints

**Always:**
- Exact versions (no `^`/`~`) for every dependency in `package.json`: next 16.4.2, react/react-dom 19.3.0, prisma/@prisma/client/@prisma/adapter-better-sqlite3 7.10.1, better-sqlite3 12.11.1, @mui/material + @mui/material-nextjs + @mui/icons-material 9.5.0, @emotion/react 11.14.0, @emotion/styled 11.14.1, @emotion/cache 11.14.0, zod 4.6.7, decimal.js 10.6.0, vitest 5.0.5, typescript 5.9.3; other tooling (eslint, eslint-config-next 16.4.2, @types/*, dotenv) also exact. `engines.node` = `>=24.11 <25`; `.nvmrc` = 24.
- `NEXT_TELEMETRY_DISABLED=1` prefixed in the `dev`, `build`, `start` scripts and stated in README.
- `start` script runs `prisma migrate deploy` before `next start`; the app never migrates itself.
- `src/core` is pure: imports only relative files inside `src/core` and `decimal.js`; no `number` arithmetic on money/quantities.
- UI text German; code, comments, docs English.
- MUI CSS-variables theme with `colorSchemes.light` / `colorSchemes.dark` built from every DESIGN.md color token and its `-dark` variant; mode `system` by default; manual Light/Dark/System toggle via `useColorScheme` (persisted in localStorage by MUI); `InitColorSchemeScript` prevents a flash.

**Never:**
- No Prisma models, auth, Depot features, FAB, Period selector, data fetching or real Overview content (later stories).
- No real financial data, no secrets, no `.gitignore` exceptions for `*.csv`/`*.pdf`.
- No `number`/`parseFloat`/`Intl.NumberFormat` on money, quantity or price values in format helpers.
- No edits to `_bmad-output/implementation-artifacts/sprint-status.yaml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Money | `formatMoney("1234.5")` / `"-1234567.891"` / `"0"` | `1.234,50 €` / `-1.234.567,89 €` / `0,00 €` (NBSP before €, half-up rounding) | — |
| Money signed | `formatMoney("12.3", { sign: true })` | `+12,30 €`; zero shows no sign | — |
| Percent | `formatPercent("0.0321")` / `"-0.5"` | `+3,21 %` / `-50,00 %` (ratio input, always signed, NBSP before %) | — |
| Quantity | `formatQuantity("10.50000000")` / `"0.12345678"` / `"1234"` | `10,5` / `0,12345678` / `1.234` (max 8 decimals, trailing zeros trimmed) | — |
| Date | `formatDate("2026-10-25")` | `25.10.2026` | Non-`YYYY-MM-DD` or impossible date throws `TypeError` (programmer error) |
| Invalid decimal | `formatMoney("abc")` | — | throws (decimal.js error) |
| DB URL default | `DATABASE_URL` unset or empty | `file:<os.homedir()>/.depotmanagement/depot.db`, directory created | — |
| Core import guard | file in `src/core` imports `@/db`, `../modules/x`, `node:fs` or `zod` | `npm test` fails naming file and specifier | — |

</intent-contract>

## Code Map

- `.gitignore` -- already ignores `.env*` (except `.env.example`), `*.db`, `/data/`, `backups/`; add `.next/`, `next-env.d.ts`, `src/db/generated/`, `coverage/`, `*.tsbuildinfo`, `*.db-wal`, `*.db-shm`.
- `AGENTS.md` -- "Running and verifying" has a TODO to replace with verified dev/test/lint/typecheck commands after this story.
- `README.md` -- exists (minimal); extend with setup, scripts, DoD.
- `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md` -- frontmatter is the token source (colors, typography roles, radii, shadow).
- `_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/EXPERIENCE.md` -- Responsive & Platform table (nav labels), Voice and Tone, Interaction Primitives, Accessibility Floor (DoD source).
- Spine AD-18 -- env var names: `DATABASE_URL`, `SESSION_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `BACKUP_DIR`, `BACKUP_KEEP`, `COINGECKO_API_KEY`, `OPENFIGI_API_KEY`, `LOGO_DEV_API_KEY`, `DATA_DIR`.
- Environment: Node v24.19.0 and npm 11 installed; all pinned versions verified to exist on the npm registry.

## Tasks & Acceptance

**Execution:**
- `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json` (strict, `@/*` → `src/*`), `next.config.ts` -- create project with exact pins and scripts `dev`, `build`, `start` (migrate deploy + next start), `test` (vitest run), `lint` (eslint .), `typecheck` (tsc --noEmit), `postinstall` (prisma generate) -- runnable stack.
- `eslint.config.mjs` -- flat config from eslint-config-next (core-web-vitals + typescript) -- lint baseline.
- `vitest.config.ts` -- node environment, `@` alias, includes `src/**/*.test.ts` and `test/**/*.test.ts`.
- `prisma/schema.prisma`, `prisma.config.ts` -- sqlite datasource, `prisma-client` generator with output `../src/db/generated/prisma`; config loads `.env` via dotenv and takes the URL from `src/db/database-url.ts`; `prisma/migrations/` with an initial empty baseline migration and `migration_lock.toml` so `migrate deploy` succeeds on a fresh clone.
- `src/db/database-url.ts` -- `resolveDatabaseUrl(env)`: returns `DATABASE_URL` if non-empty, else the home-dir default; ensures the parent directory exists.
- `src/db/index.ts` -- Prisma client singleton (globalThis cache in dev) using `PrismaBetterSqlite3` with a busy timeout (5000 ms) and `PRAGMA journal_mode = WAL` applied on connect.
- `src/core/format.ts` + `src/core/format.test.ts` -- `formatMoney`, `formatPercent`, `formatQuantity`, `formatDate` per the I/O matrix using decimal.js string output only.
- `test/architecture/core-imports.test.ts` -- scans every `.ts/.tsx` under `src/core` for import/export/require/dynamic-import specifiers; fails unless specifier is `decimal.js` or a relative path resolving inside `src/core`.
- `test/db/database.test.ts` -- with a temp `DATABASE_URL`, opening the client yields `journal_mode = wal` and busy timeout > 0; `resolveDatabaseUrl` default lies outside the repo.
- `src/theme/tokens.ts`, `src/theme/theme.ts` (+ `src/theme/theme.test.ts`) -- tokens mirrored from DESIGN.md; `createTheme` with `cssVariables: { colorSchemeSelector: 'class' }`, both color schemes, custom palette entries (`accent`, `gain`, `loss`, `stale`, `cash`, soft variants) with TS module augmentation, typography variants `pageTitle`, `figureHero`, `figureKpi`, `figure` (`fontVariantNumeric: 'tabular-nums'`), shape radius 8, card radius 16 + mint shadow via `MuiCard`/`MuiPaper` overrides, pill radius 9999 for Chip; test asserts token values.
- `src/app/layout.tsx` -- `lang="de"`, Roboto via `next/font/google`, `AppRouterCacheProvider`, `ThemeProvider`, `InitColorSchemeScript`, `CssBaseline`, `AppShell`.
- `src/app/_components/AppShell.tsx` (client) + `src/app/_components/navigation.ts` -- top AppBar with title "DepotManagement" and `ColorModeToggle`; ≥ md permanent Drawer: Übersicht `/`, Depots `/depots`, Import `/import`, Nachrichten `/news`, Wertpapiere `/securities`, Einstellungen `/settings`; < md BottomNavigation: Übersicht, Depots, Nachrichten, Mehr `/more`; active item from `usePathname`; content max width 1280, gutters 16/24 px; ≥ 44 px touch targets.
- `src/app/_components/ColorModeToggle.tsx` -- IconButton menu "Darstellung": System / Hell / Dunkel, accessible label.
- `src/app/_components/Placeholder.tsx` + pages `src/app/page.tsx`, `depots/page.tsx`, `import/page.tsx`, `news/page.tsx`, `securities/page.tsx`, `settings/page.tsx`, `more/page.tsx` -- page title (pageTitle variant) + neutral card "Dieser Bereich folgt in einer späteren Version."; `/more` lists links to Import, Wertpapiere, Einstellungen.
- `src/modules/.gitkeep`, `test/fixtures/.gitkeep` -- Structural Seed directories.
- `.env.example` -- all ten AD-18 names with empty values plus comments (DATABASE_URL default explained).
- `README.md` -- prerequisites (Node 24), setup steps (`npm install`, `cp .env.example .env`, `npx prisma migrate deploy`, `npm run dev`), scripts table, telemetry note, source tree, Definition of Done (voice/tone, no optimistic writes, no hover-only actions, modal depth ≤ 1, Enter submits, Esc closes, WCAG 2.2 AA, ≥ 44 px touch targets, gain/loss with sign + arrow).
- `AGENTS.md` -- replace the TODO with the verified commands and caveats.

**Acceptance Criteria:**
- Given a fresh clone on Node 24, when running `npm ci`, `cp .env.example .env`, `npx prisma migrate deploy`, `npm run dev`, then `GET /` returns 200 with the shell and all nav pages return 200.
- Given `package.json`, when inspected, then every dependency is an exact pin matching the spine Stack table.
- Given the source tree, then `src/app`, `src/core`, `src/modules`, `src/db`, `prisma/`, `test/fixtures/` exist.
- Given a viewport ≥ 900 px, then the permanent drawer with the six German labels is shown; below 900 px the bottom navigation (Übersicht, Depots, Nachrichten, Mehr) is shown instead.
- Given the system prefers dark and no manual choice, then the dark scheme applies; when the user picks "Hell", then light applies and persists after reload.
- Given `npm test`, then vitest passes including core format tests, theme token test, DB pragma test and the core import guard.
- Given `npm run lint`, `npm run typecheck`, `npm run build`, then each exits 0.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 41 findings — high 0, medium 5, low 29, false 7, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) .gitignore misses `*.db-journal` and sqlite-suffixed WAL/SHM/journal files — added all seven patterns.
  - `[medium]` `[patch]` (blind) README shows `file:~/...`; `~` is not expanded, so a copied value creates `./~` inside the repo — README now says an absolute path is required, never `~`.
  - `[low]` `[reject]` (blind) `resolveDatabaseUrl` mkdirs as a side effect on prisma generate / module import — creates only an empty dir that the app needs anyway; making it lazy restructures config and client.
  - `[low]` `[patch]` (blind) DB test writes to the real home, leaves `DATABASE_URL` mutated — HOME/USERPROFILE redirected to a temp dir and restored; DATABASE_URL restored.
  - `[low]` `[patch]` (blind) core purity not enforced for `Date.now()`, `new Date`, `fetch`, `process` — ESLint block for `src/core/**` added (no-restricted-globals / no-restricted-syntax).
  - `[low]` `[reject]` (blind) guard rejects `@/core/...` alias imports — intended (relative only); the failure message names file and specifier; allowing it adds a branch for no current caller.
  - `[low]` `[patch]` (blind) vitest include skips `*.test.tsx` — globs changed to `*.test.{ts,tsx}`.
  - `[low]` `[patch]` (blind) navigation logic untested — `navigation.test.ts` added.
  - `[low]` `[reject]` (blind) theme test mirrors only colors from DESIGN.md, typography/radii hard-coded — they are still asserted against literal DESIGN.md values; parsing the rest of the frontmatter adds parser complexity.
  - `[low]` `[patch]` (blind) theme test does not assert the class selector — asserts `theme.colorSchemeSelector === "class"`.
  - `[low]` `[patch]` (blind) AppShell hard-codes max width/gutters while spacing tokens exist — AppShell uses the tokens.
  - `[false]` `[reject]` (blind) no skip link violates WCAG 2.4.1 — `nav` and `main` landmarks are present, which is a sufficient technique (ARIA11) for Bypass Blocks.
  - `[low]` `[patch]` (blind) color-mode menu does not expose the selected item to screen readers — items are `menuitemradio` with `aria-checked`.
  - `[low]` `[reject]` (blind) format helpers accept hex/exponent decimals — inputs come from validated canonical strings (zod at boundaries); an extra guard adds a branch for an unreachable case.
  - `[false]` `[reject]` (blind) next.config comment claims Prisma stays external but `@prisma/client` is not listed — Next's built-in `server-external-packages.jsonc` already lists `@prisma/client`, `prisma`, `better-sqlite3`.
  - `[low]` `[reject]` (blind) `/more` reachable on desktop with no nav item selected — harmless; the page still renders its links.
  - `[low]` `[reject]` (edge) `DATABASE_URL` with `?query` makes adapter and mkdir disagree — no supported use of query params; guard adds a branch for an unlikely input.
  - `[medium]` `[patch]` (edge) `file:~/...` from README creates a DB inside the repo — same root cause and fix as the README tilde row.
  - `[low]` `[reject]` (edge) unwritable HOME makes postinstall fail with raw EACCES — unlikely; workaround is setting DATABASE_URL; same eager-mkdir root cause.
  - `[low]` `[reject]` (edge) every install creates `~/.depotmanagement` — same eager-mkdir root cause; harmless empty dir.
  - `[false]` `[reject]` (edge) `connectToShadowDb` skips WAL — the runtime client never opens a shadow DB; only `prisma migrate dev` (CLI, own engine) uses one.
  - `[low]` `[reject]` (edge) importing `@/db` creates the client eagerly — no page imports it yet; Prisma connects lazily; same eager-mkdir root cause.
  - `[low]` `[patch]` (edge) DB test fails/writes on read-only or real HOME — fixed with the HOME redirect above.
  - `[low]` `[patch]` (edge) `process.env.DATABASE_URL` not restored — restored in the pragma test.
  - `[low]` `[patch]` (edge) CRLF DESIGN.md crashes the theme-test parser — CRLF normalised before parsing.
  - `[false]` `[reject]` (edge) differently quoted DESIGN.md colors silently drop tokens — a dropped token makes `toEqual` fail loudly, which is the desired behavior.
  - `[low]` `[reject]` (edge) non-literal `require(name)` bypasses the import guard — contrived; flagging needs a full AST walk.
  - `[low]` `[patch]` (edge) `.js/.mjs/.cjs/.jsx` files in core are not scanned — file regex extended.
  - `[low]` `[patch]` (edge) specifiers `.`/`..` are false positives — treated as relative and still bounded to `src/core`; test added.
  - `[low]` `[reject]` (edge) precision 50 can double-round ratios with >48 significant digits — no realistic input; decimal.js has no exact shift, so a fix is not a direct correction.
  - `[low]` `[reject]` (edge) huge exponent (`1e1000000`) stalls formatting — inputs are validated canonical decimals; a range guard adds a branch.
  - `[medium]` `[patch]` (edge) `*.db-journal` not ignored — same root cause and fix as the .gitignore row.
  - `[false]` `[reject]` (edge) trailing slash / case variants deactivate nav — Next redirects trailing slashes by default and case variants 404, so no page renders with such a pathname.
  - `[low]` `[patch]` (verification-gap) `colorSchemeSelector: "class"` unasserted — same fix as the theme selector row.
  - `[low]` `[patch]` (verification-gap) busy timeout asserted only `> 0` — now asserts equality with `BUSY_TIMEOUT_MS` (note: equals the driver default 5000, so a dropped option is still not detectable).
  - `[low]` `[patch]` (verification-gap) `isActive`/`activeBottomHref` untested — same fix as the navigation test row.
  - `[low]` `[reject]` (verification-gap, other) query string in `DATABASE_URL` — same as the edge query-string row.
  - `[medium]` `[patch]` (intent) `next dev` appended a third-party `nextjs-agent-rules` block to the curated AGENTS.md — `agentRules: false` in next.config.ts and block removed; a later `next dev` run left AGENTS.md clean.
  - `[false]` `[reject]` (intent) browser-level ACs (system dark, toggle persistence) not exercised — verified with headless Chrome over CDP: system dark gives `dark` class and bg `#0E1A17`; choosing "Hell" gives `light`, localStorage `mui-mode=light`, and it survives a reload.
  - `[false]` `[reject]` (intent) work is uncommitted — committing is the finalize step that follows this review.
  - `[low]` `[patch]` (intent) DB test creates `~/.depotmanagement` in the real home — same fix as the HOME redirect row.

## Design Notes

Format helpers produce strings via `new Decimal(v).toFixed(dp, Decimal.ROUND_HALF_UP)`, then split integer/fraction, group the integer part with `.` every three digits and join with `,`. Negative zero after rounding renders without a sign. Percent takes a ratio (`0.0321`) because returns are ratios in core; multiply by 100 with decimal.js.

`DATABASE_URL` default lives in code (not in `.env.example`, which carries no values per AD-18) so a copied `.env` with empty values still points outside the source tree.

## Verification

**Commands:**
- `npm ci` -- expected: installs, `prisma generate` succeeds
- `npm run lint && npm run typecheck && npm test` -- expected: all exit 0
- `npm run build` -- expected: exit 0
- `npm run dev` then `curl -s -o /dev/null -w '%{http_code}' localhost:3000/{,depots,import,news,securities,settings,more}` -- expected: 200 each
- `DATABASE_URL=file:/tmp/x/depot.db npx prisma migrate deploy` -- expected: success

**Manual checks (if no CLI):**
- Rendered HTML of `/` contains the German nav labels and the color-scheme init script.

## Auto Run Result

Status: done

**Summary:** Scaffolded the DepotManagement app on the exact spine stack (Next.js 16.4.2, React 19.3.0, Prisma 7.10.1 with the better-sqlite3 12.11.1 adapter, MUI 9.5.0, zod 4.6.7, decimal.js 10.6.0, vitest 5.0.5, TypeScript 5.9.3, Node 24). Added the Structural Seed, the "Minze" theme with light/dark CSS-variable schemes and a persisted System/Hell/Dunkel toggle, the responsive shell (drawer ≥ md, bottom navigation < md) with placeholder pages, pure de-DE format helpers in `src/core`, a test-enforced core import guard plus an ESLint purity block, a WAL/busy-timeout Prisma client with an empty baseline migration, and README/AGENTS docs including the Definition of Done.

**Files changed:**
- `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts` -- project setup, exact pins, scripts, `agentRules: false`.
- `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/**` -- sqlite datasource, generator into `src/db/generated`, empty baseline migration.
- `src/db/database-url.ts`, `src/db/index.ts` -- DB URL default outside the repo; Prisma singleton with WAL and busy timeout.
- `src/core/format.ts` (+ test) -- formatMoney / formatPercent / formatQuantity / formatDate on decimal strings.
- `src/theme/tokens.ts`, `src/theme/theme.ts` (+ test) -- DESIGN.md tokens and MUI theme.
- `src/app/layout.tsx`, `src/app/_components/*` (+ navigation test), `src/app/**/page.tsx` -- shell, color-mode toggle, placeholders, `/more`.
- `test/architecture/core-imports.test.ts`, `test/db/database.test.ts` -- core import guard; DB URL and pragma tests.
- `.env.example`, `.gitignore`, `README.md`, `AGENTS.md`, `src/modules/.gitkeep`, `test/fixtures/.gitkeep` -- config template, ignores, docs.

**Review findings:** 41 findings (high 0, medium 5, low 29, false 7). Patches applied: 23 rows (5 medium, 18 low), grouped into 13 fixes: SQLite side-file ignores, README absolute-path note, AGENTS.md Next.js block removal + `agentRules: false`, DB test HOME/env isolation and exact busy timeout, theme selector + CRLF, navigation tests, tsx test globs, core ESLint purity block, import-guard `.`/`..` and JS extensions, AppShell spacing tokens, `menuitemradio`. Deferred: none. Rejected: 7 false (skip link covered by landmarks; Next already externalises `@prisma/client`; shadow DB unused at runtime; loud failure on dropped tokens; Next normalises trailing slashes; browser ACs verified via CDP; commit happens at finalize) and 11 low (eager mkdir ×4 — harmless empty dir, fix restructures config; `@/core` alias rejection by design; theme typography not parsed from DESIGN.md; hex/exponent and huge-exponent inputs unreachable behind validation; `/more` on desktop harmless; DATABASE_URL query strings ×2 unsupported/unlikely; non-literal require contrived; precision-50 double rounding unrealistic).

**Follow-up review recommendation:** false — patched entries: high 0, medium 5 (on a first pass this would qualify), but every patch was re-verified by the full verification run and the browser check, and no specific unverified risk remains to name.

**Verification:** `npm ci` (prisma generate ran, native better-sqlite3 built); `npm run lint`, `npm run typecheck` exit 0; `npm test` 5 files / 46 tests passed; `npm run build` exit 0 (8 static routes); `DATABASE_URL=file:/tmp/x/depot.db npx prisma migrate deploy` applied the baseline; `npm run dev` returned 200 for `/`, `/depots`, `/import`, `/news`, `/securities`, `/settings`, `/more`, and the HTML contains all German nav labels and the color-scheme init script; headless Chrome (CDP) confirmed that system dark applies the dark scheme and that "Hell" persists across a reload; AGENTS.md stayed clean after `next dev`.

**Residual risks:** `next build` needs network for `next/font/google`; empty `DATABASE_URL` makes Prisma CLI calls (including postinstall) create `~/.depotmanagement`; the busy-timeout test cannot detect a dropped option because the driver default equals 5000 ms; the DESIGN.md primary `#0FA68A` with white text is about 3:1 contrast, which future primary buttons must account for (WCAG AA).
