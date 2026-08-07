# Automation Readiness Reference

Use this after `loop-discovery.md` selects automation, `schedule-ready`, or a
scheduled/background loop. This file does not create automations; it defines the
minimum contract before a report or skill recommends one.

## Readiness Gate

Recommend automation only when all fields are concrete:

1. **Target**: repository, path, issue, PR, report artifact, or external object.
2. **Trigger**: cadence, cron-like schedule, event, or one-time follow-up.
3. **Run scope**: standalone fresh run or thread-attached continuation.
4. **Execution location**: local checkout, background worktree, CI, or external
   host; name why this location is safe enough.
5. **Input pack**: exact command, prompt, report row, finding id, artifact,
   query, or MCP resource the run starts from.
6. **Sandbox**: read-only, restricted write, full access, or explicit human
   approval for side effects.
7. **Validation**: command, report quality check, CI result, review result,
   trace/eval comparison, or `needs more evidence` outcome.
8. **Triage path**: where findings land and who reviews them.
9. **Risk boundary**: files, systems, credentials, external writes, and
   destructive actions the automation must not touch without approval.
10. **Stop condition**: state, count, date, score, passing validation, repeated
    covered result, or human decision that ends the loop.

If any field is missing, return `needs more evidence` or recommend a one-time
manual follow-up instead of recurring automation.

For an executable, fail-closed decision on a concrete loop run level, hand the
declared capability observations to the gate described in
[readiness-gate.md](readiness-gate.md) (`better-harness loop readiness`).

## Automation Shapes

- **Standalone automation**: use when each run should start fresh from stable
  inputs and report findings into triage.
- **Thread automation**: use when the scheduled work must preserve the current
  conversation or approval context.
- **Background worktree**: use when the run may write files and must avoid
  unfinished local edits.
- **Local checkout**: use only when direct access to the current workspace is
  required and the write risk is acceptable.
- **CI/GitHub Action**: use when the loop is tied to repository events,
  protected checks, or branch policy.

## Output Addendum

For schedule-ready outcomes, fill these slots:

```text
Automation readiness: target=...; trigger=...; run scope=...; location=...;
input=...; sandbox=...; validation=...; triage=...; risk=...; stop=...
```

Do not call generic improvement advice automation-ready.
