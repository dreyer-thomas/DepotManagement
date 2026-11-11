# Sprint Change Proposal — Price Marks and News Context ("Kursmarken")

- **Date:** 2026-11-11
- **Author:** John (PM) with Tommy
- **Mode:** Batch
- **Scope classification:** Moderate (new epic added to the backlog; one new AD, one AD amendment)
- **Status:** Approved by Tommy 2026-11-11; edits applied

## 1. Issue Summary

Tommy follows stop-loss and price-target recommendations from newspapers, analysts and other analyses for stocks he holds or watches. Today he keeps them as free text in watchlist notes, if anywhere. Nothing tells him when a stock falls below its stop or rises above its target, so he notices it late or not at all.

The news list also lacks context. A headline about a stock does not show whether Tommy holds it or how the stock is moving today.

**Personal use (SM-C1):** react to stop and target levels of held and watched stocks; judge news against the current move.

**Decisions made with Tommy (2026-11-11):**

- **Price marks per Security:** a stop and a target, each optional, with an optional source text ("Börse Online, 03.11.") and the date set. They apply to held and watched Securities alike and are set on the detail page and in the watchlist entry dialog.
- **Trailing stop:** the stop can instead trail the highest close since it was set by a fixed percentage (e.g. 15 % below the high).
- **Warning without acknowledgement:** a warning shows as long as the latest Price is beyond the mark. It disappears only when the Price returns or Tommy changes or removes the mark. There is no "quittieren".
- **Analyst target as a suggestion:** when setting a target, the mean analyst price target (Story 9.7) is offered as a one-click suggestion, in the detail page and in the watchlist dialog.
- **News context:** each news item shows "im Depot" for held Securities and the change today in % for every Security with Prices.
- **Claude:** can read the marks and their state and, under the `watchlist` scope, set them. For example, Tommy can ask Claude to move the targets already written in his watchlist notes into proper marks.
- **Warnings appear in the app only.** There is no push or e-mail; that would need infrastructure the app does not have.

**Evidence and constraints found in the codebase:**

- Prices are stored as **EUR closes** (AD-9; currency is implicit EUR). Marks are therefore entered and compared in EUR. The analyst target is stored in the listing's quote currency (`core/analyst-ratings`) and is offered as a suggestion only when that currency is EUR. Otherwise it is shown as a hint with its currency ("Analystenziel 245 USD") and is not converted.
- Stored Prices are unadjusted, as-traded closes. A split would make a stored stop fire falsely, so marks are compared split-adjusted from their set date to today (`adjustedPrice`, the same as the watchlist "since added" figure).
- Only daily closes are stored, plus the latest fetch of the day. The check is on the latest resolved Price, not on intraday moves. The UI says so.
- `core/watchlist` already computes "change today" (`ChangeToday`: latest Price against the Price of the previous date) for watchlist entries. News reuses that function.
- No stop, target or alert concept exists yet. AD-22 forbids MCP writes to "target data"; that phrase means rebalancing targets and needs a clarification for price marks.

## 2. Impact Analysis

### Epic impact

- **Epics 1–11:** no change to completed work.
- **New Epic 12 "Kursmarken"** with 5 stories.

### Story impact

- **Stories 3.7, 3.8 / CAP-14 (news):** extended by Story 12.1 (display only).
- **Story 9.1 (watchlist entry dialog):** extended by Story 12.2 with the mark fields.
- **Stories 6.1, 6.2, 9.3 (export/restore):** extended. Marks are user data and go into the backup.
- **Stories 9.4, 10.2 (`get_watchlist`, `get_security`):** extended by Story 12.5 with additive payload fields; one new write tool.

### Artifact conflicts

| Artifact | Change |
| --- | --- |
| SPEC.md | CAP-14 success gains held marker and change today. New CAP-31 (price marks). Non-goal: push/e-mail alerts and broker orders. |
| ARCHITECTURE-SPINE.md | New AD-24 (price marks). AD-2 ownership adds `marks`. AD-22 clarified: `set_price_marks` under `watchlist` scope. Map row; `binds` gains FR-31. |
| epics.md | FR14 amended; FR31, AR24, UX-DR23 added; coverage map, Epic List, Epic 12 section. |
| EXPERIENCE.md | News row, dashboard row, securities list, watchlist, Security detail row. |
| DESIGN.md | No new tokens. Stop line uses `loss`, target line `gain`; the warning pill uses `stale-soft`/`stale`. |
| sprint-status.yaml | `epic-12` and its stories in `backlog`. |

### Technical impact

- **DB:** one new table `PriceMark` (one row per Security) via a new migration. No change to existing tables.
- **Core:** new pure module `src/core/price-marks.ts` (effective stop incl. trailing, split adjustment, breach state, distances).
- **Modules:** new module `marks` owning `PriceMark`, with a service for writes (app and MCP) and reads.
- **Backup:** export format gains `priceMarks`. Old exports without it restore unchanged.
- **MCP:** additive read fields plus one write tool under `watchlist` scope; nothing touches ledger or prices.
- **No new provider calls.**

## 3. Recommended Approach

**Direct Adjustment:** add Epic 12 to the backlog and implement it with the bmad loop. Nothing is rolled back.

- **Effort:**
  - Story 12.1 small.
  - Story 12.2 medium (model, core, two entry points, backup).
  - Story 12.3 small to medium (chart lines, card).
  - Story 12.4 medium (dashboard, securities list, watchlist).
  - Story 12.5 small.
- **Risk:** low. The main pitfalls are split adjustment and the trailing high; both are pure core functions with unit tests.
- **Order:** 12.1 is independent. Then 12.2 → 12.3 → 12.4 → 12.5.

## 4. Detailed Change Proposals

### 4.1 SPEC.md

**CAP-14 — success, append:**

```
Each item shows "im Depot" when the Security is held in a non-archived Depot and the change today in % when the Security has Prices.
```

**Capabilities — add after CAP-30:**

```
- **CAP-31** — Price marks
  - **intent:** Tommy can note a stop and a target price for any held or watched Security (e.g. from a newspaper or analysts) and is warned in the app when the latest Price falls below the stop or rises above the target, so he can reconsider.
  - **success:** A stop (fixed or trailing by %) and a target are kept per Security with source text and date set, in EUR and split-adjusted; the warning shows while the mark is breached and disappears only when the Price returns or the mark changes; breached marks are listed on the dashboard and flagged in the securities list, watchlists and detail page; the analyst mean target is offered as a suggestion; marks survive export/restore; Claude can read and set them.
```

**Non-goals — add:**

```
- Push, e-mail or other notifications outside the app; placing orders at a broker; intraday price monitoring.
```

### 4.2 ARCHITECTURE-SPINE.md

**AD-2 — ownership, append:** `` `marks` — PriceMark ``.

**AD-22 — rule, after "no tool writes ledger, prices, classification, tax or target data":**

```
("target data" means rebalancing targets; price marks are written through the `marks` service under the `watchlist` scope, AD-24).
```

**New AD-24** (after AD-23):

```
### AD-24 — Price marks are user reference data evaluated by one core function

- **Binds:** FR-31
- **Prevents:** a split firing a stop falsely; a trailing stop moving down; screens and Claude disagreeing about which marks are breached; marks feeding valuations.
- **Rule:** The `marks` module owns one PriceMark per Security: optional stop (fixed EUR price, or trailing percentage), optional target (EUR price), optional source text (≤ 200 characters) per mark, and the business date each was set. App and MCP write only through its service. One pure function in `core/price-marks` derives the state as of today from the marks, the Security's split-adjusted closes since the set date and the latest resolved Price (AD-9 resolver): effective stop (fixed, or highest close since set date × (1 − percentage), which never falls), distance of the latest Price to stop and target, and `breached ∈ {stop, target, none}`. Marks are compared in the units of today (`adjustedPrice` from the set date). The state is computed on read, never stored, and there is no acknowledgement. Marks never enter valuations, returns or tax. They follow an ISIN change to the successor Security and are part of export/restore (AD-12, export format additive).
```

**Capability → Architecture Map — add row:**

```
| FR-31 Price marks | `core/price-marks`, `modules/marks`, `modules/backup`, `app`, `modules/mcp` | AD-1, AD-9, AD-12, AD-22, AD-24 |
```

**Frontmatter:** `binds` gains `FR-31`. `change_log` gains `2026-11-11 sprint change: AD-24 added (price marks), AD-2/22 amended`.

### 4.3 epics.md

**FR14 — append:** `Each item shows whether the Security is held and its change today.`

**Functional Requirements — add after FR30:**

```
FR31: Tommy can set a stop (fixed or trailing by %) and a target price with source and date for any held or watched Security, see the distance to both, and is warned in the app while the latest Price is below the stop or above the target (dashboard, securities list, watchlists, detail page); the analyst mean target is offered as a suggestion; Claude can read and set the marks.
```

**Additional Requirements — add:**

```
- AR24 (AD-24): `marks` module owns PriceMark (one per Security); `core/price-marks` derives effective stop (trailing never falls), distances and breach state on read, split-adjusted from the set date; no acknowledgement; never input to valuations; in export/restore; MCP writes via the service under `watchlist` scope.
```

**UX Design Requirements — add:**

```
UX-DR23: Card "Kursmarken" on the Security detail page (both layouts) with stop and target rows "Stopp · 92,40 € · −7,4 %"; dashed horizontal lines in the price chart (stop `loss`, target `gain`, labelled); a breached mark shows a pill "Stopp unterschritten" / "Ziel erreicht" (`stale-soft`), always in words; dashboard card "Kursmarken erreicht" only when at least one mark is breached; news items show "im Depot" and the change today.
```

**FR Coverage Map — add:**

```
FR14 (amended): Epic 12 - Story 12.1
FR31: Epic 12 - Price marks, warnings, Claude (Stories 12.2–12.5)
```

**Epic List — add after Epic 11:**

```
### Epic 12: Kursmarken
Tommy notes stop and target prices for held and watched stocks and sees in the app when one is crossed, and news show whether he holds a stock and how it moves today.
**FRs covered:** FR14 (amended), FR31 · **Also:** AR1, AR9, AR12, AR22, AR24
```

**New section `## Epic 12: Kursmarken`:**

#### Story 12.1: News with Holding and Change Today

As Tommy,
I want each news item to show whether I hold the stock and how it moves today,
So that I can judge the headline at a glance.

**Acceptance Criteria:**

**Given** the news list (overall and on the Security detail page)
**When** an item renders
**Then** next to the Security name it shows a small "im Depot" chip when the Security is held in a non-archived Depot
**And** it shows the change today in % (e.g. "+1,8 %"), from the same core function as the watchlist "Heute" column (latest Price against the Price of the previous date), with sign and gain/loss colour as a secondary cue only
**And** without a previous Price it shows no change (no "0 %")
**And** a stale Price shows the change with the stale marker from `isStale`
**And** the figures are computed once per Security per page render, not per article
**And** DOM tests cover held, watched only, no previous Price and stale

#### Story 12.2: Set Stop and Target

As Tommy,
I want to note a stop and a target price for a stock,
So that recommendations from newspapers and analysts are kept in one place.

**Acceptance Criteria:**

**Given** a held or watched Security
**When** I choose "Kursmarken bearbeiten" on the detail page, or open the watchlist entry dialog
**Then** I can set, change or clear:
  - **Stopp:** either a fixed price in € or "nachlaufend" with a percentage (1–50 %)
  - **Ziel:** a price in €
  - per mark an optional source text (≤ 200 characters) and the date set (default today, ≤ today)
**And** for the target the mean analyst target (Story 9.7) is offered as "Analystenziel übernehmen (245,00 €)" when its currency is EUR; otherwise it is shown as a hint with its currency, without a button
**And** inputs are validated (German decimal input, > 0; stop below the latest Price and target above it are only warnings, not errors)
**And** a new `PriceMark` table (one row per Security, decimal strings) is owned by a new `marks` module with a service used by app and MCP (AD-24); a migration adds it
**And** `core/price-marks` returns the effective stop (fixed, or highest split-adjusted close since the set date × (1 − %), never falling), the distances of the latest Price to stop and target, and `breached ∈ {stop, target, none}`, compared in today's units
**And** marks follow an ISIN change to the successor Security
**And** export contains `priceMarks`; restore reads them; an older export without the field restores unchanged
**And** unit tests cover fixed and trailing stop, a split after the set date, a trailing high before and after the set date, missing Prices and both breach edges (equal = breached)

#### Story 12.3: Price Marks on the Detail Page

As Tommy,
I want to see stop and target on the stock's page and in its chart,
So that I can see how close the price is to them.

**Acceptance Criteria:**

**Given** a Security with at least one mark
**When** the detail page renders (both layouts)
**Then** a card "Kursmarken" after the price chart shows per mark the value, the distance in % ("Stopp · 92,40 € · −7,4 %", trailing: "Stopp nachlaufend 15 % · 92,40 €"), the source and the date set, and the button "Kursmarken bearbeiten"
**And** a breached mark shows a pill "Stopp unterschritten" or "Ziel erreicht" with the date of the Price, in words, `stale-soft` colours
**And** without marks the card shows only "Keine Kursmarken" and the button
**And** the price chart draws the effective stop and the target as dashed horizontal lines, labelled ("Stopp", "Ziel"); the trailing stop is drawn as its line over time since the set date
**And** the card notes "geprüft gegen den letzten Kurs, nicht im Tagesverlauf"
**And** DOM tests cover no marks, fixed and trailing stop, breached stop and reached target

#### Story 12.4: Warnings for Crossed Marks

As Tommy,
I want to see all stocks whose stop or target was crossed in one place,
So that I do not miss a signal to react.

**Acceptance Criteria:**

**Given** at least one Security with a breached mark
**When** I open the dashboard
**Then** a card "Kursmarken erreicht" lists each such Security with logo, name, "Stopp unterschritten" / "Ziel erreicht", the mark, the latest Price and the distance, held ones marked "im Depot", each linking to the detail page
**And** the card is absent when nothing is breached
**And** the securities list and the watchlist table show a warning icon with tooltip and accessible text at breached Securities, and the securities list filter "Nur Probleme" is not affected
**And** the warning stays as long as the mark is breached and disappears when the Price returns or the mark is changed or cleared; there is no acknowledgement
**And** all screens use the same core state (AD-24)
**And** page and DOM tests cover breached stop, reached target, both absent, and a held and a watched Security

#### Story 12.5: Price Marks for Claude

As Tommy,
I want Claude to know and set my stop and target prices,
So that it can consider them and move targets from my notes into marks.

**Acceptance Criteria:**

**Given** a connected Claude
**When** it calls `get_security` (scope `portfolio:read`) or `get_watchlist` (scope `watchlist`)
**Then** each Security carries `price_marks`: stop (type, value or percentage, effective value), target, sources, dates set, distances and `breached`, from the same core function (AD-24), decimals as strings
**And** a new tool `set_price_marks` (scope `watchlist`) sets or clears stop and target of one Security through the `marks` service, with the same validation as the app; omitted fields stay
**And** the tool descriptions say marks are Tommy's own reference levels, not recommendations, and are checked against the latest close
**And** tests cover read payloads, set, clear, validation refusals and the scope check

### 4.4 EXPERIENCE.md

- **News row:** items show an "im Depot" chip for held Securities and the change today.
- **Dashboard row:** card "Kursmarken erreicht" (only when a mark is breached).
- **Securities list and watchlist rows:** warning icon at Securities with a breached mark.
- **Security detail row:** after the price chart a card "Kursmarken" (stop and target with distance, source, date; breach pill; "Kursmarken bearbeiten"); stop and target lines in the price chart.
- **Watchlist entry dialog:** stop and target fields with the analyst-target suggestion.

### 4.5 sprint-status.yaml

```
  epic-12: backlog
  12-1-news-with-holding-and-change-today: backlog
  12-2-set-stop-and-target: backlog
  12-3-price-marks-on-the-detail-page: backlog
  12-4-warnings-for-crossed-marks: backlog
  12-5-price-marks-for-claude: backlog
  epic-12-retrospective: optional
```

## 5. Implementation Handoff

- **Scope:** Moderate. It is a new epic in the backlog; implementation goes to the Developer agent via the bmad loop.
- **Order:** 12.1 (independent), then 12.2 → 12.3 → 12.4 → 12.5.
- **PM (John):** after approval, apply the edits above to SPEC, ARCHITECTURE-SPINE, epics.md, EXPERIENCE.md and sprint-status.yaml.
- **Developer:** implement per story ACs and AGENTS.md conventions. Check `bmad-loop status` before editing.
- **Success criteria:**
  - A trailing stop set on a fixture Security fires on the right day and not after a split.
  - The dashboard, securities list, watchlist, detail page and Claude agree on which marks are breached.
  - News items show the holding and the change today.
