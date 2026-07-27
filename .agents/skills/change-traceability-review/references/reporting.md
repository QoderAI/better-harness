# Reporting

## Report Shape

Optimize for signal per token. The main report should usually be 60-120 lines.
Do not repeat the same missing fields per commit. Expand only notable commits:
Story-linked, large, mixed-scope, weak-message, rework, useful test evidence, or
AI/automation evidence.

For a current diff with <=10 changed files, use one row per file. For larger
diffs, group by module and expand only sensitive, unexplained, staged, or
mixed-scope changes.

## Trust Rules

- Tie every important claim to a commit hash, file path, footer field, command,
  branch name, changed file, or inspected test.
- Do not invent Story titles, acceptance criteria, tracker status, CI results,
  reviewer intent, or Spec content.
- Do not call test files proof of acceptance coverage unless test content was
  inspected.
- Do not infer AI involvement from project context, writing style, or detailed
  commit bodies. Count AI only from explicit markers such as `AI:` or
  `Co-authored-by`; avoid labels such as suspected AI-generated or likely AI.
- Do not treat a doc path as a matching Spec unless content or commit evidence
  links it to the same Story/behavior.
- Do not accept a `Spec:` footer as sufficient by itself; inspect whether the
  spec has acceptance/test evidence and whether the diff plausibly implements
  those items.
- State external systems as unavailable when not accessed.
