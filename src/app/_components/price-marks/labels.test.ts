import { describe, expect, it } from "vitest";
import { breachPillText, markMetaText, NO_PRICE_MARKS_TEXT, PRICE_MARKS_NOTE, stopRowText, targetRowText } from "./labels";

const plain = (text: string) => text.replace(/ /g, " ");

describe("price marks card labels", () => {
  it("fixed stop row with value and distance", () => {
    expect(plain(stopRowText({ type: "FIXED", value: "92.4" }, { effective: "92.4", high: null, distance: "-0.0741" }))).toBe("Stopp · 92,40 € · -7,4 %");
  });

  it("trailing stop row: percent without trailing zeros, effective value and distance", () => {
    expect(plain(stopRowText({ type: "TRAILING", value: "15" }, { effective: "92.4", high: "108.7", distance: "-0.074" }))).toBe(
      "Stopp nachlaufend 15 % · 92,40 € · -7,4 %",
    );
    expect(plain(stopRowText({ type: "TRAILING", value: "12.50" }, { effective: "87.5", high: "100", distance: null }))).toBe(
      "Stopp nachlaufend 12,5 % · 87,50 €",
    );
  });

  it("trailing stop row without any Price", () => {
    expect(plain(stopRowText({ type: "TRAILING", value: "15" }, { effective: null, high: null, distance: null }))).toBe(
      "Stopp nachlaufend 15 % · noch kein Kurs",
    );
  });

  it("target row, distance omitted without a Price", () => {
    expect(plain(targetRowText({ price: "245", distance: "0.0812" }))).toBe("Ziel · 245,00 € · +8,1 %");
    expect(plain(targetRowText({ price: "245", distance: null }))).toBe("Ziel · 245,00 €");
  });

  it("meta line with and without a source", () => {
    expect(markMetaText({ source: "Börse Online", setDate: "2026-10-01" })).toBe("Quelle: Börse Online · gesetzt am 01.10.2026");
    expect(markMetaText({ source: null, setDate: "2026-10-01" })).toBe("gesetzt am 01.10.2026");
  });

  it("breach pill names the breach and the Price date", () => {
    expect(breachPillText("stop", "2026-11-10")).toBe("Stopp unterschritten · Kurs vom 10.11.2026");
    expect(breachPillText("target", "2026-11-10")).toBe("Ziel erreicht · Kurs vom 10.11.2026");
  });

  it("constants", () => {
    expect(NO_PRICE_MARKS_TEXT).toBe("Keine Kursmarken");
    expect(PRICE_MARKS_NOTE).toBe("geprüft gegen den letzten Kurs, nicht im Tagesverlauf");
  });
});
