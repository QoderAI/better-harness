<p align="center">
  <img src="assets/logo.svg" alt="Better Harness logo" width="56" height="56">
</p>

<h1 align="center">Better Harness</h1>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Delegate coding to agents. Improve the loop around them.</strong>
</p>

<p align="center">
  Better Harness provides open-source insights for the Agent Work Loop. It runs
  through your Coding Agent and turns project and session evidence into prioritized
  improvements and verifiable next steps. Missing evidence stays explicit.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@qoder-ai/better-harness"><img src="https://img.shields.io/npm/v/@qoder-ai/better-harness.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://qoderai.github.io/better-harness/?utm_source=github&utm_medium=referral&utm_campaign=repository_landing&utm_content=readme_hero">Website</a> ·
  <a href="#quick-start">Choose your host</a> ·
  <a href="#see-it-in-action">Sample report</a> ·
  <a href="https://qoderai.github.io/better-harness/docs/introduction">Docs</a>
</p>

## Quick start

Analyze and improve your coding workflow with: [Claude Code](#claude-code), [Codex Desktop](#codex-desktop), [Codex CLI](#codex-cli), [Qoder Desktop/CLI](#qoder), [Cursor](#cursor), or [GitHub Copilot CLI](#github-copilot).

Choose the host you already use to get its exact installation, verification,
invocation, and report-output steps. Better Harness does not use one universal
entrypoint across every host.

This README shows inline setup for the most common hosts. Additional supported
hosts (Qwen Code, Pi, Kimi Code, WorkBuddy, and Grok) keep their steps and
boundaries in the [installation guide](docs/docs/installation.mdx) and the
[public Host Adapter Matrix](docs/docs/hosts/adapter-matrix.md); see
[More adapters](#more-adapters). README placement is a display choice, not a
support-level claim.

Better Harness scopes behavior claims to relevant Task Episodes and the
surrounding project mechanisms. Qoder and Cursor produce host-native Canvas
reports; Claude Code, Codex, Qwen Code, GitHub Copilot, and Kimi Code produce
self-contained HTML with paired Markdown. Missing or partial evidence remains
explicit. See the [Host Adapter Matrix](docs/adapters/README.md) for current
coverage and output differences.

## See it in action

The report keeps missing evidence explicit and turns supported gaps into
prioritized findings with an impact, expected output, scoped repair, and
acceptance checks.

<p align="center">
  <a href="https://qoderai.github.io/better-harness/demo/better-harness-report/"><img src="assets/demo/better-harness-findings-report.png" alt="Better Harness HTML report showing an evidence-bounded finding with its impact, expected output, scoped AI fix, and acceptance checks" width="900"></a>
</p>

<p align="center">
  <sub><a href="https://qoderai.github.io/better-harness/demo/better-harness-report/">Open the complete self-contained English HTML report</a>
  (<a href="assets/demo/better-harness-report.html">source</a>).</sub>
</p>

For delivery tracing, the interactive [Harness Inspector](https://qoderai.github.io/better-harness/inspector)
follows product intent through agent activity, sessions, files, and commits in
a read-only workspace, keeping evidence strength and limitations visible:

<p align="center">
  <a href="https://qoderai.github.io/better-harness/inspector"><img src="docs/assets/harness-inspector/session-view.png" alt="Harness Inspector session view: a synchronized timeline of prompts, tool calls, and commits with the Evidence Drawer explaining each link" width="900"></a>
</p>

<p align="center">
  <sub><a href="https://qoderai.github.io/better-harness/inspector">Open the interactive Harness Inspector sample</a> (fictional English data; it never reads your workspace).</sub>
</p>

After you have comparable reports over time, the history view shows how the five
Agent Work Loop dimensions move:

<p align="center">
  <a href="dev/terminal-demo/README.md"><img src="assets/demo/twenty-history.png" alt="Static final frame of Better Harness report history showing five Agent Work Loop dimensions over time" width="900"></a>
</p>

The static final frame summarizes historical Harness reports. It shows recorded
trends, not causal proof of improvement. [See how the demo was recorded](dev/terminal-demo/README.md).

## Why Better Harness?

AI coding agents change code fast, but the workflow around them is often the
weak point:

- 🎯 **Fuzzy goals** — the agent confidently solves the wrong problem.
- 🧭 **Improvised steps** — work happens on paths nobody can reproduce.
- ✅ **"It works" without proof** — validation is incomplete or missing.
- 🚢 **Speed over safeguards** — review and delivery checks get bypassed.
- 🧠 **Lessons lost** — the same friction comes back on the next task.

Reviewing only the final diff misses these system-level problems. Better Harness
analyzes the workflow around the diff: it gathers project evidence (and session
evidence where supported), evaluates five connected dimensions, and turns
concrete gaps into prioritized findings — each tied to its evidence, expected
outcome, repair boundary, and validation route, so a team can improve one issue
at a time.

## How Better Harness works

Better Harness uses a
[feedforward-and-feedback](https://martinfowler.com/articles/harness-engineering.html#FeedforwardandFeedback)
loop that combines guidance available before work starts with signals available
after the agent acts:

- **Feedforward guides** — `AGENTS.md`, specs, Skills, and acceptance criteria
  steer the agent before it acts.
- **Feedback sensors** — linters, tests, Hooks, and evaluation agents observe results
  and help the agent self-correct.

Across that loop, it evaluates five parts of delivery — the **Agent Work Loop**:

[![Agent Work Loop: five dimensions from task understanding through learning capture](assets/agent-work-loop-en.svg)](models/agent-work-loop.md)

| Dimension | The question it answers | Backed by |
| --- | --- | --- |
| **Task Understanding** | Does the agent know the goal and what "done" means? | Rules, `AGENTS.md`, specs, `DESIGN.md` |
| **Controlled Execution** | Is the work on supported, repeatable paths? | Skills, commands, MCP tools, sandbox boundaries |
| **Change Validation** | Is there evidence the change actually works? | Tests, lint, Hooks, observable diagnostics |
| **Reliable Delivery** | Does AI speed bypass quality checks or acceptance? | Human review, approvals, CI/CD, recovery paths |
| **Learning Capture** | Does the next task benefit from this one? | Loop Discovery, reusable SDLC Skills, Memory |

Running `/better-harness` establishes a task-bounded baseline and, depending on
the host, produces a visual report, a Markdown report, or both. The report
combines the five-part overview, prioritized findings, detected agent assets,
and an evidence brief. Each finding includes a repair action that drafts a
scoped fix plan for review.

Better Harness is deliberately honest: unobserved behavior stays explicit instead
of becoming an unsupported score or claim. Passing a current check proves that
the intervention was exercised; only a comparable later result can prove that
the loop improved.

## What is open

Better Harness opens three connected layers, not only a slash-command prompt:

- **Engineering practices** — evidence and judgment guidance across
  [Session Evidence, Project Harness, Agent Customize, and Loop Engineering](references/README.md).
- **Evaluation model** — the task-centered
  [Agent Work Loop](models/agent-work-loop.md), including evidence states,
  findings, scoring boundaries, and longitudinal validation.
- **Runnable implementation** — the canonical
  [`/better-harness` workflow](skills/better-harness/SKILL.md), evidence
  collectors, analyzers, renderers, and thin
  [host adapters](docs/adapters/README.md).

The three layers share the same boundary: configured assets can establish that
a mechanism exists, but only linked task evidence can establish that it was used
or improved an outcome.

## Architecture

[![Better Harness architecture: host integration, three independent evidence agents, unified analysis by one lead agent, findings, host outputs, and repair](assets/better-harness-architecture-en.svg)](docs/ARCHITECTURE.md)

The architecture keeps the three evidence domains independent until unified
analysis by the lead agent. Every result retains a visible evidence source,
owner, and validation route.

## Installation

Installation differs by coding agent. Install Better Harness separately for
each host, except that Qoder CLI can use the version bundled with Qoder Desktop.
After installing or updating a plugin, start a new session or task so the host
reloads its plugin inventory.

### Claude Code

Register this repository as a Claude Code marketplace:

```text
/plugin marketplace add QoderAI/better-harness
```

Then install Better Harness:

```text
/plugin install better-harness@better-harness
```

Verify discovery from the shell:

```bash
claude plugin details better-harness@better-harness
```

The details should include `Skills (1) better-harness`. Then start a new Claude
session in the repository you want to analyze and run the report prompt:

```text
/better-harness analyze this project's AI coding workflow and generate an evidence-backed report
```

Claude Code defaults to a self-contained `report.html` with paired `report.md`
and `findings.json` under the repository's `.claude/better-harness` report root.
Ask for inline or no-files output to keep the result in chat only. Workspace-
matching local Claude sessions are included when available; missing evidence
stays explicit rather than being inferred.

### Codex

<a id="codex-desktop"></a>

#### Codex Desktop

1. Open **Settings > Plugins**.
2. Select **+ Add > From Marketplace**.
3. Enter the Git repository URL, set its Git ref, and leave **Sparse paths**
   empty for this single-plugin repository.
4. Select **Add marketplace**, then install **Better Harness** from the new
   marketplace.
5. Start a new task in the repository you want to analyze and run the report
   prompt:

```text
@better-harness analyze this project's AI coding workflow and generate an evidence-backed report
```

Use `https://github.com/QoderAI/better-harness.git` with Git ref `main`.

![Codex Add plugin marketplace dialog with repository, Git ref, and optional sparse paths](assets/install/codex-add-marketplace.jpg)

<a id="codex-cli"></a>

#### Codex CLI

Add the repository source:

```bash
codex plugin marketplace add \
  'https://github.com/QoderAI/better-harness.git' \
  --ref main
```

Then inspect and install Better Harness:

```bash
codex plugin list --marketplace better-harness
codex plugin add better-harness@better-harness
```

Start a new Codex task in the repository you want to analyze and run the report
prompt:

```text
$better-harness:better-harness analyze this project's AI coding workflow and generate an evidence-backed report
```

Use the repository URL with `marketplace add`, not a raw `marketplace.json`
URL. Current Codex builds use `plugin add` and `--marketplace`; examples that
use `plugin install` or `--source` target a different CLI contract.

### Qoder

Better Harness is built into the [Qoder](https://qoder.com/) desktop app, so no
Marketplace or local plugin installation is required there. Choose either
entry point:

1. **From a session:** Open the repository you want to analyze, start a new
   session, and run the report prompt:

   ```text
   /better-harness analyze this project's AI coding workflow and generate an evidence-backed report
   ```

2. **From Quest (Qoder 1.18.0+):** Open Quest, then select
   **Better Harness (Beta)** from the left sidebar.

#### Qoder CLI

If Qoder Desktop is installed, Better Harness is already available in Qoder
CLI. No marketplace or plugin installation is required. Start a new Qoder CLI
session in the repository you want to analyze and run the report prompt:

```text
/better-harness analyze this project's AI coding workflow and generate an evidence-backed report
```

Only when using Qoder CLI without Qoder Desktop, inspect the current manual
installation disposition before following:

##### From marketplace

```bash
# Add the plugin marketplace source
qodercli plugin marketplace add 'https://github.com/QoderAI/better-harness.git'

# Install the plugin
qodercli plugin install better-harness@better-harness

# Check installation
qodercli plugin list
```

##### From git

```bash
# Make sure directory exist
mkdir -p $HOME/.qoder/plugins/marketplaces/

git clone https://github.com/QoderAI/better-harness.git \
  $HOME/.qoder/plugins/marketplaces/better-harness --depth 1

qodercli plugin install $HOME/.qoder/plugins/marketplaces/better-harness
```

Replace `.qoder` to `.qoder-cn` in urls for Qoder CN series.

Then start a new Qoder CLI session before using `/better-harness`.

### Cursor

The Cursor plugin is not published to the marketplace. The repository carries
the source-local manifest, but the current local Cursor help does not verify the
historical `--plugin-dir` contract. Better Harness therefore reports the
installation plan as unavailable instead of emitting that command:

```bash
git clone https://github.com/QoderAI/better-harness.git
better-harness plugin plan install --host cursor --surface agent --scope session
```

Cursor session evidence is supported through workspace-matched transcripts,
metadata, and audit logs. A session that was loaded through a separately
verified native route can be checked with `better-harness plugin verify --host
cursor --surface agent`; partial or unavailable coverage remains explicit.

### GitHub Copilot

Register this repository as a Copilot plugin marketplace, then install Better
Harness:

```bash
copilot plugin marketplace add QoderAI/better-harness
copilot plugin install better-harness@better-harness
```

Verify that the Skill loaded:

```bash
copilot plugin list
```

Prefer marketplace installs. Direct repository, URL, and local-path installs are
deprecated in Copilot CLI.

Copilot session evidence is supported through workspace-matched Copilot CLI
transcripts under `~/.copilot/session-state/`. Copilot records no per-response
token usage, and VS Code Copilot Chat has no supported durable transcript; both
remain explicit evidence boundaries.

### Inspect and plan plugin lifecycle changes (Beta)

The standalone CLI can inspect local Better Harness installation evidence for
every host without contacting a registry or changing host configuration:

```bash
better-harness plugin status --host all
better-harness doctor --platform all
```

Build a host-specific install, update, or removal plan before using that host's
native UI or CLI. Plans preserve native steps as typed argv data for deliberate
external execution; the human view does not turn them into shell command
strings, and Better Harness does not execute them:

```bash
better-harness plugin plan install --host qwen --surface cli --scope user
better-harness plugin verify --host qwen --surface cli
```

Host differences remain explicit. Qoder Desktop is bundled, Cursor is
session-only while its native command contract is being reconciled, Pi
lifecycle commands without current native evidence remain manual or
unavailable, and WorkBuddy has no managed Better Harness plugin lifecycle
surface.

### More adapters

Beyond the hosts above, Better Harness also supports Qwen Code, Pi, Oh My Pi
(OMP), Kimi Code, WorkBuddy, and Grok. Their exact install, invocation, and
evidence boundaries live in the docs so this README stays focused:

- **Qwen Code** — [installation guide](docs/docs/installation.mdx#qwen-code)
  (`qwen extensions install QoderAI/better-harness`).
- **Pi** — [Host Adapter Matrix](docs/docs/hosts/adapter-matrix.md#pi)
  (`pi install <source>` or `pi -e <source>`).
- **Oh My Pi (OMP)** — [Host Adapter Matrix](docs/docs/hosts/adapter-matrix.md#oh-my-pi-omp)
  (`PI_CODING_AGENT_DIR=~/.omp/agent` to point at OMP session directory).
- **Kimi Code** — [Host Adapter Matrix](docs/adapters/README.md)
  (`.kimi-plugin/plugin.json` plugin install).
- **WorkBuddy** — [Host Adapter Matrix](docs/docs/hosts/adapter-matrix.md#workbuddy).
- **Grok** — [Host Adapter Matrix](docs/docs/hosts/adapter-matrix.md#grok).

Each produces a self-contained `report.html` with paired `report.md` and
`findings.json`; missing or partial session evidence stays explicit.

## Develop and package from source

Development requires Node.js `>=22.20.0 <25.0.0` and npm
`>=10.9.3 <12.0.0` on Windows, macOS, or Linux.

```bash
npm ci
npm test
npm run pack:verify
```

Build the source-local Codex plugin artifact with:

```bash
node scripts/packaging/build-host-plugin.mjs
```

The validated artifact is written to `dist/plugins/better-harness`.

From the same source checkout, inspect repository evidence without reading local
sessions:

```bash
node scripts/better-harness.mjs report --no-sessions
```

From a source checkout, `npm run preview -- --open` serves a bundled fixture.
Canvas preview requires an installed Qoder runtime, or an explicit
`--sdk-media`/`--sdk-root` path. It listens on `127.0.0.1` by default and is a
local inspection tool, not an authenticated sharing service.

## Contribute

You do not need to understand the whole runtime to contribute. Start with the
smallest surface that matches the improvement you want to make:

| What you can contribute | Start here | Example contribution |
| --- | --- | --- |
| Workflow guidance and engineering practices | [`skills/`](skills/) or [`references/`](references/) | Add sourced guidance for a language, framework, review pattern, or recurring agent workflow. |
| Evaluation models and executable analysis | [`models/`](models/) or [`scripts/`](scripts/) | Add an evidence-backed evaluation lens, detector, or agent-friendly analysis command with fixtures and tests. |
| Delivery controls and host support | [`hooks/`](hooks/) or the [new Coding Agent guide](docs/adapters/contributing-new-coding-agent.md) | Add a narrow lifecycle check or document and validate evidence support for another Coding Agent host. |
| Reports and visual language | [`templates/reporting/`](templates/reporting/) or [`templates/style/`](templates/style/) | Add a report mode, reusable reporting contract, or directive-only visual style with validation evidence. |
| Examples and operating models | [`case-studies/`](case-studies/) | Share a redacted, evidence-bounded example of how a team applies Agent Work Loop analysis and delivery practices. |

To get started:

1. Read the [community extension map](docs/community.md) to choose the canonical
   owner and understand its contract.
2. Follow the [contribution guide](CONTRIBUTING.md) to set up the project and
   scope the change.
3. For host support, follow the
   [new Coding Agent contribution guide](docs/adapters/contributing-new-coding-agent.md)
   and update the [host adapter matrix](docs/adapters/README.md).
4. Add tests, fixtures, or preview evidence when the contribution changes
   runtime behavior or rendered output.
5. Open a focused pull request that explains what changed, why, and how it was
   validated.

Not sure where an idea belongs? [Open an issue](https://github.com/QoderAI/better-harness/issues)
before building a new top-level surface or changing a public report, schema,
packaging, or compatibility contract.


## License

Better Harness is licensed under the [MIT License](LICENSE).

---

<p align="center">
  If Better Harness helps you improve your agent workflow, consider giving it a ⭐
  — it helps others find the project.
</p>
