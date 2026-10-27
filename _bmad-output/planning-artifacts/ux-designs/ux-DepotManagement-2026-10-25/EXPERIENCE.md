---
name: DepotManagement
status: final
updated: 2026-10-25
sources:
  - _bmad-output/specs/spec-DepotManagement/SPEC.md
  - _bmad-output/planning-artifacts/prds/prd-DepotManagement-2026-10-25/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-DepotManagement-2026-10-25/ARCHITECTURE-SPINE.md
---

# DepotManagement — Experience Spine

## Foundation

Single-surface responsive web app, MUI 9 on Next.js (App Router), one user (Tommy). Desktop is the primary surface for Document Import, migration and bookkeeping; the phone browser is for checking in (UJ-1) and quick manual entries. `[ASSUMPTION]` `DESIGN.md` is the visual identity reference; MUI defaults govern every behavior not specified here. UI language German, de-DE number and date formats. `[ASSUMPTION]` Terms follow the spec glossary (Depot, Position, Transaction, Cash Account, Period).

## Information Architecture

| Surface | Reached from | Purpose | Capabilities |
| --- | --- | --- | --- |
| Login | Any URL without session | Single-user sign-in | NFR auth |
| Overview | App open, nav | Portfolio KPIs, value chart, per-Depot list, composition, top news | CAP-10..13, 18, 14 |
| Depot detail | Overview Depot row, nav "Depots" | Depot KPIs and chart (chart tabs Wertentwicklung · Drawdown); tabs: Positions · Cash Account · Transactions · Composition | CAP-1, 10..13, 17, 18 |
| Security detail | Positions row, top Positions, Securities row, Transaction row | One page per Security across Depots (switcher "Alle Depots" / single Depot), also for Securities no longer held: header, hero with chart toggle "Kurs" (buy/sell markers) / "Wert" / "Performance" (Position TTWROR %) / "Drawdown" (price drawdown, split-neutral), optional moving average on "Kurs", KPIs, card "Performance-Heatmap" (Q | M, link to Analysen › Rendite), card "Gesamt seit Erstkauf", FIFO lots per Depot, Transactions with Depot, news | CAP-7, 8, 12, 14, 19 |
| Transaction form | FAB / "Neue Buchung" on any Depot surface; row click to edit | Add, edit, delete a Transaction of any type | CAP-2, 17 |
| Corporate action form | Security detail menu | Record split or ISIN change | CAP-3 |
| Depot reconciliation | Depot detail ⋮ "Depot abgleichen" | Statement date; rows per Position + Cash Account with app value, statement input, "stimmt" check, ✅ when matched; differing rows: difference, "Buchungen ansehen", "Korrektur buchen" (Bestandskorrektur); progress "x von y abgeglichen"; open run persists until "Abgleich abschließen"; Depot detail shows "Zuletzt abgeglichen am …" | CAP-20 |
| Import | Depot detail action "Dokumente importieren", nav | Upload PDFs → review batch → confirm | CAP-4..6 |
| News | Nav | Headlines last 14 days, filter by Security; items with a teaser expand in place (teaser, source, date, "Zum Artikel"), others open the article | CAP-14 |
| Analysen | Nav (drawer; "Mehr" on phones) | Tabs Aufteilung (donut per dimension, tap segment → Positions), Rendite (heatmap years × months, tap cell → details), Gewinne (realized gains bars, best/worst sales, Kapitalfluss), Dividenden (Monatlich pro Jahr as bars stacked by Security with segment hover and a year switcher ‹ Jahr › in the card header, Jahre, Akkumuliert, Akkumuliert pro Jahr with Prognose switch, Wertpapiere, Erwartet; gross/net, 12-month income); scope Portfolio or Depot | CAP-21, CAP-22 |
| Securities | Nav "Mehr" | All Securities: classify `UNCLASSIFIED`, edit provider mapping, enter manual Prices, trigger price refresh, replace or upload a logo | CAP-7, 9 |
| Settings | Nav "Mehr" | Depots (create, rename, archive, delete with typed name confirmation), Parqet migration, export/restore, appearance | CAP-1, 15, 16 |
| Parqet migration | Settings | One-time wizard per Depot: file → target Depot → preview/review → confirm | CAP-15 |

One global **Period selector** (1M · YTD · 1J · 3J · Max · Benutzerdefiniert) lives in the page header of Overview, Depot detail and Security detail; the choice persists across those surfaces and sessions. On Overview and Depot detail the value chart has tabs **Wertentwicklung · Drawdown**: Drawdown is a red area below 0 % (decline of the time-weighted index from its running peak in the Period) with KPIs Aktueller Drawdown, Maximaler Drawdown, Dauer (days) and Periode (dates of the maximum phase). `[ASSUMPTION: 3J added between 1J and Max]` Archived Depots appear only in a collapsed "Archiviert" group on the Depots list and are read-only.

Dialogs stack one level deep at most.

→ Composition reference: [mockups/overview-desktop.html](mockups/overview-desktop.html), [mockups/position-phone.html](mockups/position-phone.html), [mockups/import-review.html](mockups/import-review.html). All other surfaces are built from this spine alone. Spines win on conflict with mockups.

## Voice and Tone

Microcopy is German, short, factual, numbers first.

| Do | Don't |
| --- | --- |
| "3 Dateien erkannt, 1 Duplikat, 1 fehlgeschlagen" | "Super! Wir haben deine Dateien verarbeitet 🎉" |
| "Kurs vom 21.10.2026 – veraltet" | "Achtung! Daten möglicherweise ungenau!" |
| "Layout nicht erkannt. Buchung bitte manuell erfassen." | "Ein unerwarteter Fehler ist aufgetreten." |
| "12 Buchungen gebucht." | "Vorgang erfolgreich abgeschlossen." |
| Name the Depot and Security in confirmations | Generic "Element", "Eintrag" |

## Component Patterns

Behavioral; visual specs in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
| --- | --- | --- |
| Hero card + KPI row | Overview, Depot, Position | Hero: total value, gain/loss pill (amount + TTWROR), XIRR beside it, area chart for the Period. KPI row: invested capital · dividends · cash · taxes paid (Period). Realized/unrealized split one tap away (expand on hero). Values reflect the Period selector. |
| Area chart | Overview, Depot, Position (in hero card) | Value (filled area) and invested capital (dashed) over the Period; crosshair/tap tooltip shows date, value, invested capital. Days with carried-forward Prices are not marked individually. |
| Security logo | Every Security mention | Logo before the name, always served from the local logo cache (fetched once in the background: logo.dev, fallback Elbstream; certificates show issuer or underlying logo; crypto falls back to CoinGecko). Missing logo shows initials immediately, never a broken image or layout shift. A manually uploaded logo always wins. |
| Positions table | Depot detail, Overview (top Positions) | Columns: logo + Security, quantity, price (+ stale badge), value, Gain/Loss abs/%, share. Sortable, default by value desc. Cash Account row pinned at the bottom, visually distinct. Phone: stacked rows (name, value, Gain/Loss). |
| Transaction list | Depot detail, Security detail | Newest first, grouped by month; type icon, Security, quantity, amount, cash effect. Row click opens the form in edit mode. |
| Transaction form | Dialog (desktop), full-screen page (phone) | Type first; fields adapt to type (BUY/SELL: Security, date, quantity, price, fee, tax; DIVIDEND: Security, amount, tax; FEE/TAX: value; DEPOSIT/WITHDRAWAL: amount). Security via Autocomplete on ISIN or name; unknown ISIN offers "Neue Security anlegen". Shows the computed cash effect live. On save a possible duplicate shows an inline warning requiring explicit "Trotzdem buchen". Delete asks for confirmation. |
| Import review table | Import | One section per file with status chip; proposals editable inline; per proposal: book / discard. Ambiguous duplicates require a decision before "Buchen" is enabled. Failed files show reason and a "Manuell erfassen" link to the prefilled form. |
| Stale badge | Every price display | Appears when Price older than 3 days; tooltip shows source and fetch time. |
| Composition donut | Overview, Depot | Donut + legend list; toggle: by Position · by asset type (ETF · Fonds · Aktie · Zertifikat · Krypto · Guthaben) · by Depot (Overview only). By Position shows the top 8 and "Sonstige". Cash always its own segment. Tapping a legend row highlights the segment. |
| Price refresh | Securities, Overview menu | "Kurse aktualisieren" triggers on-demand fetch; button shows progress; result snackbar names failures. |
| Destructive confirm | Delete Transaction, archive Depot, restore | Dialog naming the object. Restore requires typing "WIEDERHERSTELLEN" and states that all data will be replaced and an automatic export is taken first. |

## State Patterns

| State | Surface | Treatment |
| --- | --- | --- |
| First run, no Depots | Overview | Empty state: "Noch kein Depot." Actions: "Depot anlegen", "Aus Parqet übernehmen". |
| Depot without Transactions | Depot detail | "Noch keine Buchungen." Actions: new Transaction, import documents. |
| Loading | Any data surface | MUI Skeleton matching layout (KPI cards, chart block, table rows). |
| Stale Prices | Overview | If any held Security is stale, an Alert (warning) above KPIs: "Kurse für 2 Wertpapiere veraltet" linking to Securities. |
| Price fetch failed | Securities | Row-level error text with provider name; manual Price action offered. |
| Unclassified Security | Securities, Security detail | Info chip "Typ unbekannt"; Overview composition shows an "Unklassifiziert" segment until resolved. |
| Import in review | Import | Batch persists until confirmed or discarded; Import entry shows count of open batches. |
| Archive blocked | Settings → Depots | Archive action disabled with reason: "Depot hat noch Positionen oder Guthaben." |
| No news | News, Security detail | "Keine Nachrichten der letzten 14 Tage." |
| Session expired | Any | Redirect to Login, return to original URL after sign-in. |
| Server error on save | Forms | Form stays filled; error Alert in the form; retry possible. |

## Interaction Primitives

- Mouse/touch first; no custom keyboard shortcuts in v1 beyond MUI defaults (Enter submits, Esc closes dialogs). `[ASSUMPTION]`
- Upload: drag-and-drop zone plus file picker, multiple PDFs at once.
- Number inputs accept German decimal comma and paste of formatted amounts (`1.234,56`).
- Writes are not optimistic: the UI updates after the server confirms, since numbers must be correct.
- Banned: infinite scroll (paginate long Transaction lists by month), hover-only actions, auto-booking without review, modal stacks deeper than one.

## Accessibility Floor

- WCAG 2.2 AA on desktop and phone.
- Gain/Loss never by color alone: sign and arrow always present; stale state always has text.
- Charts have a text alternative: the KPI row states the same figures; tooltips are keyboard-reachable.
- All forms fully keyboard-operable; Tab order follows reading order; Esc closes the topmost dialog.
- Touch targets ≥ 44 px on phones.
- Tables use proper header semantics; stacked phone rows keep label–value pairs readable by screen readers.

## Responsive & Platform

| Breakpoint | Behavior |
| --- | --- |
| `≥ md` (900px+, MUI) | Permanent left drawer: Übersicht, Depots, Analysen, Import, Nachrichten, Wertpapiere, Einstellungen. KPI row in one line; chart and composition side by side on `lg`. Transaction form as dialog. |
| `< md` | Bottom navigation: Übersicht · Depots · Analysen · Nachrichten · Mehr (Import, Wertpapiere, Einstellungen). Action buttons use short labels on phones ("Neu", "Dokument"), the Period selector shows a calendar icon for "Benutzerdefiniert", and Position rows put the name on its own line. FAB "+" for a new Transaction on Overview and Depot detail. KPI cards in a 2×2 grid; tables become stacked rows; forms full-screen. Import and migration work but are optimized for desktop. |

## Inspiration & Anti-patterns

- **Kept from Parqet:** combined and per-Depot overview, Period selector on charts, Position list with Gain/Loss, attractive filled charts, company logos.
- **Rejected from Parqet:** silent autosync that books unreviewed; nothing enters the ledger without Tommy seeing it.
- **Rejected:** social features, gamification, upsell banners, decorative illustrations.

## Key Flows

### Flow 1 — Weekday evening check-in (UJ-1, Tommy on the sofa, phone)

1. Tommy opens DepotManagement in the phone browser; the session is still valid.
2. Overview loads: total value, invested capital, Gain/Loss and cash across all three Depots; no stale alert.
3. He switches the Period selector to "1J"; KPIs, TTWROR/XIRR and the chart update together.
4. In the Depot list he sees comdirect moved most and taps it.
5. Depot detail opens on the Positions tab, sorted by value; he taps the largest Position.
6. **Climax:** Security detail shows the 1-year chart, his FIFO Gain/Loss and the last 14 days of headlines for that Security on one screen — he reads two headlines and decides to hold, without opening a second app.

Failure: a Price is stale → stale badge with date on the Position and the Overview alert; values use the last known Price.

### Flow 2 — Month-end import (UJ-2, Tommy at his desk)

1. Tommy downloads the month's documents from the ROBIN postbox.
2. He opens Depot detail → "Dokumente importieren" and drops 14 PDFs onto the upload zone.
3. The review screen lists every file: 12 parsed, 1 duplicate (already booked last month), 1 failed ("Layout nicht erkannt").
4. Two savings-plan buys on the same day are marked ambiguous; he checks the amounts and books both.
5. He clicks "Buchen"; snackbar: "12 Buchungen gebucht."
6. **Climax:** Depot detail refreshes — new Positions, updated Cash Account balance, chart extended — in under ten minutes total. For the failed file he clicks "Manuell erfassen", gets a form prefilled with Depot and date, and enters the trade.

### Flow 3 — Manual trade (UJ-3, finanzen.net zero Depot)

1. Tommy taps "+" on the finanzen.net zero Depot.
2. Chooses "Kauf", types the ISIN; the Security is found by Autocomplete.
3. Enters date, quantity, price and fee; the form shows the cash effect "−1.004,90 €".
4. **Climax:** He saves; the Positions table and Cash Account balance reflect the buy immediately.

Failure: the ISIN is unknown → "Neue Security anlegen" creates it; type is asked (stock/ETF/certificate/crypto) and the provider mapping is resolved in the background.

### Flow 4 — One-time Parqet migration (CAP-15)

1. Before cancelling Parqet, Tommy exports one CSV per portfolio.
2. Settings → "Aus Parqet übernehmen": he uploads the first file and selects the target Depot.
3. Preview shows counts per type, detected splits, ISIN changes and deliveries, the estimated asset type per Security (optionally changeable), a collapsed "Nicht übernommen (n)" list, a note "Export ohne Kontobewegungen: N Einzahlungen werden ergänzt" when the export has no cash rows, notes "N fehlende Einzahlungen ergänzt", "N Kontodifferenzen als Steuer gebucht" and "N Rundungsreste ausgeglichen" when they apply, fee-only gain differences labelled "Gebühren", and the resulting Positions and cash balance as of the export date.
4. He clicks "Übernehmen" — no per-row decisions.
5. **Climax:** After confirming, the Depot shows the same Positions, invested capital and cash balance Parqet showed on export day; the summary lists the comparison against Parqet's `realizedgains`.

