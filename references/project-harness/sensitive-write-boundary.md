# Sensitive Write Boundary

## Purpose

Sensitive Write Boundary defines the project-control surfaces an AI coding
agent must not create, edit, move, or delete without explicit user confirmation
in the current task.

It is a pre-write approval gate, not a diff-review checklist:

```text
planned write -> protected-surface match -> explicit confirmation -> scoped write -> evidence
```

`sensitive-code.md` classifies risky content after a diff exists. This boundary
acts earlier: it stops an unconfirmed write to a project-control surface before
the diff is created.

## Protected Surfaces

Trigger before any write whose target path matches one of these surfaces:

| Surface | Typical paths | Why it is protected |
| --- | --- | --- |
| Repository root files | `README.md`, `AGENTS.md`, `LICENSE`, `package.json`, lockfiles, dotfiles such as `.gitignore` or `.editorconfig` | They define project identity, agent behavior, and dependency contracts for every consumer. |
| Configuration | `config/`, linter and compiler configs, environment templates | One edit silently changes behavior for all builds, tools, and agents. |
| Documentation contracts | `docs/`, ADRs, specs, published architecture | They are the reviewed source of truth other work is validated against. |
| Shared automation | `tools/`, `scripts/` | Other workflows, hooks, and CI jobs execute these paths. |
| Hook lifecycle | `hooks/`, Git hook wiring, agent hook definitions | Hooks run automatically and can block or bypass safeguards. |
| CI/CD and release | `.github/workflows/`, pipelines, release and install scripts | Supply-chain and release paths execute with elevated trust. |
| Migration and schema | database migrations, schema definitions, seed data | Effects persist in data and are hard or impossible to roll back. |

Projects may extend this table with their own control surfaces. Keep the
project-specific path list in project policy or analyzer config; this document
owns the boundary rule, not the path inventory.

## Confirmation Rules

1. Match the target path against the protected surfaces before writing, not
   after the diff exists.
2. Confirmation must be explicit, current, and scoped: the user names the
   surface or file, the intended change, and the expected effect. Silence,
   topic similarity, or a generic "go ahead" from an earlier task does not
   qualify.
3. Approval does not carry over. One confirmation covers one described write
   set; a new task, session, or additional surface needs fresh confirmation.
4. A task instruction authorizes a protected write only when it names the
   surface. "Fix the failing tests" does not authorize editing a CI workflow;
   "update `.github/workflows/ci.yml` to fix the failing job" does.
5. Without confirmation, the agent proposes instead of writing: target paths,
   a change summary, the reason, and the expected effect, then waits. If the
   change can live outside a protected surface, route it there instead.
6. Never batch a protected write silently inside a broader change. Surface it
   as its own confirmation item even when the rest of the change is approved.

## Required Evidence

For every write to a protected surface, record:

- target path and matched surface category
- confirmation source: the user message or instruction that named the surface
- change summary and expected effect
- validation command or test run after the write
- rollback route if the write must be undone

## Escalation

If a protected write already happened without confirmation:

1. Report it immediately; do not fold it into an unrelated summary.
2. Show the diff and offer to revert.
3. Route the diff through `review-trigger.md` and `sensitive-code.md` for
   review classification before any further work builds on it.

## Non-Goals

This file does not:

- implement permission enforcement, sandboxing, or filesystem ACLs
- replace code review or the diff classification in `sensitive-code.md`
- restrict reads, analysis, or drafting proposals about protected surfaces
- own Git or agent hook mechanics; use `git-hooks.md` for hook lifecycle
  placement

It defines when a write needs explicit user confirmation and what evidence the
confirmation and the write must leave behind.
