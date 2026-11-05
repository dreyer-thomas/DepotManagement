---
title: 'Technical Signals for Claude'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_revision: '64f200409bbbfadeefac84c983ca94e0a08aef71'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The card "Technische Lage" (11.3) shows the technical signals of `technicalPosition` (11.2), but the MCP connector does not; Claude cannot weigh trend and momentum together with position, key figures and analyst data.

**Approach:** `get_security` (scope `portfolio:read`) and `get_watchlist` (scope `watchlist`) gain an additive `technical` object per Security: the five latest signals of the same `technicalPosition` result the card renders (no series), mapped to snake_case by one exported pure payload function; both tool descriptions explain the signals, thresholds and that they are not a recommendation.

## Boundaries & Constraints

**Always:** one source — `get_security` maps `detail.technical` of `securityDetail` (exactly the card's input); `get_watchlist` computes per entry `technicalPosition(tradingDayCloses(observations, entry.securityId, actions, today), today)` inside `watchlistView` (same closes as the entry's `fiftyTwoWeek`, which is then derived from those closes) — only when the caller asks for it, so the watchlist page pays nothing; decimals stay the core's decimal strings unchanged (ratios as plain decimals: trend and 52-week value 0.082 = 8.2 %); description text of thresholds/minimums is built from `TECHNICAL_PARAMETERS`, not hard-coded numbers; tools stay read-only adapters (AD-22).

**Never:** no series in any payload; no combined score, verdict or recommendation; no new tool, no write path, no change to `technicalPosition` or the card; `technical` not added to `add_watchlist_entry`/`update_watchlist_entry` results; indicators never stored or exported.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full history | Security with the 300 reference closes | `technical: { basis: "closing prices", as_of: "2026-09-25", trend: { value, date, key, label, sma200 }, rsi: { value, date, key, label }, macd: { value, date, key, label, signal, histogram }, tsi: { value, date, key, label, signal }, fifty_two_weeks: { value, date, key, label, high, high_date, low, low_date } }` — values equal `detail.technical` | — |
| Short history | one stored close | `as_of` = that date; trend/rsi/macd/tsi `{ value: null, reason: "insufficient-history" }`; fifty_two_weeks with value | — |
| No closes | Security without stored Prices | `as_of: null`, all five `{ value: null, reason: "insufficient-history" }` | — |
| Watchlist | entry of the reference Security | entry `technical` deep-equals `get_security`'s `technical` for that Security | — |

</intent-contract>

## Code Map

- `src/core/technical.ts` -- `TechnicalPosition` (signals + `series`), signal types (`InsufficientHistory` = `{ value: null, reason }`), `TECHNICAL_PARAMETERS` (windows, thresholds `"70"`/`"30"`, `crossLookback`, `nearBand "0.05"`, `minCloses`), key/label maps. Read-only.
- `src/core/key-figures.ts:123-191` -- `tradingDayCloses`, `fiftyTwoWeekFromCloses`, `fiftyTwoWeekFigures`, `DatedClose`.
- `src/modules/ledger/security-detail.ts:96-101,234-271` -- `technical` already on `SecurityDetail` (card input). Read-only.
- `src/modules/watchlist/entries.ts:208-257` -- `WatchlistEntryView`, `watchlistView(today, db)`; entries get `fiftyTwoWeek: fiftyTwoWeekFigures(...)`. Other callers: watchlist page, `entryById` in MCP tools.
- `src/modules/mcp/tools.ts` -- `keyFiguresPayload` / `entryPayload` (pattern for an exported pure payload fn), `get_watchlist` registration (description + handler).
- `src/modules/mcp/portfolio-tools.ts:452-492` -- `get_security` registration (description + payload).
- `src/modules/mcp/portfolio-tools.test.ts` -- in-memory MCP client harness (`seed`, `call`, `TODAY = 2026-10-28`, both scopes); `src/modules/mcp/tools.test.ts` -- pure-function tests.
- `test/fixtures/technical/reference-series.json` -- 300 closes 2025-08-04..2026-09-25 (fixture Security input).

## Tasks & Acceptance

**Execution:**
- `src/modules/watchlist/entries.ts` -- `watchlistView(today, db, options?: { technicalFor?: string })` (a watchlist id); compute `closes = tradingDayCloses(...)` once per entry, `fiftyTwoWeek = fiftyTwoWeekFromCloses(closes, today)`, and only for the entries of the list whose id equals `technicalFor` add `technical: TechnicalPosition` (optional field on `WatchlistEntryView`); other lists' entries and calls without the option carry no `technical` -- one source, no cost for the page, no indicator work (~30 ms per 3-year Security) for lists Claude did not ask for.
- `src/modules/mcp/tools.ts` -- export `technicalPayload(position: TechnicalPosition)` (I/O matrix shape, `as_of = series.at(-1)?.date ?? null`, insufficient signals passed as `{ value: null, reason: "insufficient-history" }`) and `TECHNICAL_DESCRIPTION` (signals, units, thresholds and minimum closes from `TECHNICAL_PARAMETERS`, interpretation keys, "descriptive, often conflicting, not a recommendation, no combined score"); the description must match the code exactly: per-signal extra fields named as siblings of value/date/key/label (`sma200`; `signal`, `histogram`; `signal`; `high`, `high_date`, `low`, `low_date`) — no invented `details` key; `fifty_two_weeks` needs a close within the last 52 weeks (`windowDays` days), not a close count; TSI fading/negative are "at or below signal" (equality counts as not above); near-high takes precedence when both 52-week bands apply; the closes are those of the Security whose prices are used (`price_security`, the successor after an ISIN change); `entryPayload` gains optional `technical` emitted when the view entry carries it; `get_watchlist` calls `watchlistView(..., { technicalFor: watchlist_id })` and appends the description.
- `src/modules/mcp/portfolio-tools.ts` -- `get_security` payload adds `technical: technicalPayload(detail.technical)`; description appends `TECHNICAL_DESCRIPTION`.
- `src/modules/mcp/tools.test.ts` -- `technicalPayload` for full/insufficient/no-closes positions (no `series` key); description checks whole phrases built from the parameters (e.g. `` `${slopeLookback} closes earlier` ``, `` `last ${crossLookback} closes` ``, `` `signal ${tsi.signal}` ``, `` `>= ${overbought}` ``), so a bare number inside another number cannot satisfy it; includes `tsi.signal`, `tsi.scale`, `windowDays`, `nearBand`.
- `src/modules/mcp/portfolio-tools.test.ts` -- seed a "Technik AG" Security with the 300 reference closes; test: `get_security` `technical` equals the card input `detail.technical` mapped field by field (written out in the test, not via `technicalPayload`), all five signals non-null; on a watchlist, `get_watchlist`'s entry `technical` deep-equals it; the 1-close watched Security gives the short-history row and the unpriced one the no-closes row; every `technical` object has exactly the keys `basis, as_of, trend, rsi, macd, tsi, fifty_two_weeks`; an entry of the same Security on a second watchlist carries no extra work: the other list's `get_watchlist` still returns its own `technical`.
- `src/modules/watchlist/watchlist.test.ts` -- `watchlistView` without the option has no `technical`; with `technicalFor` = list A, A's entry equals `technicalPosition(tradingDayCloses(...))` and list B's entries carry no `technical`.

**Acceptance Criteria:**
- Given a connected Claude, when it calls `get_security` or `get_watchlist`, then each Security carries `technical` with the latest five signals (decimal string, last close date, key, German label, or `null` + `insufficient-history`) from the card's core function, and no series.
- Given the tool list, when Claude reads the descriptions of `get_security` and `get_watchlist`, then they explain the signals, thresholds and that they are not a recommendation.
- Given the tool registry, when listed, then the tool names and their read-only/write annotations are unchanged.
- Given the full suite, when `npm run lint && npm run typecheck && npm test && npm run build` runs, then it passes.

## Spec Change Log

### 2026-11-05 — Review loop 1 (bad_spec)
- **Trigger:** blind + edge-case review: `get_watchlist` called `watchlistView(..., { technical: true })` and computed `technicalPosition` (~30 ms per Security with 3 years of closes, measured) for every entry of every watchlist, then kept one list. Also: the description named a non-existent `details` key, called a missing 52-week signal "too few closes", described TSI keys as strictly below signal, omitted near-high precedence and the `price_security` mapping; the description test matched bare numbers that occur inside other numbers.
- **Amended:** entries.ts task (option `technicalFor: watchlistId`), tools.ts task (description accuracy rules, `technicalFor` call), tools.test/portfolio-tools.test/watchlist.test tasks (phrase checks, exact key sets, other-list case).
- **Known-bad state avoided:** indicator work for unrelated watchlists on every `get_watchlist`; a tool description that misstates the payload shape and edge semantics.
- **KEEP:** `technicalPayload` shape and implementation (snake_case, `basis`, `as_of`, insufficient object, no series); `TECHNICAL_DESCRIPTION` built from `TECHNICAL_PARAMETERS` and appended to both descriptions before " Not investment advice."; `entryPayload` spreading `technical` only when present; closes computed once per entry with `fiftyTwoWeekFromCloses`; the "Technik AG" fixture (`DE000TECH008`, 300 reference closes via `createMany`) and the field-by-field comparison with `securityDetail(...).technical`; tools.test cases for full/one-close/no-closes.

## Review Triage Log

### 2026-11-05 — Review pass
- verdicts: 23 findings — high 0, medium 1, low 13, false 9, maybe-false 0
- findings:
  - `low` `bad_spec` (blind) description names a non-existent `details` key — spec amended: extra fields named as siblings.
  - `low` `bad_spec` (blind) missing 52-week signal described as "too few closes" though it needs a close in the 52-week window — spec amended: description states the window rule.
  - `low` `reject` (blind) no `stale` flag on `technical` — `as_of` carries the last close date next to the tool's `today`-based `stale` price flag; a new field adds surface for information already present.
  - `medium` `bad_spec` (blind) `get_watchlist` computes indicators for every entry of every list — measured ~30 ms per 780-close Security; spec amended: `watchlistView` option `technicalFor` (watchlist id).
  - `low` `bad_spec` (blind) description test matches bare numbers inside other numbers (20 in 200, 5 in 0.05) — spec amended: phrase checks.
  - `low` `bad_spec` (blind) "no series" checked by string only — spec amended: exact key-set assertion for every `technical`.
  - `low` `reject` (blind) split test in watchlist.test is circular — split adjustment of `tradingDayCloses` is covered by core tests (stories 9.6/11.2); this test only proves the wiring.
  - `false` `reject` (blind) Period/depot independence of `technical` untested — `security-detail.test.ts` asserts `technical` equal for 1M and MAX; the tool maps `detail.technical` unchanged.
  - `low` `bad_spec` (blind) no ISIN-change note: `technical` describes `price_security` — spec amended: description says so (same `currentSecurityId` mapping in both paths).
  - `false` `reject` (blind) `fiftyTwoWeekFigures` now test-only — removing an exported core helper with its own tests is unrelated cleanup; no caller diverges since it is a two-line composition of the same functions.
  - `false` `reject` (blind) `sma200` key vs parameterised window text — no harm unless the window constant changes, which would also rename the core field.
  - `low` `bad_spec` (blind) 52-week near-high precedence not described — spec amended.
  - `low` `bad_spec` (edge) `get_watchlist` all-lists computation — same root cause as blind row 4.
  - `low` `bad_spec` (edge) TSI fading/negative at equality described as strictly below — spec amended: "at or below signal".
  - `low` `bad_spec` (edge) near-high precedence — same as blind row 12.
  - `false` `reject` (edge) SMA200 rounding to zero yields insufficient-history — needs closes of 0, impossible for stored prices (positive decimals).
  - `false` `reject` (intent) test compares with `securityDetail().technical`, not the rendered card — the AC asks for "the card's input", which is exactly that object (page.tsx:117).
  - `low` `reject` (intent) watchlist path not compared with get_security for ISIN-change/split Securities — both use `tradingDayCloses` with `currentSecurityId`; split/ISIN mapping is covered by core tests.
  - `low` `reject` (intent) `technical` under a watchlist-only grant untested — the code path has no scope branch; the existing held-flag test covers scope-dependent payloads.
  - `false` `reject` (intent) only in-memory transport tested — transport/OAuth are unchanged and covered by `http.test.ts`.
  - `false` `reject` (intent) descriptions only string-tested — descriptive; no defect named.
  - `low` `bad_spec` (intent) "no series" checked by string — same root cause as blind row 6; covered by that amendment.
  - `false` `reject` (intent) no-writes asserted indirectly — the existing tool-list test asserts the names and read-only annotations; no tool was added.

### 2026-11-05 — Review pass (after loop 1)
- verdicts: 18 findings — high 0, medium 0, low 12, false 6, maybe-false 0
- findings:
  - `low` `patch` (blind) `get_watchlist` description refers to `price_security`, which watchlist entries lack — fixed: wording covers both tools (watchlist entry = the Security it maps to today).
  - `low` `patch` (blind) price-valued fields lack a unit — fixed: description states EUR (AD-9: providers return EUR closes), split-adjusted to today, MACD/histogram not comparable across Securities.
  - `low` `reject` (blind) `fifty_two_weeks` duplicates `key_figures.fifty_two_week` — both come from `fiftyTwoWeekFromCloses` on the same closes by construction; the epic requires reuse of the 52-week figures.
  - `low` `patch` (blind) Transaction prices ignored / `as_of` can predate the price date — fixed: description says only stored closes count and to compare `as_of` with today.
  - `low` `reject` (blind) description length (~2.5k chars on two tools) — the AC requires the descriptions to explain signals and thresholds; trimming is a style choice.
  - `false` `reject` (blind) one failing entry breaks the whole watchlist — `technicalPosition` runs on canonical positive decimal strings and guards zero divisors; no throwing input is reachable.
  - `low` `reject` (blind) no MCP-level spy for the `technicalFor` perf fix — `watchlist.test.ts` asserts other lists carry no `technical`; a spy adds mocking for a wiring line.
  - `low` `reject` (blind) per-signal `date` repeats `as_of` — the AC requires the last close date per signal.
  - `low` `reject` (blind) test constant duplication, redundant loop, `fiftyTwoWeekFigures` test-only — style; no harm named.
  - `low` `patch` (blind) portfolio-tools header and core doc wording — fixed the header comment; core `technical.ts` untouched (out of this story's change).
  - `false` `reject` (edge) zero SMA200 / zero 52-week high reported as insufficient-history — carried: stored prices are positive decimals.
  - `low` `patch` (edge) last close older than the 52-week window leaves old indicator values — same root cause as blind row 4; fixed by the same sentence.
  - `false` `reject` (edge) description claim "history too short" vs zero-price nulls — carried (same as edge row 1).
  - `false` `reject` (intent) "connected Claude" needs a live operator check — every AC is verifiable in-repo through the MCP server with a real MCP client; no human-only action is required.
  - `false` `reject` (intent) test compares the card's input, not the rendered card — carried: the AC names "the card's input".
  - `low` `reject` (intent) watchlist path compared with get_security only without split/ISIN change — carried: shared `tradingDayCloses` with `currentSecurityId`.
  - `low` `reject` (intent) `technical` under a watchlist-only grant untested — carried: no scope branch.
  - `false` `reject` (intent) no-writes asserted indirectly — carried: existing tool-list/annotation test plus new asserts on add/update results.

## Design Notes

Payload example (abridged): `"rsi": { "value": "64.31…", "date": "2026-09-25", "key": "neutral", "label": "neutral" }`, `"trend": { "value": null, "reason": "insufficient-history" }`. Keys are the core's English keys (stable for Claude), labels the German card wording. `technical` sits beside `key_figures`, not inside it, since it is not a provider snapshot.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all green.

## Auto Run Result

Status: done

**Summary:** `get_security` (scope `portfolio:read`) and `get_watchlist` (scope `watchlist`) now return an additive `technical` object per Security: `basis`, `as_of` (last close date) and the five latest signals trend, rsi, macd, tsi, fifty_two_weeks — each `{ value, date, key, label, …extra fields }` or `{ value: null, reason: "insufficient-history" }`, never the series. `get_security` maps `securityDetail().technical` (the card's input); `get_watchlist` computes `technicalPosition` from the same trading-day closes inside `watchlistView`, only for the requested list (`technicalFor`). Both descriptions append `TECHNICAL_DESCRIPTION`, built from `TECHNICAL_PARAMETERS`, explaining signals, thresholds, units and that they are not a recommendation. No new tool, no write path.

**Files changed:**
- `src/modules/watchlist/entries.ts`, `index.ts` -- `watchlistView` option `technicalFor`; closes computed once per entry for 52-week figures and signals.
- `src/modules/mcp/tools.ts` -- `technicalPayload`, `TECHNICAL_DESCRIPTION`, `entryPayload` `technical`, `get_watchlist` wiring/description.
- `src/modules/mcp/portfolio-tools.ts` -- `get_security` `technical` + description, header comment.
- `src/modules/mcp/tools.test.ts`, `portfolio-tools.test.ts`, `src/modules/watchlist/watchlist.test.ts` -- payload, description phrases, MCP-vs-card-input comparison on the 300-close reference fixture, watchlist scoping.

**Review:** pass 1: 23 findings → bad_spec loop (watchlist computed indicators for all lists, ~30 ms per Security; description inaccuracies), code re-derived. Pass 2: 18 findings — 5 patched (all low), 0 deferred, 13 rejected (reasons in the triage log).

**Follow-up review recommended:** false (patched: high 0, medium 0, low 5).

**Verification:** `npm run lint`, `npm run typecheck`, `npm test` (268 files, 3744 tests), `npm run build` — all passed after the patches; every I/O matrix row covered by passing tests.

**Residual risks:** not exercised against a live Claude connector (in-memory MCP client only); the long tool descriptions add to every session's tool list.

