---
review: tech-currency
target: ARCHITECTURE-SPINE.md
date: '2026-10-25'
method: npm registry queries (dist-tags, peerDependencies, dependencies, engines, publish times), nodejs.org release schedule, GitHub release notes and security advisories, plus hands-on spikes in a scratch directory on Node v24.19.0 / npm 11.18.0
verdict: PASS WITH FIXES (one AD-level correction, three version-pin corrections)
---

# Tech Currency Review: Architecture Spine, DepotManagement

## Verdict

**Pass with fixes.** Every named technology exists, is maintained, and was confirmed working on Node 24 in a spike. Most pinned versions are the current `latest`. But four stack entries are wrong or misleading, and one invariant (AD-5) promises more than the chosen storage delivers:

1. **AD-5 / Prisma `Decimal` on SQLite is stored as binary REAL**, not as an exact decimal. This was measured, not inferred. Values round-trip exactly only up to about 15 significant digits, and any database-side arithmetic (`aggregate._sum`, `SUM()`) drifts like floats do.
2. **better-sqlite3 13.0.3 is outside the range of `@prisma/adapter-better-sqlite3@7.10.1`**, which depends on `better-sqlite3 ^12.6.0` as a regular dependency. Pinning 13 gives you a second, unused native build.
3. **React 19.2.x is out of date.** `create-next-app@16.4.3` installs React 19.3.0, the latest is 19.3.1, and MUI 9.5 depends on `react-is ^19.3.0`.
4. **The `prisma` CLI's `latest` dist-tag points to `8.0.0-rc.27`**, while `@prisma/client` `latest` is 7.10.1. An unpinned `npm i -D prisma` installs a Prisma 8 release candidate.

Minor: Next 16.4.3 is out (bug-fix backport). "TypeScript 5.x" should be an exact pin, because TS 7.0.2 is now `latest`. Node 24 went to Maintenance LTS on 2026-10-20.

## Version table: spine vs registry (2026-10-25)

| Package | Spine | npm `latest` / relevant tag | Status |
| --- | --- | --- | --- |
| Node.js | 24 LTS | 24.22.1 (Krypton, **Maintenance LTS since 2026-10-20**, EOL 2028-04-30); 26.12.1 becomes LTS 2026-10-28 | OK, pin minor (see F-7) |
| TypeScript | 5.x "as shipped" | scaffold writes `^5` → 5.9.3; `latest` = **7.0.2** | Pin `5.9.3` (F-6) |
| next | 16.4.2 | **16.4.3** (2026-10-23) | Bump (F-5) |
| react / react-dom | 19.2.x | **19.3.1**; create-next-app 16.4.3 installs 19.3.0 | **Outdated** (F-3) |
| prisma (CLI) | 7.10.1 | `latest` = **8.0.0-rc.27**, `prev` = 7.10.1 | Pin exact (F-4) |
| @prisma/client | 7.10.1 | 7.10.1 | OK |
| @prisma/adapter-better-sqlite3 | 7.10.1 | 7.10.1 (deps: `better-sqlite3 ^12.6.0`) | OK |
| better-sqlite3 | 13.0.3 | 13.0.3 is `latest`; **12.11.1** is the newest version in the adapter's range | **Incompatible pin** (F-2) |
| @mui/material | 9.5.0 | 9.5.0 | OK |
| @mui/material-nextjs | 9.5.0 | 9.5.0 (peer `next ^13‖^14‖^15‖^16`, exports `./v16-appRouter`) | OK |
| @emotion/react / styled / cache | not listed | 11.14.0 / 11.14.1 / 11.14.0 | Add to stack (F-8) |
| zod | 4.6.7 | 4.6.7 | OK |
| decimal.js | 10.6.0 | 10.6.0 (released 2025-07, stable) | OK |
| unpdf | 1.9.1 | 1.9.1 (engines node >=22, ESM, zero deps) | OK |
| yahoo-finance2 | 4.0.5 | 4.0.5 (engines node >=22) | OK |
| jose | 6.2.13 | 6.2.13 | OK |
| bcrypt | 6.0.0 | 6.0.0 (native, node-addon-api) | OK |
| vitest | 5.0.5 | 5.0.5 (peer `vite ^6.4‖^7‖^8`, **not optional**) | OK, add vite (F-8) |

## Findings

### F-1 [HIGH, AD-5 correctness]: Prisma `Decimal` on SQLite is float storage

**Evidence (spike, Prisma 7.10.1 + adapter-better-sqlite3 7.10.1, Node 24.19.0).** A model with a `Decimal` column was written and read back:

| Written | Read back | Note |
| --- | --- | --- |
| `0.1`, `1234567.12345678`, `99999999999.99`, `1000000.005` | identical | exact |
| `0.00000001` | `1e-8` from `toString()`, `0.00000001` from `toFixed()` | formatting only. Always serialise with `toFixed()` |
| `9007199254740993` | `9007199254740992` | **lossy** |
| `123456789012345678.123456789` | `123456789012345680` | **lossy** |
| `aggregate({_sum})` of 0.1 + 0.2 | `0.30000000000000004` | **DB-side math is float** |

`SELECT typeof(amt)` returns `real` or `integer`. SQLite gives `DECIMAL` columns NUMERIC affinity, so values are stored as IEEE-754 doubles, and Prisma rebuilds a `Decimal` from the shortest double representation.

**Impact.** At realistic magnitudes (amounts below about 10^11 with 2 decimals, quantities with 8 decimals and at most about 15 significant digits) single values round-trip exactly. So AD-5's "exact Depot value and Cost Basis" is achievable, but only if (a) no financial arithmetic runs in SQL and (b) no value goes past about 15 significant digits. As written, AD-5 ("Stored as Prisma Decimal ... decimals end to end") implies exact storage, which SQLite does not provide. A developer who uses `prisma.transaction.aggregate({ _sum: { amount: true } })` for a cash balance silently breaks AD-1/AD-5.

**Fix (choose one and record it in AD-5):**
- **Recommended:** keep `Decimal` columns, and add two rules to AD-5: "No SQL-side arithmetic or aggregation (`_sum`, `_avg`, raw `SUM`) on money, quantity or price columns. All sums go through `src/core` with decimal.js." and "Values are limited to 15 significant digits. Zod validation rejects anything longer." Serialise with `Decimal#toFixed()`, never `toString()`.
- **Strictest:** store money, quantities and prices as `String` (TEXT) columns holding canonical decimal strings, and convert with decimal.js in the ledger module. This gives truly exact storage, but you lose numeric `orderBy`/range filters on those columns, which the ledger does not need.

### F-2 [HIGH]: better-sqlite3 13.0.3 conflicts with the Prisma adapter's range

`@prisma/adapter-better-sqlite3@7.10.1` declares `"better-sqlite3": "^12.6.0"` as a **dependency**, not a peer. The adapter creates the `Database` itself (`new PrismaBetterSqlite3({ url })`). The Prisma 8 dev line (`8.1.0-dev.9`) still pins `^12.6.0`. When the spike installed the spine's pins, `npm ls` showed:

```
├─┬ @prisma/adapter-better-sqlite3@7.10.1
│ └── better-sqlite3@12.11.1      <- the copy Prisma actually uses
├── better-sqlite3@13.0.3          <- spine pin, unused by Prisma
```

So the spine's version is never the one that runs. It also adds a second native compile, and it breaks if anyone hands a 13.x `Database` instance across. The `prisma` CLI peer (`better-sqlite3 >=9.0.0`) does accept 13.

**Fix:** change the stack row to **`better-sqlite3` 12.11.1** (engines: Node 20/22/23/24/25/26), or drop the direct dependency and let the adapter bring it in. If a direct dep is kept for scripts, add an npm `overrides` entry so only one copy exists: `"overrides": { "better-sqlite3": "12.11.1" }`.

### F-3 [MEDIUM]: React 19.2.x is behind the scaffold and MUI

- `create-next-app@16.4.3` hard-codes React `19.3.0` (constant in its dist bundle). The spine's TypeScript row says "as shipped with Next.js scaffold", so the React row contradicts what the scaffold produces.
- `react` / `react-dom` `latest` = 19.3.1.
- `@mui/material@9.5.0` depends on `react-is ^19.3.0`. With React 19.2, `react-is` would be a minor version ahead of `react`, and MUI's guidance is to keep the two aligned.
- The spike ran Next 16.4.3 + React 19.3.1 + MUI 9.5.0 + `@mui/material-nextjs/v16-appRouter` `AppRouterCacheProvider`. It built and server-rendered a `Button` under `next start` with emotion styles emitted. No warnings.

**Fix:** pin **`react@19.3.1` and `react-dom@19.3.1`**, plus **`@types/react@19.3.0`**.

### F-4 [MEDIUM]: `prisma` CLI `latest` is a Prisma 8 RC

`npm view prisma dist-tags` shows `latest: 8.0.0-rc.27`, `prev: 7.10.1`. `@prisma/client` `latest` is still 7.10.1. With a caret range or a plain `npm i -D prisma`, CLI and client end up on different majors (8 RC vs 7). Prisma 8 RC also narrows engines to `node ^22.18 || ^24.11 || >=26`.

**Fix:** use exact pins with no caret: **`"prisma": "7.10.1"`, `"@prisma/client": "7.10.1"`, `"@prisma/adapter-better-sqlite3": "7.10.1"`**. Note in the spine that the Prisma 8 upgrade is deferred until GA.

Prisma 7 reality notes, confirmed in the spike and useful for the scaffold story:
- Uses the `prisma-client` generator with an explicit `output` (for example `src/generated/prisma`).
- `datasource db { provider = "sqlite" }` carries no `url`. The URL goes in `prisma.config.ts` (`defineConfig({ datasource: { url } })`).
- The client is constructed with `new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })`.
- `@default(cuid())` still works.
- Next 16's built-in `serverExternalPackages` list already includes `better-sqlite3`, `@prisma/client`, `prisma` and `bcrypt`.

### F-5 [LOW]: Next.js 16.4.2 → 16.4.3

16.4.3 (2026-10-23) is a bug-fix backport, including "Avoid loading standalone React in server bootstrap" and a proxy.ts runtime fix. 16.4.2 already contains the 16.4.1 patches for the two critical RCE advisories from 2026-10-14: Image Optimization SVG, and `use cache` with typed arrays, both affecting `<=16.4.0`. So 16.4.2 is not vulnerable to them, just one patch behind.

**Fix:** pin **`next@16.4.3`** (and `eslint-config-next@16.4.3` if used). Also: in Next 16, `middleware.ts` is now `proxy.ts`. AD-13's "login required on every page and route" check should be described as living there, and still verified inside route handlers and server actions.

### F-6 [LOW]: "TypeScript 5.x" is not a pin, and `latest` is now 7.x

TypeScript `latest` = 7.0.2 (the native Go port). The scaffold writes `"typescript": "^5"`, which resolves to 5.9.3 and will not jump to 7. Prisma 7 requires `>=5.4`. The spike's Next 16.4.3 build ran its type check with 5.9.3. Next 16.4 + TS 7 was **not verified**.

**Fix:** pin **`typescript@5.9.3`**. Treat TS 7 as a separate, later upgrade.

### F-7 [LOW]: Node 24 phase changed this week

The Node release schedule shows v24 moved from Active to **Maintenance LTS on 2026-10-20**, with EOL on 2028-04-30. v26 becomes Active LTS on **2026-10-28**. Node 24 is still a sound, supported choice, and every package here supports it. The constraints that matter are vitest 5 `^24.0.0` and the future Prisma 8 `^24.11.0`.

**Fix:** state **Node `24.22.1`** (or `>=24.11 <25` in `engines`) and add a `.nvmrc`. Optionally note "move to Node 26 LTS after 2026-10-28 once better-sqlite3 and bcrypt prebuilds are confirmed". better-sqlite3 12.10+ already lists `26.x`.

### F-8 [LOW]: Required companion packages missing from the stack table

- **MUI's styling engine:** `@emotion/react@11.14.0`, `@emotion/styled@11.14.1` and `@emotion/cache@11.14.0` are needed for `@mui/material` plus the `AppRouterCacheProvider`. They are optional peers in metadata but required in practice.
- **vitest 5** declares `vite ^6.4 || ^7 || ^8` as a *non-optional* peer. npm 11 auto-installed `vite@8.3.5`. Pin **`vite@8.3.5`** explicitly. If component tests are wanted later, use `@vitejs/plugin-react@6.1.2` (peer `vite ^8`). For `@/` path aliases, Vite 8's built-in tsconfig-paths resolution is expected to replace `vite-tsconfig-paths@6.1.1`, but this was **not verified** in the spike.
- **`@types/node@24`** (vitest 5 peer `@types/node ^22 || >=24`). The scaffold writes `^20`, so change it to match Node 24.

## Specific checks requested

| Question | Result | How verified |
| --- | --- | --- |
| Next.js 16 `instrumentation.ts` still supported for in-process scheduling under `next start` | **Confirmed.** `register()` in `src/instrumentation.ts`, with a `NEXT_RUNTIME === "nodejs"` guard and a dynamic import of the scheduler, ran **at server boot with no incoming request** (`next start`, Next 16.4.3). It did **not** run during `next build`. `setInterval` ticks kept firing. Use a `globalThis` flag, not a module-level variable, as the re-entry guard, because dev/HMR can re-evaluate modules. | Spike |
| yahoo-finance2 and unpdf usable inside the Next-bundled instrumentation hook | **Confirmed.** Both imported in the scheduler module, built with Turbopack (no externals config), and worked at runtime: a live `quote("SAP.DE")` returned EUR 214.4, and PDF text was extracted. | Spike |
| Prisma 7 `Decimal` on SQLite with the better-sqlite3 adapter | **Works, but stored as REAL.** See F-1. | Spike |
| Adapter peer range vs better-sqlite3 13 | **Incompatible:** adapter dependency `^12.6.0`. See F-2. | npm metadata + `npm ls` |
| MUI 9 + `@mui/material-nextjs` with Next 16 / React 19.x | **Compatible.** Peers accept next ^16 and react ^19, the `./v16-appRouter` export exists, and SSR render worked with React 19.3.1. | npm metadata + spike |
| unpdf text extraction on Node 24 | **Confirmed.** `getDocumentProxy` + `extractText({ mergePages: true })` returned the exact text of a generated PDF. Engines `>=22`, ESM-only (fine in Next/vitest). Optional peer `@napi-rs/canvas` is only for rendering, not needed. | Spike |
| yahoo-finance2 4.x Node requirements | Engines **`node >=22.0.0`**. The 4.x API is **instance-based**: `import YahooFinance from "yahoo-finance2"; const yf = new YahooFinance()`. Code examples from 2.x (`yahooFinance.quote(...)` on the default export) are outdated. `quote`, `chart` and `search` work live. **`search(ISIN)` resolves a symbol (`DE0007164600` → `SAP.DE`) but returns 0 news.** News needs a name or ticker query (`search("SAP", { newsCount })` returned 5). This matters for AD-11's secondary news provider. Runtime deps include `@modelcontextprotocol/sdk` and `@deno/shim-deno`. They add install weight but caused no problem in the build. | npm metadata + spike |
| vitest 5 with TS | **Confirmed.** vitest 5.0.5 + vite 8.3.5 ran a TS test that imports decimal.js with zero config. Engines `^22.12 || ^24 || >=26`. | Spike |
| jose 6 / bcrypt 6 | Both are current `latest`. HS256 sign/verify and bcrypt hash/compare work on Node 24. bcrypt is native, but Next externalises it by default. An alternative with no native build is `bcryptjs@3.0.3`. Optional. | Spike |
| zod 4.6.7, decimal.js 10.6.0 | Current `latest`. yahoo-finance2 depends on `zod ^4.6.5`, which dedupes to 4.6.7. | npm metadata |

## Unconfirmed / not exercised

- Prisma Client running *inside* a Next 16 Turbopack build. It was tested standalone only. Externals are configured by default, so the risk is low.
- TypeScript 7 with Next 16.4 (deliberately avoided, see F-6).
- Vite 8 native tsconfig-paths in place of `vite-tsconfig-paths`.
- Google News RSS terms and quality (already an Open Question in the spine). OpenFIGI and onvista endpoints were not called.

## Corrected stack rows (proposed)

| Name | Version |
| --- | --- |
| Node.js | 24.22.1 (Maintenance LTS; `engines: ">=24.11 <25"`) |
| TypeScript | 5.9.3 |
| Next.js (App Router) | 16.4.3 |
| React / react-dom / @types/react | 19.3.1 / 19.3.1 / 19.3.0 |
| prisma, @prisma/client, @prisma/adapter-better-sqlite3 | 7.10.1 (exact; CLI `latest` tag is 8.0.0-rc) |
| better-sqlite3 | 12.11.1 (adapter range `^12.6.0`; or omit and let the adapter provide it) |
| MUI `@mui/material`, `@mui/material-nextjs` | 9.5.0 |
| @emotion/react / styled / cache | 11.14.0 / 11.14.1 / 11.14.0 |
| zod | 4.6.7 |
| decimal.js | 10.6.0 |
| unpdf | 1.9.1 |
| yahoo-finance2 | 4.0.5 |
| jose / bcrypt | 6.2.13 / 6.0.0 |
| vitest / vite / @types/node | 5.0.5 / 8.3.5 / 24.x |

Plus the AD-5 amendment from F-1.
