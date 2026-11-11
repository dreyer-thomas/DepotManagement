---
title: 'Price Marks for Claude'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_revision: 'a98432ba8b5482c72af12d992cef24c9c2ec8fd0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-4-warnings-for-crossed-marks.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Claude cannot see Tommy's stop and target prices (12.2–12.4) and cannot move targets it finds in watchlist notes into marks.

**Approach:** `get_security` and `get_watchlist` gain an additive `price_marks` object per Security, built from `priceMarksView` (i.e. `core/price-marks` `priceMarkState`); a new tool `set_price_marks` (scope `watchlist`) calls the marks service `setPriceMarks` with the same validation as the app and returns the new `price_marks`.

## Boundaries & Constraints

**Always:**
- Every figure comes from `priceMarksView` (`PriceMarksViewItem`: `marks` + `state`); the MCP layer only renames to snake_case — no comparison or arithmetic (AD-22, AD-24). Decimals as strings, dates `YYYY-MM-DD`.
- `price_marks` shape (always present, also without marks): `{ basis: "latest close", price, price_date, stop, target, breached }` — `price`/`price_date` = `state.price`/`state.priceDate`; `breached` = `state.breached` (`stop` | `target` | `none`).
  - `stop`: `null` or `{ type: "FIXED" | "TRAILING", price (FIXED: `marks.stop.value`, else null), percent (TRAILING: `marks.stop.value`, else null), effective, high, distance, source, set_date }` (effective/high/distance from `state.stop`).
  - `target`: `null` or `{ price: marks.target.price, effective: state.target.price, distance, source, set_date }`.
- `get_security`: `price_marks` from `priceMarksView([security.id], today)` (the requested Security; the view maps it to the ISIN successor). `get_watchlist`: per entry from one `priceMarksView(entrySecurityIds, today)` call; only `get_watchlist` entries carry it — not `add_watchlist_entry`/`update_watchlist_entry` results.
- `set_price_marks` input: `security_id` (string), optional `stop` (`null` clears; object `{ type: string, price?: string, percent?: string, source?: string, set_date?: string }`), optional `target` (`null` clears; `{ price: string, source?, set_date? }`). Omitted `stop`/`target` stay; a given mark replaces that mark whole (absent source → none, absent set_date → today). Mapping to `StopInput`: `value` = `percent` when `type === "TRAILING"`, else `price`. Strings are passed unvalidated to `setPriceMarks` (core validates: plain decimal with dot, > 0, trailing 1–50, source ≤ 200, date ≤ today).
- Result: `{ security_id, name, price_marks }` for the Security the marks belong to now (`result.marks.securityId`, or the requested id after clearing), re-read via `priceMarksView`.
- Refusals: `not-found` → `security-not-found`; `price-marks-invalid` → `{ error: "price-marks-invalid", field, problem, message }`, `field` as input path (`stop.type`, `stop.price` / `stop.percent` (per given type), `stop.source`, `stop.set_date`, `target.price`, `target.source`, `target.set_date`), German `message` per problem. Nothing written on a refusal.
- After a successful write: new context callback `onPriceMarksChange()`; the route revalidates `/`, `/securities`, `/securities/[id]` (page), `/watchlists` (same as `revalidatePriceMarks` in `src/app/_actions/price-marks.ts`).
- Descriptions of `get_security`, `get_watchlist` and `set_price_marks` include one shared `PRICE_MARKS_DESCRIPTION`: marks are Tommy's own reference levels, not recommendations; checked against the latest close (latest resolved Price, not intraday); `breached` stop when price ≤ effective stop, target when price ≥ target; FIXED price/target as set vs effective in today's units after splits; trailing effective = highest close since set date × (1 − percent/100), never falls; distances = mark ÷ price − 1 as ratio. Server `INSTRUCTIONS` gain one sentence on `set_price_marks`.
- Payload values never logged; failures via `guarded`.

**Never:** No breach logic or arithmetic in `src/modules/mcp`; no direct `priceMark` Prisma access outside the marks module; no German-format decimals over MCP; no schema change; no change to `core/price-marks` or the marks service semantics; no new provider calls; no UI change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Read, FIXED stop breached | stop FIXED 150, latest 140 | `stop.type` FIXED, `price` "150", `percent` null, `effective` "150", `breached` "stop" | — |
| Read, no marks | — | `stop` null, `target` null, `breached` "none", `price` latest | — |
| Set trailing + target | `stop {type TRAILING, percent "10"}`, `target {price "300", source "Zeitung"}` | stored; result `percent` "10", set_date today | — |
| Omitted field | existing target, call with `stop` only | target unchanged | — |
| Clear | `stop: null, target: null` | row gone; `price_marks.stop`/`target` null | — |
| Invalid | trailing `percent "60"` / `price "92,40"` / future `set_date` / source 201 chars / `type "fixed"` | refusal with field/problem | nothing written |
| Unknown Security | `security_id "x"` | `security-not-found` | nothing written |
| No `watchlist` scope | grant `["portfolio:read"]` only | `set_price_marks` and `get_watchlist` not listed | call fails, nothing written |

</intent-contract>

## Code Map

- `src/modules/mcp/tools.ts` -- `WATCHLIST_TOOL_NAMES` (l.35, add `set_price_marks`), `McpToolContext` (l.49, add `onPriceMarksChange`), `MESSAGES`/`refusal`/`result`/`guarded`, `entryPayload` (l.~290; add optional marks param like `keyFigures`), `get_watchlist` handler (l.~395), `registerWatchlistTools` (scope gate l.~385).
- `src/modules/mcp/portfolio-tools.ts` -- `get_security` (l.432–496): add `priceMarksView` to the `Promise.all`, `price_marks` field, description.
- `src/modules/mcp/http.ts` -- `McpHttpDeps` (l.13, optional `onPriceMarksChange`), ctx build (l.~162, default noop).
- `src/modules/mcp/server.ts` -- `INSTRUCTIONS`.
- `src/app/api/mcp/route.ts` -- pass `onPriceMarksChange` revalidating the four paths.
- `src/modules/marks/index.ts` -- `priceMarksView`, `setPriceMarks`, types `PriceMarksViewItem`, `PriceMarkField`, `PriceMarkProblem`, `PriceMarksInvalid` (read-only reuse).
- `src/core/price-marks.ts` -- `PriceMarkState` (l.~208), `checkPriceMarksPatch` problems; `PRICE_MARK_SOURCE_MAX_LENGTH`, `TRAILING_STOP_MIN/MAX_PERCENT` for messages (read-only).
- Tests: `src/modules/mcp/portfolio-tools.test.ts` (in-memory client with scopes, `seed`, `context()` l.~115 needs `onPriceMarksChange`, `call`, `refused`), `src/modules/mcp/http.test.ts` (tool list l.363: 18 → 19, `writeTools` + `set_price_marks`; `deps()`), `src/modules/marks/marks.test.ts` (setup helpers to mirror).

## Tasks & Acceptance

**Execution:**
- `src/modules/mcp/price-marks.ts` (+ `price-marks.test.ts`) -- new pure helpers: `priceMarksPayload(item: PriceMarksViewItem)`, `PRICE_MARKS_DESCRIPTION`, `priceMarksPatchOf(args)` (input → `PriceMarksPatch`), `priceMarksRefusal(invalid, stopType)` (field path + German message); unit tests for FIXED/TRAILING/target/none payloads, patch mapping (omitted/null/set, TRAILING uses `percent`), field paths and messages per problem.
- `src/modules/mcp/tools.ts` -- context callback, tool name, `get_watchlist` `price_marks`, `set_price_marks` registration (description + input schema + handler: map, call `setPriceMarks`, refusal, `onPriceMarksChange`, re-read view, name via `getSecurity`).
- `src/modules/mcp/portfolio-tools.ts` -- `get_security` `price_marks` + description.
- `src/modules/mcp/http.ts`, `src/modules/mcp/server.ts`, `src/app/api/mcp/route.ts` -- wiring, instructions, revalidation.
- `src/modules/mcp/portfolio-tools.test.ts` -- describe "price marks (story 12.5)": `get_security` and `get_watchlist` payloads equal the mapping of `priceMarksView` (breached stop, reached target, trailing, none) and agree with each other; set (callback fired, `getPriceMarks` stored), omitted stays, clear, each validation refusal of the matrix with nothing written, unknown Security, scope check (grant `["portfolio:read"]` lacks the tool), descriptions contain `PRICE_MARKS_DESCRIPTION`.
- `src/modules/mcp/http.test.ts` -- tool list counts and write-tool set.

**Acceptance Criteria:**
- Given a connected Claude, when it calls `get_security` (portfolio:read) or `get_watchlist` (watchlist), then each Security carries `price_marks` with stop (type, price or percent, effective), target, sources, set dates, distances and `breached` from `priceMarksView`, decimals as strings, equal for the same Security in both tools.
- Given the `watchlist` scope, when Claude calls `set_price_marks`, then stop/target are set or cleared through `setPriceMarks` with the app's validation, omitted fields stay, and the app's pages are revalidated.
- Given the tool listing, when Claude reads the descriptions, then they state that marks are Tommy's own reference levels, not recommendations, checked against the latest close.

## Spec Change Log

## Review Triage Log

### 2026-11-11 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 16, false 7, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) `stop.type` / `target.price` required in the zod schema, so a missing one gets the SDK schema error instead of the app-style `price-marks-invalid` refusal — made both optional (schema and `StopArg`/`TargetArg`); added refusal cases `stop.type`/`invalid` and `target.price`/`required`.
  - `[false]` `[reject]` (blind) Annotations hide that clearing deletes data — per the MCP spec `destructiveHint` defaults to true for a non-read-only tool, so clients already treat it as possibly destructive.
  - `[low]` `[reject]` (blind) A call with neither stop nor target still upserts the row and revalidates — harmless (same values, `updatedAt` only orders predecessor rows); fix adds a branch for an unlikely call.
  - `[low]` `[reject]` (blind) Clearing through an ISIN-change predecessor id returns the predecessor's id/name — rare (ISIN change + clear via old id); the marks are cleared correctly; fix needs a new marks-module API for the current id.
  - `[low]` `[reject]` (blind) Re-read after a committed write could throw and report failure — only DB reads that just succeeded inside the write; unlikely; fix adds error-handling branches.
  - `[false]` `[reject]` (blind) `price_marks` silently missing / crash on undefined view item — `priceMarksView` guarantees every requested id is present ("Every id is present").
  - `[false]` `[reject]` (blind) Description contradictory on "latest fetch of the day, never intraday" and vs. top-level price — wording mirrors the approved epic rule (no intraday monitoring); both prices come from the same resolver for the Security used today.
  - `[low]` `[reject]` (blind) Revalidation path list duplicated between route and server action — same pattern as the existing `onWatchlistChange`; sharing needs a new module; route behaviour now tested.
  - `[low]` `[reject]` (blind) Clients sending explicit `null` for omitted fields would clear marks — `null` = clear is the marks service semantics (spec) and is documented in the schema descriptions.
  - `[low]` `[reject]` (blind) Weak test assertions (`distance: expect.any(String)`, missing refusal cases) — test-only; the distance equals the `priceMarksView` mapping asserted in the same test.
  - `[low]` `[reject]` (edge) Unknown Security plus invalid input refuses with `price-marks-invalid` — same order as the app's marks service (validate first); either refusal writes nothing.
  - `[low]` `[reject]` (edge) Re-read failure after commit reported as internal error — duplicate of the blind finding; same reason.
  - `[low]` `[reject]` (edge) Stop with both `price` and `percent` drops the one not matching the type — documented per type in the schema; unlikely; a guard adds complexity.
  - `[low]` `[reject]` (edge) Clear via predecessor id returns predecessor id — duplicate; same reason as above.
  - `[low]` `[patch]` (edge) Description calls stop/target price "as set" though after an ISIN change it is converted by `carryPriceMarks` — reworded `PRICE_MARKS_DESCRIPTION` for both.
  - `[low]` `[patch]` (verification-gap) Route-level revalidation after `set_price_marks` untested — added a `route.test.ts` case asserting `/`, `/securities`, `/securities/[id]` (page), `/watchlists` and no backfill.
  - `[low]` `[patch]` (verification-gap) `set_price_marks` through an ISIN-change predecessor untested at MCP level — added a case asserting the successor's `security_id`/`name` and storage on the successor.
  - `[low]` `[reject]` (verification-gap other) Clear via predecessor id returns predecessor id — duplicate; same reason as above.
  - `[false]` `[reject]` (intent) Tests use an in-process client, not the live connector — the AC defines tests as the proof; the HTTP/OAuth path is covered by `http.test.ts`/`route.test.ts`; no operator action is owed (deployment is outside this story).
  - `[low]` `[patch]` (intent) App-visible revalidation effect untested — same root cause as the verification-gap route finding; patched there.
  - `[false]` `[reject]` (intent) "Same validation" at service level vs. form (German decimals) — MCP convention is plain decimal strings; validation is the same core `checkPriceMarksPatch` the app uses; missing-field part patched above.
  - `[false]` `[reject]` (intent) Scope check uses a hand-built scope list, not a token without `watchlist` — every grant includes `watchlist` (consent grants it even when only `portfolio:read` is requested), so such a token cannot exist.
  - `[false]` `[reject]` (intent) Payload shape (`price`/`percent`) differs from AC wording; `get_watchlist` conditional field — additive and matches "value or percentage"; the view always returns an item.

## Design Notes

Separate `price`/`percent` fields (instead of one type-dependent `value`) keep Claude from reading a trailing "15" as 15 €. Example payload:

```json
{ "basis": "latest close", "price": "140", "price_date": "2026-10-27", "breached": "none",
  "stop": { "type": "TRAILING", "price": null, "percent": "10", "effective": "126", "high": "140", "distance": "-0.1", "source": null, "set_date": "2026-10-28" },
  "target": { "price": "300", "effective": "300", "distance": "1.142857…", "source": "Zeitung", "set_date": "2026-10-28" } }
```

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Claude now sees and sets Tommy's price marks. `get_security` (portfolio:read) and `get_watchlist` (watchlist) carry an additive `price_marks` object per Security (basis "latest close", price/date, stop with type, price or percent, effective, high, distance, source, set date; target with price, effective, distance, source, set date; `breached`), renamed 1:1 from `priceMarksView` / `core/price-marks`. New tool `set_price_marks` (scope `watchlist`) sets or clears stop and target through `setPriceMarks` with the app's validation (omitted marks stay, `null` clears), returns the new `price_marks`, refuses with `price-marks-invalid` (field path, problem, German message) or `security-not-found`, and revalidates the pages that show marks. Descriptions state marks are Tommy's own reference levels, not recommendations, checked against the latest close.

**Files changed:**
- `src/modules/mcp/price-marks.ts` (+ test) — payload mapping, shared description, input→patch mapping, refusal field paths and messages.
- `src/modules/mcp/tools.ts` — `set_price_marks`, `get_watchlist` `price_marks`, context callback `onPriceMarksChange`.
- `src/modules/mcp/portfolio-tools.ts` — `get_security` `price_marks` and description.
- `src/modules/mcp/http.ts`, `src/modules/mcp/server.ts` — callback wiring, one instructions sentence.
- `src/app/api/mcp/route.ts` (+ test) — revalidates `/`, `/securities`, `/securities/[id]`, `/watchlists` after a marks write.
- `src/modules/mcp/portfolio-tools.test.ts`, `src/modules/mcp/http.test.ts` — read payloads, set, keep, clear, refusals, unknown Security, ISIN successor, scope check, descriptions, tool list (19).

**Review findings:** 23 — high 0, medium 0, low 16, false 7. Patched: 5 low rows in 4 entries (optional schema fields → app-style refusals; description wording after ISIN change; route revalidation test; ISIN-predecessor test). Deferred: none. Rejected: all others — reasons per row in the Review Triage Log.

**Follow-up review recommended:** false — patched counts: high 0, medium 0, low 4 entries.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — pass (279 files, 3957 tests; build compiled), re-run after the patches.

**Residual risks:** clearing via an ISIN-change predecessor id returns the predecessor's id/name; an empty `set_price_marks` call rewrites the row unchanged and revalidates; the live claude.ai connector shows the new tool only after the next deploy.
