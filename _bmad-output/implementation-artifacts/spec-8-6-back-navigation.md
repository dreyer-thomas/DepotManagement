---
title: 'Story 8.6: Back Navigation'
type: 'feature'
created: '2026-10-28'
status: 'awaiting-operator'
baseline_revision: '52bf70207dfc7e2a30950d89aaf5f4b82bb84cf3'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Real-runtime behavior of the back link (Next.js 16 router interplay, scroll restoration, installed iOS app, swipe gesture) is verified only by argument and happy-dom tests, not in a real browser or device.
    evidence: |-
      Intent-alignment audit: tests exercise the pure resolver and a happy-dom render with a simulated Next-like history patch; no test drives the real App Router. Settled by the operator device check listed under operator_actions.
    location: >-
      src/app/_components/back-navigation/history-tracker.ts
    severity: medium (unverified)
operator_actions:
  - "On the iPhone home-screen app, open a Depot, then a Security, switch the Depot switcher and Period, tap '‹ <Depot>' and confirm it returns to the Depot with its tab and scroll position kept."
  - "On the iPhone, open a Security from a watchlist, use the iOS swipe-back and swipe-forward gestures, and confirm the back link still reads '‹ <watchlist name>'."
  - "In a desktop browser, reload a Security detail page reached from a Depot and confirm the label still names the Depot; open the same Security URL in a new tab and confirm it shows '‹ Wertpapiere' linking to the Securities page."
---

<intent-contract>

## Intent

**Problem:** Sub-pages (Security detail, Depot detail, reconciliation, import batch, Parqet migration) are dead ends: there is no back link, which hurts most in the installed home-screen app without a browser back button.

**Approach:** One client `BackLink` component, placed left of each sub-page title, shows "‹ <label>" naming the previous *different* page of this browser tab and returns there with real history traversal (`history.go(-n)`); without an in-app origin it is a plain link to the logical parent. Origin tracking lives per tab in `history.state` + `sessionStorage`; one pure function resolves target and label.

## Boundaries & Constraints

**Always:**
- Per-tab only: entry id in `history.state.__dmNav`, entry records in `sessionStorage` (wrapped in try/catch; failure = fallback). No server state, no URL parameter.
- History tracking: wrap `window.history.pushState` (new entry id, `prev` = current id) and `replaceState` (keeps the current id when the data has none) once per document, never uninstalled; it must coexist with Next.js 16's own patch (`node_modules/next/dist/client/components/app-router.js:274-325`) in either install order and must preserve `__NA`/`__PRIVATE_NEXTJS_INTERNALS_TREE`.
- Origin = walk `prev` from the current entry, skipping entries with the same pathname as the current page; steps = hops walked. Same pathname with other query (tab, `?depot=`, `?list=`) is an in-page change, never the target.
- Origin label: a label registered by that page (Depot name, Security name, selected watchlist name, sub-page title) else the nav label of the pathname (`Übersicht`, `Depots`, `Analysen`, `Import`, `Nachrichten`, `Wertpapiere`, `Watchlists`, `Einstellungen`, `Mehr`, prefix match for deeper unknown paths).
- Fallback parents: Security detail → `/securities` "Wertpapiere"; Depot detail → `/depots` "Depots"; reconciliation → `/depots/<id>` Depot name; import batch → `/import` "Import"; Parqet migration → `/settings` "Einstellungen".
- SSR and first client render show the fallback (no hydration mismatch); the resolved origin replaces it after mount. `href` of the anchor is always the target URL (origin path or parent), so keyboard, middle-click and no-JS work; a plain left click on a history target calls `history.go(-steps)` instead.
- Visual: "‹ " + label, label truncated with ellipsis (max width), `aria-label` "Zurück zu <label>", min touch target 44 px, keyboard-operable, fits phone and desktop width. German UI text.

**Never:** No back link on top-level pages (Übersicht, Depots, Analysen, Nachrichten, Import, Wertpapiere, Watchlists, Einstellungen, Mehr). No breadcrumbs. No change to reconciliation/import/watchlist behavior beyond the header. No `src/core` changes (UI concern, kept in `src/app/_components/back-navigation/`). No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Origin | Depots → Depot "Comdirect" → Security X | On X: "‹ Comdirect", click = `history.go(-1)` | — |
| In-page changes | Watchlist "Ideen" → X, then `?depot=a`, `?depot=b` | "‹ Ideen", click = `history.go(-3)` | — |
| No origin | X opened directly / new tab / bookmark | "‹ Wertpapiere" → `/securities` link | — |
| Reload | reload X after arriving from Depot | still "‹ Comdirect" (state + sessionStorage survive) | — |
| Back/forward | Depot → X → back → forward | on X again "‹ Comdirect" | — |
| Replace | entry replaced (router.replace / refresh) | keeps id; no extra hop counted | — |
| Storage broken | sessionStorage throws / entry missing in chain | fallback parent | swallow, fallback |
| Security → Security | X opened from Security Y | "‹ <Y name>" | — |

</intent-contract>

## Code Map

- `src/app/_components/navigation.ts` -- `drawerItems`, `moreItems`, `isActive(href, pathname)`: source of top-level labels and prefix matching. Reuse; do not duplicate labels.
- `src/app/_components/AppShell.tsx` -- client shell around every `(app)` page; mount the history tracker here (inside a `Suspense` if `useSearchParams` is used).
- `src/app/(app)/securities/[id]/page.tsx` -- header `Stack` (logo + h1 `security.name`); BackLink before logo, self label `security.name`, parent `/securities`.
- `src/app/(app)/depots/[id]/page.tsx` -- header `Stack` with h1 `depot.name` + `DepotActionsMenu`; BackLink first, self label `depot.name`, parent `/depots`.
- `src/app/(app)/depots/[id]/reconcile/page.tsx` -- currently `AppLink "← {depot.name}"` above h1 "Depot abgleichen"; replace with BackLink (parent `/depots/<id>` label depot name, self "Depot abgleichen").
- `src/app/(app)/import/[batchId]/page.tsx` + `src/app/_components/import/ImportBatchView.tsx:14` -- h1 "Import prüfen"; add BackLink (parent `/import`, self "Import prüfen").
- `src/app/(app)/settings/parqet/page.tsx` -- `PageTitle` "Aus Parqet übernehmen"; add BackLink (parent `/settings`, self title).
- `src/app/(app)/watchlists/page.tsx` -- register selected watchlist's name as this page's label (no back link).
- `src/app/_components/Placeholder.tsx` -- `PageTitle` (h1 `pageTitle`, mb 2).
- `src/app/_components/depots/DepotLink.tsx` -- `AppLink` MUI+NextLink pattern for server components.
- Existing pushes that become history entries: `WatchlistTable.tsx:323` (`router.push(securityHref)`), `WatchlistTabs.tsx:51`, `NewsFilter.tsx:23`, `ReconciliationView.tsx:92`, `AnalysisFilters.tsx:26` (replace).
- Tests: DOM tests use `// @vitest-environment happy-dom`, `registerDomCleanup()` from `test/helpers/dom`, `vi.mock("next/navigation", ...)` (see `WatchlistTabs.dom.test.tsx`); pure tests next to source as `*.test.ts`.

## Tasks & Acceptance

**Execution:**
- `src/app/_components/back-navigation/back-target.ts` -- pure functions: `defaultPageLabel(pathname)`, `recordEntry(store, id, {path, pathname, label?})` (keep a registered label when pathname unchanged, reset on pathname change), `annotatePush/annotateReplace` helpers for state data, and `resolveBack(store, currentId, currentPathname, fallback)` → `{kind:"history", steps, href, label} | {kind:"link", href, label}` -- the single tested resolver.
- `src/app/_components/back-navigation/back-target.test.ts` -- unit tests for every I/O matrix row: origin vs fallback, in-page changes, replace, reload (same store/id), back/forward (current id moves within the chain), missing/cyclic chain, label precedence.
- `src/app/_components/back-navigation/history-tracker.ts` -- client-only side-effect module: install the history wrappers once, read/write the sessionStorage store safely, `ensureCurrentEntry()`, `registerPageLabel(label)`, subscribe for updates.
- `src/app/_components/back-navigation/HistoryTracker.tsx` -- client component in AppShell recording each pathname+search change into the store.
- `src/app/_components/back-navigation/BackLink.tsx` -- client component `{ parent: {href, label}, self?: string }`: registers self label, renders fallback on SSR, resolved target after mount; click handler for history targets; styling per constraints. Also export `PageLabel({label})` for origin-only pages.
- `src/app/_components/back-navigation/BackLink.dom.test.tsx` -- fallback rendering, aria-label, history click calls `history.go(-n)`, link target without origin.
- The five sub-page files + `ImportBatchView.tsx` + `watchlists/page.tsx` -- wire in per Code Map; keep layouts wrapping on phones.
- `src/app/_components/AppShell.tsx` -- mount `HistoryTracker`.

**Acceptance Criteria:**
- Given any of the five sub-pages opened from another app page, when it renders, then left of its title a "‹ <origin label>" link appears with `aria-label` "Zurück zu <label>" and activating it returns to that page's exact URL with scroll and Period/chart choices kept.
- Given a top-level page, when it renders, then no back link is shown.
- Given the app, when `npm run lint && npm run typecheck && npm test && npm run build` runs, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 21 findings — high 0, medium 5, low 10, false 5, maybe-false 1
- findings:
  - `[low]` `[reject]` Login/OAuth pages reached by a soft redirect (session expiry) become back-link origins — only on mid-session expiry, rare; guard would add an app-path filter branch.
  - `[low]` `[reject]` Unknown origin label yields "Zurück zu Zurück" — only reachable for /login and /oauth origins (every app path matches a nav prefix), same rare case as above.
  - `[false]` `[reject]` Finishing a reconciliation makes the Depot's back link point to the finished run — the story defines the target as the page I came from, "as the browser back button would"; the reconcile page then shows its normal start state, nothing broken.
  - `[medium]` `[patch]` No test of coexistence with a Next.js-style history patch — added DOM test pushing `__NA`/tree through a Next-like wrapper installed on top; asserts internals kept, new id, prev link.
  - `[low]` `[patch]` Modifier/middle-click guard untested — added DOM test (ctrl, meta, button 1 do not call history.go).
  - `[medium]` `[patch]` No page-level test of the back link on sub-pages — added fallback-anchor assertions (aria-label + href) to Depot, Security, import batch and Parqet page tests.
  - `[low]` `[patch]` Depot header spacing 0.5 crowds "‹ Depots" against the title — inner Stack spacing set to 1.
  - `[low]` `[patch]` Fallback label flashes on client navigation — target now resolved in useLayoutEffect.
  - `[low]` `[patch]` Store eviction by first-insertion order can drop a live origin — recordEntry re-inserts updated ids; test added.
  - `[false]` `[reject]` Stored labels go stale after a rename — a rename refreshes the page, the `self`/`PageLabel` effect depends on the label and re-registers it.
  - `[false]` `[reject]` HistoryTracker comment overclaims — the comment says the wrappers record pushes/replaces, which is what happens.
  - `[low]` `[patch]` `title` tooltip differs from accessible name — title now "Zurück zu <label>".
  - `[false]` `[reject]` (edge) Reconciliation finish target — same refutation as above.
  - `[low]` `[reject]` (edge) Origin outside the app shell (/login, /oauth) — same rare case as above.
  - `[low]` `[reject]` (edge) "Zurück zu Zurück" accessible name — same rare case as above.
  - `[low]` `[reject]` (edge) HMR re-evaluation leaves old listener set — dev-only, never met by users; fix adds a window global.
  - `[false]` `[reject]` (edge) Popstate to an id-less same-pathname entry — the app has no hash links, and the only pre-install entry (initial load) gets an id from ensureCurrentEntry.
  - `[medium]` `[patch]` (verification-gap) Back-link wiring on four sub-pages untested — same patch as the page-level assertions above.
  - `[medium]` `[patch]` (verification-gap) Removing HistoryTracker from AppShell fails no test — added DOM test: unlabeled "/" origin recorded by HistoryTracker yields "Zurück zu Übersicht".
  - `[medium]` `[patch]` (verification-gap) popstate and replaceState wrapper untested through the tracker — added DOM tests (popstate lowers steps from -2 to -1; id-less replace keeps id, adds no hop).
  - `[maybe-false]` `[defer]` (intent-alignment) Real browser/device behavior (Next router, scroll, iOS swipe, installed app) unverified — would be medium if wrong; settled by the operator device checks.

## Design Notes

Why wrap `pushState`/`replaceState` instead of reading `history.length`: replace vs push cannot be told apart reliably otherwise, and a replaced entry must not count as a hop. Next.js writes navigation state through `window.history.*` (its `HistoryUpdater` runs in `useInsertionEffect`, before our effects), so our wrapper sees every push/replace whichever patch is outermost; Next's refresh/server-action writes spread the existing state (`preserveCustomHistoryState`), so the id survives.

Store shape (sessionStorage key `dm.backNav`): `{ entries: { [id]: { prev: string|null, path: string, pathname: string, label: string|null } } }`; cap the entry count (drop oldest, e.g. > 200) so storage stays small.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.

**Manual checks (if no CLI):**
- `npm run dev`: Depot → Security → switch Depot/Period/chart mode → "‹ <Depot>" returns to the Depot tab and scroll; reload Security keeps label; open Security URL in new tab shows "‹ Wertpapiere".

## Auto Run Result

Status: awaiting-operator

**Summary.** Sub-pages (Security detail, Depot detail, reconciliation, import batch, Parqet migration) now show a "‹ <origin>" back link left of the title. It returns to the previous different page of this tab by `history.go(-n)` (in-page query changes skipped), else links to the logical parent. Origins are tracked per tab via an id in `history.state.__dmNav` and a sessionStorage store (`dm.backNav`), maintained by wrappers around `history.pushState`/`replaceState`; one pure resolver (`resolveBack`) decides target and label.

**Files changed.**
- `src/app/_components/back-navigation/back-target.ts` — pure store/label/resolver functions.
- `src/app/_components/back-navigation/history-tracker.ts` — history wrappers, sessionStorage store, subscriptions.
- `src/app/_components/back-navigation/HistoryTracker.tsx` — mounted in AppShell, stamps every page's entry.
- `src/app/_components/back-navigation/BackLink.tsx` — BackLink and PageLabel components.
- `src/app/_components/back-navigation/*.test.ts(x)` — pure and DOM tests.
- `src/app/_components/AppShell.tsx` — mounts HistoryTracker.
- `src/app/(app)/securities/[id]/page.tsx`, `depots/[id]/page.tsx`, `depots/[id]/reconcile/page.tsx`, `settings/parqet/page.tsx`, `src/app/_components/import/ImportBatchView.tsx` — BackLink in the header.
- `src/app/(app)/watchlists/page.tsx` — registers the selected watchlist name as origin label.
- Page tests for Depot, Security, import batch, Parqet — fallback back-link assertions.

**Review.** 21 findings: 10 patched rows (medium 5, low 5), 1 deferred (maybe-false, real-runtime verification), 10 rejected (5 false, 5 low rare-case) with reasons in the triage log.

**Follow-up review recommended: true** — patched counts: high 0, medium 5, low 5. Named unverified risk: the interplay of the history wrappers with the real Next.js 16 App Router (push/replace/traverse in a real browser) has not been exercised outside happy-dom.

**Verification.** `npm run lint && npm run typecheck && npm test && npm run build` — all green (253 files, 3424 tests). No run in a real browser or device.

**Residual risks.** Real-runtime behavior unverified (see deferred item); login/OAuth soft-redirect origins and dev-only HMR listener loss accepted as rare.

**Operator actions owed.** See `operator_actions` in frontmatter: device check on the installed iPhone app (back link, swipe gesture) and a desktop reload/new-tab check.
