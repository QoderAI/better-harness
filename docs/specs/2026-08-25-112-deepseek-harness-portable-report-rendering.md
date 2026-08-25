# DeepSeek Harness Portable Report Rendering

## Traceability

- Spec ID: deepseek-harness-portable-report-rendering
- Story: #112
- Status: Implemented
- Approved scope: [Issue #112](https://github.com/QoderAI/better-harness/issues/112)
- Qualified native baseline: DeepSeek Harness `0.1.1-rc.2` at
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## Product story

> A DeepSeek Harness user invokes `/better-harness` in a qualified project.
> Better Harness collects the already-supported Session, configured-asset,
> project, and shared Harness evidence and reconciles one reviewed findings
> input. Instead of stopping at inline/no-files analysis, an ordinary durable
> run publishes `findings.json`, `report.md`, and `report.html` under the normal
> Better Harness DSH output root and returns the renderer-reported report path.
> When the user explicitly selects inline or no-files output, the same analysis
> remains available and no durable artifact is written.

On success, the user receives a compact result such as `N findings. Open the
report`, linked to the renderer-reported primary report. On failure, the user
receives a bounded failure for the stage that failed and no success link to an
unvalidated or unpublished report. A prior valid run remains available wherever
the existing generic publication owner guarantees rollback or preservation.

## Intent and current gap

Post-#110 DSH can already:

- discover and explicitly invoke the canonical Better Harness Skill;
- analyze persisted DSH Session evidence;
- collect qualified filesystem Skills and cwd-sensitive Instructions;
- enter shared Asset Practices and neutral Harness analysis;
- build Evidence Bundle v3 under a frozen parameter context;
- reconcile shared findings; and
- return inline/no-files analysis.

DSH currently advertises `SESSION_ANALYSIS`, `AGENT_CUSTOMIZE`,
`ASSET_PRACTICES`, `HARNESS_REPORT`, and `EVIDENCE_BUNDLE`, but not
`REPORT_RENDERING` or `CHECKUP`. The missing rendering capability keeps the
final durable-output path unavailable even though the reviewed findings use the
existing generic report-data contract.

Issue #112 adds no analysis intelligence. It qualifies the already-supported shared
analysis result for the existing portable durable publication path.

## Architecture decision

DSH joins the existing generic portable-host branch:

```text
Evidence Bundle v3 and shared analysis
-> three independent evidence passes
-> lead reconciliation
-> one reviewed findings.json
-> harness render --mode html
-> repair and normalize report data
-> same-parent staging
-> artifact and report validation
-> same-parent rename-based atomic publication with replacement/rollback
-> findings.json + report.md + report.html
```

Evidence Bundle is not renderer input. The lead consumes its evidence and
`summaryFacts`, performs reconciliation, and authors the reviewed findings data
that the renderer accepts. There is no DSH Evidence Bundle-to-renderer adapter,
DSH report-data schema, or DSH renderer.

This flow has two deterministic executable boundaries around one model-authored
boundary:

```text
raw/native evidence
-> deterministic privacy projection into public shared evidence
-> Better Harness Skill / model lead reconciliation
-> reviewed findings
-> deterministic portable rendering and publication
```

The public-evidence projection and reviewed-findings renderer are executable
software interfaces. Lead reconciliation is model-authored through the Better
Harness Skill. #112 does not add a deterministic command planner,
raw-evidence-to-findings reconciliation API, or second privacy pipeline.

The existing owners remain canonical:

- `scripts/host-support/index.mjs` owns capability qualification.
- `skills/better-harness/SKILL.md` owns `/better-harness` orchestration and the
  output choice.
- `templates/reporting/routing.md` owns the report-route switchboard.
- `scripts/harness-analysis/report-data-schema.mjs` owns shared input
  normalization and findings publication projection.
- `scripts/harness-analysis/render-report.mjs` owns output location, staging,
  validation, and publication.
- `scripts/harness-analysis/renderers/html.mjs` and `markdown.mjs` own the
  shared portable presentations.

## Capability contract

After #112, DSH advertises exactly:

```text
SESSION_ANALYSIS
AGENT_CUSTOMIZE
ASSET_PRACTICES
HARNESS_REPORT
REPORT_RENDERING
EVIDENCE_BUNDLE
```

`CHECKUP` remains absent. `REPORT_RENDERING` admits DSH to the render platform
allowlist and portable HTML route. It does not grant Canvas, Studio, Checkup,
plugin lifecycle, or any new evidence authority. Tests assert the entire DSH
capability array in order, not a subset.

## Routing and output-root contract

The normal DSH durable route uses `mode=html`. Qoder and Cursor retain their
Canvas modes; DSH never selects either Canvas mode. DSH requires no new
host-specific Skill workflow: capability qualification makes it an “other
rendering host,” and the explicit portable-host route list is updated to match.

The default Skill-owned durable root is:

```text
<target>/.dsh/better-harness
```

It is derived from Better Harness's existing
`<target>/.<provider>/better-harness` convention. Better Harness owns this
subtree; it is not a native DSH storage contract.

The path terms remain distinct:

- **target**: the selected workspace/project whose evidence is analyzed. It is
  passed to the renderer for topology validation and target identity.
- **out root**: the host report root. The Skill passes the target-local absolute
  `.dsh/better-harness` path through `--out`; the CLI's provider-derived
  `.dsh/better-harness` default is otherwise resolved from the process cwd.
- **run directory**: one report run. Without `--run-dir`, the renderer allocates
  a date/time/target-slug directory below `--out`. A relative `--run-dir` is
  resolved below `--out` and must remain contained there. An absolute
  caller-selected `--run-dir` remains exact and intentionally bypasses
  relative containment.

The Skill command remains the generic command:

```text
<cli> harness render --findings <run-dir>/findings.json --mode html --out <target>/.dsh/better-harness --run-dir <run-dir> --target <target> --validate --json
```

Only `status: pass` is success. The Skill returns the exact renderer-reported
primary report path rather than constructing or guessing a path.

## Report-data and artifact contract

The canonical renderer input is one reviewed object with shared `summary` and
`findings` fields. `normalizeReportData()` applies the current generic mode,
language, target, topology, and finding validation. No provider-specific DSH
field is required and no report-data schema changes.

For portable HTML, successful publication contains exactly:

| Artifact | Role |
| --- | --- |
| `findings.json` | Repaired/normalized canonical publication data projected from the reviewed input |
| `report.md` | Derived Markdown presentation of the same reviewed data |
| `report.html` | Derived self-contained HTML presentation of the same reviewed data |

Missing or unexpected run-directory artifacts fail the existing exact-set
validation. `report.html` retains the current validator rules:

- no remote script, external stylesheet, or remote HTTP(S) asset URL;
- no `fetch`, Canvas package import, or Codex/ChatGPT host deep-link;
- no `window.openai`, dynamic import, `XMLHttpRequest`, or `WebSocket` in the
  interaction controller; and
- embedded action and interaction data remain the exact bounded projections
  validated by the shared HTML owner.

## Explicit inline/no-files contract

An explicit inline or no-files selection remains write-free after DSH gains
`REPORT_RENDERING`. The canonical parsed routing contract declares that an
ordinary durable DSH request selects portable HTML while an explicit inline or
no-files request selects the write-free route and no durable renderer. The
executable evidence/no-files path creates no report root, run directory,
staging directory, `findings.json`, `report.md`, or `report.html`. The reconciled
inline analysis remains available.

The capability changes the ordinary durable route; it does not remove the
explicit write-free route. This is a composed qualification: structured routing
owns the model-facing output decision, and the executable no-files evidence path
owns the zero-report-write receipt. It is not one deterministic execution of the
model-authored Skill.

## Publication and failure contract

DSH inherits the generic renderer without changing its publication algorithm:

1. Resolve the target, out root, and run directory.
2. Reject a relative run directory that escapes `--out`.
3. Reject an existing run containing unexpected artifacts.
4. Create a staging directory beside the final run directory.
5. Render all expected artifacts into staging.
6. Validate the complete staged artifact set when `--validate` is selected.
7. Publish only after validation succeeds.
8. When replacing an existing run, rename it to a same-parent backup, rename
   staging into place, and remove the backup after success.
9. If final publication fails, restore the backup when possible. A rollback
   failure is reported distinctly.

No renderer-created partially validated run becomes public. Staging is removed
after rendering or validation failure. A caller-owned pre-existing input
`findings.json` is not silently deleted; therefore the Skill must never describe
a draft-only directory as a published report.

The user-visible failure boundaries are:

| Stage | Required behavior |
| --- | --- |
| Analysis/reconciliation | Return the existing bounded analysis failure; do not invoke rendering |
| Report-data repair/validation | Return the generic invalid-findings/input failure before publication |
| Artifact rendering | Remove renderer staging, preserve pre-existing output, return failure |
| Artifact validation | Return `VALIDATION_FAILED`, remove staging, and publish no success link |
| Final rename/publication | Return `PUBLISH_FAILED`; restore a prior run where rollback succeeds |
| Publication rollback | Return `PUBLISH_ROLLBACK_FAILED`; do not claim prior-output preservation |

No DSH-specific error taxonomy is introduced, and no failure is reported as
success.

## Durable privacy and temporal semantics

Durable privacy is qualified at two independently executable boundaries.

First, existing DSH Session, configured-assets, Asset Baseline, and Evidence
Bundle owners project raw/native evidence into public evidence before
model-authored lead reconciliation. Their owner tests introduce applicable raw
canaries and prove that serialized public evidence omits or safely projects:

- a private home path;
- an off-tree POSIX absolute path;
- a Windows drive absolute path;
- a UNC path;
- a private Skill body;
- a private Instruction body;
- a credential/API-key canary; and
- a symlink target realpath.

Approved public projections may remain: `<workspace>`, `<workspace>/...`,
`<git-root>/...`, `~/...`, and `<path>`.

Second, rendering persists correctly projected, already-reviewed report data;
it is not another privacy projector. All three final artifacts preserve those
safe projections, and the renderer must not reconstruct raw target, source,
Skill, Instruction, credential, or symlink metadata that is absent from the
reviewed input. Operational output paths returned to the local caller are
distinct from artifact content. Passing deliberately unsanitized free text as
reviewed findings is not a valid renderer privacy test: the generic renderer
intentionally preserves reviewed content rather than inventing a new sanitizer.

There is deliberately no single deterministic raw-evidence-to-final-artifact
test. The boundary between public shared evidence and reviewed findings is
model-authored lead reconciliation. Privacy qualification composes the upstream
raw-to-public owner receipts with the reviewed-findings-to-three-artifact
renderer receipt.

The composed qualification uses these existing executable owners rather than a
new mega-test:

| Raw canary | Upstream public-evidence owner and receipt |
| --- | --- |
| Private home and off-tree POSIX paths | Asset Baseline locator projection in `test/agents/agent-asset-baseline.test.mjs` |
| Windows drive and UNC paths | Evidence Bundle nested-stage error projection in `test/reporting/better-harness-evidence-bundle.test.mjs` |
| Private Skill and Instruction bodies | DSH configured-practice projection in `test/reporting/task-loop-source.test.mjs` and `test/agents/agent-customize-dsh.test.mjs` |
| Credential/API-key values | DSH Session public projection in `test/sessions/session-analysis-dsh-provider.test.mjs`; its credential-shaped fixture is guarded by `test/sessions/session-analysis-dsh-fixtures.test.mjs` |
| Symlink target realpath | DSH configured-assets symlink projection in `test/agents/agent-customize-dsh.test.mjs` and Asset Baseline off-tree locator projection |

`test/reporting/harness-report-render-cli.test.mjs` independently owns the
reviewed-findings-to-`findings.json`/`report.md`/`report.html` preservation
receipt.

Rendered JSON, Markdown, and HTML also preserve #104's temporal boundary.
They may distinguish current configuration at collection time,
`configured-not-observed`, and independent historical Session observations.
They must not claim that:

- a current Skill or Instruction existed during a historical Session;
- a historical Session used a currently configured asset;
- current configuration influenced historical behavior;
- same-name current and historical assets have the same identity; or
- multi-owner configured evidence was captured atomically.

The shared bounded/sanitized ordinary Session request-summary policy is
unchanged. #112 neither removes permitted request prose nor creates a new DSH
request-summary projector.

## Windows and cross-platform output contract

#112 qualifies the existing generic output router for DSH. It does not import
configured-cwd canonicalization or add a DSH path algorithm.

Deterministic coverage includes:

- Windows drive and UNC targets/output roots;
- spaces and Unicode;
- target-local `.dsh/better-harness` construction;
- native separators for filesystem paths and portable separators only where a
  report/URL contract requires them;
- relative run-directory containment and `..` escape rejection;
- sibling-prefix collision rejection; and
- exact absolute-run-directory behavior.

Target/topology identity already uses realpath-backed filesystem identity.
Output-root and run-directory containment intentionally use their independent
`path.resolve()`/`path.relative()` contract. Windows short/long aliases are not
promoted into a new output-root equivalence guarantee: an absolute aliased run
directory remains an exact caller-selected path, while relative containment is
lexical beneath the resolved out root. Assessment: the current generic contract
does not justify a mandatory short/long-alias equivalence RED. If a stable
Windows CI fixture exposes equivalent aliases, a receipt may assert that these
existing rules produce no false target mismatch; the Story must not invent
cross-alias containment.

## Native DSH inertness contract

The qualified native receipt remains pinned to DSH `0.1.1-rc.2` at
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` and the exact tree:

```text
<project>/.dsh/better-harness/
  findings.json
  report.md
  report.html
```

Adding that subtree must not change semantic discovery of Skills,
Instructions, Presets, Profiles, Sessions, or configured native asset roots.
Explicit hidden-path completion may expose the ordinary physical files only
when requested; it is not semantic consumption.

`scripts/dsh-configured-assets/native-smoke.mjs` is the canonical future receipt
owner because it already pins and loads the native rc.2 Skill/Instruction/home
owners and compares their semantics credential-free. Extend its synthetic
fixture with a before/after exact report subtree comparison, loading additional
pinned first-party native owners inside the temporary smoke installation only
where needed for Preset/Profile/Session invariants. This does not add a package
dependency or make DSH rendering a native dependency.

## Packaging and shared-host isolation

No new dependency, renderer, template family, CSS/static asset, binary, or
packaged root is required. The npm package already ships `scripts/`, `skills/`,
and `templates/`; the runtime zip recursively includes the same roots and
already-shipped dependencies. `npm run pack:verify` remains the canonical npm
and runtime-zip closure gate.

The shared routing change must preserve current host behavior:

| Hosts | Required route after #112 |
| --- | --- |
| Grok, Kimi, WorkBuddy, Codex and other current portable hosts | Existing portable HTML |
| Qoder | Existing Qoder Canvas |
| Cursor | Existing Cursor Canvas |
| DSH | Portable HTML |

No host unexpectedly gains or loses `REPORT_RENDERING`, `CHECKUP`, or Canvas.

## Acceptance scenarios

### AC-1: Exact capability boundary

DSH gains exactly `REPORT_RENDERING` in addition to its five approved
capabilities. `CHECKUP` remains absent, and the complete ordered capability
array is asserted.

### AC-2: Portable mode

An ordinary durable DSH run selects the generic `html` mode and never selects
Qoder or Cursor Canvas.

### AC-3: Existing renderer reuse

DSH uses the existing report-data normalization and shared HTML/Markdown
renderers. No DSH-specific renderer, schema, findings type, or Evidence
Bundle-to-renderer transform is introduced.

### AC-4: Default output root

The Skill passes the target-local Better Harness root
`<target>/.dsh/better-harness` under the generic provider-root convention.
Target, out root, and run directory retain their distinct generic meanings.

### AC-5: Exact artifact set

A successful DSH durable run publishes exactly `findings.json`, `report.md`,
and self-contained `report.html`; missing or unexpected artifacts fail.

### AC-6: Shared report-data contract

Current canonical reviewed findings/report data is accepted without a DSH
transform or provider-specific field. The final `findings.json` is the existing
repaired/normalized publication projection.

### AC-7: Skill durable route

`/better-harness` can route DSH through the existing portable durable branch,
invokes the generic render command once, succeeds only on `status: pass`, and
returns the exact renderer-reported report path.

### AC-8: Explicit no-files

Explicit inline/no-files DSH behavior is qualified by two receipts: the parsed
Skill/routing contract selects no durable renderer while ordinary DSH durable
mode selects portable HTML, and the executable no-files evidence path creates no
report root, staging directory, or report artifact. No deterministic model
command planner is introduced or implied.

### AC-9: Publication safety

DSH inherits existing same-parent staging, full validation-before-publication,
same-filesystem rename publication, replacement backup, rollback, relative
containment, and exact absolute run-directory behavior. No renderer-created
partial run is published.

### AC-10: Durable privacy

Durable privacy is qualified by two independently executable boundaries:
existing upstream DSH/shared-evidence owners remove or project applicable raw
path, private-body, credential, and symlink-target canaries before model/lead
reconciliation; then the portable renderer preserves correctly reviewed safe
projections across final JSON, Markdown, and HTML without reconstructing raw
private values. Operational output paths remain caller data, not artifact
content. #112 adds no deterministic reconciliation API.

### AC-11: Temporal semantics

Rendered data and prose preserve `configured-not-observed`, current collection
time, and independent historical evidence without inferring historical
existence, identity, use, causality, or atomic snapshots.

### AC-12: Cross-platform routing

DSH qualifies existing Windows drive, UNC, space, Unicode, separator,
output-root, run-directory containment, escape, sibling-prefix, and exact
absolute-path behavior without DSH-specific path semantics.

### AC-13: Native inertness

The exact `.dsh/better-harness` three-file subtree remains semantically inert to
qualified native DSH Skill, Instruction, Preset, Profile, Session, and
configured-root discovery in a credential-free before/after receipt.

### AC-14: Shared-host isolation

Existing portable hosts remain portable HTML, Qoder/Cursor remain Canvas, and
no other host's rendering, Checkup, or capability set changes.

### AC-15: Packaging closure

The npm package and runtime zip contain the existing generic rendering runtime;
`pack:verify` passes with no dependency, new renderer asset, or package-root
change.

### AC-16: Public docs and matrix

Canonical adapter documentation and the DSH reference advertise portable HTML
and the three artifacts without claiming Checkup, Canvas, lifecycle, broad
Quickstart, native rendering, or complete DSH/P0 launch qualification.

## Likely implementation owners

| Path | Expected change | Why | Confidence |
| --- | --- | --- | --- |
| `scripts/host-support/index.mjs` | Add `REPORT_RENDERING` to the exact DSH capability list | Canonical capability owner | High |
| `test/plugins/host-support.test.mjs` | Replace the rendering-negative boundary with the exact post-#112 array while retaining `CHECKUP` absence | AC-1 and AC-14 | High |
| `skills/better-harness/SKILL.md` | Qualify DSH for the existing generic HTML branch and preserve explicit inline/no-files | User-visible route | High |
| `test/skills-docs/better-harness-skill.test.mjs` | Prove the DSH durable route, generic command, exact root, and no-files negative path through structured/behavioral seams where available | AC-2, AC-4, AC-7, AC-8 | High |
| `templates/reporting/routing.md` | Add DSH to the explicit Portable HTML host list | Routing switchboard currently names hosts | High |
| `test/reporting/harness-report-render-cli.test.mjs` | Add DSH admission/root/artifact/input/privacy/temporal/path/publication/shared-host regressions | Generic runtime qualification | High |
| `scripts/dsh-configured-assets/native-smoke.mjs` | Add a credential-free before/after inert-report-subtree receipt | Existing pinned native Skill/Instruction/configured-root comparison owner | Medium |
| `docs/adapters/README.md` | Promote DSH default output to self-contained HTML + Markdown and narrow the remaining unsupported boundary | Canonical source matrix | High |
| `docs/docs/hosts/adapter-matrix.md` | Mirror the qualified output route without claiming Quickstart/Checkup | Public matrix | High |
| `references/agent-customize/platforms/dsh.md` | Replace the obsolete rendering/no-files-only statement and point to the qualified portable route/native receipt | DSH compatibility reference | High |

## No-change owners

| Owner | Why unchanged |
| --- | --- |
| `scripts/session-analysis/platforms/dsh.mjs` | Session evidence already feeds shared analysis; rendering adds no Session semantics |
| `scripts/agent-customize/providers/dsh.mjs` | Configured Skills/Instructions are already projected and privacy-bounded |
| Evidence Bundle v3 owners | The Bundle remains upstream evidence, not renderer input |
| Asset Baseline v2 owners | Current configured provenance already satisfies reconciliation |
| `scripts/harness-analysis/report-data-schema.mjs` | Shared `summary`/`findings` accepts DSH without provider fields |
| `scripts/harness-analysis/render-report.mjs` | Platform admission and root default already derive from capability/host id; publication is generic |
| `scripts/harness-analysis/renderers/html.mjs` | Existing self-contained portable renderer accepts the shared data |
| `scripts/harness-analysis/renderers/markdown.mjs` | Existing derived Markdown accepts the shared data |
| Native DeepSeek Harness | Better Harness owns output and the proposed subtree is inert |
| Qoder Canvas owners | DSH never selects Qoder Canvas |
| Cursor Canvas owners | DSH never selects Cursor Canvas |
| `package.json` and dependency graph | Existing package roots and dependencies already ship the runtime |

Any implementation need to modify a no-change owner triggers **SPEC REVIEW**
before the PR scope expands.

## Plan and tasks

1. Add a focused RED suite for the complete DSH capability set, render
   admission, mode, root, artifacts, shared input, and no-files behavior.
2. Add RED coverage for publication failure/rollback, privacy and temporal
   canaries, Windows/UNC routing, shared portable/Canvas hosts, and packaging.
3. Extend the pinned native DSH smoke with the exact inert subtree before/after
   comparison.
4. Promote only the DSH `REPORT_RENDERING` capability after the RED contract is
   independently reviewable.
5. Align the Skill and report-routing switchboard with the existing generic
   portable branch; do not add a DSH workflow.
6. Update the three canonical DSH public/reference documentation owners.
7. Run focused GREEN tests, the native receipt, full tests, cross-platform CI,
   doc-link validation, package verification, diff checks, and traceability
   review.

## Future RED matrix

| AC | Test owner | RED expectation before implementation | Expected GREEN behavior | Type |
| --- | --- | --- | --- | --- |
| AC-1 | `test/plugins/host-support.test.mjs` | Exact post-#112 array fails because rendering is absent | Exact six-capability array passes; Checkup absent | Pure BH |
| AC-2 | Skill and render CLI tests | DSH is rejected and cannot select `html` | DSH selects only generic `html` | Pure BH |
| AC-3 | `test/reporting/harness-report-render-cli.test.mjs` plus diff review | DSH admission fails on the shared renderer | Shared renderer accepts DSH with no parallel owner | Pure BH |
| AC-4 | Skill/render CLI tests | DSH default/Skill route cannot produce the target-local root | Requested/resolved out root is `<target>/.dsh/better-harness` | Pure BH |
| AC-5 | Render CLI tests | DSH cannot publish the portable set | Exact JSON/Markdown/HTML set passes validation | Pure BH |
| AC-6 | Render CLI tests using canonical findings fixture | Shared reviewed findings cannot enter a DSH-qualified run | Input is accepted and final findings use current normalization | Pure BH |
| AC-7 | `test/skills-docs/better-harness-skill.test.mjs` | Current DSH branch remains inline/no-files only | One generic render command and renderer path handoff are available | Pure BH |
| AC-8 | Parsed routing contract plus executable evidence/no-files target | Routing and zero-write behavior are not jointly qualified | Durable DSH selects portable HTML; explicit no-files selects the declarative inline route and creates no report state | Pure BH |
| AC-9 | Render CLI failure-injection and path tests | New DSH route lacks preservation/rollback qualification | Generic validation, cleanup, backup, rollback, and containment pass | Pure BH |
| AC-10 | Existing DSH public-evidence privacy owners plus render CLI final-artifact fixture | Upstream projection and durable preservation are not composed honestly | Raw canaries are absent from qualified public evidence; correctly reviewed safe projections remain safe in all three artifacts | Pure BH |
| AC-11 | Render CLI temporal fixture | DSH cannot render the configured/current-vs-history fixture | JSON/Markdown/HTML retain the reviewed non-causal wording | Pure BH |
| AC-12 | Render CLI `path.win32`/Windows CI cases | DSH route is unavailable for drive/UNC/root/run-dir assertions | Existing generic path rules pass without DSH branches | Pure BH |
| AC-13 | `scripts/dsh-configured-assets/native-smoke.mjs` | Before/after report-subtree invariant has no durable receipt | Native semantic snapshots remain equal; credentials remain unused | Native DSH |
| AC-14 | Host-support, Skill, and render CLI parameterized cases | DSH expectation fails while control hosts define the baseline | Portable and Canvas control routes remain unchanged | Pure BH |
| AC-15 | DSH render qualification plus `npm run pack:verify` | Pack closure is not yet evidenced for an admitted DSH render | Existing npm/runtime roots contain the route; pack gate passes unchanged | Pure BH |
| AC-16 | Skill/docs assertions and `test/skills-docs/doc-link-graph.test.mjs` | Current matrices still state DSH output is unavailable | Canonical docs agree on bounded portable output and links resolve | Pure BH |

No RED may satisfy an executable contract by merely grepping prose. Source/doc
assertions are appropriate only for documentation ownership; runtime,
filesystem, capability, and publication claims require executable or parsed
behavior.

## Test and review evidence

The RED phase is valid only when the pre-change relevant suite is green and
each new failure reaches missing #112 behavior rather than a fixture, syntax,
import, platform, or Node-version error. The implementation does not begin until
the new failures are independently reviewable.

Expected final evidence includes:

```text
npx vitest run test/plugins/host-support.test.mjs
npx vitest run test/skills-docs/better-harness-skill.test.mjs
npx vitest run test/reporting/harness-report-render-cli.test.mjs
npx vitest run test/reporting/better-harness-evidence-bundle.test.mjs
npx vitest run test/agents/agent-asset-baseline.test.mjs
npx vitest run test/agents/agent-customize-dsh.test.mjs
npx vitest run test/sessions/session-analysis-dsh-provider.test.mjs
npx vitest run test/reporting/task-loop-source.test.mjs
npm run test:dsh-configured-assets-native
npx vitest run test/skills-docs/doc-link-graph.test.mjs
npm test
npm run pack:verify
git diff --check
```

Windows CI is the authoritative Windows receipt. The final review records exact
commands and observed outcomes, verifies the diff against #112 and this Spec,
and confirms that no no-change owner drifted without Spec review.

## Risks

1. Durable persistence widens exposure compared with inline-only analysis.
   Mitigation: scan every final artifact from an upstream-projected canary
   fixture and keep operational paths out of content.
2. Shared capability and routing edits can regress current portable or Canvas
   hosts. Mitigation: parameterized control-host assertions around capability,
   mode, and artifacts.
3. Output routing is an independent cross-platform path surface. Mitigation:
   drive, UNC, containment, sibling-prefix, separator, and Windows CI receipts
   under the generic contract.
4. `.dsh` is a native project namespace even though the proposed child is inert
   in rc.2. Mitigation: retain a pinned credential-free native before/after
   receipt.
5. Derived prose can flatten current configuration into historical causality.
   Mitigation: render explicit temporal fixtures through JSON, Markdown, and
   HTML and retain #104's negative claims.

## Rollback

Rollback removes DSH's `REPORT_RENDERING` capability qualification and the
corresponding Skill, routing, tests, native receipt, and documentation changes.
The existing post-#110 DSH Session, Configured Assets, Asset Practices, Harness
Report, and Evidence Bundle capabilities remain intact. `/better-harness`
returns to shared analysis plus explicit inline/no-files behavior. No data or
schema migration is required because #112 changes no report schema.

## Non-goals

- DSH-specific renderer, report-data schema, findings type, or transform
- Evidence Bundle v3 or Asset Baseline v2 change
- DSH Session or configured-assets semantic change
- Checkup, Qoder Canvas, Cursor Canvas, or Studio integration
- native DSH modification or native rendering API
- dependency, package version, new template family, or rendering asset
- Session request-summary privacy redesign
- Cordis/Profile/Preset/runtime-Skill completeness expansion
- lifecycle, managed shell, manifest, or package integration
- complete/full DSH support claim
- broad Quickstart or launch work
- final P0 launch qualification inside this implementation Story
- changelog, release, version, roadmap, or unrelated cleanup

## P0 finish line

After #112 lands, the P0 implementation surfaces are present: install/discovery,
explicit Skill invocation, Session evidence, configured assets, shared analysis,
and durable report rendering. P0 is not yet launch-qualified. The remaining
work is one full DSH P0 end-to-end qualification and documentation launch pass,
not another feature implementation Story unless that pass discovers a real
missing gate. Checkup remains P1/non-blocking.

## Story sizing

- Decision: **ONE STORY + ONE PR**
- Complexity: **MEDIUM** because production routing is small but durable
  privacy, publication, native inertness, and Windows evidence are review-critical.
- Expected production scope: one capability registry edit plus narrow Skill and
  routing qualification; no renderer/schema production change.
- Expected test scope: three existing focused test owners plus one existing
  native smoke owner and existing package/full-suite gates.
- Expected docs scope: this Spec plus three canonical DSH adapter/reference
  owners during implementation.

The PR remains reviewable as one public compatibility boundary: DSH may use the
existing portable durable renderer.

## Open questions

Open architecture questions: None.
