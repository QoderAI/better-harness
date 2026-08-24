# Render Markdown artifacts in Studio

## Traceability

- Spec ID: studio-markdown-artifact-view
- Status: Implemented

## Intent

Give `.md` and `.markdown` run outputs a Studio-native renderer. A generated
report is one of the most common things a run produces, and until now Studio
showed it as highlighted source: the reader had to parse the markup themselves
to find out what the run concluded.

This increment takes the data-backed half of the Artifact View lifecycle:

```text
Artifact Revision -> Markdown Adapter -> ArtifactDataSnapshotV1 -> Studio Markdown -> View Host
```

It is a Studio capability. It does not depend on Qoder Canvas, and it adds no
runtime dependency: the adapter parses the bounded Markdown subset described
below itself, the way the PPTX adapter parses OOXML itself.

## Decisions

### D-1: The payload is a block tree, never HTML

Artifact bytes are untrusted output from a run. The adapter therefore produces
`markdown/v1` — a discriminated tree of blocks and inline nodes — and the
browser renders React elements from it. No HTML string ever crosses the wire,
so there is no sanitizer to get wrong and no injection surface to keep closed:
a renderer that receives elements cannot be talked into producing markup.

The alternative, rendering to HTML server-side and sanitizing on the way out,
makes correctness depend on an allowlist staying ahead of every parser quirk.
Structure removes the question instead of answering it repeatedly.

### D-2: What Studio declines stays visible

Every construct the renderer does not support survives as its own node plus one
diagnostic, rather than disappearing or passing through:

- **Embedded HTML** — block or inline — is carried as `rawHtml` text and shown
  in a marked-off box. It is never parsed as markup and never executed.
- **Link targets** are limited to `http:`, `https:`, `mailto:`, and in-document
  `#anchors`. Any other scheme — `javascript:` first among them — is a way for
  artifact bytes to act through a reader's click, and a relative path would
  resolve against Studio's own routes rather than the artifact set. A declined
  target renders as its own label text, so the sentence still reads.
- **Reference-style links, footnotes, and definition lists** are outside the
  supported subset and stay as source text.

Diagnostics are emitted once per class, not once per occurrence: a document
with two hundred HTML tags should say that HTML is not rendered, not say it two
hundred times.

### D-3: Images resolve to bytes beside the document, or not at all

An image reference resolves only against the artifact's own directory, is
served through the adapter's `readResource` as a revision-scoped resource, and
is addressed by a hash of its bytes so a long-lived immutable cache entry can
never point at the picture that path used to hold.

A remote image is **not fetched**. Doing so would make Studio issue a request
chosen by untrusted bytes, which reports the operator's address to whoever
wrote the document. Symbolic and multiply-linked files, paths that escape the
directory, unsupported types, and oversized files are declined the same way.
An unresolved image keeps its alt text.

### D-4: The outline comes from the document's own headings

Top-level headings become nested `structure` nodes and `semanticIndex` entries,
and the renderer turns them into an outline rail. Selecting an entry scrolls the
document rather than writing a fragment, because Studio routes on the location
hash and an anchor navigation would leave the Artifacts workspace entirely.

A heading nested inside a quote or a list item is that block's content, not a
document section, so it does not enter the outline.

The renderer advertises exactly `navigate` and `outline` — the two things it
actually does. A capability nothing implements is a claim the contract cannot
keep.

### D-5: Markdown is its own kind, and stays in `source-text`

`.md` and `.markdown` resolve to a new server-internal `markdown` kind so the
registry can select the adapter. The wire `family` deliberately does not change:
a Markdown file is still source text that Studio can also render, the same way
`.svg` stays in images-diagrams while rendering. Moving it would churn grouping
and the catalog revision for no reader benefit.

### D-6: The supported subset is bounded and stated

ATX and setext headings, paragraphs, fenced and indented code, block quotes,
ordered/unordered/task lists with nesting, GFM tables with alignment, thematic
breaks, and leading YAML front matter (shown as a YAML code block, because its
closing `---` otherwise reads as a setext underline and turns metadata into a
heading). Inline: emphasis, strong, strikethrough, code spans, inline links and
images, autolinks, hard breaks, and backslash escapes, with `_` inside a word
left alone so `snake_case_names` stay words.

Parsing is bounded by input bytes, block count, block and inline nesting depth,
inline node count, image count and bytes, and total snapshot bytes. Fenced code
reaches the same highlighter every other Studio code surface uses; mapping a
fence's language name to that highlighter's file-extension hint is a Markdown
concern and lives with the Markdown renderer.

## Acceptance Scenarios

- **AC-1:** A `.md` descriptor is data-backed, names `studio.markdown` with the
  `studio.markdown-commonmark` adapter and the `markdown/v1` schema, advertises
  `navigate` and `outline`, and stays in the `source-text` family.
- **AC-2:** The adapter parses headings, paragraphs, emphasis, code spans,
  fenced code with a language, quotes, ordered/unordered/task lists with
  nesting, aligned GFM tables, thematic breaks, and front matter; a ragged table
  row is padded rather than allowed to shift columns.
- **AC-3:** Embedded HTML is carried as text and never executes in the browser;
  `javascript:`, `data:`, and relative link targets render as their label text
  with a diagnostic, while `http(s)`, `mailto:`, and `#anchor` targets link.
- **AC-4:** An image beside the document is served from a revision-scoped,
  byte-addressed resource; remote, escaping, and missing references keep their
  alt text and produce bounded diagnostics.
- **AC-5:** Headings become a nested outline; selecting an entry scrolls the
  document and leaves Studio's hash route untouched.
- **AC-6:** The document renders without horizontal overflow at wide, compact,
  and narrow widths, dropping the outline rail before the document, with no
  unexpected console or page errors.
- **AC-7:** Existing TSX preview, PPTX, SVG, image, text/diff, and Qoder Canvas
  behavior remains covered and unchanged.

## Non-goals

- Rendering or executing embedded HTML.
- Fetching remote images, stylesheets, or any other remote subresource.
- Reference-style links, footnotes, definition lists, math, and Mermaid.
- Editing, write-back, or export from the rendered document.
- Cross-artifact navigation from a relative link to a sibling artifact.
- Additional native formats such as XLSX, DOCX, PDF, or Lottie.

## Plan and Tasks

1. Add the `markdown/v1` payload contract to the artifact model.
2. Classify `.md`/`.markdown` as a `markdown` kind that keeps its family.
3. Add the bounded adapter: parser, heading structure, image resolution.
4. Select it from the plugin registry with honest capabilities.
5. Add the browser renderer, its outline rail, and owned styles.
6. Cover the parser, the security boundary, and the rendered surface; run
   package typecheck/build, unit, and Playwright verification with a visual
   review at 1440x900, 1024x768, and 390x844.

## Test and Review Evidence

- AC-1/AC-2: `markdown-artifact-adapter.test.ts` block, front matter, inline,
  and catalog-resolution cases, plus the Artifact View provider registry.
- AC-3/AC-4: adapter link-scheme, embedded-HTML, and image-resolution cases,
  and a browser test that asserts the injected `onerror` payload never ran.
- AC-5/AC-6: browser outline navigation with a hash assertion, and a
  compact/narrow layout test with overflow and console/page-error capture.
- AC-7: the existing Artifact suites.

Implementation evidence captured on 2026-08-22:

- `tsc` and the app build passed in `packages/harness-studio`.
- 185 package tests across 30 files passed, and all 26 Playwright scenarios
  passed, including the two new Markdown scenarios.
- Screenshots reviewed at `artifact-markdown-wide.png`,
  `artifact-markdown-compact.png`, and `artifact-markdown-narrow.png`: the
  outline rail, rendered table alignment, disabled task checkboxes, highlighted
  fenced code, the marked-off raw HTML box, and the diagnostics footer all read
  correctly, and the narrow layout drops the rail without clipping the document.
- Two existing assertions were updated deliberately rather than worked around:
  `notes.md` now resolves to the `markdown` kind, and the client provider
  registry now lists `studio.markdown` between the Canvas and PPTX providers.

Risk review:

- **Parser scope:** a hand-written subset will not match CommonMark on every
  edge. The subset is stated above, and anything outside it degrades to visible
  source text rather than to a wrong rendering. Table, list, and emphasis
  behavior are pinned by tests so a future change cannot quietly alter them.
- **Untrusted content:** structural rendering removes the injection surface,
  but the document still carries text an operator may act on. Link schemes and
  image origins are the enforced boundary; both are covered by tests.
- **Snapshot size:** a large document with many images could otherwise produce
  an unbounded response, so input, block, inline, image, and snapshot budgets
  all fail closed with a diagnostic.
