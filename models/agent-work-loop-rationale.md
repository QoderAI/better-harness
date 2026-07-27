# Agent Work Loop Rationale

Use this reference only when reviewing or changing Agent Work Loop definitions.
It records the primary-source rationale behind the five reader questions; it is
not an evidence source for scoring a project and never substitutes for opened
local instructions, code, tests, delivery state, or reviewed Task Episodes.

## Task Understanding

OpenAI's [Harness Engineering](https://openai.com/index/harness-engineering/)
motivates specified intent, repository-local legibility, and enforceable
architecture as prerequisites for reliable agent work. Agent Work Loop turns
those concerns into an acceptance boundary, authoritative-context review, and
explicit scope/effect boundary.

## Controlled Execution

The same Harness Engineering account motivates isolated startup,
agent-accessible tools, local observability, and mechanically enforced
boundaries. Agent Work Loop therefore distinguishes reproducible startup,
supported operation, and permission enforcement rather than treating tool
inventory as behavior.

## Change Validation

Google's [Testing Overview](https://abseil.io/resources/swe-book/html/ch11.html)
motivates behavior-focused tests, controlled inputs, observable results, and
explicit failure testing. The OpenTelemetry
[Logs specification](https://opentelemetry.io/docs/specs/otel/logs/) motivates
correlation across execution context, components, logs, metrics, and traces.
Together they support relevant verification, attributable diagnosis and repair,
and same-scope revalidation.

## Reliable Delivery

GitHub's
[protected branch contract](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
motivates current-revision required checks, review gates, and controlled bypass.
Agent Work Loop keeps that delivery decision separate from local validation and
adds risk-proportionate approval and recovery evidence.

## Learning Capture

Google SRE's
[Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
motivates reviewed recurrence evidence, contributing causes, owned preventive
actions, discoverable knowledge, and follow-up effectiveness. Agent Work Loop
therefore requires bounded opportunity detection, smallest-owner Loop
Engineering, and longitudinal outcome or maintenance validation.

## Interpretation boundary

These sources explain the shape of the model; they do not freeze terminology,
runtime versions, provider features, or numeric scores. A reviewer must still
apply the canonical Agent Work Loop checks to current project evidence and use
the repository's owner chain when it is stricter or more specific.
