---
title: 'Story 1.5: Positions with FIFO Cost Basis'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '3c29d06879ce0ee85febd21038a4dfad54c99c86'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Buys and sells can be booked, but the Depot detail's "Positionen" tab is a placeholder: nothing shows what is held, what it cost (FIFO) or what it is worth.

**Approach:** Add pure core functions for ledger ordering, FIFO lots with realized Gain/Loss per sale, the single price resolver (latest Transaction price on or before a date) and Positions; expose them through a read-only `ledger.listPositions(depotId, today)`; render a sortable Positions table (stacked rows below `md`) on the Depot detail, which now opens on the Positions tab.

## Boundaries & Constraints

**Always:**
- Pure `src/core` (only itself + `decimal.js`, "today" passed in), all arithmetic with `ExactDecimal` from `src/core/decimal.ts`, results as canonical strings via `canonicalDecimal`; no JS `number`, no SQL arithmetic/ordering on money columns; nothing derived is stored (AD-1).
- Ordering: every evaluation sorts by `(date, sequence)` through one shared comparator; `holdings.ts` (`sellableQuantity`) reuses it.
- FIFO per Security over BUY/SELL rows with `date ≤ asOf`, other types ignored: each BUY opens a lot with `quantity` and cost `amount + fee` (tax excluded — gross figures, AD-10). A SELL consumes the earliest lots first; the cost taken from a partially consumed lot is `lotCost × taken / lotQuantity`, a fully consumed lot gives up all its remaining cost (no residue). Realized per sale: `proceeds = amount − fee`, `costBasis` = cost taken, `gain = proceeds − costBasis`. A SELL beyond the open lots (impossible via the sell guard) consumes what exists; the excess carries zero cost and never makes a Position negative.
- Price resolver (`core/prices`, AD-9 seam): from observations `{ id, securityId, date, sequence, price }` of BUY/SELL rows of **all** Depots, the price of a Security on a date is the one of the last observation with `date ≤` that date by `(date, sequence, id)`; none → `null`. Returns `{ price, date } | null`.
- Position (only quantity > 0): `securityId`, `quantity`, `costBasis` (sum of open lot costs), `averagePrice = costBasis / quantity`, `price`/`priceDate` from the resolver at today, `value = quantity × price`, `gain = value − costBasis`, `gainRatio = gain / costBasis` (`null` when costBasis is 0); price-dependent fields are `null` without a price.
- `ledger.listPositions(depotId, today, db?)`: reads that Depot's Transactions plus price observations for its Securities (any Depot, `date ≤ today`), calls core, returns Positions each with their `SecuritySummary`. Read-only.
- UI (German, de-DE via `formatMoney`/`formatQuantity`/`formatPercent`): "Positionen" tab, now the default (`DEFAULT_DEPOT_TAB = "positions"`). Desktop (`md`+) semantic table with sortable headers (`TableSortLabel`, `aria-sort` on the sorted header): "Wertpapier" (32px initials logo + name), "Stück", "Einstandswert", "Ø Kaufkurs", "Kurs", "Wert", "G/V". Below `md` stacked rows (logo + name, "x Stück", Wert, G/V pill) with a "Sortieren nach" select over the same keys and a direction toggle; both views share one sort state. Default: Wert descending; `null` values always sort last; name sorts with `localeCompare("de")`. G/V is a pill: soft `gain`/`loss` palette background, arrow icon (`aria-hidden`) and signed text `+28,80 € · +7,97 %` (`formatMoney(gain, { sign: true })` · `formatPercent(gainRatio)`; amount only when `gainRatio` is `null`); zero gain uses neutral colors and no arrow; missing price shows "–" for Kurs, Wert and G/V. Figures use tabular numerals; touch targets ≥ 44 px.
- States: Depot without Transactions → Positions tab shows "Noch keine Buchungen." + the only "Neue Buchung" button (as on Buchungen); Transactions but nothing open → "Keine offenen Positionen."

**Never:**
- No Cash row, share column, stale badge, Position detail page, realized Gain/Loss UI, provider/manual prices or Price table (stories 1.6, Epic 3/4); no corporate-action handling (Epic 3).
- No schema change or migration; no Prisma outside `src/modules/ledger` and `src/db`; no edits to `sprint-status.yaml`; synthetic test data only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partial sell across lots | BUY 10 @ 100 fee 5 (01-10); BUY 5 @ 120 fee 2 (02-10); SELL 12 @ 130 fee 3 (03-10) | sale: proceeds `1557`, cost `1245.8`, gain `311.2`; open lot 3 units cost `361.2`; Position qty `3`, avg `120.4`, price `130`, value `390`, gain `28.8`, ratio ≈ `0.0797` (UI `+28,80 € · +7,97 %`) | — |
| Fractional | BUY `0.00012345` @ `50000` fee `0.5` | qty `0.00012345`, cost `6.6725` | — |
| Same-day buy then sell | BUY 1 seq 1, SELL 1 seq 2 same date, passed in reverse order | no open Position, one sale | — |
| Fully sold | all units sold | Security not in Positions | — |
| Price resolution | trades in two Depots, latest on 10-20 in the other Depot; one future-dated (after today) | price of 10-20 used; future row ignored | none on/before today → price fields `null`, UI "–" |
| Zero cost | BUY @ 0 fee 0 | ratio `null`, pill shows amount only | — |

</intent-contract>

## Code Map

- `src/core/holdings.ts` -- `TradeRow`, private `byDateAndSequence` → move to new `src/core/ledger-order.ts` (`compareLedgerOrder`) and import it here; `holdings.test.ts` must still pass.
- `src/core/decimal.ts` -- `ExactDecimal` (precision 1000), `canonicalDecimal`; reuse for all core math.
- `src/core/format.ts` -- `formatMoney(v, { sign })`, `formatPercent(ratio)`, `formatQuantity`; display only.
- `src/modules/ledger/transactions.ts` -- `listTransactions` / `TransactionRecord` (has `security`); new `positions.ts` mirrors its `db: LedgerDb = prisma` default; `index.ts` re-exports public API.
- `src/app/(app)/depots/[id]/page.tsx` -- already loads `listTransactions`/`listSecurities`; add `listPositions(depot.id, today)` with the `businessDate(new Date())` it already computes; replace the placeholder for `positions` (keep it for `cash`); adjust the `emptyTransactions` button logic.
- `src/app/(app)/depots/[id]/page.test.tsx` -- `selectedTab`, `recordTrade` setup pattern; default/unknown-tab tests now expect Positionen; placeholder `it.each` keeps only `cash`.
- `src/app/_components/depots/depot-tabs.ts` -- `DEFAULT_DEPOT_TAB` (comment already announces the switch).
- `src/app/_components/transactions/TransactionList.tsx` -- table/`numeric` cell style and `SecurityLogo` usage to mirror.
- `src/theme/theme.ts` -- `palette.gain` / `palette.loss` with `main` + `soft`.
- `test/helpers/render-text.ts`, `test/helpers/migrated-db-file.ts` -- server-render and temp-DB helpers (client components render statically in tests).

## Tasks & Acceptance

**Execution:**
- `src/core/ledger-order.ts` (+ test) -- `compareLedgerOrder(a, b)` on `{ date, sequence }`; `holdings.ts` uses it.
- `src/core/fifo.ts` (+ test) -- `fifo(rows, asOf)` → per Security `{ securityId, lots: { date, sequence, quantity, costBasis }[], sales: { date, sequence, quantity, proceeds, costBasis, gain }[] }`; tests: partial sells across several lots, fees in Cost Basis, fractional quantities, same-day buy-then-sell in reversed input, excess sell, `asOf` cut-off, no float (decimal strings asserted exactly).
- `src/core/prices.ts` (+ test) -- `resolvePrice(observations, securityId, date)` per the rule incl. cross-Depot tie-break and future rows.
- `src/core/positions.ts` (+ test) -- `computePositions(rows, observations, today)` per the rule; covers the matrix.
- `src/modules/ledger/positions.ts` (+ test against a temp DB) -- `listPositions`; re-export from `index.ts` with its `PositionRecord` type; test covers cross-Depot price and the matrix's first row end to end.
- `src/app/_components/positions/sort-positions.ts` (+ test) -- pure `sortPositions(rows, key, direction)` with keys `name | quantity | costBasis | averagePrice | price | value | gain`, decimal comparison, nulls last.
- `src/app/_components/positions/GainLossPill.tsx` -- pill as described; export a pure `gainLossText(gain, ratio)` (+ test).
- `src/app/_components/positions/PositionsTable.tsx` -- client component: desktop sortable table + phone stacked rows (`display` by breakpoint, no `useMediaQuery`), shared sort state.
- `src/app/_components/depots/depot-tabs.ts` -- default `positions`.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- Positions tab content and states; tests: default tab is Positionen, the matrix's first row renders (name, `3`, `361,20 €`, `120,40 €`, `130,00 €`, `390,00 €`, `+28,80 € · +7,97 %`), value-descending order of two Positions, "Keine offenen Positionen.", empty-Depot state with one "Neue Buchung".

**Acceptance Criteria:**
- Given a Depot with buys and sells, when `/depots/<id>` opens, then the Positionen tab is selected and each open Position shows initials logo + name, Stück, Einstandswert, Ø Kaufkurs, Kurs, Wert and the G/V pill with sign and arrow, ordered by Wert descending.
- Given the table, when a column header (desktop) or the "Sortieren nach" select (phone) is used, then rows re-sort by that key, toggling direction, nulls last.
- Given a viewport below `md`, then Positions show as stacked rows instead of the table.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 13, false 9, maybe-false 1
- findings:
  - `[low]` `[reject]` (blind) the cross-Depot price tie-break on the same date is arbitrary because `sequence` counts per Depot — the spec'd `(date, sequence, id)` order is deterministic; same-day prices of one Security differ marginally, and a real intra-day order needs timestamps the ledger does not keep (AD-6).
  - `[low]` `[reject]` (blind) non-terminating quotients (`averagePrice`, `gainRatio`, partial-lot cost) travel as up to 1000-digit strings to the client — a few kB for a single user's handful of Positions; trimming adds a rounding rule at a boundary AD-5 leaves to presentation.
  - `[low]` `[patch]` (blind) `listPositions` ran on every tab — now only on the Positionen tab (`[]` otherwise); `listTransactions` stays for the empty state.
  - `[low]` `[reject]` (blind) `resolvePrice` scans every observation per Position — Positions × trades of one user is tiny; grouping adds a structure with no measured need.
  - `[low]` `[reject]` (blind) the BUY/SELL/date pre-filter lives in the Prisma query, not in core — core re-applies the security and date rule itself; the type filter only defines what an observation is, and Epic 3 replaces that source anyway.
  - `[low]` `[patch]` (blind) header/select/direction sort interactions untested — same root cause as the verification-gap row; fixed there.
  - `[low]` `[patch]` (blind) the arrow test counted MUI-internal icon test ids across the whole table — replaced by pure `gainLossTone` tests and a text assertion.
  - `[low]` `[patch]` (blind) missing edge tests — added `gainLossText("0", "0")` → `0,00 € · 0,00 %`; zero-quantity BUYs and DIVIDEND-only Depots cannot exist (`recordTrade` writes only BUY/SELL with quantity > 0), and the oversell-then-buy case is covered by the zero-cost excess rule's test that leaves no lot.
  - `[low]` `[reject]` (blind) future-dated Transactions vanish from Positionen without a hint — spec'd as-of-today behavior (Design Notes); a hint is new UI for a rare case.
  - `[low]` `[reject]` (blind) `priceDate` is computed but not displayed — the stale badge in Epic 3 consumes it; dropping and re-adding it is churn.
  - `[low]` `[patch]` (edge) a gain like `0.004` showed an arrow and gain color next to unsigned `0,00 €` — new pure `gainLossTone` rounds half-up to cents before choosing the tone; tests for ±0.004 and ±0.005.
  - `[false]` `[reject]` (edge) a BUY with quantity 0 and a fee loses the fee — `recordTrade` rejects quantity ≤ 0 (`quantity-invalid`), so no such row exists.
  - `[false]` `[reject]` (edge) a missing Security row crashes `listPositions` — `Transaction.securityId` is a foreign key with `ON DELETE RESTRICT`, so every computed `securityId` has its row.
  - `[maybe-false]` `[reject]` (edge) server and browser ICU may collate tied names differently and cause a hydration mismatch — settle by rendering names that differ only in collation-sensitive characters in Node and a browser; if true it is only low (React re-renders on the client), and ties already fall back to the id.
  - `[false]` `[reject]` (edge) the phone select cannot toggle direction — the spec mandates a separate direction toggle next to the select, which exists and is now tested via `toggleSortDirection`.
  - `[low]` `[patch]` (verification-gap) sort state transitions untested — new pure `nextSort`, `selectSortKey`, `toggleSortDirection` in `sort-positions.ts`, used by `PositionsTable`, with tests that fail on a non-toggling second click, an inverted `initialSortDirection` or a select keeping the old direction.
  - `[false]` `[reject]` (intent) realized Gain/Loss is computed but not shown — the epic AC asks that it be "computed by FIFO"; showing it belongs to the Position detail (later epics).
  - `[low]` `[patch]` (intent) table/phone sort interactions only statically checked — same root cause as the verification-gap row.
  - `[low]` `[reject]` (intent) stacked phone rows are not verified at a real viewport — no DOM/browser test setup (same call as stories 1.2–1.4); CSS `display` breakpoints render both views statically, both asserted.
  - `[false]` `[reject]` (intent) switching the default tab to Positionen was not required — EXPERIENCE.md UJ-1 step 5 says the Depot detail opens on the Positions tab.
  - `[false]` `[reject]` (intent) prices from any Depot is the diff's own choice — AD-9 makes a Price a property of the Security, and the epic AC says "the price of a Security".
  - `[false]` `[reject]` (intent) average purchase price includes fees — follows from the AC's Cost Basis definition (price × quantity + fees); Ø Kaufkurs = Cost Basis / quantity.
  - `[false]` `[reject]` (intent) future-dated Transactions excluded is the diff's own choice — it mirrors the AC's "on or before today" price rule and is recorded in Design Notes.

## Design Notes

Proportional lot cost (`lotCost × taken / lotQuantity`) instead of a stored unit price keeps the Cost Basis exact whenever the division terminates and lets a fully sold lot leave no residue; any remaining quotient error lives at precision 1000 and vanishes at presentation (AD-5 accepts cent-level realized differences).

Positions are as of `today`: Transactions dated after today are ignored both for quantity and price, matching the resolver's "on or before today" rule; the valuation series in Epic 4 calls the same core with other dates.

The resolver takes observations from every Depot because a Price belongs to the Security, not to a Depot (Epic 3 replaces observations with provider/manual Prices behind the same function).

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0 (build with a scratch `DATABASE_URL`)
- `npm run dev` with synthetic auth env and a scratch `DATABASE_URL`; book the matrix's first row, fetch `/depots/<id>` -- expected: Positionen selected and the figures above

**Manual checks (if no CLI):**
- Below `md` the stacked rows and sort select appear; the table is hidden.

## Auto Run Result

Status: done

**Summary:** The Depot detail now opens on "Positionen" and lists open Positions with FIFO Cost Basis, Ø Kaufkurs, latest Transaction price, value and a G/V pill, sortable (Wert descending by default) with stacked rows below `md`. New pure core: `ledger-order` (shared `(date, sequence)` comparator, reused by `holdings`), `fifo` (lots + realized Gain/Loss per sale), `prices` (single resolver, latest BUY/SELL price of any Depot on or before a date), `positions`. Read-only `ledger.listPositions(depotId, today)`.

**Files changed:**
- `src/core/ledger-order.ts` (+ test) -- shared ledger comparator.
- `src/core/holdings.ts` -- uses the shared comparator.
- `src/core/fifo.ts` (+ test) -- FIFO lots, proportional partial-lot cost, realized per sale.
- `src/core/prices.ts` (+ test) -- price resolver (AD-9 seam).
- `src/core/positions.ts` (+ test) -- open Positions with value and unrealized G/V.
- `src/modules/ledger/positions.ts` (+ test), `index.ts` -- `listPositions`, `PositionRecord`.
- `src/app/_components/positions/sort-positions.ts` (+ test) -- sort keys, labels, `sortPositions`, sort-state helpers.
- `src/app/_components/positions/GainLossPill.tsx` (+ test) -- pill, `gainLossText`, `gainLossTone`.
- `src/app/_components/positions/PositionsTable.tsx` (+ test) -- desktop sortable table and phone stacked rows.
- `src/app/_components/depots/depot-tabs.ts` -- default tab `positions`.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- Positions tab content and empty states.

**Review findings:** 23 (high 0, medium 0, low 13, false 9, maybe-false 1).
- Patches applied: 5 entries (8 rows), all low — positions loaded only on their tab; pure sort-state helpers with tests; `gainLossTone` rounding to cents; icon-count test replaced; flat-gain text test.
- Deferred: none.
- Rejected: 15, each with its reason in the triage log (9 false; 5 low not worth a guard; 1 maybe-false that would only be low).

**Follow-up review recommendation:** false. First pass, patched by verdict: high 0, medium 0, low 5.

**Verification:**
- `npm run lint && npm run typecheck && npm test && npm run build` exit 0; 40 files / 396 tests passed (build with a scratch `DATABASE_URL`).
- Implementer ran `npm run dev` against a scratch DB, booked the matrix's first row and fetched `/depots/<id>`: Positionen selected, row `Apple Inc. 3 · 361,20 € · 120,40 € · 130,00 € · 390,00 € · +28,80 € · +7,97 %`.
- Matrix audit: every row covered by passing core, ledger, page or component tests (the "–" UI case by `PositionsTable.test.tsx`).

**Residual risks:**
- Phone layout, click sorting and the G/V pill contrast were not checked in a real browser (no DOM test setup).
- Non-terminating quotients travel as long decimal strings to the client.
- Cross-Depot same-day price choice is deterministic but arbitrary.
