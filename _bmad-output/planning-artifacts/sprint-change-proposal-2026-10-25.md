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
