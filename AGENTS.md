# Better Harness

Cross-platform support is required (Windows, macOS, Linux).
Architecture, directory routing, and template ownership live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Adding support for a new Coding Agent host starts with
[docs/adapters/contributing-new-coding-agent.md](docs/adapters/contributing-new-coding-agent.md).

## UI and Visual Design

- [DESIGN.md](DESIGN.md) is the visual source of truth for Harness Studio and
  interactive Better Harness reports unless a surface owns a narrower approved
  contract. Read it before changing UI hierarchy, typography, color, density,
  components, interaction states, or responsive behavior.
- Keep `AGENTS.md` as the routing and enforcement layer; put reusable tokens,
  visual rationale, component rules, and do/don't guidance in `DESIGN.md`.
- Treat Studio as a VS Code-inspired docked workbench: prefer panes, rows, tabs,
  toolbars, and editor views over cards, and define pointer and keyboard behavior
  before adding or changing an interaction.
- Map Studio styles to shared semantic tokens. Do not introduce one-off colors,
  font sizes, radii, shadows, an unbundled font family, or broad `!important`
  overrides when the design contract already defines the role.
- Visual review must prove the primary decision remains obvious at wide,
  compact, and narrow layouts. Verify keyboard focus, bounded overflow, browser
  console/page errors, and screenshots for every changed Studio surface.

## Plan & Spec

- Write a plan or spec for new agents, hooks, or major features under
  `docs/specs/<yyyy-mm-dd>-<spec-name>.md`, using the spec's creation date.
- For non-trivial behavior changes to `skills/`, `hooks/`, `scripts/`, `templates/`, adapters, report formats, or review workflows,
  use `.agents/skills/change-traceability-review/SKILL.md` in **Spec Preparation** mode before implementation.
- Prefer `docs/specs/<yyyy-mm-dd>-<story-id>-<slug>.md` when there is a Story or issue id; otherwise use
  `docs/specs/<yyyy-mm-dd>-<slug>.md` for justified maintenance, docs-only, test-only, dependency, or infra work.
- Keep specs reviewable: include intent, acceptance scenarios with stable AC ids, non-goals, plan/tasks, and test/review evidence.
  Mark unknowns with `[NEEDS CLARIFICATION: ...]`.
- Keep `docs/specs/*.md` titles human-readable. Do not put Story ids, status, or review state in titles, and do not use YAML front matter by default.
- Put traceability metadata in the body: `Spec ID`, optional `Story`, and `Status` in a short `## Traceability` section.

## Change Scope

- Do not proactively edit `CHANGELOG.md`, release notes, version files, roadmap/status documents, or other task-external
  project metadata. Change them only when the user explicitly requests it or a pre-existing issue, spec, or acceptance
  criterion requires it; user-visible behavior alone is not authorization.

## Host Adapters

- The supported host set is deliberately bounded. Do not add a new host adapter
  without an explicit maintainer decision or a pre-existing issue/spec; a host
  being technically installable is not by itself justification to add one.
- `README.md` and `README.zh-CN.md` Installation sections are reserved for the
  most common hosts with inline setup steps. Do not add a full per-host install
  section for an additional or adapter-support host. Document its setup and
  boundaries in the installation guide
  ([docs/docs/installation.mdx](docs/docs/installation.mdx)) and the Host Adapter
  Matrix ([docs/docs/hosts/adapter-matrix.md](docs/docs/hosts/adapter-matrix.md)
  and [docs/adapters/README.md](docs/adapters/README.md)), and reference it from
  the README "More adapters" list instead.
- Keep support-level claims honest: a host's placement in the README is a
  display choice, not its verification level. Do not downgrade a host's matrix
  positioning (for example, from Verified Quickstart to adapter support) only to
  shorten the README.

## Test and Verify

### Cross-platform behavior

- Treat native filesystem paths as host data. Build and inspect them with
  `node:path` (`join`, `resolve`, `relative`, `basename`, and `dirname`) rather
  than splitting on `/`, concatenating separators, assuming `/tmp`, or ignoring
  Windows drive letters and UNC roots.
- Keep portable format paths separate from filesystem paths. Persisted artifact,
  archive, URL, protocol, and receipt paths use their specified separator (often
  `node:path.posix`); when simulating a target OS, select `posix` or `win32` from
  that explicit target instead of the host running the test.
- Prefer Node APIs and `execFile` argv arrays over shell-specific commands or
  quoting. If a shell is part of the contract, cover the intended PowerShell,
  `cmd.exe`, or POSIX-shell behavior explicitly.
- Do not make fixtures depend on checkout newline conversion, executable bits,
  case-sensitive filesystems, or raw absolute-path string equality unless that
  platform behavior is the contract. Normalize only at the boundary the test is
  meant to ignore.
- A local POSIX pass is not Windows evidence. Reproduce platform semantics with
  focused tests where possible, and use the corresponding GitHub Actions job as
  the authoritative receipt before declaring a Windows, macOS, or Linux failure
  fixed.

- Assert on behaviour, not on text that happens to contain it. Prefer calling the
  function and checking its returned value, shape, or error over matching a
  pattern against source code, rendered markup, or CLI output.
- Do not add pattern-matching assertions as a shortcut for coverage. A
  `assert.match(source, /functionName/)` proves a string exists; it does not prove
  the behaviour works, it passes while the feature is broken, and it fails when an
  unrelated rename touches the text. If the only way to observe something is to
  grep for it, the code needs an exported seam, not a regex.
- Never add a test that walks the repository and greps every file for a forbidden
  literal. Such tests fail on unrelated local files, editor state, and tool config
  that the change did not touch, and they train contributors to obfuscate strings
  rather than fix anything. Enforce naming and branding in review or in lint, not
  as a repo-wide scan.
- Regex is acceptable where it is the actual contract: a frozen CLI help or error
  channel, a redaction guarantee (`doesNotMatch` for a secret or absolute path),
  or a schema-shaped string. Keep those narrow and name the contract in the
  assertion's test title.
- When a test does need to read a file, assert a property of the parsed result
  (imports resolved, exports present, JSON shape valid) rather than a property of
  its raw characters.
- Design scripts and code for AI-friendly automated use, and validate automation with an AI agent when relevant,
  e.g. Qoder via `qodercli -p` or Codex via `codex -p`.
- For visual changes, verify with Playwright against the preview URL, inspect console/page errors, and save a screenshot for layout review.
- Run `npm run preview`, then smoke-test `http://localhost:58575/health` and `/canvas-module.js` to ensure TSX transforms and SDK runtime load.

## Doc Link Integrity

- All relative `.md` references across `skills/`, `references/`, `templates/`, `models/`, `docs/`, and `case-studies/`
  must resolve; `test/skills-docs/doc-link-graph.test.mjs` enforces this in `npm test`.
- After adding, moving, or renaming markdown docs, run `npx vitest run test/skills-docs/doc-link-graph.test.mjs` before committing,
  and regenerate the routing graph with `node scripts/doc-link-graph/cli.mjs skills/better-harness`
  (it rewrites `docs/better-harness-doc-links.mmd`, which the test checks for staleness).
- Every reference doc shipped under `skills/better-harness/references/` must stay reachable from `SKILL.md` routing,
  otherwise agents can never load it.

## Branch Names

- Name branches `<type>/<short-kebab-case-description>`, using the same intent-based types as Conventional Commits:
  `feat`, `fix`, `test`, `docs`, `refactor`, or `chore`.
- Choose the type from the purpose of the change, not only the files it touches. For example, a test-only change that fixes
  a CI failure uses `fix/<description>`.
- Do not add tool- or agent-specific prefixes such as `codex/` or `agent/` unless a maintainer explicitly requests one.
- Keep the description concise and portable across filesystems and shells; use lowercase ASCII words separated by hyphens.

### Co-Author Format

- Always add co-author information. If closing an issue in commit text, verify against `main` first: `gh issue view <issue-id>`.
- Only ONE co-author line is allowed. If multiple agents contributed, aggregate into ONE entry

Format example: `Co-authored-by: <AgentName> (<You-Model>) <Email>`

Valid examples (choose EXACTLY ONE):

Co-authored-by: GitHub Copilot Agent (GPT 5.5) <198982749+copilot@users.noreply.github.com>
Co-authored-by: Codex (GPT 5.6 Sol) <codex@openai.com>
Co-authored-by: QoderAI (Qwen 3.8 Max) <qoder_ai@qoder.com>
Co-authored-by: augment-app-staging[bot] <182802480+augment-app-staging[bot]@users.noreply.github.com>

## Commit Messages

- Use Conventional Commits: `<type>(<scope>): <summary>`, blank line, then a prose body when non-trivial.
- Prefer `feat`, `fix`, `test`, `docs`, `refactor`, `chore`; scopes should name affected areas such as `hooks`, `canvas`,
  `templates`, `agents`, or `deps`.
- Keep summaries imperative, lower-case after the type, and under 72 characters when practical.
  Do not use vague subjects like `update`, `changes`, or `fix stuff`.
- Agent-authored non-trivial commits need a normal prose body explaining what changed, why, and how it was validated.
- For spec-backed commits, naturally mention the Story/spec/test evidence in the body. Use `Story:`, `Spec:`, `Test:`, `Risk:`,
  `AI:`, or `Refs:` trailers only when a reviewer, host tool, or external workflow explicitly requires them.

## Change Traceability Review

- Use `.agents/skills/change-traceability-review/SKILL.md` as the Story/Spec/Test/Risk evidence-chain review guide, not a code-style guide.
- Before review, merge, or commit of a non-trivial change, run a **Review Readiness Check** over the staged or local diff:
  Story evidence, matching Spec, tests, risk, AI marker, changed modules, generated files, and staged/unstaged split.
- Use **Review Retrospective** for process tuning across recent history: commit messages, Story/Spec/Test/Risk coverage,
  oversized commits, repeated rework, automation commits, and missing review evidence.
- Do not infer Story ids, AI involvement, tracker status, CI status, or spec content from branch names, prose style, timestamps, or topic similarity.
  Count only visible local evidence or explicitly opened external evidence.
