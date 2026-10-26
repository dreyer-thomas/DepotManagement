---
title: 'Security Detail Page (story 4-6)'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: 'f778c9110289393bfc0c7e8d02b2a86214bb4e54'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/mockups/position-phone.html'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** There is no per-Security page: Tommy cannot drill into one holding (or one already sold) across all Depots before acting (FR-19, UJ-1 climax).

**Approach:** Add route `/securities/[id]` (optional `?depot=<id>`) that loads the Security's ledger rows per Depot via a new read-only ledger service, evaluates them with new pure `src/core/security.ts` (valuation series, Period performance, snapshot, lots) and renders header, Depot switcher, hero, KPIs, price line, FIFO lots, Transaction history, news and an actions menu. Link Positions table, Top-Positionen, Securities page and Transaction rows to it.

## Boundaries & Constraints

**Always:**
- **Security chain:** the page's Security plus every Security connected to it by recorded ISIN changes (undirected, transitive) — one holding through its ISIN history. All scope rows are Transactions whose `securityId` is in the chain. Both the old and the new Security's page show the same figures; the header shows the page's own Security.
- **Scopes:** each Depot with ≥ 1 scope row is selectable (name order, de-DE; archived ones labelled `(archiviert)`), plus "Alle Depots" = sum over the **non-archived** such Depots (AD-17). URL `?depot=<id>` selects a Depot; missing/unknown id → "Alle Depots", except when every booking Depot is archived → the first of them. A Depot's figures use only that Depot's scope rows (FIFO per Depot); "Alle Depots" sums per-Depot results.
- **Period:** `readPeriod(today)`; one common `from..to` per page via `resolvePeriod(selection, today, earliest scope-row date of the scope's Depots)`. Each Depot is evaluated over exactly that range.
- **Series:** `valuationSeries(scopeRows, observations, actions, from − 1 day, to)` per Depot (observations = `lineageObservations(chain, actions, to, db, storedPriceHistory)`); the Security series is each point with `value = positionsValue`, `cash = "0"`; first point is `start`. "Alle Depots": `sumValuationSeries`.
- **Period performance (pure core):** realized = FIFO gains (`fifo(scopeRows, to, actions)`) of SELLs dated in the Period; unrealized = Δ(positionsValue − investedCapital) start→end; dividends = Σ DIVIDEND `amount`; fees = Σ `fee` of DIVIDEND/FEE rows; taxesPaid = Σ signed `tax`; gain = realized + unrealized + dividends − fees (= `V(end) − V(start) − netFlows`); TTWROR and XIRR via existing `ttwror`/`xirr`/`periodCashFlows` over **security flows**: BUY `+(amount+fee)` in, SELL and DIVIDEND `−(amount−fee)` out, FEE `+fee` in, taxes ignored (synthetic DEPOSIT/WITHDRAWAL rows). Result shape = `PeriodPerformance`. "Alle Depots": amounts summed, TTWROR/XIRR over summed series + merged flows (same construction as `portfolioPerformance`).
- **Snapshot as of `to`:** `computePositions(scopeRows, observations, to, actions)` per Depot, summed over the scope: quantity, Cost Basis, value (null if any open Position lacks a price), unrealized = value − Cost Basis (null without value), average purchase price = Cost Basis / quantity (null when quantity 0). With `to = today` this equals the Positions tab.
- **Price line:** resolver price (`resolvePrice` over corporate-action-adjusted observations) as of `to` for the chain's current Security (follow ISIN changes dated ≤ `to` from the page's Security); shows `Kurs vom dd.mm.yyyy` / `StaleBadge` (`isStale(date, today)`), `Kein Kurs vorhanden.` without one. When stale **and** scope quantity > 0: `Keine Kursquelle liefert aktuelle Kurse.` plus `ManualPriceButton` for that current Security.
- **Hero:** Card "Wert · <qty> Stück à <price>" (omit "à …" without price), `formatMoney(end.value)`, `Stand dd.mm.yyyy` when `to ≠ today`, `GainLossPill` (gain, ttwror, "TTWROR"), `xirrText`, `ValueChart` of the series, and the existing "Aufschlüsselung" breakdown (export it from `ValueSummary.tsx`, unchanged).
- **KPIs** (`Kpi` exported from `ValueSummary.tsx`): Stück, Cost Basis, Unrealisiert (`formatMoney(…, { sign: true })` or `–`), `Dividenden · <periodLabel>`, Ø Kaufkurs (or `–`).
- **Lots:** section "Offene Kaufposten": per scope Depot with open lots (`fifo(scopeRows, to, actions)` lots), a table Kaufdatum, Stück, Cost Basis, Einstandskurs (cost / qty), Depot name as sub-heading; none → `Keine offenen Kaufposten.`.
- **Transactions:** section "Buchungen": every scope row of the scope's Depots, newest first `(date desc, sequence desc)`, read-only table: Datum, Art, Depot (name), Stück (split-adjusted as of today like `TransactionList`'s `QuantityText`), Betrag (`eventValue`); a row of another chain Security shows its name as caption under Art.
- **News:** "Nachrichten · 14 Tage": `listNews(today, id)` articles **filtered to `securityId === id`** (listNews lists all for a non-held id), rendered with `NewsList` (empty → `Keine Nachrichten der letzten 14 Tage.`).
- **Header:** `SecurityLogo`, `h1` name, caption `ISIN or crypto symbol · <asset type label>`; `PeriodSelector`; actions menu (kebab, `aria-label="Aktionen für <name>"`): "Split …", "ISIN-Wechsel …" (existing `SplitDialog`/`IsinChangeDialog`), "Neue Buchung" — selected non-archived Depot → `TransactionDialog` with that Depot **and the Security preselected**; "Alle Depots" → depot choice ("Depot wählen", non-archived booking Depots, as `NewTransactionFab`); omitted when no non-archived Depot is available.
- **Depot switcher:** `nav aria-label="Depot"` of links (`Alle Depots`, each Depot), selected one `aria-current="page"`, ≥ 44 px, wraps on phones.
- **Links:** PositionsTable name (desktop + stacked) and TopPositions row → `/securities/<id>?depot=<depotId>`; SecurityList name → `/securities/<id>`; TransactionList Security cell → `/securities/<id>?depot=<depotId>` (click must not open the edit dialog).
- No scope rows at all → header + `Noch keine Buchungen.`; unknown Security id → `notFound()`. Metadata title = Security name.

**Never:** No "Gesamt seit Erstkauf" card, Kurs/Wert toggle or trade markers (story 4-7); no stored figures; no editing from the history table; no new dependency; no change to existing Depot/Overview figures; no `number` arithmetic on money; no `Date.now()` in core.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two Depots | A: BUY 10 @100, B: BUY 5 @120; price 110 | Alle Depots: qty 15, Cost Basis 1.600, value 1.650, unrealized +50; Depot A: qty 10, value 1.100 | — |
| Fully sold | BUY 10 @100 (fee 1), SELL 10 @120 (fee 1) in Period | qty 0, value 0, realized +198, gain +198, lots none, Ø Kaufkurs `–` | — |
| Dividend | held, DIVIDEND 20 fee 0 tax 5 in Period | dividends 20, gain includes +20, taxesPaid 5 not in gain | — |
| Split | BUY 10 @100, split 1:2 | qty 20, Ø 50, history Stück 20 with "split-bereinigt" caption | — |
| ISIN change | BUY X 10, ISIN change X→Y | X and Y pages: qty 10 (as Y), same figures; history shows the X buy | — |
| Archived only | Security only in archived Depot D | default scope D, no "Neue Buchung" | — |
| Not booked | Security without Transactions | header + `Noch keine Buchungen.` | — |
| Unknown id | `/securities/nope` | 404 | `notFound()` |

</intent-contract>

## Code Map

- `src/core/valuation.ts:150` -- `valuationSeries(rows, observations, actions, from, to)`; `sumValuationSeries`; `periodFlows`. Reuse unchanged.
- `src/core/returns.ts:90,141,217,259,329` -- `ttwror`, `xirr`, `periodCashFlows` (take `FlowRow` = `{type,date,amount,tax}`), `periodPerformance`/`portfolioPerformance` as models; `PeriodPerformance` type (incl. `feesContribution`, `netExternalFlows`).
- `src/core/fifo.ts:67` -- `fifo(rows, asOf, actions)` → lots + sales per Security.
- `src/core/positions.ts:37` -- `computePositions` (snapshot per Security).
- `src/core/prices.ts:55,83` -- `resolvePrice`, `isStale`; `src/core/corporate-actions.ts:275` `adjustedPrice`, `CorporateActions.isinChanges` (`oldSecurityId`, `newSecurityId`, `date`).
- `src/core/security.ts` (new) -- pure: `securityChain(id, actions)`, `currentSecurityId(id, actions, asOf)`, `securitySeries(points)` (value = positionsValue, cash 0), `securityFlowRows(rows)`, `securityPerformance(rows, start, series, actions)`, `sumSecurityPerformance(parts)`, `securitySnapshot(positions)`. Imports only core files (architecture test).
- `src/modules/ledger/valuation.ts` -- `loadRows`, `firstDateOf`, `valuationOver` pattern to mirror; `src/modules/ledger/positions.ts:46` `lineageObservations` (export it via index if needed), `StoredPriceLoader`.
- `src/modules/ledger/security-detail.ts` (new, export via `index.ts`) -- `securityDetail(securityId, depotParam, selection, today, db = prisma, { storedPrices })` → `null` for unknown id, else `{ security, depots: {id,name,archived}[], selected: string | null /* null = Alle Depots */, from, to, start, series, performance, snapshot, price, lots: {depotId, depotName, lots}[], transactions: (TransactionRecord & { depotName })[] }`. Read-only.
- `src/modules/ledger/transactions.ts:25,581` -- `TransactionRecord`, `TRANSACTION_INCLUDE`, `toRecord` for history rows.
- `src/app/(app)/depots/[id]/page.tsx` -- server page pattern (period, `storedPriceHistory`, `latestStoredPrices`, `businessDate`, `PeriodSelector`).
- `src/app/_components/valuation/ValueSummary.tsx` -- export `Breakdown`, `Kpi` (no behavior change).
- `src/app/_components/transactions/TransactionDialog.tsx:94,460,497` -- add optional `security?: SecuritySummary` to `TransactionForm`/`TransactionDialog`; `emptyValues(today)` in `transaction-form.ts:82` gets an optional security.
- `src/app/_components/overview/NewTransactionFab.tsx` -- depot-choice menu pattern.
- `src/app/_components/corporate-actions/SplitDialog.tsx:167`, `IsinChangeDialog.tsx:309` -- props; data from `listSplits()`, `listIsinChanges()`, `listSecurities()`.
- `src/app/_components/prices/StaleBadge.tsx`, `price-labels.ts` -- `PriceDate`, `PriceDateInfo`; `securities/ManualPriceDialog.tsx:125` `ManualPriceButton`.
- `src/app/_components/positions/PositionsTable.tsx:69,221,324` -- `SecurityName`; add `depotId` prop for links. `src/app/(app)/depots/[id]/page.tsx` passes `depot.id`.
- `src/app/_components/overview/labels.ts:12`, `TopPositions.tsx` -- `DepotPosition` gains `depotId`; Overview page fills it.
- `src/app/_components/securities/SecurityList.tsx:53`, `transactions/TransactionList.tsx:~170` -- name → link.
- `src/app/_components/depots/DepotLink.tsx` -- `AppLink` (server-safe link); `src/modules/news` `listNews`; `src/app/_components/news/NewsList.tsx`.
- `src/app/_components/transactions/labels.ts:23` -- `ASSET_TYPE_LABELS`.
- Tests: `src/app/(app)/depots/[id]/page.test.tsx` (page test pattern with temp DB), `test/helpers/dom.tsx` (happy-dom).

## Tasks & Acceptance

**Execution:**
- `src/core/security.ts` + `security.test.ts` -- chain, current id, flows, performance (identity `gain = V(end)−V(start)−netFlows`), summing, snapshot -- cover matrix rows Two Depots, Fully sold, Dividend, Split, ISIN change at core level plus hand-checked TTWROR for a one-buy price rise.
- `src/modules/ledger/security-detail.ts` + test, `index.ts` -- load rows/Depots/actions/observations, scope + default rules, history -- matrix rows Archived only, Not booked, Unknown id, scope selection, archived Depot excluded from Alle Depots.
- `src/app/_components/valuation/ValueSummary.tsx` -- export `Breakdown`, `Kpi`.
- `src/app/_components/transactions/TransactionDialog.tsx`, `transaction-form.ts` (+ tests) -- optional preselected Security.
- `src/app/_components/security-detail/` (new: `SecurityHero.tsx`, `SecurityKpis.tsx`, `PriceLine.tsx`, `FifoLots.tsx`, `SecurityTransactions.tsx`, `DepotSwitcher.tsx`, `SecurityActions.tsx` client, `labels.ts`) + DOM/unit tests -- page sections.
- `src/app/(app)/securities/[id]/page.tsx` + `page.test.tsx` -- assemble; tests: header, switcher `aria-current`, Alle Depots sums, Depot scope, Transactions newest first with Depot names, stale text + manual price button, news empty text, sold Security, 404.
- `PositionsTable.tsx`, `TopPositions.tsx`, `overview/labels.ts`, Overview + Depot pages, `SecurityList.tsx`, `TransactionList.tsx` (+ existing tests) -- links.

**Acceptance Criteria:**
- Given a Security held in Depot A, when its name in A's Positions table is clicked, then `/securities/<id>?depot=<A>` opens with A selected and figures equal A's Positions-tab row.
- Given "Alle Depots", when the page renders, then hero value, quantity, Cost Basis and dividends are the sums of the non-archived Depot scopes.
- Given the actions menu with a non-archived Depot selected, when "Neue Buchung" is chosen, then the dialog opens with that Depot and the Security preselected.
- Given a Transaction row's Security name on the Depot page, when it is clicked, then the Security page opens and the edit dialog does not.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 30 findings — high 0, medium 0, low 23, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: new Security's page with a Period ending before the ISIN change resolves no price (`currentSecurityId` walks forward from the page's Security only) — needs a custom past Period across an ISIN change; fix adds a branch (resolve from the open Position at `to`).
  - `[low]` `[reject]` Blind: stale check uses today while the price is resolved as of `to`, so past custom Periods show "veraltet" + hint — `isStale(date, today)` is mandated by the intent contract; changing it means editing this spec; residual risk.
  - `[low]` `[reject]` Blind: "Neue Buchung" on the old Security's page preselects the retired ISIN — only on a superseded Security's page; the dialog shows the Security name; spec mandates "the Security preselected".
  - `[low]` `[reject]` Blind: crypto quantities labelled "Stück" in hero/KPI — label is mandated verbatim by the intent contract; fix edits this spec; residual risk.
  - `[low]` `[reject]` Blind: snapshot/lots as of `to` while "Buchungen" lists rows after `to` — spec-mandated ("every scope row"); only with custom past Periods.
  - `[low]` `[reject]` Blind: `listNews` loads all held news for a non-held id and the filter ignores chain relatives — spec-mandated filter on own id; negligible cost for a single user.
  - `[low]` `[reject]` Blind: duplicate reads (`getSecurity` in metadata + page, actions reloaded, `listSecurities`) — single-user SQLite, no measurable harm; dedup adds caching plumbing.
  - `[low]` `[patch]` Blind: risky paths untested (non-MAX Period, `Stand` line, …) — same root as the Verification-gap custom-Period row; fixed by new ledger + page custom-Period tests.
  - `[low]` `[reject]` Blind: sold-out hero shows "0 Stück à 120,00 €" — spec only omits "à …" without a price; cosmetic; fix adds a condition.
  - `[low]` `[reject]` Blind: lot/history tables scroll sideways inside their card at 375 px — same pattern as the existing `TransactionList` (`overflowX: auto`); the page itself does not scroll.
  - `[low]` `[reject]` Blind: `currentSecurityId` depends on `(date, id)` order for two chained same-date ISIN changes — `CorporateActions.isinChanges` is documented as ordered `(date, id)`; chained same-date changes with inverted ids practically never occur.
  - `[false]` `[reject]` Blind: caption renders " · ETF" without ISIN and crypto symbol — every Security has an ISIN or a crypto symbol (AD-16, `ensureSecurity`; CRYPTO ⇔ symbol).
  - `[low]` `[reject]` Edge: stale vs `to` — duplicate of the Blind stale row; intent-contract mandated.
  - `[low]` `[reject]` Edge: price null on new Security page for `to` before change — duplicate of the Blind price row.
  - `[low]` `[reject]` Edge: Neue Buchung preselects retired ISIN — duplicate of the Blind actions row.
  - `[low]` `[reject]` Edge: history "Stück" of an old-ISIN row is in the old Security's units (ISIN change ratio / successor split) — the row carries its own Security name as caption, so its units are that Security's; fix needs replay adjustment.
  - `[low]` `[reject]` Edge: recent cached news of a just-sold Security is hidden — news is defined over the held set (AD-11/AD-17); spec-mandated.
  - `[low]` `[patch]` Verification gap: Depot page never asserts the Positions-tab Security link carries `?depot=` — added Depot page test asserting `href="/securities/<id>?depot=<depotId>"` (desktop + phone).
  - `[low]` `[patch]` Verification gap: as-of-`to` snapshot/lots/price and `Stand` line only tested with `to = today` — added a custom-Period `securityDetail` test and a page test with a custom cookie (`Stand 30.06.2026`, chart rendered; no `Stand` under MAX).
  - `[false]` `[reject]` Intent: chain scope extends "this Security" — deliberate, documented in Design Notes and tested; keeps figures consistent with the Positions tab.
  - `[low]` `[reject]` Intent: "Alle Depots" omitted from the switcher when every booking Depot is archived — the entry would be an empty AD-17 aggregate that falls back to the archived Depot; a working entry needs a new `?depot=all` parameter.
  - `[low]` `[reject]` Intent: stale hint limited to held scopes vs literal AC — spec decision (prices are fetched only for held Securities, AD-9/AD-17); otherwise always shown for sold ones.
  - `[false]` `[reject]` Intent: default "came from" via `?depot=` — matches the AC; every Depot-context link carries the parameter.
  - `[low]` `[patch]` Intent: Period selector only tested under MAX — same root as the custom-Period gap; fixed by the same tests.
  - `[low]` `[patch]` Intent: area chart presence not asserted — page test now asserts the chart (`role="figure"`) under custom and MAX.
  - `[false]` `[reject]` Intent: navigation not exercised beyond hrefs — links are plain Next links; href + no-edit-dialog click are the observable contract in this test setup.
  - `[low]` `[reject]` Intent: mockup/375 px check not performed — no browser runner in the repo; recorded as residual risk.
  - `[false]` `[reject]` Intent: ISIN-change dialog opening untested — the menu item wiring is asserted and `IsinChangeDialog` has its own DOM tests; no named harm.
  - `[false]` `[reject]` Intent: no evidence verification commands ran — they ran: lint, typecheck, 1835 tests, build all pass.
  - `[false]` `[reject]` Intent: spec left `in-review` / no operator actions — finalization sets `done`; no human-only action exists in this story.

## Design Notes

Chain scope instead of a single Security id: an ISIN change moves lots to the new Security, so a page restricted to its own id would show the new Security without its carried lots (disagreeing with the Positions tab) and the old one with a value drop and no outflow (broken TTWROR). The chain keeps value, invested capital and flows consistent and needs no filter in `valuationSeries`.

Security flows reuse the Depot return engine: a BUY is money put into the holding, a SELL/DIVIDEND money taken out, so `ttwror`/`xirr` apply unchanged to synthetic DEPOSIT/WITHDRAWAL rows:
`BUY amount 1000 fee 1 → { type: "DEPOSIT", amount: "1001", tax: "0" }`; `SELL amount 1200 fee 1 → { type: "WITHDRAWAL", amount: "1199", tax: "0" }`.

The stale hint is limited to held scopes: prices are only fetched for held Securities (AD-17), so for a sold one it would always show.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: open a Security from Positions, Top-Positionen, Wertpapiere and Buchungen; switch Depots; 375 px without horizontal scroll.

## Auto Run Result

Status: done

**Summary:** Story 4.6 adds the Security detail page `/securities/[id]` (optional `?depot=`). Pure `src/core/security.ts` treats a Security and its ISIN-change relatives as one holding and evaluates it per Depot by reusing the Depot engine: series with value = Positions value, Period performance (realized, unrealized, dividends, fees, taxes separate) with TTWROR/XIRR over the Security's own flows (buys in, sells/dividends out), "Alle Depots" summed like the Portfolio (FIFO per Depot), snapshot, open lots and resolver price as of the Period end. `src/modules/ledger/security-detail.ts` loads rows, picks the scope (selected Depot; "Alle Depots" = non-archived booking Depots; first archived Depot when all are archived) and builds the newest-first history with Depot names. The page shows header (logo, name, ISIN/symbol, type), Depot switcher, hero (value, gain pill with TTWROR, XIRR, chart, breakdown), KPIs, price line with stale badge and manual-price hint, open FIFO lots per Depot, Transaction history, 14-day news, and an actions menu (Split, ISIN-Wechsel, Neue Buchung with Depot and Security preselected). Positions table, Top-Positionen, Wertpapiere and Buchungen link to it.

**Files changed:**
- `src/core/security.ts` (+ test) — chain, flows, performance, summing, snapshot, lots, price.
- `src/modules/ledger/security-detail.ts` (+ test), `index.ts`, `transactions.ts` — read service; exports `TRANSACTION_INCLUDE`/`toRecord`.
- `src/app/(app)/securities/[id]/page.tsx` (+ test) — the page.
- `src/app/_components/security-detail/*` (+ DOM/unit tests) — switcher, hero, KPIs, price line, lots, history, actions, link, labels.
- `src/app/_components/valuation/ValueSummary.tsx` — exports `Breakdown`, `Kpi`.
- `src/app/_components/transactions/TransactionDialog.tsx`, `transaction-form.ts`, `TransactionList.tsx` (+ tests) — preselected Security; Security link in rows.
- `src/app/_components/positions/PositionsTable.tsx`, `overview/TopPositions.tsx`, `overview/labels.ts`, `securities/SecurityList.tsx`, Overview and Depot pages (+ tests) — links to the Security page.

**Review findings:** 30 — patched 5 rows in 2 fixes (low: Depot page link test; custom-Period ledger + page tests incl. `Stand` line and chart). Deferred: none. Rejected: 25 (7 false; low: stale-vs-today, crypto "Stück", Neue Buchung on retired ISIN ×2, price before ISIN change ×2, history after `to`, news filter/cost, sold news, duplicate reads, 0-Stück price, table scroll, same-date ISIN order, old-ISIN history units, Alle Depots hidden when all archived, stale hint held-only, 375 px manual check, stale duplicate) — reasons in the Review Triage Log.

**Follow-up review recommendation:** false — first pass patched high 0, medium 0, low 2 entries.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all pass (135 files, 1835 tests) after patches. Matrix audit: every I/O row covered by passing tests (core `security.test.ts` Two Depots/Fully sold/Dividend/Split/ISIN change; ledger `security-detail.test.ts` Archived only/Not booked/unknown id; page test 404).

**Residual risks:** Not inspected in a real browser (375 px, mockup fidelity). Custom Periods ending in the past mark the as-of-`to` price stale against today (spec-mandated). Crypto quantities read "Stück" (spec-mandated). Superseded (old-ISIN) Security pages preselect the old Security for new bookings.
