import { describe, expect, it } from "vitest";
import { LOGO_COLORS, securityColor, securityInitials } from "./security-logo";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("securityInitials", () => {
  it.each([
    ["Apple Inc.", "AI"],
    ["iShares Core MSCI World", "IC"],
    ["Bitcoin", "BI"],
    ["öko-invest", "ÖI"],
    ["3M", "3M"],
    ["  ", "?"],
  ])("%j → %j", (name, initials) => {
    expect(securityInitials(name)).toBe(initials);
  });
});

describe("securityColor", () => {
  it("is deterministic and from the palette", () => {
    expect(securityColor("Apple Inc.")).toBe(securityColor("Apple Inc."));
    expect(LOGO_COLORS).toContain(securityColor("Apple Inc."));
    const spread = new Set(["Apple Inc.", "Bitcoin", "iShares Core MSCI World", "Siemens", "Allianz", "SAP"].map(securityColor));
    expect(spread.size).toBeGreaterThan(1);
  });

  it("keeps white initials at AA contrast on every palette color", () => {
    for (const color of LOGO_COLORS) {
      expect((1.05 / (luminance(color) + 0.05))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
