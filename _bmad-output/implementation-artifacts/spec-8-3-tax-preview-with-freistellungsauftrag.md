---
title: 'Story 8.3: Tax Preview with Freistellungsauftrag'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
warnings: ['oversized']
deferred: []
baseline_revision: '63994022a2a3ee26b03404f6af4594bd42c57a9a'
---

<intent-contract>

## Intent

**Problem:** Tommy cannot see his German capital-gains tax position per broker and year, so he cannot tell whether his Freistellungsaufträge are used well or whether a broker withheld too much or too little.

**Approach:** A new `tax` module stores Freistellungsauftrag amounts (per broker and year) and Teilfreistellung overrides (per Security). Both are edited in Settings › "Steuern" and on the Securities page, and both are included in export/restore (schemaVersion 3). One pure core function `taxPreview` (AD-21) computes income by pot, loss offsetting, allowance usage, estimated tax and the withheld comparison per broker and year. A new tab Analysen › "Steuern" shows the result.

## Boundaries & Constraints

**Always:**
- The tax unit is the broker (`Depot.broker`). All Depots of one broker share one allowance and one set of loss pots. Archived Depots count too, because taxes follow the sale date, not AD-17.
- Gains are FIFO realized results per Depot (`fifo`, AD-10), assigned to the year of the sale date. Fees are inside the gain, tax is excluded. Rows dated after `today` are ignored. Sales are classified by the Security FIFO reports (after an ISIN change, the new Security).
- Tax category per Security (pure, in core):
  - `STOCK` → Aktien (stock pot).
  - `ETF`/`FUND` → fund. Teilfreistellung is the override if one is set; otherwise `0.3` when the effective asset class (manual wins, read via `@/modules/classification`, AD-20) is `"Aktien"`, else `0`.
  - Everything else (`CERTIFICATE`, `CRYPTO`, `UNCLASSIFIED`, unknown) → other.
- Taxable income per broker and year:
  - **Dividends** = Σ gross DIVIDEND `amount`. For a fund, use `amount × (1 − Teilfreistellung)`.
  - **Fund result** = Σ fund sale gain `× (1 − Teilfreistellung)`, signed.
  - **Other** = Σ other sale gains, signed.
  - **General pot** `G = dividends + fund + other`.
  - **Stock net** `S = stockGains − stockLosses`. Stock losses offset only stock gains.
  - If `S ≥ 0`: `offsetAgainstStock = min(max(−G,0), S)` and `taxable = max(G,0) + S − offsetAgainstStock`. The unused other loss is `max(−G,0) − offsetAgainstStock` and the unused stock loss is 0.
  - If `S < 0`: the unused stock loss is `−S`, `taxable = max(G,0)` and the unused other loss is `max(−G,0)`.
- Allowance:
  - `allowanceUsed = min(allowance, taxable)`, `allowanceLeft = allowance − allowanceUsed` and `base = taxable − allowanceUsed`.
  - `KapESt = round2(base × 0.25)`, `Soli = round2(KapESt × 0.055)`, `estimated = KapESt + Soli` (half-up rounding to cents, `ExactDecimal`).
- Withheld tax = Σ signed `tax` over every row of the broker's Depots dated in the year: BUY/SELL/DIVIDEND/FEE/TAX, with refunds negative.
  - `difference = withheld − estimated`.
  - `> 0` → "voraussichtliche Erstattung", `< 0` → "voraussichtliche Nachbelastung", `0` → "keine Abweichung". The amount is shown unsigned with that label.
- The Portfolio total row is the field-wise sum of the broker results of the year. It is not recomputed.
- All money is decimal strings via `decimal.js`. `src/core/tax.ts` imports only core files.
- UI text is German with de-DE formats and du-form. Touch targets are ≥ 44 px. Gains and losses are never shown by colour alone. Everything is labelled as an estimate.
- The scope hint on the view reads: "Schätzung – maßgeblich ist die Steuerbescheinigung deiner Bank. Nicht berücksichtigt: Kirchensteuer, Verlustvorträge aus Vorjahren, Vorabpauschale, Anrechnung ausländischer Quellensteuer."
- When the year's allowances sum to more than 1.000 €, show this hint in Settings (live from the entered values) and in the view: "Die Summe deiner Freistellungsaufträge übersteigt 1.000 € – der gesetzliche Höchstbetrag beträgt 1.000 € für Alleinstehende und 2.000 € für Verheiratete."

**Never:**
- No ledger writes, nothing booked, no stored tax results.
- No church tax, loss carry-forward, Vorabpauschale or foreign-tax credit.
- No edits to committed migrations.
- No Prisma access outside the owning module. The tax module reads ledger data only via `@/modules/ledger` and classifications only via `@/modules/classification`.
- Do not change the existing tabs, the Gewinne figures or the classification rules.

## I/O & Edge-Case Matrix

The core references all use one broker and year 2026, with allowance 0 unless a row says otherwise.

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Full example | Allowance 1000. Stock sales +3000 and −500. Equity-ETF sale +1000. Stock dividend 200 and equity-ETF distribution 100. Certificate sale −400. Withheld 600. | Dividends 270, stock 3000/500, fund 700, other −400, taxable 3070, used 1000, left 0, base 2070, KapESt 517,50, Soli 28,46, estimated 545,96, Erstattung 54,04 |
| Stock loss pot | Stock −1000, dividend 300 | Taxable 300, unused stock loss 1000, KapESt 75,00, Soli 4,13 (4,125 half-up), estimated 79,13 |
| Other loss offsets stocks | Stock +1000, certificate −1500 | Taxable 0, offset against stock 1000, unused other loss 500, estimated 0 |
| Allowance exceeds income | Taxable 300, allowance 801 | Used 300, left 501, estimated 0 |
| Non-equity fund and override | Anleihen-ETF +1000 (no override). Same with override 0.15. | Fund 1000. With the override, fund 850. |
| Shared pots | Depot A +1000 stock and Depot B −1000 stock, same broker. Then the same rows at different brokers. | Same broker: taxable 0. Different brokers: one has taxable 1000, the other an unused stock loss of 1000. |
| Withheld | SELL tax 50, DIVIDEND tax 30, TAX row 20, TAX row −10 | Withheld 90 |
| Year boundary and future | Sale on 2025-12-31; row after today | The sale counts in 2025; the future row is ignored |
| Settings invalid | Amount "-5", "abc" or "1,234" | Not saved; field error "Bitte einen Betrag ab 0 mit höchstens zwei Nachkommastellen eingeben." |
| Settings empty | Amount "" or "0" | The stored row is removed (counts as 0) |
| Old export | schemaVersion 2 file | Upgraded with empty `taxAllowances` and `teilfreistellungOverrides`, then restored |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- `Broker` enum (:13), `Depot.broker`, `Security` relations. Add the models here.
- `prisma/migrations/20261028100000_add_news_teaser`, `20261028000000_add_security_classification/migration.sql` -- naming and CREATE TABLE style (header comment naming the story and owning module; TEXT for enums and decimals). The new migration is `20261029000000_add_tax_settings`.
- `src/core/fifo.ts:85` `fifo(rows, asOf, actions)` → `{securityId, sales:[{date,sequence,gain,…}]}`. `src/core/gains-analysis.ts` -- `GainsRow = FifoRow & {tax}`. `gainsAnalysis` is the model loop: FIFO per Depot, rows `≤ today`, taxes summed over all rows. `src/core/decimal.ts` -- `ExactDecimal` (half-up), `canonicalDecimal`.
- `src/core/classification.ts` -- `Classification` (`type`, `assetClass.value`), `ASSET_CLASSES` (`"Aktien"`). `src/modules/classification/index.ts` -- `listClassifications(db)` → `Record<securityId, Classification>`. A missing id means `effective(null, assetType)`.
- `src/modules/ledger/gains.ts` -- `gainsInput` (non-archived only). Add a sibling that covers all Depots. `valuation.ts:60` `loadRows`. `depots.ts:16` `BROKERS`, `:222` `listDepots` (has `broker` and `archived`). `corporate-actions.ts` `loadCorporateActions`. `securities.ts` `listSecurities`.
- `src/modules/classification/backup.ts`, `index.ts` -- the model for a module backup reader/writer and its index header.
- `src/modules/backup/schema.ts:9` `EXPORT_SCHEMA_VERSION = 2`; `exportFileSchema` (:120-131); `classificationRecordSchema` (:105). `upgrade.ts:9-12` `UPGRADES`. `export.ts:30` `createExport`. `restore.ts:121-129` is the restore transaction (insert after `replaceAllLedger`) and `:144` the log line. `consistency.ts:103-107` is the classification block (`idsOf`/`resolves`/`unique`). `index.ts:1-3` header.
- Backup tests:
  - `upgrade.test.ts:7-8,16,38` (version numbers).
  - `export.test.ts:34-45,162-173,273-274`.
  - `restore.test.ts:73,134-194,249`.
  - `consistency.test.ts:8,61-73,89,118`.
  - `test/helpers/backup-seed.ts`.
  - `src/app/api/export/route.test.ts`, `src/app/_actions/backup.test.ts`.
- `src/app/_actions/classification.ts` and `src/app/_components/securities/ClassificationDialog.tsx`, `SecurityDialog.tsx` (`SecurityDialog`, `useDialog`, `TOUCH_TARGET`) -- the server action, `useActionState` and dialog pattern. `SecurityList.tsx:98` is the per-card button row. `src/app/(app)/securities/page.tsx` loads the list data.
- `src/modules/prices/prices.ts:449-467` -- validation (`parseDecimalInput`, `src/core/decimal-input.ts:18`) and upsert pattern. `ManualPriceDialog.tsx:99-108` -- decimal field (`inputMode: "decimal"`).
- `src/app/(app)/settings/page.tsx` -- sections with `aria-labelledby`. The "Datensicherung" text (:59-60) lists the exported data. `page.test.tsx` uses `useMigratedDatabaseForSingleton`.
- `src/app/_components/depots/labels.ts:4-17` -- `BROKER_LABELS`.
- `src/app/(app)/analyses/page.tsx` -- tab ternary (:156-164), panel functions (`gainsPanel` :88), doc comment (:123). `src/app/_components/analyses/labels.ts:14-19` `ANALYSIS_TABS`. `AnalysisFilters.tsx` -- "Bereich" select (hide it on `taxes`). `GainsView.tsx:174-195` -- year select as client state. `src/app/(app)/analyses/page.test.tsx` -- module mocks with `vi.hoisted`, `findElement(...).props`.
- `src/core/format.ts` -- `formatMoney`, `formatShare`.

## Tasks & Acceptance

**Execution:**
- `src/core/tax.ts` (+ `tax.test.ts`):
  - `TAX_RATES` (`0.25`, `0.055`) and `TEILFREISTELLUNG_RATES = ["0","0.15","0.3","0.6","0.8"]`.
  - `taxSecurity({type, assetClass}, override)` → `{category: "stock"|"fund"|"other", teilfreistellung}`.
  - `taxPreview({depots: {broker, rows: GainsRow[]}[], actions, securities: Record<id, TaxSecurity>, allowances: {broker, year, amount}[], brokers, today})` → `TaxYear[]`, newest first, from the first ledger year to today's year, or just today's year when there are no rows. Each `TaxYear` is `{year, brokers: TaxBrokerResult[], total, allowanceSum}`.
  - `TaxBrokerResult` holds `dividends`, `stockGains`, `stockLosses`, `fund`, `other`, `offsetAgainstStock`, `unusedStockLoss`, `unusedOtherLoss`, `taxable`, `allowance`, `allowanceUsed`, `allowanceLeft`, `base`, `capitalGainsTax`, `solidaritySurcharge`, `estimated`, `withheld` and `difference` (decimal strings).
  - Every core row of the I/O matrix is a hand-calculated unit test.
- `prisma/schema.prisma` and `prisma/migrations/20261029000000_add_tax_settings/migration.sql`:
  - `TaxAllowance {id, broker Broker, year Int, amount String, updatedAt String, @@unique([broker, year])}`.
  - `TeilfreistellungOverride {id, securityId @unique → Security onDelete Cascade, rate String, updatedAt String}`, plus the back-relation on `Security`. Comment that the tax module owns both.
  - Run `npx prisma generate`.
- `src/modules/ledger/gains.ts` and `index.ts` -- `taxLedgerInput(db)` → `{depots: {depotId, broker, rows: GainsRow[]}[], actions}` over every Depot, archived included. Test it in `gains.test.ts` if that file exists, otherwise in the ledger tests.
- `src/modules/tax/{settings.ts, preview.ts, backup.ts, index.ts}` (+ tests on a test DB):
  - `listTaxAllowances` and `setTaxAllowances(year: unknown, amounts: Partial<Record<Broker, unknown>>)`. Validate all fields first; the year must be an integer from 2000 to 2100 and the amount `parseDecimalInput`, ≥ 0, ≤ 2 decimals. Then upsert, and delete the row on `""` or 0. Results are `{ok:true}` or `{ok:false, reason, broker?}`.
  - `listTeilfreistellungOverrides` → `Record<securityId, rate>`.
  - `setTeilfreistellungOverride(securityId, rate)`. `""` removes the override. A rate outside `TEILFREISTELLUNG_RATES` gives `rate-invalid`. An unknown Security gives `security-not-found`, checked via `@/modules/ledger`.
  - `taxPreviewInput(db)` gathers the ledger input, `listClassifications`, overrides, allowances and the brokers that have at least one Depot (enum order).
  - `exportTaxSettings`/`replaceAllTaxSettings` follow the model of `classification/backup.ts`.
- `src/modules/backup/{schema,upgrade,export,restore,consistency,index}.ts` (+ every test listed in the Code Map, and `test/helpers/backup-seed.ts`):
  - Set `EXPORT_SCHEMA_VERSION = 3` and append `taxAllowances: [{id, broker, year, amount}]` and `teilfreistellungOverrides: [{id, securityId, rate}]` after `classifications`.
  - Add upgrade step `2` (adds both arrays empty).
  - Consistency: ids, unique `(broker, year)`, `securityId` resolves and is unique, and the rate is in the list.
  - Restore writes after the ledger, and the log line counts both.
  - Add a 2→3 upgrade test and update the version numbers in the existing tests.
- `src/app/_actions/tax.ts` (+ test):
  - `setTaxAllowancesAction` reads fields `year` and `amount-<BROKER>`, and `setTeilfreistellungAction` reads `securityId` and `rate`.
  - Both check the session and call `revalidatePath` for `/settings`, `/analyses` and `/securities` as relevant.
- `src/app/_components/tax/{labels.ts, AllowanceForm.tsx, TeilfreistellungDialog.tsx, TaxView.tsx}` (+ `.dom.test.tsx`):
  - `AllowanceForm`: a year select, from today's year + 1 down to the first ledger year. Each year change remounts the inputs with that year's stored amounts. It has one EUR field per broker (`BROKER_LABELS`), the live > 1.000 € hint, "Speichern", a success line "Gespeichert." and field errors.
  - `TeilfreistellungButton`/dialog: a select with "Automatisch (30 %|0 %)" and 0/15/30/60/80 %. It is shown only for `ETF`/`FUND`, and the card summary line reads "Teilfreistellung 30 % (manuell)".
  - `TaxView`:
    - A year select (client state, default today's year).
    - A summary table with one row per broker plus "Portfolio gesamt", and the columns Broker, Geschätzte Steuer, Einbehalten and Differenz (label + amount).
    - One card per broker with the rows: Dividenden und Zinsen; Aktien Gewinne / Verluste; Fonds/ETFs nach Teilfreistellung; Sonstige Erträge; Verlustverrechnung (mit Aktiengewinnen verrechnet, nicht verrechenbare Aktienverluste, nicht verrechenbare sonstige Verluste); Steuerpflichtige Erträge; Freistellungsauftrag genutzt / verbleibend; Kapitalertragsteuer 25 %; Solidaritätszuschlag 5,5 %; Geschätzte Steuer; Einbehaltene Steuer (laut Buchungen); voraussichtliche Erstattung/Nachbelastung.
    - The allowance hint and the scope hint. Signed amounts are shown with their sign.
- `src/app/(app)/settings/page.tsx` (+ test) -- a section "Steuern" (`settings-tax`) between Parqet and Datensicherung, with "Noch kein Depot." when there are no Depots. Extend the Datensicherung text with "Freistellungsaufträge".
- `src/app/(app)/securities/page.tsx`, `SecurityList.tsx` (+ tests) -- pass the overrides and render `TeilfreistellungButton` for funds.
- `src/app/_components/analyses/labels.ts`, `AnalysisFilters.tsx`, `src/app/(app)/analyses/page.tsx` (+ tests):
  - Add the tab `{value:"taxes", label:"Steuern"}` after Dividenden.
  - Hide "Bereich" on that tab.
  - Add `taxesPanel` = `<TaxView years={taxPreview(input)} today/>`, with `taxSecurity` built per Security from the classification and override.

**Acceptance Criteria:**
- Given Settings › Steuern, when Tommy enters 801 € for comdirect and 300 € for Deutsche Bank for 2026 and saves, then both amounts are stored and shown again after a reload. The > 1.000 € hint appears and also shows in Analysen › Steuern for 2026.
- Given Analysen › Steuern, when he chooses a year, then he sees per broker and as a Portfolio total row:
  - the income by pot and the loss offsetting;
  - the allowance used and left;
  - the estimated tax next to the tax withheld per the ledger, with "voraussichtliche Erstattung" or "voraussichtliche Nachbelastung";
  - the scope hint.
- Given an equity ETF, when he sets its Teilfreistellung to 0 % on the Securities page, then the view applies 0 % to its gains and distributions.
- Given an export, when it is restored, then the Freistellungsaufträge and Teilfreistellung overrides are restored and the previous ones are replaced. A version-2 file restores with none.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 22 findings — high 0, medium 0, low 16, false 6, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: `setTaxAllowances` writes brokers one by one without a transaction — real only on a DB error mid-loop (rare, SQLite local); wrapping adds a transaction path for a near-impossible case.
  - `[false]` `[reject]` Blind: withheld tax ignores `tax` on ADJUSTMENT/DEPOSIT/WITHDRAWAL rows, so it diverges from Gewinne — the ledger service rejects any non-zero tax on those types (`ledger/transactions.ts:272-298`), so their tax is always 0 and both sums agree.
  - `[low]` `[reject]` Blind: Soli rounded half-up although § 4 SolZG drops cent fractions — at most 1 cent on a labelled estimate; the fix edits this build's spec (I/O matrix row).
  - `[false]` `[reject]` Blind: couples see a permanent > 1.000 € hint — the hint is the specified behaviour and itself names the 2.000 € limit for couples; it is informational, not an error.
  - `[low]` `[reject]` Blind: the allowance form offers every broker while the view lists only brokers with a Depot — only matters if Tommy enters an amount for a broker he has no Depot at; the hint still names the sum correctly.
  - `[low]` `[reject]` Blind: export schema inlines the broker enum/year bounds and accepts amount "0" — inline enum matches the existing Depot schema; a restored "0" row is equivalent to no allowance.
  - `[low]` `[reject]` Blind: an override can be stored for a non-fund via a crafted request or restore — the UI offers it only for ETF/FUND and `taxSecurity` ignores it for other types; no visible effect.
  - `[low]` `[reject]` Blind: allowances stored for years before the first ledger year are unreachable in Settings — only after restoring foreign data or deleting all early rows; they do not affect any shown year.
  - `[low]` `[reject]` Blind: changing the year drops unsaved input and "Gespeichert." stays after further edits — cosmetic; the year switch is deliberate and the line refers to the last save.
  - `[low]` `[patch]` Blind: Datensicherung text omits the Teilfreistellung overrides — fixed: text now names "Freistellungsaufträge und Teilfreistellungen" (test updated).
  - `[false]` `[reject]` Blind: "Dividenden und Zinsen" without an interest type — the ledger has no interest type (pre-existing); the design notes record that the row covers DIVIDEND rows.
  - `[low]` `[patch]` Blind: broker card heading line "Verlustverrechnung" renders an empty `role="cell"` — fixed: lines without a value render no cell.
  - `[low]` `[reject]` Blind: untested partial-broker save, "Automatisch" choice, empty years list, fund distribution with tax — simple branches covered by the shared code paths (`""` removal is tested in the module, `taxPreview` never returns an empty list).
  - `[false]` `[reject]` Blind: `taxPreview` drops income of brokers not in `brokers` — `taxPreviewInput` derives `brokers` from the same Depots, so every Depot's broker is listed.
  - `[low]` `[reject]` Edge: a first ledger year before 2000 offers unsaveable years — no ledger of this single user predates 2000; adding a clamp is a guard for an unseen state.
  - `[low]` `[reject]` Edge: non-atomic allowance writes — duplicate of the Blind finding; same reason.
  - `[low]` `[reject]` Edge: restore accepts amount "0" or > 2 decimals — duplicate of the export-schema finding; only from hand-edited files.
  - `[low]` `[reject]` Edge: an amount with > 2 decimals (restore only) shows rounded in the form — only from a hand-edited export file.
  - `[false]` `[reject]` Edge: a non-fund override applies silently if the type later becomes ETF/FUND — then the override is applicable by design and visible on the card ("Teilfreistellung x % (manuell)"), and removable.
  - `[low]` `[patch]` Verification gap: Settings `firstYear`/`todayYear` wiring into `AllowanceForm` untested — fixed: new page test books a 2024 BUY and asserts `firstYear: 2024` and today's year.
  - `[low]` `[reject]` Verification gap (other): export schema accepts amount "0" — duplicate of the export-schema finding.
  - `[false]` `[reject]` Intent alignment: user flows are only covered layer by layer and "Einbehalten" shows a sign — layered tests are the project's established pattern (each join is tested); withheld can be negative (refunds), so the sign is specified.

## Design Notes

- **Fund distributions get Teilfreistellung too** (§ 20 InvStG). They are part of "Dividenden und Zinsen" at their taxable amount.
- **Interest** has no Transaction type yet, so the row covers DIVIDEND rows only.
- **Netting is annual, per broker.** Brokers net continuously during the year, but the year-end position is the same. Only the timing of the withheld amounts differs, and that is exactly what the comparison shows.
- **Direct crypto** (`CRYPTO`) is rare at German brokers and falls into "other" for simplicity.
- **Teilfreistellung overrides** are user settings that reference a Security, so they are exported with the allowances. Otherwise a restore would lose them.

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all pass.

## Auto Run Result

Status: done

**Summary:** New `tax` module stores Freistellungsaufträge (per broker and year) and Teilfreistellung overrides (per Security); both travel with export/restore (schemaVersion 3, upgrade 2→3 adds empty lists). The pure core function `taxPreview` (`src/core/tax.ts`, AD-21) computes per broker and year: dividends (fund distributions after Teilfreistellung), stock gains/losses (Aktientopf), fund results after Teilfreistellung, other income, loss offsetting, allowance used/left, KapESt + Soli and the comparison with the tax withheld per ledger (Erstattung/Nachbelastung). Settings › "Steuern" edits the allowances (live > 1.000 € hint), the Securities page edits the Teilfreistellung of ETFs/funds, and the new Analysen tab "Steuern" shows a summary table with a "Portfolio gesamt" row, one card per broker, and the scope and allowance hints. Archived Depots count (tax follows the sale date).

**Files changed:**
- `src/core/tax.ts` (+test) — tax categories and the per-broker/year preview.
- `prisma/schema.prisma`, `prisma/migrations/20261029000000_add_tax_settings/` — `TaxAllowance`, `TeilfreistellungOverride`.
- `src/modules/tax/*` (+test) — settings services, preview input, backup reader/writer.
- `src/modules/ledger/gains.ts`, `index.ts` (+test) — `taxLedgerInput` over every Depot.
- `src/modules/backup/*` (+tests), `test/helpers/backup-seed.ts`, `src/app/api/export/route.test.ts`, `src/app/_actions/backup.test.ts` — schemaVersion 3, upgrade, consistency, restore.
- `src/app/_actions/tax.ts` (+test) — allowance and Teilfreistellung actions.
- `src/app/_components/tax/*` (+dom tests) — `AllowanceForm`, `TeilfreistellungButton`, `TaxView`, labels.
- `src/app/(app)/settings/page.tsx`, `securities/page.tsx`, `analyses/page.tsx`, `SecurityList.tsx`, `analyses/labels.ts`, `AnalysisFilters.tsx` (+tests) — wiring, tab "Steuern", no "Bereich" filter there.

**Review findings:** 22 findings (high 0, medium 0, low 16, false 6). 3 low patches applied (Datensicherung text, empty table cell, Settings first-year test); 0 deferred; 19 rejected (6 false, 13 low) with reasons in the triage log. Patched by verdict: high 0, medium 0, low 3.

**Follow-up review recommendation:** false — no high or medium patch.

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` — all pass (221 test files, 2981 tests; build compiled). Every I/O matrix row has a passing test (`src/core/tax.test.ts`, `src/modules/tax/tax.test.ts`, `AllowanceForm.dom.test.tsx`, backup upgrade/restore tests).

**Residual risks:** Soli/KapESt rounded half-up (banks may truncate cent fractions, ≤ 1 cent); no interest Transaction type, so "Dividenden und Zinsen" covers DIVIDEND rows only; direct crypto counts as "other" income; allowance writes are not wrapped in one transaction; the Steuern tab is unreachable when every Depot is archived (existing Analysen empty state).
