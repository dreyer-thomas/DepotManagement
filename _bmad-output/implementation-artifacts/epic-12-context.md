# Epic 12 Context: Kursmarken

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Tommy follows stop-loss and price-target recommendations from newspapers and analysts for stocks he holds or watches, but today they live only as free text in watchlist notes and nothing tells him when one is crossed. This epic adds price marks per Security: a stop (fixed or trailing) and a target, each with a source and set date. The app warns while the latest Price is beyond a mark, on the dashboard, in the securities list, in watchlists and on the detail page, and Claude can read and set the marks. News items also gain context: whether the Security is held and how it moves today.

## Stories

- Story 12.1: News with Holding and Change Today
- Story 12.2: Set Stop and Target
- Story 12.3: Price Marks on the Detail Page
- Story 12.4: Warnings for Crossed Marks
- Story 12.5: Price Marks for Claude

## Requirements & Constraints

- **News context:** each news item (overall list and detail page) shows an "im Depot" chip when the Security is held in a non-archived Depot, plus the change today in % when the Security has Prices. With no previous Price it shows nothing (never "0 %"). A stale Price keeps the stale marker. Compute the figures once per Security per render, not per article.
- **Marks:** one set per Security, for held and watched Securities alike.
  - Stop: either a fixed EUR price or trailing by 1–50 %.
  - Target: an EUR price.
  - Each mark: optional source text (≤ 200 chars) and a set date (default today, never in the future).
  - Input uses German decimal format and must be > 0. A stop above or a target below the latest Price is a warning, not an error.
- **Breach semantics:** a mark counts as breached when the latest Price is below the stop or above the target, and equality counts as breached. The warning lasts while the breach does and disappears only when the Price returns or the mark is changed or cleared. There is no acknowledgement.
- The check uses the latest resolved Price (daily close or the latest fetch of the day), not intraday moves, and the UI says so.
- **Analyst target suggestion:** the mean analyst target from the existing analyst-ratings data is offered as a one-click "Analystenziel übernehmen (245,00 €)" only when its currency is EUR. In any other currency it is shown as a hint with that currency, with no button and no conversion.
- Warnings appear only in the app. Push or e-mail notifications, broker orders and intraday monitoring are out of scope.
- The securities list filter "Nur Probleme" is not affected by marks.
- Every screen and Claude must agree on which marks are breached.

## Technical Decisions

- **New `PriceMark` table:** one row per Security, all values as decimal strings, dates `YYYY-MM-DD`. Add it with a new migration and leave existing tables unchanged.
- **New `marks` module** owns `PriceMark`. Its service is the only write path for both the app and MCP. Nothing in this epic writes the ledger or Prices.
- **New pure `src/core/price-marks.ts`** (decimal.js only, "today" passed in) derives the state on read, never stored, from the marks, the split-adjusted closes since the set date and the latest resolved Price (the existing core price resolver). It returns:
  - the effective stop: fixed, or highest split-adjusted close since the set date × (1 − %). The trailing stop never falls.
  - the distances of the latest Price to stop and target.
  - `breached ∈ {stop, target, none}`.
- **Splits:** stored Prices are unadjusted closes, so marks are compared in today's units with the existing `adjustedPrice` from the set date, the same approach as the watchlist "since added" figure. Without this, a split would fire a stop falsely.
- Marks never feed valuations, returns or tax.
- **"Change today"** reuses the existing `core/watchlist` `ChangeToday` function (latest Price against the Price of the previous date). Stale flags come from the core `isStale`.
- **ISIN change:** marks follow the Security to its successor.
- **Backup:** the export gains `priceMarks` (additive) and restore reads it. Older exports without the field must restore unchanged.
- **MCP:**
  - `get_security` (`portfolio:read`) and `get_watchlist` (`watchlist`) gain an additive `price_marks` field per Security: stop type, value or %, effective value, target, sources, set dates, distances and `breached`. Decimals are strings, and the values come from the same core function.
  - New tool `set_price_marks` (scope `watchlist`) sets or clears the stop and target of one Security through the `marks` service, with the app's validation. Omitted fields stay unchanged.
  - Tool descriptions state that marks are Tommy's own reference levels, not recommendations, and are checked against the latest close.
  - "Target data" in the no-write rule means rebalancing targets, so this tool is allowed.
- No new provider calls. Tests use fixtures only.

## UX & Interaction Patterns

- **Detail page card "Kursmarken"** sits after the price chart, in both layouts.
  - Per mark: value and distance ("Stopp · 92,40 € · −7,4 %"; trailing: "Stopp nachlaufend 15 % · 92,40 €"), source, set date, and the button "Kursmarken bearbeiten".
  - The card notes "geprüft gegen den letzten Kurs, nicht im Tagesverlauf".
  - Without marks it shows only "Keine Kursmarken" and the button.
- **Breach pill:** "Stopp unterschritten" or "Ziel erreicht" with the date of the Price. It is always in words, in `stale-soft`/`stale` colours.
- **Price chart:** dashed, labelled horizontal lines, "Stopp" in the `loss` colour and "Ziel" in the `gain` colour. The trailing stop is drawn as a line over time from its set date. No new design tokens.
- **Watchlist entry dialog:** gains the stop and target fields and the analyst-target suggestion.
- **Dashboard card "Kursmarken erreicht":** shown only when at least one mark is breached. It lists logo, name, breach label, the mark, the latest Price and the distance; held Securities carry "im Depot", and each row links to the detail page.
- **Securities list and watchlist table:** a warning icon with tooltip and accessible text at breached Securities.
- **News change today:** sign plus gain/loss colour, with colour as a secondary cue only.
- UI text is German with de-DE number formats.

## Cross-Story Dependencies

- 12.1 is independent. The order after it is 12.2 → 12.3 → 12.4 → 12.5.
- 12.2 provides the table, the `marks` service, the `core/price-marks` function and backup support. 12.3, 12.4 and 12.5 all consume the core state and must not reimplement breach logic.
- 12.3 provides the "Kursmarken bearbeiten" entry point on the detail page, which uses the editing UI from 12.2.
- The epic extends earlier work:
  - news display (Epic 3)
  - the watchlist entry dialog, `get_watchlist`, analyst ratings and watchlist export (Epic 9)
  - `get_security` (Epic 10)
  - export/restore (Epic 6)
  - the price chart on the detail page (the same chart used by Epic 11)
