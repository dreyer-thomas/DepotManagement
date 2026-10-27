import { describe, expect, it } from "vitest";
import { cashLeftText, enteredTargetSum, instrumentText, parseDepositParam, percentInputText, pointsText, SEGMENT_KEYS, SEGMENT_LABELS } from "./labels";
import { SEGMENTS } from "@/core/rebalancing";

describe("rebalancing labels", () => {
  it("labels every segment in core order", () => {
    expect(SEGMENT_KEYS).toEqual([...SEGMENTS]);
    expect(SEGMENT_LABELS.commodities).toBe("Gold/Rohstoffe");
    expect(SEGMENT_LABELS.cash).toBe("Geldmarkt/Cash");
  });

  it("parses ?deposit= (empty → 0, invalid → 0 with a hint)", () => {
    expect(parseDepositParam(undefined)).toEqual({ deposit: "0", invalid: false, text: "" });
    expect(parseDepositParam("1.000,50")).toEqual({ deposit: "1000.5", invalid: false, text: "1.000,50" });
    expect(parseDepositParam(["250", "1"])).toEqual({ deposit: "250", invalid: false, text: "250" });
    for (const raw of ["abc", "-5", "1,234"]) expect(parseDepositParam(raw)).toEqual({ deposit: "0", invalid: true, text: raw });
  });

  it("formats inputs, sums, points, instruments and the cash balance", () => {
    expect(percentInputText("60.5")).toBe("60,5");
    expect(percentInputText("0")).toBe("");
    expect(enteredTargetSum(["60,5", "x", "-3", "39.5"])).toBe("100");
    expect(pointsText("1.5").replace(/ /g, " ")).toBe("+1,50 Pp.");
    expect(instrumentText(null, {})).toBe("Kein Bestand");
    expect(instrumentText({ kind: "cash" }, {})).toBe("Als Guthaben halten");
    expect(instrumentText({ kind: "security", securityId: "s" }, { s: "SAP SE" })).toBe("SAP SE");
    expect(cashLeftText("12").replace(/ /g, " ")).toBe("+12,00 € (bleibt als Guthaben)");
    expect(cashLeftText("-5").replace(/ /g, " ")).toBe("-5,00 € (aus Guthaben)");
  });
});
