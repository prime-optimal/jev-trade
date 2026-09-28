---
version: alpha
name: jevOn dashboard
description: jev-trade Next dashboard. Dark theme is the primary theme; light values are recorded alongside. Every page uses the fixed spacing and type scales below.
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
  buy: "#43d66a"
  buy-dim: "#183e22"
  sell: "#ff726b"
  sell-dim: "#4a2321"
  late: "#f0c35c"
  late-dim: "#3a2f18"
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
  light-buy: "#087d27"
  light-sell: "#b42018"
  light-link: "#143fa3"
typography:
  display:
    fontFamily: IBM Plex Mono
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.02em
  title:
    fontFamily: IBM Plex Mono
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
  value:
    fontFamily: IBM Plex Mono
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  heading:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.02em
  data:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  label-caps:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.08em
spacing:
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

Colors are CSS custom properties in `web/src/app/globals.css`. Greys are named by role and defined
twice (light `:root`, dark `:root[data-theme="dark"]`). Signal colors come from three HSL ramps
defined once in `:root`, and each theme maps one semantic token per role onto a ramp step.

- **Ink (#f4f5f6 dark):** primary text, the Jev badge background, and chart up candles.
- **Surfaces (#0b0d10, #121519, #1a1d20, #22262a):** page and panel share one value, so panels are
  separated from the page only by borders. `--panel-1` is the borderless record-panel surface on
  `/model`, one step above the page; `--panel-2` is the inset or selected surface.
- **Borders:** `--border` (#d8dce0) is a near-white strong border; `--border-2` (#858b92) is the
  secondary border; `--grid` (#2c3035) divides table rows.
- **Muted text (#a8adb4):** secondary text, `--muted`.
- **Ramps:** three HSL ramps live only in `globals.css`, each with steps 100 (light tint), 400
  (bright ink for dark surfaces), 700 (deep ink for light surfaces), and 900 (dark tint).
  Components never use a ramp step directly, so the ramps are not frontmatter tokens.

  | Ramp | 100 | 400 | 700 | 900 |
  | --- | --- | --- | --- | --- |
  | `--green-*` | `hsl(136 45% 91%)` | `hsl(136 64% 55%)` | `hsl(136 88% 26%)` | `hsl(136 44% 17%)` |
  | `--red-*` | `hsl(3 60% 91%)` | `hsl(3 100% 71%)` | `hsl(3 76% 40%)` | `hsl(3 38% 21%)` |
  | `--amber-*` | `hsl(43 100% 92%)` | `hsl(42 83% 65%)` | `hsl(42 100% 27%)` | `hsl(42 41% 16%)` |

- **Signals:** `--buy` and `--sell` color buy and sell calls, bars, candles, positive and negative
  PnL, and the live dot; `--buy-dim` and `--sell-dim` are their tinted backgrounds. Dark maps them
  to steps 400 and 900, light to 700 and 100. `--late` / `--late-dim` mark late decisions the same
  way, and `--hold-dim` is the neutral hold tint.
- **Link (#8eb2ff)** and **focus (#91b3ff)** are the only blues.

## Typography

One family, IBM Plex Mono, loaded as `--font-plex` and exposed as both `--font-sans` and
`--font-mono`. Body is `--text-14` / 1.4 with -0.02em tracking.

Every page uses one fixed scale: `--text-12`, `--text-14`, `--text-16`, `--text-20`, and
`--text-30`, with weights 400 and 600 only. 12px / 1.5 carries data, meta text, and uppercase
eyebrow labels (600, 0.08em tracking); 14px 600 titles panels and cards; 16px and 20px 600 carry
key values; 30px 600 is reserved for the selected call, the biggest value in a card, and page
headlines. Line heights are 1, 1.2, 1.4, or 1.5; tracking is -0.02em, none, or 0.08em for caps.

## Layout

Pages pad `var(--space-6) clamp(var(--space-4), 4vw, var(--space-7)) var(--space-7)`. The home
dashboard is a full-height shell.

`/model` is a viewport-height workspace from 1100px up: a compact toolbar, a timeline strip
(a 352px summary column beside a full-width markout chart), then a 352px decision rail beside
the record, each scrolling on its own. The record body is three columns (360px answers, flexible
inputs, 300px order and outcome), folding to two below 1600px. Below 1100px everything stacks
and the page scrolls.

Spacing uses only `--space-1` to `--space-7` (4, 8, 12, 16, 24, 32, 48px). Literal 1px and 2px
values remain only for hairline borders, outline offsets, and optical nudges.

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
- **Chip:** 1px `--border-2` outline, `--text-12` text; buy/sell tones recolor text and border, and
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
