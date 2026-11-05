# Sprint Change Proposal — Technical Position ("Technische Lage")

- **Date:** 2026-11-05
- **Author:** John (PM) with Tommy
- **Mode:** Batch
- **Scope classification:** Moderate (new epic added to the backlog; one architecture amendment, one new AD)
- **Status:** Approved by Tommy 2026-11-05; edits applied

## 1. Issue Summary

Tommy regularly has to decide whether to buy a watched stock, or to hold or sell a held one. Today he looks up technical analyses on other sites (trend, momentum, Elliott waves) to judge "how the stock stands". The Security detail page already shows fundamentals (Story 9.6 key figures) and analyst opinions (Story 9.7), but no technical view.

**Personal use (SM-C1):** buy / hold / sell decisions for watched and held stocks; Tommy named TSI and Elliott waves as analyses he uses.

**Decisions made with Tommy (2026-11-05):**

- One card "Technische Lage" on the Security detail page: a compact signal summary plus an indicator chart switchable between indicators.
- Each signal gets a plain-German interpretation ("Aufwärtstrend", "überkauft", "Schwung lässt nach").
- **No overall buy/sell verdict.** Signals often conflict, and a combined score would suggest an objectivity it does not have. The decision stays with Tommy.
- **No automatic Elliott-wave count.** A count is an interpretation and is usually ambiguous; showing one would pretend a certainty that does not exist. An optional later story shows ZigZag pivots with Fibonacci retracements as an honest basis for Tommy's own wave reading.
- The signals are also exposed to Claude through the MCP connector. Claude can then weigh technical, fundamental, analyst and position data together.

**Evidence and constraints found in the codebase:**

- Watched Securities already have about 3 years of history (`watchlistHistoryStart` = earlier of the `3J` preset start and the date added, minus the benchmark buffer).
- Held Securities only have history from their first Transaction. A stock bought 2 months ago has too few closes for SMA200 (200 trading days) or a meaningful TSI.
- Only daily closes are stored (no open, high, low or volume). Indicators that need these (Stochastic, ATR, OBV) are out of scope.

## 2. Impact Analysis

### Epic impact

- **Epics 1–10:** no change to completed work.
- **New Epic 11 "Technische Lage"** with 4 stories plus 1 optional story.

### Story impact

- **Story 9.6 (key figures):** unchanged. The 52-week figures are reused as one signal row.
- **Story 10.2 (`get_security`) and Story 9.4 (`get_watchlist`):** extended by Story 11.4 with the signals. This is an additive change to the read payload.

### Artifact conflicts

| Artifact | Change |
| --- | --- |
| SPEC.md | New CAP-30. Non-goals: no buy/sell recommendation, no automatic Elliott count. |
| ARCHITECTURE-SPINE.md | AD-9 amended: held Securities get history back to the `3J` start, like watched ones. New AD-23 (technical indicators). Capability map row added; `binds` gains FR-30. |
| epics.md | FR30, AR23 and UX-DR22 added; coverage map, Epic List and the Epic 11 section with stories. |
| EXPERIENCE.md | Security detail row gains the card "Technische Lage". |
| sprint-status.yaml | `epic-11` and its stories in `backlog`. |
| DESIGN.md | No new tokens. Indicator lines use `primary` and `chart-invested`; zones use the existing soft tokens. |

### Technical impact

- **Prices (`modules/prices`):**
  - One-time larger backfill for held Securities on the next scheduler run (at most about 3 years × held Securities).
  - Only symbols leave the server (AD-13 unchanged).
- **Core:**
  - New pure module `src/core/technical.ts`.
  - It uses `decimal.js` only, so the architecture test on `src/core` imports stays green.
- **UI:** one client card reusing `CollapsibleCard` and the existing chart library.
- **MCP:** additive fields on two read tools; no write path (AD-3, AD-22 unchanged).
- **Export and restore:** unaffected. Indicators are computed on read; provider Prices are already exported.

## 3. Recommended Approach

**Direct Adjustment:** add Epic 11 to the backlog and implement it with the bmad loop. Nothing is rolled back and the MVP scope is unchanged.

- **Effort:**
  - Story 11.1 small.
  - Story 11.2 medium (indicator math plus reference tests).
  - Story 11.3 medium.
  - Story 11.4 small.
  - Story 11.5 medium (optional).
- **Risk:** low to medium.
  - The main risk is indicator correctness. It is mitigated by unit tests against hand-checked reference values.
  - Wilder smoothing for RSI and the EMA seeding are defined explicitly, so the numbers match common charting sites within rounding.
- **Timeline:** independent of other open work. Story 11.1 should land first so the card has data.

## 4. Detailed Change Proposals

### 4.1 SPEC.md

**Capabilities — add after CAP-29:**

```
- **CAP-30** — Technical position
  - **intent:** Tommy can see on a Security's detail page how it stands technically (trend, momentum, overbought/oversold, distance to the 52-week high) to support buy, hold and sell decisions.
  - **success:** Every signal shows its value and a plain-German interpretation from fixed rules; an indicator chart (TSI, RSI, MACD) shares the price chart's Period; values match a hand-checked reference; too little history shows "zu wenig Kursdaten" instead of a value; there is no combined buy/sell verdict.
```

**Non-goals — add:**

```
- Buy/sell recommendations or a combined signal score; automatic Elliott-wave counts.
```

### 4.2 ARCHITECTURE-SPINE.md

**AD-9 — last sentence**

OLD:
> `prices` backfills history from the first Transaction date for every held Security (AD-17) on the scheduler run and after a ledger write introduces a new held Security.

NEW:
> `prices` backfills history for every held Security (AD-17) from the earlier of its first Transaction date and the `3J` Period start (minus the benchmark buffer, the same start as watched Securities) on the scheduler run and after a ledger write introduces a new held Security (amended 2026-11-05: technical indicators need ≥ 200 trading days).

**New AD-23** (after AD-22):

```
### AD-23 — Technical indicators are pure core functions over trading-day closes

- **Binds:** FR-30
- **Prevents:** the card, the chart and the MCP tools computing indicators differently; weekends and holidays (carried-forward Prices) distorting momentum; interpretations drifting between screens; a hidden "recommendation".
- **Rule:** One pure module `core/technical` computes SMA200 trend, RSI(14, Wilder smoothing), MACD(12, 26, 9), TSI(25, 13, signal 7) and their German interpretation from a series of split-adjusted closes on dates that have a stored Price (provider or manual; no carried-forward days). EMAs are seeded with the SMA of their first window. Parameters and interpretation thresholds live in one table in that module. Each signal needs a minimum number of closes, else it is `null` with reason `insufficient-history`. Indicators are computed on read, never stored or exported (AD-1). The UI card and the MCP tools call the same function. No function combines signals into a verdict.
```

**Capability → Architecture Map — add row:**

```
| FR-30 Technical position | `core/technical`, `modules/prices`, `app`, `modules/mcp` | AD-1, AD-9, AD-22, AD-23 |
```

**Frontmatter:** `binds` gains `FR-30`. `change_log` gains: `2026-11-05 sprint change: AD-9 amended (3J history for held Securities), AD-23 added (technical indicators)`.

### 4.3 epics.md

**Functional Requirements — add after FR29:**

```
FR30: Tommy can see on a Security's detail page its technical position — trend against the 200-day average, RSI, MACD, TSI and distance to the 52-week high — each with a plain-German interpretation, plus an indicator chart switchable between TSI, RSI and MACD; no combined buy/sell verdict.
```

**Additional Requirements — add:**

```
- AR23 (AD-23): `core/technical` computes SMA200 trend, RSI(14, Wilder), MACD(12/26/9), TSI(25/13/7) and fixed German interpretations from split-adjusted trading-day closes (no carry-forward); computed on read; same function for card and MCP; no verdict.
```

**UX Design Requirements — add:**

```
UX-DR22: Card "Technische Lage" on the Security detail page (both layouts), closed by default (CollapsibleCard): signal rows "Signal · Wert · Einordnung"; opened adds an indicator chart with a TSI · RSI · MACD toggle sharing the price chart's Period and time axis; interpretation always in words, never colour alone.
```

**FR Coverage Map — add:**

```
FR30: Epic 11 - Technical position card, indicators, signals for Claude (Stories 11.1–11.4; ZigZag/Fibonacci optional in 11.5)
```

**Epic List — add after Epic 10:**

```
### Epic 11: Technische Lage
Tommy sees at a glance on a Security's detail page how it stands technically — trend, momentum, overbought/oversold — to decide whether to buy a watched stock or hold or sell a held one, and Claude can use the same signals.
**FRs covered:** FR30 · **Also:** AR1, AR9, AR23, NFR10
```

**New section `## Epic 11: Technische Lage`** with these stories:

#### Story 11.1: Three Years of Price History for Held Securities

As Tommy,
I want enough price history for every held Security,
So that trend and momentum indicators have data even for stocks I bought recently.

**Acceptance Criteria:**

**Given** a held Security whose first Transaction is less than 3 years ago
**When** the scheduler runs or a ledger write introduces it as held
**Then** its provider history is fetched from the earlier of its first Transaction date and the `3J` Period start minus the benchmark buffer (the same start as watched Securities, AD-9 amended)
**And** an existing mapping whose stored history starts later is backfilled once (full plan), later runs only refresh the overlap window
**And** only symbols leave the server (AD-13); a provider without that much history stores what it delivers, without error
**And** value, charts and returns are unchanged: Prices before the first Transaction never enter valuations (test on a fixture Depot)
**And** the history start is one pure core function with unit tests (held only, held and watched, benchmark)

#### Story 11.2: Technical Indicators in Core

As Tommy,
I want trend and momentum figures computed reliably from my stored prices,
So that the signals I base decisions on are correct and consistent everywhere.

**Acceptance Criteria:**

**Given** the split-adjusted closes of a Security on dates with a stored Price (provider or manual; carried-forward days excluded, AD-23)
**When** `technicalPosition(closes, today)` in `core/technical` is called
**Then** it returns per signal the value, the date of the last close, the interpretation key and German label, or `null` with `insufficient-history`:
  - **Trend:** distance of the last close to SMA200 in %; "Aufwärtstrend" when above SMA200 and SMA200 higher than 20 trading days earlier, "Abwärtstrend" when below and lower, else "Seitwärts"; needs 220 closes
  - **RSI(14)**, Wilder smoothing: "überkauft" ≥ 70, "überverkauft" ≤ 30, else "neutral"; needs 15 closes
  - **MACD(12, 26, 9):** "positiv" when MACD > signal, "negativ" when below; a cross within the last 5 closes adds "dreht nach oben" / "dreht nach unten"; needs 35 closes
  - **TSI(25, 13)** with signal line EMA 7: "Schwung positiv" (TSI > signal and > 0), "Schwung lässt nach" (TSI < signal and > 0), "Schwung negativ" (TSI < 0 and < signal), "Schwung dreht" (TSI > signal and < 0); needs 45 closes
  - **52 Wochen:** distance to the 52-week high from Story 9.6, "nahe Hoch" when within 5 %, "nahe Tief" when within 5 % of the low, else "dazwischen"
**And** it also returns the daily series of TSI and signal, RSI, and MACD, signal and histogram for the chart
**And** EMAs are seeded with the SMA of their first window; parameters and thresholds sit in one table; all arithmetic uses `decimal.js`; ratios are rounded only at presentation (AD-5)
**And** unit tests check every indicator against reference values computed by hand or spreadsheet on a fixed fixture series (≥ 250 closes), the minimum-history edges, a split inside the window and a series with gaps (weekends, holidays)
**And** no function combines signals into a verdict

#### Story 11.3: Card "Technische Lage"

As Tommy,
I want a card on the detail page that shows the technical signals at a glance,
So that I can judge whether to buy, hold or sell without opening another site.

**Acceptance Criteria:**

**Given** the Security detail page (both layouts: held and watch-only)
**When** it renders
**Then** a card "Technische Lage" follows "Kennzahlen", closed by default (same chevron as "Kennzahlen")
**And** closed it shows one row per signal (Trend, RSI, MACD, TSI, 52 Wochen) with value and German interpretation, e.g. "Trend · +8,2 % zum 200-Tage-Schnitt · Aufwärtstrend"; the interpretation is in words, with the gain/loss/stale soft tokens as a secondary cue only (never colour alone)
**And** opened it adds an indicator chart with a toggle TSI · RSI · MACD (last choice remembered per browser):
  - TSI with signal line and zero line
  - RSI with lines and shaded zones at 30 and 70
  - MACD with signal line and histogram
  - it covers the Period selected for the page, shares the price chart's time axis, and has a crosshair tooltip and a text alternative
**And** a signal without enough history shows "zu wenig Kursdaten", and a Security without Prices shows the card with only that line
**And** the source line reads "berechnet aus Schlusskursen, Stand <last close date>"
**And** the card works for every asset type with Prices (stocks, ETFs, funds, certificates, crypto)
**And** DOM tests cover the closed and opened states, the toggle and insufficient history; a page test checks the order of the cards

#### Story 11.4: Technical Signals for Claude

As Tommy,
I want Claude to see the same technical signals,
So that I can ask Claude whether to buy, hold or sell with technical, fundamental and position data together.

**Acceptance Criteria:**

**Given** a connected Claude
**When** it calls `get_security` (scope `portfolio:read`, Story 10.2) or `get_watchlist` (scope `watchlist`, Story 9.4)
**Then** the payload gains `technical` per Security: each signal with value (decimal string), last close date, interpretation key and German label, or `null` with `insufficient-history`, from the same core function as the card (AD-23)
**And** the tool descriptions explain the signals, thresholds and that they are not a recommendation
**And** no new tool writes anything; series are not included (only the latest signal values)
**And** a test compares the MCP values with the card's input for a fixture Security

#### Story 11.5 (optional, later): ZigZag Pivots with Fibonacci Retracements

As Tommy,
I want the significant highs and lows of a stock marked with Fibonacci levels,
So that I can read trend waves (Elliott-style) myself without the app pretending to count them.

**Acceptance Criteria:**

**Given** the price chart of a Security
**When** I switch on "Wendepunkte" in the chart
**Then** a ZigZag line connects pivots whose move exceeds a threshold (default 8 %, selectable 5 · 8 · 12 %) computed by a pure core function from trading-day closes
**And** for the last completed swing the 38,2 %, 50 % and 61,8 % retracement levels and the 161,8 % extension are drawn and labelled
**And** the app shows no wave numbers and no Elliott count
**And** unit tests cover pivot detection (threshold edges, a flat series, a split) and the level calculation

### 4.4 EXPERIENCE.md

**Security detail row:** after the "Kennzahlen" description, add:

```
card "Technische Lage" (closed by default: Trend · RSI · MACD · TSI · 52 Wochen with value and German interpretation; opened: indicator chart TSI · RSI · MACD over the page Period; "zu wenig Kursdaten" when history is short; never a buy/sell verdict);
```

### 4.5 sprint-status.yaml

```
  epic-11: backlog
  11-1-three-years-of-price-history-for-held-securities: backlog
  11-2-technical-indicators-in-core: backlog
  11-3-card-technische-lage: backlog
  11-4-technical-signals-for-claude: backlog
  11-5-zigzag-pivots-with-fibonacci-retracements: backlog
  epic-11-retrospective: optional
```

## 5. Implementation Handoff

- **Scope:** Moderate. It is a new epic in the backlog; implementation goes to the Developer agent via the bmad loop.
- **Order:** 11.1 → 11.2 → 11.3 → 11.4. Story 11.5 is optional and only starts after Tommy decides, once he has used 11.3.
- **PM (John):** apply the edits above to SPEC, ARCHITECTURE-SPINE, epics.md, EXPERIENCE.md and sprint-status.yaml after approval.
- **Developer:** implement per story ACs and AGENTS.md conventions. Check `bmad-loop status` before editing.
- **Success criteria:**
  - The card shows correct, hand-verified signals for a recently bought stock and for a watched stock.
  - Claude returns the same values.
  - No verdict anywhere.
