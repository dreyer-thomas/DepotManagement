# Epic 11 Context: Technische Lage

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy sees at a glance on a Security's detail page how the Security stands technically: trend against the 200-day average, momentum (RSI, MACD, TSI), overbought/oversold and distance to the 52-week high. Each signal has a plain-German interpretation. This helps him decide whether to buy a watched stock or hold or sell a held one without visiting other sites. Claude gets the same signals through the MCP connector, so it can weigh technical, fundamental, analyst and position data together. The app never gives a combined buy/sell verdict and never counts Elliott waves. Signals often conflict, and the decision stays with Tommy.

## Stories

- Story 11.1: Three Years of Price History for Held Securities
- Story 11.2: Technical Indicators in Core
- Story 11.3: Card "Technische Lage"
- Story 11.4: Technical Signals for Claude
- Story 11.5: ZigZag Pivots with Fibonacci Retracements (optional, later; only after Tommy decides, once he has used 11.3)

## Requirements & Constraints

- Signals: Trend (SMA200), RSI(14), MACD(12/26/9), TSI(25/13, signal 7) and 52 Wochen. Each shows its value and a German interpretation from fixed rules. Too little history shows "zu wenig Kursdaten" instead of a value.
- The values must match a hand-checked or spreadsheet reference on a fixed fixture series of at least 250 closes. Indicator correctness is the main risk of the epic.
- No function, screen or tool combines signals into a score or recommendation. There is no automatic Elliott-wave count and there are no wave numbers.
- Only daily closes are stored (no open, high, low or volume). Indicators that need those values (Stochastic, ATR, OBV) are out of scope.
- Held Securities need about 3 years of history so that SMA200 (≥ 220 closes) works for recently bought stocks. A provider with less history stores what it delivers, without an error.
- Value, charts and returns must not change. Prices before a Security's first Transaction never enter valuations.
- Accessibility: WCAG 2.2 AA; interpretation is always in words, never colour alone; touch targets ≥ 44 px.
- Success: the card shows correct signals for a recently bought stock and for a watched stock, and Claude returns the same values.

## Technical Decisions

- **History start (AD-9 amended):** `prices` backfills each held Security from the earlier of its first Transaction date and the `3J` Period start minus the benchmark buffer. This is the same start that watched Securities already get (see the existing watchlist history start). The backfill runs on the scheduler run and after a ledger write introduces a new held Security. An existing mapping whose stored history starts later gets one full backfill; later runs only refresh the overlap window. The start date is computed by one pure core function. "Held" comes only from `heldSecurities` (AD-17). Outbound requests carry only provider symbols (AD-13).
- **`core/technical` (AD-23):** a new pure module `src/core/technical.ts` that imports only `decimal.js` and core files, has no clock, and takes `today` as an argument. The entry point is `technicalPosition(closes, today)`.
  - **Input:** split-adjusted closes on dates that have a stored Price (provider or manual). Carried-forward days (weekends, holidays) are excluded.
  - **Output per signal:** the value, the last close date, an interpretation key and the German label, or `null` with reason `insufficient-history`. The result also includes the daily series of TSI plus signal, RSI, and MACD plus signal and histogram for the chart.
  - **Minimum closes:** Trend 220, RSI 15, MACD 35, TSI 45.
  - **Calculation rules:** EMAs are seeded with the SMA of their first window. RSI uses Wilder smoothing.
  - **Parameter table:** all parameters and thresholds sit in one table in the module.
- **Interpretation rules:**
  - **Trend:** the value is the % distance of the last close to SMA200. "Aufwärtstrend" when the close is above SMA200 and SMA200 is higher than 20 trading days earlier; "Abwärtstrend" when the close is below and SMA200 is lower; otherwise "Seitwärts".
  - **RSI:** "überkauft" at ≥ 70, "überverkauft" at ≤ 30, otherwise "neutral".
  - **MACD:** "positiv" or "negativ" against the signal line. A cross within the last 5 closes adds "dreht nach oben" or "dreht nach unten".
  - **TSI:** "Schwung positiv" when TSI > signal and > 0; "Schwung lässt nach" when TSI < signal and > 0; "Schwung negativ" when TSI < 0 and < signal; "Schwung dreht" when TSI > signal and < 0.
  - **52 Wochen:** reuses the 52-week high and low from Story 9.6. "nahe Hoch" within 5 % of the high, "nahe Tief" within 5 % of the low, otherwise "dazwischen".
- **Money and rounding (AD-5):** all arithmetic uses `decimal.js`. Ratios are rounded only at presentation. JS `number` appears only in chart payloads at the presentation edge.
- **Computed on read (AD-1):** indicators are never stored, cached as authoritative data or exported. Export and restore are unaffected.
- **One source:** the UI card and the MCP tools call the same core function.
- **MCP (AD-22):** tools stay thin adapters. `get_security` (`portfolio:read`) and `get_watchlist` (`watchlist`) gain an additive `technical` object per Security. It holds the latest signal values only (decimal strings, last close date, key, German label, or `null` with `insufficient-history`) and no series. There is no new write path. The tool descriptions explain the signals and thresholds and state that they are not a recommendation.
- **Story 11.5:** a pure core function computes ZigZag pivots from trading-day closes. The threshold defaults to 8 % and can be set to 5, 8 or 12 %. The function also computes the 38.2 %, 50 % and 61.8 % retracement levels and the 161.8 % extension for the last completed swing.

## UX & Interaction Patterns

- **Placement:** the card "Technische Lage" appears on the Security detail page in both layouts (held and watch-only), directly after "Kennzahlen". It is closed by default and uses the same `CollapsibleCard` chevron as "Kennzahlen".
- **Closed state:** one row per signal (Trend, RSI, MACD, TSI, 52 Wochen) in the form "Signal · Wert · Einordnung", for example "Trend · +8,2 % zum 200-Tage-Schnitt · Aufwärtstrend". The gain, loss and stale soft tokens are only a secondary cue.
- **Open state:** adds an indicator chart with a toggle TSI · RSI · MACD. The browser remembers the last choice.
  - **TSI:** signal line and zero line.
  - **RSI:** shaded zones at 30 and 70.
  - **MACD:** signal line and histogram.
  - **Chart behaviour:** the chart covers the page's selected Period and shares the price chart's time axis. It has a crosshair tooltip and a text alternative.
- **No data:** a signal with too little history shows "zu wenig Kursdaten". A Security without any Prices shows the card with only that line.
- **Source line:** "berechnet aus Schlusskursen, Stand <last close date>", in de-DE formats.
- **Asset types:** the card works for every asset type that has Prices.
- **Design tokens:** no new tokens. Indicator lines use `primary` and `chart-invested`; zones use the existing soft tokens. Use the existing chart library.
- **Story 11.5:** the price chart gets a "Wendepunkte" switch with labelled Fibonacci levels.

## Cross-Story Dependencies

- **Order:** 11.1 → 11.2 → 11.3 → 11.4. Story 11.1 lands first so the card has data. 11.3 and 11.4 both consume 11.2's `technicalPosition`. Story 11.4 includes a test that compares the MCP values with the card's input for a fixture Security.
- **Story 9.6 (key figures):** the 52-week figures are reused for the 52 Wochen signal.
- **Stories 10.2 and 9.4:** the MCP tools `get_security` and `get_watchlist` are extended additively.
- **Watchlist history start:** the existing start for watched Securities defines the history start that held Securities now share.
- **Story 11.5:** optional and gated on Tommy's decision. It builds on the price chart, not on the 11.3 card.
