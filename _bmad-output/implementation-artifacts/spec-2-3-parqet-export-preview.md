---
title: 'Parqet Export Preview (story 2-3)'
type: 'feature'
created: '2026-10-25'
baseline_revision: 'fccb70e207439ed44c0f64483bb72e448adf60fa'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-DepotManagement/parqet-export-format.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      ParqetMigrationWizard's failure Alert, pending label and preview mounting after submit have no interaction test; the browser chain file input → server action → rendered preview is checked only in pieces.
    evidence: |-
      ParqetMigrationWizard.test.tsx renders only the initial null state; ParqetPreviewView and previewFailureMessage are tested on their own; the action is tested with hand-built FormData. vitest runs in the node environment and no DOM testing library is installed (same tooling gap as the corporate-action dialogs). Settle by adding DOM test tooling.
    location: >-
      src/app/_components/migration/ParqetMigrationWizard.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** Tommy's history lives in Parqet CSV exports (one per Depot) and cannot enter DepotManagement; before anything is booked he must see exactly what the file would produce.

**Approach:** A pure reader in `modules/migration` turns one Parqet CSV into chronological AD-14 Transaction proposals, ISIN-change proposals, a Security list and flagged rows. A wizard page "Aus Parqet übernehmen" (from Settings and the Overview empty state) uploads the file and a target Depot to a server action that returns a read-only preview: counts per type, ISIN changes, flagged rows, Securities, and the resulting Positions, invested capital and Cash Account balance as of the export date. Nothing is written; confirming/booking is story 2.4.

## Boundaries & Constraints

**Always:**
- The reader is a pure function `(text) → result` (no DB, no clock, no I/O); it may import `@/core/*` and ledger's pure validators (`isinSchema`, `cryptoSymbolSchema`). Preview reads the DB read-only (Depot, existing Securities).
- Parsing: optional UTF-8 BOM; CRLF/LF; semicolon delimiter; quoted fields with `""` escapes and `;` inside quotes; header row mapped by column name. Numbers use German decimal comma via `parseDecimalInput`; empty `tax`/`fee` = 0. `amount`, `shares`, `fee` and cash amounts are taken as absolute values; `tax` keeps its sign (negative = refund).
- Business date = `businessDate(new Date(datetime))` (Europe/Berlin); time is otherwise dropped. Proposals are ordered oldest first by (business date, instant, reverse file position).
- Mapping (AD-6, AD-7, AD-14, AD-16):
  - `Buy`/`Sell` (Security/Crypto) → BUY/SELL with quantity = shares, price, amount, fee, tax. `Dividend` → DIVIDEND with `amount` (never price × shares), no quantity/price.
  - `cost` with amount 0, fee 0, tax ≠ 0 → TAX (`amount 0`, `tax`, Security if the row names one). Any other `cost` row → flagged `unsupported-row`.
  - Cash pairing: a proposal with non-zero derived cash effect (`core/cash` `cashEffect`) pairs with one unpaired `Cash` row with the identical `datetime` string whose type matches the direction (effect < 0 → `TransferOut`, > 0 → `TransferIn`), choosing the smallest |cash − |effect||. Within €0.01 → paired and collapsed; if they differ, adjust `amount` (TAX: `tax`) so the derived effect equals the cash row exactly, keeping the original as `originalAmount`/`originalTax`. A leftover cash row with the same `datetime` and direction as a proposal that found no pair → both flagged `cash-pair-mismatch`. A proposal with no same-`datetime` cash candidate stays unpaired (exports without cash rows).
  - Remaining Cash `TransferIn` → DEPOSIT, `TransferOut` → WITHDRAWAL (amount).
  - Security/Crypto `TransferOut` + `TransferIn` with the identical `datetime`, exactly one of each there, different identifiers → ISIN-change proposal (old/new identifier, old/new quantity = shares, date). Otherwise every Security/Crypto transfer at that `datetime` is flagged `unpaired-security-transfer`.
  - `assettype Security` → ISIN key (validated with check digit), proposed `UNCLASSIFIED`; `Crypto` → upper-case symbol, CRYPTO. Name = trimmed `holdingname` (newest row wins) cut to 100 chars, fallback the identifier.
- Flags (never booked, excluded from all preview figures, each with its CSV record number, header = 1): `unparseable` (bad datetime/number, quantity > 8 decimals, invalid ISIN/symbol, wrong field count, missing identifier) with the offending column, `non-eur` (`currency` not `EUR`, case-insensitive, including empty) with the currency, `unsupported-row` (unknown type/assettype or unsupported combination, e.g. Cash `Buy`), `unpaired-security-transfer`, `cash-pair-mismatch`. A pair's flag lists both record numbers.
- Export date = latest business date among proposals (empty proposals → latest among all parsed dates; none → no figures).
- Preview figures via core: Positions = `computePositions(rows, [], exportDate, { splits: [], isinChanges })` using Security keys as ids (show quantity and Cost Basis only); invested capital = sum of Cost Basis; cash = `cashBalance(rows, exportDate)`. Sequences = chronological index.
- Server action: session check, zod-validated input (`depotId`, `file`), file ≤ 5 MB; target Depot must exist and not be archived. Never log amounts.
- UI German, de-DE formats, works at phone width, touch targets ≥ 44px, no confirm button (story 2.4).

**Never:**
- No DB writes of any kind (no Security, Transaction, CorporateAction, staging table, migration file); no duplicate matching (2.4); no classification UI or booking (2.4).
- No real Parqet data in the repo; fixtures only synthetic, named `*.csv.txt` under `test/fixtures/`.
- No JS `number` arithmetic on money/quantities; no `.gitignore` exceptions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buy + cash pair | Buy 10 @ `12,3456` amount `123,456` fee `1` tax `0`; Cash TransferOut `124,46` same datetime | one BUY amount `123.46` (`originalAmount 123.456`), cash −124.46 | — |
| Sell with refund | Sell amount `500` fee `1` tax `-2`; Cash TransferIn `501` | SELL tax `-2`, cash +501 | — |
| Dividend shares=1 | Dividend shares `1` price `30` amount `30` tax `4,5`; TransferIn `25,5` | DIVIDEND amount 30, tax 4.5, no quantity | — |
| Tax-only cost | cost amount 0 tax `3,1`; TransferOut `3,1` | TAX tax 3.1 | — |
| Deposit / withdrawal | unpaired Cash TransferIn `1000`, TransferOut `50` | DEPOSIT 1000, WITHDRAWAL 50 | — |
| ISIN change | same datetime: TransferOut A 10, TransferIn B 5 | ISIN change A→B 10:5; B Position with A's Cost Basis | — |
| Unpaired transfer | lone Security TransferIn | flagged `unpaired-security-transfer` | not booked |
| Non-EUR | currency `USD` | flagged `non-eur` (USD) | not booked |
| Bad row | datetime `garbage` / shares `abc` | flagged `unparseable` (column) | not booked |
| Cash mismatch | Buy cash effect 100; TransferOut `90` same datetime | both flagged `cash-pair-mismatch` | not booked |
| Synthetic time | `2024-03-01T00:00:00.000Z` / `T06:00:00.000Z`; `2024-03-31T22:30:00Z` | `2024-03-01`; `2024-04-01` | — |
| Crypto | Buy `BTC` shares `0,00012345` | BUY quantity 0.00012345, Security CRYPTO `BTC` | — |
| Order | file newest first | proposals oldest first | — |
| Missing columns | header without `amount` | `{ ok: false, reason: "missing-columns", columns: ["amount"] }` | German message |
| Empty / no rows | empty text or header only | `empty-file` | German message |
| Archived / unknown Depot | depotId archived or missing | `depot-archived` / `depot-not-found` | German message |
| Existing Security | ISIN already in ledger | Security listed with its stored name and type | — |

</intent-contract>

## Code Map

- `src/core/cash.ts` -- `cashEffect`, `cashBalance` (reuse for pairing and the preview balance).
- `src/core/positions.ts:30` -- `computePositions(rows, observations, today, actions)`; `src/core/corporate-actions.ts:23` `IsinChange` shape (pass ISIN changes in chronological order).
- `src/core/dates.ts:34` `businessDate(instant)`; `src/core/decimal-input.ts:18` `parseDecimalInput`; `src/core/decimal.ts` `ExactDecimal`, `canonicalDecimal`.
- `src/core/format.ts` -- `formatMoney`, `formatQuantity`, `formatDate` for the UI.
- `src/modules/ledger/securities.ts:59` `isinSchema`, `cryptoSymbolSchema`, `SECURITY_NAME_MAX_LENGTH`; `listSecurities` (read-only lookup by `isin`/`cryptoSymbol`). Export the schemas from `src/modules/ledger/index.ts` if not exported.
- `src/modules/ledger/depots.ts:219` `getDepot(id)` (`archived` flag), `listDepots()`.
- `src/modules/ledger/transactions.ts:22` `QUANTITY_MAX_DECIMALS` (8).
- `src/app/_actions/depots.ts` -- server-action pattern (`"use server"`, `getSession`, zod, `UNAUTHORIZED`); tests in `src/app/_actions/*.test.ts`.
- `src/app/(app)/page.tsx:26` -- disabled "Aus Parqet übernehmen" button to enable (link to `/settings/parqet`).
- `src/app/(app)/settings/page.tsx` -- add section "Parqet-Migration" with link button "Aus Parqet übernehmen".
- `src/app/_components/depots/DepotDialogs.tsx` `CreateDepotButton` -- reuse when no active Depot exists.
- `test/helpers/test-db.ts`, `test/helpers/migrated-db-file.ts`, `test/helpers/render-text.ts`, `test/helpers/next-mocks.ts` -- DB and page test patterns (see `src/app/(app)/settings/page.test.tsx`).
- `next.config.ts` -- add `experimental.serverActions.bodySizeLimit: "6mb"` (default 1 MB is too small for multi-year exports).

## Tasks & Acceptance

**Execution:**
- `src/modules/migration/csv.ts` (+ test) -- semicolon CSV tokenizer (BOM, quotes, `""`, `;`/newline in quotes, CRLF) returning records with record numbers.
- `src/modules/migration/parqet-reader.ts` (+ test) -- `readParqetCsv(text)` → `{ ok: true; proposals; isinChanges; securities; flagged; exportDate } | { ok: false; reason: "empty-file" | "missing-columns"; columns? }` implementing every mapping/flag rule; types `TransactionProposal` (`type, date, sequence, securityKey | null, quantity, price, amount, fee, tax, realizedGain | null, originalAmount?, originalTax?, records`), `IsinChangeProposal`, `ParqetSecurity { key, isin | cryptoSymbol, name, proposedAssetType }`, `FlaggedRow { records, reason, detail? }`. Test every I/O matrix row against `test/fixtures/parqet/synthetic-export.csv.txt` (synthetic, anonymised, newest first, covering every quirk of `parqet-export-format.md`) plus inline strings for edge cases.
- `src/modules/migration/preview.ts` (+ test, temp DB) -- `previewParqetMigration(depotId, text, db?)`: Depot checks, reader, existing-Security annotation, figures (counts per type, Positions with Security name/key, invested capital, cash balance); result is plain serialisable data. `src/modules/migration/index.ts` exports it and the types.
- `src/app/_actions/migration.ts` (+ test) -- `previewParqetAction(prev, formData)`; reasons `unauthorized | file-missing | file-too-large | depot-not-found | depot-archived | empty-file | missing-columns`.
- `src/app/_components/migration/labels.ts` (+ test) -- German texts for failure reasons, flag reasons, transaction type counts.
- `src/app/_components/migration/ParqetMigrationWizard.tsx` -- client form (file input `.csv`, Depot select of non-archived Depots, "Vorschau anzeigen"), `useActionState`; renders preview: "Vorschau – {Depot}, Stand {date}", note "Es wurde noch nichts gebucht.", counts table, ISIN-Wechsel, "Markierte Zeilen" (Zeile n, reason), Wertpapiere (chip "Typ unbekannt" for UNCLASSIFIED, else stored/proposed type), result block (Positions: Wertpapier, Stück, Einstand; "Investiertes Kapital"; "Verrechnungskonto"); "Rundung angeglichen: n" when adjustments exist.
- `src/app/(app)/settings/parqet/page.tsx` (+ test) -- title "Aus Parqet übernehmen"; loads `listDepots()`, passes non-archived; without one shows "Lege zuerst ein Depot an." + `CreateDepotButton`.
- `src/app/(app)/settings/page.tsx`, `src/app/(app)/page.tsx` (+ tests) -- entry links.
- `next.config.ts` -- body size limit.

**Acceptance Criteria:**
- Given a Depot exists, when I open Settings or the Overview empty state, then "Aus Parqet übernehmen" is an enabled link to the wizard.
- Given I upload a Parqet CSV and pick a target Depot, when I request the preview, then I see counts per type, detected ISIN changes, flagged rows with reasons, Securities (unknown type marked "Typ unbekannt"), and Positions, invested capital and Cash Account balance as of the export date — and the database is unchanged (no new rows in any table).
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 35 findings — high 0, medium 1, low 31, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: a flagged trade's same-datetime Cash row became a DEPOSIT/WITHDRAWAL and entered the cash balance — fixed: leftover cash rows at the instant of a flagged non-cash row join that row's flag; test (USD Buy + EUR cash → one non-eur flag, records [2, 3]).
  - `[low]` `[reject]` Blind: greedy pairing can flag two valid same-datetime pairs as mismatch — needs two same-instant trades whose amounts differ by cents; fix needs a global assignment algorithm.
  - `[low]` `[patch]` Blind: pairing/grouping by raw datetime string — now compared by parsed instant; test with `Z` vs `+02:00` / `.000+00:00` spellings.
  - `[low]` `[reject]` Blind: uploads > 6 MB hit the framework limit and an error boundary — Parqet exports of that size are implausible; fix adds client-side size state.
  - `[low]` `[reject]` Blind: raised body limit applies to all server actions — single-user app behind login; harm negligible.
  - `[low]` `[patch]` Blind: no hint that preview figures ignore the target Depot's existing ledger — heading now "Ergebnis laut Datei am …"; duplicate matching stays story 2.4.
  - `[low]` `[reject]` Blind: reader imports the ledger barrel, which instantiates Prisma — spec permits ledger's validators; preview runs server-side where the client is loaded anyway; fix needs moving schemas to a new file.
  - `[low]` `[reject]` Blind: stale preview stays visible after changing Depot/file — no booking possible in this story; fix adds reset state (relevant to 2.4).
  - `[low]` `[reject]` Blind: "Zeile N" is the record number, not the physical line — identical unless a quoted field spans lines (rare); spec defines record numbers.
  - `[low]` `[reject]` Blind: duplicated "5 MB" text, PROPOSAL_TYPE_ORDER and PreviewFailureReason names — client labels cannot import the module barrel (Prisma) without bundling it; drift unlikely.
  - `[low]` `[patch]` Blind: Positions sort without tie-breaker — security key added as tie-breaker.
  - `[low]` `[defer]` Blind: wizard interaction paths untested (plus action check order — already covered at migration.test.ts; non-UTF-8 upload — rejected, exports are UTF-8) — grouped with the UI tooling gap; deferred.
  - `[low]` `[reject]` Edge: > 6 MB upload error boundary — same as the Blind finding.
  - `[low]` `[patch]` Edge: impossible datetimes (`2024-02-30`, `T24:00`) roll over silently — now `unparseable` via `isBusinessDate` and hour/minute range; tests added.
  - `[low]` `[patch]` Edge: pairing by datetime string — same fix as the Blind finding.
  - `[low]` `[patch]` Edge: ISIN change after the last Transaction excluded from export date — export date now spans Transaction and ISIN-change proposals; test added.
  - `[low]` `[reject]` Edge: same-date trade before an ISIN change replays after it — AD-8 applies corporate actions before Transactions on one date (same as story 2.2).
  - `[low]` `[reject]` Edge: alignment could yield a negative amount when fee+tax ≈ cash — implausible data; fix adds a guard.
  - `[low]` `[reject]` Edge: zero-amount Cash transfer becomes a 0 DEPOSIT — implausible; fix adds a guard; 2.4 validation would surface it.
  - `[low]` `[reject]` Edge: negative Buy/Sell price passes through — Parqet prices are non-negative; fix adds a guard.
  - `[low]` `[reject]` Edge: greedy pairing — same as the Blind finding.
  - `[low]` `[reject]` Edge: unterminated quote merges remaining rows into one flagged record — corrupt export only; still visible as an unparseable flag; fix adds an error path.
  - `[low]` `[reject]` Edge: non-UTF-8 upload garbles names — Parqet exports UTF-8; fix adds decoding/error branches.
  - `[low]` `[patch]` Verification gap: SELL/DIVIDEND and TAX-refund alignment untested — tests added (Sell 500.004→500, Dividend 30.005→30, TAX −3.104→−3.1).
  - `[low]` `[patch]` Verification gap: body size limit untested — limit moved to `PARQET_MAX_FILE_BYTES` (`src/modules/migration/limits.ts`); `test/architecture/next-config.test.ts` asserts the config exceeds it.
  - `[low]` `[defer]` Verification gap: wizard failure/preview states never rendered — no DOM test tooling; deferred.
  - `[low]` `[reject]` Verification gap (other): > 6 MB error boundary — same as the Blind finding.
  - `[low]` `[patch]` Verification gap (other): empty `realizedgains` → null unpinned — test asserts null and a signed value.
  - `[low]` `[defer]` Intent alignment: ACs live at the browser surface, tests exercise pieces — same UI tooling gap; deferred.
  - `[false]` `[reject]` Intent alignment: epic adjusts any mismatch, diff flags > €0.01 — a difference above a cent is not a rounding mismatch; flagging keeps "never booked silently".
  - `[low]` `[reject]` Intent alignment: export date from filename vs latest booking — Positions, Cost Basis and cash are identical between the last booking and the export instant; filenames can be renamed.
  - `[low]` `[patch]` Intent alignment: file-only vs Depot-after-migration figures — same fix as the Blind finding (heading "laut Datei").
  - `[false]` `[reject]` Intent alignment: unclassified Securities not among flagged rows — they are surfaced in the Securities section with a "Typ unbekannt" chip; nothing is hidden.
  - `[low]` `[reject]` Intent alignment: one form instead of a stepped wizard — same inputs in the UX order; steps add no information before 2.4.
  - `[false]` `[reject]` Intent alignment: work not committed — finalization commits it.

## Design Notes

Preview figures use only the file's proposals (what the file implies), not the target Depot's existing ledger; duplicate matching against the ledger is story 2.4. Story 2.4 will re-run `readParqetCsv` on the same file at confirmation, so the preview keeps no server-side state. Pairing example: BUY amount 123.456, fee 1, tax 0 → effect −124.456; cash row 124.46 → |diff| 0.004 ≤ 0.01 → amount := 124.46 − 1 − 0 = 123.46.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed, including new reader, preview, action, label and page tests.

**Manual checks (if no CLI):**
- `npm run dev`: Settings → "Aus Parqet übernehmen", upload `test/fixtures/parqet/synthetic-export.csv.txt`, pick a Depot → preview shows counts, the ISIN change, flagged rows and figures; Depot page unchanged.

## Auto Run Result

Status: done

**Summary:** A pure reader (`src/modules/migration/parqet-reader.ts`, CSV tokenizer in `csv.ts`) turns a Parqet CSV into chronological AD-14 Transaction proposals (cash pairs collapsed and rounding-aligned, dividends from `amount`, tax refunds, tax-only cost rows, deposits/withdrawals, Berlin business dates), ISIN-change proposals, Securities (UNCLASSIFIED / CRYPTO) and flagged rows (unparseable, non-EUR, unsupported, unpaired transfers, cash mismatches). `previewParqetMigration` checks the target Depot, marks existing Securities and computes counts, Positions, invested capital and cash balance via core — read-only. The wizard at `/settings/parqet` ("Aus Parqet übernehmen", linked from Settings and the Overview empty state) uploads file + Depot to `previewParqetAction` and renders the preview. Nothing is written.

**Files changed:**
- `src/modules/migration/csv.ts`, `parqet-reader.ts`, `preview.ts`, `limits.ts`, `index.ts` (+ tests) — reader, preview service, file limit.
- `test/fixtures/parqet/synthetic-export.csv.txt` — synthetic fixture covering every format quirk.
- `src/modules/ledger/index.ts` — exports `isinSchema`, `cryptoSymbolSchema`.
- `src/app/_actions/migration.ts` (+ test) — `previewParqetAction`.
- `src/app/_components/migration/ParqetMigrationWizard.tsx`, `ParqetMigrationLink.tsx`, `labels.ts` (+ tests) — UI and German texts.
- `src/app/(app)/settings/parqet/page.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/page.tsx` (+ tests) — wizard page and entry links.
- `next.config.ts`, `test/architecture/next-config.test.ts` — 6 MB server-action body limit and its test.

**Review findings:** 35 findings; 11 rows patched (1 medium: flagged trade's cash leg; low: instant-based pairing, impossible datetimes, export date incl. ISIN changes, Positions tie-break, "laut Datei" heading, alignment/realizedGain tests, body-limit constant + test); 3 deferred as one entry (wizard interaction tests — no DOM tooling); 21 rejected (3 false, 18 low not worth a non-trivial fix — reasons in the triage log).

**Follow-up review recommendation:** false — patched entries: high 0, medium 1, low 8 (entries).

**Verification:** `npm run lint && npm run typecheck && npm test && npm run build` — all passed (58 files, 882 tests) after patches. Manual browser check not performed.

**Residual risks:** greedy cash pairing can flag valid same-instant pairs whose amounts differ by cents; same-date trades before an ISIN change replay after it (AD-8); uploads above 6 MB hit the framework limit instead of the German message; the wizard has no interaction test; real exports may differ from the observed format (e.g. `cost` rows) — story 2.4's reconciliation against a real local export is the check.
