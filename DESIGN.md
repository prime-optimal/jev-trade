---
version: alpha
name: jevOn dashboard
description: jev-trade Next dashboard. Dark theme is the primary theme; light values are recorded alongside. The /model page uses the fixed spacing and type scales below; older pages still carry baseline values.
colors:
  primary: "#f4f5f6"
  on-primary: "#0b0d10"
  neutral: "#0b0d10"
  surface: "#0b0d10"
  surface-raised: "#1a1d20"
  surface-panel: "#121519"
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
  light-surface-panel: "#fafafb"
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
  scale-30:
    fontFamily: IBM Plex Mono
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1
  scale-20:
    fontFamily: IBM Plex Mono
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
  scale-16:
    fontFamily: IBM Plex Mono
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.3
  scale-14:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  scale-12:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  page-x: 56px
  page-top: 28px
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-5: 24px
  space-6: 32px
  space-7: 48px
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
  record-panel:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: 16px
  rail-row-selected:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    height: 32px
  segmented-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.none}"
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
- **Surfaces (#0b0d10, #121519, #1a1d20, #22262a):** page and panel share one value, so panels are
  separated from the page only by borders. `--panel-1` is the borderless record-panel surface on
  `/model`, one step above the page; `--panel-2` is the inset or selected surface.
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

`/model` uses a fixed scale instead: `--text-12`, `--text-14`, `--text-16`, `--text-20`, and
`--text-30`, with weights 400 and 600 only. 12px / 1.5 carries data and meta text, 14px 600 titles
panels and cards, 16px and 20px 600 carry key values, and 30px 600 is reserved for the selected
call and the biggest input value in a card.

## Layout

Pages pad `28px clamp(16px, 4vw, 56px) 64px`. The home dashboard is a full-height shell.

`/model` is a viewport-height workspace from 1100px up: a compact toolbar, a timeline strip
(a 352px summary column beside a full-width markout chart), then a 352px decision rail beside
the record, each scrolling on its own. The record body is three columns (360px answers, flexible
inputs, 300px order and outcome), folding to two below 1600px. Below 1100px everything stacks
and the page scrolls.

Older pages have no fixed spacing scale. Gaps in use: 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20,
24px. Paddings mix 1, 2, 6, 8, 9, 10, 12, 13, 14, 16, 20, 22px. `/model` uses only
`--space-1` to `--space-7` (4, 8, 12, 16, 24, 32, 48px); new work uses that scale everywhere.

## Elevation & Depth

Flat. The only shadow is an inset 3px top rule (`inset 0 3px 0 var(--ink)`) marking a selected
item. Depth comes from borders and surface steps: `--panel-1` for record panels and `--panel-2`
for the raised or selected surface. `/model` separates regions with `--grid` hairlines and
surface steps rather than strong borders.

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
- **Probability bar:** 8px `--track` rail with an `--ink`, buy, or sell fill on `/model`.
- **Depth ladder:** price x size rows over a dim buy or sell bar.
- **Record panel:** `--panel-1` fill, no border, 16px padding, 14px 600 title. Every captured
  input renders in one as a formatted card; raw JSON is never shown.
- **Decision rail row:** 32px, 12px tabular text, `--panel-1` on hover, `--panel-2` when
  selected with a 2px `--ink` left rule. Calls pair a color with a shape mark (triangle up for
  buy, triangle down for sell, bar for hold, cross for no decision).
- **Segmented control:** square 48px by 32px buttons in a 1px `--border-2` outline; the pressed
  option fills with `--ink` and uses `--page-bg` text.
- **Markout bars:** buy, sell, or hold fill above or below a zero line; pending markouts are a
  small `--track` square.

## Do's and Don'ts

- Do keep every color in `globals.css` and reference it by custom property.
- Do keep corners square.
- Don't render em dashes, en dashes, or middle dots.
- Don't add blinking or pulsing indicators.
- Do use the `--space-*` and `--text-*` scales for new work; never add an off-scale value.
- Do give every signal a shape or text cue in addition to color.
- Don't show raw JSON in the UI. Unknown values fall back to formatted fields.
