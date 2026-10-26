---
title: 'Story 5.2 follow-up: ROBIN parser for the real unpdf layout'
type: 'bugfix'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-2-deutsche-bank-robin-parser.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 5.2's ROBIN trade parser was built against synthetic, label-first layouts. Real ROBIN settlements extracted with unpdf glue each value in front of its label (`16.03.2026Schlusstag…`, `3,1415STNominalA2PKXGWKN`, `98,765432EURKursIE00BK5BQT80ISIN`, `310,27EURKurswert`, booked total on the line after `Belastung`/`Gutschrift`), so every real document fails with "Schlusstag nicht lesbar".

**Approach:** Teach `parseDeutscheBankTrade` the real value-first layout as an alternative to the existing label-first one, without changing results for the existing synthetic fixtures. Add three anonymised real-layout fixtures approved by Tommy (buy; sell with loss; sell with gain inside the allowance) and tests with exact decimals. Copy Tommy's approved comdirect/cominvest fixtures to `test/fixtures/import/comdirect/` for Story 5.4 and point Story 5.4 at them, including merging an Ertragsgutschrift with its separate Steuermitteilung. Value-first withheld-tax lines (`<amount>EURKapitalertragsteuer`, Solidaritätszuschlag, Kirchensteuer) are read as tax paid; no real sample with withheld tax exists yet.

</frozen-after-approval>

## Implementation Notes

- Fixtures: `test/fixtures/import/deutsche-bank/real-buy.txt`, `real-sell-loss.txt`, `real-sell-gain.txt`; `test/fixtures/import/comdirect/{buy,sell,dividend,dividend-tax}.txt`. All personal data, numbers, Securities and amounts are replaced (reviewed by Tommy).
- Expected: buy 2026-03-16 IE00BK5BQT80 qty 3.1415 price 98.765432 amount 310.27 fee 0 tax 0; sell-loss IE00B4L5Y983 4.2 @ 61.25 amount 257.25 fee 0 tax 0; sell-gain IE00BJ0KDQ92 1.75 @ 112.4 amount 196.7 fee 0 tax 0. Names from the `1/1<name><depot> <branch>` line.
- Informational tax lines (`Veräußerungsverlust/-gewinn`, `Teilfreistellung`, `Freistellungsbetrag`) are not taxes.
- Story 5.2 stays `awaiting-operator` in sprint-status; Tommy confirms it after uploading real PDFs. This spec does not touch `sprint-status.yaml`.
- Changed: `src/modules/import/parsers/deutsche-bank/trade.ts` (value-first patterns per field via `firstMatch`, value-first tax lines with exact label end, name line with single-digit page and seven-digit Depotnummer), `trade.test.ts` (real fixtures through `parseDocument`, fee, names, tax-label compounds, unreadable and foreign value-first tax lines), fixtures, Story 5.4 in `epics.md`.
- Verification: `npm run lint`, `npm run typecheck`, `npm test` (2126+ tests), `npm run build` green; parser tests 83 passed.

## Review Triage Log

- Value-first tax guard rejected label-first rate lines — medium, patched: guard only counts lines that start with a number.
- Tax label prefix match (compounds) — medium, patched: label must end (`(?![A-Za-zÄÖÜäöüß])`), test added.
- Refund sign dropped by abs() — maybe-false, deferred (no real sample).
- Name extraction with leading/trailing digits — low, patched (single-digit page, seven-digit Depotnummer), test added.
- Guard test exercised the currency path — real, patched: separate tests for unreadable and foreign tax lines.
- No real-layout fee case — real, patched with a derived-fee test.
- Multi-execution real layout untested — maybe-false, deferred (no real sample).
- Real sells bypassed routing — real, patched: tests go through `parseDocument`.
- ROBIN dividend parser label-first only — maybe-false, deferred (no real sample).
- Story 5.4 wording contradicted fixtures (trade tax is in the same PDF) — real, patched.
- Story 5.4 open cases (lone Steuermitteilung, match key, Quellensteuer) — real, patched in criteria; Sparplan/fee fixtures missing — deferred.
- epics.md named a person and copied fixture values — low, patched (removed).
- Spec bookkeeping unfinished — false at review time (finalize step pending), now done.
