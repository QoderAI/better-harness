# Open a rendered Inspector without hunting for its output path

## Traceability

- Spec ID: inspector-open-flag
- Status: Implemented
- Extends the CLI contract of [harness-inspector](2026-08-12-harness-inspector.md);
  the report content and evidence rules are unchanged.

## Intent

`harness-inspector render` writes a self-contained HTML file and prints its path,
so the shortest path to actually reading a report was to copy that path into a
browser or a preview server by hand. This slice closes the last step of the loop:
one flag that opens the file that was just written, plus repository scripts that
make the default, current-project render a single command.

Opening is a convenience over an artifact that already exists. It must not change
what is collected, and it must not turn a written report into a failed run when
the machine has no usable handler.

## Acceptance Scenarios

- AC-1: `render --open` opens the written report in the default handler and
  reports the launch as `opened` in its stdout summary. The file exists before
  the handler is launched.
- AC-2: Without `--open`, no handler is launched and the summary carries no
  `opened` field, so existing consumers of the summary are unaffected.
- AC-3: `--open` is a valueless flag: it does not consume the next argument,
  `--open` twice is a duplicate-option usage error, and `--open true` is a usage
  error rather than a silently swallowed value. Value options still require a
  value.
- AC-4: The handler receives an absolute `file://` URL, so a relative `--out` and
  a Windows drive path both resolve to the intended file.
- AC-5: A failed or unavailable handler reports `opened: false` and keeps the
  exit code at 0; `--help` still prints help without opening anything.
- AC-6: `npm run inspector` renders the current project with default bounds and
  `npm run inspector:open` does the same and opens the result.

## Non-goals

- Serving the report over HTTP or reusing the Canvas preview server.
- Choosing a specific browser, profile, or window.
- Changing default collection bounds, output path, or report content.
- Adding an open flag to other Better Harness commands.

## Design Decisions

**Reuse the existing platform seam.** `openRenderedReport` wraps `openBrowser`
from `scripts/harness-analysis/preview-support/platform.mjs`, which already
resolves `open`, `cmd /c start`, and `xdg-open` per platform and detaches the
child. No second cross-platform launcher is introduced.

**File URL, not file path.** The path is resolved and converted with
`pathToFileURL`, because a bare relative path would resolve against the browser
and a Windows path is not a URL.

**Best effort, after the write.** The launch happens after `writeFile`, and its
result is reported rather than thrown. A report that exists on disk is the
deliverable; the viewer is not.

**Booleans are parsed as booleans.** The render parser gained an explicit
valueless-flag set instead of treating every flag as `flag value`, so `--open`
cannot eat the following argument.

**Injectable opener.** `main(argv, { open })` takes the opener as runtime, which
is how the wiring is tested without launching a browser in CI.

## Test and Review Evidence

- AC-1/AC-2: `render writes the report before opening it and reports the launch
  in its summary` and `render leaves the browser alone when --open is absent`
  render into a seeded temporary Git workspace with an injected opener.
- AC-3: `--open is parsed as a valueless flag without consuming the next
  argument`.
- AC-4/AC-5: `opening a report launches an absolute file URL and reports launch
  failure`.
- AC-6: `npm run inspector`, `npm run inspector:open`, and
  `node scripts/harness-inspector/cli.mjs render --open` run against this
  repository; the summary reported `opened: true` and the report rendered.
- Regression: `test/reporting/harness-inspector.test.mjs` (23 tests) and
  `test/reporting/preview-servers.test.mjs`, which pins the packaged preview
  script entrypoints.

## Risks

- Side effect: `--open` is the only Inspector flag that launches a process. It is
  opt-in, absent from `--help` execution, and unused by the default
  `npm run inspector`.
- Environment: a headless or handler-less machine reports `opened: false`; the
  written path stays the primary output.
- Privacy: the opened URL is the local output path the summary already prints; no
  new content is retained or transmitted.
