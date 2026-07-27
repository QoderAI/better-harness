# Session Insights Report

## Contract

Generate user insights in four stages:

1. **Evidence extraction**: build bounded evidence from JSONL, audit logs,
   config, skills, hooks, permissions, validations, and bounded transcript
   metadata.
2. **Insight pack**: convert `facets` into compact cards and signals such as
   source coverage, validation behavior, repeated friction, observed hooks, tool
   mix, hook-command/script attribution, `longSessions`, action candidates, and
   coverage gaps.
3. **Analysis and review**: write the insights report from the insight pack,
   then review that report against the same bounded evidence for overclaims,
   missing scope, and cross-tool leakage.
4. **Revision and quality gate**: apply the review, then verify the report meets
   the quality bar below before presenting it as final.

Do not call a metrics report or static inspection output a user insights report.
The report must explain how the user's workflow should change.

Default to one final report per tool. Do not merge Qoder, Codex, and Claude Code
into one report unless the user explicitly requests a comparison or synthesis.
For explicit long-session, token/credit, model-choice, or usage-efficiency
questions, load [Session Usage Efficiency](session-usage-efficiency.md) and run
the full deterministic census before any semantic candidate review.

## Evidence Handoff

Complete source discovery and bounded evidence collection through
[Sessions Diagnostics](sessions-diagnostics.md). This reference starts from its
scoped `facets` and `insights` outputs; it does not own or repeat the analyzer
command ladder. Neither output is the final user report. If the source probe
fails, returns no enabled roots, or the insight pack is sampled, report that
scope and downgrade confidence instead of filling gaps from global assumptions.

When hook events are prominent, prefer `facets.topHookCommands` or
`insights.keySignals.topHookCommands` over `topHooks` alone. These values name
the observed hook event plus sanitized command/script target, not full raw
commands. If a high-frequency hook has no command attribution, say so and open a
bounded event sample only when that detail affects the recommendation. Static
hook config or asset inventory can provide configured candidates, but not
observed command attribution.

Use exact confidence labels `Low`, `Medium`, or `High`.
Sampled session facets default to Low or Medium confidence unless proven representative.
Do not write `Moderate`.
Use `High` only when the run inspected the full intended session set or the
sampling boundary is explicitly representative for the claim.
Do not render `sourceCoverage` counts as percentages unless the analyzer
explicitly returns a percentage field.
Use `insights.keySignals.longSessions` for session complexity claims. Active
long sessions and wall-span long sessions are separate signals: active-long
duration produces an outcome-review candidate, while wall-span-only sessions
are idle/resume evidence. Neither duration signal by itself recommends
subagents, Custom Agents, Experts, tooling changes, or a different model.

## Long Session Review Heuristic

Use this sequence before deciding whether any improvement is needed:

1. Compare `longSessions.longActiveCount`, `longWallCount`, `wallOnlyCount`,
   and `longActiveRatio`. Treat active estimates as work evidence; treat
   wall-span-only rows as idle/resume evidence.
2. Inspect representative active-long rows only enough to review task family,
   outcome, and friction; keep raw ids and excerpts private.
3. Treat unreviewed rows as investigation leads, not findings. If review shows
   a normal successful long task, close the lead without an improvement.
4. Recommend subagents or Experts only when reviewed active-long sessions
   repeat and the work has separable roles such as research, implementation,
   verification, specialist review, or risk analysis.
5. Use Loop Discovery before suggesting a durable Custom Agent, Skill-backed
   review loop, or other owner.

## Report Quality Bar

A good user insights report must:

- Lead with the behavior change the user should make.
- Cover exactly one selected tool unless the user explicitly asked for a mixed
  comparison.
- Use insight cards, not a metric dump.
- Tie every insight to evidence and confidence.
- Name metric scope explicitly: workspace-only, platform-wide, all-workspace, or
  global. Every final insight card must include `Scope`.
- Keep candidate findings as candidate/likely unless file content was manually
  inspected.
- Mark inferred mechanisms as likely. For example, high `sed` counts plus zero
  tracked edits can imply bash-based editing, but the exact flag or command
  shape still needs trace evidence.
- For a single-tool report, describe that tool's usage and quality without
  ranking it against other tools.
- For an explicit mixed report, distinguish platform role from platform quality.
  For example, Codex may be used for implementation while Qoder may be used for
  plugin/runtime checks.
- Separate installed skill files, loaded/activated skill signals, and `Skill`
  tool-call counts. Loaded skill prompts prove context injection, not tool
  invocation.
- Separate configured hooks from observed hook enforcement.
- For important observed hook counters, name the hook command/script target when
  the analyzer provides it; otherwise mark command/script attribution as
  unavailable instead of guessing from static config.
- Separate validation command existence from validation-after-edit behavior. Use
  `insights.keySignals.validationAfterEdit` to decide whether the bounded sample
  shows edit events followed by validation commands, edit events without later
  validation, validation without edits, or no observed edits.
- For long-session reports, name the active-vs-wall boundary. Recommend
  subagents or Experts only from repeated active long-session evidence, and
  route durable role creation through Loop Discovery before suggesting a Custom
  Agent or Skill.
- For Qoder Read failures, separate path/tooling failures from model-quality
  claims. Recommend a stronger model only when model attribution has comparable
  per-model Read samples; otherwise recommend a controlled model A/B test and
  Read failure path logging.
- For usage reports, prefer workspace-scoped evidence. Treat global audit
  coverage as context only, not as proof of current workspace behavior.
- Treat user feedback in the conversation as first-class evidence when it is
  included as a bounded artifact.
- Keep static-only and sampled evidence explicit.
