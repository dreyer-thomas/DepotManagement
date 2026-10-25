---
name: DepotManagement
description: Self-hosted, single-user portfolio tracker. MUI 9 on Next.js; this DESIGN.md specifies the brand-layer delta (direction "Minze") over MUI defaults.
status: final
updated: 2026-10-25
colors:
  # Overrides on top of the MUI default theme. Unlisted palette entries
  # (error, warning, info, grey, divider) inherit from MUI.
  primary: '#0FA68A'
  primary-dark: '#3CCFB0'
  accent: '#FFB547'
  accent-dark: '#FFC877'
  background: '#F3FBF8'
  background-dark: '#0E1A17'
  surface: '#FFFFFF'
  surface-dark: '#16241F'
  ink: '#0B3B33'
  ink-dark: '#E3F2EE'
  gain: '#12A150'
  gain-dark: '#4ADE80'
  gain-soft: '#DDF6EC'
  gain-soft-dark: '#123826'
  loss: '#E5484D'
  loss-dark: '#FF7A7E'
  loss-soft: '#FDE7E8'
  loss-soft-dark: '#3A1A1C'
  stale: '#A15C00'
  stale-dark: '#FFC877'
  stale-soft: '#FFF1D6'
  stale-soft-dark: '#3A2A10'
  cash: '#B9C4CC'
  cash-dark: '#5B6870'
  chart-invested: '#9BB8B0'
  chart-invested-dark: '#55736B'
  series-1: '#0FA68A'
  series-2: '#5BC8F5'
  series-3: '#FFB547'
  series-4: '#A78BFA'
  series-5: '#FF8FA3'
typography:
  # Font family and text ramp inherit from MUI (Roboto). Headings and figures are bolder.
  page-title:
    fontSize: 22px
    fontWeight: '600'
    lineHeight: '1.25'
  figure-hero:
    fontSize: 34px
    fontWeight: '700'
    lineHeight: '1.15'
    letterSpacing: -0.01em
    fontFeature: 'tnum'
  figure-kpi:
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.3'
    fontFeature: 'tnum'
  figure:
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.43'
    fontFeature: 'tnum'
rounded:
  input: 8px
  card: 16px
  full: 9999px
spacing:
  # MUI 8px spacing unit inherited.
  page-gutter-mobile: 16px
  page-gutter-desktop: 24px
  card-padding: 16px
  content-max: 1280px
components:
  hero-card:
    background: '{colors.surface}'
    radius: '{rounded.card}'
    shadow: '0 2px 10px rgba(15,166,138,.10)'
    value-typography: '{typography.figure-hero}'
  kpi-card:
    background: '{colors.surface}'
    radius: '{rounded.card}'
    top-border: '4px solid, color per KPI'
    value-typography: '{typography.figure-kpi}'
  gain-loss-pill:
    positive-bg: '{colors.gain-soft}'
    positive-fg: '{colors.gain}'
    negative-bg: '{colors.loss-soft}'
    negative-fg: '{colors.loss}'
    radius: '{rounded.full}'
  gain-loss-figure:
    positive: '{colors.gain}'
    negative: '{colors.loss}'
    typography: '{typography.figure}'
  period-selector:
    selected-bg: '{colors.primary}'
    selected-fg: '#FFFFFF'
    radius: '{rounded.full}'
  area-chart:
    line: '{colors.primary}'
    line-width: 3px
    fill: 'vertical gradient {colors.primary} 35% -> 0%'
    invested-line: '{colors.chart-invested}, dashed'
  composition-donut:
    segments: '{colors.series-1}..{colors.series-5}'
    cash-segment: '{colors.cash}'
  security-logo:
    size: 32px
    radius: '{rounded.full}'
    fallback: 'initials on a color derived from the Security name'
  stale-badge:
    background: '{colors.stale-soft}'
    foreground: '{colors.stale}'
    radius: '{rounded.full}'
  status-chip-import:
    parsed: '{colors.gain-soft} / {colors.gain}'
    duplicate: 'MUI default grey'
    ambiguous: '{colors.stale-soft} / {colors.stale}'
    failed: '{colors.loss-soft} / {colors.loss}'
---

## Brand & Style

DepotManagement should feel **fresh and playful** while staying precise: a light, mint-tinted surface, soft rounded cards, a lively area chart and real company logos make checking the Portfolio pleasant — numbers stay the hero. Direction "Minze" was chosen from four rendered options (`.working/directions-1.html`); see [mockups/overview-desktop.html](mockups/overview-desktop.html). Spines win on conflict with mockups. MUI 9 provides the component behavior; this file restyles palette, shape, figure typography and a handful of domain components.

## Colors

- **Primary Minze (`#0FA68A` / dark `#3CCFB0`)** — brand color: selected Period pill, active navigation, primary buttons, the value line and its gradient fill, the first composition segment.
- **Accent Amber (`#FFB547`)** — secondary highlight: dividend KPI border, third composition segment, small playful accents. Never used for gain/loss or errors.
- **Background (`#F3FBF8`) and Surface (`#FFFFFF`)** — the mint-tinted page with white cards gives the fresh feel. Dark mode: deep green-black background with slightly lighter card surface.
- **Ink (`#0B3B33`)** — headings and primary text, a green-tinted near-black.
- **Gain (`#12A150`) / Loss (`#E5484D`)** with soft variants — only on performance figures and gain/loss pills, always with sign and arrow.
- **Stale (`#A15C00` on `#FFF1D6`)** — stale-price badge, ambiguous import chip, warnings that are not errors.
- **Cash (`#B9C4CC`)** — cash segment and Cash Account rows; deliberately neutral.
- **Series 1–5** — categorical palette for composition and multi-Depot charts, in fixed order; cash always uses `{colors.cash}`.
- Dark mode follows the system setting with a manual toggle; every token has a `-dark` variant.

## Typography

MUI's Roboto ramp for text. Bolder roles add personality: `{typography.page-title}` (22/600), `{typography.figure-hero}` (34/700) for the total value, `{typography.figure-kpi}` (18/600) on KPI cards, `{typography.figure}` (14/400) for amounts in lists. All figures use tabular numerals. Format de-DE: `1.234,56 €`, `+3,21 %`, `25.10.2026`.

## Layout & Spacing

MUI's 8px unit. Gutters 16px phone / 24px desktop; content max width 1280px; card padding 16px. Desktop: permanent left drawer; phone: bottom navigation (EXPERIENCE.md Responsive & Platform). Overview leads with the hero card (value + area chart), then a KPI row, then Positions and composition side by side on desktop, stacked on phones.

## Elevation & Depth

Cards float slightly on the mint background with a soft, mint-tinted shadow (`0 2px 10px rgba(15,166,138,.10)`), no borders. Dialogs and menus use MUI elevation. No heavy shadows.

## Shapes

Generous rounding: 16px cards, 8px inputs and buttons, full rounding for the Period selector, pills, chips, badges and logos.

## Components

Inherited from MUI with theme overrides only: AppBar, Drawer, BottomNavigation, Button, Card, Table, Tabs, Dialog, Snackbar, Chip, TextField, Autocomplete, Skeleton, Alert.

- **Hero card** — white card: "Gesamtwert" label, value in `{typography.figure-hero}`, gain/loss pill with amount and TTWROR, XIRR next to it, area chart below.
- **KPI card** — white card with a 4px colored top border per KPI (invested capital `{colors.primary}`, dividends `{colors.accent}`, cash `{colors.cash}`, taxes `{colors.series-4}`); value in `{typography.figure-kpi}`.
- **Gain/loss pill** — rounded pill, soft background, strong foreground, arrow + signed amount and/or percentage.
- **Period selector** — row of pill buttons; selected pill filled `{colors.primary}`, others text only.
- **Area chart** — 3px `{colors.primary}` line with vertical gradient fill fading to transparent; invested capital as dashed `{colors.chart-invested}` line; no fill under invested; light horizontal grid only; tooltip in a white rounded card.
- **Composition donut** — donut with legend list (label, percentage, amount); segments in series order, cash in `{colors.cash}`.
- **Security logo** — 32px round logo before every Security name (Positions, Transactions, news, import review). Missing logo → initials on a color derived deterministically from the name.
- **Stale badge**, **import status chip** — soft-background pills per frontmatter tokens.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Mint background, white floating cards | Grey enterprise look or bordered boxes everywhere |
| Gradient fill under the value line | Gradient fills on invested capital or in tables |
| Logos (or initials) before every Security name | Mixing logo sizes or square/round logos |
| Gain/loss colors only for performance, with sign + arrow | Green/red row backgrounds or color-only meaning |
| Accent amber sparingly as a highlight | Amber for warnings (that is `{colors.stale}`) |
| Tabular numerals, right-aligned amounts | Proportional digits in tables |
