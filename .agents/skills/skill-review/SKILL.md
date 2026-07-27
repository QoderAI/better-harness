---
name: skill-review
description: Use when reviewing Codex, Qoder, or repo-local skills and their prompt chains for trigger quality, workflow clarity, progressive disclosure, duplicated instructions, template ownership, output readability, validation gaps, or whether a skill should be edited.
---

# Skill Review

Review a skill as an execution contract, not as prose. Trace how an agent would
enter, load, delegate, produce artifacts, and verify results; then report the
smallest changes that would improve that chain.

## Review Workflow

1. Resolve the target skill or prompt chain. If the user names a path, stay on
   that path and its directly linked resources.
2. Read repo instructions first: nearest `AGENTS.md`, plugin manifests, and the
   target `SKILL.md` frontmatter/body.
3. Trace the chain from entrypoint to references, templates, scripts, detectors,
   tests, generated artifacts, and validation commands. Build an ownership map:
   what file owns workflow, output structure, runtime rules, style, and tests.
4. Audit the contract before editing. Use [Audit Checklist](references/audit-checklist.md)
   and [Reference Patterns](references/reference-patterns.md) as lenses.
5. If the user asked for changes, patch only the smallest owning files. Keep
   generated helpers, smoke scripts, and local experiments outside `SKILL.md`
   unless they are durable resources the skill must use.
6. Validate with the lightest real gate available: skill validator, repo tests,
   plugin validation, or a bounded agent smoke. State any gate that could not be
   run.

Use subagents only as an evaluation surface or for independent broad research.
The lead agent owns the review, final calibration, and file edits. Pass raw
artifacts and task-local scope to subagents; do not pass the intended answer.

## Review Lenses

- [Audit Checklist](references/audit-checklist.md): trigger contract, progressive
  disclosure, workflow/delegation, template ownership, readability, evidence.
- [Reference Patterns](references/reference-patterns.md): reusable design lenses
  such as Trigger/Protocol split, Gate Function, and Output Contract Slots.
- [Fast Inspection Commands](references/inspection-commands.md): starting `rg`,
  `wc`, and `git diff --check` probes adapted to the repo.

## Finding Severity

- **P0**: The skill points to missing, empty, contradictory, or invalid resources;
  an agent can follow the instructions and fail.
- **P1**: The skill works but wastes context, duplicates ownership, hides key
  constraints, or produces unreadable output.
- **P2**: Style, naming, wording, or organization issues that reduce scanability
  without breaking the workflow.

## Report Shape

Lead with findings, ordered by severity. Keep each finding concrete:

```text
P1 - <short title>
File: <path>:<line>
Why it matters: <execution or output risk>
Evidence: <quoted phrase, command result, or linked resource>
Fix: <smallest owning-file change>
Validation: <command or smoke that should prove it>
```

After findings, add open questions only when they block a safe change. If the
user asked for edits, include changed files and validation results after the
findings. Default to the user's language.
