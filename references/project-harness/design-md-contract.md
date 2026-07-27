# DESIGN.md Contract

Use this when coding-agent practice evidence includes `DESIGN.md`, design
tokens, visual/UI generation, design-review skills, or repeated UI style drift.
This is a readiness reference, not a full authoring guide. For creation or
detailed review, hand off to `design-md-review` when available.

## Meaning

`DESIGN.md` is a plain-text visual design-system contract for humans and coding
agents: YAML frontmatter carries machine-readable tokens, and Markdown carries
design rationale and guardrails.

When authoring support is needed, load the
[complete packaged example](examples/design-md-complete-example.md) after this
contract. It is a generic structural fallback, not product evidence: replace
its illustrative values only with inspected project sources.

Do not route lowercase `design.md` architecture specs, `requirements.md`, or
`tasks.md` here. This reference is only about uppercase `DESIGN.md` visual
identity and design-token guidance.

## Applicability

Apply only when the target owns user-facing UI, visual reports, generated UI,
brand surfaces, component libraries, themes, or design systems. For backend,
CLI, SDK, data, or infra projects, mark `not applicable`.

Outside a confirmed frontend or visual project, absence is a recommendation,
not a risk, unless repeated visual drift, inconsistent generated UI, or invented
local style rules are observed. In the default Agent Work Loop repository scan,
a confirmed frontend or visual project
without an exact uppercase root `DESIGN.md` is one ordinary `Low` finding mapped
to Task Understanding / Relevant Context. Projects without confirmed frontend
or visual implementation evidence remain not applicable.

## Inspect

Look for `DESIGN.md`, Tailwind config, CSS variables, theme files, token
JSON/YAML, Storybook, component docs, design-review skills, lint commands, CI
checks, hooks, or reports. Classify evidence separately:

- **Present**: `DESIGN.md` exists.
- **Structured**: it has frontmatter plus readable sections.
- **Token-ready**: frontmatter uses top-level `colors`, `typography`,
  `rounded`, `spacing`, and `components` groups.
- **Agent-ready**: prose explains product feel, component use, states, and
  do/don't rules.
- **Aligned**: tokens map to implementation theme, CSS variables, Tailwind,
  component props, or Storybook.
- **Backstopped**: lint, diff, export, CI, hook, or review gate checks drift.

File presence is not enforcement.

Classify an exact root `DESIGN.md` as a project **Rules** asset beside
`AGENTS.md`. Keep provider-native Rules first, then `AGENTS.md`, then the visual
contract. Lowercase architecture `design.md` and nested design notes do not
become this Rules asset.

## Quality Signals

Strong evidence:

- Semantic color roles, foreground/background pairs, and state colors.
- Structured typography, spacing, and radius scales.
- Component token maps for real UI surfaces and states such as
  `button-primary-hover` or `text-input-focused`.
- Markdown sections for Overview, Colors, Typography, Layout,
  Elevation & Depth, Shapes, Components, and Do's and Don'ts.
- Rationale that says when to use a token, when not to use it, and what agent
  mistake it prevents.
- Accessibility guidance for contrast, focus-visible, color-not-alone, reduced
  motion, forms, and error states.

Weak evidence:

- Prose-only brand description with no token frontmatter.
- Nested `tokens:` instead of top-level token groups.
- Raw names such as `blue500` without semantic roles.
- Component names without variants, states, or token mappings.
- Vague guidance such as "make it clean".
- Tokens that drift from implementation theme or current product.

## Validation

Prefer cross-platform commands:

```bash
npx -p @google/design.md designmd lint DESIGN.md
npx -p @google/design.md designmd diff DESIGN.md DESIGN-next.md
npx -p @google/design.md designmd export --format css-tailwind DESIGN.md
```

Use the `designmd` alias in package scripts because the `design.md` binary name
can collide with Markdown file associations on Windows.

Lint proves structure and token checks. Export proves tokens can feed
Tailwind/CSS/DTCG workflows. Diff is drift evidence, not visual QA by itself.

## Recommendation Rules

Recommend `DESIGN.md` when agents generate UI and invent colors, spacing,
typography, radii, or component variants; when a visual system has no
agent-readable source of truth; or when tokens exist without usage rationale.

When the file is missing, inspect existing UI evidence before authoring. Use
`design-system-capture` when the contract must be inferred from code,
screenshots, Figma, themes, or components, then use `design-md-review` to author
or review the root file when those Skills are available. Preserve inferred
rules as inference and mark unresolved policy `needs-design-decision` instead
of inventing brand decisions.

When those optional Skills are unavailable, use the
[complete packaged example](examples/design-md-complete-example.md) as the
structural fallback while keeping every project value evidence-bound.

Recommend lint, CI, or hooks only after the team has a stable `DESIGN.md`
shape. Route screenshot/CSS/Figma/live-UI extraction to `design-system-capture`
first when available.

## Projection

Use `DESIGN.md` as positive `AI Agent Practices` evidence:

- **Context Map**: agents can understand the visual language quickly.
- **Quality Gates**: token contracts and lint/export checks reduce style drift.
- **AI Readiness**: UI generation has a reusable visual source of truth.
- **Rules inventory**: the root file appears beside `AGENTS.md`; in the
  standalone per-asset Rules evaluator it can raise the bounded surface mean
  without removing another Rule's warning or worst risk.
- **Agent Work Loop**: static presence supports `relevant-context`; routed and
  task-applied use can support stronger Task Understanding evidence and score
  only within the model's existing evidence ceilings.

Do not add a new scorecard row. Do not let visual design docs replace executed
build, lint, typecheck, preview, accessibility, or visual-regression evidence.

## Output Shape

```markdown
### DESIGN.md contract
- **Scope**: in scope | not applicable | needs evidence
- **Evidence level**: Present | Structured | Token-ready | Agent-ready | Aligned | Backstopped
- **Strongest evidence**: <file, command, report, or implementation mapping>
- **Main gap**: <missing token/rationale/alignment/backstop>
- **Recommendation**: <smallest next action>
```
