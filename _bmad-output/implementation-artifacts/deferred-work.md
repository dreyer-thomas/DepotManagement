### DW-1: A server action POST without a valid session (e.g. "Abmelden" after the 7-day session expired) gets a 307 to /login from the proxy, which the client-side action fetch may not handle as a navigation.
origin: spec-deferred 07c043545a5b
location: src/proxy.ts:28
source_spec: `spec-1-2-single-user-login.md`
reason: Verified: POST /depots with a Next-Action header and no cookie returns 307 to /login?next=%2Fdepots (next start). Unverified: what the Next 16 client does with that 307 for a server action. Settle by letting the session expire in a browser, clicking "Abmelden" (or any later action), and observing whether the login page appears or an "unexpected response" error is thrown; if broken, answer action requests (Next-Action header) with a response the client can follow, plus a test.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-server-action-expired-session
resolution-undo: 3b76023f2b0b0b2d631daef50add2aec1251c6c0e559bcb7c89d6a6a2aecc0d1 2026-10-25 7374617475733a206f70656e

### DW-2: The "Neue Buchung" form may lose some entered values after an error, if React 19's automatic form reset after an action also affects the MUI Select or Autocomplete inputs.
origin: spec-deferred 45744b75451b
location: src/app/_components/transactions/TransactionDialog.tsx
source_spec: `spec-1-4-record-buys-and-sells.md`
reason: maybe-false: every input is controlled (useState), and the same pattern is used in DepotDialogs (story 1.3), but no browser or DOM test has confirmed it. Settle by opening the dialog in a browser, submitting with an invalid quantity (e.g. "0") after filling every field including a new Security and Art, and checking that all values are still there.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-dom-interaction-tests
resolution-undo: 17f0210f0023af624bf7db71d1e320d9982e80c89cb126f806ffddb66f7113c7 2026-10-25 7374617475733a206f70656e

### DW-3: Archive confirmation dialog and Reaktivieren button have no interaction tests (open, close on success, error Alert, initial focus on Abbrechen).
origin: spec-deferred ee53c8b1a4bb
location: src/app/_components/depots/DepotDialogs.tsx
source_spec: `spec-1-8-archive-depots.md`
severity: low
reason: vitest runs in the node environment with renderToStaticMarkup only; no jsdom/happy-dom/testing-library/playwright in the repo, so no test mounts ArchiveDepotButton/UnarchiveDepotButton. Inverting `if (result?.ok) onClose()`, dropping the failure Alert or removing the onEntered focus hook would pass npm test. The existing Create/Rename dialogs share the gap. Verified manually in a headless browser on 2026-10-25.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-dom-interaction-tests
resolution-undo: 17f0210f0023af624bf7db71d1e320d9982e80c89cb126f806ffddb66f7113c7 2026-10-25 7374617475733a206f70656e

### DW-4: SplitDialog (and the split list it filters per Security) has no interaction test; only static server rendering, server actions and labels are tested.
origin: spec-deferred 0dab824ad297
location: src/app/_components/corporate-actions/SplitDialog.tsx
source_spec: `spec-2-1-record-stock-splits.md`
severity: low
reason: No jsdom/happy-dom/testing-library in the repo (same tooling gap as DW-3). Passing splits={[]} or inverting the `own` filter in SplitDialog.tsx would pass npm test and make split edit/delete unreachable in the UI. Settle by adding DOM test tooling or extracting the list rendering into a server-renderable, testable piece.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-dom-interaction-tests
resolution-undo: 17f0210f0023af624bf7db71d1e320d9982e80c89cb126f806ffddb66f7113c7 2026-10-25 7374617475733a206f70656e

### DW-5: IsinChangeDialog and the "Corporate Action → ISIN-Wechsel" menu item have no interaction test; only labels, the listing filter, server actions, ledger and static page rendering are tested.
origin: spec-deferred d60c8cad56a3
location: src/app/_components/corporate-actions/IsinChangeDialog.tsx
source_spec: `spec-2-2-record-isin-changes.md`
severity: low
reason: No jsdom/happy-dom/testing-library in the repo (same tooling gap as DW-3/DW-4). PositionsTable.test.tsx only counts the "Aktionen für …" buttons; the closed MUI Menu items and the dialog (record/edit/delete, error-to-field mapping) are never rendered in tests. Settle by adding DOM test tooling.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-dom-interaction-tests
resolution-undo: 17f0210f0023af624bf7db71d1e320d9982e80c89cb126f806ffddb66f7113c7 2026-10-25 7374617475733a206f70656e

### DW-6: ParqetMigrationWizard's failure Alert, pending label and preview mounting after submit have no interaction test; the browser chain file input → server action → rendered preview is checked only in
origin: spec-deferred cfba07821055
location: src/app/_components/migration/ParqetMigrationWizard.tsx
source_spec: `spec-2-3-parqet-export-preview.md`
severity: low
reason: ParqetMigrationWizard.test.tsx renders only the initial null state; ParqetPreviewView and previewFailureMessage are tested on their own; the action is tested with hand-built FormData. vitest runs in the node environment and no DOM testing library is installed (same tooling gap as the corporate-action dialogs). Settle by adding DOM test tooling.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-dom-interaction-tests
resolution-undo: 17f0210f0023af624bf7db71d1e320d9982e80c89cb126f806ffddb66f7113c7 2026-10-25 7374617475733a206f70656e

### DW-7: The wizard's client flow (re-send of file/Depot/decisions on "Übernehmen", decisions carried over after decisions-open, reset on file/Depot change, opening-balance submit) has no interaction test;
origin: spec-deferred d1e27822026b
location: src/app/_components/migration/ParqetMigrationWizard.tsx
source_spec: `spec-2-4-confirm-migration-and-reconcile-with-parqet.md`
severity: low
reason: ParqetMigrationWizard.test.tsx renders ConfirmBar, ParqetDecisions, ParqetSummaryView and OpeningBalanceForm statically with fixed props; no handler runs. vitest runs in the node environment and no DOM testing library is installed (same tooling gap as DW-3..DW-6). Breaking confirm() (e.g. sending empty decisions or dropping carryDecisions) would pass npm test. Settle by adding DOM test tooling.
status: done 2026-10-25
resolution: resolved by sweep bundle dw-dom-interaction-tests
resolution-undo: 17f0210f0023af624bf7db71d1e320d9982e80c89cb126f806ffddb66f7113c7 2026-10-25 7374617475733a206f70656e

### DW-8: An unrelated Cash DEPOSIT/WITHDRAWAL sharing an instant with a mismatching leftover trade is absorbed into the group and booked as part of a difference TAX instead of a deposit.
origin: spec-deferred 609911afaaf4
location: src/modules/migration/parqet-reader.ts (phase 2 grouping)
source_spec: `spec-2-7-robust-cash-pairing-and-rounding-tolerance-in-the-parqet-mig.md`
severity: medium
reason: parqet-reader.ts phase 2 adds every unused cash row of the instant to the group (as the AC's "remaining trades and cash rows of the group are reconciled together" prescribes). Date-only events carry synthetic times (00:00Z/06:00Z), so a mismatching dividend and a deposit on the same day can share an instant. Cash balance still matches; the inflow is classified as tax refund (affects TTWROR/XIRR and tax totals). Visible before booking via the "Kontodifferenzen … (Summe …)" note. Separating them needs an intent decision (heuristic); settle with the operator's real-data migration (story 2.4).
status: done 2026-10-25
resolution: closed by human decision: Operator confirmed the real migration (756b381) without reported misclassification; the migration is one-off.
decision: 2026-10-25 Close as moot after real-data migration — Operator confirmed the real migration (756b381) without reported misclassification; the migration is one-off.

### DW-9: A trade with no cash row at its instant in a file that has Cash rows gets no difference TAX, so the Cash Account would not follow Parqet's cash rows there.
origin: spec-deferred 5deaeedd1fe9
location: src/modules/migration/parqet-reader.ts (phase 2, group.cash.length === 0)
source_spec: `spec-2-7-robust-cash-pairing-and-rounding-tolerance-in-the-parqet-mig.md`
reason: Spec requires >= 1 unused cash row for phase 2 (unchanged 2.3-2.6 behavior). Unknown whether real ROBIN / finanzen.net zero exports contain such trades; the correct-course analysis listed none. Settle by the operator's real-data migration: a cash mismatch in the 2.4 reconciliation would reveal it.
status: done 2026-10-25
resolution: closed by human decision: Operator confirmed the real migration (756b381) with no Verrechnungskonto Abweichung, so no such trade showed up; the migration is one-off.
decision: 2026-10-25 Close as moot after the confirmed real-data migration — Operator confirmed the real migration (756b381) with no Verrechnungskonto Abweichung, so no such trade showed up; the migration is one-off.

### DW-10: The summary's "Parqet" cash figure is the proposals' balance minus funding, not the literal sum of the file's Cash rows, so a trade without any Cash row at its instant is hidden from the cash
origin: spec-deferred f78be9e85d01
location: src/modules/migration/confirm.ts (cash comparison)
source_spec: `spec-2-8-missing-deposits-and-fee-aware-gain-comparison-in-the-parqet.md`
reason: confirm.ts derives the file figure from preview.figures.cashBalance (proposals) minus the funding total; the explanation check reduces to |ledger − proposals' balance|. Story 2.7 already compared against the proposals' balance (pre-existing), and its deferred item "trade with no cash row gets no difference TAX" is the same gap. Settle with the operator's real-data migration (story 2.4): compare the summary's Parqet figure with Parqet's displayed balance.
status: done 2026-10-25
resolution: closed by human decision: Operator confirmed the real migration (756b381) with no Verrechnungskonto Abweichung; the migration is one-off and the gap is the same as DW-9.
decision: 2026-10-25 Close as moot after the confirmed real-data migration — Operator confirmed the real migration (756b381) with no Verrechnungskonto Abweichung; the migration is one-off and the gap is the same as DW-9.
