---
name: DepotManagement
description: Self-hosted, single-user portfolio tracker. MUI 9 on Next.js; this DESIGN.md specifies the brand-layer delta (direction "Schiefer", re-themed 2026-11-05 from "Minze") over MUI defaults.
status: final
updated: 2026-11-05
colors:
  # Overrides on top of the MUI default theme. Unlisted palette entries
  # (error, warning, info, grey, divider) inherit from MUI.
  primary: '#00857E'
  primary-dark: '#14B8A6'
  accent: '#FFA600'
  accent-dark: '#FFB733'
  background: '#F3F4F6'
  background-dark: '#111827'
  surface: '#FFFFFF'
  surface-dark: '#1E2939'
  ink: '#1E2939'
  ink-dark: '#F3F4F6'
  gain: '#008236'
  gain-dark: '#34D399'
  gain-soft: '#E3FAEC'
  gain-soft-dark: '#12352F'
  loss: '#D6000A'
  loss-dark: '#FF6467'
  loss-soft: '#FEEDEE'
  loss-soft-dark: '#3B1D25'
  stale: '#A15C00'
  stale-dark: '#FFC877'
  stale-soft: '#FEF3C6'
  stale-soft-dark: '#3A2A10'
  cash: '#99A1AF'
  cash-dark: '#6A7282'
  chart-invested: '#7C93AD'
  chart-invested-dark: '#3B82B6'
  series-1: '#003F5C'
  series-1-dark: '#2A86B0'
  series-2: '#665191'
  series-2-dark: '#8A6FC2'
  series-3: '#D45087'
  series-3-dark: '#E0669A'
  series-4: '#FF7C43'
  series-4-dark: '#FF8A57'
  series-5: '#FFA600'
  series-5-dark: '#FFB733'
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
    shadow: '0 2px 10px rgba(16,24,40,.08)'
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

DepotManagement should feel **calm and precise**, close to Parqet's look: a cool neutral grey page with white cards (light) or a slate-navy page with slightly lighter cards (dark), one teal brand color, clear green/red for gains and losses, a multi-hue composition palette and real company logos — numbers stay the hero. Direction "Schiefer" replaced the original mint direction "Minze" on 2026-11-05 (Tommy found Minze too green); the mockups in [mockups/](mockups/overview-desktop.html) still show Minze colors and are authoritative for layout only. Spines win on conflict with mockups. MUI 9 provides the component behavior; this file restyles palette, shape, figure typography and a handful of domain components.

## Colors

- **Primary Teal (`#00857E` / dark `#14B8A6`)** — brand color: selected Period pill, active navigation and tab, primary buttons, links, the value line and its gradient fill. Light value is a deepened teal so white button text and teal links on white reach 4.5:1; dark buttons use dark text.
- **Accent Amber (`#FFA600` / dark `#FFB733`)** — secondary highlight: dividend KPI border, small accents. Never used for gain/loss or errors.
- **Background (`#F3F4F6`) and Surface (`#FFFFFF`)** — neutral cool-grey page with white cards. Dark mode: slate-navy background `#111827` with card surface `#1E2939`.
- **Ink (`#1E2939` / dark `#F3F4F6`)** — headings and primary text, a slate near-black.
- **Gain (`#008236`) / Loss (`#D6000A`)** with soft variants — only on performance figures and gain/loss pills, always with sign and arrow. Light values reach 4.5:1 on white and on their soft pill.
- **Stale (`#A15C00` on `#FEF3C6`)** — stale-price badge, ambiguous import chip, warnings that are not errors.
- **Cash (`#99A1AF`)** — cash segment and Cash Account rows; deliberately neutral grey.
- **Chart invested (`#7C93AD` / dark `#3B82B6`)** — dashed invested-capital line, a muted slate blue.
- **Series 1–5** — categorical palette for composition and multi-Depot charts in fixed order: navy, purple, magenta, orange, amber; each has a lighter `-dark` variant that stays visible on the dark surface. Cash always uses `{colors.cash}`.

## Typography

MUI's Roboto ramp for text. Bolder roles add personality: `{typography.page-title}` (22/600), `{typography.figure-hero}` (34/700) for the total value, `{typography.figure-kpi}` (18/600) on KPI cards, `{typography.figure}` (14/400) for amounts in lists. All figures use tabular numerals. Format de-DE: `1.234,56 €`, `+3,21 %`, `25.10.2026`.

## Layout & Spacing

MUI's 8px unit. Gutters 16px phone / 24px desktop; content max width 1280px; card padding 16px. Desktop: permanent left drawer; phone: bottom navigation (EXPERIENCE.md Responsive & Platform). Overview leads with the hero card (value + area chart), then a KPI row, then Positions and composition side by side on desktop, stacked on phones.

## Elevation & Depth

Cards float slightly on the grey background with a soft neutral shadow (`0 2px 10px rgba(16,24,40,.08)`), no borders. Dialogs and menus use MUI elevation. No heavy shadows.

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
| Neutral grey background, white floating cards | Grey enterprise look or bordered boxes everywhere |
| Gradient fill under the value line | Gradient fills on invested capital or in tables |
| Logos (or initials) before every Security name | Mixing logo sizes or square/round logos |
| Gain/loss colors only for performance, with sign + arrow | Green/red row backgrounds or color-only meaning |
| Accent amber sparingly as a highlight | Amber for warnings (that is `{colors.stale}`) |
| Tabular numerals, right-aligned amounts | Proportional digits in tables |
