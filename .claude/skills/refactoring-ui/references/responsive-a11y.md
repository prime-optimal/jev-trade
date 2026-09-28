# Responsive, dark mode, forms, accessibility, motion

## Mobile-First Responsive Design

### Why Mobile-First

Start with the mobile layout, then add complexity for larger screens. Benefits:
- Forces prioritization of content
- Simpler base styles
- Progressive enhancement (works everywhere, better on larger screens)

### Breakpoint Strategy

Don't design for specific devices. Use content-based breakpoints:
- Add a breakpoint when the layout breaks, not at arbitrary screen sizes
- Common ranges: ~640px (sm), ~768px (md), ~1024px (lg), ~1280px (xl)

### Mobile-First Patterns

**Start simple, enhance up:**

```css
/* Mobile: stack vertically */
.card-grid {
  display: grid;
  gap: 1rem;
}

/* Tablet+: 2 columns */
@media (min-width: 768px) {
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}

/* Desktop: 3 columns */
@media (min-width: 1024px) {
  .card-grid { grid-template-columns: repeat(3, 1fr); }
}
```

### Touch Targets

Size mobile buttons and interactive elements for fingers, not cursors:
- **Minimum**: 44x44px (Apple HIG) or 48x48px (Material)
- Add padding to small elements to increase hit area without visual bulk

### Typography Scaling

Reduce heading sizes on mobile—there's less room for drama:

```css
h1 {
  font-size: 1.875rem; /* 30px mobile */
}

@media (min-width: 768px) {
  h1 { font-size: 2.5rem; } /* 40px tablet+ */
}

@media (min-width: 1024px) {
  h1 { font-size: 3rem; } /* 48px desktop */
}
```

## Dark Mode Design

Dark mode isn't just inverting colors. It requires a different approach:

### Reduce Contrast, Not Invert

- **Don't use pure white text** on dark backgrounds—it's too harsh. Use `gray-100` or `gray-200`
- **Don't use pure black backgrounds**—use `gray-900` or `gray-950` (e.g., `#0f172a`)
- **Reduce elevation shadows**—they're less visible on dark; use subtle borders or lighter backgrounds instead

### Color Adjustments

Override semantic roles, never raw ramps. `assets/tokens.css` ships a verified dark block:
components reference `--surface`, `--text-primary`, `--action` and friends, and only those
roles change under `prefers-color-scheme: dark`.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --surface:        var(--grey-900);  /* never pure black */
    --surface-raised: var(--grey-800);  /* raised = lighter */
    --text-primary:   var(--grey-200);  /* not pure white */
    --text-secondary: var(--grey-300);
  }
}
```

### Saturation Shifts

Colors appear more vibrant on dark backgrounds. **Reduce saturation** slightly for primary colors in dark mode to avoid overwhelming the user.

### Surface Hierarchy

Use lighter surfaces (not shadows) to indicate elevation: base `--grey-900`, raised
`--grey-800` plus a `--border-strong` hairline. Going lighter than `--grey-800` for raised
surfaces drops tertiary text below 4.5:1, so add the hairline instead of more lightness.

---

## Form Design Patterns

Forms are where users do work. Make them effortless:

### Input Styling

```css
/* Well-designed input */
.input {
  @apply w-full px-3 py-2
         text-gray-900 placeholder-gray-400
         bg-white border border-gray-300 rounded-lg
         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
         transition-shadow duration-150;
}
```

### Label Placement

- **Above the input** (not inline) for most forms—clearer scanning
- **Floating labels** only if space is extremely tight
- **Required indicators**: Use `*` after the label, not before

### Error States

- Change border to `border-red-500`
- Add error icon inside input (right side)
- Show error message below input in `text-red-600 text-sm`
- Don't just rely on color—add an icon or text

### Field Grouping

```html
<!-- Group related fields visually -->
<fieldset class="space-y-4">
  <legend class="text-sm font-medium text-gray-700">Billing Address</legend>
  <!-- address fields with tighter spacing -->
</fieldset>

<!-- Separate groups with more space -->
<fieldset class="space-y-4 mt-8">
  <legend class="text-sm font-medium text-gray-700">Payment Method</legend>
  <!-- payment fields -->
</fieldset>
```

### Button Placement

- Primary action on the **right** (or bottom-right for forms)
- Secondary/cancel action on the **left** with less visual weight
- Destructive actions should require confirmation

---

## Accessibility Beyond Contrast

Accessibility is design quality, not a checkbox:

### Focus States

**Every interactive element needs a visible focus state.** Don't remove outlines without replacing them:

```css
/* Bad - removes accessibility */
:focus { outline: none; }

/* Good - replaces it with a visible 3:1 ring, keyboard focus only */
:focus-visible {
  outline: 2px solid var(--border-strong);
  outline-offset: 2px;
}

/* Tailwind shorthand */
.btn { @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2; }
```

### Motion Sensitivity

Respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Interactive Element Sizing

- **Minimum touch target**: 44x44px (48x48px preferred)
- **Spacing** between clickable elements (at least 8px gap)
- **Large enough text** in buttons—minimum 14px

### Semantic HTML

- Use `<button>` for actions, `<a>` for navigation
- Use heading hierarchy (`h1` → `h2` → `h3`), don't skip levels
- Use `<nav>`, `<main>`, `<aside>`, `<footer>` landmarks
- Add `aria-label` when visual context isn't enough

---

## Subtle Animation & Transitions

Motion should feel natural, not distracting:

### Timing Principles

- **Micro-interactions**: 100-200ms (hover, focus, toggle)
- **Small transitions**: 200-300ms (dropdowns, tooltips)
- **Larger transitions**: 300-500ms (modals, page transitions)
- **Never exceed 500ms** for UI—it feels sluggish

### Easing Functions

```css
/* Enter: start fast, end slow (ease-out) */
.dropdown-enter { transition: all 200ms ease-out; }

/* Exit: start slow, end fast (ease-in) */
.dropdown-exit { transition: all 150ms ease-in; }

/* UI interactions: smooth (ease-in-out) */
.btn { transition: all 150ms ease-in-out; }
```

### What to Animate

**Do animate:**
- Background color on hover
- Transform (scale, translate) for emphasis
- Opacity for appear/disappear
- Box-shadow for elevation changes

**Don't animate:**
- Width/height (causes layout shift—use transform: scale instead)
- Anything that triggers layout recalculation
- Too many things at once

### Hover Feedback

```css
/* Subtle but noticeable */
.card {
  @apply transition-all duration-150 ease-in-out
         hover:shadow-md hover:-translate-y-0.5;
}

.btn {
  @apply transition-colors duration-150
         hover:bg-blue-600;
}
```
