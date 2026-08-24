# Agent verify loop shared reference

## Traceability

- Spec ID: agent-verify-loop-reference
- Status: Implemented

## Intent

Add a shared prose reference, `references/project-harness/agent-verify-loop.md`,
that teaches teams how to design the verification harness for a coding-agent
loop in a long-chain system (many entrypoints, many write targets, long
asynchronous paths). The reference generalizes a recurring field pattern —
data-driven case discovery, a reusable regression skeleton, parameterized
verification probes, and diff-scoped incremental plans — into one
implementation-neutral framework, and wires it into the existing workflow
consumers that already route verification design questions.

## Acceptance Scenarios

- **AVL-AC-1 (four planes):** The reference defines the Discover, Exercise,
  Judge, and Scope planes, each with one question and one durable asset, plus a
  bootstrap order that starts from a tracer-bullet case and the extracted
  probe.
- **AVL-AC-2 (verdict honesty):** The probe verdict domain is
  `pass | fail | unobserved | blocked`; missing evidence never maps to `pass`,
  and the aggregate plan verdict follows the weakest matched case so skipped
  or blocked coverage demotes the run to `blocked` or `partial` instead of
  producing a green result.
- **AVL-AC-3 (async bounds):** The probe contract requires a terminal
  condition, deadline, and polling/backoff policy for asynchronous chains, and
  distinguishes not-yet-observed evidence from failure.
- **AVL-AC-4 (data-access boundary):** The bootstrap path defaults to test data
  or sanitized fixtures; reading staging or production data requires explicit
  authorization, read-only scope, redaction, and an agreed environment
  boundary recorded in case `constraints`.
- **AVL-AC-5 (failure-to-regression):** Diagnosed-and-repaired failures become
  candidate cases that enter the regression skeleton through the same human
  value gate as discovered cases.
- **AVL-AC-6 (consumer wiring):** At least two visible workflow consumers
  route to the reference: the Agent Work Loop Change Validation dimension
  (`models/agent-work-loop.md`) and the Loop Blueprint independent-verifier
  envelope (`references/loop-engineering/loop-blueprint.md`), in addition to
  the `references/project-harness/README.md` directory index.
- **AVL-AC-7 (link integrity):** All relative links to and from the reference
  resolve, and the doc-link routing graph stays current.

## Non-goals

- Build a verification runtime, probe protocol, debugger/replay adapter, or
  any executable tooling; the reference stays implementation-neutral prose.
- Own loop owner selection, the full loop runtime contract, recovery
  evidence, or review-trigger policy; those stay with their existing owners.
- Prescribe vendor-specific technology (specific debuggers, tracing stacks,
  or record/replay products).
- Change scoring models, report schemas, skills, scripts, or templates.

## Plan and Tasks

1. Add `references/project-harness/agent-verify-loop.md` with the four planes,
   an overview mermaid flow, the verdict domain and aggregate rules, the
   regression-skeleton asset shape, the human value gate, rollout staging, and
   anti-patterns.
2. Register the reference in `references/project-harness/README.md` under
   `Owns` and `Read Next`.
3. Wire the two workflow consumers: the Change Validation routing paragraph
   and reference-ownership table in `models/agent-work-loop.md`, and the
   independent-verifier envelope item in
   `references/loop-engineering/loop-blueprint.md`.
4. Regenerate the doc-link routing graph and run the doc-link test, then the
   full repository suite.

## Test and Review Evidence

- `node --test test/doc-link-graph.test.mjs` — relative link resolution and
  routing-graph freshness.
- `npm test` — full repository suite.
- Review fixes applied before landing: production-data access boundary
  (AVL-AC-4), blocked-case aggregate verdict (AVL-AC-2), asynchronous probe
  bounds (AVL-AC-3), and consumer wiring (AVL-AC-6).
