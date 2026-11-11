import { describe, expect, it } from "vitest";
import { ratioTone } from "./NewsContext";

describe("ratioTone", () => {
  it("is gain or loss by the sign of the displayed percentage", () => {
    expect(ratioTone("0.018")).toBe("gain");
    expect(ratioTone("-0.02")).toBe("loss");
  });

  it("is neutral when the ratio shows as 0,00 %, and rounds half up", () => {
    expect(ratioTone("0.00004")).toBeNull();
    expect(ratioTone("-0.00004")).toBeNull();
    expect(ratioTone("0.00005")).toBe("gain");
  });
});
