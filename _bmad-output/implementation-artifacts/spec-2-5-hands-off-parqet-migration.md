---
title: 'Hands-off Parqet Migration (story 2-5)'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '42c7c9785eb348f5d1843b5ee7529cb2c4e5bae2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-25.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The Parqet migration (2.3/2.4) blocks "Übernehmen" until every new Security is classified by hand (all arrive `UNCLASSIFIED`), flags every Security `TransferIn` that is not a 1:1 ISIN change (e.g. five fund units delivered into the Depot at one instant) and every other flag needs a skip/correct decision; active mutual funds have no asset type at all.

**Approach:** Add `FUND` ("Fonds") to `AssetType`; estimate each new Security's type with a pure core name classifier (overridable inline); pair same-instant Security transfers by ISIN into splits, then ISIN changes, and book every remaining `TransferIn` as a delivery (BUY + equal DEPOSIT); flags no longer block — they sit in a collapsed "Nicht übernommen (n)" section, skipped by default, with one "Alle wie in Parqet übernehmen" action. Only duplicates against an existing ledger still ask.

## Boundaries & Constraints

**Always:**
- Classifier (`src/core`, pure, case-insensitive, whole-word/phrase matching so "Fetch" ≠ ETC), first match wins: (1) `ETF`, `ETC`, `ETN`, `UCITS ETF` or issuer `iShares`, `Xtrackers`, `Vanguard`, `Amundi`, `Lyxor`, `SPDR`, `Invesco`, `WisdomTree` → ETF; (2) `Turbo`, `Knock-Out`, `Mini Future`, `Optionsschein`, `Open End` → CERTIFICATE; (3) `SICAV`, `Fund`, `Funds`, `Fonds` → FUND; (4) else STOCK. Parqet `Crypto` rows stay CRYPTO. Existing ledger Securities keep their stored type.
- Transfer grouping per instant, in order: (a) per ISIN/symbol, pair `TransferOut` with `TransferIn` (file order) → split proposal, ratio `old:new` = old quantity : new quantity reduced to coprime integers; (b) of the rest, exactly one out + one in (different keys) → ISIN change; (c) every remaining `TransferIn` → delivery; (d) every remaining `TransferOut` → flag `unpaired-security-transfer`.
- Delivery = BUY (Parqet `shares`, `price`, `amount`, `fee`, `tax`, absolute values; tax signed) plus a DEPOSIT dated the same business date of amount + fee + tax, ordered DEPOSIT then BUY, so the cash balance is unchanged; no DEPOSIT when that sum is 0.
- All bookings go through `ledger.recordBatch` in one DB transaction (AD-3); splits via `recordSplit`, already-recorded splits (same Security and date) are not re-booked, like recorded ISIN changes.
- Decisions: missing flag decision = skip; missing classification = estimated type; only a duplicate without decision is open (initial decisions still pre-set duplicates to skip).
- "Alle wie in Parqet übernehmen" confirms with every flag whose `correctionDraft` is bookable set to book, the rest skipped. Bookable (pure, client-safe check in `decisions.ts`): every raw row's currency is EUR, date is a business date, the type's figures parse and satisfy the ledger rules (BUY/SELL quantity > 0 with ≤ 8 decimals, price/amount/fee ≥ 0; DIVIDEND/DEPOSIT/WITHDRAWAL amount > 0; TAX tax ≠ 0), and BUY/SELL/DIVIDEND have a security key that is one of `preview.securities` (TAX: none or such a key).
- The summary lists every skipped flag (records, reason label) and counts booked/skipped splits.
- UI German; FUND label "Fonds" everywhere an asset type is chosen or shown.

**Never:**
- No edit of committed Prisma migrations; no real export data in fixtures (synthetic ISINs with valid check digits, `*.csv.txt`).
- No guessing from anything but the name; no network lookups.
- No change to duplicate matching (AD-15) or to the reconciliation comparison logic beyond adding splits.
- No Securities page / later type editing UI (Story 3.1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delivery group | 5 Security `TransferIn` rows at one instant, different ISINs, no out | 5 BUY + 5 DEPOSIT proposals; no flag; cash unchanged | — |
| Split pair | same ISIN: out 10, in 40 at one instant | split proposal `1:4` on that date | — |
| Split ratio unrepresentable | same ISIN out 3, in 3 (equal) or reduced terms > 6 digits | flag new reason `unsupported-split` | listed under "Nicht übernommen" |
| ISIN change | one out (A) + one in (B) | ISIN change as before | — |
| Out + 2 ins, different ISINs | one out A, ins B, C | two deliveries B, C; out A flagged `unpaired-security-transfer` | — |
| Delivery with amount 0 | `TransferIn` price 0, amount 0 | BUY with amount 0, no DEPOSIT | — |
| Re-run same file | ledger already holds the booking | BUY/DEPOSIT/splits reported as duplicates / recorded, skipped by default | — |
| "Alle wie in Parqet" with non-EUR or garbage-date flag | flag not bookable | skipped, listed in summary | — |
| "Alle wie in Parqet" draft SELL exceeding holding | ledger refuses | `booking-failed` naming the flag, nothing written | existing failure message |

</intent-contract>

## Code Map

- `prisma/schema.prisma:30` `enum AssetType` — add `FUND` after `ETF`. SQLite stores enums as TEXT: `prisma migrate diff` yields an empty script, so the new migration is a comment-only `migration.sql`. Latest migration `20261025200000_add_isin_change`.
- `src/modules/ledger/securities.ts:12` `ISIN_ASSET_TYPES` (validation at :104) — add `FUND`.
- `src/app/_components/transactions/labels.ts:23` `ASSET_TYPE_LABELS`, `:31` `NEW_SECURITY_ASSET_TYPES` — used by `TransactionDialog.tsx:310` and `corporate-actions/IsinChangeDialog.tsx:175`.
- `src/app/_components/migration/labels.ts:79` own `ASSET_TYPE_LABELS`, `:93` `CLASSIFICATION_OPTIONS`, `flagReasonLabel`, `openDecisionsLabel`, `confirmFailureMessage`.
- `src/core/corporate-actions.ts:46` `parseSplitRatio` (terms `[1-9]\d{0,5}`, must differ) — reuse to validate generated ratios; `Split` type for preview figures.
- `src/modules/migration/parqet-reader.ts` — `ParqetSecurity.proposedAssetType` (:54, set :556), `FLAG_REASONS` (:57), transfer parse only reads `shares` (`kind: "transfer"` branch ~:225; add price/amount/fee/tax non-required), grouping loop "Security transfers" (~:480), proposals built from `pending` (~:440, delivery parts must join before sorting), `exportDate` from proposals + ISIN changes (add splits), Security keys (add split keys).
- `src/modules/migration/decisions.ts` — `CLASSIFICATION_TYPES` (:15), `CORRECTION_ASSET_TYPES` (:26), `itemKey` (:73), `openDecisions` (:84), `initialDecisions`, `carryDecisions`, `correctionDraft` (:150).
- `src/modules/migration/preview.ts:155` `analyzeParqetExport` — Security annotation, `isinChanges.recorded` pattern via `listIsinChanges` (mirror with `listSplits` from `@/modules/ledger`), figures via `computePositions(rows, [], exportDate, { splits, isinChanges })` (pass file splits).
- `src/modules/migration/confirm.ts:124` `confirmParqetMigration` — `refFor` asset type (`decisions.classifications[key]` → fall back to proposed), planned groups/ordering, `skippedFlags` counter, `MigrationSummary`.
- `src/modules/ledger/batch.ts` — `BatchEntry` union and `apply` loop; `recordSplit` in `corporate-actions.ts:181` (`{ securityId, date, ratio: "old:new" }`, nested-safe `inTransaction`).
- `src/app/_components/migration/ParqetMigrationWizard.tsx` — `ParqetPreviewView` (static, rendered in tests via `test/helpers/render-text.ts`), `ConfirmBar`, `confirm()`; `ParqetDecisions.tsx` (classification select, `FlagItem`, duplicates); `ParqetSummaryView.tsx:92` skipped line.
- `src/app/_actions/migration.ts` — `confirmParqetAction` parses `decisionsSchema`; unchanged apart from tests.
- Fixtures: `test/fixtures/parqet/synthetic-export.csv.txt` (its record "Welt ETF" `TransferIn` 2024-07-03, price 0, shares 3, amount 300, is now a delivery — update 2.3/2.4 tests accordingly), `synthetic-export-no-cash.csv.txt`. Tests: `parqet-reader.test.ts`, `preview.test.ts`, `confirm.test.ts` (temp DB via `test/helpers/test-db.ts`), `decisions.test.ts`, `labels.test.ts`, `ParqetMigrationWizard.test.tsx`, `src/app/_actions/migration.test.ts`.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/20261025210000_add_fund_asset_type/migration.sql` -- add `FUND`; comment-only SQL explaining enums are TEXT in SQLite; run `npx prisma generate` -- AD-16 enum.
- `src/modules/ledger/securities.ts` (+ test) -- `FUND` in `ISIN_ASSET_TYPES` -- FUND Securities are ISIN-identified.
- `src/app/_components/transactions/labels.ts`, `src/app/_components/migration/labels.ts` (+ tests) -- `FUND: "Fonds"`; order STOCK, ETF, FUND, CERTIFICATE, CRYPTO in `NEW_SECURITY_ASSET_TYPES` and `CLASSIFICATION_OPTIONS`; label for `unsupported-split` ("Split-Verhältnis nicht darstellbar") and an updated `unpaired-security-transfer` text (unpaired outgoing transfer); skipped-flag summary text -- selectable everywhere.
- `src/core/asset-type.ts` (+ test) -- `classifySecurityName(name): "STOCK" | "ETF" | "FUND" | "CERTIFICATE"`; tests: "AB SICAV I Concentrated US Equity Portfolio", "BlackRock Global Funds European Special Situations Fund", "Fidelity Funds - USD Bond Fund" → FUND; "iShares Developed Markets Property Yield UCITS ETF", "Xtrackers Physical Gold ETC" → ETF; typical stocks ("Apple Inc.", "Siemens AG", "Fletcher Building") → STOCK; turbos ("Turbo Long Open End auf DAX", "Mini Future Short", "Knock-Out Call") → CERTIFICATE -- the pure core classifier.
- `src/modules/ledger/batch.ts` (+ test) -- entry `{ kind: "split", ref, securityRef, date, ratio }` via `recordSplit`; result adds `splits` by ref; failure union adds the split failures -- single atomic write path.
- `src/modules/migration/parqet-reader.ts` (+ test) -- classifier for `proposedAssetType`; transfer rows keep price/amount/fee/tax; grouping (a)–(d); `splits: SplitProposal[]` (`date, key, oldQuantity, newQuantity, ratioOld, ratioNew, records`); proposals gain optional `delivery: "buy" | "deposit"`; flag reason `unsupported-split` -- hands-off grouping.
- `src/modules/migration/decisions.ts` (+ test) -- `itemKey` appends `d` for `delivery === "deposit"` (unique keys); add FUND to `CLASSIFICATION_TYPES`/`CORRECTION_ASSET_TYPES`; classifications are overrides; `openDecisions` only reports duplicates without decision; `bookableCorrection(flag, draft, securityKeys)`; `parqetAsIsDecisions(preview, decisions)` (flags → book draft if bookable, else skip) -- no blocking decisions.
- `src/modules/migration/preview.ts` (+ test) -- `splits: PreviewSplit[]` (`recorded` via `listSplits`), `deliveries` (BUY delivery proposals), `PreviewSecurity.estimated` (new non-crypto); figures include file splits -- preview shows splits, deliveries, estimated types.
- `src/modules/migration/confirm.ts` (+ test) -- asset type = override ?? proposed; book splits (date group before ISIN changes), skip recorded ones; summary `booked.splits`, `skipped.splits`, `skippedFlags: { key, records, reason, detail? }[]` -- booking + summary.
- `src/modules/migration/index.ts` -- export new types/functions.
- `src/app/_components/migration/ParqetMigrationWizard.tsx`, `ParqetDecisions.tsx`, `ParqetSummaryView.tsx` (+ static render tests) -- preview sections "Splits" and "Einlieferungen"; each new Security shows its estimated type as an inline select (no "Bitte wählen"), existing ones a chip; flags in a collapsed MUI `Accordion` "Nicht übernommen (n)" holding the per-flag skip/correct controls and the "Alle wie in Parqet übernehmen" button (shown when flags exist; confirms with `parqetAsIsDecisions`); "Übernehmen" enabled when no duplicate decision is open; summary lists skipped flags and booked splits.
- `test/fixtures/parqet/synthetic-export-hands-off.csv.txt` + test in `src/modules/migration/confirm.test.ts` -- synthetic export with a cash deposit, buys/sell, a five-row `TransferIn` group at one instant (names: the three fund names, the iShares UCITS ETF and the Xtrackers ETC from the classifier test, synthetic ISINs), a same-ISIN out/in split pair and no flags; preview into an empty Depot → `openDecisions` empty, then confirm with `EMPTY_DECISIONS` → `listPositions`, invested capital and cash equal hand-computed constants in the test and the summary has no mismatch -- end-to-end acceptance.
- Update existing tests (`parqet-reader`, `preview`, `confirm`, `decisions`, wizard, actions) for the new behavior (Welt ETF `TransferIn` → delivery; flags no longer open).

**Acceptance Criteria:**
- Given the Transaction form, the ISIN-change dialog or the migration preview, when an asset type is chosen, then "Fonds" is offered and a FUND Security can be saved.
- Given the hands-off fixture previewed into an empty Depot, then there are zero open decisions, "Übernehmen" is enabled immediately, each fund/ETF/ETC shows its estimated type, and the split and five deliveries are listed.
- Given that preview confirmed, then the Depot's Positions, invested capital and cash balance equal the fixture's expected values and the Parqet comparison shows no "Abweichung".
- Given a preview with flags, when "Übernehmen" is clicked, then flags are skipped and listed in the summary; when "Alle wie in Parqet übernehmen" is clicked, then bookable flags are booked and the rest listed as skipped.
- Given a preview into a Depot with matching rows, then duplicates are still shown for decision.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 27 findings — high 0, medium 2, low 15, false 10, maybe-false 0
- findings:
  - `[false]` `[reject]` (blind) As-is books an unpaired TransferOut as a SELL at price 0, realizing the cost basis as a loss — Parqet's own export carries that row with `realizedgains` = −Cost Basis and removes the shares; booking it "wie in Parqet" reproduces Parqet's figures, which is the button's contract.
  - `[medium]` `[patch]` (blind) As-is books one leg of an `unsupported-split` flag (two transfer rows) as BUY or SELL — confirmed: `correctionDraft` picks the first non-cash row and the ISIN is a preview Security. Fixed: `bookableCorrection` returns false for flags with more than one non-cash row; test added.
  - `[false]` `[reject]` (blind) `parqetAsIsDecisions` drops manual flag corrections — the intent defines the button as booking every flag with a valid prefilled correction and skipping the rest; manual corrections are submitted with "Übernehmen".
  - `[low]` `[reject]` (blind) As-is button does not mark which flags it will book — flags are listed with reason and raw rows in the accordion and the summary lists every skipped one; markers would add UI state for a rarely used action.
  - `[low]` `[reject]` (blind) Delivery BUY keeps Parqet's price 0 while amount > 0 — intent mandates Parqet's shares, price and amount; Cost Basis, invested capital and cash use `amount`, so figures are correct.
  - `[low]` `[reject]` (blind) Delivery BUY and DEPOSIT can be decided separately as duplicates — only on a re-run into a non-empty Depot where the user explicitly books one half; coupling decisions adds branches for a rare case.
  - `[low]` `[reject]` (blind) Equal-quantity same-ISIN pair labeled "Split-Verhältnis nicht darstellbar" — matches the spec matrix; cosmetic wording; with the patch above it is never booked as-is.
  - `[low]` `[reject]` (blind) Classifier misses German compounds ("Rentenfonds"), Zertifikat/Bonus names, treats Invesco/Amundi active funds as ETF — rules implement the intent's list and order exactly; every estimate is overridable inline in the preview.
  - `[low]` `[patch]` (blind) Split `recorded` ignores the ratio — confirmed in `preview.ts`. Fixed: `recorded` requires equal ratio; a different ratio is booked and fails loudly as `split-exists`; test extended.
  - `[low]` `[reject]` (blind) Transfer rows now flagged when price/amount/fee/tax are garbage — Parqet writes numeric columns on every row (format doc); a guard would need deferred parsing for an unobserved case.
  - `[low]` `[reject]` (blind) Regenerated `epic-2-context.md` drops constraints (split edit/delete, refetch, logging) — all Epic 2 stories that read it are implemented; other epics compile their own context from the planning docs.
  - `[low]` `[patch]` (blind) New tests sum money with JS `number` — confirmed in confirm/reader tests. Fixed: sums via `ExactDecimal`, compared as canonical strings.
  - `[low]` `[patch]` (blind) Untested branches: negative-cost delivery WITHDRAWAL, crypto delivery, mixed split+delivery group, re-run deposit collision — WITHDRAWAL branch confirmed untested and fixed with a reader test (grouped with the verification-gap finding); the other three are low and covered by the generic grouping code paths, rejected.
  - `[low]` `[reject]` (blind) Summary sentence shows zero counts and wrong singular grammar — cosmetic, same pattern as the 2.4 summary.
  - `[medium]` `[patch]` (edge) unsupported-split flag booked one-sided under as-is — same root as the blind finding above; same fix.
  - `[false]` `[reject]` (edge) unpaired TransferOut SELL at price 0 as fake loss — see blind refutation (matches Parqet's realizedgains).
  - `[false]` `[reject]` (edge) as-is replaces manual corrections — see blind refutation (intent contract of the button).
  - `[low]` `[reject]` (edge) Delivery with empty amount books BUY with zero Cost Basis — Parqet transfer rows carry amount (format doc, ISIN-change TransferIn example); intent says Parqet's amount.
  - `[low]` `[reject]` (edge) Two split pairs for one Security on one date abort the batch with `split-exists` — not observed in any export; the failure is atomic and names the split; a guard adds branches for an implausible case.
  - `[low]` `[patch]` (edge) Recorded split with different ratio silently skipped — same root as the blind finding; same fix.
  - `[low]` `[patch]` (verification-gap) Wizard's as-is decision choice untested — fixed: pure `submittedDecisions(preview, decisions, asIs)` in `decisions.ts`, used by the wizard, both branches unit-tested.
  - `[low]` `[patch]` (verification-gap) Negative-cost delivery WITHDRAWAL untested — fixed: reader test (amount 0, fee 0, tax −2 → WITHDRAWAL "2" tagged deposit, cash total 0).
  - `[false]` `[reject]` (verification-gap, other) `parqetAsIsDecisions` replaces manual corrections — see blind refutation.
  - `[false]` `[reject]` (intent) Real-export success criteria not verified by 2.5 — the approved change proposal assigns the real-data check to Story 2.4's operator actions, run after 2.5; 2.5's ACs are all synthetic-fixture checkable.
  - `[false]` `[reject]` (intent) Click behavior only checked via static renders and pure functions — button enablement derives from `openDecisions` (tested) and the as-is path from `submittedDecisions` (now tested); the repo has no interaction-test tooling (deferred in 2.4).
  - `[false]` `[reject]` (intent) FUND in Transaction form and ISIN-change dialog not rendered in tests — both dialogs iterate `NEW_SECURITY_ASSET_TYPES` (tested to contain FUND) and the ledger accepts FUND (securities test).
  - `[false]` `[reject]` (intent) "type stays editable later" not implemented — the amended Story 3.1 owns changing a Security's type.

## Design Notes

Delivery DEPOSIT uses amount + fee + tax (not just amount) so the stated invariant "Cash Account unchanged" holds even if a transfer row carries costs; in the observed data fee/tax are 0 and it equals Parqet's amount. Non-EUR flags are never bookable as-is: their figures are in a foreign currency and the ledger is EUR-only. Restricting as-is bookings to Security keys already in the preview avoids an ISIN check-digit or asset-type failure aborting the whole batch; a SELL draft that exceeds the holding still aborts atomically and names the flag, so the user can switch that flag to skip.

Split ratio from quantities (≤ 8 decimals): scale both by 10^8 as `BigInt`, divide by gcd, validate with `parseSplitRatio`.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary.** The Parqet migration no longer asks row by row: `FUND` ("Fonds") is a new asset type; a pure core name classifier estimates each new Security's type (inline override in the preview); same-instant Security transfers pair into splits, then ISIN changes, and every remaining `TransferIn` is booked as a delivery (DEPOSIT of amount + fee + tax, then BUY at Parqet's cost); only unpaired `TransferOut` and other flags remain, collapsed under "Nicht übernommen (n)", skipped by default, with "Alle wie in Parqet übernehmen". Only undecided duplicates block "Übernehmen". Splits are booked atomically through `ledger.recordBatch`.

**Files changed.**
- `prisma/schema.prisma`, `prisma/migrations/20261025210000_add_fund_asset_type/migration.sql` — `FUND` enum value (comment-only migration; SQLite enums are TEXT).
- `src/core/asset-type.ts` (+ test) — `classifySecurityName`.
- `src/modules/ledger/securities.ts`, `batch.ts`, `index.ts` (+ tests) — FUND is ISIN-identified; batch `split` entries.
- `src/modules/migration/parqet-reader.ts` — transfer grouping, deliveries, splits, `unsupported-split`, estimated types.
- `src/modules/migration/decisions.ts` — non-blocking decisions, `bookableCorrection`, `parqetAsIsDecisions`, `submittedDecisions`, delivery deposit keys.
- `src/modules/migration/preview.ts`, `confirm.ts`, `index.ts` — splits/deliveries in preview, recorded-split check, split booking, `skippedFlags` summary.
- `src/app/_components/migration/*`, `transactions/labels.ts`, `corporate-actions/labels.ts` — Fonds labels, preview sections Splits/Einlieferungen, inline type select, collapsed flags + as-is button, summary list of skipped rows.
- `test/fixtures/parqet/synthetic-export-hands-off.csv.txt` + tests across reader, decisions, preview, confirm, batch, labels, wizard, actions.
- `_bmad-output/implementation-artifacts/epic-2-context.md` — recompiled (planning docs had changed).

**Review findings.** 27 findings: 5 patch entries applied (1 medium: as-is booking one leg of an unsupported split; 4 low/gap: recorded-split ratio, number-based money sums in tests, negative-cost delivery test, `submittedDecisions` helper + test), 0 deferred, 10 false and 12 low rejected — reasons recorded per row in the Review Triage Log.

**Follow-up review recommendation:** false — patched by verdict: high 0, medium 1, low 4 (first pass: no high, fewer than two medium).

**Verification.** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all pass (62 test files, 1015 tests) after the patches. Every I/O matrix row is covered by a passing test.

**Residual risks.** Real-export reconciliation is not verified here; it is owed as Story 2.4's operator action (run the migration on the real Parqet exports after 2.5). Classifier estimates for German compound fund names ("Rentenfonds") fall back to STOCK and need a manual override. The wizard's click wiring is covered only by pure-function and static-render tests (no interaction-test tooling).
