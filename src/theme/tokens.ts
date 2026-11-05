/**
 * Design tokens for direction "Schiefer", mirrored 1:1 from the DESIGN.md frontmatter
 * (_bmad-output/planning-artifacts/ux-designs/ux-DepotManagement-2026-10-25/DESIGN.md).
 * Keys keep the DESIGN.md names; a theme test checks they stay in sync.
 */
export const colors = {
  primary: "#00857E",
  "primary-dark": "#14B8A6",
  accent: "#FFA600",
  "accent-dark": "#FFB733",
  background: "#F3F4F6",
  "background-dark": "#111827",
  surface: "#FFFFFF",
  "surface-dark": "#1E2939",
  ink: "#1E2939",
  "ink-dark": "#F3F4F6",
  gain: "#008236",
  "gain-dark": "#34D399",
  "gain-soft": "#E3FAEC",
  "gain-soft-dark": "#12352F",
  loss: "#D6000A",
  "loss-dark": "#FF6467",
  "loss-soft": "#FEEDEE",
  "loss-soft-dark": "#3B1D25",
  stale: "#A15C00",
  "stale-dark": "#FFC877",
  "stale-soft": "#FEF3C6",
  "stale-soft-dark": "#3A2A10",
  cash: "#99A1AF",
  "cash-dark": "#6A7282",
  "chart-invested": "#7C93AD",
  "chart-invested-dark": "#3B82B6",
  "series-1": "#003F5C",
  "series-1-dark": "#2A86B0",
  "series-2": "#665191",
  "series-2-dark": "#8A6FC2",
  "series-3": "#D45087",
  "series-3-dark": "#E0669A",
  "series-4": "#FF7C43",
  "series-4-dark": "#FF8A57",
  "series-5": "#FFA600",
  "series-5-dark": "#FFB733",
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
  card: "0 2px 10px rgba(16,24,40,.08)",
} as const;
