# Public Quickstart and Adapter Entrypoints for Six Supported Hosts

## Traceability
- Spec ID: supported-host-entrypoints
- Status: Draft

## Intent
Give every currently supported Coding Agent host a compact, clickable, and
verifiable public entrypoint—similar to obra/superpowers' Quickstart—while
making the contribution path explicit about when a partial adapter may advance
to the public Quickstart. Today the runtime and canonical adapter matrix already
support six hosts (Claude Code, Codex, Qoder, Cursor, Qwen Code, and GitHub
Copilot), but the root README Quickstart list, Docusaurus home page, public
installation tabs, and several reader-facing docs still imply an older four-host
set or omit Qwen Code entirely.

## Acceptance Scenarios
- AC-1: The root `README.md` and `README.zh-CN.md` place a compact Quick start
  section immediately after the top navigation and before the demo/why
  sections. It contains a one-line list of all seven current product
  entries—Claude Code, Codex Desktop, Codex CLI, Qoder Desktop/CLI, Cursor,
  Qwen Code, and GitHub Copilot CLI—under the reader copy "Review your coding
  workflow with:" (中文自然对应："用以下 Coding Agent 审查你的工作流："). Each
  product name is a Markdown link that targets an existing anchor under
  `## Installation`; Codex Desktop links to `#codex-desktop` and Codex CLI links
  to `#codex-cli`. The detailed per-host install steps remain under
  `## Installation`. The follow-up paragraph in both languages names the five
  HTML-producing hosts (Claude Code, Codex, Cursor, Qwen Code, and GitHub
  Copilot) and Qoder (Canvas) consistently with the list. The `## See it in
  action` / `## 看看实际效果` section no longer repeats the first-operation
  prompt code block, so Quick start is the sole first-action entrypoint.
- AC-2: `docs/src/pages/index.js` renders six host cards on the Docusaurus home
  page in a `QuickStart` section that appears immediately after `Hero` and
  before `LiveDemo` and `HowItWorks`: Claude Code, Codex, Qoder, Cursor, Qwen
  Code, and GitHub Copilot. Each card links to the matching tab *and* heading
  anchor using the Docusaurus Tabs query contract, e.g.
  `/docs/installation?host=qwen-code#qwen-code`, so the correct `TabItem` is
  active and the user sees the target host instead of a hidden heading. Each
  card also has a one-line setup blurb. `docs/i18n/zh-Hans/code.json` supplies
  the corresponding `homepage.hosts.*` translation keys, and both English and
  `zh-Hans` builds pass Docusaurus validation.
- AC-3: `docs/docs/installation.mdx` and its `zh-Hans` translation add tabs for
  Qwen Code and GitHub Copilot with stable anchors (`#qwen-code` and
  `#github-copilot`) that match the home-page card anchors. Copilot instructions
  come from the verified native contract already in the canonical adapter matrix
  and root README Installation. Qwen Code instructions must be derived from the
  current Qwen Code official extensions contract; the candidate command is
  `qwen extensions install QoderAI/better-harness`. Any local smoke must use an
  isolated `QWEN_HOME`/`XDG_CONFIG_HOME` and must not modify the user's global
  Qwen configuration; if a local smoke cannot be completed, the spec/PR must
  record the evidence boundary and must not claim the command is verified.
- AC-4: Reader-facing pages that still declare the old four-host set are updated
  to the current six-host reality without mechanically editing unrelated history
  or specs. Affected pages include:
  - `docs/docs/your-first-report.md` and
    `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/your-first-report.md`
  - `docs/docs/reference/architecture.md` and
    `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/reference/architecture.md`
  - `docs/docs/hosts/adapter-matrix.md` and
    `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/hosts/adapter-matrix.md`
  - `docs/docs/concepts/glossary.md` and
    `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/concepts/glossary.md`
  - `docs/community.md` is kept as an audit surface; only update it if
    implementation reveals a real drift from the six-host set.
- AC-5: `docs/adapters/contributing-new-coding-agent.md` distinguishes three
  capability levels: partial adapter (subset of shell/assets/sessions), verified
  install/discovery (native commands smoke-tested), and public Quickstart-ready
  (full report loop with validated output). It also fixes the host inventory
  search command to include `copilot` so future adapters do not miss existing
  registration surfaces.
- AC-6: Automated checks validate two separate declaration layers and do not
  collapse them. The capability-local layer (`test/support-declarations.test.mjs`)
  continues to assert that provider modules, session platforms, and CLI gates
  agree on the canonical supported platform set. The public-entrypoint layer
  asserts that the README Quickstart list, Docusaurus home-page cards (including
  their tab-query deep links), section order, installation tab/anchor set,
  English/Chinese public matrix, and native install commands for Qwen Code and
  GitHub Copilot all agree on the current public Quickstart set. A host may pass
  the capability-local layer while
  remaining excluded from the public Quickstart set, so partial adapters are not
  forced to falsely claim full user-facing support.
- AC-7: The change is validated with focused tests, doc-link-graph
  regeneration/check, Docusaurus bilingual build, full `npm test`,
  `npm run pack:verify`, and `git diff --check`.

## Non-goals
- Do not add a new runtime adapter, provider, session parser, or host manifest.
- Do not change report output semantics, scoring, or the underlying evidence
  model.
- Do not publish the package or install anything into a user's global
  configuration.
- Do not present a partial host as having full Quickstart support.

## Plan and Tasks
1. Audit current host declarations across `README.md`, `README.zh-CN.md`,
   `docs/src/pages/index.js`, `docs/docs/installation.mdx`,
   `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/installation.mdx`,
   `docs/docs/hosts/adapter-matrix.md`,
   `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/hosts/adapter-matrix.md`,
   `docs/docs/your-first-report.md`,
   `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/your-first-report.md`,
   `docs/docs/reference/architecture.md`,
   `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/reference/architecture.md`,
   `docs/docs/concepts/glossary.md`,
   `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/concepts/glossary.md`,
   and `docs/community.md` (audit surface only).
2. Move the Quick start section in `README.md` and `README.zh-CN.md` to
   immediately after the top navigation and before the demo/why sections.
   Replace the old table with a compact one-line product-entry list under the
   reader copy "Review your coding workflow with:" /
   "用以下 Coding Agent 审查你的工作流：". Link Codex Desktop to
   `#codex-desktop` and Codex CLI to `#codex-cli`, adding explicit anchors if
   needed. Add a `### Qwen Code` section with a stable `#qwen-code` anchor under
   `## Installation` in both files so every list link resolves to an existing
   target. Remove the duplicate first-operation prompt code block from
   `## See it in action` / `## 看看实际效果`.
3. Extend `hosts()` in `docs/src/pages/index.js` with Qwen Code and GitHub
   Copilot cards; add matching keys to `docs/i18n/zh-Hans/code.json`.
4. Add Qwen Code and GitHub Copilot `TabItem` sections to
   `docs/docs/installation.mdx` and its `zh-Hans` translation. Copilot
   instructions come from the verified native contract in the canonical adapter
   matrix and root README Installation. Qwen Code instructions come from the
   current Qwen Code official extensions contract; the candidate command is
   `qwen extensions install QoderAI/better-harness`. Any local smoke must run
   with an isolated `QWEN_HOME`/`XDG_CONFIG_HOME` and must not modify the user's
   global Qwen configuration.
5. Update `docs/docs/hosts/adapter-matrix.md` and its `zh-Hans` translation to
   list six hosts, reference all six plugin metadata roots, and describe the HTML
   visual contract as covering Claude Code/Codex/Cursor/Qwen/Copilot.
6. Update the host list in `docs/docs/your-first-report.md`,
   `docs/docs/reference/architecture.md`, `docs/docs/concepts/glossary.md`, and
   their `zh-Hans` translations. Update `docs/community.md` only if the audit
   reveals a real drift from the six-host set.
7. Update `docs/adapters/contributing-new-coding-agent.md`:
   - Add a "Capability levels" subsection that separates partial adapter,
     verified install/discovery, and public Quickstart-ready full report loop.
   - Fix the `rg` inventory command to include `copilot`.
8. Extend `test/support-declarations.test.mjs` (or add a dedicated docs-sync test)
   to assert that the public-entrypoint set (README Quickstart list, home-page
   cards, installation anchors, English/Chinese public matrix) is consistent and
   separate from the capability-local supported-platform set, allowing partial
   adapters to exist without claiming full Quickstart support.
9. Regenerate the doc link graph and run the full validation suite listed in
   AC-7.

## Test and Review Evidence
- Focused test run: `node --test test/support-declarations.test.mjs`
- Doc link graph regeneration:
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`
- Doc link graph check: `node --test test/doc-link-graph.test.mjs`
- Full repository test suite: `npm test`
- Packaging verification: `npm run pack:verify`
- Docusaurus bilingual build:
  `cd docs && npm ci && npm run build` (validates both `en` and `zh-Hans`)
- Whitespace check: `git diff --check`

### Observed evidence
- The Qwen Code extension install contract was sourced from the official Qwen
  Code documentation (`qwen extensions install <owner>/<repo>`) and the same
  command is present in both English and Chinese installation surfaces.
- The focused doc-structure tests, doc-link-graph check, Docusaurus bilingual
  build, and packaging verification pass locally.
- A Playwright visual review revealed that hash-only card links could land on a
  hidden tab panel, so the homepage card `to` URLs were updated to the
  Docusaurus Tabs query contract (`?host=<anchor>#<anchor>`) and the
  public-entrypoint tests now statically verify that contract for every card.
- A follow-up Playwright screenshot at 1440px showed six host cards wrapping
  unevenly (5+1) under `auto-fit`. The homepage grid was changed to explicit
  responsive columns: 3 columns on desktop (`>=996px`), 2 columns on tablet
  (`>=768px`), and 1 column on mobile. The 1440px screenshot now provides
  visual evidence of a balanced 3x2 desktop layout.
- `command -v qwen` returns no output in this environment, so no native
  end-to-end install/discovery smoke was performed with an isolated
  `QWEN_HOME`/`XDG_CONFIG_HOME`. The spec therefore does **not** claim the Qwen
  command is verified against a real CLI, and the spec status stays `Draft`
  until that smoke can be completed or an external maintainer confirms it.

## Risks
- **Over-claiming public support**: Adding a host to the Quickstart list or home
  page before its full report loop is validated could mislead users. Mitigation:
  require AC-5 capability gates and AC-6 two-layer automated checks.
- **English/Chinese drift**: Adding hosts to English pages without updating
  `zh-Hans` translations breaks bilingual consistency. Mitigation: every English
  change in AC-1 through AC-4 has a paired `zh-Hans` update.
- **Anchor mismatch / hidden tab panels**: Home-page cards link to installation
  anchors inside `Tabs`. A link that only carries the hash can scroll to a
  hidden heading while the default tab remains active, so users do not see the
  target host. Mitigation: AC-2 requires the Docusaurus Tabs query contract
  (`?host=<anchor>#<anchor>`), and AC-6 statically verifies every card uses it.
- **Qwen Code or GitHub Copilot CLI contract drift**: Copying install steps from
  another host rather than the verified native contract would encode the wrong
  CLI. Mitigation: AC-3 sources Copilot instructions from the canonical adapter
  matrix and root README Installation, and sources Qwen Code instructions from
  the official extensions contract with an isolated `QWEN_HOME` smoke; if smoke
  is unavailable the evidence boundary is recorded honestly.
- **Capability-level collapse**: A single global "supported platforms" test set
  could force partial adapters to claim full Quickstart support. Mitigation:
  AC-6 keeps the capability-local provider/session layer separate from the
  public-entrypoint layer.
