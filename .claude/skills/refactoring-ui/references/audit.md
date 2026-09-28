# Auditing an existing UI

Load this when asked to review, critique, or score a design, page, component, or screenshot.
Load `diagnose.md` alongside it for the symptom → fix table, and `audit-criteria.md` for the
per-principle PASS/FAIL signals.

## Procedure

1. **Collect the input.** A design description, screenshot, or code. Note the context:
   marketing, application, or content. If none is given, ask for the page or component to review.
   When the input is code in a repository, run Step 0 (`design-md.md`) first. Then judge values
   against DESIGN.md: a value that is not one of its tokens is a violation.
2. **Run the ten checks in order** from `audit-criteria.md`. Hierarchy comes first because
   later checks (typography, buttons, contrast) are judged against it:

   ```
   1 visual hierarchy → 2 typography → 3 color palette → 4 spacing → 5 button hierarchy
   → 6 visual clutter → 7 empty states → 8 shadows → 9 contrast → 10 grouping
   ```

   Record each as `PASS`, `PARTIAL`, or `FAIL` with the specific evidence.
3. **Consolidate.** Merge duplicates (cramped spacing surfaces under both 4 and 10), then
   assign severity:
   - **critical**: the primary action or content can't be found, or text fails 4.5:1
   - **high**: a system is missing (no scale, too few greys, no elevation system)
   - **medium**: values off-scale or inconsistent, but hierarchy still reads
   - **low**: polish (icon weight, letter-spacing, decorative leftovers)
4. **Fix from the systems.** Every recommendation names a value from the scales in
   `SKILL.md` or a role in `assets/tokens.css`. No ad hoc values.
5. **Run the checklist below** for personality, copy, responsive, and accessibility, which
   the ten checks don't cover.

## Report format

```json
{
  "overall": "PASS | NEEDS_WORK | FAIL",
  "summary": "2 critical, 3 high, 1 medium",
  "violations": [
    {
      "check": "visual-hierarchy",
      "severity": "critical",
      "issue": "Primary CTA is a grey text link",
      "location": "Hero section",
      "fix": "Solid --action button; demote the secondary link to tertiary styling"
    }
  ],
  "priority_fixes": [
    "1. Make the primary CTA a solid --action button",
    "2. Collapse 9 font sizes to 5 scale values: 12 14 16 20 30"
  ],
  "checks": { "visual-hierarchy": "FAIL", "typography": "PASS", "...": "..." }
}
```

`overall` is `FAIL` with any critical violation, `NEEDS_WORK` with any high, else `PASS`.

**Modes.** *Quick*: report only `FAIL`/`PARTIAL`. *Deep*: include `PASS` rationale per check.
*Fix*: add before/after code for each priority fix.

## Worked example

**Input:** Dashboard screenshot. Four greys, cards with `0 10px 24px` shadows, a filled red
"Delete" beside a filled blue "Save", body text `#888` on white.

**Output (quick mode):**
- critical — contrast: `#888` on white is 3.5:1; use `--text-secondary`
- high — color palette: 4 greys; expand to the 9-step ramp in `assets/tokens.css`
- high — button hierarchy: Delete competes with Save; make Delete tertiary, red only in the confirm dialog
- medium — shadows: static cards at elevation 4; drop to elevation 1 or a border
- overall: `FAIL`

## Checklist

### Personality & Intent
- [ ] Has the design personality been consciously chosen (not defaulted)?
- [ ] Does the color palette match the product's domain and audience?
- [ ] Could someone identify what kind of product this is from the design alone?
- [ ] Does this look like it was designed with intent, or assembled from defaults?
- [ ] Would someone guess an AI generated this? If yes, what's the most generic element?

### Copy
- [ ] Read aloud—does it sound like a person, or like a model trying to sound polished?
- [ ] More than one em-dash per paragraph? Replace with commas or periods.
- [ ] Any "It's not just X, it's Y" / "Whether you're X or Y" / "From X to Y" constructions? Cut or rewrite.
- [ ] Empty intensifiers ("truly," "seamlessly," "incredibly") and clichés ("game-changer," "cutting-edge") removed?
- [ ] Does sentence length vary, or is everything the same medium length?
- [ ] Do CTAs use real verbs ("See pricing") instead of marketing verbs ("Unlock potential")?

### Hierarchy
- [ ] Can you identify the primary action in 2 seconds?
- [ ] Is there clear visual distinction between primary, secondary, and tertiary elements?
- [ ] Are labels de-emphasized relative to values?

### Typography
- [ ] Using a consistent type scale (no arbitrary sizes)?
- [ ] Line length constrained to 45-75 characters?
- [ ] Headings tighter, body text more relaxed line-height?

### Color
- [ ] No pure black (#000) or pure white (#fff) in the UI?
- [ ] Grays have subtle color tint (warm or cool)?
- [ ] All text passes WCAG AA contrast (4.5:1 body, 3:1 large)?

### Spacing
- [ ] Using a consistent spacing scale?
- [ ] Related items grouped tightly, sections separated clearly?
- [ ] Generous padding on cards and sections?

### Components
- [ ] Are components styled for their specific context, not generically?
- [ ] Do card, button, and nav styles vary based on where they appear?

### Responsive
- [ ] Works on 320px screens?
- [ ] Touch targets at least 44x44px on mobile?
- [ ] Typography scales appropriately?

### Accessibility
- [ ] All interactive elements have visible focus states?
- [ ] Not relying on color alone to convey meaning?
- [ ] Semantic HTML structure?


## Common mistakes

1. **Too many font sizes** — Stick to your scale
2. **Not enough contrast** between hierarchy levels
3. **Cramped spacing** — When in doubt, add more
4. **Pure black text** — Use dark gray instead
5. **Border-heavy design** — Try spacing and background colors instead
6. **Inconsistent spacing** — Use your scale religiously
7. **Desktop-first thinking** — Start mobile, enhance up
8. **Arbitrary values** — Every number should come from a system
9. **Removing focus outlines** — Replace, don't remove
10. **Over-animating** — Subtle > flashy
11. **Defaulting to purple/blue gradients** — Pick colors based on domain and audience
12. **Same card style everywhere** — Vary components by context
13. **Picking colors without purpose** — Use color theory, not defaults
14. **SaaS template for everything** — Match layout to content type
15. **Choosing layout before understanding content** — Content drives layout, not the other way around
