---
id: harness-inspector
title: Harness Inspector
sidebar_position: 3
---

# Harness Inspector

Harness Inspector is a local, read-only delivery provenance workbench. It brings
declared product intent, coding-agent sessions, normalized tool activity, Git
commits, and repository paths into one view without treating correlation as
proof of authorship or improvement.

Use it to answer three bounded questions:

1. What product intent, sessions, actions, files, and commits are visible?
2. Why does Inspector relate two objects, and how strong is that evidence?
3. What remains missing, inferred, or unsuitable for a stronger conclusion?

![Harness Inspector architecture: bounded local evidence is normalized, correlated with explicit limitations, and rendered as a self-contained read-only report](/img/harness-inspector-architecture-en.svg)

## How it works

1. **Choose a bounded local window.** The CLI limits the inspected providers,
   dates, session count, and commit count. An optional Feature Tree supplies
   reviewed Feature and Story intent.
2. **Collect independent evidence.** Session adapters read supported local
   coding-agent evidence; Git and Entire readers collect commit, file, and
   checkpoint facts. A missing provider remains an explicit gap.
3. **Normalize without widening the privacy boundary.** Inspector retains
   privacy-safe prompts, provider-neutral action labels, bounded tool details,
   observed timing, and repository-relative paths. Raw tool payloads, hidden
   reasoning, credentials, and absolute home paths do not enter the report.
4. **Build evidence-bounded relationships.** Reviewed references, explicit
   commit/session metadata, observed commit calls, exact path overlap, time, and
   retained text have different authority. Every relationship carries facts,
   a source, and a limitation.
5. **Render one self-contained report.** The output is an interactive HTML file
   that reads the projected evidence. It does not write Git metadata, rerun a
   tool, restore code, or resume a native coding-agent session.

## Reading the workbench

- **Capability** scopes the report by reviewed Feature and Story intent.
- **Date** keeps sessions and commits visible even when product mapping is
  absent or incomplete.
- **User prompts / Agent activity / Commits and files** are simultaneous lanes;
  one lane does not silently establish authorship in another.
- **Evidence Drawer** explains the selected relationship and its limitations.
- **Session Trace** shows retained turns, normalized actions, observed timing,
  idle gaps, files, and filters.
- **Replay** advances through retained evidence only. Sequence-only events stay
  labeled when an exact timestamp was not observed.

## Evidence vocabulary

| Label | What it supports | What it does not prove |
| --- | --- | --- |
| Explicit / direct | A retained reviewed reference or explicit metadata links the objects. | Every action or changed line contributed to the delivery. |
| Observed same-path | Exact repository-relative paths occur in both session and commit evidence. | The session authored the final committed contents. |
| Candidate | Structure, retained text, or timing suggests a useful association. | A reviewed task identity or causal relationship. |
| Contextual | Nearby date or path history helps explain the visible delivery window. | A direct session, Story, or commit link. |

Feature Tree selection and evidence confidence are separate. A Story can be a
useful navigation scope while its link to a session is still only a candidate.

## Generate a private Inspector

Run the shortest path inside the repository you want to inspect. `npx` downloads
or reuses the current package, renders the current workspace, and opens the
written report:

```bash
npx @qoder-ai/better-harness inspector
```

By default this opens the current workspace and includes activity from the
latest 30 UTC days, bounded to 200 commits and 100 hydrated sessions. Date lists
days with observed evidence rather than inventing empty-day activity. After
[installing Better Harness](../installation), or when you need explicit bounds,
the expanded form remains available:

```bash
better-harness harness-inspector render --workspace . --open
```

The default output is:

```text
.qoder/better-harness-runs/harness-inspector/inspector.html
```

Useful bounds include `--platform`, `--since`, `--until`, `--commits`, and
`--max-sessions`. `--platform all` discovers evidence across Qoder, Codex,
Claude Code, Cursor, Qwen Code, GitHub Copilot, Pi, Kimi Code, WorkBuddy, and
Grok, while preserving provider-specific gaps.

An optional `.better-harness/feature-tree.md` supplies reviewed intent:

```md
- [ ] Checkout reliability
  - [ ] Explain payment failure telemetry {#payment-failure-telemetry}
```

Two-space indentation declares the hierarchy. Internal nodes become Features;
leaf nodes become Stories. Stable `{#id}` anchors are recommended when another
artifact needs to reference a node.

## Boundaries

- Inspector is an observation surface, not a recovery or mutation authority.
- A tool call labeled `Run tests` proves that the call was observed; it does not
  by itself prove that a test suite passed.
- Shared paths and nearby timestamps support correlation, not authorship.
- Missing token, cost, outcome, base-commit, budget, or harness-revision
  evidence must remain unobserved instead of becoming zero or a clean result.

## Future evolution

The intended progression is **Inspect → Compare → Eval → Decision**.

- **Compare** should be a top-level workspace mode, not a third Capability or
  Date scope. Its first job is to assess whether two sessions are comparable.
- The first credible slice is Story-scoped observational trajectory comparison:
  align provider-neutral actions, show neutral deltas and confounders, and make
  `insufficient evidence` a normal result. Sharing a Story is a discovery aid,
  not proof of equivalent tasks.
- Stronger improvement or regression verdicts belong to later Eval evidence:
  bound harness revisions, controlled treatment, objective outcomes, compatible
  budgets, repeated trials, or held-out/later-comparable cohorts.
- Decision support may then retain, narrow, revise, or revert an intervention;
  Inspector Compare alone must not manufacture that authority.
