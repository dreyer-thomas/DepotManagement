import { describe, expect, it } from "vitest";
import { formatSplitRatio, splitErrorField, splitErrorMessage, type SplitErrorReason } from "./labels";

describe("split labels", () => {
  it.each<[SplitErrorReason, string, "ratio" | "date" | undefined]>([
    ["ratio-invalid", "Bitte ein Verhältnis wie 1:4 eingeben (ganze Zahlen größer 0, verschieden).", "ratio"],
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
