# Breaking AI defaults

Load when building new UI or writing interface copy. Generated UI and copy share recognizable defaults; this file lists them and their antidotes.

## Breaking AI Defaults

AI agents gravitate toward the statistical average of their training data. This section names those defaults explicitly so you can avoid them.

### The Usual Suspects

These are the patterns that make users say "this looks AI-generated":

1. **Purple/blue gradient backgrounds** — Applied to headers, heroes, cards, buttons, everything
2. **Maximum border-radius everywhere** — `rounded-2xl` or `rounded-full` on every element regardless of context
3. **Generic SaaS hero** — Gradient text headline, vague subheading, "Get Started" button, decorative blobs
4. **The 3-card grid** — Three identical cards in a row for every feature/benefit/pricing section
5. **Shadows on everything** — Every card and button has `shadow-lg`, creating a "everything floats" look
6. **Indigo/violet as the default color** — When no color is specified, AI reaches for purple
7. **SaaS landing page template** — Hero → features grid → testimonials → CTA. Applied to every project regardless of what it actually is
8. **Uniform rhythm** — Every section has identical spacing, creating a monotonous visual beat

### Why This Happens

Training data is heavily weighted toward SaaS marketing sites, Tailwind UI examples, and component libraries. These are well-designed in context, but when every project draws from the same well, everything looks the same. The agent produces the statistical average of "modern web design."

### The Antidote

For each default, a concrete alternative:

**Gradients** → Use solid colors. If you want depth, try subtle texture, a single-tone background with a contrasting element, or reserve gradients for one small accent (a progress bar, a status indicator) rather than a full section.

**Max border-radius** → Match radius to personality. A formal financial app: 4-6px. A friendly consumer app: 8-12px. Full rounding only for specific elements like avatars and tags. Consistency matters more than roundness.

**Generic heroes** → Design the hero around the actual product. Show the product, show a real use case, or skip the hero entirely. The best hero is often just a clear headline and a focused CTA with no decorative elements.

**3-card grid** → Ask what the content actually is. Features might work as an icon list. Pricing works as a comparison table. Testimonials work as a single rotating quote. Use the layout that serves the content, not the template that's familiar.

**Shadows everywhere** → Use borders, background color differences, or just whitespace to create separation. Shadows should indicate *elevation*—interactive elements that float above the page (dropdowns, modals). If everything has a shadow, nothing is elevated.

**Default indigo** → Run through the Color Theory section. Pick a hue based on what the product communicates, not what feels safe. An earth-tone palette, a warm gray with terracotta accents, or a monochrome scheme with one vivid accent all feel more intentional than indigo.

**SaaS template for everything** → Reference the Design Personality and Layout Decision Framework sections first. A healthcare portal doesn't need a hero section. A dashboard doesn't need testimonials. Build the layout around what the user needs, not what a landing page template provides.

**Uniform rhythm** → Vary section spacing based on content relationships. Related content sections: 48px gap. Major topic shifts: 96px gap. The most important section gets the most breathing room. Visual rhythm should have variation, like music.

### The AI Gut-Check

Before finalizing any design, ask:

> "If I showed this to a developer, would they guess an AI made it?"

If yes, identify the most generic element—it's usually the color scheme or the layout structure—and make it specific to the project using the frameworks above.

---

## Writing Copy That Doesn't Read Like AI

Visual choices give away AI-generated UI, but copy gives it away just as fast. The goal isn't "good marketing copy"—it's prose that reads like a writer at the New York Times wrote it, not a language model trying to sound polished.

### The Tells

The patterns that scream "AI wrote this":

1. **Em-dash addiction** — Every other sentence has one—often where a comma, period, or parenthetical would do the job better. AI reaches for the em-dash as a default rhythm break.
2. **Choppy sentence fragments. Used for emphasis. Way too often.** — Short staccato sentences strung together to feel punchy. Real writers vary cadence.
3. **"It's not just X, it's Y"** — And its cousins: "More than just X." "Not only X, but Y." These parallel constructions are a reflex, not a thought.
4. **"Whether you're X or Y"** — Followed by a list of two contrived audiences that supposedly both benefit. Almost always cut-able.
5. **"From X to Y"** — "From startups to enterprises." "From idea to launch." The lazy way to suggest range.
6. **Tricolons everywhere** — "Fast, simple, powerful." "Built for speed, scale, and security." Three-item lists in every sentence becomes a tic.
7. **Empty intensifiers** — "Truly," "genuinely," "incredibly," "seamlessly," "effortlessly." Words that add syllables but no meaning.
8. **Marketing clichés** — "Game-changer," "revolutionary," "cutting-edge," "best-in-class," "next-generation," "world-class." Drop them.
9. **The hollow opener** — "In today's fast-paced world..." "Imagine a world where..." "We live in an age of..." Nobody talks like this.
10. **Uniform sentence length** — Real writing has rhythm: a long winding sentence followed by a short one. Three medium-length sentences in a row is the AI default.
11. **Gerund-stacked bullets** — Every bullet starts with "Building," "Creating," "Designing," "Empowering." Parallel structure taken to the point of monotony.
12. **The mandatory CTA verb** — "Unlock," "discover," "transform," "elevate." Pick a real verb that describes what actually happens when they click.

### The Antidote

For each tell, the fix:

**Em-dashes** → Use commas when a comma works. Use periods when a period works. An em-dash is for a sharp aside or a dramatic break—not as a default connector. If you have more than one em-dash in a paragraph, you almost certainly have one too many. A single em-dash can be powerful; three in a row is a tic.

**Choppy fragments** → Let sentences breathe. A thought that could be expressed as one flowing sentence with commas usually should be, because chained fragments feel breathless and start to read like a press release written in a hurry. Vary length: short sentence after long, long after short. Read it aloud—if you can't get through it without sounding like you're delivering bullet points, rewrite.

**"It's not just X, it's Y"** → Just say Y. If X needs to be acknowledged, give it its own sentence with its own thought, not as a foil for the real point.

**"Whether you're X or Y"** → Pick the actual user. If the copy genuinely serves two distinct audiences, write to one at a time. Generic "whether you're" framing serves neither.

**"From X to Y"** → Name a specific example. "From small teams to Fortune 500" is generic; "Teams at Stripe and Notion use this" is concrete.

**Tricolons** → Use two-item phrases, or one strong adjective. "Fast and reliable" beats "fast, reliable, and powerful." A single well-chosen word beats three weak ones.

**Empty intensifiers** → Cut them. "Genuinely useful" → "useful." "Incredibly fast" → "fast" (or give a number). If the noun is doing its job, the intensifier is dead weight.

**Marketing clichés** → Describe what the product actually does. Instead of "revolutionary platform," say what it replaces or what it lets the user do that they couldn't before.

**Hollow openers** → Start with the specific. The first sentence should contain a concrete noun, a specific verb, or a real claim. If the opener could apply to any product in the category, rewrite.

**Uniform rhythm** → Read the copy aloud. If every sentence lands at the same length, break the pattern. A short sentence after a long one creates emphasis. A long sentence after three or four short ones gives the reader room to settle in.

**Gerund-stacked bullets** → Vary the openings. Mix imperatives ("Ship faster"), nouns ("A real audit trail"), and full sentences. Bullets aren't a parallel-structure exam.

**Hollow CTA verbs** → Use the actual verb. "Start your free trial." "See pricing." "Read the docs." Plain language outperforms "Unlock your potential."

### The Reference Standard

Read a column from The New York Times, The Atlantic, or a writer you respect. Notice:

- Sentences vary in length and structure
- Commas do most of the rhythmic work; em-dashes are rare and load-bearing when they appear
- Specificity beats abstraction (a name, a number, a place, a concrete detail)
- The voice has a point of view—it's not trying to please everyone
- Adjectives are chosen carefully, not stacked

Then read your copy. If the gap is obvious, the copy needs another pass.

### The Copy Gut-Check

Before shipping any copy, ask:

> "If I read this aloud, does it sound like a person talking, or like a language model trying to sound polished?"

If it's the latter, the most common culprits are em-dashes, sentence rhythm, and clichéd phrasings. Fix those three and the copy usually snaps into something a human would actually write.
