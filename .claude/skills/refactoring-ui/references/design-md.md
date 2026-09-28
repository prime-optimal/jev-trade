# DESIGN.md baseline

Every refactor starts from a `DESIGN.md`: the project's design system in the open
[DESIGN.md format](https://github.com/google-labs-code/design.md). Its YAML front matter holds
the normative tokens; its markdown body holds the rationale. The full format is in
`design-md-spec.md`, loaded when writing or editing the file.

The baseline gives every later change a reference point. You can diff the refactor against it,
review it, and revert to it.

## 1. Find it

Look for `DESIGN.md` at the repository root first, then at `docs/DESIGN.md`, then anywhere in
the repo (case-insensitive, excluding `node_modules/`, build output, and vendored code).

| Found | Action |
|---|---|
| One file | Use it. Go to step 2. |
| Two or more (e.g. one per app in a monorepo) | Use the one closest to the UI being changed. Name it in your reply. |
| None, UI already exists | Go to step 3. |
| None, no UI yet (greenfield) | Write DESIGN.md from the scales in `SKILL.md` and `assets/tokens.css`, adjusted to the chosen personality. Then do steps 3.3–3.6. |

## 2. Existing DESIGN.md: build on it

1. Read the whole file. Lint it:

   ```bash
   bunx @google/design.md lint DESIGN.md
   ```

   If the lint reports errors (not warnings), fix them before refactoring. Commit the fixes on
   their own with a `docs(design):` message, so the lint fix stays separate from the refactor.
2. Treat its tokens as the project's scales. They **replace** the default scales in `SKILL.md`
   and the values in `assets/tokens.css`. Where DESIGN.md is silent, fall back to those defaults.
3. When a Refactoring UI principle conflicts with a DESIGN.md token, the token wins for the
   value. Raise the conflict in your reply, citing the token path (e.g. `{colors.tertiary}`) and
   the principle.
4. When the refactor needs a value DESIGN.md does not have (a missing grey shade, a fourth
   elevation), add the token to DESIGN.md **first**, in the same change as the code that uses it.
   Put the new token into both the front matter and its prose section. Code must reference only
   values that exist in DESIGN.md.

## 3. No DESIGN.md: capture the current design, then commit it

The baseline describes the design **as it is now**, including its flaws. Do not improve anything
in this step. Improvements belong to the refactor, where they show up as a reviewable diff
against the baseline.

1. **Collect the values in use**, in this order of authority:
   1. Theme sources: CSS custom properties, `tailwind.config.*` / `@theme` blocks, SCSS/LESS
      variables, CSS-in-JS theme objects, design-token JSON, Figma variable exports.
   2. Literal values in stylesheets and components: colors, font families, sizes, weights,
      line-heights, letter-spacing, spacing, radii, shadows.
   3. Screenshots or a running page, when there is no source code.
2. **Name the tokens.** Group literals that are within 1px (or visually identical colors) into
   one token. Use the spec's recommended names where they fit: `primary`, `secondary`,
   `tertiary`, `neutral`, `surface`, `on-surface`, `error`; `headline-lg`, `body-md`,
   `label-sm`; `rounded.sm|md|lg|full`. Colors that come from a named ramp keep the ramp name
   (e.g. `grey-100` … `grey-900`).
3. **Write `DESIGN.md` at the repository root**, following `design-md-spec.md`:
   - front matter with `version: alpha`, `name`, and the `colors`, `typography`, `spacing`,
     `rounded`, and `components` groups that were found
   - `##` sections in spec order: Overview, Colors, Typography, Layout, Elevation & Depth,
     Shapes, Components, Do's and Don'ts
   - the Overview states the personality the UI currently conveys (see
     `design-thinking.md` for the vocabulary), plus the target: primary viewport width,
     density, and which theme is primary
   - a group or section with nothing to record goes into `omitted:` with a reason, instead of
     being invented
   - record inconsistencies as facts in the prose, e.g. "Buttons use 3 radii: 4px, 6px, 8px".
     The audit will pick them up.
4. **Lint** with `bunx @google/design.md lint DESIGN.md` and fix every error.
5. **Commit the baseline on its own**, staging only this file:

   ```bash
   git add DESIGN.md
   git commit -m "docs(design): add DESIGN.md baseline of current design"
   ```

   If the working tree is not a git repository, or the commit fails (for example, signing
   needs a TTY), stop and tell the user. Do not start the refactor on an uncommitted baseline.
6. Continue with step 2, using the committed file.

## 4. After the refactor

Update DESIGN.md so it matches the new code: the tokens, the prose, and a Do's and Don'ts entry
for each rule the refactor introduced. Lint again, then compare against the baseline:

```bash
git show <baseline-commit>:DESIGN.md > /tmp/DESIGN.base.md
bunx @google/design.md diff /tmp/DESIGN.base.md DESIGN.md
```

Report the added, removed, and modified tokens in your reply. If `regression` is `true`, the
update introduced lint errors or warnings; fix them. One exception: when the project has two
themes and components reference only one, every token of the other theme reports
`orphaned-tokens`. A regression caused only by a new token of that unreferenced theme is
expected; say so in your reply instead of inventing component references.

Lint does not check contrast for colors no component references. For every new surface or
text color, compute its contrast against the colors it pairs with (4.5:1 text, 3:1 functional
borders) and report the ratios. Then commit DESIGN.md together with the code changes.
