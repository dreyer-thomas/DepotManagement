---
title: 'finanzen.net zero / Baader Bank Parser'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '1590b7e664356d3b1bf0290a9af05499435c70fb'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A tax-pot notice that moves cash with wording other than Zu Lasten/Gunsten Konto, erstatten wir or belasten wir would be stored as NO_BOOKING and its booking lost.
    evidence: |-
      Only the anonymised fixture tax-pot-no-booking.txt (no posting) is known; refunds come as Steuerausgleichsrechnung, which the tax-refund parser claims first. Settled by a real Baader tax-pot notice that also moves cash, or by confirming such notices never move cash.
    location: >-
      src/modules/import/parsers/finanzen-zero/tax-pot.ts:349
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The `FINANZEN_ZERO` entry of the parser registry is empty, so every finanzen.net zero (Baader Bank) document fails with "Layout nicht erkannt" and the third Depot still needs manual bookkeeping. Some of its documents need no booking (tax-pot notices) or must never be booked as trades (corporate actions).

**Approach:** Five pure parsers registered for `FINANZEN_ZERO` (`corporate-action`, `trade`, `dividend`, `tax-refund`, `tax-pot`, tried in that order), tested against the anonymised real-layout fixtures in `test/fixtures/import/finanzen-zero/`. The parser contract gains a no-booking result so a tax-pot notice is stored as the existing item status `NO_BOOKING` (story 5.4) with "Keine Buchung erforderlich.". Review and booking (5.3) stay unchanged.

## Boundaries & Constraints

**Always:**
- Same parser rules as stories 5.2/5.4: pure, German amounts straight to decimal strings (`germanAmount`, `ExactDecimal`), never `Number`; every parser returns `{ error: "unrecognized" }` unless the text contains `Baader Bank` and its own title; once claimed, any unreadable field, non-EUR value, `Storno`, unknown position line or failed arithmetic check → `{ error: "invalid", message }` with a specific German reason ending "Buchung bitte manuell erfassen." (shared builders from `parsers/reasons.ts`) — never partial proposals.
- **Signed position lines:** a line `<label> <amount>EUR` or `<label> <amount> -EUR` has value v (trailing `-` → negative). Trade lines are only those between the `Kurswert` line and the `Zu Lasten/Zu Gunsten Konto` line, dividend lines only those between `Bruttobetrag EUR` and the credited line — later pages (`Steuerbeträge`, `Merkposten / Steuertöpfe`) are never read. Tax labels: `Kapitalertragsteuer`, `Solidaritätszuschlag`, `Kirchensteuer` and any label ending in `Quellensteuer`; fee labels: `Finanzkommission …`, `Vermittlungsentgelt …`, `Handelsplatzabhängige Gutschrift …` (trade), `Gebühren extern …` (dividend). Any other label → invalid "Position „<label>“ wird nicht unterstützt. Buchung bitte manuell erfassen.".
- **Trade** (title line `Wertpapierabrechnung: Kauf|Verkauf`): BUY/SELL from the title; `isin` from `ISIN: <ISIN>`; `name` = rest of the first line `STK <qty> <name>` (dropped if over `SECURITY_NAME_MAX_LENGTH`); the execution line `<Handelsdatum>STK <qty> EUR <price> <time>` must occur exactly once (several → invalid "Mehrere Teilausführungen …"); `date` = Handelsdatum, `quantity`/`price` from it (quantity must equal the `STK` quantity; |qty × price − Kurswert| ≤ 0.01); `amount` = `EURKurswert <amount>`; BUY fee = Σv(fee lines), tax = Σv(tax lines); SELL fee = −Σv(fee lines), tax = −Σv(tax lines) (so on a sell a trailing `-` means paid, and the Gutschrift is a negative fee in both directions); fee < 0 → invalid; `Zu Lasten` must go with BUY and `Zu Gunsten` with SELL, and `cashEffect` (`src/core/cash.ts`) of the proposal must equal −total (BUY) / +total (SELL), else invalid "Abrechnungsbetrag stimmt nicht mit Kurswert, Gebühren und Steuern überein. Buchung bitte manuell erfassen.".
- **Dividend** (title line `Dividendenabrechnung` or `Fondsausschüttung`): `date` = `Zahltag:`; `isin` from `ISIN: <ISIN>`; `name` = text after `p.STK` on the per-share line; `amount` = `Bruttobetrag EUR` (missing → foreign-currency invalid); tax = −Σv(tax lines), fee = −Σv(fee lines) (fee < 0 → invalid); credited = `<amount>EURValuta: … Zu Gunsten Konto`; `cashEffect` must equal credited (= gross − tax − fee), else invalid.
- **Tax refund** (title `Steuerausgleichsrechnung`): requires the line `<amount>EURErstattung` (absent → invalid "Steuerausgleichsrechnung ohne Erstattung wird nicht unterstützt. Buchung bitte manuell erfassen."); the lines `<label> EUR <amount>` after `Rückerstattung bereits gezahlter:` must sum to it, and the sentence `in Höhe von <amount> EUR` must match where present; one TAX with `amount 0`, `tax = −Erstattung`, no ISIN/name; `date` = the first line consisting only of a date (document date).
- **Tax pot** (title `Verlusttopfoptimierung`, or the phrase `Anpassung in den bei uns für Sie geführten Steuertöpfen`): with no account posting (`Zu Lasten Konto`, `Zu Gunsten Konto`, `erstatten wir`, `belasten wir`) → no-booking result "Keine Buchung erforderlich."; with one → invalid "Steuertopf-Mitteilung mit Kontobuchung wird nicht unterstützt. Buchung bitte manuell erfassen.".
- **Corporate action** (tried first; a title line `Obligatorischer Umtausch`, `Freiwilliger Umtausch`, `Umtausch`, `Aktiensplit`, `Reverse Split`, `Split`, `Kapitalerhöhung`, `Kapitalherabsetzung`, `Spin-off`, `Abspaltung`, `Fusion`, `Verschmelzung`, or `Einbuchung in Depot` / `Ausbuchung aus Depot` anywhere) → invalid with exactly "Kapitalmaßnahme bitte als Corporate Action erfassen.".
- **Contract:** `ParsedDocument` gains `noBooking?: string` (German info; valid only with empty `proposals` and no `link`, else `INVALID_OUTPUT_REASON`); `parseDocument` returns `{ status: "NO_BOOKING", documentType, reason }`; `linkDocuments` passes it through unchanged; `createImportBatch` stores it as `NO_BOOKING` like a merged comdirect notice.

**Never:** No real documents or personal data committed (only the existing fixtures plus synthetic variants derived from them); no change to booking, `core/duplicates`, ledger, review UI, comdirect or Deutsche Bank parser behavior; no corporate-action booking; no foreign-currency conversion; no I/O or logging in parsers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buy | `buy.txt` | BUY 2026-04-15 DE0007236101 "Siemens AG" 12 @ 180.5, amount 2166, fee 0, tax 0 | — |
| Sell with tax | `sell.txt` | SELL 2026-05-15 DE0005557508 "Deutsche Telekom AG" 30 @ 25.4, amount 762, fee 1, tax 42.73 (page-3 Steuerbeträge ignored) | — |
| Dividend | `dividend.txt` | DIVIDEND 2026-07-10 US8740391003 "Taiwan Semiconductor Manufacturing Co. Ltd." amount 6.1, tax 1.53, fee 0.05 | — |
| Fund distribution | `fund-distribution.txt` | DIVIDEND 2026-07-29 US7561091049 "Realty Income Corp." amount 4.74, tax 1.26, fee 0 | — |
| Tax refund | `tax-refund.txt` | TAX 2026-08-29 amount 0, tax −18.99, no ISIN | sum ≠ Erstattung → invalid |
| Tax pot | `tax-pot-no-booking.txt` | NO_BOOKING "Keine Buchung erforderlich." | with account posting → invalid |
| ISIN change | `isin-change.txt` | FAILED "Kapitalmaßnahme bitte als Corporate Action erfassen." | — |
| Wrong total | trade/dividend with altered total | — | invalid (cash check) |
| Net fee credit | Gutschrift > fees | — | invalid |
| Unknown position, foreign Kurswert, two executions, Storno, missing ISIN | variants of the fixtures | — | invalid with specific reason |
| Other text | non-Baader text or Baader text without a known title | unrecognized → layout message | — |

</intent-contract>

## Code Map

- `src/modules/import/proposal.ts:125-140` -- `ParsedDocument`, `parsedDocumentSchema`: add `noBooking`.
- `src/modules/import/parsers/registry.ts` -- `PARSERS.FINANZEN_ZERO: []` to fill; `ParseOutcome` gains `NO_BOOKING`; `parseDocument` maps `noBooking`; header comment "finanzen.net zero stays manual" to update.
- `src/modules/import/parsers/registry.test.ts:35,38` -- production-registry assertions for `FINANZEN_ZERO` to update; add stub-parser tests for the no-booking contract.
- `src/modules/import/parsers/link.ts:43-52` -- outcome mapping: pass `NO_BOOKING` through (`LinkedOutcome` already has it).
- `src/modules/import/batches.ts:253-281` -- stores linked outcomes (`reason`, `documentType`); should need no change beyond types — verify.
- `src/modules/import/parsers/german.ts` -- `germanAmount`, `germanDate`, `AMOUNT_PATTERN`, `DATE_PATTERN`, `ISIN_PATTERN`.
- `src/modules/import/parsers/reasons.ts` -- `MANUAL`, `STORNO_REASON`, `foreignCurrencyReason`, `missingFieldReason`, `implausibleReason`.
- `src/modules/import/parsers/comdirect/{dividend,reasons}.ts` -- style precedent (regex constants, name guard, reasons module re-exporting shared builders).
- `src/core/cash.ts:54` -- `cashEffect(row)` for the arithmetic checks.
- `src/modules/import/review.ts`, `src/app/_components/import/*` -- already render `NO_BOOKING` (chip "keine Buchung" + reason); read-only.
- `test/fixtures/import/finanzen-zero/*.txt` -- anonymised real layouts (read-only); `test/fixtures/import/comdirect/README.md` -- README precedent.

## Tasks & Acceptance

**Execution:**
- `src/modules/import/proposal.ts`, `parsers/registry.ts`, `parsers/link.ts` (+ `registry.test.ts`, `link.test.ts`) -- no-booking contract and passthrough; FINANZEN_ZERO entries in order `corporate-action`, `trade`, `dividend`, `tax-refund`, `tax-pot`.
- `src/modules/import/parsers/finanzen-zero/{positions,reasons,corporate-action,trade,dividend,tax-refund,tax-pot}.ts` -- shared signed-line reader in `positions.ts`; parsers per the rules.
- `src/modules/import/parsers/finanzen-zero/*.test.ts` -- every matrix row through `parseDocument("FINANZEN_ZERO", …)` with exact decimals; error variants built by string replacement on the fixtures.
- `test/fixtures/import/finanzen-zero/README.md` -- how to extract and anonymise further samples (as comdirect).
- `src/modules/import/batches.test.ts` -- DB test: a FINANZEN_ZERO upload of `buy.txt`, `tax-refund.txt`, `tax-pot-no-booking.txt` and `isin-change.txt` yields PARSED, PARSED, NO_BOOKING and FAILED items; booking books exactly the BUY and the TAX.

**Acceptance Criteria:**
- Given a `FINANZEN_ZERO` Depot, when the fixtures are uploaded as one batch, then the review shows the matrix proposals and booking them uses the story 5.3 flow unchanged.
- Given a tax-pot notice in a batch, when reviewed, then it shows chip "keine Buchung" with "Keine Buchung erforderlich." and is not counted in "N Buchungen buchen".
- Given any claimed but unreadable or arithmetically inconsistent Baader document, when parsed, then the item is FAILED with a specific German reason and no proposals.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 23 findings — high 0, medium 0, low 11, false 6, maybe-false 6
- findings:
  - `[maybe-false]` `[reject]` (blind) Tax labels matched exactly; qualified page-1 labels like "Kapitalertragsteuer Aktiengewinne" would fail — real page-1 lines in sell/dividend fixtures use the bare labels; if a qualified label occurs the file fails safely with "Position … wird nicht unterstützt" (low); settled by a real sample.
  - `[low]` `[reject]` (blind) Tax-refund lines not checked against tax labels — the block follows "Rückerstattung bereits gezahlter:" and must sum to the Erstattung; a non-tax line there is unlikely and the fix adds a guard.
  - `[low]` `[reject]` (blind) Tax-refund loop stops at the first non-matching line, giving a misleading sum reason — the file still fails safely to manual entry; only the wording differs in an unseen layout.
  - `[maybe-false]` `[reject]` (blind) Steuerausgleichsrechnung without money fails instead of NO_BOOKING — spec mandates invalid without Erstattung; unknown whether such a notice exists; if true the user just ignores a failed item (low).
  - `[low]` `[patch]` (blind) No test for a loss sale with refunded (unsigned) tax — added a sell variant expecting tax −10.55.
  - `[low]` `[patch]` (blind) No test for a refunded tax line on a dividend — added a variant expecting tax −1.03.
  - `[low]` `[reject]` (blind) Dividend not checked against share count × rate — the credited-amount check already guards arithmetic; a per-share check across currency conversion adds complexity and rounding risk.
  - `[low]` `[patch]` (blind) No test for fractional quantities — added STK 0,4321 buy expecting quantity "0.4321".
  - `[low]` `[patch]` (blind) noBooking with note accepted and note dropped — registry now fails it with INVALID_OUTPUT_REASON; test added.
  - `[false]` `[reject]` (blind) documentType lost for corporate actions — FAILED outcomes never carry a documentType for any broker; no requirement needs it.
  - `[low]` `[patch]` (blind) No test for a tax refund without document date — test added ("Belegdatum nicht lesbar").
  - `[low]` `[reject]` (blind) Helper constants and test helpers repeated across files — same per-file pattern as the comdirect and Deutsche Bank parsers; no named harm.
  - `[false]` `[reject]` (blind) Sprint status not updated — sprint-status.yaml is owned by the orchestrator; the spec is committed at finalization.
  - `[maybe-false]` `[defer]` (edge) Tax-pot posting detection misses other cash wordings → booking lost as NO_BOOKING — recorded in `deferred` (medium, unverified); settled by a real tax-pot notice with a posting.
  - `[low]` `[patch]` (edge) noBooking with note silently drops the note — same entry as the blind noBooking row.
  - `[maybe-false]` `[reject]` (edge) Tax-refund date taken from the first standalone date line may pick another date — in the real layout the letter date is the first such line; the date is visible and editable in review (low if true).
  - `[low]` `[reject]` (edge) Corporate-action titles incomplete (Bezugsrechte, Gratisaktien) — such files fail safely with "Layout nicht erkannt"; only the hint differs.
  - `[low]` `[patch]` (verification-gap) Storno handling of tax-refund and tax-pot untested — tests added for both.
  - `[low]` `[reject]` (intent) Service-level upload test covers 4 of 7 fixtures — the other three are covered with exact values at parser level and booking is generic (story 5.3 tests DIVIDEND/SELL booking).
  - `[false]` `[reject]` (intent) "keine Buchung" chip tested only by proxy — ImportReview.dom.test.tsx (story 5.4) already tests the NO_BOOKING chip and reason rendering; this story does not change the UI.
  - `[maybe-false]` `[reject]` (intent) Corporate-action detection broader than the AC (Einbuchung/Ausbuchung in Depot) — the AC covers "other corporate-action notices"; trade fixtures use "Die Wertpapiere buchen wir …", so no trade is affected; if a trade were caught it fails safely (low).
  - `[false]` `[reject]` (intent) Parser contract changed although 5.3 should apply unchanged — booking and review code are unchanged; the contract extension is additive and all Deutsche Bank/comdirect suites pass.
  - `[false]` `[reject]` (intent) Work uncommitted and spec without final status — finalization commits and sets the status; no human-only action exists, so no awaiting-operator.

## Design Notes

Baader prints position lines signed relative to the Kurswert's direction: on the buy the fees are unsigned and the Gutschrift carries `-`; on the sell the taxes and fees carry `-` and the Gutschrift is unsigned. Hence booked total = Kurswert + Σv in both directions, and fee/tax flip sign on SELL. This matches the AC ("trailing `-` marks an amount paid" on sells, Gutschrift as negative fee) and the `cashEffect` check rejects any document where the reading is wrong. Partial fills share one fee block, so one proposal per execution is not derivable; such documents fail to manual entry. The tax-refund date is the document date because the notice has no Valuta.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` (throwaway `DATABASE_URL`) -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** Five pure parsers registered for `FINANZEN_ZERO` (`corporate-action`, `trade`, `dividend`, `tax-refund`, `tax-pot`). Settlements yield one BUY/SELL with fee/tax from the signed page-1 position lines (signed relative to the Kurswert, Gutschrift as negative fee) and a `cashEffect` check against the account total; dividends and fund distributions yield one DIVIDEND checked against the credited amount; a Steuerausgleichsrechnung with Erstattung yields one TAX with negative tax and no Security; tax-pot notices return the new no-booking result and are stored as `NO_BOOKING` "Keine Buchung erforderlich."; corporate actions fail with "Kapitalmaßnahme bitte als Corporate Action erfassen.". Review and booking (5.3) unchanged.

**Files changed:**
- `src/modules/import/proposal.ts` — `ParsedDocument.noBooking` and schema.
- `src/modules/import/parsers/registry.ts` (+ test) — FINANZEN_ZERO entries, `NO_BOOKING` outcome, invalid combinations rejected.
- `src/modules/import/parsers/link.ts` (+ test) — NO_BOOKING passthrough.
- `src/modules/import/parsers/finanzen-zero/{positions,reasons,corporate-action,trade,dividend,tax-refund,tax-pot}.ts` — the parsers, shared signed-line reader and German reasons.
- `src/modules/import/parsers/finanzen-zero/{trade,dividend,tax}.test.ts` — every matrix row and error variant through `parseDocument("FINANZEN_ZERO", …)`.
- `src/modules/import/batches.test.ts` — DB test: buy, tax refund, tax-pot and ISIN-change upload; books exactly BUY and TAX.
- `test/fixtures/import/finanzen-zero/README.md` — how to add anonymised samples.

**Review:** 23 findings (high 0, medium 0, low 11, false 6, maybe-false 6). Patched (all low): noBooking+note rejected; tests for Storno on tax-refund/tax-pot, missing refund date, loss sale with refunded tax, fractional quantity, refunded dividend tax. Deferred: tax-pot notices moving cash with unknown wording (medium, unverified). Rejected with reasons in the Review Triage Log: exact tax labels, refund label check, refund loop wording, refund-less Steuerausgleichsrechnung, dividend share-count check, repeated helpers, sprint status (false), documentType on corporate actions (false), refund date heuristic, incomplete corporate-action titles, partial service-level coverage, UI proxy (false), broad corporate-action detection, contract change (false), uncommitted work (false).

**Follow-up review recommended:** false — first pass patched 0 high and 0 medium entries (6 low).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` with a throwaway `DATABASE_URL`: all pass after the patches (162 files, 2239 tests). Every I/O matrix row is covered by passing tests. No manual `npm run dev` upload.

**Residual risks:** only the seven anonymised layouts are known; deviating real layouts (qualified tax labels, partial fills, other corporate-action titles, refund-less Steuerausgleichsrechnung) fail safely to manual entry; tax-pot notices that move cash with unknown wording are deferred. No human-only acceptance criterion, so no operator actions.
