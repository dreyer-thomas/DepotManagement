import { describe, expect, it } from "vitest";
import { depotErrorField, depotErrorMessage, type DepotErrorReason } from "./labels";

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
  ])("%s → %j on field %s", (reason, message, field) => {
    expect(depotErrorMessage(reason)).toBe(message);
    expect(depotErrorField(reason)).toBe(field);
  });
});
