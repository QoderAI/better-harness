# Portable HTML Output

Use when the selected output mode is HTML: generate a self-contained
`report.html` as the primary portable visual beside the paired `report.md` and
`findings.json`.

This file owns HTML metadata, runtime boundaries, and validation. The selected
`templates/style/*.md` file owns visual grammar; visible labels follow the
paired Markdown report template.

## Authoring Flow

Use only the selected style file's `Visualization Style` section for visual
grammar. Keep the selected style id and localized label out of visible Markdown,
HTML titles, notes, and labels.

For Agent Work Loop, mirror the canonical reader order without importing or
emulating another host runtime: project introduction, five-dimension fluency,
project activity and bounded model/Skill usage, complete findings with plain
text AI fix and acceptance checks, Agent Customize, then evidence and
methodology. This is semantic parity over one reviewed source, not a second
analysis or a byte-for-byte host visual clone.

Use the selected style's primary visual family as the first meaningful visual
surface. Then mirror the compact Markdown report sections and the semantic
source parts from `report-output.md`: style-selected dimensions or fluency
framing, shared finding/action rows with AI fix fallback text,
recommendations, and notes. Do
not copy one generic dashboard skeleton across all styles.

Treat fixed source parts as reading order, not prose layout. When numeric or
grouped data exists, prefer an inline SVG/CSS chart or matrix for the
style-selected framing part. Keep issue evidence in shared finding/action rows,
risk heatmaps, or style-owned visuals instead of a standalone aggregate section.
Tables and cards remain acceptable fallback surfaces when the source has no
chartable score, count, severity, timing, or domain data.

## Runtime Boundaries

- Create exactly one HTML visual file: `report.html`.
- The file must be self-contained and open directly from disk.
- Embed all CSS, SVG, data, and optional small JavaScript inline.
- Do not use remote assets, CDN links, web fonts, `fetch()`, network calls,
  runtime file reads, local absolute asset paths, package imports, build steps,
  or generated helper files.
- Optional local preview may use `npm run preview:html -- report.html`, but the
  generated file must not depend on that server.
- Follow output-mode exclusions from `templates/reporting/routing.md`.
- Prefer semantic HTML plus CSS and inline SVG. Use inline JavaScript only for
  small local interactions such as filtering, tabs, or disclosure state.
- Keep the first viewport useful: project, verdict, confidence, score label or
  caveat, and the selected style's primary visual should be visible without
  requiring the Markdown report.

## Required Report Parity

Mirror the Markdown report and the parity rules in
`skills/better-harness/SKILL.md#report-output`. Do not introduce new
conclusions.

Keep first-screen labels short. Put long paths, command output, screenshots, and
raw evidence anchors in an evidence table or appendix.

HTML cannot assume chat action controls. For each shared finding/action row, render the
reader-facing AI fix label, prompt summary, and acceptance check as plain text
beside that issue when those fields exist.

## Markdown Report Addendum

Add after `Generated artifacts` in the paired `report.md`:

```markdown
- HTML visual: `<selected HTML visual reference, e.g. diagnostic path + evidence table>`
```

Append near the end of the paired report, after the shared issue/action rows or
existing notes:

```markdown
## HTML Companion

- HTML file: `report.html`
- HTML visual: `<reader-facing visual reference, e.g. diagnostic path + evidence table>`
- HTML must mirror the source reader parts, including row-level AI fix text for
  each finding/action row when present.
```

Use literal Markdown list lines. Other output modes must omit the `HTML visual`
metadata line and the `HTML Companion` block.
