# Spec-First Contract

For non-trivial behavior, agent, hook, template, API, workflow, or review-flow
changes, create or update a spec before implementation. Use
`docs/specs/<yyyy-mm-dd>-<story-id>-<slug>.md` when a Story exists; otherwise
use `docs/specs/<yyyy-mm-dd>-<slug>.md` for justified maintenance, docs-only,
test-only, dependency, or infra work. Use the spec's creation date for the
prefix and keep that prefix stable across later edits.

Keep the spec small but executable enough for review:

```text
# <Spec title>

## Traceability
- Spec ID: <story-id-or-slug>
- Status: Draft

## Intent
What user, maintainer, or agent outcome changes, and why.

## Acceptance Scenarios
- AC-1: <observable behavior and success criterion>

## Non-goals
Explicit exclusions that prevent speculative expansion.

## Plan and Tasks
Technical approach, affected files/modules, task list, and decision rationale.

## Test and Review Evidence
Commands, expected evidence, manual checks, and risk notes mapped to AC ids.
```

Keep titles human-readable only. Do not put Story ids, draft, implemented,
review state, or other traceability metadata in the title. Do not use YAML front
matter for `docs/specs/*.md` unless a repository-specific parser requires it.
Start new Spec Preparation output as `Status: Draft`; change it to `Accepted`,
`Implemented`, or `Superseded` only when visible local evidence supports that
state. Add a `Story` field only when there is a literal Story or issue id.

Use `[NEEDS CLARIFICATION: question]` for unknowns instead of guessing. A spec
with unresolved clarification markers is not ready for implementation unless the
user explicitly asks for exploratory work. Keep intent focused on what/why; put
how/where in Plan and Tasks. Do not add speculative features without a matching
Story, AC id, or explicit user request.
