---
description: Review this project's AI coding workflow with Better Harness and generate a durable report.
argument-hint: '[review request]'
---

Use the `better-harness` skill for this request. Read the skill's SKILL.md
first and follow its workflow exactly; do not improvise a substitute review.

Host context for this run:

- The current provider is `pi`. Use `--platform pi` for evidence commands.
- The durable output mode is self-contained HTML with paired Markdown
  (`findings.json`, `report.md`, `report.html`) under `<target>/.pi/better-harness`.
- Pi session evidence lives in `~/.pi/agent/sessions/`; the session-analysis
  `pi` platform reads it. Missing or partial evidence stays explicit.

User request:

${@:-review this project's AI coding workflow and generate a report}
