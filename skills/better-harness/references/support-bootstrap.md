# Bootstrap Support (0 -> 1)

Use this track only after the lead freezes findings and dimension scores. The
range in the title describes a user journey, not a score band. This track shapes
already-supported priority moves and repair prompts; it does not create a
finding from asset absence.

## Select This Track

Select Bootstrap when the user explicitly asks for initial coding-agent project
guidance, or when retained findings establish that foundational navigation,
validation, or risk routes are missing. Do not select it merely because
`AGENTS.md`, Rules, Skills, Hooks, or other assets have a zero count.

Use only authorized evidence:

- user-stated provider, workflow, constraints, and desired output;
- inspected project facts such as package manager, supported runtime, focused
  checks, ownership boundaries, and risky paths; and
- [Agent Customize Evidence](agent-customize.md) for configured asset coverage
  and [Findings Quality Gates](findings-review.md) for finding eligibility.

If the required facts are unavailable or contradictory, keep the track
undetermined and name the smallest evidence needed next.

## Shape the Recommendation

Propose the smallest useful owner and include only project-specific facts that
an agent cannot safely infer. Name an existing command or verifier rather than
inventing one, and prefer a short draft plus scoped routes over a comprehensive
generated handbook.

This track stays thin. Recommendation depth lives in the Bootstrap reference
domain; load a route from it only when a supported move needs more than owner
placement:

- [Specification Structure](../../../references/bootstrap/spec-structure.md) when
  the retained gap is an underspecified requirement rather than a missing asset.
  It owns the required sections, the `BR`, `E`, and `AC` id schemes, and the
  completeness gates.
- [Specification Examples](../../../references/bootstrap/examples/README.md) to
  calibrate one section against a comparable backend, frontend, or mobile shape.

For instruction owner placement, quality, and progressive disclosure, read
[AGENTS.md Review](../../../references/agent-customize/agents-md-review.md) and
[Agent Customize Routing](../../../references/agent-customize/routing.md).
Calibrate concrete fragments against
[Good AGENTS.md Example Fragments](../../../case-studies/agent-customize/agents-md-good-examples.md),
but never copy the catalog wholesale or copy values not observed in the target.

Each retained move must state the target owner, project facts to preserve,
expected artifact, verification command or inspection, and approval boundary.

## Preserve Boundaries

Better Harness analysis remains read-only. Asset creation, installation,
activation, or mutation requires a separate task-local request. Do not turn a
user's initialization request into proof that the current project is defective,
and do not claim the proposed guidance works until it is exercised on a real
task and produces an observable outcome.
