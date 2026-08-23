# DeepSeek Harness Configured Assets

## Traceability

- Spec ID: deepseek-harness-configured-assets
- Story: #101
- Status: Draft
- Approved scope: [Issue #101](https://github.com/QoderAI/better-harness/issues/101)
- Qualified DSH release: `0.1.1-rc.2`
- Qualified DSH source: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## Intent

Better Harness already has independent DeepSeek Harness (DSH) session-evidence
and verified Skill-discovery slices, but `agent-customize` cannot report which
filesystem Skills and cwd-sensitive Instructions a DSH environment is
configured to use. This Story adds one bounded DSH configured-assets provider.

The provider reports effective filesystem Skill winners in `manage.skills` and
applicable, byte-budget-represented Instruction sources in `manage.rules`.
Configured or applicable state is not proof that a Skill was invoked or an
Instruction influenced a session. Runtime/in-process Skill providers and the
active Cordis, Profile, and Preset composition remain unresolved.

The implementation is one PR and one provider at
`scripts/agent-customize/providers/dsh.mjs`. DSH gains only
`AGENT_CUSTOMIZE`; it does not gain `ASSET_PRACTICES`, report, output,
evidence-bundle, lifecycle, or Quickstart support.

### Native authority

The implementation is pinned to these DSH owners:

1. [Filesystem Skill provider](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/skill/skill-filesystem/src/index.ts)
2. [Skill registry](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/skill/skill/src/index.ts)
3. [Instruction configuration](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/context/agent-instructions/src/config.ts)
4. [Instruction discovery and loading](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/context/agent-instructions/src/files.ts)
5. [Instruction rendering and budgeting](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/context/agent-instructions/src/render.ts)

Later DSH versions are not implicitly qualified.

## Acceptance Scenarios

### AC-1: Provider and capability ownership

DSH is registered in the existing `agent-customize` provider map and advertises
exactly `SESSION_ANALYSIS` plus `AGENT_CUSTOMIZE`. It remains absent from
`ASSET_PRACTICES` and every report, rendering, evidence-bundle, and checkup
capability projection.

### AC-2: Standard inventory envelope

The provider returns the existing inventory envelope with `provider: "dsh"`,
`workspace`, `cwd`, `projectRoot`, standard tabs, `manage.skills`,
`manage.rules`, and empty Plugin, MCP, Subagent, Command, and Hook collections.
No new shared item schema is introduced.

### AC-3: Native filesystem Skill discovery

The provider discovers only native one-level Skill layouts:

- `<root>/<entry>/SKILL.md`
- `<root>/<entry>.md`

Entries in each root use native `localeCompare` order. Arbitrary nested Skill
files and unsupported entries are excluded. `.system` is skipped only in the
user DSH root. The validated frontmatter `name`, not the filename, is Skill
identity. Active results are sorted by DSH's code-point name ordering.

### AC-4: DSH-compatible Skill validation

Frontmatter begins with an exact `---` line, ends at an exact `---` line, and
parses to a YAML object. `name` and `description` must be non-empty strings;
names match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Unknown fields and object-valued
`metadata` are accepted but not emitted.

Canonical `disable-model-invocation` and `user-invocable` values accept native
booleans, `1`/`0`, and case-insensitive `true`, `false`, `yes`, `no`, `on`, and
`off`. Invalid canonical values and legacy `disableModelInvocation`,
`modelInvocable`, and `userInvocable` fields invalidate the candidate.

Implementation uses a direct production dependency on exact `yaml@2.9.0`.
The existing lossy Better Harness frontmatter helper is not DSH-compatible.
Skill bodies may be read only as needed to locate frontmatter boundaries and
are never retained in or serialized by the inventory.

### AC-5: Filesystem precedence and runtime qualification

Lower ranks win duplicate declared names within the qualified filesystem view:

| Rank | Source |
| ---: | --- |
| 100 | `<projectRoot>/.dsh/skills` |
| 200 | `<projectRoot>/.agents/skills` |
| 250 | runtime/in-process registry, unresolved and not inventoried |
| 300 | `customSkillDirs`, in declaration order |
| 400 | `<dshHome>/skills` |
| 500 | `<dshAgentsHome>/skills` |
| 600 | bundled Skill root |

Ties use provider registration order and then provider-local candidate order.
A malformed higher-priority candidate is absent and permits a valid lower
candidate to win. Only the filesystem winner appears in `manage.skills`;
shadowed candidates are diagnostics, never active Skills. The provider never
claims a complete runtime winner because rank-250 and scoped providers are
unresolved.

### AC-6: Workspace, cwd, and project authorization

`workspace` defaults to `process.cwd()`. `cwd` defaults to workspace and must
exist as a directory equal to or lexically inside workspace. Missing or
non-directory inputs and an outside cwd fail before asset scanning. No cwd is
derived from session evidence.

Workspace is the analysis-selection boundary and cwd-containment boundary, not
a universal filesystem sandbox. Starting at cwd, DSH walks upward to the
nearest existing `.git` file or directory. That directory is `projectRoot`; if
no marker exists, cwd is `projectRoot`. Selecting workspace/cwd authorizes the
fixed native DSH project sources at that root and the root-to-cwd Instruction
chain, including when `projectRoot` is above workspace. Discovery stops at the
nearest project root and does not crawl arbitrary siblings or ancestors above
it. The resolved `projectRoot` is returned at the inventory top level.

### AC-7: User-home and explicit-root authorization

`includeUserHome` defaults to `false`. Without opt-in, the provider performs no
`stat`, `readdir`, `readFile`, `createReadStream`, or `realpath` against:

- `<dshHome>/skills`
- `<dshAgentsHome>/skills`
- `<dshHome>/AGENTS.md`
- ambient `DSH_BUNDLED_SKILL_DIR`

Opt-in authorizes those ambient sources. Supplying `dshHome` or
`dshAgentsHome` alone does not authorize them. Programmatic `customSkillDirs`
and explicit `bundledSkillDir` authorize exactly their named lexical roots,
including off-tree roots, without authorizing siblings and without requiring
user-home opt-in.

Explicit-root scope is `project` inside workspace, `user` inside the operating
system home, and `other` otherwise. Relative custom/bundled/agents-home values
resolve from `process.cwd()` and do not expand literal `~`; DSH home uses DSH's
supported tilde expansion.

### AC-8: Native Instruction discovery and order

When Instructions are enabled, discovery order is:

1. authorized `<dshHome>/AGENTS.md`;
2. each directory from `projectRoot` through cwd;
3. within each directory, base candidates in configured order, then local
   candidates in configured order.

Defaults are `.git`, base `AGENTS.md`/`CLAUDE.md`, local
`AGENTS.local.md`/`CLAUDE.local.md`, `maxSourceBytes` 1,048,576, and
`maxBytes` 65,536. Candidate values `""`, `.`, `..`, absolute paths, or values
containing `/` or `\` are filtered out. Exact absolute paths are deduplicated
globally with the earliest candidate retained. `manage.rules` preserves native
retained order and bypasses generic rule sorting.

### AC-9: Instruction content deduplication and source limits

Instruction candidates must resolve through `stat` to regular files; a final
file symlink is followed. Stat size and streaming UTF-8 byte count enforce
`maxSourceBytes`. Oversized, disappearing, unreadable, broken-link, directory,
and non-file candidates are excluded independently without collapsing other
Instruction sources.

Loaded content is trimmed, SHA-1 hashed, and deduplicated only within the same
`dirname(displayPath)`. The earliest same-directory duplicate wins; identical
content in different directories remains. Content and digests are never
serialized.

### AC-10: Aggregate Instruction budget

Native UTF-8 render accounting includes system-reminder framing, intro text,
source headings/content, and omission/truncation markers even though Better
Harness emits none of that prose. The algorithm:

1. tries the complete deduplicated list;
2. drops the broadest prefix one source at a time until a suffix fits;
3. when no suffix fits, keeps only the most-specific source and binary-searches
   a UTF-8-safe content prefix using full and then compact intro text;
4. represents a genuinely empty file if its heading survives;
5. does not represent a non-empty file truncated to zero;
6. represents no source for a notice-only fallback.

Only represented sources enter `manage.rules`. Non-positive or non-finite
`maxBytes` or `maxSourceBytes` disables Instruction collection before any
Instruction probe.

### AC-11: Path and symlink evidence

Native final-component behavior is preserved for file and directory Skill
symlinks and file Instruction symlinks. Broken links and non-file targets are
excluded. Authorization attaches to the configured lexical root, so a link
beneath an authorized project/user/explicit root may resolve off-tree. Returned
evidence retains the lexical configured path and never exposes the target
realpath. Paths use `node:path` and support Windows, macOS, Linux, spaces, and
Unicode without assuming POSIX separators.

### AC-12: Minimal diagnostics and evidence claim

Diagnostics use this provider-local shape:

```js
{
  qualifiedDshVersion: "0.1.1-rc.2",
  qualifiedDshSourceSha: "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e",
  evidenceKind: "configured-not-observed",
  configurationSource: "qualified-defaults" | "caller-overrides",
  userHomeCollection: "included" | "not-authorized",
  instructionCollection: "enabled" | "disabled-by-byte-limit",
  runtimeResolution: {
    cordis: false,
    profile: false,
    preset: false,
    runtimeSkills: false
  },
  shadowedSkills: [],
  skippedSkills: [],
  instructionDecisions: [],
  diagnosticsTruncated: false
}
```

Skill reasons are limited to `missing-skill-file`, `malformed`,
`invalid-name`, `invalid-invocation`, `unsupported-entry`, and `unavailable`.
Instruction reasons are limited to `unavailable`, `source-too-large`,
`duplicate-content`, `budget-omitted`, `budget-truncated`, and
`budget-not-represented`. Diagnostic lists are deterministically bounded by an
internal provider constant; its numeric value is not public API. No aggregate
counters, per-list omitted counters, or exact unsupported English prose are
contractual.

### AC-13: Minimal CLI

The public DSH-relevant CLI is limited to:

```text
--provider dsh
--workspace <path>
--cwd <path>
--dsh-home <path>
--include-user-home[=<boolean>]
```

Only `cwd` and DSH-scoped `includeUserHome` require new forwarding. Agents home,
default-root control, custom/bundled roots, root markers, candidate arrays, and
byte budgets remain programmatic-only in P0 and do not appear in help.

### AC-14: Native credential-free proof

A test-only native smoke installs pinned public DSH packages in a temporary
prefix and compares native Skills, Instructions, authorization, symlink, path,
deduplication, and budgeting outcomes with Better Harness. It performs no model
request, uses no API key or authenticated service, runs on the repository's
Windows/macOS/Linux matrix, and cleans temporary state in `finally`.

## Provider API and return contract

The canonical API is:

```js
export async function collectDshCustomizeInventory(options = {})
```

Public CLI-backed options are `workspace`, `cwd`, `dshHome`/`dsh-home`/`home`,
and `includeUserHome`. Programmatic-only options are `dshAgentsHome`,
`includeDefaultRoots`, `customSkillDirs`, `bundledSkillDir`,
`projectRootMarkers`, `instructionFileCandidates`,
`localInstructionFileCandidates`, `maxBytes`, and `maxSourceBytes`.

The return envelope is:

```js
{
  generatedAt,
  provider: "dsh",
  dshHome,
  dshAgentsHome,
  workspace,
  cwd,
  projectRoot,
  tabs: MANAGE_TABS,
  plugins: [],
  manage: {
    plugins: [],
    mcps: [],
    skills: [],
    subagents: [],
    rules: [],
    commands: [],
    hooks: []
  },
  diagnostics,
  unsupported: []
}
```

Skill items use the existing `skill` shape with validated declared name,
description, scope, source label/kind, lexical file path, and evidence. Rule
items use the existing `rule` shape with display path as name, fixed
non-content description, scope, source label/kind, lexical path, and evidence.
Neither item exposes body text, Instruction prose, metadata, invocation policy,
rank, digest, rendered text, or real target.

## Non-goals

- runtime/in-process or scoped Skill enumeration
- complete Cordis, Profile, Preset, or provider-registration resolution
- dynamic post-start Instruction reconciliation
- MCP, Plugin, Profile, lifecycle, or managed-shell inventory
- `ASSET_PRACTICES`, checkup, practice reports, lint, or baselines
- evidence-bundle, report, output, or rendering integration
- session-analysis changes
- Public Quickstart or complete DSH host parity
- upstream DSH changes
- a new shared schema or generic Skill collector
- any claim that configured assets were used at runtime

## Plan and Tasks

1. Add RED tests for the exact host capability and missing canonical provider.
2. Add RED provider tests for AC-2 through AC-13 using synthetic temporary
   roots and a lazy provider loader.
3. Add the credential-free native comparison smoke for AC-14.
4. Add direct production `yaml@2.9.0` and its lockfile entry during GREEN.
5. Implement the single DSH provider without changing generic recursive Skill
   collection or shared item schemas.
6. Register only the provider and `AGENT_CUSTOMIZE` capability.
7. Forward only the minimal public CLI options.
8. Update bounded DSH configured-assets references and adapter documentation.
9. Run focused tests, native smokes, cross-platform CI, docs/link checks,
   `npm run check`, and pack verification.
10. Perform Story/spec/test/risk traceability review before commit and PR.

## Test and Review Evidence

| Acceptance | Required evidence |
| --- | --- |
| AC-1 | Host-support and provider-map architecture tests |
| AC-2, AC-12 | Provider envelope, content-safety, and minimal diagnostics tests |
| AC-3, AC-4 | Layout and standards-compatible YAML validation fixtures |
| AC-5 | Root-rank, malformed-fallback, custom-order, shadowing, and runtime-boundary fixtures |
| AC-6 | Workspace-below-project-root, cwd validation, and nearest-marker fixtures |
| AC-7 | Node permission-model no-read proof plus opt-in and explicit-root fixtures |
| AC-8, AC-9 | Ordered hierarchy, candidate filtering, path/content dedup, and source-failure fixtures |
| AC-10 | Full-fit, suffix, UTF-8 truncation, empty, zero-content, and notice-only fixtures |
| AC-11 | File/directory/broken symlink and lexical-evidence fixtures on supported platforms |
| AC-13 | CLI help and argument-forwarding process tests |
| AC-14 | Pinned native owner comparison with no credentials and `finally` cleanup |

RED is valid only when fixtures parse and initialize successfully and failures
identify absent #101 production behavior. Existing relevant tests must be green
before RED changes and remain green afterward except for the intentionally
changed DSH capability expectation.

### Risks

| Risk | Mitigation |
| --- | --- |
| Filesystem view overstated as runtime truth | `configured-not-observed`, unresolved runtime fields, and filesystem-only tests |
| Implicit access to user data | Default-closed permission-model test proving no filesystem probes |
| Repository ancestry broadens unexpectedly | Nearest-marker and fixed-candidate/root tests; expose `projectRoot` |
| YAML behavior drifts from native DSH | Direct pinned YAML dependency plus native compatibility fixtures |
| Generic rule sorting changes precedence | Assert exact `manage.rules` order through the public provider |
| Byte-budget approximation changes represented sources | Compare outcomes with native DSH renderer in the smoke |
| Symlink target leaks | Assert lexical evidence and serialized absence of real target/content |
| Developer-preview churn | Pin release/SHA and require requalification for later DSH versions |

## Documentation claim boundary

After every acceptance scenario passes, documentation may describe a qualified
developer-preview DSH configured-assets slice for filesystem Skills and
cwd-sensitive Instructions. It must continue to distinguish configured assets
from observed use and must not claim full runtime configuration, lifecycle,
report-loop, evidence-bundle, `ASSET_PRACTICES`, or Public Quickstart support.
