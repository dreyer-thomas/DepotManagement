import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { theme } from "./theme";
import { colors, rounded, shadows, typography } from "./tokens";

const DESIGN_MD = resolve(
  __dirname,
  "../../_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md",
);

/** Parses the `colors:` block of the DESIGN.md frontmatter (`  name: '#RRGGBB'`). */
function designColors(): Record<string, string> {
  const frontmatter = readFileSync(DESIGN_MD, "utf8").replace(/\r\n/g, "\n").split(/^---$/m)[1];
  const block = frontmatter.split(/^colors:$/m)[1].split(/^\S/m)[0];
  const entries = [...block.matchAll(/^ {2}([\w-]+): '(#[0-9A-Fa-f]{6})'$/gm)].map((m) => [m[1], m[2]]);
  return Object.fromEntries(entries);
}

describe("design tokens", () => {
  it("mirror every DESIGN.md color token", () => {
    expect(colors).toEqual(designColors());
  });

  it("match the DESIGN.md shape, shadow and typography roles", () => {
    expect(rounded).toEqual({ input: "8px", card: "16px", full: "9999px" });
    expect(shadows.card).toBe("0 2px 10px rgba(16,24,40,.08)");
    expect(typography["figure-hero"]).toMatchObject({ fontSize: "34px", fontWeight: "700" });
  });
});

describe("theme", () => {
  const light = theme.colorSchemes.light!.palette;
  const dark = theme.colorSchemes.dark!.palette;

  it("builds the light scheme from the base tokens", () => {
    expect(light.primary.main).toBe("#00857E");
    expect(light.background.default).toBe("#F3F4F6");
    expect(light.background.paper).toBe("#FFFFFF");
    expect(light.text.primary).toBe("#1E2939");
    expect(light.accent.main).toBe("#FFA600");
    expect(light.gain).toMatchObject({ main: "#008236", soft: "#E3FAEC" });
    expect(light.loss).toMatchObject({ main: "#D6000A", soft: "#FEEDEE" });
    expect(light.stale).toMatchObject({ main: "#A15C00", soft: "#FEF3C6" });
    expect(light.cash.main).toBe("#99A1AF");
    expect(light.chart).toMatchObject({ invested: "#7C93AD", series1: "#003F5C", series5: "#FFA600" });
  });

  it("builds the dark scheme from the -dark tokens", () => {
    expect(dark.primary.main).toBe("#14B8A6");
    expect(dark.background.default).toBe("#111827");
    expect(dark.background.paper).toBe("#1E2939");
    expect(dark.text.primary).toBe("#F3F4F6");
    expect(dark.accent.main).toBe("#FFB733");
    expect(dark.gain).toMatchObject({ main: "#34D399", soft: "#12352F" });
    expect(dark.loss).toMatchObject({ main: "#FF6467", soft: "#3B1D25" });
    expect(dark.stale).toMatchObject({ main: "#FFC877", soft: "#3A2A10" });
    expect(dark.cash.main).toBe("#6A7282");
    expect(dark.chart.invested).toBe("#3B82B6");
    expect(dark.chart).toMatchObject({ series1: "#2A86B0", series5: "#FFB733" });
  });

  it("uses class-based CSS variables", () => {
    expect(theme.vars).toBeDefined();
    // Must match `attribute="class"` on InitColorSchemeScript in src/app/layout.tsx.
    expect(theme.colorSchemeSelector).toBe("class");
    expect(theme.generateStyleSheets).toBeTypeOf("function");
  });

  it("defines figure typography with tabular numerals", () => {
    expect(theme.typography.pageTitle).toMatchObject({ fontSize: "22px", fontWeight: 600 });
    expect(theme.typography.figureHero).toMatchObject({ fontSize: "34px", fontWeight: 700, fontVariantNumeric: "tabular-nums" });
    expect(theme.typography.figureKpi).toMatchObject({ fontSize: "18px", fontWeight: 600, fontVariantNumeric: "tabular-nums" });
    expect(theme.typography.figure).toMatchObject({ fontSize: "14px", fontWeight: 400, fontVariantNumeric: "tabular-nums" });
  });

  it("applies the DESIGN.md radii and card shadow", () => {
    expect(theme.shape.borderRadius).toBe(8);
    expect(theme.components?.MuiCard?.styleOverrides?.root).toMatchObject({ borderRadius: "16px", boxShadow: shadows.card });
    expect(theme.components?.MuiChip?.styleOverrides?.root).toMatchObject({ borderRadius: "9999px" });
  });
});
