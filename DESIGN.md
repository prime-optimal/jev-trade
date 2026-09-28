---
version: alpha
name: jevOn dashboard
description: Baseline capture of the jev-trade Next dashboard as of main 883e040. Dark theme is the primary theme; light values are recorded alongside.
colors:
  primary: "#f4f5f6"
  on-primary: "#0b0d10"
  neutral: "#0b0d10"
  surface: "#0b0d10"
  surface-raised: "#1a1d20"
  surface-hover: "#22262a"
  on-surface: "#f4f5f6"
  on-surface-2: "#d5d8dc"
  on-surface-muted: "#a8adb4"
  border-strong: "#d8dce0"
  border: "#858b92"
  grid: "#2c3035"
  track: "#30353a"
  link: "#8eb2ff"
  focus: "#91b3ff"
  buy: "#42d66b"
  buy-dim: "#183d24"
  sell: "#ff746c"
  sell-dim: "#4b2222"
  late: "#f0c35a"
  late-dim: "#392f18"
  hold-dim: "#24282c"
  error: "#ff8b84"
  disabled-bg: "#292d31"
  disabled-ink: "#92989f"
  light-surface: "#ffffff"
  light-surface-raised: "#f5f6f7"
  light-on-surface: "#0a0a0a"
  light-on-surface-muted: "#62666d"
  light-border-strong: "#171717"
  light-border: "#5f6368"
  light-grid: "#e1e3e5"
  light-buy: "#087d20"
  light-sell: "#b42318"
  light-link: "#143fa3"
typography:
  display:
    fontFamily: IBM Plex Mono
    fontSize: 46px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.02em
  headline-md:
    fontFamily: IBM Plex Mono
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  title-md:
    fontFamily: IBM Plex Mono
    fontSize: 17px
    fontWeight: 700
    lineHeight: 1.2
  body-md:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.02em
  body-sm:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  label-caps:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 0.08em
  label-xs:
    fontFamily: IBM Plex Mono
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  page-x: 56px
  page-top: 28px
rounded:
  none: 0px
  full: 999px
components:
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
  panel-inset:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: 8px
  button-secondary-hover:
    backgroundColor: "{colors.surface-raised}"
  badge-jev:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.none}"
  chip-buy-selected:
    backgroundColor: "{colors.buy-dim}"
    textColor: "{colors.buy}"
  chip-sell-selected:
    backgroundColor: "{colors.sell-dim}"
    textColor: "{colors.sell}"
---

# jevOn dashboard

## Overview

A terminal-flavoured trading dashboard: monospace everywhere, square corners, hairline borders,
and no shadows. It reads as technical, serious, and dense. The dark theme (`data-theme="dark"`)
is the theme the operator uses; the light theme exists as a toggle and shares every token name.

The product claim constrains the visual language: no blinking or pulsing indicators, and no em
dashes, en dashes, or middle dots in rendered text.

## Colors

Colors are CSS custom properties in `web/src/app/globals.css`, defined twice (light `:root`,
dark `:root[data-theme="dark"]`). They are hex values, not HSL ramps, and there is no numbered
grey scale: greys are named by role.

- **Ink (#f4f5f6 dark):** primary text, the Jev badge background, and chart up candles.
- **Surfaces (#0b0d10, #1a1d20, #22262a):** page and panel share one value, so panels are
  separated from the page only by borders. `--panel-2` is the inset or selected surface.
- **Borders:** `--border` (#d8dce0) is a near-white strong border; `--border-2` (#858b92) is the
  secondary border; `--grid` (#2c3035) divides table rows.
- **Muted text (#a8adb4):** secondary text. `--muted` and `--muted-2` hold the same value.
- **Buy / sell (#42d66b / #ff746c):** each has four aliases (`--buy`, `--buy-ink`, `--buy-bar`,
  `--up-bar`) that hold one value, plus a dim background (`--buy-bar-dim`, `--sell-bar-dim`).
- **Late (#f0c35a)** marks late decisions; **link (#8eb2ff)** and **focus (#91b3ff)** are the
  only blues.

## Typography

One family, IBM Plex Mono (400, 500, 600, 700), loaded as `--font-plex` and exposed as both
`--font-sans` and `--font-mono`. Body is 14px / 1.4 with -0.02em tracking.

Sizes in use: 10, 11, 11.5, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24px, plus two page headlines
at `clamp(28px, 5vw, 46px)` and `clamp(28px, 5vw, 48px)`. 11px is the most common size by far.
Weights in use are 400, 500, 600, and 700; 700 dominates emphasis. Uppercase eyebrow labels use
0.08em tracking; other tracking values in use are 0.02, 0.04, 0.06, and 0.12em.

## Layout

Pages pad `28px clamp(16px, 4vw, 56px) 64px`. The home dashboard is a full-height shell; the
`/model` page is a two-column grid (`minmax(420px, .9fr) minmax(420px, 1.1fr)`) capped at
1600px, collapsing to one column below 980px.

Spacing has no fixed scale. Gaps in use: 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 24px.
Paddings mix 1, 2, 6, 8, 9, 10, 12, 13, 14, 16, 20, 22px.

## Elevation & Depth

Flat. The only shadow is an inset 3px top rule (`inset 0 3px 0 var(--ink)`) marking a selected
item. Depth comes from borders and the one raised surface (`--panel-2`).

## Shapes

Square. `--card-radius` is 0 and every panel, button, and chip is square-cornered. The only
rounding is a 999px pill and a 50% circle for status dots.

## Components

- **Panel:** 1px `--border` on `--panel`, no radius, no shadow.
- **Inset panel:** `--panel-2` with a 1px `--border-2` border, used for evidence groups, fills,
  and markouts on `/model`.
- **Secondary button:** 38px min height, 1px border, `--panel` fill, `--panel-2` on hover,
  3px `--link` focus outline.
- **Chip:** 1px `--border-2` outline, 11px text; buy/sell tones recolor text and border, and
  selected chips fill with the dim tone.
- **Probability bar:** 6px `--track` rail with an `--ink`, buy, or sell fill.
- **Depth ladder:** price x size rows over a 35% opacity buy or sell bar.

## Do's and Don'ts

- Do keep every color in `globals.css` and reference it by custom property.
- Do keep corners square.
- Don't render em dashes, en dashes, or middle dots.
- Don't add blinking or pulsing indicators.
