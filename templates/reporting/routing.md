# Report Routing

Use this as the report routing switchboard. It selects report structure,
style, and output mode; it does not own Markdown body, runtime rules, or visual
grammar.

## Core Contract

- Markdown structure -> `report-structure.md`.
- Model judgement -> `../../models/routing.md` and the selected model.
- Project trait -> `project-traits.md`.
- Visual grammar -> `../style/routing.md` and the selected style file.
- Runtime, data, and validation -> selected output-mode owner.
- Keep style ids and localized labels internal.

## Reference Route

Read in this order: base report template, model routing, project traits, style
routing, selected style file, then the selected output-mode owner when the route
has one.

## Output Route

Choose exactly one output route. Generate only the named artifacts unless the
user asks for an explicit companion; omit metadata lines, companion sections, and
files from other routes.

| Route | Use when | Artifacts | Runtime owner |
| --- | --- | --- | --- |
| Qoder Canvas report | Active host is Qoder | renderer-owned `findings.json`, `canvas.json`, `report.canvas.tsx` | `qoder-canvas.md` |
| Cursor Canvas report | Active host is Cursor | renderer-owned `findings.json`, `canvas.json`, `report.canvas.tsx` | `cursor-canvas.md` |
| Portable HTML report | Active host is Claude Code, Codex, Qwen Code, GitHub Copilot, Pi, WorkBuddy, or Grok, or a portable visual is explicitly requested | renderer-owned `findings.json`, `report.md`, `report.html` | `html-visual.md` |
| Markdown only | Markdown without a visual companion is explicitly requested | `report.md`, `findings.json` | none |
| Inline only | Inline or no-files output is explicitly requested | none; inline analysis writes nothing | none |
