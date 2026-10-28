---
title: 'Story 8.1: Home-Screen App'
type: 'feature'
created: '2026-10-27'
status: done
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
deferred: []
operator_actions:
  - 'Deploy this commit to the HTTPS production host (scripts/deploy.sh) so the manifest and icons are served over HTTPS.'
  - 'On an iPhone in Safari, open the HTTPS app, choose Teilen › Zum Home-Bildschirm, start it from the home screen and confirm it opens full-screen with the Depot icon, asks for a login once and shows the app colours in the status bar in both light and dark mode.'
  - 'On an Android phone in Chrome, open the HTTPS app, choose App installieren, start it and confirm it opens full-screen with the icon (maskable, not cropped) and the app colours in the status bar in both light and dark mode.'
baseline_revision: '52e27a0a87502f61fbd8013daf6921912ecd4861'
---

<intent-contract>

## Intent

**Problem:** On a phone DepotManagement is only a browser tab; it cannot be added to the home screen as a full-screen app with the app's colours.

**Approach:** Add a Next.js web app manifest (`src/app/manifest.ts`), static PNG icons, `appleWebApp` metadata and light/dark `theme-color`, and let the auth proxy pass exactly the manifest and icon paths without a session. No service worker.

## Boundaries & Constraints

**Always:** Manifest: name "DepotManagement", short_name "Depot", `display: "standalone"`, `start_url: "/"`, `lang: "de"`, colours read from `src/theme/tokens.ts` (`background_color` = `background`, `theme_color` = `surface`, the AppBar colour). Icons: 192×192 and 512×512 (`purpose: "any"`), 512×512 maskable (glyph inside the central 80 % safe zone, full-bleed background), apple-touch-icon 180×180 (opaque, full-bleed); all under `/icons/`. Status bar: `viewport.themeColor` with `(prefers-color-scheme: light)` → `surface` and `(prefers-color-scheme: dark)` → `surface-dark`; `metadata.appleWebApp` = `{ capable: true, title: "Depot", statusBarStyle: "default" }`. The proxy matcher excludes exactly `/manifest.webmanifest` and the four icon file paths (exact names, no `/icons/` wildcard); every other route stays guarded (AD-13). Icons are generated reproducibly by a committed script from an inline SVG and the PNG output is committed.

**Never:** No service worker, offline cache, `next-pwa` or any new npm dependency. No change to login/session logic. No colour literals that bypass `tokens.ts`. No install prompt UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manifest anonymous | GET `/manifest.webmanifest`, no cookie | Proxy does not run; manifest JSON served | — |
| Icon anonymous | GET `/icons/icon-192.png` (and the other three), no cookie | Proxy does not run; PNG served | — |
| Other icon path | GET `/icons/other.png` or `/icons/` | Proxy runs → redirect to `/login` | — |
| Lookalikes | `/manifest.json`, `/manifest.webmanifest.bak`, `/icons/icon-192.png.bak` | Proxy runs (guarded) | — |
| Pages/API | `/`, `/depots`, `/api/x` without session | Unchanged: redirect / 401 | — |

</intent-contract>

## Code Map

- `src/proxy.ts:50-52` -- `config.matcher` negative-lookahead regex; currently excludes `login`, `_next/static`, `_next/image`, `favicon.ico`. Extend the lookahead with the manifest and four icon paths.
- `src/proxy.test.ts:110-129` -- `unstable_doesMiddlewareMatch` `it.each` tables for public vs guarded paths; extend both.
- `src/app/layout.tsx:18-27` -- root `metadata` and `viewport`; the manifest link is added automatically via `app/manifest.ts`; add `icons` (`icon` → `/icons/icon-192.png`, `apple` → `/icons/apple-touch-icon.png`), `appleWebApp`, and `viewport.themeColor`. Root layout covers the login page too.
- `src/theme/tokens.ts` -- `colors.background`, `colors.surface`, `colors["surface-dark"]`: single source for manifest/theme colours (synced to DESIGN.md by `src/theme/theme.test.ts`).
- `src/app/_components/AppShell.tsx:67-72` -- AppBar uses `background.paper` (= `surface` token), hence status-bar colour = surface.
- `node_modules/sharp` -- present as Next's optional dependency; use only in the one-off icon generator script, never at runtime.
- `README.md:77-100` -- "Login" section; add the home-screen note here.
- No `public/` directory exists yet; Next serves `public/icons/*` at `/icons/*`.

## Tasks & Acceptance

**Execution:**
- `scripts/generate-icons.mjs` -- New. Builds the icon SVG inline (primary `#0FA68A` from `src/theme/tokens.ts` is not importable from .mjs without TS, so read the hex via regex from `tokens.ts`), renders with `sharp` to `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180). Glyph: simple white rising line/chart mark; maskable/apple are full-bleed squares, `any` icons rounded. -- reproducible icons without binary design tooling.
- `public/icons/*.png` -- Generated output, committed.
- `src/app/manifest.ts` -- New `MetadataRoute.Manifest` default export per Always rules, icons list with `sizes`, `type: "image/png"`, `purpose`. -- installability.
- `src/app/manifest.test.ts` -- New. Asserts manifest fields, colours equal the tokens, every icon `src` maps to an existing file under `public/` whose PNG IHDR width/height equals `sizes`, apple-touch-icon is 180×180, and that the exported icon paths equal the proxy's public icon list (single source: export the path list from one module, e.g. `src/app/app-icons.ts`, used by manifest, layout and a test against the proxy matcher). -- AC coverage.
- `src/app/app-icons.ts` -- New. Exports the four icon paths/sizes/purposes. Must not be imported by `proxy.ts` matcher (matcher must stay a static literal for Next); the test cross-checks instead.
- `src/proxy.ts` -- Extend matcher lookahead with `manifest\.webmanifest$` and `icons/(?:icon-192|icon-512|icon-maskable-512|apple-touch-icon)\.png$`.
- `src/proxy.test.ts` -- Add the I/O matrix paths to the public/guarded tables.
- `src/app/layout.tsx` -- Add `icons`, `appleWebApp`, `viewport.themeColor` from tokens.
- `README.md` -- In "Login": the app can be added to the home screen ("Zum Home-Bildschirm" in iOS Safari, "App installieren" in Android Chrome, HTTPS required); on iOS the installed app keeps its own login, so sign in once there; no offline mode.

**Acceptance Criteria:**
- Given the built app, when `/manifest.webmanifest` is requested, then it contains name, short_name, `standalone`, start_url `/`, token colours and the four icons.
- Given the root layout, when any page (incl. `/login`) renders, then the HTML head carries the manifest link, apple-touch-icon link, `apple-mobile-web-app-capable` and two `theme-color` metas with light/dark media.
- Given the repo, when searching for a service worker registration, then none exists.
- Given an iPhone/Android phone and the HTTPS deployment, when the operator adds the app to the home screen, then it opens full-screen with the app colours in the status bar (operator verification).

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 19 findings — high 0, medium 0, low 13, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: `sharp` used by the icon script but not declared in package.json — the script header names it as Next's optional dependency; it is a one-off generator, never runtime, and a missing module fails loudly; declaring a new dependency is forbidden by the spec.
  - `[low]` `[patch]` Blind: committed icons can drift from `colors.primary` without a failing test — added a test that inflates the maskable icon's IDAT with `node:zlib` and asserts pixel 0 equals `colors.primary`.
  - `[low]` `[patch]` Blind: opacity of full-bleed icons untested — added IHDR colour-type assertion (2 = RGB) for maskable and apple-touch icons.
  - `[false]` `[reject]` Blind: no-service-worker test scans only `src/` — a worker in `public/` does nothing without a `navigator.serviceWorker.register` call, which would live in `src/`.
  - `[false]` `[reject]` Blind: manifest lacks `id`/`scope` — both default to `/` from `start_url: "/"`, identical to what explicit values would give; no present harm.
  - `[low]` `[reject]` Blind: sharp `density` and SVG `width` scale twice — renders are always oversampled (≥1.8×) before resize, output inspected and correct; no visible harm.
  - `[low]` `[patch]` Blind: glyph-bounds comment in the icon script is wrong — comment corrected (x≈16..87, y≈23..84.5; ≈35 units from centre at scale 0.75 inside the 40-unit safe zone).
  - `[low]` `[reject]` Blind: layout icon metadata test uses `toMatchObject` and `icons.apple` lacks `type` — test-strength nit; `type` is optional for apple-touch links; no defect.
  - `[low]` `[reject]` Blind: name/description strings duplicated between manifest and layout — would need a new shared module; drift between tab title and app name is cosmetic and unlikely.
  - `[low]` `[reject]` Blind: manifest `background_color` is light in dark mode (splash) — a manifest cannot vary by scheme; platform limitation, README only claims the status bar follows the mode.
  - `[low]` `[reject]` Blind: fragile matcher-parsing regex and hard-coded length 4 in test — a changed matcher fails the `toEqual` loudly; acceptable.
  - `[false]` `[reject]` Blind: no test that `/login` stays inside the app scope — scope defaults to `/`, all routes incl. `/login` are same-origin under it; the claim depends on hypothetical future changes.
  - `[low]` `[reject]` Edge: Android splash/title bar light in dark mode — same platform limitation as above; no fix available in a static manifest.
  - `[low]` `[reject]` Edge: missing sharp crashes with raw ERR_MODULE_NOT_FOUND — the error names `sharp`; adding a guard for a one-off dev script is not worth the complexity.
  - `[low]` `[reject]` Edge: spec AC says the manifest holds "the four icons" but it lists three — apple-touch-icon belongs in the head link (done), matching the story AC; fixing would edit this build's spec.
  - `[low]` `[patch]` Edge: glyph colour `#FFFFFF` literal bypasses tokens.ts — script now reads `surface` from tokens.ts; regenerated PNGs byte-identical.
  - `[low]` `[patch]` VG: opacity of full-bleed icons not verified — same root cause and fix as the Blind opacity row (IHDR colour-type test).
  - `[low]` `[patch]` VG: icon colour can drift from `colors.primary` — same root cause and fix as the Blind drift row (first-pixel test).
  - `[false]` `[reject]` Intent: spec not at awaiting-operator / no operator_actions — mid-pipeline snapshot; finalization sets `status: awaiting-operator` with the on-device checks as operator actions. Device-level surface (HTTPS install, status bar rendering) is only verifiable by a human, hence those actions.

## Design Notes

`theme-color` media queries follow the OS scheme; a manual "Hell/Dunkel" override in the app does not recolour the status bar. Accepted: the AC asks for light and dark mode, which the system scheme covers. Next adds `<link rel="manifest">` automatically when `app/manifest.ts` exists and serves it at `/manifest.webmanifest`.

## Verification

**Commands:**
- `node scripts/generate-icons.mjs` -- expected: writes the four PNGs, reruns produce identical files.
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.
- `npm run build && npm start` then `curl -sI localhost:3000/manifest.webmanifest` and `/icons/icon-192.png` without cookie -- expected: 200; `curl -sI localhost:3000/` -- expected: 307 to `/login`.

**Manual checks (if no CLI):**
- On-device install on iOS Safari and Android Chrome over HTTPS (operator).

## Auto Run Result

Status: awaiting-operator

**Summary:** DepotManagement is installable as a home-screen app: Next web app manifest (`/manifest.webmanifest`), four generated PNG icons, `appleWebApp` metadata, light/dark `theme-color` in the AppBar colour, and the auth proxy lets exactly the manifest and the four icon files through without a session. No service worker.

**Files changed:**
- `src/app/manifest.ts` -- new manifest (name, short_name "Depot", standalone, start_url `/`, token colours, 192/512/maskable icons).
- `src/app/app-icons.ts` -- single source for icon paths/sizes/purposes.
- `src/app/layout.tsx` -- icon + apple-touch links, `appleWebApp`, explicit `apple-mobile-web-app-capable`, light/dark `themeColor`.
- `src/proxy.ts` -- matcher excludes `manifest.webmanifest` and the four exact icon paths.
- `src/proxy.test.ts` -- public/guarded matcher cases incl. lookalikes.
- `src/app/manifest.test.ts` -- manifest content, icon sizes/opacity/colour, layout head metadata, proxy icon list cross-check, no service worker.
- `scripts/generate-icons.mjs` -- reproducible icon generator (sharp, colours from tokens.ts).
- `public/icons/*.png` -- generated icons.
- `README.md` -- "Home-screen app" section (install actions, HTTPS, own iOS login, no offline mode, regenerating icons).

**Review findings:** 19 findings (0 high, 0 medium, 13 low, 6 false). Patched 6 rows (4 root causes, all low): icon opacity test, icon colour-drift test, glyph colour from tokens, corrected safe-zone comment. Deferred: none. Rejected: see Review Triage Log (sharp undeclared, density double scaling, layout test strength, duplicated strings, dark splash platform limit ×2, fragile test regex, missing-sharp error, spec AC wording; false: SW scan scope, manifest id/scope, login scope, awaiting-operator snapshot).

**Follow-up review recommended:** false — patched counts: high 0, medium 0, low 4 entries.

**Verification:** `node scripts/generate-icons.mjs` twice → byte-identical PNGs; `npm run lint`, `npm run typecheck` clean; `npm test` 211 files / 2895 tests passed; `npm run build` succeeded. Implementation agent ran `npm start` on a temp DB: manifest and icons 200 without cookie, `/icons/other.png`, `/manifest.json`, `/` → 307 to `/login`, `/api/x` → 401; `/login` head carries manifest, icon, apple-touch-icon, apple capable and both theme-color metas.

**Residual risks:** Status bar colour follows the OS scheme, not the in-app Hell/Dunkel override; Android splash uses the light background in dark mode (manifest limitation); iOS rendering of `theme-color` with `statusBarStyle: "default"` is unverified until checked on a device.

**Operator actions owed:** see `operator_actions` in frontmatter.

## Operator Confirmation

Confirmed 2026-10-28: the external actions this story owed were carried out.

- Deploy this commit to the HTTPS production host (scripts/deploy.sh) so the manifest and icons are served over HTTPS.
- On an iPhone in Safari, open the HTTPS app, choose Teilen › Zum Home-Bildschirm, start it from the home screen and confirm it opens full-screen with the Depot icon, asks for a login once and shows the app colours in the status bar in both light and dark mode.
- On an Android phone in Chrome, open the HTTPS app, choose App installieren, start it and confirm it opens full-screen with the icon (maskable, not cropped) and the app colours in the status bar in both light and dark mode.

_Appended by the bmad-loop orchestrator (`bmad-loop confirm`, #335): a human confirmed these external actions out of band, and the story was advanced from `awaiting-operator` to `done`._
