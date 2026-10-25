import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";
import { createTestDatabase, type TestDatabase } from "../../../../test/helpers/test-db";
import { createDepot } from "@/modules/ledger";
import {
  confirmParqetMigration,
  correctionDraft,
  EMPTY_DECISIONS,
  initialDecisions,
  type MigrationDecisions,
  openDecisions,
  type MigrationSummary,
  type ParqetPreview,
  previewParqetMigration,
} from "@/modules/migration";
import { OpeningBalanceForm } from "./OpeningBalanceForm";
import { ParqetDecisions } from "./ParqetDecisions";
import { ConfirmBar, ParqetMigrationWizard, ParqetPreviewView } from "./ParqetMigrationWizard";
import { ParqetSummaryView } from "./ParqetSummaryView";

const FIXTURE = readFileSync(resolve(__dirname, "../../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");
const NO_CASH = readFileSync(resolve(__dirname, "../../../../test/fixtures/parqet/synthetic-export-no-cash.csv.txt"), "utf8");
const HANDS_OFF = readFileSync(resolve(__dirname, "../../../../test/fixtures/parqet/synthetic-export-hands-off.csv.txt"), "utf8");

const DECIDED: MigrationDecisions = EMPTY_DECISIONS;

let testDb: TestDatabase;
let preview: ParqetPreview;
/** Preview of the same file after it was booked: duplicates and a recorded ISIN change. */
let rerun: ParqetPreview;
let summary: MigrationSummary;
let noCashSummary: MigrationSummary;
/** Preview of the hands-off fixture into an empty Depot. */
let handsOff: ParqetPreview;

beforeAll(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  const other = await createDepot({ name: "Zweitdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  const empty = await createDepot({ name: "Fondsdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  if (!depot.ok || !other.ok || !empty.ok) throw new Error("setup failed");
  const fresh = await previewParqetMigration(empty.depot.id, HANDS_OFF, testDb.client);
  if (!fresh.ok) throw new Error(fresh.reason);
  handsOff = fresh.preview;
  const result = await previewParqetMigration(depot.depot.id, FIXTURE, testDb.client);
  if (!result.ok) throw new Error(result.reason);
  preview = result.preview;
  const confirmed = await confirmParqetMigration(depot.depot.id, FIXTURE.replace(";436,77;", ";436,79;"), DECIDED, testDb.client);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  summary = confirmed.summary;
  const again = await previewParqetMigration(depot.depot.id, FIXTURE, testDb.client);
  if (!again.ok) throw new Error(again.reason);
  rerun = again.preview;
  const noCash = await confirmParqetMigration(
    other.depot.id,
    NO_CASH,
    { classifications: { IE00B4L5Y983: "ETF" }, flags: {}, duplicates: {} },
    testDb.client,
  );
  if (!noCash.ok) throw new Error(noCash.reason);
  noCashSummary = noCash.summary;
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("ParqetPreviewView", () => {
  it("shows the preview in German with de-DE formats and no confirm button", () => {
    const text = renderText(<ParqetPreviewView preview={preview} />);
    expect(text).toContain("Vorschau – Hauptdepot, Stand 03.07.2024");
    expect(text).toContain("Es wurde noch nichts gebucht.");
    expect(text).toContain("Rundung angeglichen: 1");
    expect(text).toContain("Kauf 4 Verkauf 1 Dividende 1 Steuer 1 Einzahlung 2 Auszahlung 1");
    expect(text).toContain("Keine Splits erkannt.");
    expect(text).toContain(
      "02.05.2024: Altname Software SE (DE0007164600) → Neuname Software SE (DE000SYN0013), 12,00345678 : 6,00172839",
    );
    expect(text).not.toContain("bereits erfasst");
    expect(text).toContain("Einlieferungen");
    expect(text).toContain("03.07.2024: Welt ETF (IE00B4L5Y983), 3 Stück, 300,00\u00a0€");
    // Flagged rows are listed with the decisions, not in the preview.
    expect(text).not.toContain("Keine Euro-Buchung");
    expect(text).toContain("Neuname Software SE DE000SYN0013 Art (geschätzt) Aktie ETF Fonds Zertifikat");
    expect(text).not.toContain("Bitte wählen");
    expect(text).toContain("Bitcoin BTC Krypto");
    expect(text).toContain("Apfel \"Tech\" Inc.; Class A 5 62,23\u00a0€");
    expect(text).toContain("Bitcoin 0,00012345 4,94\u00a0€");
    expect(text).toContain("Welt ETF 3 300,00\u00a0€");
    expect(text).toContain("Ergebnis laut Datei am 03.07.2024");
    expect(text).toContain("Investiertes Kapital 1.568,50\u00a0€");
    expect(text).toContain("Verrechnungskonto 9.142,67\u00a0€");
    expect(text).not.toContain("Übernehmen");
  });

  it("preselects each new Security's estimated type, or its override", () => {
    const html = renderHtml(<ParqetPreviewView preview={preview} />);
    expect(html).toMatch(/aria-label="Art von Welt ETF"[^>]*>(<option[^>]*>[^<]*<\/option>)*?<option value="ETF" selected=""/);
    const overridden = renderHtml(
      <ParqetPreviewView
        preview={preview}
        classification={{ decisions: { ...EMPTY_DECISIONS, classifications: { IE00B4L5Y983: "FUND" } }, onChange: () => {} }}
      />,
    );
    expect(overridden).toMatch(/aria-label="Art von Welt ETF"[^>]*>(<option[^>]*>[^<]*<\/option>)*?<option value="FUND" selected=""/);
  });

  it("marks an ISIN change that is already recorded and an existing Security with a chip", () => {
    const text = renderText(<ParqetPreviewView preview={rerun} />);
    expect(text).toContain("6,00172839 · bereits erfasst, wird nicht erneut gebucht");
    expect(text).toContain("Welt ETF IE00B4L5Y983 · bereits vorhanden ETF");
  });

  it("shows the hands-off fixture's split, five deliveries and estimated fund/ETF/ETC types", () => {
    const text = renderText(<ParqetPreviewView preview={handsOff} />);
    expect(text).toContain("01.06.2021: Synthetik Maschinenbau AG (DE000SYNS010), Verhältnis 1:4 (10 → 40 Stück)");
    expect(text).toContain("09.01.2020: Fidelity Funds - USD Bond Fund (LU000SYNF033), 100 Stück, 1.000,00\u00a0€");
    expect(handsOff.deliveries).toHaveLength(5);
    // Zero open decisions: "Übernehmen" is enabled immediately.
    const open = openDecisions(handsOff, initialDecisions(handsOff)).length;
    expect(open).toBe(0);
    expect(renderHtml(<ConfirmBar openCount={open} pending={false} onConfirm={() => {}} />)).not.toMatch(/<button[^>]*disabled=""/);
    const html = renderHtml(<ParqetPreviewView preview={handsOff} />);
    for (const [name, type] of [
      ["AB SICAV I Concentrated US Equity Portfolio", "FUND"],
      ["Xtrackers Physical Gold ETC", "ETF"],
      ["Synthetik Maschinenbau AG", "STOCK"],
    ]) {
      expect(html).toMatch(new RegExp(`aria-label="Art von ${name}"[^>]*>(<option[^>]*>[^<]*</option>)*?<option value="${type}" selected=""`));
    }
  });
});

describe("ParqetDecisions", () => {
  const noop = () => {};

  it("collapses flagged rows under 'Nicht übernommen (n)', skipped by default, with the as-is action", () => {
    const html = renderHtml(<ParqetDecisions preview={preview} decisions={initialDecisions(preview)} onChange={noop} onConfirmAsIs={noop} />);
    const text = renderText(<ParqetDecisions preview={preview} decisions={initialDecisions(preview)} onChange={noop} onConfirmAsIs={noop} />);
    expect(text).toContain("Nicht übernommen (5)");
    expect(text).toContain("Alle wie in Parqet übernehmen");
    expect(html).toMatch(/aria-expanded="false"/);
    expect(text).not.toContain("Neue Wertpapiere einordnen");
    expect(text).toContain("Zeile 8 – Keine Euro-Buchung (Währung USD)");
    expect(text).toContain("2024-07-01T09:00:00.000Z · Buy · Security · US5949181045 · Fenster Corp. · Stück 1 · Kurs 10 · Betrag 10");
    expect(text).toContain("Überspringen Korrigiert buchen");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Überspringen/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Alle wie in Parqet/);
    expect(text).toContain("Keine Doppelbuchungen im Depot gefunden.");
  });

  it("disables the as-is action without a handler and hides the section without flags", () => {
    expect(renderHtml(<ParqetDecisions preview={preview} decisions={initialDecisions(preview)} onChange={noop} />)).toMatch(
      /<button[^>]*disabled=""[^>]*>Alle wie in Parqet/,
    );
    expect(renderText(<ParqetDecisions preview={handsOff} decisions={initialDecisions(handsOff)} onChange={noop} />)).not.toContain(
      "Nicht übernommen",
    );
  });

  it("shows inline correction fields prefilled from the raw row", () => {
    const flag = preview.flagged.find((f) => f.records[0] === 8)!;
    const decisions: MigrationDecisions = { ...initialDecisions(preview), flags: { 8: { action: "book", correction: correctionDraft(flag) } } };
    const html = renderHtml(<ParqetDecisions preview={preview} decisions={decisions} onChange={noop} />);
    const text = renderText(<ParqetDecisions preview={preview} decisions={decisions} onChange={noop} />);
    expect(text).toContain("Buchungsart");
    expect(text).toContain("ISIN / Symbol");
    expect(text).toContain("Aktie ETF Fonds Zertifikat Krypto");
    expect(html).toContain('value="US5949181045"');
    expect(html).toContain('value="2024-07-01"');
    expect(html).toContain('value="10"');
  });

  it("lists duplicates with their matches, pre-set to skip", () => {
    const html = renderHtml(<ParqetDecisions preview={rerun} decisions={initialDecisions(rerun)} onChange={noop} />);
    const text = renderText(<ParqetDecisions preview={rerun} decisions={initialDecisions(rerun)} onChange={noop} />);
    expect(text).toContain("Mögliche Doppelbuchungen");
    expect(text).toContain("Zeile 24 – Einzahlung vom 02.01.2024, 10.000,00\u00a0€");
    expect(text).toContain("Zeile 6 – Kauf vom 03.07.2024, Welt ETF, 3 Stück, 300,00\u00a0€");
    expect(text).toContain("Mögliche Doppelbuchung: Diese Buchung gibt es bereits");
    expect(text).toContain("Überspringen Trotzdem buchen");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Überspringen/);
  });
});

describe("ConfirmBar", () => {
  it("shows the open count and disables Übernehmen while decisions are open or pending", () => {
    const open = renderHtml(<ConfirmBar openCount={3} pending={false} onConfirm={() => {}} />);
    expect(renderText(<ConfirmBar openCount={3} pending={false} onConfirm={() => {}} />)).toContain("Offene Entscheidungen: 3 Übernehmen");
    expect(open).toMatch(/<button[^>]*disabled=""[^>]*>Übernehmen/);
    const ready = renderHtml(<ConfirmBar openCount={0} pending={false} onConfirm={() => {}} />);
    expect(ready).not.toMatch(/<button[^>]*disabled=""/);
    expect(renderHtml(<ConfirmBar openCount={0} pending onConfirm={() => {}} />)).toMatch(/<button[^>]*disabled=""[^>]*>Wird gebucht/);
  });
});

describe("ParqetSummaryView", () => {
  it("reports booked and skipped counts and marks differences with text", () => {
    const text = renderText(<ParqetSummaryView summary={summary} />);
    expect(text).toContain("Übernommen – Hauptdepot");
    expect(text).toContain("Gebucht: 10 Buchungen, 0 Splits, 1 ISIN-Wechsel, 5 neue Wertpapiere.");
    expect(text).toContain(
      "Übersprungen: 0 Doppelbuchungen, 5 nicht übernommene Zeilen, 0 bereits erfasste Splits, 0 bereits erfasste ISIN-Wechsel.",
    );
    expect(text).toContain("Nicht übernommen (5)");
    expect(text).toContain("Zeilen 4, 5: Buchung und Barbuchung weichen um mehr als 0,01 € ab");
    expect(text).toContain("Zeile 8: Keine Euro-Buchung (Währung USD)");
    expect(text).toContain("Zum Depot Hauptdepot");
    expect(text).toContain("Abgleich mit Parqet am 03.07.2024");
    expect(text).toContain("1 × Abweichung über 0,01 €");
    expect(text).toContain("Apfel \"Tech\" Inc.; Class A 5 5 62,23\u00a0€ 62,23\u00a0€ gleich");
    expect(text).toContain("Investiertes Kapital 1.568,50\u00a0€ 1.568,50\u00a0€ gleich");
    expect(text).toContain("Verrechnungskonto 9.142,67\u00a0€ 9.142,67\u00a0€ gleich");
    expect(text).toContain("03.06.2024 Apfel \"Tech\" Inc.; Class A 436,77\u00a0€ 436,79\u00a0€ Abweichung");
    expect(text).not.toContain("Eröffnungsbuchung");
  });

  it("says cash could not be reconciled and offers the opening booking for a file without Cash rows", () => {
    const text = renderText(<ParqetSummaryView summary={noCashSummary} />);
    expect(text).toContain("Verrechnungskonto nicht abgeglichen: Die Datei enthält keine Barbuchungen.");
    expect(text).toContain("Eröffnungsbuchung");
    expect(text).toContain("Saldo im Depot am 02.05.2024: -1.200,00\u00a0€.");
    expect(text).toContain("Keine Abweichung über 0,01 €.");
    expect(text).not.toMatch(/€ Abweichung/);
    expect(text).not.toContain("Nicht übernommen");
  });
});

describe("OpeningBalanceForm", () => {
  it("prefills the earliest proposal date and limits it to the export date", () => {
    const html = renderHtml(<OpeningBalanceForm depotId="d" offer={{ date: "2024-02-01", asOf: "2024-05-02", ledgerBalance: "-1200" }} />);
    expect(html).toContain('value="2024-02-01"');
    expect(html).toContain('max="2024-05-02"');
    expect(renderText(<OpeningBalanceForm depotId="d" offer={{ date: "2024-02-01", asOf: "2024-05-02", ledgerBalance: "-1200" }} />)).toContain(
      "Saldo laut Broker am 02.05.2024",
    );
  });
});

describe("ParqetMigrationWizard", () => {
  it("renders the upload form with the Depots and no preview yet", () => {
    const text = renderText(<ParqetMigrationWizard depots={[{ id: "d1", name: "Hauptdepot" }]} />);
    expect(text).toContain("CSV-Datei wählen");
    expect(text).toContain("Ziel-Depot");
    expect(text).toContain("Hauptdepot");
    expect(text).toContain("Vorschau anzeigen");
    expect(text).not.toContain("Es wurde noch nichts gebucht.");
    expect(text).not.toContain("Offene Entscheidungen");
  });
});
