# DeepSeek Harness Configured Assets

Use this reference for the bounded DeepSeek Harness (DSH) configured-assets
provider. It is qualified against DSH `0.1.1-rc.2` at source
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; later versions are not implicitly
qualified.

## Inventory

Run the read-only CLI from an authorized workspace:

```bash
better-harness agent-customize inventory --provider dsh --workspace <path> [--cwd <path>] [--dsh-home <path>] [--include-user-home[=true]]
```

`workspace` is the analysis-selection and cwd-containment boundary. `cwd`
defaults to the workspace and must be that directory or lexically beneath it.
DSH walks upward from cwd to the nearest `.git` marker; that directory is the
project root, or cwd is used when no marker exists.

User-home collection is off by default. Without `--include-user-home`, the
provider does not inspect DSH or Agents user Skill roots, DSH's global
`AGENTS.md`, or an ambient bundled Skill root. `--dsh-home` selects a home but
does not authorize reading those sources by itself.

## Filesystem Skills

Only DSH's native one-level forms are discovered: `<root>/<entry>/SKILL.md`
and `<root>/<entry>.md`. Valid YAML frontmatter supplies the Skill identity and
description. Duplicate declared names use this filesystem precedence:

1. project `.dsh/skills`;
2. project `.agents/skills`;
3. programmatic custom Skill roots, in declaration order;
4. authorized DSH user Skills;
5. authorized Agents user Skills;
6. an explicitly authorized or opted-in bundled Skill root.

Only the winning filesystem definition enters `manage.skills`; malformed and
shadowed candidates remain bounded diagnostics. The runtime/in-process rank
between project and custom Skills is not enumerable, so the result is never a
claim about the complete runtime winner.

## Instructions

Authorized Instructions are considered in native order: DSH's global
`AGENTS.md`, then every directory from project root through cwd, with base
`AGENTS.md`/`CLAUDE.md` candidates before local
`AGENTS.local.md`/`CLAUDE.local.md` candidates in each directory. Regular-file,
source-byte, same-directory content-deduplication, and aggregate rendered-byte
limits decide which sources appear in `manage.rules`. Better Harness returns
paths and non-content descriptions only; it never serializes Instruction text,
digests, rendered framing, or symlink targets.

## Evidence Boundary

Every result is `configured-not-observed`. Filesystem configuration and
applicability do not prove runtime use. Runtime/in-process or scoped Skill
providers and active Cordis, Profile, and Preset composition remain unresolved.
DSH advertises `sessionAnalysis`, `agentCustomize`, `assetPractices`,
`harnessReport`, `reportRendering`, and `evidenceBundle`. The shared Asset Baseline and Evidence
Bundle freeze a canonical cwd, retain compact configured provenance, and keep
current configuration distinct from historical Session observation. This does
not change configured-assets semantics or claim historical runtime use. Durable
`/better-harness` output reuses the portable `html` mode and publishes
`findings.json`, `report.md`, and `report.html` at the generic Better
Harness-owned root `<target>/.dsh/better-harness`; this is not a native DSH
storage root. Explicit inline/no-files operation remains write-free. This does
not add Checkup, Canvas, Studio, lifecycle, managed-shell, public Quickstart, or
full DSH support.

Repository contributors can compare the Better Harness collector with pinned
native DSH behavior without credentials or a model request:

```bash
npm run test:dsh-configured-assets-native
```

The [#101 configured-assets specification](../../../docs/specs/2026-08-23-101-deepseek-harness-configured-assets.md)
remains canonical for native DSH configured-assets semantics and Skills / Instructions collection qualification.
The [#104 shared-analysis specification](../../../docs/specs/2026-08-24-104-deepseek-harness-shared-analysis-evidence-bundle.md)
is canonical for shared Harness analysis admission, Asset Practices qualification, Asset Baseline v2,
Evidence Bundle v3 with frozen cwd, and Harness Report admission. The
[#112 portable-rendering specification](../../../docs/specs/2026-08-25-112-deepseek-harness-portable-report-rendering.md)
is canonical for DSH portable durable report routing and explicit no-files preservation.
