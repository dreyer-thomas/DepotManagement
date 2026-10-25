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
    expect(shadows.card).toBe("0 2px 10px rgba(15,166,138,.10)");
    expect(typography["figure-hero"]).toMatchObject({ fontSize: "34px", fontWeight: "700" });
  });
});

describe("theme", () => {
  const light = theme.colorSchemes.light!.palette;
  const dark = theme.colorSchemes.dark!.palette;

  it("builds the light scheme from the base tokens", () => {
    expect(light.primary.main).toBe("#0FA68A");
    expect(light.background.default).toBe("#F3FBF8");
    expect(light.background.paper).toBe("#FFFFFF");
    expect(light.text.primary).toBe("#0B3B33");
    expect(light.accent.main).toBe("#FFB547");
    expect(light.gain).toMatchObject({ main: "#12A150", soft: "#DDF6EC" });
    expect(light.loss).toMatchObject({ main: "#E5484D", soft: "#FDE7E8" });
    expect(light.stale).toMatchObject({ main: "#A15C00", soft: "#FFF1D6" });
    expect(light.cash.main).toBe("#B9C4CC");
    expect(light.chart).toMatchObject({ invested: "#9BB8B0", series1: "#0FA68A", series5: "#FF8FA3" });
  });

  it("builds the dark scheme from the -dark tokens", () => {
    expect(dark.primary.main).toBe("#3CCFB0");
    expect(dark.background.default).toBe("#0E1A17");
    expect(dark.background.paper).toBe("#16241F");
    expect(dark.text.primary).toBe("#E3F2EE");
    expect(dark.accent.main).toBe("#FFC877");
    expect(dark.gain).toMatchObject({ main: "#4ADE80", soft: "#123826" });
    expect(dark.loss).toMatchObject({ main: "#FF7A7E", soft: "#3A1A1C" });
    expect(dark.stale).toMatchObject({ main: "#FFC877", soft: "#3A2A10" });
    expect(dark.cash.main).toBe("#5B6870");
    expect(dark.chart.invested).toBe("#55736B");
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
