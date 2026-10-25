"use client";

import { createTheme, getContrastRatio } from "@mui/material/styles";
import type { CSSProperties } from "react";
import { colors, rounded, shadows, typography as typographyTokens } from "./tokens";

/** A brand color with the text color to use on top of it. */
export interface BrandColor {
  main: string;
  contrastText: string;
}

/** A semantic color with a soft background variant (pills, badges, chips). */
export interface SoftColor extends BrandColor {
  soft: string;
}

export interface ChartColors {
  invested: string;
  series1: string;
  series2: string;
  series3: string;
  series4: string;
  series5: string;
}

declare module "@mui/material/styles" {
  // Enables typing of `theme.vars`, `theme.colorSchemes` etc. for the CSS-variables theme.
  interface CssThemeVariables {
    enabled: true;
  }
  interface Palette {
    accent: BrandColor;
    gain: SoftColor;
    loss: SoftColor;
    stale: SoftColor;
    cash: BrandColor;
    chart: ChartColors;
  }
  interface PaletteOptions {
    accent?: BrandColor;
    gain?: SoftColor;
    loss?: SoftColor;
    stale?: SoftColor;
    cash?: BrandColor;
    chart?: ChartColors;
  }
  interface TypographyVariants {
    pageTitle: CSSProperties;
    figureHero: CSSProperties;
    figureKpi: CSSProperties;
    figure: CSSProperties;
  }
  interface TypographyVariantsOptions {
    pageTitle?: CSSProperties;
    figureHero?: CSSProperties;
    figureKpi?: CSSProperties;
    figure?: CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    pageTitle: true;
    figureHero: true;
    figureKpi: true;
    figure: true;
  }
}

type Mode = "light" | "dark";
type BaseToken = Exclude<keyof typeof colors, `${string}-dark`>;

/** Resolves a DESIGN.md token for a color scheme; `-dark` variants exist for every scheme-dependent token. */
function token(name: BaseToken, mode: Mode): string {
  if (mode === "light") return colors[name];
  const dark = `${name}-dark` as keyof typeof colors;
  return dark in colors ? colors[dark] : colors[name];
}

/** Picks white or a near-black (ink / dark background), whichever contrasts more with `background`. */
function contrastOn(background: string, mode: Mode): string {
  const ink = mode === "light" ? colors.ink : colors["background-dark"];
  return getContrastRatio(background, "#FFFFFF") >= getContrastRatio(background, ink) ? "#FFFFFF" : ink;
}

function brand(name: BaseToken, mode: Mode): BrandColor {
  const main = token(name, mode);
  return { main, contrastText: contrastOn(main, mode) };
}

function soft(name: "gain" | "loss" | "stale", mode: Mode): SoftColor {
  const softName = `${name}-soft` as BaseToken;
  return { ...brand(name, mode), soft: token(softName, mode) };
}

function palette(mode: Mode) {
  return {
    primary: { main: token("primary", mode) },
    background: { default: token("background", mode), paper: token("surface", mode) },
    text: { primary: token("ink", mode) },
    accent: brand("accent", mode),
    gain: soft("gain", mode),
    loss: soft("loss", mode),
    stale: soft("stale", mode),
    cash: brand("cash", mode),
    chart: {
      invested: token("chart-invested", mode),
      series1: colors["series-1"],
      series2: colors["series-2"],
      series3: colors["series-3"],
      series4: colors["series-4"],
      series5: colors["series-5"],
    },
  };
}

const px = (value: string) => Number.parseInt(value, 10);
const tnum = { fontVariantNumeric: "tabular-nums" } as const;

function role(name: keyof typeof typographyTokens): CSSProperties {
  const t = typographyTokens[name];
  return {
    fontSize: t.fontSize,
    fontWeight: Number(t.fontWeight),
    lineHeight: Number(t.lineHeight),
    ...("letterSpacing" in t ? { letterSpacing: t.letterSpacing } : {}),
    ...("fontFeature" in t ? tnum : {}),
  };
}

export const FONT_FAMILY = 'var(--font-roboto), "Roboto", "Helvetica", "Arial", sans-serif';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: { palette: palette("light") },
    dark: { palette: palette("dark") },
  },
  shape: { borderRadius: px(rounded.input) },
  typography: {
    fontFamily: FONT_FAMILY,
    pageTitle: role("page-title"),
    figureHero: role("figure-hero"),
    figureKpi: role("figure-kpi"),
    figure: role("figure"),
  },
  components: {
    MuiTypography: {
      defaultProps: {
        variantMapping: { pageTitle: "h1", figureHero: "span", figureKpi: "span", figure: "span" },
      },
    },
    MuiPaper: {
      // Cards float with the mint shadow; no dark-mode elevation overlay, so they show the surface token exactly.
      styleOverrides: { elevation1: { boxShadow: shadows.card, backgroundImage: "none" } },
    },
    MuiCard: {
      styleOverrides: { root: { borderRadius: rounded.card, boxShadow: shadows.card } },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: rounded.full } },
    },
  },
});
