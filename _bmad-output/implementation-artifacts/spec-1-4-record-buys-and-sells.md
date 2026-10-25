---
title: 'Story 1.4: Record Buys and Sells'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '72310594817ce74577c6f33bf0dd9d3fc607195d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The "Neue Buchung" form may lose some entered values after an error, if React 19's automatic form reset after an action also affects the MUI Select or Autocomplete inputs.
    evidence: |-
      maybe-false: every input is controlled (useState), and the same pattern is used in DepotDialogs (story 1.3), but no browser or DOM test has confirmed it. Settle by opening the dialog in a browser, submitting with an invalid quantity (e.g. "0") after filling every field including a new Security and Art, and checking that all values are still there.
    location: >-
      src/app/_components/transactions/TransactionDialog.tsx
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Depots exist but nothing can be booked into them: there is no Security or Transaction model, no ledger write path for trades, and "Neue Buchung" on the Depot detail is disabled.

**Approach:** Add `Security` and `Transaction` Prisma models (new migration), extend the `ledger` module with `ensureSecurity`, `listSecurities`, `recordTrade` (BUY/SELL, zod-validated, AD-14 shape, intra-day sequence, sell guard) and `listTransactions`, add pure core helpers (German decimal input parsing, business dates, sellable quantity), and build the German Transaction form dialog plus a Transactions tab on the Depot detail.

## Boundaries & Constraints

**Always:**
- Schema: `enum AssetType { STOCK ETF CERTIFICATE CRYPTO UNCLASSIFIED }`, `enum TransactionType { BUY SELL DIVIDEND FEE TAX DEPOSIT WITHDRAWAL }` (all AD-14 types declared now; only BUY/SELL are writable in this story). `model Security { id cuid; isin String? @unique; cryptoSymbol String? @unique; name String; assetType AssetType }`. `model Transaction { id cuid; depotId → Depot; securityId String? → Security; type TransactionType; date String; sequence Int; quantity String?; price String?; amount String; fee String; tax String; @@unique([depotId, date, sequence]) }`. All money/quantity/price columns are `String` (TEXT); new migration folder, existing migrations untouched.
- Decimals: canonical strings from `new Decimal(x).toFixed()` (no exponent, no rounding); all arithmetic with decimal.js; no JS `number`, no SQL arithmetic/comparison/ordering on these columns.
- `ensureSecurity(identifier: { isin } | { cryptoSymbol }, details: { name, assetType }, db?)`: idempotent — returns the existing Security for that ISIN / upper-cased crypto symbol unchanged, else creates it. ISIN: trimmed, upper-cased, `^[A-Z]{2}[A-Z0-9]{9}[0-9]$` with a valid ISIN check digit. Crypto symbol: trimmed, upper-cased, `^[A-Z0-9]{1,10}$`. `assetType` CRYPTO ⇔ crypto symbol; STOCK/ETF/CERTIFICATE ⇔ ISIN. Name trimmed, 1–100 chars. A `P2002` race re-reads and returns the existing row.
- `recordTrade(input, db?)` input: `{ depotId, type: "BUY"|"SELL", date, quantity, price, amount?, fee?, tax?, security: { id } | { new: { isin | cryptoSymbol, name, assetType } } }`, values as canonical decimal strings. Rules: date a real `YYYY-MM-DD`; quantity > 0 with ≤ 8 decimals; price ≥ 0; fee ≥ 0 (default "0"); tax any sign (default "0"); `amount` defaults to quantity × price (exact, unrounded), else must be ≥ 0. A new Security is created via `ensureSecurity` inside the same DB transaction and only when every other check passes. `sequence` = max sequence of that Depot and date + 1 (1 for the first), read and written in one DB transaction (when `db` is omitted, wrap in `prisma.$transaction`).
- Sell guard: a SELL is appended at the end of its date; it is rejected when its quantity exceeds `sellableQuantity` = the minimum running held quantity of that Security in that Depot from the insertion point through the end of the ledger (ordered by `(date, sequence)`), so later sells never go negative. Computed in pure `src/core`.
- Results: `{ ok: true, transaction } | { ok: false, reason, available? }`; reasons: `depot-not-found`, `type-invalid`, `date-invalid`, `quantity-invalid`, `price-invalid`, `fee-invalid`, `tax-invalid`, `amount-invalid`, `security-required`, `security-not-found`, `isin-invalid`, `crypto-symbol-invalid`, `security-name-invalid`, `asset-type-invalid`, `sell-exceeds-holding` (with `available`). Expected failures never throw.
- `listTransactions(depotId, db?)`: newest first by `date` desc then `sequence` desc (string compare of `YYYY-MM-DD` is fine), each with its Security `{ id, name, isin, cryptoSymbol, assetType }`.
- German input parsing (pure core): trims and drops spaces; with a comma, dots are thousands separators and the comma is the decimal point (`1.234,56` → `1234.56`); without a comma, `^\d{1,3}(\.\d{3})+$` is thousands-grouped (`1.234` → `1234`), otherwise one dot is a decimal point (`12.5`); optional leading `-`; empty → empty (field default applies); anything else is invalid. The app layer parses FormData with it, the ledger receives canonical strings.
- UI (German): "Neue Buchung" button on `/depots/[id]` (enabled, also in the empty state) opens dialog "Neue Buchung" — full-screen below `sm`, Enter submits, Esc/"Abbrechen" closes, controlled inputs keep their values on error, success closes, no optimistic writes, touch targets ≥ 44 px. Type first: "Kauf" / "Verkauf". Security: MUI Autocomplete over all Securities matching ISIN, crypto symbol or name (case-insensitive substring), option label `Name (ISIN or crypto symbol)`, plus a last option "Neue Security anlegen" that reveals fields "ISIN oder Krypto-Symbol", "Name", "Art" (Aktie, ETF, Zertifikat, Krypto). Fields "Datum" (default today, Europe/Berlin), "Stück", "Kurs", "Gebühren", "Steuern"; text inputs with `inputMode="decimal"`; submit "Buchen". Errors inline under their field; `sell-exceeds-holding` reads exactly `Verkauf übersteigt Bestand (x Stück).` with x via `formatQuantity`; depot/session errors as Alert.
- Depot detail: MUI Tabs "Positionen", "Cash-Konto", "Buchungen" driven by `?tab=positions|cash|transactions`, default `transactions` until story 1.5; Positionen/Cash-Konto show a neutral placeholder. Buchungen: empty state "Noch keine Buchungen." + "Neue Buchung"; otherwise groups by month (heading like "Oktober 2026", de-DE), each row: type icon with text "Kauf"/"Verkauf", 32px round Security logo with initials on a color derived deterministically from the name, Security name, date `DD.MM.YYYY`, quantity `formatQuantity` + " Stück", amount `formatMoney`; semantic table markup.
- Server action: checks `getSession()` (else `unauthorized`, nothing written), parses FormData, calls only `ledger`, `revalidatePath("/", "layout")` on success. Pages read only via `ledger`.

**Never:**
- No DIVIDEND/FEE/TAX/DEPOSIT/WITHDRAWAL entry, no live cash effect or cash balance change (story 1.6), no Positions/FIFO (1.5), no edit/delete or duplicate warning (1.7), no archive check (1.8), no Overview FAB, no month pagination, no price providers or logo fetching.
- No Prisma access outside `src/modules/ledger` and `src/db`; `src/core` imports only itself and `decimal.js`, no `Date.now()`.
- No edits to `sprint-status.yaml` or to committed migrations. Tests never touch `~/.depotmanagement` and use only synthetic data (public sample ISINs such as `US0378331005`, `IE00B4L5Y983`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Buy existing Security | qty `10`, price `123.45`, fee `4.90` | row amount `1234.5`, fee `4.9`, tax `0`, sequence 1 | — |
| Second trade same day | another trade, same Depot/date | sequence 2 | — |
| New Security on buy | ISIN `us0378331005`, name, STOCK | Security `US0378331005` created once; repeat returns same id | — |
| Invalid input | qty `0`, 9 decimals, or bad ISIN check digit | nothing written (no Security either) | `quantity-invalid` / `isin-invalid` |
| German input | `"1.234,56"`, `"0,5"`, `"12.5"`, `"1.234"` | `1234.56`, `0.5`, `12.5`, `1234` | `"1,2,3"` → invalid |
| Oversell | held 10, sell 12 | nothing written | `sell-exceeds-holding`, available `10` → "Verkauf übersteigt Bestand (10 Stück)." |
| Backdated sell | buy 10 (01.10.), sell 10 (20.10.), new sell 5 on 10.10. | rejected | available `0` |
| Unknown Depot/Security | bad ids | nothing written | `depot-not-found` / `security-not-found` |
| Crypto | symbol `btc`, CRYPTO, qty `0.00012345` | Security `BTC`, quantity stored exactly | ISIN with CRYPTO → `asset-type-invalid` |
| No session | action without cookie | nothing written | `unauthorized` |

</intent-contract>

## Code Map

- `prisma/schema.prisma` -- has `Broker`, `Depot`; add enums, models and `transactions Transaction[]` back-relation on Depot. Create the migration with `DATABASE_URL=file:<scratch>/m.db npx prisma migrate dev --name add_security_and_transaction --create-only` (never against `~/.depotmanagement`), then `npx prisma generate`.
- `src/modules/ledger/depots.ts` -- pattern to mirror: zod schemas with reason messages, `parse()` helper, `LedgerDb = Prisma.TransactionClient`, `isUniqueViolation`, default `db = prisma`. `src/modules/ledger/index.ts` re-exports the public API.
- `src/core/format.ts` -- `formatMoney`, `formatQuantity`, `formatDate` (has a private `daysInMonth`/ISO check; extract or share via new `src/core/dates.ts`).
- `src/app/_actions/depots.ts` -- server action pattern (`formText` zod catch, `UNAUTHORIZED`, revalidate).
- `src/app/_components/depots/DepotDialogs.tsx` -- dialog shell (`DepotDialog`, full-screen below `sm`), controlled-input `useActionState` form and `useDialog` remount-per-open pattern to mirror for the Transaction form.
- `src/app/_components/depots/labels.ts` -- German label/error-message mapping pattern (+ `labels.test.ts`).
- `src/app/(app)/depots/[id]/page.tsx` + `page.test.tsx` -- detail page to extend; test asserts the disabled "Neue Buchung" and must be updated.
- `test/helpers/migrated-db-file.ts` (`useMigratedDatabaseForSingleton` via `vi.hoisted`), `test/helpers/test-db.ts`, `test/helpers/render-text.ts` -- DB and render helpers; `src/modules/ledger/depots.test.ts` and `src/app/_actions/depots.test.ts` show mocking `next/headers`/`next/cache` and the session.
- `test/architecture/core-imports.test.ts` -- guards `src/core` imports.

## Tasks & Acceptance

**Execution:**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_security_and_transaction/migration.sql` -- enums, Security, Transaction, relation, unique `(depotId, date, sequence)`.
- `src/core/decimal-input.ts` (+ test) -- `parseDecimalInput(text): { ok: true, value: string | "" } | { ok: false }` per the parsing rule.
- `src/core/dates.ts` (+ test) -- `isBusinessDate(s)`, `businessDate(instant: Date)` (Europe/Berlin via `Intl.DateTimeFormat`); `format.ts` reuses the validity check.
- `src/core/holdings.ts` (+ test) -- `sellableQuantity(trades, securityId, date)` over `{ securityId, type, date, sequence, quantity }` rows (BUY adds, SELL subtracts), decimal strings.
- `src/modules/ledger/securities.ts` (+ test) -- identifier/name/assetType schemas incl. ISIN check digit, `ensureSecurity`, `listSecurities` (sorted by name, de-DE).
- `src/modules/ledger/transactions.ts` (+ test) -- `recordTrade`, `listTransactions`, types and reasons; tests cover every ledger row of the I/O matrix against a temp DB, including "no Security written on failure". `index.ts` re-exports.
- `src/app/_actions/transactions.ts` (+ test) -- `recordTradeAction(prev, formData)`: session guard, FormData → German-parsed decimals (unparseable → the field's reason), `securityId` vs new-Security fields, revalidate; covers success, field error, oversell message data, unauthorized.
- `src/app/_components/transactions/labels.ts` (+ test) -- type/asset-type labels, `transactionErrorMessage(reason, available?)`, `transactionErrorField(reason)`.
- `src/app/_components/transactions/TransactionDialog.tsx` -- client `NewTransactionButton({ depotId, securities, today })` with the form described above.
- `src/app/_components/securities/SecurityLogo.tsx` (+ test of `securityInitials`, `securityColor`) -- initials avatar, 32px, deterministic color.
- `src/app/_components/transactions/TransactionList.tsx` -- month-grouped semantic table.
- `src/app/(app)/depots/[id]/page.tsx` (+ test) -- tabs via `searchParams`, enabled "Neue Buchung" with `listSecurities()` and `businessDate(new Date())`, Transactions tab content; test covers empty state, listed rows (month heading, "Kauf", initials, quantity, amount), tab placeholder.

**Acceptance Criteria:**
- Given a Depot, when "Neue Buchung" is opened on `/depots/<id>`, then a dialog (full-screen below `sm`) offers Kauf/Verkauf, a Security Autocomplete by ISIN or name with "Neue Security anlegen" (ISIN or crypto symbol, name, Aktie/ETF/Zertifikat/Krypto), Datum, Stück, Kurs, Gebühren, Steuern.
- Given a Kauf of `10` × `123,45` with fee `4,90` for a new ISIN, when "Buchen" is pressed, then the dialog closes and the Buchungen tab shows the month heading and a row "Kauf", the Security initials and name, "10 Stück" and "1.234,50 €"; the Security now appears in the Autocomplete.
- Given invalid input or an oversell, when "Buchen" is pressed, then the inline error (e.g. "Verkauf übersteigt Bestand (10 Stück).") shows, the dialog stays open with all entered values, and nothing is written.
- Given `npm run lint && npm run typecheck && npm test && npm run build`, then all exit 0, and `prisma migrate deploy` against a fresh scratch DB applies all three migrations.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 28 findings — high 2, medium 1, low 23, false 1, maybe-false 1
- findings:
  - `[high]` `[patch]` (blind) `THOUSANDS_ONLY` reads `"0.123"` as `123` — a leading `0` group is never a German thousands grouping, so only one reading exists; first group is now `[1-9]\d{0,2}` in both regexes, tests added for `0.123`, `0.500`, `0.123,5`. (The other half of the finding, that `"1.234"` becomes 1234, is the German reading the spec requires and stays.)
  - `[low]` `[reject]` (blind) P2002 on `(depotId, date, sequence)` throws when two bookings for the same Depot and date run at once — single user, and "Buchen" is disabled while a submit is pending. Fixing it needs retry logic; the unique index is the backstop.
  - `[low]` `[patch]` (blind) the placeholder-tab regex passes whatever tab is selected — now uses a strict `selectedTab(label)` helper and asserts Buchungen is not selected.
  - `[low]` `[reject]` (blind) Esc or a backdrop click closes the dialog mid-submit — the pending window is milliseconds, the same call as story 1.3, and the fix means lifting the pending state up.
  - `[low]` `[patch]` (blind) `aria-controls` on inactive tabs pointed at panels that are not rendered — now set only on the selected tab.
  - `[low]` `[reject]` (blind) only one error per submit — the spec fixes a single-reason result shape; returning a reason per field adds new API surface.
  - `[low]` `[reject]` (blind) typed Autocomplete text is not copied into "ISIN oder Krypto-Symbol", and an existing ISIN silently reuses that Security — the Autocomplete already lists existing Securities by ISIN; prefilling needs extra state, and reuse is the spec'd idempotency.
  - `[low]` `[patch]` (blind) an unchosen Art showed "Art passt nicht …" — message reworded to "Bitte eine passende Art wählen: …".
  - `[low]` `[reject]` (blind) no tests for the client dialog or the Autocomplete filter — the repo has no DOM test setup (same call as stories 1.2 and 1.3).
  - `[low]` `[reject]` (blind) the Verkauf picker does not filter to held Securities — an enhancement; the sell guard gives a clear message.
  - `[low]` `[patch]` (blind) `noOptionsText` could never show — prop deleted.
  - `[low]` `[reject]` (blind) `ISIN_SHAPE` and the Security select are duplicated — identical today and drift is unlikely; the ledger validates whatever the action guesses.
  - `[high]` `[patch]` (edge) `"0.001"` was booked as 1 — same root cause and fix as the first blind row.
  - `[medium]` `[patch]` (edge) `"0.123,5"` was accepted as 123.5 — same root cause; now rejected, test added.
  - `[low]` `[reject]` (edge) Esc mid-submit — same as the blind Esc row.
  - `[low]` `[reject]` (edge) concurrent sequence collision — same as the blind P2002 row.
  - `[low]` `[reject]` (edge) two concurrent SELLs could both pass the guard — single user; needs serialised write transactions.
  - `[low]` `[reject]` (edge) operands over ~500 significant digits lose exactness at precision 1000 — unrealistic input; a cap adds a branch.
  - `[false]` `[reject]` (edge) non-trade types get the Kauf icon — `recordTrade` accepts only BUY and SELL, so no other type can exist in the ledger yet; story 1.6 adds those types and their icons.
  - `[maybe-false]` `[defer]` (edge) React 19's form reset may clear MUI Select or Autocomplete values after an error — every input is controlled; settle with a browser check (deferred, medium unverified).
  - `[low]` `[patch]` (verification-gap) tab selection assertion cannot fail — same fix as the blind regex row.
  - `[low]` `[patch]` (verification-gap) tab hrefs never asserted — the test now checks all three `?tab=` links.
  - `[low]` `[patch]` (verification-gap) dialog field names and action keys were hand-duplicated — new `form-fields.ts` (`TRADE_FIELDS`, `NEW_SECURITY_MARKER`) used by both sides, so a mismatch fails typecheck.
  - `[low]` `[patch]` (verification-gap) no test that a failed insert rolls back a newly created Security — test added that makes the tx client's `transaction.create` reject.
  - `[low]` `[reject]` (verification-gap) the page's default date is not tested as the Berlin date — `businessDate` is unit-tested; checking the prop needs a fake clock and a DOM render of the closed dialog.
  - `[low]` `[reject]` (verification-gap other) uncaught P2002 on the sequence — same as the blind P2002 row.
  - `[low]` `[reject]` (intent) the user-facing dialog criteria are not exercised by any test — no DOM test setup; covered by the action, page and label tests plus a live `next dev` page check.
  - `[low]` `[reject]` (intent) the submit → revalidate → re-render chain is not run end to end — each link is tested, and the implementer fetched the rendered list live; a browser check remains a residual risk.

### 2026-10-25 — Review pass (follow-up)
- verdicts: 32 findings — high 0, medium 0, low 22, false 9, maybe-false 1
- findings:
  - `[false]` `[reject]` (blind) spec status disagrees with sprint status, and the diff edits `sprint-status.yaml` — the sprint-status row is the orchestrator's bookkeeping, not part of the code change; the spec status is set by this workflow at finalize.
  - `[low]` `[reject]` (blind) no live Stück × Kurs preview, so `"1.234"` typed English-style books 1234 — the German thousands reading is the spec'd rule; a preview is a new feature, and the list shows the booked quantity right after.
  - `[low]` `[reject]` (blind) inline errors stay on screen after the user edits the field — they clear on the next submit; clearing per field needs extra state per input.
  - `[low]` `[reject]` (blind) an empty identifier with no Art shows the crypto-symbol message — the form still blocks the booking with a field error under the right input; a neutral message needs a new branch and reason.
  - `[low]` `[reject]` (blind) ISINs pasted with inner spaces are rejected — the spec'd rule is trim only; the error message is clear and manual entry rarely has spaces.
  - `[low]` `[reject]` (blind) future dates are accepted — neither intent nor spec limits dates; a policy is a product decision for a later story.
  - `[low]` `[reject]` (blind) messages hard-code 8 decimals and 100 chars — `labels.ts` runs in the client dialog, and importing the constants from the ledger barrel would pull Prisma into the client bundle; the limits are stable.
  - `[false]` `[reject]` (blind) the labels test lets a missing translation fall back to another message — `MESSAGES` is a typed `Record` over every reason, so a missing message fails typecheck.
  - `[low]` `[reject]` (blind) no test that a new Security appears in the Autocomplete after booking — no DOM test setup; `revalidatePath` on success and `listSecurities` are both tested.
  - `[low]` `[patch]` (blind) a SELL through `{ new }` with an existing ISIN is untested — same root cause as the first verification-gap row; test added.
  - `[low]` `[reject]` (blind) `depotTab` with an array value is untested — the code takes `value[0]` explicitly; a one-line branch.
  - `[low]` `[patch]` (blind) the unknown-tab fallback test never asserts Buchungen is selected — now asserts `selectedTab("Buchungen")`.
  - `[low]` `[reject]` (blind) the page loads Transactions on every tab — one indexed query for a single user; Positions replaces the placeholder in story 1.5.
  - `[low]` `[patch]` (blind) the type error is not linked to the toggle group for screen readers — `FormHelperText` gets an id and the group `aria-describedby` while the error shows.
  - `[low]` `[reject]` (blind) the default Datum can go stale past Berlin midnight — the date field is visible and editable; computing it on the client adds a clock read in the dialog.
  - `[low]` `[patch]` (blind) `NewTransactionButton` has an unused `variant` prop — prop and `ButtonProps` import deleted; the button is always `contained`.
  - `[low]` `[reject]` (blind) `Transaction.depot` relies on the default `onDelete` while `security` is explicit — the migration already has `ON DELETE RESTRICT` for both; deletion arrives in stories 1.7/1.8.
  - `[false]` `[reject]` (edge) a direct ledger caller passing `"-0"` gets price/fee/amount-invalid — the only caller, `recordTradeAction`, canonicalises `"-0"` to `"0"` via `parseDecimalInput`, and the spec has the ledger receive canonical strings.
  - `[low]` `[reject]` (edge) a rejected `recordTradeAction` (DB error, 307) reaches the error boundary and loses the entered values — same pattern as the Depot dialogs in story 1.3; expected failures return reasons, and the session-expiry case is tracked as DW-1.
  - `[low]` `[reject]` (edge) default Datum stale past midnight — same as the blind stale-date row.
  - `[low]` `[reject]` (edge) names with astral characters count UTF-16 units against the 100 limit — only affects names near 100 characters with emoji; a refine adds a branch.
  - `[low]` `[reject]` (edge) the Autocomplete clear and popup buttons are below 44 px — the whole 56 px input opens the list on tap and typing clears it; resizing MUI's indicators changes the input layout.
  - `[false]` `[reject]` (edge) the Intent's thousands regex differs from the code for a leading `0` group — the fix would edit this build's spec; the code follows the first pass's verified fix (a leading `0` group has only one reading).
  - `[low]` `[patch]` (verification-gap) SELL through "Neue Security anlegen" with an existing ISIN is untested — added a ledger test that oversells (available `10`) and then sells 5 via `{ new }` with Apple's ISIN; a mutation setting the lookup to `null` makes it fail.
  - `[low]` `[patch]` (verification-gap) a non-ISIN identifier with a non-crypto Art routing to `isin-invalid` is untested — added the `AAPL` + STOCK row to the action's field-error table.
  - `[low]` `[reject]` (intent) the dialog surface (Esc/Enter, full-screen, filter, values kept, close on success) has no test — carried from the first pass: no DOM test setup; the values-kept risk is deferred as DW-2.
  - `[false]` `[reject]` (intent) the diff edits `sprint-status.yaml` against the Never clause — that change is the orchestrator's bookkeeping, not the implementation.
  - `[false]` `[reject]` (intent) the diff contains planning files (spec, `deferred-work.md`) — these are the workflow's own records, not code outside scope.
  - `[false]` `[reject]` (intent) the page test now expects a no-break space in `0,00 €` — the old assertion already contained U+00A0 (checked bytes of `7231059`); only the escape form changed.
  - `[false]` `[reject]` (intent) strict grouping rejects `1.2.3,4` — the spec says anything else is invalid, and loose dots would accept typos.
  - `[maybe-false]` `[reject]` (intent) `ensureSecurity` validates `details` before returning an existing row, so it is not idempotent for invalid details — rejecting invalid input is consistent with the spec's input rules; if true it would only be low.
  - `[false]` `[reject]` (intent) default date from server render — duplicate of the stale-date rows; counted false here as the auditor only described it.

## Design Notes

Sellable quantity, not just "held at that date": a backdated sell that leaves enough units at its own date can still make a later sell negative; taking the minimum running quantity from the insertion point onward rejects that, and equals the held quantity in the common case of a sell dated today.

`amount` is optional in `recordTrade` so later importers can pass the broker-stated gross value (AD-5: booked amounts as stated); the manual form omits it and the ledger computes quantity × price exactly.

Tabs default to Buchungen only because Positions arrive in story 1.5, which switches the default.

## Verification

**Commands:**
- `npm run lint && npm run typecheck && npm test && npm run build` -- expected: all exit 0
- `DATABASE_URL=file:<scratch>/v.db npx prisma migrate deploy` -- expected: three migrations applied
- `npm run dev` with synthetic auth env and a scratch `DATABASE_URL`; log in via curl, create a Depot and a trade through the actions or ledger, then fetch `/depots/<id>` -- expected: Buchungen tab texts from the ACs

**Manual checks (if no CLI):**
- The dialog is full-screen below `sm`, Esc closes it, Enter submits.

## Auto Run Result

Status: done (follow-up review pass)

**Summary:** Buys and sells can be recorded: `Security`/`Transaction` models and migration `20261025143146_add_security_and_transaction`, ledger `ensureSecurity`/`listSecurities`/`recordTrade`/`listTransactions` with the sell guard, pure core helpers (German decimal input, business dates, sellable quantity, month label), the "Neue Buchung" dialog and the Depot detail tabs with a month-grouped Transactions table. This follow-up pass reviewed the full change since `72310594817ce74577c6f33bf0dd9d3fc607195d` with four reviewers and applied five small patches.

**Files changed in this pass:**
- `src/modules/ledger/transactions.test.ts` -- test: SELL via `{ new }` with an existing ISIN (oversell `available: "10"`, then a valid sell to the same Security).
- `src/app/_actions/transactions.test.ts` -- field-error row: `AAPL` with Aktie gives `isin-invalid`.
- `src/app/(app)/depots/[id]/page.test.tsx` -- unknown `?tab=` asserts Buchungen is the selected tab.
- `src/app/_components/transactions/TransactionDialog.tsx` -- unused `variant` prop removed; type error linked to the toggle group via `aria-describedby`.

**Review findings:** 32 (high 0, medium 0, low 22, false 9, maybe-false 1).
- Patches applied: 5 entries (6 rows), all low — see the triage log.
- Deferred: none new (DW-2, the React 19 form reset question, stays with the orchestrator).
- Rejected: 26, each with its reason in the triage log (9 false; 16 low not worth a guard or outside the spec'd rules; 1 maybe-false that would only be low).

**Follow-up review recommendation:** false. Follow-up pass, patched by verdict: high 0, medium 0, low 5 — the work has converged.

**Verification:**
- `npm run lint && npm run typecheck && npm test && npm run build` exit 0; 32 files / 356 tests passed (build with a scratch `DATABASE_URL`).
- `prisma migrate deploy` against a fresh scratch DB applied all migrations.
- Mutation check: setting the `{ new }` lookup in `recordTrade` to `null` fails the new ledger test.

**Residual risks:**
- The client dialog is still not exercised in a browser or DOM test (full-screen on phone, Esc/Enter, Autocomplete filter, values kept after an error — DW-2).
- The default Datum comes from the server render and can be a day old if the page stays open past Berlin midnight.
- `deferred-work.md` and `sprint-status.yaml` carry orchestrator-owned working-tree changes that this run leaves uncommitted on purpose.
