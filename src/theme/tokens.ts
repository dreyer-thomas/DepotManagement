/**
 * Design tokens for direction "Minze", mirrored 1:1 from the DESIGN.md frontmatter
 * (_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md).
 * Keys keep the DESIGN.md names; a theme test checks they stay in sync.
 */
export const colors = {
  primary: "#0FA68A",
  "primary-dark": "#3CCFB0",
  accent: "#FFB547",
  "accent-dark": "#FFC877",
  background: "#F3FBF8",
  "background-dark": "#0E1A17",
  surface: "#FFFFFF",
  "surface-dark": "#16241F",
  ink: "#0B3B33",
  "ink-dark": "#E3F2EE",
  gain: "#12A150",
  "gain-dark": "#4ADE80",
  "gain-soft": "#DDF6EC",
  "gain-soft-dark": "#123826",
  loss: "#E5484D",
  "loss-dark": "#FF7A7E",
  "loss-soft": "#FDE7E8",
  "loss-soft-dark": "#3A1A1C",
  stale: "#A15C00",
  "stale-dark": "#FFC877",
  "stale-soft": "#FFF1D6",
  "stale-soft-dark": "#3A2A10",
  cash: "#B9C4CC",
  "cash-dark": "#5B6870",
  "chart-invested": "#9BB8B0",
  "chart-invested-dark": "#55736B",
  "series-1": "#0FA68A",
  "series-2": "#5BC8F5",
  "series-3": "#FFB547",
  "series-4": "#A78BFA",
  "series-5": "#FF8FA3",
} as const;

export const typography = {
  "page-title": { fontSize: "22px", fontWeight: "600", lineHeight: "1.25" },
  "figure-hero": { fontSize: "34px", fontWeight: "700", lineHeight: "1.15", letterSpacing: "-0.01em", fontFeature: "tnum" },
  "figure-kpi": { fontSize: "18px", fontWeight: "600", lineHeight: "1.3", fontFeature: "tnum" },
  figure: { fontSize: "14px", fontWeight: "400", lineHeight: "1.43", fontFeature: "tnum" },
} as const;

export const rounded = {
  input: "8px",
  card: "16px",
  full: "9999px",
} as const;

export const spacing = {
  "page-gutter-mobile": "16px",
  "page-gutter-desktop": "24px",
  "card-padding": "16px",
  "content-max": "1280px",
} as const;

export const shadows = {
  card: "0 2px 10px rgba(15,166,138,.10)",
} as const;
