---
title: Sprint Change Proposal — Hands-off Parqet Migration
date: 2026-10-25
status: approved
trigger: Story 2.4 (Confirm Migration and Reconcile with Parqet), real-data trial
scope: Moderate
---

# Sprint Change Proposal — Hands-off Parqet Migration

## 1. Issue Summary

**Problem.** The Parqet migration (Stories 2.3/2.4) asks Tommy for far too many decisions on his real export:

1. Every Parqet `Security` arrives as `UNCLASSIFIED` (the export does not distinguish stock, ETF, certificate) and "Übernehmen" stays disabled until each Security is classified by hand (`src/modules/migration/decisions.ts`).
2. Five Security `TransferIn` rows at one instant (2020-01-09, fund units delivered into the Depot, no `TransferOut`) are flagged `unpaired-security-transfer` and require a manual correction per row (`src/modules/migration/parqet-reader.ts`: only exactly one out + one in of different ISINs is understood).
3. The holdings include active mutual funds (AB SICAV, BlackRock Global Funds, Fidelity Funds), for which no asset type exists (`AssetType` in `prisma/schema.prisma`).

**Category.** Misunderstanding of requirements: planning chose "never book silently, always ask" (AD-4/AD-7/AD-16), which fits recurring document import but not a one-time migration of the user's own history; deliveries into a Depot were not foreseen (the analysed sample contained only ISIN changes).

**Evidence.** Real-data trial on 2026-10-25: dozens of mandatory classification decisions plus one flagged group (records 674–678: five `TransferIn`, LU1011999676, LU0252965834, LU0048622798, IE00B1FZS350, DE000A1E0HR8). No other flag reasons occurred.

## 2. Impact Analysis

**Epic impact.**
- Epic 2: completable with one added story (2.5). Story 2.4 stays `awaiting-operator`; its operator checks run after 2.5.
- Epic 3 (Story 3.1): classification UI must offer `FUND`.
- Epic 4 (Story 4.5): composition gets a "Fonds" segment.
- Epics 5, 6: no impact.

**Artifact conflicts.**
- PRD: glossary asset types, FR-13 breakdown, FR-15 consequence on unpaired transfers.
- Architecture spine: AD-7 (unpaired transfers "flagged, never booked"), AD-16 (asset type enum; "never guessed").
- Spec: CAP-13, CAP-15, glossary.
- UX: EXPERIENCE.md Flow 4 and the asset-type composition list; DESIGN.md unchanged (series colors already cover five categories plus cash).

**Technical impact.** New Prisma migration adding `FUND` to `AssetType`; migration reader and decision logic changes; a pure core classifier; labels and forms that list asset types. No data rollback needed (nothing real has been booked yet).

## 3. Recommended Approach

**Direct Adjustment** (Option 1): add Story 2.5 to Epic 2 and amend the affected artifacts. Rollback (Option 2) is not needed — 2.3/2.4 remain valid and are extended. MVP scope (Option 3) is unchanged.

- Effort: Medium (one story, roughly the size of 2.4).
- Risk: Low — changes are confined to the migration module plus an enum value; fixtures cover the new cases.
- Timeline: one additional loop story before Epic 3.

## 4. Detailed Change Proposals

### 4.1 Stories (`epics.md`)

**NEW — Story 2.5: Hands-off Parqet Migration** (appended to Epic 2)

```
### Story 2.5: Hands-off Parqet Migration

As Tommy,
I want the Parqet migration to book my history without asking me row by row,
So that moving away from Parqet takes minutes, not an afternoon of decisions.

**Acceptance Criteria:**

**Given** the asset types of the ledger
**Then** `FUND` (active mutual fund, label "Fonds") is added to `AssetType` via a new migration and is selectable wherever an asset type is chosen (new Security in the Transaction form, ISIN-change dialog, migration preview)

**Given** a Parqet preview with new Securities from `assettype = Security`
**When** the preview is built
**Then** a pure core classifier assigns each one a type from its name, in this order: contains `ETF`, `ETC`, `ETN` or `UCITS ETF`, or issuer `iShares`, `Xtrackers`, `Vanguard`, `Amundi`, `Lyxor`, `SPDR`, `Invesco`, `WisdomTree` → ETF; contains `Turbo`, `Knock-Out`, `Mini Future`, `Optionsschein`, `Open End` → CERTIFICATE; contains `SICAV`, `Fund`, `Funds`, `Fonds` → FUND; otherwise STOCK; `Crypto` rows stay CRYPTO
**And** classification is no longer an open decision: the preview shows the estimated type per Security with an optional inline override, and the type stays editable later
**And** the classifier is unit-tested with the five fund/ETF/ETC names from the trial and typical stock and turbo names

**Given** Security transfer rows sharing one instant
**When** the reader groups them
**Then** it first pairs `TransferOut` and `TransferIn` of the same ISIN into a split proposal (ratio = new quantity / old quantity, AD-7); then a remaining single out + single in of different ISINs becomes an ISIN change as before
**And** every remaining `TransferIn` becomes a delivery: a BUY with Parqet's shares, price and amount plus a DEPOSIT of the same amount on the same date, so the Cash Account is unchanged and the delivery counts as an external inflow (AD-10, AD-14)
**And** only a remaining unpaired `TransferOut` is still flagged

**Given** remaining flags (unpaired `TransferOut`, `non-eur`, `unparseable`, `unsupported-row`, `cash-pair-mismatch`)
**Then** they are listed in a collapsed "Nicht übernommen (n)" section that does not block "Übernehmen"; a single "Alle wie in Parqet übernehmen" books every flag that has a valid prefilled correction and skips the rest; the summary lists what was skipped
**And** duplicate matching against an existing ledger (AD-15) still shows matches for decision; on an empty Depot there are none

**Given** the synthetic fixture extended with a five-row `TransferIn` group, a same-ISIN out/in split pair and fund/ETC names
**When** it is previewed into an empty Depot
**Then** there are zero open decisions, "Übernehmen" is enabled immediately, and the resulting Positions, invested capital and Cash Account balance match the fixture's expected values
```

**Story 3.1 — Securities Page and Provider Mapping**, AC "I can classify an `UNCLASSIFIED` Security"

```
OLD: **And** I can classify an `UNCLASSIFIED` Security (through `ledger`, AD-16); an "Typ unbekannt" chip marks unclassified ones (UX-DR18)
NEW: **And** I can change any Security's type (STOCK, ETF, FUND, CERTIFICATE, CRYPTO) through `ledger` (AD-16); an "Typ unbekannt" chip marks the rare `UNCLASSIFIED` ones (UX-DR18)
```
Rationale: migration now estimates types; correction happens here.

**Story 4.5 — Composition**, AC "by asset type"

```
OLD: ... by asset type (ETF, Aktie, Zertifikat, Krypto, Guthaben, Unklassifiziert if any) ...
NEW: ... by asset type (ETF, Fonds, Aktie, Zertifikat, Krypto, Guthaben, Unklassifiziert if any) ...
```

**Requirements inventory (`epics.md`)**: FR13 list adds "fund"; FR15 text replaces "unpaired → flagged" with "unpaired TransferIn → delivery (BUY + DEPOSIT); only unpaired TransferOut flagged"; FR coverage map adds "FR15: Epic 2 – Story 2.5 hands-off migration".

### 4.2 PRD (`prd.md`)

- §3 Glossary, **Security**: "Asset types: stock, ETF, certificate (e.g. open-end turbo), crypto" → "Asset types: stock, ETF (incl. ETC), fund (active mutual fund), certificate (e.g. open-end turbo), crypto".
- FR-13: "by asset type (stock, ETF, certificate, crypto, cash)" → "by asset type (stock, ETF, fund, certificate, crypto, cash)".
- FR-15 consequence: "a paired Security TransferOut/TransferIn with the same timestamp is treated as an ISIN change (corporate action, FR-3); an unpaired Security transfer is flagged for manual review" → "Security transfers at one timestamp are paired by ISIN into splits, then a single out/in of different ISINs into an ISIN change (FR-3); an unpaired TransferIn is booked as a delivery at Parqet's cost (buy plus equal deposit); only an unpaired TransferOut is flagged. The migration needs no per-row decisions; asset types are estimated from names and editable later."
- §7 Non-goal "No Security transfers between Depots" stays (it concerns new bookings, not migrated history).

### 4.3 Architecture spine (`ARCHITECTURE-SPINE.md`, IDs stable, amended in place)

- **AD-7** last sentences: "A Parqet same-timestamp TransferOut/TransferIn pair becomes one ISIN-change CorporateAction; an unpaired Security transfer is flagged, never booked." → "Parqet Security transfers at one timestamp are paired by ISIN first (same ISIN → split CorporateAction), then a single out/in of different ISINs → ISIN-change CorporateAction; an unpaired TransferIn is migrated as a delivery (BUY at Parqet cost plus same-day DEPOSIT of equal amount, AD-14); only an unpaired TransferOut is flagged."
- **AD-16** Rule: enum becomes `STOCK | ETF | FUND | CERTIFICATE | CRYPTO | UNCLASSIFIED`; "A Security whose type is unknown (e.g. Parqet `Security`) is stored `UNCLASSIFIED` and flagged for the user to classify, never guessed." → "The Parqet migration estimates the type with one pure core classifier (name rules; default STOCK) and never blocks on it; the type stays editable through `ledger`. `UNCLASSIFIED` remains only for Securities no path could classify."

### 4.4 Spec (`spec-DepotManagement`, via its memlog)

- CAP-13 success: add "Fonds".
- CAP-15 success: replace "an unpaired one is flagged for review" with "an unpaired TransferIn becomes a delivery at Parqet's cost; the migration completes without per-row decisions".
- glossary.md **Security**: add fund and ETC under ETF.

### 4.5 UX (`EXPERIENCE.md`)

- Composition donut row: asset-type toggle lists "ETF · Fonds · Aktie · Zertifikat · Krypto · Guthaben".
- Flow 4 step 3–4: "Preview shows … flagged rows (unpaired transfers, non-EUR, unclassified Securities) … He classifies the flagged Securities and resolves flagged rows." → "Preview shows counts per type, detected splits, ISIN changes and deliveries, the estimated asset type per Security, and a collapsed list of rows that will not be taken over. He confirms with one click."

### 4.6 Sprint tracking

- Add `2-5-hands-off-parqet-migration: backlog` to `sprint-status.yaml` (regenerated from `epics.md`; existing statuses preserved).

## 5. Implementation Handoff

**Scope: Moderate** — backlog addition plus artifact amendments; no replan.

| Who | Does |
| --- | --- |
| Claude (this session, correct-course) | Apply the approved edits to `epics.md`, PRD, spine (+ memlog), spec (+ memlog), EXPERIENCE.md; regenerate `sprint-status.yaml`; commit |
| bmad-loop (`bmad-build-auto`) | Implement Story 2.5 (`bmad-loop run --story 2-5`) |
| Tommy | After 2.5: export each Parqet portfolio, run the migration per Depot, check the summary, then `bmad-loop confirm 2-4-confirm-migration-and-reconcile-with-parqet` |

**Success criteria.** On the real export: no mandatory decisions; the 2020-01-09 deliveries booked as Positions with Parqet's cost; Positions, invested capital and Cash Account match Parqet at export date; types correctable later.

## Addendum A — Cash-less Exports and Depot Deletion (approved 2026-10-25)

**Trigger.** After Story 2.5, the real cominvest migration left the Cash Account at about −26.000 €. The Cash Account tab shows only buys and sells: the Parqet portfolio was filled by comdirect/cominvest autosync and the export contains no `Cash` rows, so every buy debits cash and no deposit ever funds it. A Depot with Transactions can neither be archived nor deleted, so the migration cannot be redone.

**Change.** New Story 2.6 "Funding for Exports without Cash Rows and Depot Deletion": minimal same-day funding deposits for cash-less exports (cash never negative, deposits are external inflows), and "Depot löschen" with typed confirmation through the ledger. Amended: AD-6 (spine), PRD FR-15 consequences, SPEC CAP-15, EXPERIENCE.md Settings and Flow 4 note, epics FR15 inventory and coverage map. Sprint status gains `2-6-...: backlog`.

**Handoff.** bmad-loop builds 2.6; then Tommy deletes the cominvest Depot, recreates it, re-runs the migration and aligns the final balance with the broker value.

## Addendum B — Robust Cash Pairing and Rounding Tolerance (approved 2026-10-25)

**Trigger.** Migrating the DB ROBIN export stopped with "Zeile 225 (Verkauf vom 05.02.2025): Verkauf übersteigt Bestand (8,5052 Stück)". A local read-only analysis of all three real exports (with the user's permission; nothing copied into the repository) found: 17 `cash-pair-mismatch` flags (ROBIN 5, finanzen.net zero 12) whose trades were skipped, causing three later oversells (IBM, Nestlé, IE00BGYWT403), plus one rounding oversell of 0.0008 units (Parqet rounds sell quantities; it later corrects itself with a 0.0016 buy and a 0.0008 sell). Mismatch patterns: cash row omits the fee; cash row lower than a sell's amount (withheld tax not in the row); dividend cash row differs from amount and tax; a ROBIN rebalancing instant with nine trades and a single net cash row.

**Change.** New Story 2.7: group cash pairing per instant; trades always booked with Parqet's figures; group differences above €0.01 booked as one standalone TAX Transaction; sells exceeding the holding by ≤ 0.001 units clamped with the shortfall carried to the next buy. Amended: AD-6, PRD FR-15 consequences, SPEC CAP-15, EXPERIENCE.md Flow 4 notes, epics FR15 inventory and coverage map. Sprint status gains `2-7-...: backlog`.

**Handoff.** bmad-loop builds 2.7; Claude re-runs the local scan against the real exports (expect zero flags and zero oversells); Tommy then migrates ROBIN and finanzen.net zero and confirms Story 2.4.

## Addendum C — Missing Deposits and Fee-Aware Gain Comparison (approved 2026-10-25)

**Trigger.** After Story 2.7, an end-to-end migration of all three real exports into a throwaway database (local only) booked everything (0 flags, Positions and invested capital equal to Parqet) but left the DB ROBIN Cash Account at −7.947,51 € and finanzen.net zero at −5.340,39 € (both equal to Parqet's own balances; running minimum −11.963,28 €): Parqet's cash rows lack the user's deposits. Story 2.7 booked inflow-side group differences (e.g. a ROBIN savings contribution of ~1.760 € invested directly) as negative TAX, totalling −1.879,97 € "refunds" for ROBIN. Realized-gain comparison at finanzen.net zero showed 50/90 deviations, almost all exactly −1 € or −2 € (the app deducts order fees; Parqet's `realizedgains` does not).

**Change.** New Story 2.8: inflow-side group differences → DEPOSIT, outflow-side → TAX; minimal funding for every export; fee-explained gain differences shown as "Gebühren". Amended: AD-6, PRD FR-15 consequences, SPEC CAP-15, EXPERIENCE.md Flow 4 notes, epics FR15 inventory and coverage map. Sprint status gains `2-8-...: backlog`.

**Handoff.** bmad-loop builds 2.8; Claude re-runs the throwaway end-to-end migration (expect no negative cash, no negative TAX from contributions, only non-fee gain deviations); Tommy then migrates all three Depots, aligns each Cash Account to the broker balance and confirms Story 2.4.

## Addendum D — Security Detail Page and All-time Performance (approved 2026-10-26)

**Trigger.** Before starting Epic 4, Tommy asked for a detail view per Security: news, price history, the history of buys and sells across his Depot(s), and the Gain/Loss over all time. Planned Story 4.6 covered a per-Position page with Period figures only; it lacked a cross-Depot view, pages for fully sold Securities, all-time results and a price chart with trades.

**Change.** New FR-19 / CAP-19 "Security detail". Story 4.6 rewritten as "Security Detail Page" (one page per Security, Depot switcher "Alle Depots"/single Depot, also for sold Securities, Transactions with Depot). New Story 4.7 "All-time Performance and Price Chart with Trades" (card "Gesamt seit Erstkauf" with realized, unrealized, dividends, fees, taxes, total, % return and Security XIRR; chart toggle Kurs/Wert with buy and sell markers). Amended: AD-10 (Security-level figures), spine capability map, PRD FR-19, SPEC CAP-19, EXPERIENCE.md (Position detail → Security detail), epics inventory and coverage map. Sprint status: `4-6-position-detail` replaced by `4-6-security-detail-page`, plus `4-7-...: backlog`.

**Also fixed.** Stories 2.5–2.8 had been inserted into the Epic List section of `epics.md` (an anchor matched the list heading `### Epic 3`); they now sit in the Epic 2 section. Content unchanged.

## Addendum E — finanzen.net zero Document Import (approved 2026-10-26)

**Trigger.** After the ROBIN import worked, Tommy asked for finanzen.net zero as well. The PRD had kept it manual only because Parqet supported neither sync nor import for it — a parity assumption, not a requirement; SM-C1 is satisfied by Tommy's named use.

**Change.** New Story 5.5 "finanzen.net zero / Baader Bank Parser" (buy, sell, dividend, fund distribution, tax refund as TAX, tax-pot notices without booking, corporate-action notices rejected with a hint). Seven anonymised real-layout fixtures under `test/fixtures/import/finanzen-zero/` (approved by Tommy). Amended: PRD FR-4 consequence, SPEC CAP-4 and non-goals, spine Deferred note, epics FR4 inventory, Epic 5 goal and coverage map. Sprint status gains `5-5-...: backlog`.

## Addendum F — Depot Reconciliation and Holding Corrections (approved 2026-10-26)

**Trigger.** Tommy saw holding differences against his brokers (~3.000 € vs Parqet) and had no way to reconcile. A read-only comparison of the local database with the Parqet exports showed the app matches Parqet exactly at each export date; differences come from trades after the exports (5 ROBIN imports on 26.10.) and from the cominvest Parqet export ending on 02.09.2026 (autosync stopped), plus price-source differences. Tommy still needs a way to check every holding against the real statement and fix genuine errors.

**Change.** New FR-20 / CAP-20 and Story 2.9 "Depot Reconciliation and Holding Corrections": persisted reconciliation run per Depot (statement date, statement values, checks, progress, explicit "Abgleich abschließen", next run starts empty), "Buchungen ansehen" with duplicate hints, holding correction as new Transaction type `ADJUSTMENT` (no cash, no realized gain, external flow in returns), cash correction as Deposit/Withdrawal. Amended: AD-14 (spine), PRD FR-20, SPEC CAP-20, epics inventory, Epic 2 coverage and map. Sprint status gains `2-9-...: backlog`.

## Addendum G — ISIN Changes from Broker Documents (approved 2026-10-26)

**Trigger.** Importing the real finanzen.net zero documents, only the "Obligatorischer Umtausch" (Fresenius DE0005785604 → DE000FRE5EN2, 13.08.2026, already recorded by the Parqet migration) ended as "fehlgeschlagen" with a "Manuell erfassen" button that opens the trade form — a path to a wrong booking.

**Change.** New Story 5.6: ISIN-change notices are parsed into ISIN-change proposals; review status "Kapitalmaßnahme"; already recorded changes show "Bereits erfasst"; otherwise "Als ISIN-Wechsel buchen" records them via the ledger ISIN-change service; no trade form for corporate-action notices. Amended: PRD FR-4 consequence, SPEC CAP-4, epics FR4 coverage. Sprint status gains `5-6-...: backlog`.

## Addendum H — Analyses (approved 2026-10-26)

**Trigger.** Tommy wants Parqet-style analyses: allocation by region, sector and more, and gains/losses per month and year. Research (Parqet blog, reviews) listed Parqet's views: eight allocation dimensions as donuts, a return heatmap years × months, realized gains per month, dividend views and calendar, X-Ray. Tommy uses all of them occasionally; ETFs and funds classified as a whole are enough for now, X-Ray later.

**Change.** New Epic 7 "Analyses" with Stories 7.1 (Security classification: Yahoo for stocks, rules table for ETFs/funds, certificates via underlying, manual override), 7.2 (allocation donuts with drill-down), 7.3 (return heatmap), 7.4 (realized gains, best/worst sales, cash flow), 7.5 (dividend analysis with 12-month income and estimate). New FR-21/FR-22, CAP-21/CAP-22, AD-20 (classification module, manual precedence), navigation entry "Analysen". PRD out-of-scope narrowed to X-Ray only. Sprint status gains epic-7 and its stories.

## Addendum I — Drawdown (approved 2026-10-27)

**Trigger.** Tommy likes Parqet's drawdown view next to the value chart: it shows losses over time and gives a sense of risk.

**Change.** New Story 7.6 "Drawdown": chart tabs "Wertentwicklung | Drawdown" on Overview and Depot detail, global Period; drawdown of the time-weighted performance index from its running peak (flow-neutral); KPIs current and maximum drawdown, duration and dates of the maximum phase; one pure core function with a hand-calculated reference test. FR-22/CAP-22 extended, EXPERIENCE.md chart tabs added. Parqet's "Dividenden" chart tab is covered by Story 7.5. Sprint status gains 7-6-drawdown; epic-7 back to in-progress.

## Addendum J — Dividend Charts (approved 2026-10-27)

**Trigger.** Tommy likes Parqet's dividend charts: monthly bars broken down by Security with hover, a year-over-year cumulative comparison with forecast, and a per-Security breakdown.

**Change.** New Story 7.7 "Dividend Charts": monthly bars stacked by Security ("Monatlich (pro Jahr)", "Monatlich (fortl.)") with segment hover, "Akkumuliert (pro Jahr)" lines with a "Prognose" switch, "Breakdown" with Security selector and KPIs (month, since January, personal dividend yield on Cost Basis). Story 7.5 views stay. FR-22/CAP-22 wording extended, EXPERIENCE.md Analysen row updated. Sprint status gains 7-7-dividend-charts.

**Amendment to Addendum I (2026-10-27).** Story 7.6 also covers Security detail: a "Drawdown" option in the chart toggle, measured on split-adjusted prices so splits are not drops, with the same KPIs and markers.

## Addendum K — Security Analyses (approved 2026-10-27)

**Trigger.** Tommy wants Parqet's per-Security analyses: performance heatmap (quarters/months) and the chart tabs Performance and Kurs with moving average.

**Change.** New Story 7.8 "Security Analyses" on Security detail: Position heatmap (TTWROR, Q | M, link to the Portfolio heatmap), chart option "Performance" (cumulative TTWROR %), optional moving-average overlay (200/38 days) on "Kurs". Reuses the Story 7.3 core heatmap. FR-22 wording and EXPERIENCE.md Security detail row extended. Sprint status gains 7-8-security-analyses.

**Amendment to Addendum J (2026-10-27).** After use, Tommy found "Monatlich (fortl.)" and "Breakdown" cluttered: both views are removed; "Monatlich (pro Jahr)" gets a year switcher (year field with previous/next arrows) in its card header. Core keeps the per-Security yield on cost (unused by the UI for now).

## Addendum L — News Teasers (approved 2026-10-27)

**Trigger.** News links jump straight to overloaded websites; Tommy wants a short text readable in the app first. Google News RSS (98 % of current items) carries no text, and its links pass a consent wall and JS redirect that we will not circumvent. Research: Yahoo Finance RSS per ticker delivers 2–4-sentence descriptions (German for .DE symbols) for stocks and crypto, nothing for ETFs; finanznachrichten.de (empty descriptions, headline-only terms), onvista, finanzen.net, Finnhub (US only), Alpha Vantage (premium), NewsAPI (no production use), Marketaux/EODHD (tiny free tiers) ruled out.

**Change.** New Story 3.8 "News Teasers": Yahoo Finance RSS provider with teaser, name filter, 14-day window; Google News kept headline-only; de-duplication prefers teaser items; expandable items with "Zum Artikel". FR14/FR-14, CAP-14, AD-11 (no scraping, no circumvention), EXPERIENCE.md News row updated. Sprint status gains 3-8-news-teasers.

## Addendum M — Planning & Taxes (approved 2026-10-27)

**Trigger.** Tommy picked further features: home-screen app, benchmark comparison (indices and Depot vs Depot), tax preview with Freistellungsauftrag per broker, and robo-advisor-style target allocation with rebalancing (buys and sells). His holdings include 7 global funds, so a region split for global ETFs is needed for regional targets.

**Change.** New Epic 8 "Planning & Taxes" with Stories 8.1 (home-screen app), 8.2 (benchmark comparison), 8.3 (tax preview with Freistellungsauftrag), 8.4 (region weights for global funds), 8.5 (target allocation and rebalancing). New FR-23..FR-26, CAP-23..CAP-26, AD-21 (advisory tax estimates from one core function); AD-17 (benchmark Securities priced, never held) and AD-20 (region split for global funds) amended. Out of scope: church tax, loss carry-forwards, Vorabpauschale, foreign withholding tax credit. Sprint status gains epic-8 and its stories; 8.5 depends on 8.3 and 8.4.

## Addendum N — Watchlists and Claude Connector (approved 2026-10-28)

### N.1 Issue summary

**Trigger.** New requirement from Tommy (no story involved). He wants to park investment ideas on several watchlists, watch their prices without buying, and drop an idea when he no longer believes in it. Ideas often come out of research with Claude, so Claude (Desktop and Code on the Mac, the Claude app on iOS) shall manage the watchlists directly. In a second step Claude shall read Depots, holdings and Transactions for risk and strategy analyses, as Tommy does today with Parqet's MCP.

**Category.** New requirement emerged from stakeholder. Named personal use (SM-C1): idea tracking from Claude research; portfolio analyses with Claude replacing the Parqet MCP.

**Decisions taken with Tommy (2026-10-28).**
- Several named watchlists; full create/edit/delete of lists and entries, in the app and from Claude.
- An entry is a Security (ISIN or crypto symbol) with a note and the date added; the list looks like the Depot positions list; a click opens the Security detail page with what makes sense without a holding.
- Same Security on several lists, at most once per list; entries of held Securities show "im Bestand"; watchlist Securities get Prices and news.
- Watchlists are part of export/restore and backup. No buy action from the watchlist.
- Claude connects via an MCP server inside the app with OAuth: Tommy adds the URL in Claude, our login page appears, he signs in with his normal credentials and confirms; Claude stores the issued token. Connected apps are listed in Settings and can be removed. No separate static API token and no separate REST API — MCP is the API.
- **Policy change (deliberate):** Tommy may grant a connected app read-only access to all portfolio data. He accepts the disclosure risk ("only information; worst case someone knows what is in my Depot"). Writes to the ledger via MCP stay excluded.

### N.2 Impact analysis

- **Epics 1–8:** done, no rework. New **Epic 9** (Watchlists & Claude Connector, Stories 9.1–9.5) and **Epic 10** (Portfolio Access for Claude, Stories 10.1–10.2). Epic 10 depends on 9.4/9.5.
- **PRD / Spec:** new FR-27..FR-29 / CAP-27..CAP-29; privacy constraint and NFR2/NFR3 amended; non-goal "Multi-user, sharing" unchanged (the MCP client acts for Tommy only).
- **Architecture:** AD-2 (new modules `watchlist`, `mcp`), AD-12 (watchlists in export), AD-13 (OAuth bearer tokens for MCP; outbound policy amended), AD-17 (watchlist Securities priced and in news, never held), AD-18 (`APP_URL`); new **AD-22** (MCP server and OAuth); Stack gains `@modelcontextprotocol/sdk` (exact pin chosen in 9.4); module graph and capability map extended.
- **UX:** EXPERIENCE.md Information Architecture (Watchlists surface, Security detail without holding, Settings › Verbundene Apps, OAuth consent page), navigation (drawer and "Mehr"); DESIGN.md unchanged (existing components).
- **Technical:** Prisma migrations for watchlist and OAuth tables; auth proxy (`src/proxy.ts`) lets `/.well-known/oauth-*`, `/oauth/*` and `/api/mcp` through (the routes check their own credentials); export `schemaVersion` bump; README section "Claude verbinden". Nginx needs no change (HTTPS already terminates there).

### N.3 Recommended approach

**Direct Adjustment** — add Epics 9 and 10, amend artifacts in place. No rollback, MVP unchanged.
- Effort: Medium–High (seven stories; 9.4 is the largest).
- Risk: Medium, concentrated in 9.4 (OAuth). Mitigation: follow the MCP authorization spec (OAuth 2.1, PKCE S256, RFC 8414/9728/7591), opaque hashed tokens, tests for every flow step and rejection path, dedicated review of 9.4.
- Sequence: 9.1 → 9.2 → 9.3 → 9.4 → 9.5 → 10.1 → 10.2. After 9.5 Tommy can use the watchlists from Claude on Mac and iOS.

### N.4 Stories (`epics.md`, new Epics 9 and 10)

```
## Epic 9: Watchlists & Claude Connector

Tommy parks investment ideas on watchlists, follows their prices and news without holding them, and lets Claude manage the watchlists through an MCP connector secured with his own login.

### Story 9.1: Watchlists and Entries

As Tommy,
I want several watchlists with the Securities I am considering,
So that I can park ideas, watch them and drop them when I no longer believe in them.

**Acceptance Criteria:**

**Given** the new surface "Watchlists" (drawer between Wertpapiere and Einstellungen; under "Mehr" on phones)
**When** I create, rename or delete a watchlist (name required, unique, ≤ 60 characters; deleting a non-empty list asks for confirmation naming the list and its entry count)
**Then** the lists appear as tabs (a select on phones) in the order created, the last opened list is remembered per browser, and an empty state offers "Watchlist anlegen"
**And** "Wertpapier hinzufügen" opens a form with the Security Autocomplete of the Transaction form (ISIN, crypto symbol or name; "Neue Security anlegen" for an unknown ISIN creates it through `ledger.ensureSecurity`, AD-16), a note (plain text, ≤ 2000 characters) and the date added (default today, editable)
**And** a Security already on that list is refused with "Steht schon auf dieser Liste"; it may stand on other lists
**And** an entry can be edited (note, date added, move to another list) and removed; removing never deletes the Security or its Prices
**And** the list shows per entry: logo, name, ISIN/symbol, current Price with stale badge, change today (% and €/unit), change since added (% from the resolved Price on the date added, AD-9 carry-forward; "–" without a Price), date added, the first line of the note, and a chip "im Bestand" when `heldSecurities` contains it; sortable by name, change today, change since added and date added (default date added, newest first); stacked rows on phones
**And** watchlist Securities join the price targets like benchmarks (AD-17 amended): history back to the earlier of the `3J` preset start and the earliest date added; a Security that leaves every list and is not held stops being fetched, its stored Prices stay
**And** the `watchlist` module owns Watchlist and WatchlistEntry (AD-2); "since added" and the sorting are pure core functions with unit tests (incl. a split after the date added, which uses split-adjusted Prices)

### Story 9.2: Security Detail without a Holding

As Tommy,
I want to open a watchlist Security like a Position,
So that I can judge the idea with chart, news and classification.

**Acceptance Criteria:**

**Given** a click on a watchlist entry, or any Security never held
**When** the Security detail page (Story 4.6) opens
**Then** it shows the header with Price, stale badge and change over the global Period, the price chart over the Period with the moving-average overlay of Story 7.8, news of the last 14 days (watchlist Securities are added to the news set, AD-17 amended), the classification (AD-20), and a card "Auf Watchlists" listing each list with date added, change since added and the full note (editable inline through the 9.1 form)
**And** blocks that need a holding or Transactions (Position, all-time result, Transaction history, dividends, per-Security heatmap and performance) are omitted, not shown empty; a Security that was held keeps them
**And** every Security detail page gets "Zur Watchlist" (choose list, note, date) and, when on lists, the list chips
**And** the Securities page marks Securities that are only on watchlists ("Watchlist") so they are not mistaken for holdings

### Story 9.3: Watchlists in Export and Restore

As Tommy,
I want my watchlists in the export and backup,
So that my ideas survive a restore or a move to the server.

**Acceptance Criteria:**

**Given** the export of Story 6.1
**When** I export
**Then** the file contains all Watchlists with their entries (Security reference, note, date added, position) and its `schemaVersion` is increased
**And** restore replaces watchlists together with the ledger in the same DB transaction (AD-12); an older file without watchlists upgrades to empty watchlists through a pure upgrade function
**And** OAuth clients and tokens are not exported; after a restore every connected app must reconnect (stated in the restore confirmation text)
**And** an export → restore round-trip test covers watchlists, including a Security that is only on a watchlist

### Story 9.4: Claude Connector with Login (MCP + OAuth)

As Tommy,
I want to add DepotManagement as a connector in Claude and sign in with my own login,
So that Claude can manage my watchlists from the Mac and from my iPhone.

**Acceptance Criteria:**

**Given** the app reachable over HTTPS at `APP_URL`
**When** I add `APP_URL/api/mcp` as a custom connector in Claude (Desktop, claude.ai, iOS) or via `claude mcp add --transport http`
**Then** an unauthenticated request to `/api/mcp` gets 401 with `WWW-Authenticate: Bearer resource_metadata=…`; `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414) describe the server; Claude registers itself through dynamic client registration (RFC 7591, `/oauth/register`)
**And** `/oauth/authorize` requires PKCE S256 and an exactly registered redirect URI (HTTPS, or `http://localhost`/`127.0.0.1` for Claude Code); without a session it shows the existing login and returns; then a consent page "„<Client-Name>“ möchte deine Watchlists lesen und ändern" with the redirect host and buttons Erlauben / Ablehnen
**And** `/oauth/token` exchanges the code (single use, 10 minutes) for an opaque access token (1 hour) and a rotating refresh token (90 days); a reused refresh token revokes the whole grant; tokens and codes are stored only as SHA-256 hashes and never logged
**And** `/api/mcp` (Streamable HTTP, stateless) offers the tools `list_watchlists`, `get_watchlist`, `create_watchlist`, `rename_watchlist`, `delete_watchlist` (non-empty only with `confirm_name` equal to the list name), `add_watchlist_entry` (ISIN or crypto symbol, optional name, note, date; an unknown ISIN is resolved through OpenFIGI, else refused with a reason), `update_watchlist_entry`, `remove_watchlist_entry`, `search_securities`; entries carry name, ISIN/symbol, note, date added, current Price, change since added and stale flag; decimals as strings, dates `YYYY-MM-DD`
**And** every tool goes through the `watchlist` service (validation identical to the app); entries created via MCP record source `mcp` and the client name, shown as a small "via Claude" in the list
**And** the auth proxy lets exactly these OAuth and MCP paths through; every other route still requires the session cookie; the `mcp` module owns OAuthClient, OAuthGrant and OAuthToken (AD-2, AD-22)
**And** tests cover discovery, registration, authorize with and without session, PKCE failure, wrong redirect URI, code reuse, expiry, refresh rotation and reuse, revoked token, and each tool; the README gains "Claude verbinden" (Desktop/claude.ai/iOS connector, Claude Code command)

### Story 9.5: Connected Apps in Settings

As Tommy,
I want to see which Claude clients are connected and remove them,
So that I keep control over access to my data.

**Acceptance Criteria:**

**Given** Settings › "Verbundene Apps"
**When** I open it
**Then** each grant shows client name, redirect host, granted scopes in plain German, connected since and last used (updated at most once per minute); an empty state explains how to connect Claude
**And** "Trennen" (confirm naming the client) revokes the grant and all its tokens immediately — the next MCP call gets 401; "Alle trennen" does the same for all grants
**And** a revoked client can reconnect through the normal login and consent

## Epic 10: Portfolio Access for Claude

Tommy lets a connected Claude read his Depots, holdings, Transactions and figures for risk and strategy analyses. Read-only; the figures are the same the app shows.

### Story 10.1: Portfolio Read Permission

As Tommy,
I want to decide per connection whether Claude may read my portfolio,
So that I share my financial data only where I choose to.

**Acceptance Criteria:**

**Given** the consent page of Story 9.4
**When** Claude requests the scope `portfolio:read` in addition to `watchlist`
**Then** the consent page shows a checkbox "Darf auch Depots, Bestände, Umsätze und Kennzahlen lesen (nur lesen)", off by default; only a checked box grants `portfolio:read`
**And** Settings › Verbundene Apps shows the scope per grant and lets me remove `portfolio:read` from a grant without disconnecting; adding it again requires a new consent
**And** a tool needing `portfolio:read` called without it returns an MCP error "Keine Berechtigung für Depotdaten" and no data

### Story 10.2: Portfolio Read Tools

As Tommy,
I want Claude to read my Portfolio, Depots, Positions, Transactions and figures,
So that I can run risk and strategy analyses with Claude instead of Parqet.

**Acceptance Criteria:**

**Given** a grant with `portfolio:read`
**When** Claude calls the read tools
**Then** these tools exist: `get_portfolio_summary` (value, invested capital, cash, Gain/Loss realized/unrealized, dividends, taxes, TTWROR, XIRR for a Period preset or from/to), `list_depots` (incl. archived flag and broker), `get_depot`, `list_positions` (Portfolio or Depot: quantity, Price, stale, value, Cost Basis, Gain/Loss, share, asset type), `list_transactions` (filters Depot, date range, type, Security; paginated by cursor, at most 500 rows per call), `get_performance` (daily or monthly value and invested-capital series, TTWROR series, optional benchmark), `get_allocation` (dimension as in Story 7.2), `get_income` (dividends and realized gains per month/year), `get_security` (Security detail incl. all-time result and classification)
**And** every figure comes from the same module and core functions as the UI (AD-1); a test compares each tool's result with the corresponding page loader on a fixture ledger
**And** no MCP tool writes ledger, prices, classification, tax or target data; the tool list contains no such tool (test)
**And** with `portfolio:read`, watchlist entries additionally carry `held: true|false`
**And** amounts are decimal strings in EUR, dates `YYYY-MM-DD`; responses never include credentials, session data or other connections' data
```

**Requirements inventory (`epics.md`):** FR27–FR29 added (see N.5); NFR2 → "financial data stays on Tommy's machine/server except read-only access Tommy grants to a connected MCP client; no third-party analytics"; NFR3 → "… every page and route; the MCP endpoint requires an OAuth access token issued after the same login"; coverage map: FR27 Epic 9 (9.1–9.3), FR28 Epic 9 (9.4, 9.5), FR29 Epic 10 (10.1, 10.2).

### N.5 PRD (`prd.md`) and Spec (`SPEC.md` + memlog)

New PRD §4.10 "Watchlists & Claude":
- **FR-27 Watchlists** — Tommy can keep several named watchlists of Securities he does not need to hold, each entry with a note and the date added, see Price, change today and since added, open the Security detail, and has them in export/restore.
- **FR-28 Claude connector** — Tommy can connect Claude (Desktop, Code, iOS) to the app via MCP with OAuth using his login, let it create, edit and delete watchlists and entries, and see and revoke connections in Settings.
- **FR-29 Portfolio access for Claude** — per connection, Tommy can grant read-only access to Depots, Positions, Transactions and figures; nothing is written via MCP.

Spec: CAP-27..CAP-29 with these intents; success: CAP-27 "since added uses the resolved Price on the date added; a Security appears at most once per list; watchlists survive export → restore"; CAP-28 "Claude on Mac and iOS connects with Tommy's login only; a removed connection's next call is rejected"; CAP-29 "figures returned equal the app's; no tool writes". Constraint "Financial data stays on Tommy's machine/server; …" → "Financial data stays on Tommy's machine/server, except read-only access Tommy explicitly grants to a connected MCP client; …". PRD §5 Privacy & security amended alike. Glossary: **Watchlist**, **Watchlist entry**, **Connected app** (an OAuth-authorised MCP client acting for Tommy).

### N.6 Architecture spine (IDs stable, amended in place)

- **AD-2** ownership adds `watchlist` — Watchlist, WatchlistEntry; `mcp` — OAuthClient, OAuthGrant, OAuthToken. Module graph: `watchlist --> ledger`, `watchlist --> prices`, `mcp --> watchlist`, `mcp --> ledger`, `mcp --> prices`, `mcp --> classification`, `mcp --> auth`.
- **AD-12** export adds Watchlists with entries; OAuth data excluded (connections must be re-established after restore).
- **AD-13** Rule: "Access requires the in-app single-user login … on every page and route except login." → "… except login, the OAuth endpoints and `/api/mcp`, which accepts only an OAuth access token issued after that login (AD-22)." and "Outbound requests carry only provider symbols, ISINs or company names — never quantities, values or Depot data." → "Outbound requests to providers carry only provider symbols, ISINs or company names. Financial data leaves the server only as responses to a connected MCP client holding `portfolio:read` (AD-22)."
- **AD-17** append: "Watchlist Securities are priced like benchmarks and are in the news set, but are never held: they appear in no Position, total or analysis."
- **AD-18** env list adds `APP_URL` (public base URL, OAuth issuer and resource).
- **AD-22 (new) — Claude connects through one MCP endpoint with OAuth and scoped, read-mostly access.** Binds FR-28, FR-29. Prevents: a second, unaudited API; long-lived secrets in Claude configs; MCP computing figures differently from the UI; Claude writing the ledger. Rule: The `mcp` module serves one Streamable-HTTP MCP endpoint `/api/mcp` and an OAuth 2.1 authorization server per the MCP authorization spec (RFC 8414 and 9728 metadata, RFC 7591 dynamic registration, PKCE S256 only, exact redirect URI match). Authorization reuses the single-user login and shows a consent page; access tokens are opaque, short-lived, refresh tokens rotate, all stored as hashes, revocable per grant from Settings. Scopes: `watchlist` (read/write watchlists through the `watchlist` service) and `portfolio:read` (read-only, opt-in per grant). Tools are thin adapters over module services and core; they never compute financial figures themselves and no tool writes ledger, prices, classification, tax or target data. Tokens, codes and tool payload amounts are never logged.
- **Stack:** `@modelcontextprotocol/sdk` (exact pin, chosen in Story 9.4). **Capability map:** FR-27 → `modules/watchlist`, `core` (AD-1, AD-9, AD-17); FR-28/29 → `modules/mcp` (AD-2, AD-13, AD-22).

### N.7 UX (`EXPERIENCE.md`)

- Information Architecture: new row **Watchlists** (Nav drawer; "Mehr" on phones; tabs per list, entries table as in 9.1, "Wertpapier hinzufügen", empty state) — CAP-27; Security detail row notes the reduced layout without holding and the "Auf Watchlists" card; Settings row adds "Verbundene Apps" — CAP-28/29; new row **OAuth consent** (outside the app shell, like login: client name, redirect host, scopes, portfolio checkbox off by default, Erlauben/Ablehnen).
- Responsive: drawer list adds "Watchlists"; "Mehr" adds "Watchlists".
- Voice examples: "Steht schon auf dieser Liste", "„Claude“ getrennt."

### N.8 Sprint tracking

Add `epic-9` (9-1-watchlists-and-entries, 9-2-security-detail-without-a-holding, 9-3-watchlists-in-export-and-restore, 9-4-claude-connector-with-login-mcp-oauth, 9-5-connected-apps-in-settings, epic-9-retrospective) and `epic-10` (10-1-portfolio-read-permission, 10-2-portfolio-read-tools, epic-10-retrospective), all `backlog`.

### N.9 Handoff

**Scope: Moderate** — backlog addition plus artifact amendments, one deliberate policy change.

| Who | Does |
| --- | --- |
| Claude (correct-course) | Apply N.4–N.8 to `epics.md`, PRD, spec (+ memlog, glossary), spine, EXPERIENCE.md, `sprint-status.yaml`; commit |
| bmad-loop | Implement 9.1–9.5, then 10.1–10.2 |
| Tommy | Set `APP_URL` in the server env file before deploying 9.4; connect Claude Desktop/iOS and Claude Code; confirm stories needing operator checks (9.4, 9.5, 10.2) |

**Success criteria.** Claude on Mac and iPhone connects with Tommy's login only and adds an idea that appears in the app with price and "since added"; removing the connection blocks the next call; with `portfolio:read` Claude's figures equal the app's; nothing is written to the ledger via MCP.
