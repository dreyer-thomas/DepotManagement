import { describe, expect, it } from "vitest";
import {
  deleteConfirmationMatches,
  deleteDepotQuestion,
  depotErrorField,
  depotErrorMessage,
  type DepotErrorReason,
} from "./labels";

describe("depot error labels", () => {
  it.each<[DepotErrorReason, string, "name" | "broker" | undefined]>([
    ["name-empty", "Bitte einen Namen eingeben.", "name"],
    ["name-too-long", "Höchstens 60 Zeichen.", "name"],
    ["name-taken", "Ein Depot mit diesem Namen gibt es bereits.", "name"],
    ["broker-invalid", "Bitte einen Broker wählen.", "broker"],
    ["not-found", "Depot nicht gefunden.", undefined],
    ["depot-not-flat", "Depot hat noch Positionen oder Guthaben.", undefined],
    ["depot-archived", "Depot ist archiviert. Bitte zuerst reaktivieren.", undefined],
    ["unauthorized", "Sitzung abgelaufen. Bitte erneut anmelden.", undefined],
    ["name-mismatch", "Der eingegebene Name stimmt nicht mit dem Depotnamen überein.", undefined],
  ])("%s → %j on field %s", (reason, message, field) => {
    expect(depotErrorMessage(reason)).toBe(message);
    expect(depotErrorField(reason)).toBe(field);
  });
});

describe("delete depot labels", () => {
  it("states the number of Transactions in singular and plural", () => {
    expect(deleteDepotQuestion("Hauptdepot", 1)).toBe(
      "Depot „Hauptdepot“ mit 1 Buchung endgültig löschen? Das kann nicht rückgängig gemacht werden.",
    );
    expect(deleteDepotQuestion("Hauptdepot", 0)).toBe(
      "Depot „Hauptdepot“ mit 0 Buchungen endgültig löschen? Das kann nicht rückgängig gemacht werden.",
    );
    expect(deleteDepotQuestion("Hauptdepot", 7)).toBe(
      "Depot „Hauptdepot“ mit 7 Buchungen endgültig löschen? Das kann nicht rückgängig gemacht werden.",
    );
  });

  it("matches only the exact name (trimmed, NFC)", () => {
    expect(deleteConfirmationMatches(" Hauptdepot ", "Hauptdepot")).toBe(true);
    expect(deleteConfirmationMatches("Mu\u0308nchen", "M\u00fcnchen")).toBe(true);
    expect(deleteConfirmationMatches("hauptdepot", "Hauptdepot")).toBe(false);
    expect(deleteConfirmationMatches("Hauptdepo", "Hauptdepot")).toBe(false);
    expect(deleteConfirmationMatches("", "Hauptdepot")).toBe(false);
  });
});
