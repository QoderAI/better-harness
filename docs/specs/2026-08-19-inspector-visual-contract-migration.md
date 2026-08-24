# Harness Inspector visual contract migration

## Traceability

- Spec ID: `2026-08-19-inspector-visual-contract-migration`
- Status: Implemented

## Intent

[DESIGN.md](../../DESIGN.md) declares itself the visual source of truth for
`packages/harness-studio` and for interactive Better Harness reports without a
narrower approved contract. Harness Inspector has no such narrower contract, so
the root contract governs it.

The three commits that flattened the evidence workbench
(`refactor(inspector): flatten the evidence workbench`,
`refactor(inspector): redesign date calendar and session detail`,
`feat(inspector): list selected-day sessions in date mode`) moved the structure
toward the contract but left two gaps and introduced one regression:

- The stylesheet still rendered meaningful text at 7–11px, which DESIGN.md
  forbids twice: `Do not render meaningful text below metadata (12/16)` and
  `Do not use 7–9px prototype text`. The date calendar and session navigator
  added in the last two commits shipped *new* 9/10/11px rules.
- Colour and radius were split between the declared token block and roughly 68
  one-off hex literals plus off-scale radii, so `Do not introduce one-off
  colors, font sizes, radii` was unenforced in practice.
- Nothing observed the rendered result. The first commit checked 390px and
  1440px only; the last two recorded `node --check` and no browser verification
  at all, so the contract had no executable gate.

Close the gaps without changing evidence semantics, and add a check that
measures the rendered report so the next change cannot silently reintroduce
sub-floor type or unreachable text.

## Acceptance Scenarios

- **AC-1 (typography floor holds in the rendered page):** every element with
  visible text in the Capability, Date, Session Trace, and Session Replay
  surfaces resolves a computed `font-size` of at least 12px. Measured after the
  cascade, not asserted against stylesheet source, because inherited rules such
  as `.date-weekdays span` carry no declaration of their own.
- **AC-2 (single colour and radius source):** the stylesheet declares every
  colour and radius through a custom property. The tool-family palette, which
  the semantic roles do not cover, is declared in `:root` as categorical
  evidence identity and read by the chart through `var()` instead of a script
  literal.
- **AC-3 (no unreachable text):** no element clips text horizontally while
  offering neither ellipsis truncation nor a scroll affordance. Ellipsis
  truncation and bounded scroll regions remain allowed.
- **AC-4 (no document-level horizontal overflow):** `documentElement.scrollWidth`
  does not exceed `clientWidth` at wide, compact, or narrow layout modes.
- **AC-5 (three layout modes verified):** the check runs at 1440×900,
  1024×768, and 390×844, and reports console and page errors per surface.
- **AC-6 (dead rules removed, not migrated):** stylesheet blocks whose markup no
  longer exists are deleted rather than brought up to the contract.
- **AC-7 (categorical identity is not state):** tool family and replay event kind
  are categorical dimensions and draw from the `categorical` scale that
  [DESIGN.md](../../DESIGN.md) declares. No categorical value equals an
  interaction or state token, every value clears 3:1 against the surface it is
  drawn on, and no two categories in one legend share a colour.

## Non-goals

- Changing evidence semantics, correlation strength, privacy bounds, or any
  report data model.
- Migrating `packages/harness-studio` surfaces. The unbundled `Inter` reference
  and the 11px rule in `packages/harness-studio/src/app/index.html` and
  `StudioDiff.tsx` remain open under
  [the Studio visual system spec](2026-08-18-harness-studio-visual-system.md),
  whose Status stays Draft.
- Adding a browser dependency to the root `npm test` run.
- Claiming WCAG conformance.

## Plan and Tasks

1. Raise every sub-12px rule in `scripts/harness-inspector/ui/workbench.css` to
   the 12px floor, growing the affected control boxes where a larger glyph no
   longer fits.
2. Delete the dead `.session-notebook-context` and `.session-context-grid`
   blocks, including their media-query overrides. This removes the
   `max-height:34px` prose clip at its root rather than tuning it.
3. Replace off-scale radii with `--radius-*` and all one-off hex literals with
   the matching semantic token.
4. Declare the tool-family palette in `:root` and have `workbench.js` emit
   `var(--family-*)` and `var(--color-danger)` instead of hex literals.
5. Relax the compact commit row from a rigid five-column grid to a wrapping
   flex row, since hash, subject, stats, and evidence label no longer fit one
   line at the readable floor in a narrow delivery lane.
6. Add `scripts/harness-inspector/visual-contract-check.mjs` and the
   `inspector:visual-check` npm script.
7. Repair `background:var(--color-surface)df9` on `.session-event.intermediate`.
   The malformed value predates this change and silently dropped the
   intermediate tint; it is replaced with `var(--color-surface-subtle)` rather
   than reinventing the warm one-off.

## Test and Review Evidence

- **AC-1/AC-3/AC-4/AC-5:** `npm run inspector:visual-check` renders the bundled
  demo report and measures it in Chromium. 12 checks pass (3 layout modes ×
  Capability, Date, Session Trace, Session Replay) with `belowFloor=0`,
  `clipped=0`, `overflow=0px`, `errors=0`.
- **Negative control:** reintroducing `font-size:9px` on `.date-weekdays` makes
  the check fail with `belowFloor=7`, naming the seven inherited weekday spans.
  A source-level check on `.date-weekdays` would have reported one rule; a
  source-level check on the spans would have reported nothing, since they
  declare no font size. This is why the gate measures computed style.
- **AC-2/AC-6:** verified by rendering — the family bars, chart marks, and
  state colours still paint at every layout mode with no console errors, which
  a stylesheet with an unresolvable `var()` or a deleted live rule could not do.
- **Regression scope:** `npm test` passes at 96 files / 1330 tests, including
  the 27 files under `test/reporting/`.
- **Screenshots:** wide, compact, and narrow captures for all four surfaces,
  reviewed for the primary decision remaining obvious. Compact and narrow now
  show full commit file paths that the previous 9px monospace truncated.
- **Risk:** raising the type floor reduces density. Mitigation applied — the
  family label column and the narrow filter summary were widened, and the
  compact commit row wraps, so no text became unreachable; the check enforces
  this.
- **Risk:** a broad token substitution can shift a colour's meaning. Mitigation
  — each literal was mapped to the nearest declared role, and colour-carrying
  states (success, warning, danger, candidate, primary, family identity) were
  reviewed in the screenshots rather than only diffed.
- **Risk:** the check is not in `npm test`, so it can be skipped. Accepted for
  now: the root suite runs in a Node environment and adding a browser
  dependency there is out of scope. The npm script keeps it one command.

## Review Findings Addressed

A code review of this change found three defects, all fixed before completion:

- **Token self-reference (introduced here):** the bulk substitution of `#667085`
  also rewrote the `:root` declaration into
  `--color-text-subtle:var(--color-text-subtle)`. A self-referencing custom
  property never resolves, so every `var(--color-text-subtle)` consumer fell
  back to inherited colour and lost the subtle tier. The rendered check did not
  catch this, because an unresolvable colour still paints and still measures at
  12px. Lesson: a global literal substitution must exclude the token
  declaration block that defines the literal.
- **Screen reader-only false positive (introduced here):** `.visually-hidden`
  clips a 224px accessible name into a 1px box, which the clipping rule counted
  as unreachable text. It went unnoticed because the only such element is
  `hidden` in the demo report, so it measured zero. Left unfixed, the gate would
  have failed the first time a multi-workbench scope revealed the jump control,
  and the cheapest way to make it pass would have been deleting the accessible
  name. The rule now skips clip-path-hidden 1px boxes and `aria-hidden` subtrees.
- **Malformed declaration (pre-existing):** `.session-event.intermediate` carried
  `background:var(--color-surface)df9`, an invalid value left by an earlier token
  migration in `refactor(inspector): flatten the evidence workbench`. It was
  silently ignored by every browser.

## Correction: categorical colour versus state colour

The first pass of this migration mapped the tool-family palette onto the nearest
semantic token, which made five of seven families byte-identical to
`--color-primary`, `--color-success`, `--color-warning`, `--color-text-muted`,
and `--color-text-subtle`. That traded one violation for a worse one: DESIGN.md
reserves green, amber, and red as state colours, and the palette it replaced had
deliberately kept the family hues offset from them. Chasing token purity removed
a real semantic separation.

The fix is a declared `categorical-1` … `categorical-7` scale in DESIGN.md, with
a Color rule stating that categorical identity carries no judgement, never
equals an interaction or state token, and is always redundant with a lane,
label, or legend. Inspector maps `--family-*` and the replay rail onto that
scale; only failure keeps `--color-danger`, drawn as a ring so the kind stays
readable underneath.

This also fixed a pre-existing defect: `.replay-rail-mark.response` and
`.replay-rail-mark.commit` both painted `--color-success`, so the rail rendered
as one colour what its own legend listed as two kinds.

Scale properties verified numerically before adoption: minimum contrast 4.47:1
against white (≥3:1 for non-text graphics), minimum perceptual distance 32 to
any interaction or state token, and 79 between any two categorical values.
