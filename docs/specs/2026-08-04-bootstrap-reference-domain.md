# Bootstrap reference domain and spec examples

## Traceability

- Spec ID: bootstrap-reference-domain
- Status: Implemented

## Intent

The Bootstrap support track is the only Better Harness route for a project that
has no coding-agent harness yet, but its whole depth lives in a single 55-line
skill-local file, `skills/better-harness/references/support-bootstrap.md`. That
file must stay inside the skill prompt budget, so it can only say "propose the
smallest useful owner" and cannot teach what a complete, agent-executable
specification actually contains. Teams doing 0 -> 1 work therefore get owner
advice with no artifact shape, and the repository has no calibration example for
what a finished requirement spec looks like across delivery surfaces.

Split the depth out into a new `references/bootstrap/` domain that owns the
specification structure contract and stack-specific calibration examples, keep
the skill file as a thin track selector, and register the new domain in the
`references/README.md` switchboard so both agents and humans can route to it.

## Acceptance Scenarios

- **BRD-AC-1 (domain exists and routes):** `references/bootstrap/README.md`
  follows the established domain-index shape used by
  `references/loop-engineering/README.md` and
  `references/session-evidence/README.md`, with `Purpose`, `Load When`, `Owns`,
  `Does Not Own`, and `Read Next` sections.
- **BRD-AC-2 (spec structure contract):** `references/bootstrap/spec-structure.md`
  defines the required specification sections, stable id schemes for business
  rules, exception scenarios, and acceptance criteria, plus the completeness
  gates that decide whether a spec is ready for implementation.
- **BRD-AC-3 (surface honesty):** The contract states that the surface
  specification section repeats once per delivery surface, so the eight-part
  count of a two-surface project is an instantiation of the contract rather
  than a fixed section list every project must match.
- **BRD-AC-4 (three stack examples):** `references/bootstrap/examples/` contains
  a backend-service, a frontend-web, and a mobile-app spec example, each
  instantiating every required section with numbered `BR-*`, `E-*`, and `AC-*`
  ids, and each example is indexed from `examples/README.md`.
- **BRD-AC-5 (thin skill track):** `support-bootstrap.md` keeps
  `Select This Track` and `Preserve Boundaries`, routes its recommendation depth
  to the new domain, stays under 120 lines and 7,000 bytes, and preserves every
  phrase asserted by `test/better-harness-skill.test.mjs`: the explicit
  initial-guidance trigger, the zero-count exclusion, `smallest useful owner`,
  `Good AGENTS.md Example Fragments`, and the separate task-local request
  boundary.
- **BRD-AC-6 (read-only boundary preserved):** Neither the new domain nor the
  revised track authorizes asset creation, installation, activation, or
  mutation, and neither turns an initialization request into evidence that the
  target project is defective.
- **BRD-AC-7 (English-first chain):** Every file reachable from
  `skills/better-harness/SKILL.md` stays free of Han-script characters, which
  the new domain must satisfy because `support-bootstrap.md` links into it.
- **BRD-AC-8 (link integrity):** All relative links resolve, the new domain is
  registered in the `references/README.md` switchboard, and
  `docs/better-harness-doc-links.mmd` is regenerated.

## Non-goals

- Add a fourth support track, change track selection thresholds, or let
  Bootstrap add findings, change severity, or rescore a dimension.
- Own instruction-file taxonomy or quality; that stays with
  `references/agent-customize/routing.md` and `agents-md-review.md`.
- Own verification harness design, acceptance controls, or recovery evidence;
  those stay with `references/project-harness/`.
- Own durable owner selection for repeated work; that stays with
  `references/loop-engineering/`.
- Introduce a spec validator, generator, template renderer, or any executable
  tooling. This domain ships prose and examples only.
- Prescribe a vendor stack. The examples name a technology only where the
  contract shape depends on it.
- Change `docs/specs/` conventions for this repository's own specs; the new
  contract describes product requirement specs written for target projects.

## Plan and Tasks

1. Add `references/bootstrap/README.md` as the domain index, declaring what the
   domain owns, what it explicitly does not own, and the read order.
2. Add `references/bootstrap/spec-structure.md` with the required sections, the
   `BR-*` / `E-*` / `AC-*` id and traceability rules, the per-surface repetition
   rule, completeness gates, and anti-patterns.
3. Add `references/bootstrap/examples/README.md` plus three examples:
   `backend-service-spec.md` (service contract, data model, admin and
   mini-program surfaces), `frontend-web-spec.md` (page skeleton, component
   granularity, state machine, interaction constraints), and
   `mobile-app-spec.md` (offline and sync, permissions, background work,
   release gating). Each example calibrates the contract; none is a template to
   copy wholesale.
4. Rewrite the `Shape the Recommendation` section of
   `support-bootstrap.md` to route into the new domain while keeping the
   test-asserted phrases and the compact budget.
5. Register `bootstrap/` in the `references/README.md` switchboard next to the
   other support domains.
6. Regenerate the routing graph with
   `node scripts/doc-link-graph/cli.mjs skills/better-harness`.

## Test and Review Evidence

- `node --test test/doc-link-graph.test.mjs` — relative link resolution,
  Han-script-free English chain (BRD-AC-7), and routing-graph freshness
  (BRD-AC-8).
- `node --test test/better-harness-skill.test.mjs` — support-track phrase,
  line-count, and byte-budget assertions (BRD-AC-5). `support-bootstrap.md`
  measures 60 lines and 2,983 bytes after the split.
- `npm test` — 1,148 of 1,149 tests pass. The single failure is
  `Better Harness skill's English-first Markdown chain stays Han-script-free`,
  caused by the link from `references/project-harness/agent-verify-loop.md` to
  `friendly-cli.md`, which is already on `main`. That opens the chain
  `SKILL.md -> models/agent-work-loop.md -> agent-verify-loop.md ->
  friendly-cli.md -> docs/ARCHITECTURE.md` into the Docusaurus and
  `README.zh-CN.md` docs. Every edge in that chain exists without this spec's
  changes, so the failure is not attributable here and is not fixed here.
- Blast-radius check (BRD-AC-7): the transitive closure of the depth this track
  newly routes into, seeded from `spec-structure.md` and `examples/README.md`,
  contains exactly the five new in-chain files and nothing else. All eight
  touched or added files are verified Han-script-free.
- Design fix applied during implementation: an earlier draft linked
  `references/bootstrap/README.md` from the `references/README.md` switchboard
  and deep-linked `references/project-harness/agent-verify-loop.md` from
  `spec-structure.md`. Both pulled cross-domain subtrees into the English-first
  skill chain. The domain README now stays outside that chain, matching how
  `references/loop-engineering/README.md` behaves, and no switchboard entry names
  a README.
- Risk: the examples are prose fixtures with no executable verifier, so they can
  drift from the contract in `spec-structure.md`. Mitigation is that every
  example lists the same required sections in the same order, making a
  divergence visible in review.
- Risk: `references/bootstrap/README.md` is reachable only by directory browsing,
  not by a Markdown link from the switchboard. This is deliberate containment of
  the English-first chain and matches the existing `loop-engineering/` entry.
