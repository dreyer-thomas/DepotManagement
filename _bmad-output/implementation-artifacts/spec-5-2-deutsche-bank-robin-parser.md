---
title: 'Deutsche Bank / ROBIN Parser'
type: 'feature'
created: '2026-10-26'
status: 'awaiting-operator'
baseline_revision: 'f85febd1cd450c384d656237bebb227d556d9640'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Parser fixtures are synthetic; nothing verifies the regexes against real unpdf output of ROBIN PDFs.
    evidence: |-
      All parser tests read hand-written .txt fixtures modelled on public Deutsche Bank samples; the only unpdf tests use a one-line minimal PDF. Real line breaks, column joins or umlaut normalisation may differ. Settled by anonymised real samples (operator action) added as fixtures.
    location: >-
      src/modules/import/parsers/deutsche-bank/trade.ts, dividend.ts
    severity: medium
operator_actions:
  - "Extract the text of real ROBIN PDFs (one buy, one sell, one dividend/distribution, one savings-plan execution, one rebalancing document with several executions) with `npm run -s extract-pdf-text -- <file.pdf> > <file outside the repo>.txt`."
  - "Anonymise each extracted text as described in test/fixtures/import/deutsche-bank/README.md (names, addresses, account/depot/order numbers, ISINs with valid check digit, consistent amounts) and save it under test/fixtures/import/deutsche-bank/ as *.txt."
  - "Add or extend tests in src/modules/import/parsers/deutsche-bank/ for the anonymised samples and fix the parser regexes if a real layout differs from the synthetic fixtures."
  - "Upload one real ROBIN PDF of each type to a Deutsche Bank Depot in `npm run dev` and confirm the batch view shows status erkannt with correct date, ISIN, quantity, price, amount, fee and tax."
---

<intent-contract>

## Intent

**Problem:** The `DEUTSCHE_BANK` entry of the parser registry is empty, so every ROBIN buy, sell and dividend confirmation fails with "Layout nicht erkannt"; the robo-advisor Depot still needs manual entry.

**Approach:** Two pure parsers under `src/modules/import/parsers/deutsche-bank/` — `trade` ("Abrechnung: Kauf/Verkauf von Wertpapieren", one proposal per Abrechnung section, so multi-execution savings-plan/rebalancing PDFs yield one proposal per execution) and `dividend` ("Dividendengutschrift"/"Ertragsgutschrift") — registered for `DEUTSCHE_BANK`, plus shared German number/date helpers, synthetic layout fixtures and a text-extraction script so Tommy can turn real PDFs into anonymised fixtures.

## Boundaries & Constraints

**Always:**
- Parsers are pure `(text) → TransactionProposalInput[] | ParseError` (contract in `src/modules/import/proposal.ts`); amounts parsed from German format straight to decimal strings (`parseDecimalInput`, `decimal.js` arithmetic only; never `Number`/`parseFloat` on amounts).
- Recognition: trade parser claims text containing `Abrechnung: Kauf von Wertpapieren` or `Abrechnung: Verkauf von Wertpapieren`; dividend parser claims `Dividendengutschrift` or `Ertragsgutschrift` together with `Bruttoertrag`. Anything else → `{ error: "unrecognized" }` (registry then reports the layout message).
- Once claimed, any unreadable field, non-EUR value, Storno, or implausible result in ANY section → `{ error: "invalid", message }` with a specific German reason ending "Buchung bitte manuell erfassen." — never partial proposals.
- Regexes tolerate whitespace differences of unpdf vs. other extractors (`\s*`/`\s+` between label, currency and value; values may sit on the following line).
- Trade section: `date` = Schlusstag (`Schlusstag/-zeit MEZ dd.mm.yyyy`, also plain `Schlusstag`), `isin` from `ISIN`, `quantity` from `Nominal ST <n>` (up to 8 decimals), `price` from `Kurs EUR`, `amount` = `Kurswert EUR`, `name` from the Wertpapierbezeichnung line when readable. Booked total from `Buchung auf Kontonummer … EUR <total>`. Tax = sum of `Kapitalertragsteuer`, `Solidaritätszuschlag`, `Kirchensteuer` lines in the Abrechnung (BUY: as printed; SELL: sign inverted, printed negative = paid). Fee = BUY `total − amount − tax`, SELL `amount − total − tax`; fee < 0 → invalid. So `core/cash` reproduces the bank's booked total exactly.
- Dividend: `type` DIVIDEND, `date` = `Zahlbar` date, `isin`/`name` from the `Stück WKN ISIN` block, `amount` = EUR value of `Bruttoertrag` (the EUR column when a foreign column precedes it), `tax` = gross − EUR credit of `Gutschrift mit Wert … EUR` (covers Quellensteuer, KESt, Soli, KiSt; may be negative = refund).
- Fixtures are synthetic (invented names, numbers, addresses) `*.txt` under `test/fixtures/import/deutsche-bank/`; English code/comments, German reasons.

**Never:** No real broker documents, PDFs or personal data committed; no `.gitignore` changes; no changes to booking, duplicates or review UI (story 5.3); no foreign-currency conversion; no Vorabpauschale, Kontoauszug or DVAG Sparplan-statement (WKN-only) support — they stay unrecognized; no I/O, `Date.now()` or logging inside parsers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buy | single Kauf Abrechnung, Provision | 1 BUY, fee = total − Kurswert | — |
| Buy with rebate | Provision + negative "Ausgekehrte Zuwendungen" | fee = net (total − Kurswert) | net < 0 → invalid |
| Sell with tax | Verkauf, Provision, KESt/Soli/KiSt negative | 1 SELL, tax = positive sum, fee = remaining difference | — |
| Mandate sell | "Vermögensverwaltungsmandat", `Nominal ST 2,2450`, total date on next line | 1 SELL, quantity `2.245`, fee 0 | — |
| Multi-execution | one PDF, 3 Abrechnung sections (2 Kauf, 1 Verkauf) | 3 proposals in document order | one bad section → whole document invalid |
| Dividend EUR | Ertragsgutschrift, KESt/Soli/KiSt | DIVIDEND amount = Bruttoertrag, tax = gross − credit | — |
| Dividend foreign + EUR column | `Bruttoertrag 98,80 USD 87,13 EUR`, credit in EUR | amount 87.13, tax from EUR values | credit only in USD → invalid foreign-currency reason |
| Foreign trade | `Kurswert USD …` | — | invalid "Abrechnung in Fremdwährung … manuell erfassen." |
| Missing field | Kauf without ISIN line | — | invalid naming the field |
| Storno | "Storno" in claimed text | — | invalid Storno reason |
| Other DB doc | Kontoauszug / Vorabpauschale | unrecognized | registry layout message |

</intent-contract>

## Code Map

- `src/modules/import/proposal.ts` -- `Parser`, `ParseError`, `TransactionProposalInput`, zod per-type rules (DIVIDEND no quantity/price, amount > 0; fee ≥ 0; tax signed). Read-only.
- `src/modules/import/parsers/registry.ts:13-17` -- `PARSERS.DEUTSCHE_BANK: []` to fill with `{ documentType: "trade" }`, `{ documentType: "dividend" }`; doc comment "No broker parser exists yet" to update. `parseDocument` validates/normalises output.
- `src/modules/import/parsers/registry.test.ts:36-40` -- test "has no production parsers yet" must change: DEUTSCHE_BANK now has parsers; COMDIRECT/FINANZEN_ZERO stay empty.
- `src/core/decimal-input.ts` -- `parseDecimalInput("1.234,56")` → `{ ok, value: "1234.56" }`; reuse for every amount (strip a leading `-`/space-separated `- ` first).
- `src/core/dates.ts` -- `isBusinessDate` for validating converted `dd.mm.yyyy` dates.
- `src/modules/import/extract.ts` -- unpdf `extractText(..., { mergePages: true })`; lines joined by `hasEOL`, whitespace collapsed: the parser input shape.
- `src/modules/import/batches.ts` -- calls `parseDocument(depot.broker, text)`; batch view (`src/app/_components/import/ImportBatchView.tsx`) already lists proposals per file — no UI change needed.
- `test/fixtures/` -- existing `parqet/*.csv.txt` naming precedent; new `import/deutsche-bank/*.txt`.
- `scripts/hash-password.mjs` + `package.json` scripts -- precedent for a node `.mjs` helper script.

## Tasks & Acceptance

**Execution:**
- `src/modules/import/parsers/german.ts` -- `germanAmount(text)` (handles `-`, `- ` prefix, returns canonical string or null), `germanDate("dd.mm.yyyy")` → `YYYY-MM-DD` or null -- shared by 5.2/5.4 parsers.
- `src/modules/import/parsers/deutsche-bank/trade.ts` -- `parseDeutscheBankTrade: Parser`; split text into sections at each `Abrechnung: (Kauf|Verkauf) von Wertpapieren`; per section rules above; German reasons as exported constants/builders.
- `src/modules/import/parsers/deutsche-bank/dividend.ts` -- `parseDeutscheBankDividend: Parser` per rules above.
- `src/modules/import/parsers/registry.ts` -- register both for `DEUTSCHE_BANK` (trade first); update comments.
- `test/fixtures/import/deutsche-bank/` -- synthetic texts: `buy.txt`, `buy-rebate.txt`, `sell-tax.txt`, `sell-mandate.txt`, `multi-execution.txt`, `dividend-eur.txt`, `dividend-foreign-eur.txt`, `dividend-foreign-only.txt`, `trade-foreign.txt`, `trade-missing-isin.txt`, `storno.txt`, `vorabpauschale.txt`.
- `src/modules/import/parsers/german.test.ts`, `deutsche-bank/trade.test.ts`, `deutsche-bank/dividend.test.ts` -- every matrix row against fixtures, exact decimal strings; plus `parseDocument("DEUTSCHE_BANK", fixture)` end-to-end through the registry (PARSED with documentType, FAILED with reason).
- `src/modules/import/parsers/registry.test.ts` -- adjust the production-registry test.
- `scripts/extract-pdf-text.mjs` + `package.json` script `extract-pdf-text` -- prints unpdf text (same options as `extract.ts`) of a local PDF to stdout so Tommy can anonymise it into a fixture; never writes into the repo.
- `test/fixtures/import/deutsche-bank/README.md` -- states fixtures are synthetic, how to add anonymised real samples (`npm run extract-pdf-text -- <file.pdf>`, replace names/numbers/addresses, save as `*.txt`).

**Acceptance Criteria:**
- Given a `DEUTSCHE_BANK` Depot batch, when a ROBIN-layout buy, sell or dividend text is processed by `parseDocument`, then the item is PARSED with documentType `trade`/`dividend` and AD-14 proposals whose decimals equal the fixture values exactly.
- Given a multi-execution document, when parsed, then one proposal per Abrechnung section is returned in document order.
- Given any claimed but unreadable document, when parsed, then the outcome is FAILED with a specific German reason and no proposals.
- Given `npm run extract-pdf-text -- some.pdf`, when run, then the extracted text is printed to stdout and nothing is written to the repo.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 29 findings — high 0, medium 2, low 17, false 3, maybe-false 7
- findings:
  - `[low]` `[reject]` (blind) Booked-total sign dropped via `abs()`: a SELL whose costs exceed Kurswert would get a wrong fee — ROBIN charges no per-trade fees, so a debit-settled sell is practically unreachable; fix needs Belastung/Gutschrift branching.
  - `[maybe-false]` `[reject]` (blind) TAX_LINE anchored at line start misses tax lines joined onto another line — unpdf keeps `hasEOL` line structure; would need real output to show joins; if true only tax/fee attribution (cash stays correct), low. Partly covered by the new unmatched-tax-line guard.
  - `[low]` `[reject]` (blind) Taxes other than KESt/Soli/KiSt (e.g. FTT) end up in fee — ROBIN trades ETFs (no FTT); classifying transaction taxes as fee vs. tax is a product decision, not a direct fix.
  - `[low]` `[patch]` (blind) Foreign-currency reason lacks "(Abrechnung n)" in multi-execution documents — `foreignCurrencyReason` takes `where`; test added.
  - `[maybe-false]` `[reject]` (blind) Storno check matches anywhere in the text — no DB sample text contains "Storno" outside cancellations; if true the document fails safely to manual entry (low).
  - `[low]` `[reject]` (blind) `germanAmount` accepts dot decimals like `12.50` — DB documents print German numbers only; fix adds a parser-specific branch for an unseen input.
  - `[low]` `[reject]` (blind) Dividend has no shares × per-share plausibility check — no misread demonstrated; adds new parsing of per-share line and tolerance logic.
  - `[low]` `[patch]` (blind) Test gaps: BUY tax, SELL refund, NOT_A_NAME, DVAG Sparplan unrecognized, script — tests added for the first four; script behaviour checked manually (relative path, stdout only).
  - `[low]` `[patch]` (blind) Negative-net-fee reason points at taxes — now "Gebühren der Abrechnung nicht plausibel (Gutschriften übersteigen Gebühren)".
  - `[false]` `[reject]` (blind) Spec/code drift (reasons.ts unlisted, sign stripping, duplicated extraction call) — reasons.ts is an implementation detail; `parseDecimalInput` handles `-` and spaces itself (german.test.ts); the .mjs script cannot import TS and uses identical options; fix would edit the spec.
  - `[low]` `[reject]` (blind) Duplicated `fixture()`/`MANUAL` in tests — literal wording in tests intentionally pins the user-facing text; cosmetic.
  - `[medium]` `[patch]` (edge) Tax line in another format (amount before currency) silently skipped, tax booked as fee — new `TAX_LABEL_LINE` count check fails the section with "Steuerbetrag nicht lesbar"; test added.
  - `[medium]` `[patch]` (edge) Same root cause: unmatched tax label line ignored — same fix.
  - `[maybe-false]` `[reject]` (edge) Multi-page Abrechnung repeating its "Abrechnung:" header splits into sections — DB samples repeat only the "Filialnummer…" header; if true the document fails safely (low); real samples settle it.
  - `[low]` `[patch]` (edge) Dividend EUR column wrapped onto next line fails as foreign currency — second column now allows `\s+`; test added.
  - `[maybe-false]` `[reject]` (edge) Missing name line could propose "Depot-Nr. …" as name — not observed in any DB layout; name is only an editable suggestion; real samples settle it.
  - `[maybe-false]` `[reject]` (edge) Buchung line > 120 chars before amount — DB samples are far shorter; fails safely if true (low).
  - `[low]` `[patch]` (edge) `extract-pdf-text` resolves relative paths against the package root — now resolved against `INIT_CWD`; checked manually.
  - `[medium]` `[patch]` (edge) Claim: unreadable tax line not invalid, contrary to spec — same fix as the tax-line entry.
  - `[low]` `[patch]` (edge) Claim: values on following line not tolerated for EUR column — same fix as the dividend column entry.
  - `[low]` `[patch]` (verification-gap) BUY tax-sign branch untested — buy-with-tax test added (tax "2", fee "7.9").
  - `[low]` `[patch]` (verification-gap) NOT_A_NAME / long-name guard untested — dividend no-name test added.
  - `[maybe-false]` `[defer]` (verification-gap) Fixtures not tied to real unpdf output — needs anonymised real samples; recorded in `deferred` and `operator_actions` (medium, unverified).
  - `[low]` `[patch]` (verification-gap) Foreign-currency reason without section suffix — same fix as the blind row.
  - `[low]` `[patch]` (intent) Human-owed sample step not recorded as awaiting-operator — spec finalized with `status: awaiting-operator` and `operator_actions`.
  - `[low]` `[reject]` (intent) Tests stay at parser/registry level, not PDF → batch view — `batches.ts` calls the same `parseDocument`; extraction and batch view are tested in 5.1; real PDFs cannot be committed.
  - `[maybe-false]` `[defer]` (intent) Fixtures synthetic, not ROBIN-derived — same root cause as the verification-gap defer row.
  - `[false]` `[reject]` (intent) Work uncommitted — commit is part of finalization, done after review.
  - `[false]` `[reject]` (intent) Script "writes nothing" untested — checked by running it (git status unchanged); it only writes to stdout.

## Design Notes

Fee and tax are derived so that `core/cash` reproduces the bank's booked total: robust against unknown fee line names (XETRA-Kosten, Fremde Spesen, Zuwendungen) and makes the duplicate key against Parqet/manual rows depend on Kurswert, which all sources share. Layout knowledge comes from public, already-anonymised Deutsche Bank sample texts (Portfolio Performance test suite, used for reference only, not copied); real ROBIN unpdf output may differ, hence the operator follow-up with real anonymised samples. Dividend date uses `Zahlbar` (the payment date the broker states), not the Valuta of the credit.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

**Manual checks (if no CLI):**
- `npm run dev`: upload a ROBIN PDF to a Deutsche Bank Depot → batch view shows "erkannt" with proposals.

## Auto Run Result

Status: awaiting-operator

**Summary:** Deutsche Bank / ROBIN parsers registered for `DEUTSCHE_BANK`: `trade` reads "Abrechnung: Kauf/Verkauf von Wertpapieren" (one proposal per section, so multi-execution savings-plan/rebalancing PDFs yield one proposal per execution; fee and tax derived so `core/cash` reproduces the booked total) and `dividend` reads Dividenden-/Ertragsgutschriften (EUR column, tax = gross − credit). Amounts go from German text to decimal strings without floats; claimed but unreadable, foreign-currency, Storno or implausible documents fail with specific German reasons, never partial proposals. All fixtures are synthetic; validating against real anonymised ROBIN samples is owed by the operator.

**Files changed:**
- `src/modules/import/parsers/german.ts` (+ test) — `germanAmount`, `germanDate`, shared token patterns.
- `src/modules/import/parsers/deutsche-bank/trade.ts` (+ test) — settlement parser.
- `src/modules/import/parsers/deutsche-bank/dividend.ts` (+ test) — dividend/distribution parser.
- `src/modules/import/parsers/deutsche-bank/reasons.ts` — German failure reasons.
- `src/modules/import/parsers/registry.ts` (+ test) — both parsers registered for DEUTSCHE_BANK.
- `test/fixtures/import/deutsche-bank/*.txt` + `README.md` — 12 synthetic fixtures and how to add anonymised real samples.
- `scripts/extract-pdf-text.mjs`, `package.json` — `npm run extract-pdf-text -- <file.pdf>` prints unpdf text to stdout.

**Review:** 29 findings (high 0, medium 2, low 17, false 3, maybe-false 7). Patched: medium 1 entry (unmatched tax lines now fail), low 6 entries (foreign reason section suffix, fee reason wording, dividend EUR column on next line, script path, missing tests, awaiting-operator bookkeeping). Deferred: real-unpdf-output verification (medium, unverified) → operator actions. Rejected with reasons in the Review Triage Log: booked-total sign (unreachable for ROBIN), line-joined tax lines, FTT classification, broad Storno match, dot decimals, dividend plausibility, spec drift (false), duplicated test helpers, repeated page header, Depot-Nr. as name, long Buchung line, pipeline-level tests, uncommitted (false), script test (false).

**Follow-up review recommended:** false — first pass patched no `high` and only one `medium` entry.

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` against a throwaway DATABASE_URL — all pass (153 files, 2052 tests). The build logs the known handled "counting open batches failed" for the unmigrated throwaway DB. A transient XIRR timing test failure seen once during implementation under full parallel load did not recur.

**Operator actions owed:** see `operator_actions` in the frontmatter (real anonymised ROBIN samples as fixtures, parser adjustments if layouts differ, manual upload check).

**Residual risks:** real ROBIN unpdf output may differ from the synthetic layouts (line joins, label order, ISIN before the "Abrechnung:" line), so real documents may fail with a specific reason until samples are added; Storno detection rejects any document mentioning "Storno"; foreign-currency documents always need manual entry.
