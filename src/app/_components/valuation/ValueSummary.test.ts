import { describe, expect, it } from "vitest";
import { xirrText } from "./ValueSummary";

describe("xirrText", () => {
  it("shows the signed annualised rate, or a dash when there is none", () => {
    expect(xirrText("0.1087")).toBe("XIRR +10,87 %");
    expect(xirrText("-0.05")).toBe("XIRR -5,00 %");
    expect(xirrText(null)).toBe("XIRR –");
  });
});
