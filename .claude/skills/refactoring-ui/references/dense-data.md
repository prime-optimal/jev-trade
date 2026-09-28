# Dense data screens

Dashboards, trading desks, logs, and analytics views are mostly charts and numbers. The same
systems apply: every size, gap, and color still comes from a scale. What changes is that the
data carries the hierarchy, so chrome gets quieter and numbers get more careful.

## Numbers

- Use `font-variant-numeric: tabular-nums` anywhere numbers stack or update in place: tables,
  stat rows, tickers, axis labels. Proportional digits make live values jitter.
- Right-align numeric columns so decimals line up. Keep units and signs in the same column
  width, e.g. always show `+` for positive deltas when negatives show `-`.
- Fix precision per quantity, not per value. A price column with `1.2`, `1.25`, and `1.250`
  reads as three different things.
- The headline number is the hero: larger size, primary text color. Its label is small and
  secondary. The label sits above or before the number, never competing with it.
- Show "n/a", "pending", or a dash for missing values in secondary color. Never `0` for
  unknown, and never an empty cell that shifts alignment.

## Signed values and zero lines

- Values that can be positive or negative (PnL, markouts, deltas) get a visible zero line.
  Bars grow up or right from it for positive and down or left for negative.
- Color positive and negative with one semantic pair, and pair it with a non-color cue: the
  sign, an arrow, or position relative to the zero line.
- Scale diverging bars symmetrically around zero unless the domain is known to be lopsided,
  and state the scale (`+32 / -32 bps`) so bar length can be read.

## Small charts

- **Sparklines** show shape, not values. No axes, no gridlines, one stroke weight. Mark only
  what the reader needs: the last value, an entry line, or a decision point.
- **Bars in tables** (depth, volume, share) sit behind or beside the number, aligned to one
  edge, in a tint of the row's semantic color. The number stays readable on top.
- **Gauges and meters** need their full range drawn as a track, so 30% reads as 30% of
  something. Label the value in text too.
- Distinguish series by lightness within one hue before reaching for more hues. Reserve
  saturated color for the thing the reader is looking for.
- Axis and gridline colors are decorative dividers: quieter than any text, and exempt from the
  3:1 functional border minimum. Axis *labels* are text and need 4.5:1.

## Density

- Dense is a deliberate choice recorded in DESIGN.md, not a default. Tighten spacing by
  stepping down the spacing scale, never by inventing in-between values.
- Tighten padding inside panels before tightening gaps between panels. Groups still need more
  space around them than within them.
- Panels that scroll independently need a fixed viewport-height layout: the page itself does
  not scroll, each pane does. Check this explicitly; it is the most common dense-layout bug.
- Labels in dense rows truncate with an ellipsis and a title or tooltip. They never wrap and
  push the row height around.

## Verify

Charts break in ways lint cannot see. Render the screen with real or realistic data (long
labels, negative values, missing values, the largest expected magnitude) and check:

- every chart label stays inside its container
- signed values render on the correct side of the zero line
- empty and pending states render as text, not as a blank chart
