# Harness Studio visual system

## Traceability

- Spec ID: `2026-08-18-harness-studio-visual-system`
- Status: Implemented

## Intent

Harness Studio has grown Bench, Live trial, and Evidence results as independently
dense surfaces. The current implementation contains useful evidence semantics,
but visual hierarchy is inconsistent: navigation and status repeat, small type
and broad readability overrides flatten semantic roles, nested borders compete
with the current task, and some constrained regions truncate or fracture
decision copy.

The two commits immediately preceding this migration make the gap concrete.
The Date-mode navigation change added useful flat session rows, but shipped with
new 9/10/11px text and no browser proof. The follow-up Inspector migration had
to raise rendered type to the 12px floor, replace one-off colors and radii with
tokens, remove dead rules, repair a malformed declaration, and add a
computed-style gate across all three layout modes. Studio currently repeats the
same risks at a larger scale: its 1,200-line inline stylesheet contains 7–11px
type, an unbundled `Inter` preference, hundreds of literal visual values,
dashboard cards and shadows, and a broad `!important` readability override.

While the migration was in progress, `a1265ee` extended the contract with a
fixed categorical scale and separated neutral data identity from interaction,
runtime state, and Candidate identity. Studio therefore maps its event-kind
taxonomy onto that scale instead of treating prompt as selection, verify as
success, or a generic tool call as Candidate evidence.

Establish [the root visual contract](../../DESIGN.md) as the target source of
truth, then migrate Studio without changing evidence meaning, runtime behavior,
or product capability claims. A user should identify the surface's primary
question, current state, and next action before reading supporting metadata.

## Acceptance Scenarios

- **AC-1 (one visual authority):** root `DESIGN.md` defines semantic colors,
  typography, spacing, radius, component roles, layout modes, accessibility,
  and do/don't rules; `AGENTS.md` routes UI work to it without duplicating the
  complete contract.
- **AC-2 (stable hierarchy):** Bench, Live trial, and Evidence results each
  render one page-level context, one primary state/task, and at most one dominant
  action. Sibling-surface navigation appears once per viewport and repeated
  status copy is removed unless it enables a distinct action.
- **AC-3 (readable type):** shipped UI uses the documented system font stack,
  keeps meaningful text at or above 12px/16px, and applies semantic typography
  roles without a global `!important` selector flattening `strong`, code,
  buttons, labels, and body text to one size.
- **AC-4 (bounded density):** the central work surface retains visual priority;
  secondary trees and inspectors collapse before content fractures. No prose or
  state summary collapses into character-wide columns, and wide data scrolls in
  a labelled bounded region without increasing document width.
- **AC-5 (decision-first results):** Evidence results leads with verdict,
  evidence sufficiency, quality delta, and cost guardrail before aggregate and
  trial tables. Tables preserve role labels and use aligned numeric columns.
- **AC-6 (semantic and accessible states):** action, selection, success,
  waiting, failure, and Candidate identity use the documented semantic roles,
  paired with text or icons. Prompt, plan, explore, change, verify, response, and
  tool-call identity use the fixed categorical scale with an accompanying label
  or legend, never an interaction or state hue. Keyboard focus, accessible
  names, live status, and reduced-motion behavior are verified.
- **AC-7 (visual evidence):** built Studio passes browser checks at 1440×900,
  1024×768, and 390×844 for non-loading Bench, Live trial, and Evidence results
  states with no page/console errors or document-level horizontal overflow.
- **AC-8 (docked control plane):** the application renders as edge-to-edge
  title bar, primary sidebar, workspace, optional secondary panes, and status
  regions separated by one-pixel rules. Overview, foundation, empty, Inspector,
  Bench, Live trial, and Evidence results use pane headers, rows, editor views,
  and bounded inspectors instead of floating card grids or decorative hero
  containers. Wide mode keeps the central workspace at least half of the usable
  width; secondary panes collapse into transient drawers in compact/narrow mode.
- **AC-9 (owned visual sources):** `index.html` contains document structure and
  stylesheet links only. Shared semantic tokens, shell primitives, and feature
  styles live in inspectable CSS files; live component rules contain no raw
  hexadecimal/rgb colors, off-scale radii, docked shadows, or meaningful text
  below the metadata floor.
- **AC-10 (shell interaction remains complete):** every top-level Studio
  destination remains reachable by pointer and keyboard, the active destination
  exposes `aria-current`, compact/narrow navigation closes with Escape and
  returns focus to its toggle, and the three experiment surfaces have exactly
  one visible switcher per viewport.

## Non-goals

- Changing experiment, checkpoint, trace, runtime, verdict, or evidence
  semantics.
- Adding unsupported Harness, Task Suite, Registry, replay, promotion, or remote
  collaboration capability.
- Replacing Phosphor icons, adding dark mode, or introducing a third-party
  component framework during the first migration.
- Claiming WCAG conformance from screenshots alone.
- Adding pane-resize persistence before the three fixed responsive layouts are
  stable and browser-proven.

## Plan and Tasks

1. Land the root design contract and the short `AGENTS.md` routing rules.
2. Extract shared semantic tokens and typography from the inline application
   document into owned Studio styles; remove the unbundled `Inter` assumption,
   raw palette duplication, prototype type sizes, and broad readability
   override.
3. Refactor the application shell and Overview/Foundation/Empty states into a
   compact docked control plane while preserving honest capability boundaries.
4. Fix shell ownership so experiment surface navigation renders once, then
   normalize page headers and primary actions across all configured surfaces.
5. Recompose Bench around setup → run → outcome, keeping checkpoint and trace
   details secondary and preventing fractured comparison copy.
6. Recompose Live trial around the active event stream, with collapsible
   execution/state panes and one clear explanation for unavailable controls.
7. Lead Evidence results with its existing derived verdict data and normalize
   table alignment, overflow, and hierarchy without changing the verdict model.
8. Add rendered visual-contract and shell-interaction checks, verify
   accessibility behavior, and capture all three layout modes before marking
   this spec Implemented.

## Test and Review Evidence

- **AC-1:** `npx -p @google/design.md designmd lint DESIGN.md`; review the root
  `AGENTS.md` link and run the document link graph test.
- **AC-2/AC-5:** Playwright assertions target semantic landmarks, current
  navigation, primary actions, verdict summary fields, and duplicate controls by
  role rather than matching component source text.
- **AC-3:** browser computed-style checks on representative body, metadata,
  label, heading, code, and action elements on macOS/Linux CI; Windows remains a
  required code-path review and CI target where browser infrastructure permits.
- **AC-4/AC-7:** built-page measurements at 1440×900, 1024×768, and 390×844;
  inspect document and bounded-region widths and save screenshots for all three
  Studio surfaces.
- **AC-6:** keyboard traversal, visible focus, accessible-name checks, state
  text/icon assertions, live-region inspection, and `prefers-reduced-motion`
  verification.
- **AC-8/AC-9:** browser-computed checks verify the central-workspace ratio,
  docked pane geometry, typography floor, zero docked shadows, and token-backed
  colors/radii after the cascade resolves. A source-level check verifies that
  `index.html` has no inline style block and each owned stylesheet resolves from
  the built app.
- **AC-10:** Playwright drives the shell destinations and experiment surface
  switcher at wide, compact, and narrow widths, including Escape focus return.
- **Risk:** a visual refactor can accidentally change evidence meaning.
  Mitigation: preserve view models and state contracts; review copy/status
  changes against existing specs and focused model tests.
- **Risk:** token extraction can create a large mixed diff. Mitigation: migrate
  shell/type foundations first, then one complete surface per reviewable change.
- **Risk:** increasing type size can reduce data density. Mitigation: collapse
  secondary panes, reduce decorative labels and borders, and use bounded virtual
  lists before reducing the typography floor.

## Validation Record

- `npm run harness-studio:test`: 15 files and 81 tests passed, including the
  zero-cost guardrail edge case used by the decision summary.
- `npm run harness-studio:test:browser`: 9 Playwright scenarios passed. The run
  covered 1440×900, 1024×768, and 390×844; captured 21 screenshots across
  Overview, Foundation, Empty, Inspector, Bench, Live trial, and Evidence
  results; and reported no page or browser-console errors.
- The browser contract verified the 12px rendered type floor, system font,
  bounded document width, owned stylesheet loading, docked zero-shadow geometry,
  central-workspace priority, reduced motion, responsive Escape focus return,
  one experiment switcher, locally scrolling evidence tables, and distinct
  categorical colors for tool and timeline identity.
- `npm run check`: root, Harness, Harness UI, and Studio test suites passed, then
  package verification passed with 540 npm entries and 577 runtime zip entries.
- `npx -p @google/design.md designmd lint DESIGN.md` reported zero errors and
  22 contract-level warnings; the migration did not modify those root metadata,
  transparent-background contrast, or orphan-token findings. The focused doc
  link graph suite passed all 6 tests.
- `npm run preview`: `/health` and `/canvas-module.js` returned HTTP 200 at
  `http://127.0.0.1:58575`.
- `git diff --check` passed. No generated build output is tracked, no files are
  staged, and this implementation does not claim Windows browser execution from
  the local macOS run.
