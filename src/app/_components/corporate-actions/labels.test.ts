import { describe, expect, it } from "vitest";
import {
  formatIsinChangeRatio,
  formatSplitRatio,
  isinChangeErrorField,
  isinChangeErrorMessage,
  isinChangesOf,
  type IsinChangeErrorReason,
  type IsinChangeField,
  splitErrorField,
  splitErrorMessage,
  type SplitErrorReason,
} from "./labels";

describe("split labels", () => {
  it.each<[SplitErrorReason, string, "ratio" | "date" | undefined]>([
    ["ratio-invalid", "Bitte ein gültiges Verhältnis eingeben: Alt und Neu als ganze Zahlen größer 0, verschieden.", "ratio"],
    ["date-invalid", "Bitte ein gültiges Datum eingeben.", "date"],
    ["split-exists", "Für dieses Datum ist bereits ein Split erfasst.", "date"],
    ["security-not-found", "Security nicht gefunden.", undefined],
    ["split-not-found", "Split nicht gefunden.", undefined],
    ["unauthorized", "Sitzung abgelaufen. Bitte erneut anmelden.", undefined],
  ])("%s → %j on field %s", (reason, message, field) => {
    expect(splitErrorMessage(reason)).toBe(message);
    expect(splitErrorField(reason)).toBe(field);
  });

  it("names the SELL's date when a later sell would exceed the holding", () => {
    expect(splitErrorMessage("later-sell-exceeds-holding", "2024-05-01")).toBe(
      "Nicht möglich: Der Verkauf am 01.05.2024 würde den Bestand übersteigen.",
    );
    expect(splitErrorField("later-sell-exceeds-holding")).toBeUndefined();
  });

  it("formats a ratio", () => {
    expect(formatSplitRatio({ ratioOld: "10", ratioNew: "1" })).toBe("10:1");
  });
});

describe("ISIN-change labels", () => {
  it.each<[IsinChangeErrorReason, string, IsinChangeField | undefined]>([
    ["security-not-found", "Bitte eine Security auswählen oder neu anlegen.", "newSecurity"],
    ["same-security", "Die neue Security muss sich von der alten unterscheiden.", "newSecurity"],
    ["date-invalid", "Bitte ein gültiges Datum eingeben.", "date"],
    ["isin-change-exists", "Für dieses Datum ist bereits ein ISIN-Wechsel dieser Security erfasst.", "date"],
    ["old-quantity-invalid", "Bitte eine alte Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.", "oldQuantity"],
    ["new-quantity-invalid", "Bitte eine neue Stückzahl größer 0 mit höchstens 8 Nachkommastellen eingeben.", "newQuantity"],
    ["isin-change-not-found", "ISIN-Wechsel nicht gefunden.", undefined],
    ["isin-invalid", "Bitte eine gültige ISIN eingeben.", "securityIdentifier"],
    ["crypto-symbol-invalid", "Bitte ein gültiges Krypto-Symbol eingeben (bis 10 Buchstaben oder Ziffern).", "securityIdentifier"],
    ["security-name-invalid", "Bitte einen Namen mit höchstens 100 Zeichen eingeben.", "securityName"],
    [
      "asset-type-invalid",
      "Bitte eine passende Art wählen: Krypto braucht ein Krypto-Symbol, Aktie, ETF, Fonds und Zertifikat eine ISIN.",
      "assetType",
    ],
    ["unauthorized", "Sitzung abgelaufen. Bitte erneut anmelden.", undefined],
  ])("%s → %j on field %s", (reason, message, field) => {
    expect(isinChangeErrorMessage(reason)).toBe(message);
    expect(isinChangeErrorField(reason)).toBe(field);
  });

  it("names the SELL's date when a later sell would exceed the holding", () => {
    expect(isinChangeErrorMessage("later-sell-exceeds-holding", "2024-05-01")).toBe(
      "Nicht möglich: Der Verkauf am 01.05.2024 würde den Bestand übersteigen.",
    );
    expect(isinChangeErrorField("later-sell-exceeds-holding")).toBeUndefined();
  });

  it("formats the ratio with de-DE quantities", () => {
    expect(formatIsinChangeRatio({ oldQuantity: "10", newQuantity: "2.5" })).toBe("10 : 2,5");
  });
});

describe("isinChangesOf", () => {
  const security = (id: string) => ({ id, name: id, isin: null, cryptoSymbol: null, assetType: "STOCK" as const });
  const change = (id: string, oldId: string, newId: string) => ({
    id,
    oldSecurity: security(oldId),
    newSecurity: security(newId),
    date: "2024-03-01",
    oldQuantity: "1",
    newQuantity: "1",
  });

  it("lists changes where the Security is old or new", () => {
    const changes = [change("c1", "A", "B"), change("c2", "B", "C"), change("c3", "X", "Y")];
    expect(isinChangesOf(changes, "B").map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(isinChangesOf(changes, "Z")).toEqual([]);
  });
});
