# Cross-repository workspace topology for coding agents

## Traceability

- Spec ID: cross-repo-workspace-topology
- Status: Draft
- Story: unavailable; maintainer-requested reference addition.
- AI involvement: drafted by a coding agent from two maintainer-supplied field
  write-ups plus local repository evidence. No services or tests were run for
  this spec.

## Intent

`skills/better-harness/references/project-harness.md` inspects one target as a
single owner boundary. It has no route for the case where the thing an agent
needs does not live in the target at all: a fact owned by a sibling workspace
member or another service repository, or the working state of a task that spans
several repositories at once.

Teams answer both cases the same structural way: they introduce a **container
above the repository** that is not itself a source repository. Two shapes are now
common — a knowledge hub that centralizes cross-boundary facts, and a task
workspace that centralizes per-task working sites and evidence. Both are useful,
and both fail in the same three ways: the container is allowed to own facts a
repository already owns, so it drifts; the code it exposes is described as
current without any check that it is; and its output is reported as volume
(files, lines, task directories) rather than as a refuted claim or a reachable
route.

`references/agent-customize/knowledge-assets-review.md` already separates
`Exists` from `Routed`, `Applied`, and `Effective`. Nothing yet applies that
discipline to the **repository-side** question: what the container above the
repository is allowed to own, and how a task reaches it across an owner
boundary.

Add one reference that owns that question, and route to it from Project Harness
evidence when the task scope crosses an owner boundary.

## Recorded Field Observations

Provenance: two independent field write-ups reviewed on 2026-08-04 — Source A, a
production knowledge-hub repository for one product domain; Source B, a
personal-to-team task workspace spanning several repositories — plus local
repository evidence from `docs/specs/2026-07-25-monorepo-workspace-support.md`,
`scripts/workspace-topology/`, `references/agent-customize/knowledge-assets-review.md`,
and `skills/better-harness/references/asset-demand-reconciliation.md`.

Both field sources are recorded here in anonymized, generalized form. Their
organization, product, service, repository, module, and owner names are
deliberately not carried into this spec or the reference, so the design inputs do
not depend on a private document and no reader can mistake one team's tree for a
prescribed layout.

### Source A — knowledge hub with mounted code

```text
<domain>-hub/
  repos/            business repositories mounted as git submodules
  knowledge/
    project/        L1: workflow, glossary, governance conventions
    domain/         L2: system architecture, troubleshooting manuals
    repos/          L3: code navigation, implementation patterns
  skills/
    manifest.yaml   registry of available skills
    local/          locally authored skills
  requirements/     git-tracked requirement history
  AGENTS.md         full working conventions (host entry file points to it)
```

Stated design rules: a seven-field front matter on every knowledge file
(`owner`, `updated_at`, `status`, `confidence`, `source_type`, `type`,
`source_refs`); eight knowledge types; a 5 KB per-file cap; a progressive load
order of overview then domain then repository then code; and a
`Seed -> Review -> Verify -> Commit` authoring loop where a delegated subagent
drafts from code and a human adjudicates.

Reported outcomes: 59 knowledge files (+2,658 lines) in one domain, 50+ in
another, and four falsified facts — modules named in older code that no longer
exist in the running system.

### Source A assessment — what transfers, and what does not

| Observed element | Assessment |
| --- | --- |
| `Seed -> refute -> commit` authoring loop | Transfers. Delegated drafting with adjudication is the only affordable way to populate cross-boundary knowledge, and the falsification output is its most valuable product. |
| Falsifying stale facts against running behavior | Transfers, and should be promoted from a side effect to the primary acceptance criterion. |
| Progressive load order | Transfers as a retrieval route, not as a directory tree. |
| Hub as the agent's starting point | Transfers only for facts no single repository can own. |
| Layer `L3 repos/` restating single-repository internals | Does not transfer. It duplicates what code, tests, and the owning repository's scoped instructions already own, so it is a drift generator with no owner precedence rule. |
| Seven-field front matter and eight types | Does not transfer as given. A self-asserted `confidence` and an `updated_at` that no check reads are declared-only evidence — governance cost without an enforcement gate. |
| 5 KB per-file cap | Does not transfer. The binding constraint is the context budget of the retrieval route, not per-file bytes. |
| `git submodule` presented as the mount decision | Does not transfer as a recommendation. A pinned commit means the agent reads code that is not what runs, and the write-up records no cost, alternative, currency check, or exit condition. |
| File and line counts as the reported result | Does not transfer. Volume is not evidence; the repository's existing evidence-state ladder forbids reading it as one. |
| `skills/manifest.yaml` inside the knowledge tree | Out of scope here. Asset registry, routing, and quality are owned by `references/agent-customize/`. |

### Source B — task workspace over unmodified repositories

Source B organizes tasks rather than facts. Its stated framing: a monorepo puts
several projects into one code context, whereas this workspace puts several tasks
into one long-lived engineering context; it unifies rules, resources, evidence,
and knowledge without merging any repository's Git boundary. Its stated routing
rule is `enter by workspace, coordinate by task, execute by repository`: the
repository is an execution boundary, not an entry point, and the task is an
organizing unit, not an entry point.

The observed plane assignment, with neutral names:

```text
<workspace>/            root Git tracks rules, docs, skills, promoted knowledge
  repos/<repo>/         stable per-repository base checkout
  tasks/<task>/<repo>/  per-task linked worktree on its own branch
  tasks/<task>/artifacts/  per-task logs, screenshots, traces, reports
  skills/               execution procedures reusable across tasks
  knowledge/            reviewed, promoted long-lived knowledge
  .knowledge-pipeline/  candidates and receipts, explicitly not truth
```

Stated boundaries: `repos/` does not carry requirement changes by default; a task
worktree still belongs to its origin repository; `.knowledge-pipeline/` holds
candidates and receipts only; the root Git tracks rules, docs, skills, and
promoted knowledge while source under `repos/` and `tasks/` stays owned by each
repository; the workspace organizes but does not take over any repository's
commit, review, CI, or release boundary. The write-up also states that shared
resources — devices, ports, signing identities, build processes — still need
explicit constraints, because parallel tasks do not make shared resources
conflict-free.

### Source B assessment — what transfers, and what does not

| Observed element | Assessment |
| --- | --- |
| Container that organizes repositories without merging their Git boundaries | Transfers, and is the stronger of the two containers. It removes the pinned-revision problem that Source A's submodule mount creates. |
| Explicit non-ownership of commit, review, CI, and release | Transfers as the container's boundary statement. It is the missing half of Source A's design. |
| Two orthogonal axes: per-repository base and per-task working site | Transfers. Separating stable access from working state is what makes the container reviewable. |
| Per-task linked worktree on its own branch | Transfers as a code-access route with its own cost row, not as a mandated layout. |
| Per-task `artifacts/` retaining logs, screenshots, traces, reports | Transfers as evidence retention, but needs a privacy boundary the write-up does not state: artifacts routinely carry absolute paths, tokens, and customer data, and this container is Git-tracked. |
| `.knowledge-pipeline/` separating candidates from truth | Transfers, and is the best idea in either source. It needs the promotion gate and expiry rule that neither source defines. |
| Naming shared-resource contention as a real constraint | Transfers. This is an isolation problem the existing Environment Readiness submetric already owns. |
| `enter by workspace, coordinate by task, execute by repository` | Transfers only as a **claim to verify**. Nothing in a directory layout makes the workspace entry files load; whether they do depends on the host's instruction-activation semantics for the agent's actual working directory. |
| No stated lifecycle for `tasks/` | Gap in both sources. Abandoned task directories and stale worktrees become misleading current context; task state, retention, and pruning must be part of the design. |
| `repos/` described as a stable base | Gap. A base checkout has a milder version of the same currency problem as a pinned submodule: no stated fetch cadence, tracked branch, or check means an agent can read a stale default branch and believe it is current. |
| Cross-repository change ordering and rollback | Gap in both sources. Correctly declining to own commit, review, CI, and release leaves the cross-boundary acceptance and revert order unowned, which is a Change Safety question. |

### What the two sources jointly establish

Source A centralizes **facts** across repositories; Source B centralizes **work**
across repositories. They are the same structural move with different payloads,
they can coexist in one container, and their failure modes are complementary:
Source A has a knowledge promotion story but a bad code-access story, while
Source B has a good code-access story but no promotion gate, no task lifecycle,
and no artifact privacy boundary. A reference that only addressed one of them
would miss half of the real design surface.

### Local repository constraints

- `docs/specs/2026-07-25-monorepo-workspace-support.md` freezes topology per
  bundle and states as a non-goal: no nested Git repository, submodule
  ownership, or cross-repository topology. The frozen
  `target.kind` / `route` / `memberRoute` therefore describes one Git root only.
  Cross-repository structure is a reviewer claim built from opened evidence, not
  a value the tooling returns.
- `skills/better-harness/references/project-harness.md` is budget-bound:
  `test/better-harness-skill.test.mjs` asserts fewer than 120 lines and under
  7,000 bytes. It currently has 98 lines and 5,394 bytes, so the routing
  addition must stay small.
- `test/doc-link-graph.test.mjs` requires every relative Markdown link in the
  repository to resolve, requires the whole chain reachable from
  `skills/better-harness/SKILL.md` to be free of Han-script characters, and
  fails when `docs/better-harness-doc-links.mmd` is stale.

## Design Decisions

### D1 — Name the topology before the structure

The reference opens with a topology table, not a directory tree. Each row states
what that shape already answers and what it structurally cannot answer: single
repository; workspace members inside one Git root; independent repositories with
no container; a container that references code without exposing a checkout; a
knowledge container with code mounted at a pinned revision; a task container with
per-repository bases and per-task working sites. A directory named `hub` or
`workspace`, a submodule entry, or a `knowledge/` folder is a lead, never proof
that context is reachable or current.

### D2 — Decompose the container into three planes

The container above the repository is not one thing, and the two field sources
each built only part of it. The reference names three planes that are chosen
independently:

| Plane | Owns | Fails as |
| --- | --- | --- |
| Knowledge plane | Durable cross-boundary facts, plus the candidate staging area that is not yet truth. | Restated repository internals nobody can refute. |
| Task plane | Per-task working site, branch and worktree isolation, and retained evidence artifacts. | Abandoned task directories read as current context. |
| Code-access plane | How each repository becomes readable and runnable from the container. | A revision described as current with no check. |

Naming the planes separately is what makes the container reviewable: a team can
have a strong knowledge plane and an unchecked code-access plane, and the two
findings have different owners. The reference states that these planes may live
in one container or in none, and that the container itself is never the unit of
assessment.

### D3 — One fact, one owner, with a stated precedence

Precedence when sources disagree: code and its tests, then the owning
repository's scoped instructions, then a cross-boundary contract in the
container, then any container summary. A container may own only what no single
repository can own — cross-boundary call and change sequences, vocabulary that
differs per repository, and recorded refutations. The rule stated positively: do
not mirror what the code can answer.

### D4 — Code-access cost table plus a currency check, not a recommendation

The reference does not pick a code-access route. It states, per route
(reference-only, host multi-root or ad hoc worktree, read-only mirror, pinned
submodule, subtree copy, and per-repository base checkout with per-task linked
worktrees), what stays current, the agent-visible failure mode, and the exit
cost. It then imposes one requirement: no route may be described as current
unless a check compares the exposed revision against the upstream tracked
branch. A pinned submodule and an unfetched base checkout fail this the same way,
at different severities. This keeps the reference usable by teams on either route
while removing the unstated assumption that whatever is on disk is live truth.

### D5 — Verify the entry claim against host instruction activation

`enter by container, coordinate by task, execute by repository` is a routing
claim, and a directory layout cannot enforce it. Whether the container's root
instructions actually load depends on the host's instruction-activation semantics
for the agent's real working directory. An agent started inside
`repos/<repo>/` or `tasks/<task>/<repo>/` may never load the container's rules,
which turns the container's whole premise into `candidate` rather than
`effective` context. The reference requires the entry claim to be checked at the
working directory the agent actually uses, and routes activation semantics to the
existing per-provider instruction model rather than restating it.

### D6 — Task plane: isolation, shared resources, and lifecycle

Branch and worktree separation isolates source state, not machine state.
Devices, ports, signing identities, caches, build daemons, and external test
accounts stay shared, so the reference requires shared-resource constraints to be
named explicitly and maps them to the existing state-reset and isolation
submetric. It also requires what neither field source states: a task lifecycle.
Each task site needs a visible state, a retention boundary, and a prune path,
because a stale task directory and its retained artifacts are indistinguishable
from current context to a reading agent.

Retained artifacts additionally need a privacy boundary. Logs, screenshots,
traces, and reports routinely carry absolute paths, tokens, and customer data,
and a container that tracks them in Git is a disclosure surface. The reference
states the boundary and routes handling to the existing sensitive-code and
sensitive-write references rather than defining a new policy.

### D7 — Candidate is not truth, and every claim must be refutable

A staging area for unreviewed candidates is the strongest idea in either field
source, and it is incomplete without a gate. The reference requires the staging
boundary to be visible, the promotion gate to be stated, and promoted knowledge
to carry an expiry or re-verification trigger. Minimum elements per promoted
claim: the claim, the owning route, source references that can be reopened, and
one command or check that could refute it. Metadata is credible only when a check
reads it; fields no gate validates are governance tax. Size is bounded by the
retrieval budget of the route that loads the file, not by a byte cap.

### D8 — Seed, refute, then commit

The authoring loop is stated as `seed -> refute -> record -> commit`, with
refutation as the primary output: removing or correcting a stale claim outranks
adding a file. Counts, line totals, and coverage percentages are explicitly not
evidence, and a single authoring window cannot establish `Effective`.

### D9 — Route the reader, and map back to existing dimensions

A progressive route (entry, cross-boundary index, owning repository route, code)
replaces tree publication. The cross-boundary index is itself subject to the
Context Map capability-overload signal. Results map onto existing owners:
Context Map submetrics 1.1–1.3 for reachability and the entry claim,
Environment Readiness 2.1–2.3 for code access, setup, shared resources, and task
isolation, Quality Gates for a container drift or promotion check, Change Safety
5.2–5.3 for cross-boundary changes that have no atomic acceptance point and for
retained-artifact disclosure. No sixth dimension.

## Acceptance Scenarios

- **CRK-AC-1 (topology before structure):** The reference presents a topology
  table covering single repository, workspace members in one Git root,
  independent repositories without a container, a reference-only container, a
  knowledge container with mounted code, and a task container with per-task
  working sites, each with what it answers and what it cannot answer, and states
  that a directory name is a lead rather than evidence.
- **CRK-AC-2 (frozen-topology boundary):** The reference states that the frozen
  Evidence Bundle topology describes one Git root, so any cross-repository claim
  must be built from opened evidence and not inferred from the bundle.
- **CRK-AC-3 (ownership precedence):** The reference gives one ordered
  precedence for conflicting sources, names the narrow class of facts a container
  may own, and states that a container file restating a single repository's
  internals is a drift generator.
- **CRK-AC-4 (code-access cost and currency check):** The reference records at
  least six code-access routes — including a pinned submodule and a
  per-repository base checkout with per-task linked worktrees — with what stays
  current, the agent-visible failure mode, and the exit cost; recommends none of
  them; and requires a check against the upstream tracked branch before any route
  is described as current.
- **CRK-AC-5 (refutable knowledge):** The reference requires claim, owning
  route, reopenable source references, and one refuting check per knowledge
  file, and states that metadata no gate reads is declared-only evidence.
- **CRK-AC-6 (retrieval budget over byte cap):** The reference bounds knowledge
  size by the retrieval route's context budget and does not prescribe a byte or
  line cap.
- **CRK-AC-7 (refutation as primary output):** The reference states the
  `seed -> refute -> record -> commit` loop with refutation as its primary
  output, and states that file counts, line counts, and coverage percentages are
  not evidence and that one window cannot establish `Effective`.
- **CRK-AC-8 (dimension mapping, no sixth dimension):** The reference maps its
  results to Context Map, Environment Readiness, Quality Gates, and Change
  Safety submetrics, states that cross-boundary knowledge is not a sixth
  dimension, and forbids claiming that knowledge was used or effective from
  repository-side evidence alone.
- **CRK-AC-9 (ownership and routing):** The reference declares its boundary
  against `references/agent-customize/` (asset presence, routing, quality),
  `references/session-evidence/` (demand), and
  `models/software-fluency.md` (the ladder).
  `skills/better-harness/references/project-harness.md` routes to it under a
  stated condition, and `references/project-harness/README.md` registers it
  under `Owns` and `Read Next`.
- **CRK-AC-10 (routing budget preserved):** After the routing addition,
  `skills/better-harness/references/project-harness.md` stays under 120 lines
  and 7,000 bytes, and `test/better-harness-skill.test.mjs` passes unchanged.
- **CRK-AC-11 (link integrity and English-only chain):** All relative Markdown
  links to and from the reference resolve, the reference contains no Han-script
  characters, and `docs/better-harness-doc-links.mmd` is regenerated.
- **CRK-AC-12 (anonymized provenance):** Neither the reference nor this spec
  contains either field source's organization, product, service, repository,
  module, or owner names, and any structural example in the reference is
  presented as a plane assignment with neutral placeholders rather than as a
  layout to copy.
- **CRK-AC-13 (plane decomposition):** The reference names knowledge, task, and
  code-access as independently chosen planes of the container above the
  repository, states what each owns and how each fails, and states that the
  container itself is not the unit of assessment.
- **CRK-AC-14 (entry claim is verified, not assumed):** The reference states that
  a container entry route is a claim which must be checked against the host's
  instruction-activation semantics at the working directory the agent actually
  uses, and that unverified container rules are `candidate` rather than
  `effective` context.
- **CRK-AC-15 (task plane isolation and lifecycle):** The reference states that
  branch and worktree separation does not isolate shared machine resources,
  requires shared-resource constraints to be named, and requires a task state,
  retention boundary, and prune path because stale task sites read as current
  context.
- **CRK-AC-16 (candidate is not truth):** The reference requires a visible
  staging boundary for unreviewed candidates, a stated promotion gate, and an
  expiry or re-verification trigger on promoted knowledge.
- **CRK-AC-17 (retained-artifact disclosure boundary):** The reference states
  that retained task artifacts are a disclosure surface when the container tracks
  them, and routes handling to the existing sensitive-code and sensitive-write
  references without defining a new policy.

## Non-goals

- Change `scripts/workspace-topology/`, the frozen topology contract, the
  Evidence Bundle, the finding target contract, or any collector. The
  cross-repository non-goal in `docs/specs/2026-07-25-monorepo-workspace-support.md`
  stands; this change adds review prose only.
- Prescribe a container directory layout, a task directory scheme, a knowledge
  front-matter schema, a knowledge type taxonomy, or a file-size limit.
- Recommend or discourage a specific code-access mechanism, or endorse a
  workspace manager, worktree tool, vendoring tool, or monorepo build system.
- Own agent asset presence, routing, quality, or registry concerns; those stay
  in `references/agent-customize/`.
- Prove knowledge demand; two comparable Episodes and the join with coverage
  remain owned by `skills/better-harness/references/asset-demand-reconciliation.md`.
- Add a dimension, submetric, check, score, report field, or finding category.
- Add a validator, script, template, hook, or host adapter.
- Edit `CHANGELOG.md`, roadmap, or other task-external project metadata.

## Plan and Tasks

1. Add `references/project-harness/cross-repo-workspace.md` (target 150–180
   lines, English only, house skeleton: title paragraph declaring ownership,
   `Inspection Question`, numbered sections for D1–D9, closing `Review Result`
   block) implementing CRK-AC-1 through CRK-AC-8 and CRK-AC-13 through
   CRK-AC-17.
2. Add one conditional routing section to
   `skills/better-harness/references/project-harness.md`, at most 12 lines and
   800 bytes, triggered when the frozen topology reports `workspace-member` or
   `repo-subtree`, or when the target's context or working state depends on a
   sibling member, a container above the repository, or another repository. Keep
   the mapping sentence that forbids a sixth dimension.
3. Register the reference in `references/project-harness/README.md` under `Owns`
   and `Read Next`.
4. Regenerate the routing graph with
   `node scripts/doc-link-graph/cli.mjs skills/better-harness`.
5. Run the focused tests, then the full suite.
6. Run a Review Readiness Check over the local diff before review.

## Test and Review Evidence

Planned; this spec is `Draft` and nothing below has been run yet.

| AC | Required evidence |
| --- | --- |
| CRK-AC-1..CRK-AC-8, CRK-AC-13..CRK-AC-17 | Manual contract review against the reference headings, tables, and closing block. |
| CRK-AC-9 | `node --test test/maturity-models.test.mjs`; consumer and README registration review. |
| CRK-AC-10 | `node --test test/better-harness-skill.test.mjs`; line and byte count of the routed owner. |
| CRK-AC-11 | `node scripts/doc-link-graph/cli.mjs skills/better-harness` then `node --test test/doc-link-graph.test.mjs`. |
| CRK-AC-12 | `node --test test/legacy-product-names.test.mjs`; manual scan of the reference and spec for field-source identifiers. |

```bash
node scripts/doc-link-graph/cli.mjs skills/better-harness
node --test test/doc-link-graph.test.mjs test/better-harness-skill.test.mjs
node --test test/maturity-models.test.mjs test/legacy-product-names.test.mjs
npm test
git diff --check
```

## Risks

- **Reference read as a container blueprint:** a document that discusses hubs and
  workspaces invites copying a layout. Mitigate by publishing no full tree,
  keeping every structural example a neutral plane assignment, and leading with
  the topology and plane decisions instead of the directory.
- **Overlap with `agent-customize`:** knowledge is close to asset review, and a
  vague boundary would duplicate `knowledge-assets-review.md`. Mitigate with an
  explicit ownership paragraph: this reference owns where a fact or working state
  may live and how a task reaches it; asset presence, routing, and quality stay
  in `agent-customize`.
- **Routing owner budget:** `project-harness.md` has roughly 21 spare lines and
  1,600 spare bytes against its assertions. Mitigate by capping the routing
  section and verifying counts as part of CRK-AC-10.
- **Cross-repository scope creep into tooling:** stating a cross-boundary review
  route can be misread as authorizing submodule-aware or container-aware
  collection. Mitigate by restating the existing tooling non-goal inside the
  reference boundary paragraph.
- **Reference growth past its usefulness:** nine decisions across three planes
  can outgrow the house reference size and stop being loadable mid-task.
  Mitigate by keeping each section to a table plus a rule, and by routing to
  existing owners instead of restating them.
- **Two-source design input:** both containers are individual team practices.
  They inform failure modes; they do not license a normative layout. Mitigate by
  recording provenance and by expressing every rule as a check the reviewer can
  apply to any topology, including a project with no container at all.
- **Task plane read as authorization:** describing per-task worktrees and
  retained artifacts can be misread as license for an agent to create branches,
  worktrees, or tracked artifacts during a read-only review. Mitigate by stating
  in the reference that it inspects an existing arrangement and creates nothing.

## Open Questions

- [NEEDS CLARIFICATION: whether `references/agent-customize/knowledge-assets-review.md`
  should also gain a one-line route to this reference, or whether one-way
  routing from Project Harness is enough to avoid a mutual-reference loop.]
- [NEEDS CLARIFICATION: whether the task plane deserves its own future reference
  once cross-boundary change ordering, rollback, and artifact retention are
  specified. This spec keeps it as one section because splitting it now would
  create a reference with no independent trigger.]
