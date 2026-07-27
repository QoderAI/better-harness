# Audit Checklist

## Trigger contract

- Frontmatter `description` states when to use the skill, not the workflow.
- Name is short, hyphen-case, action-oriented, and discoverable by likely user
  words.
- Body does not rely on a "when to use" section to fix weak metadata.

## Progressive disclosure

- `SKILL.md` holds only the main workflow, routing rules, and required
  invariants.
- Detailed variants, schemas, examples, style rules, and long checklists live in
  directly linked references.
- References are one hop from `SKILL.md`, named by the decision that loads them,
  and non-empty.

## Workflow and delegation

- The main workflow is explicit enough that an agent knows what to do first,
  what gates the next phase, and when to stop.
- Subagents are part of the workflow only when they reduce real scope risk; they
  are not a decorative list of roles.
- The lead agent owns final consistency, evidence quality, and output claims.

## Template ownership

- Base report templates own structure and parser-safe fields.
- Runtime-specific templates own runtime rules such as Canvas, HTML, SDK imports,
  companion bullets, preview, and validation.
- Style templates own visual grammar only. They should not duplicate runnable
  skeletons, shared SDK rules, or mode-selection logic.

## Prompt and report readability

- Cut explanations an AI can infer from headings, examples, or local code.
- Prefer one concrete contract over repeated warnings in several files.
- Replace placeholder walls, consecutive empty headings, and giant table rows
  with compact field requirements or one realistic example.
- Keep exact labels, scoring scales, and parser-sensitive metadata centralized.

## Evidence and validation

- Every important review claim has a file path, line, command, diff, or artifact
  anchor.
- Missing evidence is reported as missing or unverified, not filled by
  inference.
- Validation checks the same surface the skill claims to support. For visual
  chains, build/preview/runtime validation is separate from Markdown review.
