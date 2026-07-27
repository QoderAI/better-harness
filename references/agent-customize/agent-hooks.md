# Agent Lifecycle Hooks

Use this reference when coding-agent runtime hooks are in scope: Qoder hooks,
Codex hooks, Claude Code hooks, Cursor hooks, or similar agent lifecycle
callbacks. For Git commit and push hooks, use
`../project-harness/git-hooks.md`.

For an explicit customization cleanup, duplicate-registration review, failure
diagnosis, or latency budget, first use
[Hook Configuration And Performance Review](hooks-review.md); return here only
after the remediation form and lifecycle owner are clear.

## Core Idea

Treat agent hooks as the deterministic constraint layer around an agent loop,
not as another prompt. Prompts, Rules, `AGENTS.md`, Skills, and references guide
the model. Hooks run at lifecycle points to block, approve, log, validate, or
inject bounded context.

The durable ownership split is:

- **Rules / AGENTS.md**: explain stable project facts and soft constraints.
- **Permissions / Sandbox**: set hard access boundaries.
- **Hooks**: inspect lifecycle events and enforce deterministic decisions.
- **Skills**: describe the safe workflow, remediation, or exception process.
- **Scripts**: own parsing, policy checks, formatting, and validation logic.
- **CI / policy services**: rerun critical checks and provide final backstop.

Do not put broad workflow prose inside hook wrappers. A hook should call a
stable script or policy service and return a narrow allow, deny, ask, feedback,
or context result.

## Lifecycle Strategy

| Lifecycle point | Typical names | Good use | Avoid |
|---|---|---|---|
| Prompt submit | `UserPromptSubmit`, `beforeSubmitPrompt` | secret, customer-data, environment, and prompt-shape screening | rewriting the whole user request |
| Before tool use | `PreToolUse`, `beforeShellExecution`, `beforeMCPExecution`, permission events | block destructive commands, protected paths, risky MCP calls, external-state writes, unknown package installs | broad auto-allow matchers |
| After tool use or file edit | `PostToolUse`, `afterFileEdit`, failure events | formatting, linting, dependency scans, advisory feedback, structured logging | relying on post hooks to undo side effects |
| Stop or handoff | `Stop`, `SubagentStop`, handoff gates | verify tests, required evidence, protected-file review, generated-artifact checks | blocking without a clear next command or fix path |
| Session start or resume | `SessionStart`, compact/resume hooks | inject current branch, workspace, issue, test command, and policy context | loading long static docs on every session |

Use the earliest lifecycle point that can make the decision safely. Pre hooks
are for blocking or approval. Post hooks are for observation, repair feedback,
and validation after a change. Stop hooks are for final readiness gates.

## Session-To-Hook Promotion

Do not add broad hooks from theory alone. Promote repeated session evidence into
hooks through this loop:

```text
session log -> normalized events -> recurring risk pattern -> earliest safe
lifecycle point -> fixture replay -> log-only/warn/ask/block
```

Use `log-only` or advisory output for noisy quality signals. Use `ask` or
`block` only when the signal is deterministic, the false-positive cost is
acceptable, and the message gives the next safe action.

## Secret Guard Pattern

Secrets need layered hooks because leakage can happen before the model, during a
tool call, or in a written diff:

- `UserPromptSubmit`: block likely keys, tokens, passwords, private keys, and
  credential dumps before the model sees them.
- `PreToolUse`: block credential-file reads, environment dumps, raw kubeconfig
  output, and commands containing literal secrets.
- `PostToolUse` or `Stop`: scan changed files or diffs before continuation,
  commit, handoff, or final response.
- Session/audit output: store redacted metadata only; never store raw prompt,
  command, transcript, secret value, or unredacted tool output.

Never send a suspected secret to another LLM for classification. Use a
deterministic scanner and print only a rule id, severity, hash/fingerprint, or
redacted preview.

Better Harness provides a copyable starting point:

```bash
node scripts/agent-guardrails/install-secret-guard.mjs --target <project> --platform <qoder|codex>
```

This installer copies `scripts/agent-guardrails/secret-scan.mjs` into the target
project and merges `UserPromptSubmit` plus `PreToolUse` hook configuration. Its
platform registry owns Qoder/Codex config paths, hook event contracts, generated
commands, and runtime block payloads; `--host` remains a compatibility alias.
Use `--check --json` to detect copied-runtime or hook-config drift without writing
files. Use it as an AI Fix when session analysis finds user-pasted credentials,
agent-initiated credential reads, or absent secret hook coverage.

## Implementation Contract

- Prefer deterministic command hooks or local scripts for stable policies.
  Use LLM/prompt hooks only for judgment-heavy advisory work.
- Keep matchers narrow by tool, command family, path, event type, or host.
- Normalize host event payloads into an internal schema before applying policy:
  `event`, `tool`, `cwd`, `path`, `commandHash`, `decision`, `reasonCode`,
  `durationMs`, `exitCode`, and `sessionId`.
- Render host-specific output at the edge; do not duplicate policy per host.
- Log structured metadata by default, not raw prompts, secrets, environment
  variables, command output, file contents, or private transcripts.
- Make denial messages short and actionable: name the policy, blocked target,
  and smallest safe next step.
- Validate hooks with fixture JSON, unit tests for the policy module, and at
  least one real host event sample before claiming runtime enforcement.

For cross-platform repositories, prefer Node.js or Python entrypoints over
shell-only scripts. Resolve paths from the repository root, handle Windows path
separators, quote shell arguments when a shell is unavoidable, and avoid host
commands that only exist on one operating system.

## Security And Trust Rules

Treat hook input as untrusted external data. Validate event shape, clean command
strings before display, reject path traversal, resolve symlinks when path policy
matters, and skip sensitive files such as `.env`, credentials, tokens, private
keys, and VCS internals.

A pre-tool hook is not a complete security boundary by itself. Pair it with
host permissions, sandbox policy, CI, branch protection, or central policy
services when the risk involves credentials, production systems, destructive
commands, external writes, or release actions.

Review hook configuration like executable code. Any project-level hook config,
managed hook, central policy wrapper, or host trust file should have a clear
owner, review path, and drift check. If a host requires hook trust review, treat
that review as part of the release process.

## Evidence Rules

Separate these evidence levels in reports and readiness reviews:

- **Configured**: hook settings or wrapper files exist.
- **Policy content**: the script or policy logic was inspected.
- **Tested**: fixture tests or unit tests exercise the policy.
- **Observed**: a real host event sample shows the hook ran.
- **Backstopped**: CI, branch protection, sandbox, or policy service also
  enforces the same critical rule.

Do not claim enforcement from static configuration alone. Static config plus
no event sample is a presence/content signal, not runtime proof.

## Host Notes

- **Qoder**: use `platforms/qoder.md` for Qoder event names, matchers, stdin
  JSON shape, exit-code behavior, and official examples.
- **Codex**: account for hook review/trust behavior and keep non-managed hook
  changes reviewable. Do not rely on pre-tool hooks as the only boundary.
- **Claude Code**: command hooks are powerful because they execute with local
  user privileges; narrow matchers and strict input/path validation matter.
- **Cursor**: verify which runtime actually emits the lifecycle event before
  claiming coverage; IDE, CLI, and cloud behavior can differ.

## Review Checklist

- The policy is deterministic, narrow, and tied to a lifecycle point.
- The hook calls a stable script or central policy service.
- The same critical rule has a CI, sandbox, permission, or policy backstop when
  the risk is high.
- The implementation is cross-platform or explicitly host-scoped.
- The failure message tells an agent what to run, inspect, or ask next.
- Tests cover allow, deny, malformed input, protected paths, and sensitive-file
  cases.
- Reports separate configured hooks, inspected content, tests, observed runtime,
  and backstop evidence.

## External Anchors

These sources are background. Local Better Harness routing and repository tests win
when they disagree.

- OpenAI Codex hooks documentation: https://developers.openai.com/codex/hooks
- Claude Code hooks documentation: https://code.claude.com/docs/en/hooks
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Cursor hooks security/platform blog: https://cursor.com/blog/hooks-partners
- Qoder hooks documentation: https://docs.qoder.com/extensions/hooks
