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

Start with the read-only lifecycle view when the standalone CLI is available:

```bash
better-harness plugin status --host all
better-harness doctor --platform all
```

Both commands avoid registries, configuration writes, installation commands,
and raw session transcripts. A `partial`, `unobserved`, `manual`, or
`unavailable` result is a preserved evidence boundary, not permission to infer
that a host loaded the plugin.

## The plugin or Skill is not visible

After installing or updating Better Harness, start a new host session or task.
An existing session may still be using the plugin inventory it loaded at
startup. Then use the check supported by that host:

| Host | Smallest supported check |
| --- | --- |
| [Claude Code](./installation?host=claude-code#claude-code) | Run `claude plugin details better-harness@better-harness`; the details should include `Skills (1) better-harness`. |
| [Codex](./installation?host=codex#codex) | In Desktop, check **Settings > Plugins**. In the CLI, run `codex plugin list --marketplace better-harness`. |
| [Qoder](./installation?host=qoder#qoder) | The Desktop version is built in. For a manual CLI install, run `qodercli plugin list`; lifecycle planning does not emit the stale install syntax. |
| [Cursor](./installation?host=cursor#cursor) | Inspect `better-harness plugin status --host cursor --surface agent`; installation remains unavailable until the local Cursor help contract is reconciled. |
| [Qwen Code](./installation?host=qwen-code#qwen-code) | Run `qwen extensions list` and confirm it includes Better Harness, then start a new session and run the report prompt. |
| [GitHub Copilot](./installation?host=github-copilot#github-copilot) | Run `copilot plugin list` and `copilot skill list`; both should include `better-harness`. |
| [Pi](./hosts/adapter-matrix#pi) | Run `pi --version`, then start a new Pi session with the package and run `/better-harness`. |
| [WorkBuddy](./hosts/adapter-matrix#workbuddy) | Run `codebuddy --plugin-dir .` for local Team discovery and `npm run workbuddy:verify` for the offline manifest check. |

If a marketplace command fails, return to the linked host tab and compare the
repository source and command spelling exactly. Current Codex uses a repository
URL with `marketplace add`, then `plugin add`. Do not copy the older Qoder or
Cursor install examples when their local native help does not expose the same
contract; the lifecycle planner intentionally returns a manual or unavailable
result instead.

## Cursor source-local loading is unavailable

The checked native `cursor-agent` help does not advertise a supported
source-local plugin flag. Do not reuse historical launch commands or infer that
the presence of `.cursor-plugin/plugin.json` makes the source checkout loadable
by the current runtime.

Use `better-harness plugin status --host cursor --surface agent` to inspect the
bounded session evidence that is available. Until Cursor publishes a matching
native contract, Better Harness has no supported installation command to
troubleshoot; keep the lifecycle result `unavailable` instead of copying the
checkout into a global plugin directory.

## The standalone or source CLI reports an unsupported runtime

The standalone and source CLIs support Node.js `>=22.20.0 <25.0.0` and npm
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
