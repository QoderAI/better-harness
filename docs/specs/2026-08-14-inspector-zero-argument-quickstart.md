# Generate and open Inspector with one short command

## Traceability

- Spec ID: inspector-zero-argument-quickstart
- Status: Implemented
- Extends [Open a rendered Inspector without hunting for its output path](2026-08-13-inspector-open-flag.md).

## Intent

The public Inspector entry point should optimize for the common developer task:
generate the current repository's report and open it. Requiring callers to know
the `render` subcommand, repeat the current workspace, and discover `--open`
makes the first successful run unnecessarily procedural.

Running `npx @qoder-ai/better-harness inspector` with no Inspector arguments
therefore becomes the short path for rendering and opening the current
workspace. Its default evidence window covers the latest 30 UTC calendar days,
with higher but still bounded commit and session caps. Explicit commands and
options remain available for automation and narrower inspection.

## Acceptance Scenarios

- AC-1: `better-harness inspector` with no Inspector arguments renders the
  current working directory and asks the platform opener to open the written
  self-contained HTML report.
- AC-2: The zero-argument path collects activity from the latest 30 UTC calendar
  days, bounded to at most 200 commits and 100 hydrated sessions. Date contains
  days with observed evidence; it does not manufacture empty-day evidence.
- AC-3: The zero-argument summary reports the resolved output path and
  `opened: true` or `opened: false`; an unavailable handler does not turn a
  successfully written report into a failed command.
- AC-4: `better-harness inspector --help` and the canonical Inspector help path
  remain read-only and print the zero-argument equivalence without collecting
  workspace evidence or opening a handler.
- AC-5: Explicit `render` and option-led invocations retain their current
  semantics. They open a handler only when the caller passes `--open`, so CI and
  scripts do not acquire a new side effect.
- AC-6: The bilingual Inspector guide leads with the `npx` zero-argument command
  and keeps the expanded command available for callers that need bounds or an
  explicit output path.
- AC-7: The public `/inspector/` page presents the zero-argument `npx` command
  in the hero before the interactive sample and uses the same short command in
  its local-project callout.

## Non-goals

- Removing `render`, `--workspace`, `--open`, or any existing bound.
- Opening reports for other Better Harness commands.
- Treating a browser-launch failure as a render failure.
- Changing report contents, collection bounds, evidence semantics, or the
  default output location.

## Plan and Tasks

1. Make the Inspector CLI owner translate an empty argument list into a render
   of `.` with `--open`, a deterministic 30-day UTC range, and the bounded
   200-commit/100-session collection limits before normal command parsing.
2. Keep help detection ahead of collection and leave every non-empty invocation
   on its existing parsing path.
3. Add behavior tests with an injected working directory and opener so the
   default can be verified without launching a real browser in CI.
4. Update English and Simplified Chinese Inspector documentation, promote the
   command on the public `/inspector/` page, and regenerate the documentation
   link graph.

## Test and Review Evidence

- AC-1/AC-2/AC-3/AC-5: focused Vitest coverage in
  `test/reporting/harness-inspector.test.mjs` asserts the written artifact,
  injected opener call, summary, and unchanged explicit-render behavior.
- AC-4: existing subprocess help coverage plus a focused assertion for the
  documented zero-argument default.
- AC-6: `npx vitest run test/skills-docs/doc-link-graph.test.mjs` and the
  regenerated `docs/better-harness-doc-links.mmd`.
- AC-7: production documentation build plus browser checks of English and
  Simplified Chinese `/inspector/` routes at desktop and narrow widths.
- Focused runtime regression: 172 tests passed across the Inspector facade, report,
  session analysis, commit/session linking, and cross-provider suites.
- Documentation regression: 6 link-graph tests passed; the English and
  Simplified Chinese production sites built successfully, and both
  `/inspector/` routes rendered the short command twice with the hero copy
  before the interactive sample, no horizontal overflow, and no console issue.
- Full regression: `npm run check` passed 94 files / 1324 tests, followed by
  package verification of 521 npm entries and 543 runtime-zip entries.

## Risks

- Side effect: zero arguments now request a platform handler. The change is
  isolated from help and every explicit invocation, and handler failure remains
  best effort.
- Working-directory drift: the injected/default workspace must resolve `.` from
  the caller's working directory, not from the installed package.
- Evidence bounds: very active repositories can exceed 200 commits or 100
  sessions within 30 days. The report remains explicitly bounded and must not
  present missing activity as observed zero.
- Cross-platform behavior: the existing `openRenderedReport` platform seam
  remains the only launcher; this change does not introduce shell-specific
  commands.
