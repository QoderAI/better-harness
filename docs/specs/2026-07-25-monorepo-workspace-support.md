# Monorepo and Workspace Support for Better Harness Evidence Collection

## Traceability

- Spec ID: `2026-07-25-monorepo-workspace-support`
- Status: Draft
- Spike target: representative VS Code-fork monorepo (single git root, no
  `package.json#workspaces`, convention packages under `extensions/*`,
  `src/product/**`, `native/*`, `cli`, and `build`)

## Intent

`/better-harness` currently treats `--workspace <target>` as one flat project. On a monorepo
the three evidence lanes each degrade in a different way: the asset lane misses nested
instruction files or counts build-artifact copies, the session lane cannot bridge repo-root
sessions to a package target, and the project lane silently widens package targets to whole-repo
git history. This spec records the spike evidence and defines the smallest implementation that
makes monorepo targets first-class.

## Spike Evidence (2026-07-25, against a representative editor monorepo)

Ground truth in the reviewed target: tracked `AGENTS.md` guides outside the root
under `extensions/*`, `src/product/**`, `native/*`, and `.ci/`, plus root
`AGENTS.md`/`CLAUDE.md` and root `.agents/`, `.claude/`, and `.cursor/` assets.
Gitignored copies exist under `.build/extensions/*` and `out*/`; `build/` is tracked source.

| # | Probe | Observed | Gap |
|---|-------|----------|-----|
| E1 | `asset-baseline --workspace <root>` (qajaq provider) | `entrypoints: 1, documents: 1` | All nested `AGENTS.md` invisible: `collectNestedEntrypoints` returns `[]` when `provider === "qajaq"` (`scripts/agent-lint/index.mjs`) |
| E2 | `discoverAgentEntrypoints` (codex provider) | 53 entrypoints, including `out/**`, `out-build/**`, `.build/**` copies | Nested walk is not gitignore-aware; `DEFAULT_EXCLUDED_DIRS` is a hardcoded list that misses `.build`/`out*` yet wrongly excludes the tracked source dir `build/` |
| E3 | `asset-baseline --workspace <root>/extensions/assistant` | `skills: 0, agents: 0`, only the local `AGENTS.md` | Package targets lose all inherited root assets (`.agents/skills`, `.claude/agents`, root `AGENTS.md`); no "inherited from git root" scope |
| E4 | Session matching, all four platforms | `resolved === workspace \|\| resolved.startsWith(workspace + sep)` | Package target misses sessions whose `cwd` is the repo root (the common agent launch point); root target mixes every package's sessions with no segmentation |
| E5 | `core-change-watch` lanes | `resolveRepoRoot` = `git rev-parse --show-toplevel`, no path filter | A package target silently profiles whole-monorepo history; findings attribute repo-wide churn to the package |
| E6 | `agent-lint --scan-children` | Direct children only, one level, not manifest-aware, not wired into `asset-baseline`/`evidence-bundle`/SKILL.md | Existing multi-project mode cannot reach `extensions/<pkg>` from root and is unreachable from the skill pipeline |

Walk safety: `listFiles` in `agent-lint` has no file-count cap; on this repo the codex-provider
walk traverses `out*`/`.build` artifact trees (tens of thousands of files) before filtering.

## Acceptance Scenarios

- **AC1 (topology resolution):** Given any `--workspace`, the evidence-bundle context freezes a
  `topology` object: `gitRoot`, `targetKind` (`repo-root` | `package` | `standalone`),
  `packageRelPath` (when `targetKind: package`), and bounded `memberPackages[]` discovered from
  workspace manifests (`package.json#workspaces`, `pnpm-workspace.yaml`, `go.work`, Cargo
  workspace) plus tracked nested instruction files as a convention fallback. The representative
  editor monorepo (no manifest) resolves `repo-root` with `extensions/*`, `src/product`, and
  `native/*` members.
- **AC2 (nested asset discovery):** Root-target asset baseline on the representative monorepo reports all tracked
  nested `AGENTS.md` guides for every provider, each tagged with a `packageRoute`; the qajaq
  early-return in `collectNestedEntrypoints` is removed.
- **AC3 (gitignore-aware walk):** Nested discovery excludes gitignored paths (via
  `git ls-files`/`check-ignore` when a git root exists, falling back to the static exclude list),
  no longer skips tracked dirs that merely share a name with build outputs, and enforces a file
  cap with an explicit `truncated` marker.
- **AC4 (inherited scope):** A package target reports git-root assets (root instruction files,
  provider dirs) with `scope: "inherited"`, distinct from package-local `project` assets, without
  double counting when the target is the root itself.
- **AC5 (session bridging):** For a package target, sessions with `cwd` at the git root are
  included when session facts show file activity under `packageRelPath`, labelled
  `workspaceMatch: "root-cwd"`; direct-cwd matching is unchanged. Root targets stay inclusive.
- **AC6 (scoped project history):** For a package target, `core-change-watch` git commands are
  path-scoped (`git log -- <packageRelPath>` etc.); repo-root behavior is unchanged.
- **AC7 (skill contract):** SKILL.md Step 1 resolves and states the target kind; findings that
  originate from one package carry its route in the finding target so repairs land in the right
  package.

## Non-goals

- No multi-package fan-out report (one bundle per member package) in this iteration; the unit of
  analysis stays one target, now correctly scoped.
- No new provider surfaces, no Memory/authority model changes.
- No git submodule or nested-git-repo topology support.
- No change to `findings.json` schema fields; package routes reuse existing target/route strings.

## Plan

1. **Topology owner** — add `scripts/harness-analysis/workspace-topology.mjs`: git root probe,
   manifest parsing, convention fallback (tracked nested instruction files / `package.json`
   markers), bounded and gitignore-aware; freeze the result into
   `evidence-bundle/contract.mjs` context. (AC1)
2. **Asset lane** — in `agent-lint`: drop the qajaq nested early-return, route walks through the
   topology's ignore rules and file cap, tag entrypoints with `packageRoute`; in
   `asset-baseline`/`agent-customize`: collect git-root primitives as `inherited` for package
   targets. Reuse `--scan-children` internals where they fit, driven by `memberPackages` instead
   of direct-child listing. (AC2, AC3, AC4)
3. **Session lane** — extend the shared `isWorkspaceMatch` in the four platform collectors with
   the root-cwd bridge, using existing file-read facts; keep the label on the session summary so
   downstream facts stay auditable. (AC5)
4. **Project lane** — thread `packageRelPath` from bundle context into
   `core-change-watch/common.mjs` git invocations as a pathspec. (AC6)
5. **Skill + docs** — update `skills/better-harness/SKILL.md` Step 1 scope resolution and the
   relevant references; regenerate the doc-link graph. (AC7)
6. **Tests** — fixture monorepo under `test/fixtures/` mirroring the representative shape (nested
   guides, gitignored artifact copies, tracked `build/` source dir); node tests per AC; forward
   test re-runs the E1/E2/E3 probes and asserts the corrected counts.

## Risks

- Gitignore-aware walking must not regress non-git targets; fallback path keeps today's behavior.
- Root-cwd session bridging can over-match when file facts are sparse; the bridge only fires on
  positive file-path evidence, never on absence.
- Larger nested inventories may push `MAX_BASELINE_OWNER_ROUTES`/finding caps; caps stay, with
  `omitted` counts already in the contract.

## Evidence Log

- E1–E3, E6 probe commands and outputs captured in the 2026-07-25 spike session
  (`asset-baseline` runs against the representative root and `extensions/assistant`;
  `discoverAgentEntrypoints` with codex provider returned 53 entrypoints, 42 from
  gitignored trees).
- E4/E5 from source: `scripts/session-analysis/platforms/{claude,codex,cursor,qajaq}.mjs`
  prefix match; `scripts/core-change-watch/common.mjs` `resolveRepoRoot`.
- Representative monorepo ground truth: `git check-ignore` confirms `.build/`, `out*` ignored;
  `git ls-files build` confirms `build/` tracked; `package.json` has no `workspaces` field.
