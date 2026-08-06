---
id: troubleshooting
title: Troubleshooting
sidebar_position: 4
---

# Troubleshooting

Start with the smallest check for the failing step. Do not delete host caches,
plugin directories, reports, or user configuration as a first response. Keep
credentials, raw transcripts, private prompts, and complete reports out of
diagnostic output and public issues.

## The plugin or Skill is not visible

After installing or updating Better Harness, start a new host session or task.
An existing session may still be using the plugin inventory it loaded at
startup. Then use the check supported by that host:

| Host | Smallest supported check |
| --- | --- |
| [Claude Code](./installation?host=claude-code#claude-code) | Run `claude plugin details better-harness@better-harness`; the details should include `Skills (1) better-harness`. |
| [Codex](./installation?host=codex#codex) | In Desktop, check **Settings > Plugins**. In the CLI, run `codex plugin list --marketplace better-harness`. |
| [Qoder](./installation?host=qoder#qoder) | The Desktop version is built in. For a manual CLI install, run `qodercli plugin list`. |
| [Cursor](./installation?host=cursor#cursor) | Start the agent with `cursor-agent --plugin-dir /path/to/better-harness`, keep that process open, and run the report prompt in the same session. |
| [Qwen Code](./installation?host=qwen-code#qwen-code) | Start a new session and run the report prompt. This guide does not assume an unverified extension-list command. |
| [GitHub Copilot](./installation?host=github-copilot#github-copilot) | Run `copilot plugin list` and `copilot skill list`; both should include `better-harness`. |
| [Pi](./hosts/adapter-matrix#pi) | Run `pi --version`, then start a new Pi session with the package and run `/better-harness`. |
| [WorkBuddy](./hosts/adapter-matrix#workbuddy) | Run `codebuddy --plugin-dir .` for local Team discovery and `npm run workbuddy:verify` for the offline manifest check. |

If a marketplace command fails, return to the linked host tab and compare the
repository source and command spelling exactly. In particular, current Codex
uses a repository URL with `marketplace add`, then `plugin add`; Qoder CLI uses
`plugin install`.

## Cursor cannot load the source-local plugin

The value passed to `--plugin-dir` must be the root of this repository, not its
`.cursor-plugin` or `skills` subdirectory. That root contains both
`.cursor-plugin/plugin.json` and `skills/better-harness/SKILL.md`.

The plugin applies only to the Cursor Agent process started with that argument.
If the process was closed, start a new one with the same repository path. Do not
copy the checkout into a global plugin directory as a troubleshooting step.

## The standalone or source CLI reports an unsupported runtime

The standalone and source CLIs support Node.js `>=22.20.0 <26.0.0` and npm
`>=10.9.3 <12.0.0` on Windows, macOS, and Linux. Check the active executables:

```bash
node --version
npm --version
```

Use the runtime selected for this repository before retrying. Do not bypass the
declared engine range or edit the package lock to silence a version error.

## The source CLI rejects the repository directory

`better-harness report` returns `INVALID_CWD` when `--cwd` is empty, missing,
unavailable, or not a directory. Run it from the repository you want to inspect,
or pass an existing directory explicitly. From a Better Harness source
checkout, this portable check targets the current directory:

```bash
node scripts/better-harness.mjs report --cwd . --json
```

## No session evidence was found

Missing or partial session evidence is not an installation failure. Better
Harness keeps the limitation visible instead of inventing activity. From a
source checkout, you can intentionally inspect only static project evidence:

```bash
node scripts/better-harness.mjs report --no-sessions
```

The quickstart session probe uses Qoder's data root by default. If that root was
intentionally relocated, pass the authorized location with `--qoder-home`:

```bash
node scripts/better-harness.mjs report --qoder-home /path/to/qoder-data
```

Do not widen the search to unrelated user directories or attach raw session
files to an issue.

## The report finished but the files are missing

Inline or `no-files` output intentionally writes no artifacts. For a durable
report, use the exact report link returned by the host. The default roots and
artifacts are:

| Provider | Report root | Durable artifacts |
| --- | --- | --- |
| Qoder | `<target>/.qoder/better-harness/<run>/` | `findings.json`, `canvas.json`, `report.canvas.tsx` |
| Claude Code | `<target>/.claude/better-harness/<run>/` | `findings.json`, `report.md`, `report.html` |
| Codex | `<target>/.codex/better-harness/<run>/` | `findings.json`, `report.md`, `report.html` |
| Cursor | `<target>/.cursor/better-harness/<run>/` | `findings.json`, `report.md`, `report.html` |
| Qwen Code | `<target>/.qwen/better-harness/<run>/` | `findings.json`, `report.md`, `report.html` |
| GitHub Copilot | `<target>/.copilot/better-harness/<run>/` | `findings.json`, `report.md`, `report.html` |
| Pi | `<target>/.pi/better-harness/` | `findings.json`, `report.md`, `report.html` |
| WorkBuddy | `<target>/.workbuddy/better-harness/` | `findings.json`, `report.md`, `report.html` |

`<target>` is the repository being reviewed, not the Better Harness source
checkout unless that is the selected target.

## Collect bounded diagnostics

Before reporting a problem, record only the information needed to reproduce the
failing step:

- Better Harness version from installed plugin metadata, or
  `node scripts/better-harness.mjs --version` for a source checkout.
- Host and host version, operating system, and installation method.
- The exact command or feature that failed and its smallest useful error.
- A minimal reproduction, plus expected and actual behavior.
- Node.js and npm versions only when the source CLI or runtime is involved.
- Whether `--no-sessions` works when the problem involves session evidence.

Remove tokens, credentials, private paths, raw prompts, transcripts, and report
content unrelated to the reproduction.

## Report a reproducible issue

If these checks do not resolve the problem, open the
[GitHub issue chooser](https://github.com/QoderAI/better-harness/issues/new/choose).
Select **Bug report** and include the bounded diagnostics above. Search existing
issues first and link only artifacts that are safe to share.
