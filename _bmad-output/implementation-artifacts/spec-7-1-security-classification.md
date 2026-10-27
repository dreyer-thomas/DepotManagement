---
title: 'Story 7.1: Security Classification'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '1d350248fe8aaabcfb4be8f9c7f0925954f42712'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Analyses (7.2) need every Security classified by asset class, type, sector, industry, region, country, company size and currency, but nothing stores such reference data today (AD-20, FR-21).

**Approach:** A new `classification` module owns one `SecurityClassification` row per Security with an automatic layer (value + source `PROVIDER | RULE`, refreshed in the background from Yahoo `quoteSummary` for stocks and pure core rules for everything else) and a manual layer (user overrides on the Securities page) that always wins. Type mirrors the ledger's `assetType`.

## Boundaries & Constraints

**Always:**
- Effective value per dimension = manual ?? automatic; reported source `manual | provider | rule`; `null` value is shown as "Unbekannt". `type` is read from ledger `assetType` (not stored; its manual override is the existing "Typ ändern" dialog, ledger-owned).
- Automatic refresh writes only automatic columns; never touches `*Manual` columns.
- Stored values are German labels: asset class ∈ {Aktien, Anleihen, Rohstoffe, Immobilien, Geldmarkt, Krypto, Derivate, Gemischt}; region ∈ {Welt, Europa, USA, Nordamerika, Asien-Pazifik, Schwellenländer}; company size ∈ {Large Cap, Mid Cap, Small Cap, –}; sector via one Yahoo→German table (unmapped kept verbatim); country via one English→German table that also yields the region (unmapped country kept verbatim, region null); industry verbatim from Yahoo; currency ISO code `^[A-Z]{3}$`.
- Outbound Yahoo request carries only the Yahoo mapping symbol (ticker); only STOCK Securities with a `YAHOO` mapping are fetched.
- Runs are background only (`after()` chain and the daily scheduler), serialized in-process like logos; a failure is logged (error name only) and never thrown into a ledger write.
- Rules, mapping tables, merge and underlying matching are pure functions in `src/core/classification.ts` (imports only own files / `decimal.js`).
- New Prisma migration (never edit committed ones); manual overrides are user data → part of export/restore (schema version 2 with an upgrade step).

**Never:** ETF look-through; storing analysis figures; writing `assetType` or Security name; live network in tests; classification code in the ledger write path; other modules touching `SecurityClassification` directly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stock via Yahoo | STOCK, mapping YAHOO `SAP.DE`; quoteSummary sector Technology, industry "Software—Application", country Germany, marketCap 2.0e11, currency EUR | Aktien(rule), Technologie, Software—Application, Europa, Deutschland, Large Cap, EUR (provider) | — |
| Yahoo transient error | thrown network error | rule values stored, provider pending (`providerSymbol` null) → retried next run | logged, run continues |
| Yahoo no data | thrown "Quote not found"/no `assetProfile` | rule values; `providerSymbol` = symbol recorded (no retry until symbol changes) | — |
| ETF rules | "iShares Core MSCI World UCITS ETF USD (Acc)" | Aktien, region Welt, currency USD, company size –, source rule | — |
| ETF rules | "Xtrackers MSCI Emerging Markets" / "Vanguard S&P 500" / "iShares STOXX Europe 600" / "iShares Euro Gov Bond" / "Xetra-Gold ETC" / "iShares Developed Markets Property Yield" | Schwellenländer / USA (country USA) / Europa / Anleihen / Rohstoffe / Immobilien | — |
| Unmatched fund | "DWS Vermögensbildungsfonds I" | asset class null, region null ("Unbekannt") | — |
| Certificate with known underlying | CERTIFICATE "Turbo Long auf SAP SE", known STOCK "SAP SE" | underlying's effective values (source rule) | — |
| Certificate without | CERTIFICATE "Mini Future Long DAX" | Derivate (commodity keywords Gold/Silber/Silver/ETC → Rohstoffe) | — |
| Crypto | CRYPTO BTC | Krypto, company size –, rest null | — |
| Manual wins | manual sector "Halbleiter", then refresh with provider Technology | effective "Halbleiter", source manual; automatic column updated underneath | — |
| Invalid override | region "Mars" / currency "eur1" | `{ ok: false, reason: "region-invalid" }`; nothing written | German field error |

</intent-contract>

## Code Map

- `src/modules/logos/logos.ts` -- template: `serialized()` globalThis queue, `inTransaction`, deps injection (`fetch/now`), run result counters, error-name-only logging.
- `src/modules/prices/providers/yahoo.ts` -- template for a lazily loaded `yahoo-finance2` client (`validateResult: false`, `AbortSignal.timeout(PROVIDER_TIMEOUT_MS)`), zod-validated raw result, `thrownReason`. Classification keeps its own client (modules don't share internals, cf. `news/providers/yahoo.ts`).
- `node_modules/yahoo-finance2/esm/src/modules/quoteSummary-iface.d.ts` -- `assetProfile.{sector,industry,country}`, `price.{marketCap,currency}`; call `quoteSummary(symbol, { modules: ["assetProfile","price"] }, { validateResult: false, fetchOptions })`.
- `src/modules/prices/mappings.ts:30` -- `listSecuritiesWithMappings` / `SecurityWithMapping` (id, isin, cryptoSymbol, name, assetType, mapping.provider/symbol) — the read input of a run.
- `src/modules/ledger/securities.ts:156` -- `getSecurity` for override validation.
- `src/app/_actions/price-refresh.ts:35` -- `schedulePriceBackfill` → after backfill runs `runLogoFetch`; append classification refresh in the same `then` (mapping resolved first).
- `src/app/_actions/logo-fetch.ts` -- template for `runClassificationRefresh` helper.
- `src/instrumentation-node.ts:40` -- daily price-scheduler run wrapper (`finally` → news); add classification refresh after news.
- `src/modules/backup/{schema,export,restore,upgrade,consistency}.ts` -- add `classifications` key (version 2, `UPGRADES[1]` adds `classifications: []`), restore via module writer after `replaceAllLedger`, consistency: securityId resolves + unique.
- `test/helpers/backup-seed.ts`, `src/modules/backup/*.test.ts` -- expectations on key order / version need updating.
- `src/app/(app)/securities/page.tsx`, `src/app/_components/securities/SecurityList.tsx` -- load and render classification summary + "Klassifizierung" button per card.
- `src/app/_components/securities/TypeDialog.tsx`, `SecurityDialog.tsx`, `labels.ts`, `SecurityDialogs.dom.test.tsx` -- dialog/form/action-state/test pattern (`useActionState`, `TOUCH_TARGET`, `ACTION_FAILED_MESSAGE`).
- `src/app/_actions/securities.ts` -- server-action pattern (`getSession`, `formText`, `revalidatePath`).
- `src/core/asset-type.ts` -- `termPattern` whole-word matcher idiom to reuse (copy or export).
- `prisma/migrations/20261026150000_add_security_logo/migration.sql` -- migration style; new folder `20261028000000_add_security_classification`.
- `test/helpers/providers.ts` -- `recorded()` fixture loader.

## Tasks & Acceptance

**Execution:**
- `src/core/classification.ts` (+ `.test.ts`) -- constants (asset classes, regions, company sizes), `SECTOR_LABELS`, `COUNTRIES` (English → {label, region}), `fundRules(name)`, `providerValues(profile)` (sector/industry/country/region/companySize from marketCap: ≥1e10 Large, ≥2e9 Mid, else Small/currency), `findUnderlying(name, known)` (legal-suffix-stripped whole-word name match, longest wins, ≥3 chars), `ruleValues(security, underlying?)`, `mergeAutomatic(stored, rules, provider)` (non-STOCK → rules only; STOCK keeps stored PROVIDER values unless a new provider result replaces them), `effective(row, assetType)` -- pure decisions with unit tests covering every matrix row.
- `prisma/schema.prisma` + `prisma/migrations/20261028000000_add_security_classification/migration.sql` -- model `SecurityClassification` (id, securityId unique cascade, per dimension `x`, `xSource ClassificationSource?`, `xManual` for assetClass/sector/industry/region/country/companySize/currency; `providerSymbol`, `providerFetchedAt`, `updatedAt` UTC ISO); enum `ClassificationSource { PROVIDER RULE }`; relation on Security.
- `src/modules/classification/providers/yahoo.ts` (+ test, fixtures `test/fixtures/providers/yahoo-quotesummary-sap-de.json`, `yahoo-quotesummary-no-profile.json`, synthetic but real-shaped) -- `fetchProfile(symbol, { quoteSummary })` → `Lookup<Profile>`; asserts only the symbol is passed.
- `src/modules/classification/classification.ts` + `index.ts` -- `refreshClassifications(deps, db)` (all Securities; non-certificates first, then certificates against effective values; provider fetch for STOCK+YAHOO where `providerSymbol !== mapping.symbol`; writes only changed rows), `listClassifications(db)` → `Record<securityId, Classification>` (every dimension `{ value, source }`, type from assetType, missing row → nulls), `setManualClassification(securityId, input, db)` (zod; `""` → automatic; typed reasons `not-found | <dimension>-invalid`), `exportClassifications`, `replaceAllClassifications`. Integration tests on a temp DB (manual never overwritten, provider error retried, certificate inheritance, refresh result counts).
- `src/app/_actions/classification-refresh.ts` (+ test) and `src/app/_actions/price-refresh.ts` (+ test) -- chain classification refresh after logo fetch; logs failures.
- `src/instrumentation-node.ts` (+ test) -- daily run: news, then classification refresh; failure only logged.
- `src/app/_actions/classification.ts` (+ test) -- `setClassificationAction` (session check, revalidate `/securities`).
- `src/app/_components/securities/ClassificationDialog.tsx` (+ dom test), `labels.ts`, `SecurityList.tsx` (+ dom test), `src/app/(app)/securities/page.tsx` (+ test) -- summary line per card ("Aktien · Technologie · Europa · Deutschland · Large Cap · EUR"; nulls "Unbekannt"), button "Klassifizierung bearbeiten – {name}" opening a dialog: type read-only with hint "über „Typ ändern“"; selects (asset class, sector, region, company size) and text fields (industry, country, currency) whose empty / "Automatisch" choice shows the automatic value and its source (Yahoo / Regel); field errors in German.
- `src/modules/backup/*` + tests, `test/helpers/backup-seed.ts` -- export/restore/upgrade/consistency for `classifications`.

**Acceptance Criteria:**
- Given a new Security is booked (any ledger write that schedules the price backfill), when the background chain finishes, then a `SecurityClassification` row exists for it; the ledger write's result never depends on it.
- Given the app runs, when the daily scheduled price run completes, then Securities without classification (or with pending provider data) are classified.
- Given the Securities page, when I set a dimension manually and save, then the card shows the manual value; a later refresh keeps it; choosing "Automatisch" restores the automatic value.
- Given an export with manual overrides, when it is restored, then the overrides are back; a version-1 export still restores (with no classifications).
- Given the verification commands, then lint, typecheck, tests and build pass.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 32 findings — high 0, medium 15, low 14, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind: stray `</content>`/`</invoke>` lines at the end of the spec — fix edits this build's spec (removed during finalization as housekeeping, not as a review patch).
  - `[medium]` `[patch]` Blind: STOCK → other → STOCK with the same Yahoo symbol never refetches provider data — `storeAutomatic` now clears `providerSymbol`/`providerFetchedAt` for non-stocks; round-trip test added.
  - `[medium]` `[patch]` Blind: "no data" after a symbol change keeps the old symbol's provider values — refresh passes `emptyLayer()` for a fetched-without-profile answer; test added.
  - `[low]` `[reject]` Blind: provider data never refreshed once answered — AC limits the daily run to Securities without classification; periodic refetch adds new state/config, unlikely to matter (company size drift).
  - `[low]` `[patch]` Blind: `isNoData` matches generic "not found"/"no data" — narrowed to `BadRequestError` or `/quote not found|no fundamentals data|doesn't exist/i`; tests added.
  - `[medium]` `[patch]` Blind: certificate matched to an underlying without asset class gets all-Unbekannt — `ruleValues` inherits only when the underlying has an asset class, else Derivate/Rohstoffe; test added.
  - `[low]` `[patch]` Blind: "ex Japan" exclusions matched as inclusions — `ex <word>` stripped before region/country matching; tests added.
  - `[medium]` `[patch]` Blind: no refresh after restore (start-up part is false: the price scheduler ticks immediately on start and chains the refresh) — restore action schedules `scheduleClassificationRefresh()`.
  - `[low]` `[reject]` Blind: manual country/industry free text not normalised — design choice for user overrides; fix needs new UI/validation, unlikely to bite a single user.
  - `[false]` `[reject]` Blind: every ledger write stacks a full refresh — each server action schedules one backfill chain (e.g. import booking calls `schedulePriceBackfill` once, `src/app/_actions/import.ts:154`), same pattern as logos.
  - `[low]` `[reject]` Blind: `ClassifiedAssetType` duplicates ledger `AssetType` with casts — a new ledger type falls back gracefully to an empty layer; adding a type is rare and the guard adds surface.
  - `[medium]` `[patch]` Blind: tests missing for the above paths — covered by the tests added with the patches.
  - `[low]` `[reject]` Blind: currency is the listing currency — the story AC defines it from Yahoo `price` currency.
  - `[low]` `[reject]` Blind: summary line "Unbekannt · …" unlabelled — dialog shows labelled fields; cosmetic.
  - `[medium]` `[patch]` Edge: symbol change + "no data" keeps old values — same fix as the Blind finding.
  - `[medium]` `[patch]` Edge: type round-trip never refetches — same fix as the Blind finding.
  - `[low]` `[reject]` Edge: Yahoo mapping removed/switched keeps stale Yahoo values — rare; fix needs a new merge parameter.
  - `[medium]` `[patch]` Edge: "Typ ändern" schedules no refresh — `changeSecurityTypeAction` calls `scheduleClassificationRefresh()`; action test extended.
  - `[medium]` `[patch]` Edge: restore schedules no refresh — same fix as the Blind finding.
  - `[low]` `[patch]` Edge: "MSCI Japan Euro Hedged" → Europa — Japan/Asia-Pacific rules moved before Europe; test added.
  - `[medium]` `[patch]` Edge: certificate with empty underlying — same fix as the Blind finding.
  - `[low]` `[patch]` Edge: `isNoData` too broad — same fix as the Blind finding.
  - `[low]` `[reject]` Edge: minor-unit currencies (GBp, ZAc) — mappings are German listings quoted in EUR; unlikely, fix adds a table.
  - `[medium]` `[patch]` Edge: claim "no data → rule values" not met — same fix as the Blind finding.
  - `[medium]` `[patch]` Verification gap: concurrent-run serialization untested — "serializes concurrent runs" test added (gated fake `quoteSummary`).
  - `[medium]` `[patch]` Verification gap (other): type round-trip — same fix as above.
  - `[medium]` `[patch]` Verification gap (other): "no data" after symbol change — same fix as above.
  - `[medium]` `[patch]` Verification gap (other): "Typ ändern" no refresh — same fix as above.
  - `[low]` `[reject]` Intent: triggers covered only by mocked ordering tests, no end-to-end write → row check — every link (after() chain, refresh on a real DB) is tested; an E2E harness is out of proportion.
  - `[false]` `[reject]` Intent: outbound is ticker-only although AC says "ticker or ISIN" — the AC restricts what may leave the server, it does not require both.
  - `[low]` `[reject]` Intent: type not stored in the classification — ledger owns `assetType` (AD-16); "Typ ändern" is its override; documented in Design Notes.
  - `[false]` `[reject]` Intent: commodity refinement for certificates and backup v2 scope — deliberate, documented in Design Notes; manual overrides are user data that AD-12 requires in export/restore.

### 2026-10-27 — Review pass
- verdicts: 21 findings — high 0, medium 0, low 14, false 5, maybe-false 2
- findings:
  - `[low]` `[reject]` Blind: issuer names in a certificate's name can win the longest-match underlying search — needs holding the issuer's stock plus an issuer-named certificate; a fix adds issuer/"auf" heuristics; manual override covers it.
  - `[low]` `[patch]` Blind: hyphenated exclusions ("Asia ex-Japan") not stripped, so country becomes Japan — `EXCLUSION` now matches `ex[\s-]+`; `fundRules` test added (fails with the old pattern).
  - `[low]` `[patch]` Blind: saving a manual override does not refresh certificates that inherit the Security's effective values — `setClassificationAction` calls `scheduleClassificationRefresh()` on success; action test asserts it (and its absence on invalid input).
  - `[low]` `[reject]` Blind: index certificates (DAX, S&P 500) get no region/country — the matrix specifies only Derivate for them; enrichment adds a branch.
  - `[low]` `[reject]` Blind: migration folder `20261028000000_…` is dated tomorrow — renaming a committed migration is forbidden; it only matters for a migration created today that also touches this table.
  - `[false]` `[reject]` Blind: "values are German labels" untrue for industry/unmapped values — the intent explicitly mandates industry verbatim and unmapped sector/country kept verbatim.
  - `[low]` `[patch]` Blind: run counts overlap (a provider failure counts in `failed` and in `updated`/`unchanged`) contrary to the type's doc — `ClassificationRunResult` doc corrected to describe the overlap.
  - `[maybe-false]` `[reject]` Blind: back-to-back Yahoo calls without throttle may hit rate limits — would need Yahoo's quoteSummary limits vs. a single user's stock count; if true only low (transient failures are retried).
  - `[low]` `[reject]` Blind: Securities page queries `listSecuritiesWithMappings` twice — negligible for single-user SQLite; fix changes the service signature.
  - `[low]` `[reject]` Blind: manual country does not adjust region — dimensions are overridden independently by design; the user can override region too; fix adds logic.
  - `[low]` `[reject]` Blind: backup schema accepts untrimmed/non-NFC manual text — only hand-edited exports produce it; unlikely.
  - `[low]` `[reject]` Blind: assorted untested paths (File input, v1 restore then refresh, dialog value outside list, unauthorized alert) — low-value gaps; each path is simple and covered indirectly.
  - `[low]` `[reject]` Edge: carried — Yahoo mapping removed/switched keeps stale Yahoo values (`providerFor` returns `none` for a non-Yahoo mapping); rare; fix needs a new merge parameter.
  - `[low]` `[reject]` Edge: concurrent first-row upsert (user save vs. background refresh) can raise P2002 — needs an in-process interleaving inside the post-booking refresh window; fix adds retry logic.
  - `[maybe-false]` `[reject]` Edge: a transient HTTP 400 (`BadRequestError`) is treated as "no data" — would need evidence that Yahoo returns 400 transiently; same rule as the prices provider; if true only low (refetch on symbol change, manual override).
  - `[low]` `[patch]` Verification gap: `isNoData`'s `BadRequestError` and "doesn't exist" branches untested — two `fetchProfile` cases added in `providers/yahoo.test.ts`.
  - `[low]` `[reject]` Intent: transient failure on a row with an old symbol keeps the old provider values until the retry succeeds — the pending symbol is retried every run; last-known values for the same Security are a reasonable interim.
  - `[false]` `[reject]` Intent: underlying matching broadened to non-stocks and manual overrides flowing as RULE values — the matrix says "underlying's effective values (source rule)" and Design Notes say "held or known Security".
  - `[false]` `[reject]` Intent: "Xetra-Gold ETC" typed CERTIFICATE takes the certificate fallback — that fallback still yields Rohstoffe (documented in Design Notes); no different outcome.
  - `[false]` `[reject]` Intent: no startup run, so existing Securities wait for the next write or daily run — `startPriceScheduler` calls `tick()` immediately on start (`src/modules/prices/scheduler.ts:64`), which chains the classification refresh.
  - `[false]` `[reject]` Intent: 7.2's consumption of `listClassifications` is tested only through the Securities page — 7.2 is not part of this story; the module tests cover the data shape.

## Design Notes

Two layers instead of one value per dimension: refresh can recompute the automatic layer freely (rules are cheap and pick up an `assetType` change) while a manual value is physically untouched; reverting an override needs no refetch. Type is ledger data (AD-16); duplicating it would let two "types" diverge, so the classification exposes `assetType` and the existing "Typ ändern" is its override.

Certificates: the ledger stores no underlying, so the "held or known Security" is found by name (`findUnderlying`). Commodity keywords on unmatched certificates yield Rohstoffe (ETCs such as Xetra-Gold are booked as certificates) — a refinement of "else Derivate"; documented here deliberately.

Region of `S&P 500` is "USA" per the AC, so US stocks also get region "USA" (consistent dimension), Canada "Nordamerika".

## Verification

**Commands:**
- `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` -- expected: all succeed (build needs network for fonts).

## Auto Run Result

Status: done (follow-up review pass)

**Summary:** Story 7.1 adds a new `classification` module (AD-20). Each Security gets one `SecurityClassification` row with two layers. The automatic layer comes from Yahoo `quoteSummary` for stocks with a Yahoo mapping, and from pure core rules for ETFs, funds, certificates and crypto. The manual layer holds the user's overrides and always wins. This follow-up pass reviewed the whole change since the baseline and applied four small patches.

**Files changed in this pass:**
- `src/core/classification.ts` (+test) -- `EXCLUSION` also strips hyphenated exclusions ("ex-Japan").
- `src/app/_actions/classification.ts` (+test) -- saving an override schedules a classification refresh, so inheriting certificates update.
- `src/modules/classification/classification.ts` -- `ClassificationRunResult` doc describes the overlapping counts accurately.
- `src/modules/classification/providers/yahoo.test.ts` -- tests for the `BadRequestError` and "doesn't exist" no-data branches.

The story's full file list is in commit `00d1373bfbef206c55c41c453acfe78376730d9d`.

**Review findings:** 21 findings: high 0, medium 0, low 14, false 5, maybe-false 2.
- **Patched (4, all low):** hyphenated exclusion; refresh after a manual override; run-count doc; tests for the no-data branches.
- **Deferred:** none.
- **Rejected (17):**
  - issuer names in certificate matching
  - region for index certificates (matrix says Derivate)
  - future-dated migration name (committed migrations cannot be renamed)
  - "German labels" claim (false: the intent says verbatim)
  - Yahoo throttling (maybe-false, low if true)
  - double Securities query
  - country/region coupling
  - loose backup text validation
  - assorted low test gaps
  - stale values after a mapping removal (carried)
  - concurrent first-row upsert
  - `BadRequestError` treated as transient (maybe-false)
  - old provider values kept during a retry
  - broadened underlying matching (false)
  - Xetra-Gold certificate fallback (false)
  - missing startup run (false: the scheduler ticks on start)
  - 7.2 consumer surface (false)

  The triage log has the reasons.

**Follow-up review:** not recommended (`false`). This is a follow-up pass and it patched no high finding (patched: high 0, medium 0, low 4).

**Verification:** `npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build` all passed (189 test files, 2610 tests; build OK). The new `ex-Japan` test fails when the old pattern is restored.

**Residual risks:**
- Yahoo parsing is verified only against synthetic fixtures.
- Name rules are heuristics, and certificate underlying matching by name can pick the wrong Security (e.g. the issuer).
- Provider data is not refetched once a symbol has answered.
- The migration folder name is dated 2026-10-28, so later migrations need timestamps after it.
- No operator action is required.
