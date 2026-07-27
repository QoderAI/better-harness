# Core Change Watch Module

Use for evidence boundaries, diff impact, core coverage, hotspots, and source
vs supporting-file separation. Keep static evidence separate from executed
evidence; do not claim tests, builds, CI, ownership, runtime health, or UI flows
passed unless run, opened, or provided. Main collector:
`<cli> core-change-watch evidence-pack --cwd <repo> --json`; resolve `<cli>`
through [Harness Execution Routing](../../skills/better-harness/SKILL.md#execution-routing).

Infer core candidates from repository structure and bounded Git history. Keep
the resulting boundary evidence-qualified in visible output: say "inferred core
boundary" or "affected core files", and name concrete source paths when they
support the claim.

## High-Impact Expansion

Expand before synthesis for Core, platform, IDE plugin, LSP, auth, tool
execution, security, release, payments, data migration, external-service
integration, or developer/runtime hosts. Inspect descriptors, protocols,
auth/permissions, allowlists, release/rollback, checks, CODEOWNERS, and sensitive
defaults; otherwise report `Unverified high-impact`.

## Debug Coverage For Affected Core Chains

When `diffImpact.coreHits` is non-empty, consume the
`review-core-diagnostic-coverage` action and load
[Observability for AI Debugging](observability.md).
The [Agent Work Loop core and high-impact observability judgment](../../models/agent-work-loop.md#core-and-high-impact-observability-judgment)
owns applicability and pass/block judgment; this module only expands the
affected chain, collects the evidence, and records the review result.
Inspect the smallest affected chain from trigger through its boundary or
decision to failure, recovery, and result. Look for readable output joined by a
stable correlation identity; do not use logger imports or call counts as a
proxy. If inspected source, an executable route, or captured output confirms a
named missing segment, preserve its affected scope and causal impact for the
final finding. Runtime-only access or private-dependency constraints remain
`Unverified` and do not prove that logs are missing.

Write the result to `repositoryEvidence.diagnosticCoverageReviews`; do not rely
on prose handoff. Leave the generated `review-required` row unresolved until a
reviewer records `covered`, `confirmed-gap`, `unverified`, or `not-applicable`
with evidence.
For a `confirmed-gap`, write the title as the visible consequence a newcomer can
understand before they know the logging design, such as "AI cannot tell which
build step failed". Keep terms such as structured diagnostics, correlation,
logger, and trace ids in `missingSegment`, `impact`, or the repair fields.

- RPC, queue, or process boundary changes: verify one correlation identity joins the trigger, boundary decision, and result.
- Catch, retry, fallback, or timeout changes: verify attempts, failure reasons, recovery decisions, and the final result are readable.
- Auth, permission, or feature-flag changes: verify a safe decision signal records the outcome and reason without exposing sensitive data.
- Error-contract changes: require a focused failure-path test and a same-scope diagnostic re-check.

When no failure is observed, a confirmed missing diagnostic segment belongs to
`relevant-check`. When a failure is observed and the segment blocks diagnosis,
it belongs to `failure-repair`. Do not emit both findings for the same causal
gap. “Few logs”, logger imports, or call counts do not identify a missing
segment; retain them only as bounded search leads.

## Bounded History Claim Guardrails

`historyProfile.confidence` describes whether the inspected commit count and
time span are sufficient for hotspot ranking. It does not set final model or
report confidence. For a readiness claim based on history:

- name the inspected window, such as the latest 30 commits or last 90 days;
- open the commits or nearby specs, tests, release notes, or review artifacts
  that support an important cadence, validation, or rework claim;
- treat external trackers, branch protection, CI history, release dashboards,
  and reviewer approval as unavailable unless actually opened or provided; and
- never infer current runtime health, release success, production safety, or
  team intent from commit counts or filenames alone.

Use incomplete lists or session facets only as bounded context. The selected
model and report owner still decide claim confidence and projection.

Scripts: `scripts/core-change-watch/project-profile.mjs`,
`scripts/core-change-watch/git-history-profile.mjs`,
`scripts/core-change-watch/core-candidates.mjs`,
`scripts/core-change-watch/diff-impact.mjs`,
`scripts/core-change-watch/change-drift.mjs`,
`scripts/core-change-watch/evidence-pack.mjs`. Static collectors must not launch
agents. Use [Review Trigger](review-trigger.md) only for review wording.
