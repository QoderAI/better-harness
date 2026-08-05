# Agent verify loop cross-stack generalization

## Traceability

- Spec ID: agent-verify-loop-cross-stack
- Status: Implemented

## Intent

The original `references/project-harness/agent-verify-loop.md`
(spec: `2026-08-04-agent-verify-loop-reference.md`) framed the whole loop
around backend long-chain systems: Plane 3 required "one identifier" (trace
id, order id) and outcomes were "write targets". That framing excludes
deliverables agents change every day — frontend UI (visual/DOM diff),
mini-program screens, mobile apps, CLIs, data pipelines, model-generated
output, infrastructure stacks. Rewrite the reference so the four-plane
framework is stack-neutral: generalize the probe input to a correlation
handle, generalize write targets to outcome surfaces, name the judging
modes, and map common scenario families explicitly.

## Acceptance Scenarios

- **AVLX-AC-1 (correlation handle):** Plane 3 accepts two handle forms — a
  returned identifier, or the fully-pinned trigger input itself (e.g. route
  + fixture + viewport) — so UI, mini-program, and CLI cases fit without an
  id-returning backend.
- **AVLX-AC-2 (judging modes):** The reference names exact assertion,
  tolerance comparison, baseline (golden) comparison, and property/rubric
  evaluation, and requires every mode to emit the same four verdicts
  (`pass | fail | unobserved | blocked`).
- **AVLX-AC-3 (scenario families):** A Scenario Families section maps at
  least service/API chains, web UI, mini-programs, mobile apps, CLIs, data
  pipelines, model/LLM output, and infrastructure-as-code to trigger,
  correlation handle, evidence, and default judging mode, and states the
  list is open-ended via the four plane questions.
- **AVLX-AC-4 (baseline honesty):** Baseline creation and every baseline
  update pass the human value gate; auto-approved baselines and tolerance
  widening to silence flaky diffs are named anti-patterns.
- **AVLX-AC-5 (invariants preserved):** The four planes, the four-valued
  verdict domain, aggregate-verdict rules, async bounds, the data-access
  boundary, the failure-to-regression path, and the bootstrap order from
  the original spec's AVL-AC-1..AVL-AC-5 all still hold.
- **AVLX-AC-6 (consumer wording):** The routing descriptions in
  `models/agent-work-loop.md`, `references/loop-engineering/loop-blueprint.md`,
  and `references/project-harness/README.md` reflect the cross-stack scope
  instead of long-chain-only wording.
- **AVLX-AC-7 (link integrity):** All relative links to and from the
  reference resolve and the routing graph stays current.

## Non-goals

- Build any executable verification tooling, visual-diff runner, or
  automation adapter; the reference stays implementation-neutral prose.
- Prescribe vendor-specific technology (specific browser drivers,
  mini-program automators, diff engines, or eval frameworks).
- Change ownership boundaries: loop owner selection, loop runtime contract,
  recovery evidence, and review-trigger policy stay with their owners.
- Change scoring models, report schemas, skills, scripts, or templates.

## Plan and Tasks

1. Rewrite `references/project-harness/agent-verify-loop.md`: generalize the
   intro and Load When, rename Plane 3 to correlation handle with two handle
   forms, add judging modes and determinism-pinning constraints, add the
   Scenario Families table, generalize the skeleton field docs, extend the
   human gate to baseline approval, and add baseline/threshold
   anti-patterns.
2. Update consumer wording in `models/agent-work-loop.md` (routing paragraph
   and reference-ownership table), `references/loop-engineering/loop-blueprint.md`
   (independent-verifier envelope), and `references/project-harness/README.md`
   (`Owns` entry).
3. Run the doc-link test to confirm link resolution and routing-graph
   freshness.

## Test and Review Evidence

- `node --test test/doc-link-graph.test.mjs` — relative link resolution and
  routing-graph freshness.
- `node --test test/maturity-models.test.mjs` — `models/agent-work-loop.md`
  structural invariants after the routing-paragraph edit.
