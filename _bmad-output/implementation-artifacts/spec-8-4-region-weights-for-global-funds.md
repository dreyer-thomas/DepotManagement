---
title: 'Story 8.4: Region Weights for Global Funds'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
deferred: []
baseline_revision: '9f16cb73633a3c2f8b1a739e6bbaddc201786486'
---

<intent-contract>

## Intent

**Problem:** A global ETF (MSCI World, ACWI, FTSE All-World …) is classified as a whole with region "Welt", so the allocation view's "Region" donut cannot show the US share inside it, and Story 8.5's regional targets have nothing to work with.

**Approach:** Give ETFs/funds a region split (USA, Europa, Japan, Pazifik ohne Japan, Schwellenländer, Sonstige; percentages summing to 100) from a dated, pure rules table, stored by the `classification` module as an automatic `RULE` value with a manual override that always wins. The Securities page edits the split; the allocation "Region" dimension distributes a fund's value by its effective split through a pure core function.

## Boundaries & Constraints

**Always:**
- Split regions, in this order: `USA`, `Europa`, `Japan`, `Pazifik ohne Japan`, `Schwellenländer`, `Sonstige`. Weights are canonical percent decimal strings (`"72"`, `"2.5"`), each > 0 and ≤ 100, at most 2 decimals, summing to exactly 100; zero regions are omitted.
- The rules table, the rule matcher, split validation and the value distribution are pure functions in `src/core` with hand-calculated unit tests; money/weights use `decimal.js`, never JS `number`.
- Effective split of a Security: only for `ETF`/`FUND`; manual split ?? (none if the region dimension has a manual value) ?? rule split ?? none. A refresh never touches the manual split.
- A fund without an effective split keeps its single region group exactly as today. Stocks and every other type are unchanged.
- Distributed slices of a holding sum exactly to its value; the scope total and cash are unchanged.
- Manual splits are user data: exported and restored (schema version 4 with a pure upgrade step from 3). The rule split is a cache: not exported, refilled by the next refresh.
- Analyses read the split only through `@/modules/classification` (AD-20). UI text German, touch targets ≥ 44 px, de-DE number formats.

**Never:**
- ETF look-through (X-Ray), live index-weight fetching, or splits for stocks, certificates or crypto.
- Changing other allocation dimensions, the composition card, `REGIONS` of the single-region dimension, or Story 8.5 target segments.
- Editing committed migrations; writing ledger rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| World ETF | ETF "iShares Core MSCI World UCITS ETF", no manual | rule split USA 72, Europa 15, Japan 6, Pazifik ohne Japan 4, Sonstige 3, index "MSCI World", dated | — |
| Rule order | "Vanguard FTSE All-World", "MSCI ACWI", "MSCI Emerging Markets", "STOXX Europe 600", "S&P 500", "MSCI Japan", "MSCI Pacific ex Japan" | All-World / ACWI rules (not World); EM → Schwellenländer 100; Europe → Europa 100; S&P 500 → USA 100; Japan → Japan 100; Pacific ex Japan → Pazifik ohne Japan 100 | — |
| Exclusion | "MSCI World ex USA", unmatched names, bond funds ("Global Aggregate Bond") | no split; single region as before | — |
| Manual wins | manual split USA 60, Europa 40 stored; refresh runs | effective split is the manual one, source manual; rule columns may update, manual unchanged | — |
| Manual region | fund with rule split and manual region "Europa" | no effective split; fund counted under "Europa" | — |
| Distribution | value 1000 €, split World rule | slices 720 / 150 / 60 / 40 / 30, weights 0.72 … ; sum 1000 | — |
| Invalid manual | sum 99,5; a negative, non-numeric, > 100 or 3-decimal value | `{ok:false, reason:"split-sum"}` / `"split-invalid"`; nothing written | German error in dialog |
| Clear manual | all six fields empty → "Automatisch" | manual split removed; rule split (or none) applies | — |
| Old export | schema-3 file | upgrades to 4, every classification gets `regionSplit: null` | — |

</intent-contract>

## Code Map

- `src/core/classification.ts` -- `REGIONS` (single-region labels, unchanged), `fundRules`, `EXCLUSION` regex (reuse), `ruleValues`, `effective`. `src/core/asset-type.ts` `termPattern(terms)` builds whole-word patterns (reuse for rule patterns).
- `src/core/allocation.ts` -- `AllocationHolding = CompositionHolding & {group}`, `AllocationPosition` (value, share), `allocation()`; positions keyed per segment. `src/core/composition.ts` `CompositionHolding` (`securityId, securityName, depotId, depotName, value`). `src/core/decimal.ts` `ExactDecimal` (precision 1000, exact products), `canonicalDecimal`. `src/core/decimal-input.ts` `parseDecimalInput` (de-DE input). `src/core/format.ts` `formatShare(ratio)`, `formatMoney`.
- `prisma/schema.prisma:350-382` -- `SecurityClassification` (per dimension value/source/manual columns, `ClassificationSource` enum). Latest migration `20261029000000_add_tax_settings`; see `20261028000000_add_security_classification/migration.sql` for header-comment style.
- `src/modules/classification/classification.ts` -- `automaticOf`/`manualOf`, `storeAutomatic` (writes only when `sameLayer` differs — the split must be part of that comparison), `refreshClassifications` (`refreshOne` per Security; `ruleValues` input), `listClassifications`, `setManualClassification` (validate-then-upsert pattern, typed reasons). `backup.ts` -- `exportClassifications` (rows with ≥ 1 manual value), `replaceAllClassifications`. `index.ts` -- the public surface.
- `src/modules/backup/schema.ts` -- `EXPORT_SCHEMA_VERSION` (3), `classificationRecordSchema` (:106). `upgrade.ts` `UPGRADES`. `consistency.ts:103-107` classification block. Tests that pin the version or classification record shape: `src/modules/backup/{upgrade,export,restore,consistency}.test.ts`, `src/app/api/export/route.test.ts`, `src/app/_actions/backup.test.ts`, `src/app/_components/backup/{ExportButton,RestoreButton}.dom.test.tsx`, `test/helpers/backup-seed.ts`.
- `src/app/(app)/analyses/page.tsx:52-73` `allocationPanel` (loads `listClassifications`, calls `allocationHoldings` then `allocation`). `src/app/_components/analyses/labels.ts:95-115` `groupOf`, `allocationHoldings`. `AllocationView.tsx` `PositionRow` (value + share column). Tests: `AllocationView.dom.test.tsx`, `labels.test.ts`, `src/app/(app)/analyses/page.test.tsx`.
- `src/app/_actions/classification.ts` -- session check, `revalidatePath`, `scheduleClassificationRefresh` (model for the new action). `src/app/_actions/tax.ts` + `src/app/_components/tax/TeilfreistellungDialog.tsx` -- fund-only button + `SecurityDialog`/`useDialog`/`TOUCH_TARGET` + `useActionState` form pattern. `ManualPriceDialog.tsx` decimal field (`inputMode: "decimal"`).
- `src/app/_components/securities/SecurityList.tsx:56-115` -- card: summary lines (`classificationSummary`, `teilfreistellungSummary` for `fund`) and button row. `src/app/(app)/securities/page.tsx` loads list data. `src/app/_components/securities/labels.ts` German labels/messages.

## Tasks & Acceptance

**Execution:**
- `src/core/region-split.ts` (+ `region-split.test.ts`) -- `SPLIT_REGIONS`, `type SplitRegion`, `type RegionWeights = {region, weight}[]` (SPLIT_REGIONS order); `REGION_SPLIT_RULES` (each: patterns, `index` label, `asOf` `"2026-09-30"`, weights) and `regionSplitRule(name) → {index, asOf, weights} | null` (specific before general: Pacific ex Japan; ACWI/"All Country World"; FTSE All-World/"All World"; FTSE Developed/"Developed World"; MSCI World/"Core World"; Emerging Markets/EM; STOXX Europe 600/MSCI Europe/"Europe"; S&P 500/MSCI USA; MSCI Japan/Nikkei/TOPIX; any other `ex …` exclusion → null; require an equity-index term so bond/gold funds stay unmatched); `parseRegionSplit(input: Partial<Record<SplitRegion, unknown>>) → {ok:true, weights | null (all empty)} | {ok:false, reason:"split-invalid"|"split-sum"}`; `serializeRegionSplit`/`deserializeRegionSplit` (JSON object in SPLIT_REGIONS order, invalid → null); `effectiveRegionSplit(...)` per the Always rule; `distributeByRegion(value, weights) → {region, value, weight}[]` (weight = fraction, last slice = remainder). Rule tables: World 72/15/6/4/–/3; ACWI 64/13/5/3/11/4; All-World 62/14/6/3/11/4; Developed 71/15/7/4/–/3; single-region rules 100. Every matrix row is a test; assert each rule sums to 100.
- `prisma/schema.prisma` + `prisma/migrations/20261030000000_add_region_split/migration.sql` -- add to `SecurityClassification`: `regionSplit String?` (rule JSON), `regionSplitSource ClassificationSource?`, `regionSplitAsOf String?`, `regionSplitIndex String?`, `regionSplitManual String?` (comment: owned by classification, story 8.4). Run `npx prisma generate`.
- `src/modules/classification/{classification.ts, backup.ts, index.ts}` (+ tests) -- refresh writes the rule split (ETF/FUND only, else null) in the automatic write and counts a split change as a change; `listRegionSplits(db) → Record<securityId, {effective: {weights, source:"manual"|"rule", index, asOf} | null, manual: RegionWeights | null, rule: {weights, index, asOf} | null}>`; `setManualRegionSplit(securityId, input)` (validate first; `not-found`, `not-a-fund`, `split-invalid`, `split-sum`; all empty clears); export/restore carry `regionSplit` (manual weights or null) per classification record and export rows that have only a manual split.
- `src/modules/backup/{schema,upgrade}.ts` + every test in the Code Map -- `EXPORT_SCHEMA_VERSION = 4`; `classificationRecordSchema.regionSplit` = nullable object of SPLIT_REGIONS → decimal string, refined by `parseRegionSplit`-equivalent sum check; upgrade step `3` maps every classification to `{...c, regionSplit: null}`; add a 3→4 upgrade test and a manual-split export/restore round-trip test.
- `src/app/_actions/classification.ts` (+ test) -- `setRegionSplitAction` reads `securityId` and `split-<index>` fields (index into SPLIT_REGIONS), checks the session, revalidates `/securities` and `/analyses`.
- `src/app/_components/securities/{RegionSplitDialog.tsx, labels.ts, SecurityList.tsx}`, `src/app/(app)/securities/page.tsx` (+ dom/page tests) -- fund cards show a line "Regionen: USA 72 % · Europa 15 % · … (Regel MSCI World, Stand 30.09.2026)" / "(manuell)", or nothing without a split; button "Regionen" opens a dialog with six `%` fields (prefilled with the effective split), a live sum "Summe: 100 %", "Speichern", "Automatisch" (submits empty fields) and German errors (`split-sum`: "Die Anteile müssen zusammen 100 % ergeben.").
- `src/core/allocation.ts`, `src/app/_components/analyses/{labels.ts, AllocationView.tsx}`, `src/app/(app)/analyses/page.tsx` (+ tests) -- `AllocationHolding`/`AllocationPosition` get optional `weight` (fraction of the holding); `allocationHoldings(holdings, classifications, dimension, splits)` expands a holding with an effective split into one holding per region via `distributeByRegion` for the `region` dimension only; `PositionRow` shows "72 % des Fonds" under the name when `weight` is set; the panel loads `listRegionSplits`.

**Acceptance Criteria:**
- Given an MSCI World ETF worth 1.000 € and a US stock worth 500 €, when Tommy opens Analysen › Aufteilung by Region, then "USA" is 1.220 € and the donut also shows Europa, Japan, Pazifik ohne Japan and Sonstige; tapping "USA" lists the stock and the ETF (720 €, "72 % des Fonds").
- Given the Securities page, when he saves a manual split USA 60 / Europa 40 for that ETF, then the card shows it as manual, a classification refresh keeps it, and the Region allocation uses it; "Automatisch" restores the rule split.
- Given an export with a manual split, when restored, then the split is back; a schema-3 file restores with no manual splits.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 27 findings — high 0, medium 2, low 17, false 8, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: "FTSE Developed Europe" got the world split (USA 71) — fixed: single-region rules now precede the global ones; test added.
  - `[low]` `[patch]` Blind: "MSCI Emerging Europe" became Europa 100 — fixed with the same reorder plus the term "Emerging" in the EM rule; test added.
  - `[low]` `[patch]` Blind: aliases share one index label ("Regel S&P 500" for MSCI USA, etc.) — fixed: one rule entry per index with a truthful label ("MSCI USA", "MSCI Europe", "Europa-Index", "Nikkei 225", "TOPIX"); labels tested.
  - `[low]` `[patch]` Blind: missing index names — fixed "AC World" (ACWI) with a test; Nasdaq-100 / "Europe ex UK" / "EM ex China" already keep the same single-region label (USA / Europa / Schwellenländer), so the allocation result is identical; rejected for those.
  - `[low]` `[reject]` Blind: factor/size/sector World variants get the cap-weighted split — the table is approximate by design (shown with index and date) and the split is editable per Security.
  - `[low]` `[reject]` Blind: rule ignores a manual asset class — AD-20 classifies funds by one name rule; a wrong split is corrected by a manual split; no observed case.
  - `[low]` `[reject]` Blind: a manual single region silently disables the split without a hint — the rule already yields "Welt", so a manual "Welt" is unlikely; behaviour is the specified precedence and the donut is unchanged from before; a hint needs new props/branches.
  - `[low]` `[patch]` Blind: dialog help text claims "Automatisch" always uses an index rule — fixed: "falls es eine gibt; sonst behält der Fonds seine einzelne Region."
  - `[low]` `[reject]` Blind: saving an unchanged prefilled rule split stores it as manual — visible as "(manuell)" and undone by "Automatisch"; a no-op detection branch is more than a direct fix; table updates are rare.
  - `[low]` `[reject]` Blind: live sum gives no visual warning when ≠ 100 — the server returns the German sum error immediately; cosmetic.
  - `[low]` `[reject]` Blind: manual splits on non-funds are kept/restored without a fund check — `effectiveRegionSplit` ignores them for non-funds, so there is no visible effect (same as the 8.3 Teilfreistellung precedent).
  - `[low]` `[reject]` Blind: "Automatisch" without a row creates an empty classification row — harmless; the refresh creates a row for every Security anyway.
  - `[false]` `[reject]` Blind: summary can print "Regel null" — `ruleSplitOf` returns a rule split only when `regionSplitIndex` is non-null, so a rule-sourced effective split always has an index.
  - `[low]` `[reject]` Blind: region slices are not rounded to cents — segment sums stay exact; at most a cent of display difference between rows; rounding would make segment totals inexact.
  - `[low]` `[reject]` Blind: `//` vs `///` schema comment and Pacific ex Japan listed twice — comment style only; the duplicate entry is consistent and harmless.
  - `[medium]` `[patch]` Edge: Developed + region name gets the world split — same root cause as the first Blind row; fixed by the reorder.
  - `[low]` `[patch]` Edge: EM with a narrower region (EM Europe) — same root cause as the Emerging Europe row; EM now precedes Europe.
  - `[low]` `[reject]` Edge: unchanged save freezes the rule split as manual — duplicate of the Blind row; same reason.
  - `[low]` `[reject]` Edge: concurrent first-row upsert by `setManualRegionSplit` and a refresh (P2002) — same pattern as the existing `setManualClassification`; a single user rarely triggers both in the same instant, and the action reports a failure that a retry fixes.
  - `[false]` `[reject]` Edge: malformed `regionSplitAsOf` makes `formatDate` throw — the column is written only by the refresh from the constant `REGION_SPLIT_AS_OF`; restore never writes automatic columns.
  - `[false]` `[reject]` Edge: invalid manual JSON silently dropped from the export — the column is written only by `setManualRegionSplit` and restore, both validated; unreachable.
  - `[false]` `[reject]` Intent: matching uses the name only, not "name or index" — Securities have no separate index field; AD-20 and story 7.1 rules match on the name.
  - `[false]` `[reject]` Intent: manual single region beats the rule split is an extra rule — it follows from AD-20 "manual always wins" and is recorded in Design Notes.
  - `[false]` `[reject]` Intent: a US stock lands in "Nordamerika", not "USA" — `COUNTRIES["United States"]` maps to region "USA" (`src/core/classification.ts`), so it merges with the funds' USA share.
  - `[low]` `[reject]` Intent: no end-to-end test of refresh → listRegionSplits → page → donut — layered tests are the project's established pattern and each join is tested (module refresh test, page test, view test).
  - `[false]` `[reject]` Intent: the fund check uses the stored assetType rather than the classified type — the type dimension *is* the ledger `assetType` (not stored or overridable in classification).
  - `[false]` `[reject]` Intent: spec still in-progress and uncommitted — finalization and commit happen in this step.

## Design Notes

- **Mixed labels are intended.** Funds with a split land in split-region groups (`Japan`, `Pazifik ohne Japan`, `Sonstige` are new), stocks keep their single region (`Asien-Pazifik`, `Nordamerika`). Story 8.5 maps both onto its segments; 8.4 does not relabel stocks.
- **A manual single region beats a rule split**: it is the user's explicit correction, and manual always wins (AD-20). A manual split beats both.
- Weights are approximate index weights as of the table date (shown to the user); the table is code, updated by a later commit, never fetched.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** ETFs/funds get a region split (USA, Europa, Japan, Pazifik ohne Japan, Schwellenländer, Sonstige) from a dated pure rules table (as of 2026-09-30), stored by the classification module as a `RULE` cache with a manual override that always wins; editable on the Securities page; the allocation "Region" dimension distributes a fund's value by its split, and the drill-down shows "x % des Fonds". Manual splits are in export/restore (schema version 4, upgrade 3→4).

**Files changed:**
- `src/core/region-split.ts` (+ test) -- rules table, matcher, validation, (de)serialisation, effective split, distribution.
- `src/core/classification.ts` -- exports `EXCLUSION` for reuse.
- `src/core/allocation.ts` (+ test) -- optional `weight` on holdings/positions.
- `prisma/schema.prisma`, `prisma/migrations/20261030000000_add_region_split/` -- five nullable split columns.
- `src/modules/classification/{classification,backup,index}.ts` (+ test) -- refresh writes the rule split, `listRegionSplits`, `setManualRegionSplit`, export/restore of manual splits.
- `src/modules/backup/{schema,upgrade}.ts` (+ tests), `test/helpers/backup-seed.ts` -- schema version 4, upgrade step 3.
- `src/app/_actions/classification.ts` (+ test) -- `setRegionSplitAction`.
- `src/app/_components/securities/{RegionSplitDialog.tsx, SecurityList.tsx, labels.ts}`, `src/app/(app)/securities/page.tsx` (+ tests) -- "Regionen" button, dialog, card summary line.
- `src/app/_components/analyses/{labels.ts, AllocationView.tsx}`, `src/app/(app)/analyses/page.tsx` (+ tests) -- split distribution in the Region dimension, "x % des Fonds".

**Review:** 27 findings; patched 1 medium (+1 duplicate) and 5 low entries (rule order, Emerging term, truthful index labels, "AC World", dialog help text); deferred none; rejected 11 low and 9 false with reasons in the triage log.

**Follow-up review recommendation:** false (patched: high 0, medium 1, low 5).

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all pass (223 files, 3025 tests) against a throwaway DATABASE_URL.

**Residual risks:** existing funds get their rule split only on the next classification refresh (no backfill in the migration); rule weights are approximate and need manual table updates; not exercised in a running browser (component and page tests only).
