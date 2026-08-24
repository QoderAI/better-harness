# DeepSeek Harness Shared Analysis and Frozen-Cwd Evidence Bundle

## Traceability

- Spec ID: deepseek-harness-shared-analysis-evidence-bundle
- Story: #104
- Status: Implemented
- Approved scope: [Issue #104](https://github.com/QoderAI/better-harness/issues/104)

## Intent

DeepSeek Harness (DSH) already exposes independent persisted Session evidence
and configured filesystem Skills plus cwd-sensitive Instructions. The canonical
`/better-harness` workflow cannot combine those sources because DSH is rejected
at the shared Asset Practices, Harness Report, and Evidence Bundle gates.

This Story qualifies those three shared capabilities together. Evidence Bundle
v3 freezes canonical cwd as part of evidence identity; Asset Baseline v2 retains
the minimum current configured-snapshot provenance needed to keep configuration
separate from historical Session observation. Existing generic inventory,
lint, integrity, Project Harness, task-loop, and neutral Harness analysis owners
remain canonical.

The implementation is one Story and one PR. Report rendering and Checkup remain
unsupported.

## Privacy blocker resolution

The privacy blocker is resolved for the scope of #104 by inheriting the current
shared cross-host Session Evidence behavior:

- bounded sanitized ordinary user-intent prose may remain in
  `session-core-facts.candidates[].request.summary`;
- existing credential, recognized-secret, identifier, injected-context,
  transcript-tail, and selected private-path sanitization remains in force;
- the independent lead may retain its existing bounded request sample only
  where the shared lead contract already permits it;
- #104 adds no DSH-specific Session privacy projector and no new lead text path.

This inherited boundary is not claimed to be privacy-complete. The earlier DSH
Session Evidence specification documented exposure of this same shared field as
a pre-existing unresolved privacy concern. That concern remains unresolved and
outside #104. Any future tightening belongs in shared Session and lead privacy
owners for every host, not in a DSH-only Bundle rule.

## Story boundary

Before #104, DSH advertises:

```text
SESSION_ANALYSIS
AGENT_CUSTOMIZE
```

After #104, DSH advertises exactly:

```text
SESSION_ANALYSIS
AGENT_CUSTOMIZE
ASSET_PRACTICES
HARNESS_REPORT
EVIDENCE_BUNDLE
```

It remains absent from:

```text
REPORT_RENDERING
CHECKUP
```

The three new gates land together only after their executable routes and tests
are complete. `HARNESS_REPORT` means neutral shared Harness evidence, not HTML,
Markdown, Canvas, Studio, or another durable output.

## Canonical pipeline

```text
/better-harness
-> harness evidence-bundle
-> Evidence Bundle v3 frozen context
   |- Session population -> DSH facts -> sessionEvidence
   |- existing Project Harness -> projectHarness
   |- DSH current configured inventory at frozen cwd
   |  -> shared lint + public inventory + integrity
   |  -> Asset Baseline v2 -> agentCustomize
   `- same Session population -> generic task-loop source
      -> independent current practice recollection at frozen cwd
      -> neutral evidence + summaryFacts -> lead
-> complete / partial / failed Bundle
-> specialists and lead reconciliation
```

Session and Project collection consume workspace, topology, analysis scope, and
the frozen window. They do not consume configured cwd. Only current configured
and practice collection consumes cwd.

## Acceptance scenarios

### AC-1: Exact capability promotion

DSH gains exactly `ASSET_PRACTICES`, `HARNESS_REPORT`, and `EVIDENCE_BUNDLE` in
addition to its existing two capabilities. `REPORT_RENDERING` and `CHECKUP`
remain absent.

### AC-2: Evidence Bundle v3 and frozen cwd

`EVIDENCE_BUNDLE_SCHEMA_VERSION` becomes `3`. Every emitted v3 context contains:

```js
{
  workspace: "<canonical workspace realpath>",
  cwd: "<canonical contained cwd realpath>",
  provider: "dsh",
  language: "en" | "zh-CN",
  depth: "quick" | "normal",
  window: { since: "<ISO>", until: "<ISO>" },
  evidenceLimit: 1 | 2 | 3 | 4 | 5,
  authority: {
    includeUserHome: boolean,
    includeMemories: boolean
  },
  topology: "<validated frozen topology>",
  analysisScope: "<scope derived from topology>"
}
```

The complete frozen context, including cwd, identifies the evidence collection.
No new identity hash, v2 migration reader, or unrelated schema field is added.

### AC-3: Canonical cwd contract

```text
effectiveCwd = explicit cwd ?? workspace
```

Workspace and cwd must exist as directories and are canonicalized through the
real filesystem path. Canonical cwd must equal or be contained by canonical
workspace. A lexical in-workspace symlink resolving outside workspace is
rejected. The stable failures are `INVALID_CONFIGURED_CWD` and
`CONFIGURED_CWD_OUTSIDE_WORKSPACE`.

The implementation uses native `node:path` semantics and supports Windows,
macOS, Linux, spaces, Unicode, drives, and UNC paths. Cwd is never derived from
Session evidence.

### AC-4: Cwd propagation

One canonical frozen cwd reaches Evidence Bundle context, Agent Customize,
Asset Baseline, public configured inventory, Agent Lint, Harness report-run, and
task-loop configured-practice collection. It does not become a Session analyzer
or Session selection option and does not replace Project Harness's existing
Git-root/workspace cwd.

### AC-5: Nested DSH Instruction selection

For workspace `repo/packages/api` and cwd `repo/packages/api/src`, shared
configured/practice collection includes an applicable
`src/AGENTS.local.md`. With cwd equal to `repo/packages/api`, that nested local
Instruction is not applicable. Existing #101 DSH native selection semantics are
reused unchanged.

### AC-6: Asset Baseline v2

`ASSET_BASELINE_SCHEMA_VERSION` becomes `2`. A successful DSH baseline contains:

```js
{
  kind: "agent-asset-baseline",
  schemaVersion: 2,
  status: "complete" | "partial" | "failed",
  scope: {
    provider: "dsh",
    workspace: "<canonical workspace>",
    cwd: "<canonical cwd>",
    includeUserHome: boolean,
    includeMemories: false
  },
  configuredSnapshot,
  envelopes: { lint, inventory, integrity },
  diagnostics
}
```

Lint, inventory, and integrity consume one raw configured inventory snapshot
inside the Baseline owner. Empty unsupported DSH collections are valid observed
emptiness, not failures.

### AC-7: Compact configuredSnapshot

A successful DSH baseline projects exactly:

```js
{
  collectedAt: "<raw DSH inventory generatedAt>",
  evidenceKind: "configured-not-observed",
  configurationSource: "qualified-defaults" | "caller-overrides",
  userHomeCollection: "included" | "not-authorized",
  instructionCollection: "enabled" | "disabled-by-byte-limit",
  qualification: {
    provider: "dsh",
    version: "0.1.1-rc.2",
    sourceSha: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e"
  },
  runtimeResolution: {
    cordis: false,
    profile: false,
    preset: false,
    runtimeSkills: false
  }
}
```

It excludes diagnostics arrays, configured paths, bodies, digests, symlink
targets, and duplicate cwd. Failed raw inventory does not fabricate the field.

### AC-8: Current configuration is not historical observation

The analysis may state that an asset is currently configured, when it was
collected, or that current configuration was not observed in bounded Session
evidence. It must not infer that a current Skill or Instruction existed during,
was used by, or influenced a historical Session; that a same-name current asset
is the historical asset; or that current absence proves historical absence.

### AC-9: Generic Skills and Rules practice coverage

`collectProviderInventory()` derives `summary.practiceCoverageRows` from shared
configured surfaces. Non-empty DSH Skills and Rules produce their existing
generic rows with identity-deduplicated counts and bounded locators. Empty
collections produce no phantom row. Representative existing generic hosts and
Qoder Memory behavior remain compatible.

### AC-10: Asset Practices qualification

DSH uses the existing public inventory, `agent-assets-review` lint, integrity,
and Asset Baseline owners. No DSH-specific lint or integrity engine is added.
User-home collection remains default-closed.

### AC-11: Bundle-facing path privacy

Direct DSH Agent Customize retains its qualified lexical evidence. Bundle-facing
Baseline findings use only:

| Source | Locator |
| --- | --- |
| workspace itself | `<workspace>` |
| inside workspace | `<workspace>/<portable-relative>` |
| inside Git root above workspace | `<git-root>/<portable-repo-relative>` |
| authorized home | `~/<portable-home-relative>` |
| unsafe off-tree | omitted or existing `<path>` redaction |

The rule applies to lint/integrity finding paths, owner routes, coverage paths,
and bounded free text. Symlink target realpaths never enter output.

### AC-12: Configured content privacy

Raw Skill bodies, Instruction prose, configured digests, symlink target
realpaths, provider diagnostic content, raw credentials, and raw recognized
secrets remain absent from Asset Baseline, the configured Bundle lane, and lead
configured evidence.

### AC-13: Inherited Session request-summary boundary

`PRIVATE_ORDINARY_PROSE_X` may survive in the existing bounded
`request.summary`. `sk-test-secret-credential` and a recognized private home path
must not survive raw. A bounded ordinary request sample may survive only in the
existing eligible active-long lead projection. The old DSH request-summary
privacy concern remains unresolved and outside #104.

### AC-14: Generic Harness Report

DSH is admitted to `harness analyze` and reuses the existing task-loop source,
report-source validation, neutral evidence formatter, and `summaryFacts`
projection. Configured-practice collection receives frozen cwd; Session and
repository scopes remain unchanged. `--canvas-out` remains Qoder/Cursor-only.

### AC-15: Multi-owner current snapshots

P0 retains `collectionMode: "frozen-context-multi-owner"`. The Baseline shares
one raw snapshot among its stages; the lead independently recollects current
practice evidence using the same frozen parameters. Object identity, timestamp
equality, and atomic filesystem snapshotting are not promised.

### AC-16: Project Harness remains generic

DSH Bundle collection invokes the existing Project Harness owner with topology,
analysis scope, and Git-root/workspace scope. Configured cwd is not forwarded to
Project Harness. No DSH-specific Project Harness module is added.

### AC-17: Bundle completeness

For normal depth, complete topology, all three specialist lanes available, and
an available lead produce `complete`; a partial/unavailable specialist,
incomplete topology, or unavailable lead produces `failed`. For quick depth,
an incomplete specialist/topology with an available lead produces `partial`;
lead or population/binding failure produces `failed`. Valid observed emptiness
may remain available.

### AC-18: `/better-harness` flow and isolation

The Skill's single Step 1 command passes `--platform dsh`, `--workspace`, and
`--cwd`. Explicit inline/no-files DSH analysis may proceed through specialists
and reconciliation. Durable HTML, Markdown, Canvas, Studio, and report-file
output are not fabricated. Checkup remains unsupported.

## Public CLI

The only new general option is `--cwd <path>`. It is accepted by Evidence
Bundle and the direct configured/practice and Harness analysis surfaces that
must reproduce the same DSH Instruction selection. Existing `--dsh-home` and
authority flags retain their current meaning. No byte-budget, candidate,
snapshot, path-mode, or atomic-snapshot control becomes public.

## Evidence Bundle completeness

| Component | Available/complete | Partial | Failure/rejection |
| --- | --- | --- | --- |
| Session | Valid facts and compatible binding | `unobserved`/`partial` coverage | Invalid discovery/facts/binding |
| Project Harness | Evidence pack `status: ok` | Valid non-`ok` pack | Invalid envelope/collector error |
| Agent Customize | Baseline v2 complete | Baseline v2 partial | Failed/invalid Baseline |
| Lead | Valid evidence, summaryFacts, binding | No partial lead state | Invalid/unavailable/conflicting lead |
| Normal Bundle | All available and topology complete | Not emitted | Any incomplete required input |
| Quick Bundle | All complete | Incomplete specialist/topology with lead available | Lead/population/binding failure |

## Failure boundaries

- Invalid cwd fails before configured asset reads.
- Session discovery failure makes Session and lead unavailable.
- Missing configured assets may be valid observed emptiness.
- User-home disabled means not authorized, not globally absent.
- Unresolved DSH runtime composition remains explicit provenance, not failure.
- Rendering and Checkup requests continue through their existing unsupported
  capability contracts.

## Non-goals

- report rendering, HTML, Markdown, Canvas, Studio, or durable output routing
- Checkup, lifecycle, Quickstart, or the complete default durable workflow
- complete Cordis, Profile, Preset, MCP, Plugin, Hook, or Custom Agent support
- runtime/in-process/scoped Skill enumeration
- atomic configured-filesystem snapshots
- causal configured-to-Session correlation
- DSH Session Analysis or configured-assets native-semantic redesign
- DSH-specific lint, integrity, report, Project Harness, or privacy owners
- shared Session privacy tightening or arbitrary-prose removal
- configured asset body/content collection
- schema migration infrastructure
- upstream DSH changes
- package/release/version/changelog/roadmap work

## Plan and tasks

1. Add RED tests for the exact capability set, Bundle v3, Baseline v2, and cwd.
2. Add RED tests for DSH Asset Practices, shared coverage, provenance, paths,
   configured content, and temporal separation.
3. Add RED tests for generic Harness analysis, Bundle composition/status,
   Project Harness isolation, Skill flow, rendering, and Checkup isolation.
4. Implement one shared canonical cwd resolver and propagate it only through
   current configured/practice paths.
5. Implement generic inventory/Baseline qualifications and path compaction.
6. Implement generic report and Bundle admission, then promote capabilities.
7. Update only the canonical DSH capability/reference documentation owners.
8. Run focused tests, full tests, Node 22, cross-platform CI, doc-link checks,
   package verification, and change-traceability review.

## RED test plan and review evidence

| Acceptance | RED proof |
| --- | --- |
| AC-1 | Exact host capability projection and negative gates |
| AC-2–AC-4 | Bundle schema/context, cwd validation, identity, and propagation spies |
| AC-5–AC-7 | Nested DSH fixture, Baseline v2, and configuredSnapshot assertions |
| AC-8 | Historical Session/current configuration negative claims |
| AC-9–AC-10 | Generic inventory, lint, integrity, and compatibility tests |
| AC-11–AC-12 | Synthetic path and configured-content canaries |
| AC-13 | Existing shared summary sanitizer plus DSH Bundle admission canary |
| AC-14–AC-16 | Report-run, task-loop, multi-owner, and Project Harness tests |
| AC-17 | Normal/quick complete, partial, and failed matrix |
| AC-18 | Better Harness Skill and capability-isolation tests |

RED is valid only when the pre-change relevant suite is green and every new
failure reaches missing #104 production behavior rather than a syntax, fixture,
mock, import, platform, or Node-version error. The implementation begins only
after the RED contract is independently reviewable.
