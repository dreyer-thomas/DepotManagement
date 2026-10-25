import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderText } from "../../../../test/helpers/render-text";
import { createTestDatabase, type TestDatabase } from "../../../../test/helpers/test-db";
import { createDepot } from "@/modules/ledger";
import { type ParqetPreview, previewParqetMigration } from "@/modules/migration";
import { ParqetMigrationWizard, ParqetPreviewView } from "./ParqetMigrationWizard";

const FIXTURE = readFileSync(resolve(__dirname, "../../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");

let testDb: TestDatabase;
let preview: ParqetPreview;

beforeAll(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "FINANZEN_ZERO" }, testDb.client);
  if (!depot.ok) throw new Error("setup failed");
  const result = await previewParqetMigration(depot.depot.id, FIXTURE, testDb.client);
  if (!result.ok) throw new Error(result.reason);
  preview = result.preview;
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
});

describe("ParqetMigrationWizard", () => {
  it("renders the upload form with the Depots and no preview yet", () => {
    const text = renderText(<ParqetMigrationWizard depots={[{ id: "d1", name: "Hauptdepot" }]} />);
    expect(text).toContain("CSV-Datei wählen");
    expect(text).toContain("Ziel-Depot");
    expect(text).toContain("Hauptdepot");
    expect(text).toContain("Vorschau anzeigen");
    expect(text).not.toContain("Es wurde noch nichts gebucht.");
  });
});
