# Community Extensibility

## Start Here

Most contributions touch one of two surfaces. Try these before reading the full
matrix below:

1. **Add guidance to an existing workflow** -> drop a topic-scoped Markdown file
   in `skills/<skill>/references/` (or shared `references/`). No code, no schema;
   just stable headings and a link/path check.
2. **Add a report style** -> add a directive-only `templates/style/<style>.md`
   and route it in `templates/style/routing.md`. Style files own visual grammar,
   not runnable skeletons.

Reach for the full surface matrix only when you add executable behavior (scripts,
hooks), a maturity model or detector, a host adapter, or packaging.

To add a Coding Agent host, start with
[Contributing a New Coding Agent Host](adapters/contributing-new-coding-agent.md).
It turns the matrix row into an evidence, implementation, cross-platform, and
review workflow without making every support slice mandatory.

## Extensible Surfaces

This is the complete reference. For the common cases, see Start Here above.

| Surface | Extensible by community | Canonical owner | Contract required | Activation path | Validation evidence |
| --- | --- | --- | --- | --- | --- |
| Shared workflow | Yes | `skills/<skill>/` | `SKILL.md` frontmatter and concise workflow; optional `references/` for conditional detail | Triggered by the host skill loader or packaged plugin | `quick_validate.py`, realistic prompt smoke, path checks |
| Skill detail and reusable guidance | Yes | `skills/<skill>/references/` or shared `references/` | Topic-scoped Markdown with stable headings and source boundaries | Loaded only when the skill or agent task needs it | Link/path check; consumer grep for any 2+ consumer claim |
| Maturity model | Yes, additive only | `models/<model>.md` plus `models/routing.md` | Stable `model_id`, aliases, audience, levels, dimensions, evidence sources, scoring and confidence rules | Selectable through model routing after routing-file registration | Model-routing checks, fixture/report sample, no mutation of built-in defaults unless intentional |
| Detector or analysis signal | Yes | owning `models/<model>.md`, `scripts/<business-capability>/`, or `skills/<skill>/references/` | Detector or signal id when stable, source evidence, emitted fields, false-positive and downgrade rules | Selected through model, capability, or skill routing; shared prose needs two visible workflow consumers | Fixtures or sample evidence ledger plus behavior, report-quality, or model-routing checks |
| Executable analysis capability | Yes, but only with tests | `scripts/<business-capability>/cli.mjs` | CLI contract, JSON output shape, fixtures, scoped helpers | Called by skills, hooks, reports, or host adapters | `node --test`, fixture assertions, cross-platform command construction |
| Host evidence adapter | Yes | `scripts/<capability>/platforms/<host>.mjs` and `docs/adapters/README.md` | Matrix row with discovery paths, normalized evidence shape, smoke command, and split trigger if needed | Capability-specific host collection; not packaging | Host matrix entry, smoke command or explicit unavailable note |
| Lifecycle enforcement | Yes, narrowly | `hooks/hooks.json.template` and `hooks/git-scripts/<hook>/` | Hook event, mode, command contract, expected failure behavior | Installed from the template into host lifecycle points | Hook fixture/test or dry-run output; no shell-specific assumptions |
| Reporting template family | Yes, with routing and runtime tests | `templates/reporting/` | `report-structure.md` owns Markdown structure; mode files own metadata, companion rules, imports/props, and validation | Selected by report generation and output mode | Template tests, parser checks, path checks, and visual preview/smoke when relevant |
| Style grammar | Yes | `templates/style/` | Directive-only visual language; no runnable skeletons | Selected by report/style routing | Style-template tests and no copied runtime skeletons |
| Structured knowledge | Candidate only | `knowledge-base/{official,community}/...` | `knowledge.md`, interim `schema.json`, fixtures, namespace uniqueness | Docs-only until registry spec, compiler, and binding tests exist | Namespace check, schema/fixture review, migration note |
| Examples and operating models | Yes | `case-studies/` | Named example, scope, evidence boundary, non-runtime status | Reference material only unless separately bound | Link/path check; no runtime-policy claims |
| Host shell and packaging | Thin, or generated only after a split trigger | `.claude-plugin/`, `.qoder-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/`, `qwen-extension.json`, the `pi` manifest in `package.json`, future lifecycle shells | Install/discovery metadata and pointers to canonical owners | Public npm package includes all six current metadata roots; the Qoder runtime bundle includes only `.qoder-plugin/`, and generated host artifacts stay source-local | `scripts/npm-package/` verification, or split adapter note plus target builder |

## Non-Extension Boundaries

Do not use community extensibility as a reason to:

- fork built-in models or templates for small preference changes;
- put product judgment inside `.claude-plugin/`, `.qoder-plugin/`,
  `.cursor-plugin/`, `.codex-plugin/`, future host shells, or `.agents/skills/`;
- activate `knowledge-base/` assets without the registry, compiler, fixture, and
  consumer-binding gates;
- add `scripts/core/` or broad umbrella modules;
- store raw transcripts, private logs, or impressionistic review commentary as
  durable assets;
- claim a second consumer from casual prose mentions.

## Contributor Intake Matrix

| Contributor says | Route first | Ask for | Reject or delay when |
| --- | --- | --- | --- |
| "Add a new workflow for agents" | `skills/<skill>/` | Trigger conditions, inputs, outputs, failure modes, validation prompt | It is only a one-off prompt or belongs in an existing skill reference |
| "Add a new maturity lens" | `models/` | Model id, levels, dimensions, evidence and confidence rules, index entry | It mutates built-in defaults without saying so |
| "Add a new detector signal" | Owning model, executable capability, or skill-local reference | Signal id, source evidence, false-positive boundary, projection target, and visible consumer | It has no evidence field, runtime or workflow owner, or consumer |
| "Add language/framework knowledge" | `references/` first; `knowledge-base/` only with schema and fixtures | Source boundary, examples, fixture expectations | It is docs-only but tries to become runtime-active |
| "Add host support" | [new Coding Agent guide](adapters/contributing-new-coding-agent.md), then `docs/adapters/README.md` matrix row | Native host/version evidence, supported slices, discovery paths, evidence sources, smoke command, packaging status, split trigger if needed | It copies another adapter, mixes host evidence collection with package generation, or overstates partial support |
| "Add a script" | `scripts/<business-capability>/` | CLI contract, JSON shape, fixtures, tests | It is ad-hoc debugging that belongs in `dev/` |
| "Add an enforcement rule" | `hooks/` | Lifecycle event, expected blocking behavior, dry-run or fixture proof | A prompt reminder would be enough |
| "Add a report or visual mode" | `templates/reporting/` | Parser contract, consumer path, preview or static check | It duplicates runtime rules into the base report template |
| "Package this for another agent host" | Host matrix first; split adapter note and builder only after a trigger | Canonical source pointers, lifecycle evidence, and generated shell boundaries | The package would own canonical logic |

## Review Checklist

Before merging a community extensibility change, confirm:

- The change starts from `AGENTS.md` and this file, then follows the ADR owner.
- New behavior has an explicit contract and validation evidence.
- Runtime-active changes include tests or fixtures, not only prose.
- Docs-only candidates say they are not runtime-active.
- Generated or host-specific shells stay thin and point back to canonical source.
- Cross-platform commands avoid shell-specific syntax and use argv-style
  execution where code is involved.
- The review evidence names changed modules, activation state, risk, and any
  unknowns.
