import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderHtml, renderText } from "../../../../test/helpers/render-text";
import { createTestDatabase, type TestDatabase } from "../../../../test/helpers/test-db";
import { createDepot } from "@/modules/ledger";
import {
  confirmParqetMigration,
  correctionDraft,
  initialDecisions,
  type MigrationDecisions,
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

const DECIDED: MigrationDecisions = {
  classifications: { DE0007164600: "STOCK", DE000SYN0013: "STOCK", US0378331005: "STOCK" },
  flags: Object.fromEntries(["2", "3", "4-5", "6", "7", "8"].map((key) => [key, { action: "skip" as const }])),
  duplicates: {},
};

let testDb: TestDatabase;
let preview: ParqetPreview;
/** Preview of the same file after it was booked: duplicates and a recorded ISIN change. */
let rerun: ParqetPreview;
let summary: MigrationSummary;
let noCashSummary: MigrationSummary;

beforeAll(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  const other = await createDepot({ name: "Zweitdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  if (!depot.ok || !other.ok) throw new Error("setup failed");
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
    expect(text).toContain("Vorschau – Hauptdepot, Stand 10.06.2024");
    expect(text).toContain("Es wurde noch nichts gebucht.");
    expect(text).toContain("Rundung angeglichen: 1");
    expect(text).toContain("Kauf 3 Verkauf 1 Dividende 1 Steuer 1 Einzahlung 1 Auszahlung 1");
    expect(text).toContain(
      "02.05.2024: Altname Software SE (DE0007164600) → Neuname Software SE (DE000SYN0013), 12,00345678 : 6,00172839",
    );
    expect(text).not.toContain("bereits erfasst");
    expect(text).toContain("Zeile 2 – Nicht unterstützte Zeile (Buy/Cash)");
    expect(text).toContain("Zeilen 4, 5 – Buchung und Barbuchung weichen um mehr als 0,01 € ab");
    expect(text).toContain("Zeile 8 – Keine Euro-Buchung (Währung USD)");
    expect(text).toContain("Neuname Software SE DE000SYN0013 Typ unbekannt");
    expect(text).toContain("Bitcoin BTC Krypto");
    expect(text).toContain("Apfel \"Tech\" Inc.; Class A 5 62,23\u00a0€");
    expect(text).toContain("Bitcoin 0,00012345 4,94\u00a0€");
    expect(text).toContain("Ergebnis laut Datei am 10.06.2024");
    expect(text).toContain("Investiertes Kapital 1.268,50\u00a0€");
    expect(text).toContain("Verrechnungskonto 9.142,67\u00a0€");
    expect(text).not.toContain("Übernehmen");
  });

  it("marks an ISIN change that is already recorded", () => {
    expect(renderText(<ParqetPreviewView preview={rerun} />)).toContain("6,00172839 · bereits erfasst, wird nicht erneut gebucht");
  });
});

describe("ParqetDecisions", () => {
  const noop = () => {};

  it("asks to classify each new Security and to decide each flagged row with its raw text", () => {
    const text = renderText(<ParqetDecisions preview={preview} decisions={initialDecisions(preview)} onChange={noop} />);
    expect(text).toContain("Neue Wertpapiere einordnen");
    expect(text).toContain("Altname Software SE DE0007164600 Art Bitte wählen Aktie ETF Zertifikat");
    expect(text).not.toContain("Bitcoin BTC Art");
    expect(text).toContain("Zeile 6 – Wertpapier-Übertrag ohne passendes Gegenstück");
    expect(text).toContain("2024-07-03T06:00:00.000Z · TransferIn · Security · IE00B4L5Y983 · Welt ETF · Stück 3 · Kurs 0 · Betrag 300");
    expect(text).toContain("Überspringen Korrigiert buchen");
    expect(text).toContain("Keine Doppelbuchungen im Depot gefunden.");
  });

  it("shows inline correction fields prefilled from the raw row", () => {
    const flag = preview.flagged.find((f) => f.records[0] === 6)!;
    const decisions: MigrationDecisions = { ...initialDecisions(preview), flags: { 6: { action: "book", correction: correctionDraft(flag) } } };
    const html = renderHtml(<ParqetDecisions preview={preview} decisions={decisions} onChange={noop} />);
    const text = renderText(<ParqetDecisions preview={preview} decisions={decisions} onChange={noop} />);
    expect(text).toContain("Buchungsart");
    expect(text).toContain("ISIN / Symbol");
    expect(html).toContain('value="IE00B4L5Y983"');
    expect(html).toContain('value="2024-07-03"');
    expect(html).toContain('value="300"');
  });

  it("lists duplicates with their matches, pre-set to skip", () => {
    const html = renderHtml(<ParqetDecisions preview={rerun} decisions={initialDecisions(rerun)} onChange={noop} />);
    const text = renderText(<ParqetDecisions preview={rerun} decisions={initialDecisions(rerun)} onChange={noop} />);
    expect(text).toContain("Mögliche Doppelbuchungen");
    expect(text).toContain("Zeile 24 – Einzahlung vom 02.01.2024, 10.000,00\u00a0€");
    expect(text).toContain("Mögliche Doppelbuchung: Diese Buchung gibt es bereits");
    expect(text).toContain("Überspringen Trotzdem buchen");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Überspringen/);
    expect(text).toContain("Keine Wertpapiere einzuordnen.");
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
    expect(text).toContain("Gebucht: 8 Buchungen, 1 ISIN-Wechsel, 4 neue Wertpapiere.");
    expect(text).toContain("Übersprungen: 0 Doppelbuchungen, 6 markierte Zeilen, 0 bereits erfasste ISIN-Wechsel.");
    expect(text).toContain("Zum Depot Hauptdepot");
    expect(text).toContain("Abgleich mit Parqet am 10.06.2024");
    expect(text).toContain("1 × Abweichung über 0,01 €");
    expect(text).toContain("Apfel \"Tech\" Inc.; Class A 5 5 62,23\u00a0€ 62,23\u00a0€ gleich");
    expect(text).toContain("Investiertes Kapital 1.268,50\u00a0€ 1.268,50\u00a0€ gleich");
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
