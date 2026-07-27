# Operationalize Support (1 -> 60)

Use this track only after the lead freezes findings and dimension scores. The
range in the title describes a user journey, not a score band. This is the
normal route when useful mechanisms exist but supported evidence shows they are
not yet wired into ordinary work or exercised through an observable result.

## Select This Track

Select Operationalize when at least one relevant project or agent mechanism is
present and retained findings establish a `Present -> Wired -> Exercised` gap.
Examples include a documented check with no task route, a runnable command with
no acceptance boundary, or a configured asset with no observed invocation.

Do not select it from counts, a middling score, or missing Session coverage. Use
[Project Harness Evidence](project-harness.md),
[Agent Customize Evidence](agent-customize.md), and
[Findings Quality Gates](findings-review.md) as the canonical owners; do not
duplicate their evidence or eligibility rules here.

## Shape the Recommendation

Prioritize the smallest supported move that advances one real mechanism by one
observable state:

1. connect a present owner to the task entrypoint where an agent needs it;
2. expose the exact command, trigger, or decision boundary;
3. add the cheapest representative verifier and expected result; and
4. name failure, reset, recovery, or escalation behavior when the action has a
   meaningful side effect.

Choose the durable owner from the target rather than naming a fashionable tool.
Use the
[Project Capability Artifact Examples](../../../case-studies/project-harness/project-capability-artifact-examples.md)
to calibrate `Document`, `Rule`, `Skill`, `Hook`, `Script`, `Test`, `Config`,
`MCP`, or `Code` outputs. Treat these as labels, not evidence that an artifact
is needed.

Each priority move must remain attached to a retained finding and state the
observable end state, smallest owner, verifier, and recovery or approval
boundary. Prefer extending an existing route over introducing a parallel owner.

## Preserve Boundaries

Do not create a new finding, change severity, or rescore a dimension because a
track was selected. Do not claim a mechanism is exercised from presence or
configuration alone. Finding-bound mutation and independent reassessment remain
owned by [Finding-bound Fix](finding-bound-fix.md).
