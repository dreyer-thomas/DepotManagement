import { describe, expect, it } from "vitest";
import { gainLossText, gainLossTone } from "./GainLossPill";

describe("gainLossText", () => {
  it("shows signed amount and percentage", () => {
    expect(gainLossText("28.8", "0.0797342192691029900332225913621262458471760797342192691")).toBe("+28,80 € · +7,97 %");
    expect(gainLossText("-12.5", "-0.125")).toBe("-12,50 € · -12,50 %");
  });

  it("shows only the amount without a ratio and no sign for zero", () => {
    expect(gainLossText("0", null)).toBe("0,00 €");
    expect(gainLossText("3", null)).toBe("+3,00 €");
  });

  it("shows a flat Position as zero amount and zero percent", () => {
    expect(gainLossText("0", "0")).toBe("0,00 € · 0,00 %");
  });
});

describe("gainLossTone", () => {
  it("follows the sign of the gain rounded half-up to cents", () => {
    expect(gainLossTone("28.8")).toBe("gain");
    expect(gainLossTone("-20")).toBe("loss");
    expect(gainLossTone("0")).toBeNull();
    expect(gainLossTone("0.004")).toBeNull();
    expect(gainLossTone("-0.004")).toBeNull();
    expect(gainLossTone("0.005")).toBe("gain");
    expect(gainLossTone("-0.005")).toBe("loss");
  });
});
