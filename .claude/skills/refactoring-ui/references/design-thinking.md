# Design thinking

Decide personality, color intent, layout, and component context before picking values from the scales in `SKILL.md`.

## Design Personality & Tone

Every interface has a personality whether you choose one or not. Choosing intentionally is the difference between a design that feels right and one that feels generic.

### The Personality Spectrum

Plot your design on two axes:

- **Formal ↔ Casual**: How structured and serious vs relaxed and approachable
- **Reserved ↔ Expressive**: How restrained and minimal vs bold and vibrant

Four quadrants:

| | Reserved | Expressive |
|---|---|---|
| **Formal** | Banking, legal, enterprise, government | Luxury brands, high-end retail, fashion |
| **Casual** | Developer tools, documentation, utilities | Gaming, social apps, children's education |

### Mapping Design Signals to Personality

Each visual lever pushes the design toward a quadrant:

- **Border-radius**: 2-4px (formal) → 8-12px (moderate) → 16px+ (casual). Match to personality—don't default to max.
- **Font choice**: Geometric sans like Inter/Roboto (modern, neutral), humanist sans like Source Sans/Nunito (friendly, approachable), serif like Merriweather/Playfair (traditional, authoritative), monospace accents (technical, developer-oriented)
- **Color saturation**: Low/muted (reserved) → high/vibrant (expressive). See Color Theory section.
- **Whitespace density**: Generous (formal, premium) → tight (casual, energetic, data-dense)
- **Shadow style**: Subtle and diffused (reserved) → dramatic with strong offsets (expressive). Or no shadows at all for minimal/flat designs.
- **Imagery style**: Photography (authentic, serious) → illustration (approachable, playful) → icons only (utilitarian, technical)

### Domain Personality Anchors

Use these as starting points, not rigid rules. The specific product and audience always override.

**Fintech / Banking**: Formal + reserved. Muted blues and greens, small border-radius (4-6px), geometric sans-serif, dense data layouts, minimal decoration. Trust is communicated through restraint.

**Healthcare / Medical**: Formal + reserved. Calming blues, greens, or teals. Generous whitespace, clear section breaks, large touch targets. Accessibility is non-negotiable. Avoid anything that feels playful—patients want confidence.

**E-commerce**: Varies by market segment. Budget/mass-market = casual + expressive (bright colors, large CTAs, energy). Luxury = formal + expressive (muted palette, serif headings, dramatic whitespace, restrained CTAs).

**Creative Tools**: Casual + expressive. Bold accent colors against neutral backgrounds. Asymmetric layouts, personality in empty states and onboarding. The tool should feel inspiring, not corporate.

**Education**: K-12 = casual + expressive (warm colors, rounded shapes, friendly type, illustrations). Professional/adult learning = casual + reserved (clean, focused, minimal distraction from content).

**SaaS Dashboards**: Casual + reserved. Neutral base palette with functional color for data and states. Dense but organized. The interface should disappear—users are here for the data, not the design.

**Media / Content**: News = formal + reserved (classic typography, structured grids, minimal color). Entertainment = casual + expressive (bold imagery, vivid color, immersive layouts).

**Developer Tools**: Casual + reserved. Monospace accents, dark mode preference, minimal decoration. High information density done well. Let the content breathe but don't waste space on decoration.

### The "Who Is This For?" Checklist

Before making any visual choices, answer these:

1. **Who is the primary user?** (Age, technical literacy, context of use)
2. **What emotional response should this evoke?** (Trust, excitement, calm, urgency)
3. **What builds trust in this domain?** (Restraint? Polish? Friendliness? Data density?)
4. **What do competitors look like?** (And how should this differentiate without being alien?)
5. **Which personality quadrant does this land in?**


## Color Theory & Psychology

The existing Color section below covers *how* to build palettes with HSL and manage shades. This section covers *which* colors to choose and *why*.

### Color Wheel Fundamentals

Colors divide into warm and cool:

- **Warm side** (red, orange, yellow): These colors advance—they feel closer, more energetic, more urgent. Use them for elements that need attention.
- **Cool side** (blue, green, purple): These recede—they feel farther, calmer, more stable. Use them for backgrounds, containers, and trust signals.

This warm/cool dynamic is a fundamental tool. A dashboard with a cool blue background and warm orange alert badges creates natural visual hierarchy through color temperature alone.

### Color Harmony Schemes

How you combine colors determines the overall feel:

**Analogous** (adjacent hues on the wheel, e.g., blue + blue-green + green):
Cohesive and calm. Low internal contrast. Best for interfaces that should feel unified and serene—content apps, healthcare, meditation. Risk: can feel monotonous without a neutral or accent to break it up.

**Complementary** (opposite hues, e.g., blue + orange):
High energy and contrast. Best for elements that need to pop—CTAs against their background, marketing pages, attention-grabbing moments. Risk: can feel harsh if both colors are at full saturation. Mute one side.

**Split-complementary** (one hue + the two hues adjacent to its complement):
Vibrant but more balanced than straight complementary. Best for designs that need variety without chaos. Gives you a clear primary with two supporting accents.

**Triadic** (three equidistant hues, e.g., red + yellow + blue):
Vibrant and balanced. Best for playful, creative apps. Use with restraint—one dominant, two as accents at lower saturation. Full-strength triadic is overwhelming.

For most product interfaces, **analogous with one complementary accent** is the safest and most professional starting point.

### Color Psychology by Hue

Each hue carries associations. Use these as starting points, then adjust for your specific domain and audience:

**Blue**: Trust, stability, calm, professionalism. The most universally safe choice—which is also why it's overused. Finance, healthcare, enterprise, social media. If you reach for blue, make sure it's because it fits, not because it's default.

**Green**: Growth, health, money, nature, success. Fintech, wellness, sustainability, positive states. Pairs well with blue for trust + growth.

**Red**: Urgency, energy, passion, danger. Food and restaurant apps, entertainment, sale CTAs, error states. Use sparingly in interfaces—a little red goes far. As a primary color, it's intense; as an accent, it's powerful.

**Purple**: Luxury, creativity, mystery, spirituality. Beauty, premium products, creative tools. **Note: AI massively overuses purple/violet as a default.** Only reach for purple if the domain genuinely calls for it.

**Orange**: Warmth, enthusiasm, friendliness, affordability. Social apps, education, CTAs, construction/energy. Less aggressive than red, more energetic than yellow. Underused in product design.

**Yellow**: Optimism, attention, caution, warmth. Best as a highlight or accent—difficult as a primary color because of readability on white backgrounds. Works well for warnings, badges, and drawing focus.

**Neutrals** (grays, off-whites, near-blacks): Sophistication, content-first design. Photography portfolios, editorial sites, developer tools. Letting the content be the color is itself a design choice—and often the most elegant one.

### Cultural Context

Color associations vary by culture. Consider your audience:

- White: purity and cleanliness (Western) vs mourning (parts of East Asia)
- Red: danger and stopping (Western) vs luck and prosperity (Chinese, Indian)
- Green: nature and go (Western) vs Islam (Middle East)
- Yellow: happiness (Western) vs mourning (parts of Latin America)

For global products, lean on blues and greens (most universally positive) and test assumptions with your target audience.

### Saturation as a Design Lever

Saturation is the most underused tool for escaping generic AI design:

- **High saturation**: Energetic, playful, youthful, attention-grabbing. Use for consumer apps, children's products, marketing pages.
- **Low/muted saturation**: Sophisticated, calm, mature, professional. Use for enterprise, healthcare, finance, content-focused apps.
- **The muted palette trick**: Take any hue and reduce saturation by 20-40%. The result instantly looks more intentional and designed. Most AI-generated UIs use fully saturated colors—muting them is the single fastest way to escape the "AI look."
- **Mixed saturation strategy**: Muted base palette for backgrounds and containers, one saturated accent color for primary actions and key data. This creates focus without visual noise.

```css
/* AI default: fully saturated, feels generic */
--primary: hsl(250, 90%, 55%);

/* Muted: same hue, instantly more sophisticated */
--primary: hsl(250, 45%, 50%);

/* Even more restrained: works for enterprise/formal */
--primary: hsl(250, 30%, 45%);
```

### The Palette Decision Tree

1. **Determine personality** (from Design Personality section) → this sets your saturation range
2. **Pick dominant hue** based on color psychology and what your domain needs to communicate
3. **Choose harmony scheme** based on how much variety you need (analogous for calm, split-complementary for energy)
4. **Set saturation** to match personality (formal/reserved = muted, casual/expressive = vivid)
5. **Build the full palette** using the HSL shade-building mechanics in the Color section below


## Layout Decision Framework

Layout should be driven by content and user goals, not by template defaults.

### Content-First Layout Selection

Start by identifying the primary content type, then match the layout pattern:

**Long-form text** (articles, documentation, policies):
Narrow single column, 65ch max-width. Minimal sidebar distractions. Reading is linear—the layout should be too.

**Data comparison** (analytics, pricing, feature comparison):
Multi-column tables or side-by-side panels. Users need to scan horizontally. Dense but aligned.

**Status monitoring** (dashboards, ops consoles, admin overviews):
Dense card grids with visual indicators (color, icons, sparklines). Information density is a feature. Prioritize scanability over aesthetics.

**Media browsing** (galleries, portfolios, product catalogs):
Masonry or uniform grid. Let the content be the design. Minimal chrome, maximum visual real estate.

**Sequential workflow** (onboarding, checkout, multi-step forms):
Stepped/wizard layout. One task per screen. Progress indicator. Remove distractions—hide the main nav if needed.

**Exploration / discovery** (social feeds, marketplaces, content discovery):
Asymmetric layouts, varied card sizes, visual hooks. The layout should invite browsing. Infinite scroll or paginated based on content depth.

### Information Density Spectrum

How much to show at once depends on who's using it and what they need:

**Sparse** (marketing sites, onboarding flows):
Large type (18-24px body), generous whitespace (48-96px between sections), few elements per screen. Every element is a deliberate choice. Padding is a feature.

**Moderate** (most product interfaces):
Standard type (16px body), balanced spacing (24-48px between sections), clear grouping. The workhorse density for most apps.

**Dense** (dashboards, admin panels, developer tools, financial terminals):
Compact type (13-14px body), tighter spacing (12-24px between sections), more elements visible at once. Users are experts—they want data, not whitespace. Still needs clear hierarchy and grouping.

Each density level implies different defaults for your spacing scale, font sizes, component padding, and border-radius.

### Navigation Pattern Selection

Choose based on your app's structure:

- **Top horizontal nav**: Best for marketing sites and apps with fewer than 5 top-level sections. Clean, familiar, leaves vertical space open.
- **Sidebar nav**: Best for apps with 5+ sections, complex hierarchies, or where users switch contexts often. Persistent and scannable.
- **Tab bar**: Best for distinct content views within a section. Keep to 2-5 tabs.
- **Bottom nav (mobile)**: Best for mobile-primary apps with 3-5 core destinations. Thumb-friendly.
- **Hybrid** (top nav + sidebar): Best for documentation sites, complex SaaS. Section navigation up top, page tree in sidebar.

### Domain Layout Profiles

Concrete starting points that reinforce the personality anchors:

**Fintech dashboard**: Sidebar nav with icon + label. Main area: stat cards across the top row, data table or chart below. Dense grid. Muted palette with color reserved for data visualization and status indicators.

**Creative portfolio**: Full-bleed hero image. Asymmetric project grid below. Minimal nav (logo + hamburger, or a few text links). Generous whitespace between projects. Let the work speak.

**Healthcare portal**: Centered layout, max-width ~720px. Clear section headings. Generous padding on form groups. Step-by-step flows for complex tasks. Obvious "next" actions. No dense data on patient-facing screens.

**E-commerce storefront**: Product grid with filters sidebar (collapsible on mobile). Sticky header with cart. Prominent "Add to Cart" CTAs. Quick-view modals for product details. Visual hierarchy: image → price → name → reviews.

**Developer documentation**: Fixed sidebar with collapsible page tree. Narrow content column (~65ch). Code blocks with syntax highlighting and copy button. "On this page" section for long docs. Version selector in top nav.

**Social / community app**: Single-column feed, max-width ~600px. Floating compose button. Inline interactions (like, reply) without page transitions. Infinite scroll. Minimal nav—the feed is the experience.

**Admin panel**: Sidebar nav with grouped sections. Data tables with sort, filter, bulk select. Settings as grouped form sections, not individual pages. Breadcrumbs for deep hierarchies.

**Content / media app**: Wide content area for articles or video. Minimal chrome during consumption. Related content below or in a minimal sidebar. Reading/viewing mode that strips away UI.

### Breaking the Single-Page-App Trap

Not everything belongs on one screen:

- **Multi-step processes**: Use wizard flows. Don't make the user see steps they haven't reached.
- **Infrequent settings**: Separate page or dedicated panel. Don't clutter the main view with rarely-used controls.
- **Complex detail views**: Dedicated page, not inline expansion, when the detail has its own depth (sub-items, related content, actions).
- **Rule of thumb**: If you're scrolling more than 3 viewport heights, the page is doing too much. Consider splitting.

---

## Component Variation by Context

The same component type should look different depending on where it lives and what it's doing. A "card" on an e-commerce site and a "card" on a dashboard are fundamentally different designs that happen to share a name.

### The Principle

Before styling any component, ask: **"What is this component doing here?"** — not "What does a card/button/table look like?"

Context determines:
- Border treatment (none, subtle, prominent)
- Padding density (compact, standard, generous)
- Hover behavior (none, subtle lift, color change, expand)
- Content layout (vertical, horizontal, image-led, text-led)
- Visual weight (background, shadow, border, flat)

### Card Variations

**Product card** (e-commerce):
Image-dominant (60-70% of card height). Tight padding. Price visually prominent. Hover reveals quick-add or size selector. Border-radius matches brand personality.

**Stats card** (dashboard):
Number is the hero—large, bold, maybe colored by status. Compact padding. Optional sparkline or trend indicator. No hover effect needed. Minimal decoration; the data is the design.

**Profile card** (social/team directory):
Avatar-led. Can be horizontal layout (avatar left, info right). Action buttons inline (message, follow). Warmer, more personal treatment—maybe a subtle background color.

**Settings card** (admin/preferences):
Text-heavy, no imagery. Grouped with sibling cards in a stack. Toggle or input on the right. Minimal decoration—functional, not decorative. Consistent with form patterns.

**Content card** (blog, news, media):
Headline-dominant. Metadata (author, date, read time) de-emphasized. Generous whitespace. Hover may show a subtle underline on the title or a background shift. Image optional—not every content card needs a thumbnail.

### Navigation Variations

**Marketing site nav**: Minimal items (4-6 links). Often transparent, overlapping the hero. Logo left, CTA button right. May collapse to hamburger even on tablet for cleanliness.

**App dashboard nav**: Persistent sidebar. Icons paired with labels. Collapsible to icon-only for more content space. Active state clearly marked. Grouped sections with subtle dividers.

**Documentation nav**: Top bar for major sections or version selector. Left sidebar for the page tree with expandable/collapsible groups. "On this page" right sidebar for long documents.

**Mobile app nav**: Bottom tab bar with 3-5 items. Icons with short labels. Active state uses color, not just weight. Middle item can be a prominent action (compose, add). Avoid hamburger menus for primary navigation on mobile.

### Button Variations

**Dense data UI** (dashboards, tables, admin):
Smaller (text-sm, py-1.5 px-3). May be icon-only with tooltip. Ghost or outline style to reduce visual noise. Grouped buttons use a button group pattern.

**Marketing page**:
Larger (text-lg, py-3 px-8). Bold color fill. More horizontal padding for presence. May have an icon or arrow. Primary CTA is unmissable; secondary is clearly subordinate.

**Form context**:
Aligned with input heights. Same border-radius as inputs. Placed at the bottom-right of the form (or full-width on mobile). Submit button is primary; cancel is ghost/text-only.

**Destructive context**:
Muted by default—not screaming red. Use muted red text or outline style. On hover or in a confirmation dialog, the full red treatment appears. Never make destructive actions the most visually prominent element on the page.

### Table Variations

**Financial / numeric data**:
Right-aligned numbers for decimal alignment. Alternating row backgrounds for scannability. Compact row height. Fixed header on scroll. Monospace or tabular-nums font feature for number columns.

**Admin panel**:
Checkbox column for bulk selection. Action column with icon buttons or dropdown. Sortable column headers. Row hover highlights. Inline editing for single-value text or number cells.

**Comparison table** (pricing, features):
Highlighted "recommended" column. Sticky header row. Feature names in the left column. Check/cross icons for boolean features. Can alternate between rows and a card-based layout on mobile.

### The Component Context Checklist

Before styling any component, answer:

1. **What's the information density of this page?** (Sparse/moderate/dense → determines padding and size)
2. **What's the primary user action near this component?** (Component styling shouldn't compete with the main CTA)
3. **What personality did we establish?** (Formal components look different from casual ones)
4. **Is this the focus or supporting cast?** (Hero components get decoration; supporting components stay quiet)
