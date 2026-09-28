# Audit criteria

PASS/FAIL checks for the ten Refactoring UI principles. Run them in this order from `audit.md`. Each check lists its pass and fail signals, the failure modes it catches, and one worked assessment.

## 1. Establish Visual Hierarchy

Determine what UI element should draw attention first, second, third. Visual hierarchy controls the order in which users process information using size, weight, color, and de-emphasis strategies.

### PASS
- Most important element has highest visual weight
- Hierarchy uses weight/color, not just size
- Surrounding elements are subdued
- Clear visual path: primary → secondary → tertiary

### FAIL
- Relying solely on font size
- Everything equally emphasized
- Critical elements buried
- Decorative elements competing

### Failure modes

| Anti-Pattern | Why It Fails | Fix |
|--------------|--------------|-----|
| Logo larger than headline | Brand over value | Reduce logo, increase headline |
| 60px headline, 12px body | Size extremes | Use 36px + weight, 16px body |
| All bold text | Nothing stands out | Use weight hierarchy |
| Large section titles | Content buried | Make titles smaller than content |

### Example assessment

See `../examples/visual-hierarchy.md` for a worked before/after.

## 2. Apply Typography Scale

Create clear typographic hierarchy using a hand-crafted set of font sizes, weights, and colors.

### PASS
- Scale uses a small set of intentional sizes with clear jumps between roles
- Type hierarchy combines size, weight, line-height, and color
- Body text remains readable across marketing, app, and content contexts
- Line length and line-height fit the reading context

### FAIL
- Scale relies on tiny increments that do not create hierarchy
- Font weights are too light for UI text
- Long-form text lines are too wide or cramped
- `em` sizing compounds unpredictably in nested elements

### Failure modes

| Failure | Example | Fix |
|---------|---------|-----|
| **Em units** | `1.25em` parent, `0.875em` child = 17.5px | Use `px` or `rem` |
| **Micro-steps** | 16px, 17px, 18px | Pick from the scale: 16px, 20px, 24px |
| **Weight 300** | Light body text | Minimum 400 |
| **Long lines** | 100+ characters | Constrain to 35em |
| **Uniform line-height** | 1.5 for all | Vary by size |

### Scales by context

#### Marketing Page
```
Hero:     48-60px,  weight 700,  line-height 1
H1:       36px,     weight 700,  line-height 1.2
H2:       30px,     weight 600,  line-height 1.25
Body:     16-18px,  weight 400,  line-height 1.6
Small:    14px,     weight 400,  line-height 1.6
Caption:  12px,     weight 400,  line-height 1.5
```

#### Application/Dense UI
```
H1:     30-36px,  weight 700
H2:     24px,     weight 600
H3:     20px,     weight 600
H4:     16px,     weight 600
Body:   14-16px,  weight 400
Small:  12px,     weight 400
```

### Example assessment

**Input:** Settings page using 13px, 15px, 17px, 22px and 26px text; headings at weight 300; body `line-height: 1.5` everywhere; paragraphs span 1100px.

**Evaluation:** FAIL
- Five sizes, none on the scale, with 13–15% steps that don't read as hierarchy
- Weight 300 headings: too light for UI text
- Uniform line-height; 1100px lines run well past 75 characters

**Recommendation:**
- Map to the scale: 12 (meta), 14 (secondary), 16 (body), 20 (section), 24 (page title)
- Headings 600, body 400
- Headings `line-height: 1.25`, body 1.6; paragraphs `max-width: 35em`

## 3. Build Color Palette

Create a comprehensive, systematic color palette with enough shades to build realistic interfaces: 8-10 greys, 5-10 primary shades, and 5-10 shades per accent.

### PASS (Good Color Palette)
- **Greys: 8-10 shades** - For text, backgrounds, panels, form controls (majority of UI)
- **Primary: 5-10 shades** - One or two core colors for primary actions, active navigation
- **Accent: 5-10 shades each** - For semantic states (red, yellow, green), new features, categorization
- **Systematic shades**: Each color has light to dark variants defined upfront
- **Clear hierarchy**: Primary color defines overall look; accents used sparingly
- **Contrast**: All text meets WCAG AA (4.5:1 for normal, 3:1 for large)
- **Shades defined up front**: every shade is a named token (HSL preferred), not derived at runtime

### FAIL (Poor Color Palette)
- Too few greys (3-4 shades leading to compromises)
- Missing shades of primary color (can't create hover states, subtle backgrounds)
- Not enough accent colors for semantic states and categorization
- **Using opacity (rgba) or `lighten()` instead of defined shades** (inconsistency)
- Missing systematic shade progression (arbitrary light/dark variants)
- Insufficient contrast for accessibility

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **5-Color Generator** | Using only 5 hex codes for entire UI | Build comprehensive palette with 8-10 greys, 5-10 primary shades, 5-10 accent shades |
| **Too Few Greys** | 3-4 grey shades leading to compromises | Expand to 8-10 greys from near-white to near-black |
| **Opacity for Shades** | Using `rgba()` or `lighten()` to create lighter/darker | Define every shade as an explicit HSL token up front |
| **Missing Hover States** | No lighter/darker variants for interactions | Each interactive color needs 5-10 shades |
| **Missing Semantic Colors** | Only brand colors, no red/yellow/green | Add accent colors for errors, warnings, success |
| **Too Few Accent Shades** | Only one shade of red/green/yellow | Each accent needs 5-10 shades for flexibility |
| **True Black Text** | Using #000000 (harsh) | Start with #111827 or #1F2937 |

### Example assessment

**Input:** Palette with only: Brand Blue #0066FF, Light Blue #E6F2FF, White, Grey #999999, Black

**Evaluation:** FAIL
- Only 2 blue shades (need 5-10)
- Only 1 grey (need 8-10)
- Missing semantic colors (red, yellow, green)
- Missing accent shades

**Recommendation:**
Build comprehensive palette:

**Greys (10):**
#F9FAFB, #F3F4F6, #E5E7EB, #D1D5DB, #9CA3AF, #6B7280, #4B5563, #374151, #1F2937, #111827

**Primary Blue (8):**
#EFF6FF, #DBEAFE, #BFDBFE, #93C5FD, #60A5FA, #3B82F6, #2563EB, #1D4ED8

**Accents (7-8 each):**
- Red: #FEF2F2... #991B1B (for errors, destructive)
- Yellow: #FFFBEB... #92400E (for warnings, new features)
- Green: #F0FDF4... #166534 (for success, positive)

Total: 10 greys + 8 primary + 21 accents = 39 shades organized systematically

## 4. Apply Consistent Spacing

Use a systematic spacing scale to create rhythm, group related elements, and separate distinct sections while starting with generous whitespace (one scale step more than looks necessary) and removing it until the related groups read as groups.

### PASS (Good Spacing)
- Uses systematic scale with minimum 25% jumps between values (12px → 16px → 24px → 32px)
- Related elements have smaller gaps (4-16px within groups)
- Unrelated sections have larger gaps (24-64px between groups)
- **More space around groups than within groups** (ambiguous spacing avoided)
- Consistent internal padding (cards, buttons, inputs)
- White space creates breathing room (doesn't fill entire screen width)
- Uses whitespace instead of borders for separation

### FAIL (Poor Spacing)
- Arbitrary values without system (13px, 27px, 41px)
- Values too similar (<25% difference - can't distinguish)
- Related elements too far apart (weakens grouping)
- Unrelated elements too close together (ambiguous relationships)
- **Equal spacing everywhere** (within groups = between groups)
- Content stretched to fill wide canvas unnecessarily
- Using borders when whitespace would suffice

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **Arbitrary Values** | 15px here, 17px there | Use systematic scale exclusively |
| **Weak Grouping** | Equal spacing within and between groups | Make between-group spacing significantly larger |
| **Ambiguous Spacing** | Label and input have same margin | Reduce within-group, increase between-groups |
| **Border-Dependence** | Using borders instead of space | Increase gap, remove border |
| **Canvas Filling** | Content stretched to 1200px unnecessarily | Use only the space needed; let whitespace fill rest |
| **Minimal Breathing Room** | Adding just enough space to not look bad | Start with excess, remove until right |
| **Inconsistent Padding** | One button 8px, the next 12px | Pick one scale value, apply everywhere |

### Example assessment

**Input:** Form with: Title (margin-bottom: 16px), Label (margin-bottom: 12px), Input (margin-bottom: 12px), next Label (margin-top: 12px)

**Evaluation:** FAIL - Ambiguous spacing
- Label to Input: 12px
- Input to next Label: 12px
- No clear grouping - user can't tell which label belongs to which input

**Recommendation:**
- Title margin-bottom: 24px (separate section)
- Label margin-bottom: 4px (tight coupling to input)
- Input margin-bottom: 24px (clear separation to next group)
- Result: Within-group (4px) << Between-groups (24px) = Clear relationship

**Before:**
```
Label A
[Input A]
Label B    <- Ambiguous: belongs to A or B?
[Input B]
```

**After:**
```
Label A
[Input A]

Label B    <- Clearly belongs to B
[Input B]
```

## 5. Design Button Hierarchy

Create clear distinctions between primary, secondary, and tertiary actions so users know which action to take.

### PASS (Good Button Hierarchy)
- **One clear primary action** per screen/section (filled, high contrast, brand color)
- **Secondary actions** visually subordinate (outlined, ghost, or lower contrast solid including grey)
- **Tertiary actions** minimal (text link or subtle)
- Clear visual distinction between levels (not subtle 10% differences)
- Destructive actions (delete) use red but don't compete with primary

### FAIL (Poor Button Hierarchy)
- Multiple buttons with equal visual weight
- Primary action not obvious
- Very light grey (200) secondary looks disabled
- Destructive actions draw more attention than primary
- All buttons filled with same color

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **Button Battle** | Save and Cancel both filled brand | Make Cancel outline or grey solid |
| **Gray Button Confusion** | Very light grey (200) secondary looks disabled | Use grey 400-500 or outline, not near-white grey |
| **Red Alert** | Delete button more prominent than primary | Make delete text-only or smaller |
| **Primary Overload** | 3+ "primary" buttons | Choose one primary, demote others |
| **Invisible Tertiary** | Text links same color as body | Use brand color or underline |

### Example assessment

**Input:** Modal with "Save Changes" (filled blue), "Cancel" (filled grey), "Delete" (filled red)

**Evaluation:** PARTIAL
- Cancel: Grey filled is acceptable secondary treatment (lower contrast solid)
- Delete: Filled red competes with Save (should be text red)
- Issue: Two actions with solid fills competing

**Recommendation:**
- Save: Keep filled blue (primary)
- Cancel: Grey filled is acceptable, but could be outline for clearer distinction
- Delete: Change to text red (destructive shouldn't compete)

## 6. Eliminate Visual Clutter

Remove unnecessary visual elements (borders, backgrounds, shadows, decorations) that don't serve functional purposes.

### PASS (Clean Design)
- Every visual element serves a functional purpose
- Whitespace used instead of borders to separate
- No decorative shadows or gradients without purpose
- Backgrounds used sparingly (not every card needs one)
- Minimal separator lines

### FAIL (Cluttered Design)
- Borders on everything ("boxy" look)
- Shadows used decoratively
- Multiple separator lines between sections
- Background colors on every component
- Decorative elements that don't communicate meaning

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **Border-itis** | Every element has a box around it | Remove 50%+ of borders, use space |
| **Shadow Spam** | Shadows on static elements | Reserve for hover states and modals |
| **Separator Overload** | Lines between every section | Remove half, double the space |
| **Background Soup** | Every card has a gray background | Use white with space, or subtle border |
| **Icon Explosion** | Icons on every label and button | Keep only when they add meaning |
| **Gradient Gone Wild** | Decorative gradients everywhere | Flatten or use one purposeful gradient |

### Example assessment

**Input:** Card with: border (1px gray), background (#f5f5f5), shadow (sm), title with icon, separator line, content, separator line, footer with icon and text

**Evaluation:** FAIL (cluttered)
- Border + background + shadow = overkill
- Two separator lines unnecessary
- Icons may be decorative

**Recommendation:**
- Remove background (use white)
- Remove shadow (static card doesn't need elevation)
- Keep border OR use generous padding
- Remove separator lines, increase section padding
- Evaluate icons for meaning, remove if decorative

## 7. Design Empty States

Create helpful, actionable empty/zero states that guide users forward instead of leaving them at a dead end.

### PASS (Good Empty State)
- Explains what would be here (sets expectation)
- Tells user how to add content (clear instruction)
- Provides clear primary action button
- Uses an icon or illustration that depicts the missing content (a folder for no files, a chart for no data), not a generic mascot
- Friendly, helpful tone (not "No items found")
- Hides useless UI (tabs, filters that don't work without content)

### FAIL (Poor Empty State)
- Blank screen or just "No data"
- Technical error message as empty state
- No guidance on what to do next
- Generic illustration unrelated to context
- Dead end with no actions

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **The Void** | Blank white space | Add context, illustration, CTA |
| **Error as Empty** | "404" or "Null" message | Distinguish error states from empty states |
| **No Way Forward** | Message but no action | Always provide primary CTA |
| **Generic Illustration** | Unrelated cute character | Use an icon of the missing content type (e.g. an inbox for no messages) |
| **Negative Framing** | "You have no friends" | Positive framing: "Connect with people" |
| **Too Much Info** | Paragraphs of text | Keep to 1-2 sentences + CTA |

### Example assessment

**Input:** Dashboard showing "No data available" in small gray text, no other content

**Evaluation:** FAIL
- Negative framing
- No context about what should be here
- No action to take
- Visual treatment too subtle

**Recommendation:**
- Headline: "No reports yet"
- Description: "Create your first report to start tracking metrics"
- Primary button: "Create Report"
- Optional: Small illustration or icon
- Consider: Template/example preview

## 8. Use Shadows Appropriately

Add depth and elevation only when functionally necessary, avoiding decorative shadows.

### PASS (Shadows Match Elevation)
- **Small shadows on cards** (subtle, less distracting than borders) ✅
- **Modals/dialogs**: Large shadow (elevated above all content)
- **Dropdowns/menus**: Medium shadow (above page, below modals)
- **Cards**: Subtle or no shadow (flat design preferred)
- **Hover states**: Subtle shadow increase (affordance for clickability)
- **Static elements**: No shadow
- Consistent elevation system: the five levels in `SKILL.md`, applied by z-position

### FAIL (Inappropriate Shadow Usage)
- **Large decorative shadows on static cards**
- Heavy shadows on static content
- Inconsistent shadow values
- Decorative shadows that don't indicate elevation
- Shadows on text or icons

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **Shadow Carpet** | Every card has a shadow | Flatten static cards, subtle shadows OK |
| **Drop Shadow Abuse** | Heavy shadows on static elements | Reserve for elevation/interaction |
| **Inconsistent Depth** | Similar elements different shadows | Use the five elevation tokens, one per z-position |
| **Black Shadows** | Pure black shadows (harsh) | Use low-opacity `hsla()` shadows, optionally tinted toward the background hue |
| **No Modal Separation** | Modal doesn't feel above page | Increase shadow spread and blur |

### Example assessment

**Input:** Page with card shadows (`0 4px 6px rgba(0,0,0,0.1)`), button shadows (`0 2px 4px`), modal shadow (`0 4px 6px`), text with text-shadow

**Evaluation:** FAIL (cluttered)
- Cards don't need shadows (static content)
- Modal shadow same as cards (should be higher)
- Text shadow decorative

**Recommendation:**
- Remove card shadows OR use the lowest elevation (`0 1px 3px`)
- Remove text shadow
- Modal: highest elevation (`0 15px 35px hsla(0,0%,0%,.2)`)
- Buttons: Optional subtle hover shadow only

## 9. Manage Color Contrast

Ensure text and interactive elements meet WCAG AA contrast against their backgrounds: 4.5:1 for body text, 3:1 for large text and UI boundaries.

### PASS (Good Contrast)
- **Normal text**: 4.5:1 minimum (WCAG AA)
- **Large text (≥ 24px regular or ≥ 18.66px bold)**: 3:1 minimum
- **UI components (buttons, inputs)**: 3:1 minimum for boundaries
- **Focus indicators**: 3:1 minimum against adjacent colors

### FAIL (Poor Contrast)
- Light gray text on white (< 4.5:1)
- White text on light colors
- Disabled states that look like active (too much contrast)
- Placeholder text same as input text

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **Light Gray Text** | #999 or lighter for body text | Use #666 minimum, #333 preferred |
| **Ghost Text** | Placeholder same as value | Make placeholder lighter (#999) |
| **Low-contrast Primary** | Brand color too light for white text | Darken brand color or use dark text |
| **Subtle Links** | Links barely different from text | Add underline or increase contrast |
| **Disabled Confusion** | Disabled buttons too prominent | Use `--text-disabled` on a grey surface, or a value from the fixed opacity scale |
| **Icon Fade** | Icons too light to see | Match text color or use higher contrast |

### Contrast on white

| Text Color on White | Ratio | Pass AA? |
|---------------------|-------|----------|
| #000000 (black) | 21:1 | ✓ (passes, but use a near-black grey instead) |
| #333333 | 12.6:1 | ✓ |
| #666666 | 5.9:1 | ✓ |
| #757575 | 4.6:1 | ✓ (minimum) |
| #999999 | 2.8:1 | ✗ |
| #CCCCCC | 1.6:1 | ✗ |

### Example assessment

**Input:** Body text #888888 on white background

**Evaluation:** FAIL
- Ratio: ~3.5:1
- Below 4.5:1 requirement

**Recommendation:**
Change to #666666 (5.9:1) minimum
Prefer #333333 or #1A1A1A for body text

## 10. Group Related Elements

Use proximity and spacing to visually group related elements together and separate unrelated groups.

### PASS (Good Grouping)
- Related elements have small gap (8-16px)
- Unrelated groups have larger gap (24-48px)
- Form labels close to their inputs (4-8px)
- Sections clearly separated
- Hierarchy of space: tightest within component, looser between components, loosest between sections

### FAIL (Poor Grouping)
- Uniform spacing everywhere
- Labels far from inputs
- Related elements visually disconnected
- Unrelated elements too close
- Using borders instead of space to group

### Failure modes

| Failure | Description | Fix |
|---------|-------------|-----|
| **The Great Divide** | Equal spacing everywhere | Tighten within groups, expand between groups |
| **Label Drift** | Labels 20px+ from inputs | Reduce to 4-8px |
| **Section Smush** | Sections barely separated | Add 48px+ between major sections |
| **Border Dependency** | Boxes around everything | Use space instead of borders |
| **Card Clump** | Cards touching each other | Add 16-24px gap between cards |

### Example assessment

**Input:** Form with: Title (24px margin), Label (8px margin), Input, Label (8px), Input, Section header (16px margin), Label (8px), Input

**Evaluation:** PARTIAL
- Label to input spacing not specified
- Section header too close to previous section
- Consistent 8px but not creating hierarchy

**Recommendation:**
- Label to input: 4px (tight coupling)
- After input group: 24px
- Section header margin-top: 48px (clear break)
- Within section: 16px between fields
