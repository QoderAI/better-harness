# Loop State Ledger Reference

Use this when a loop may pause, resume, recur, run in the background, span
worktrees, or hand off between agents. The state ledger is the durable memory of
the loop; it is not raw transcript storage.

## When State Is Required

Require a ledger when any condition is true:

- The next run must know what was already tried.
- A schedule or background worker may run without the original conversation.
- Multiple agents, worktrees, or external systems share one loop.
- A human can approve, reject, edit, or defer a side effect.
- The loop compares results across runs, scores, findings, traces, or evals.
- The stop condition depends on previous outcomes.

If the loop is purely stateless, say what fresh input fully determines each run.

## Ledger Locations

Choose the smallest durable location:

| Location | Use when | Avoid when |
|---|---|---|
| Markdown note | Human-readable triage, plans, or next steps are enough | Machine replay or concurrent writes are required |
| Run directory | Reports, validation output, screenshots, or generated artifacts need evidence | The loop only needs one current status |
| JSON sidecar | A script or validator must consume the state | Humans must edit it frequently |
| Issue / PR / tracker | The loop is tied to external review, ownership, or status | External access is unavailable or unverified |
| Memory | A reusable lesson or preference is explicit and safe to persist | It contains raw transcripts, secrets, or one-off state |

## Ledger Fields

Use only fields the next run needs:

- loop id or finding id
- target path, repo, issue, PR, or artifact
- owner and supporting primitives
- trigger and cadence
- current status: open, paused, covered, blocked, skipped, or done
- last run time and evidence refs
- actions attempted and validation result
- risk boundary and approval status
- next input or next command
- stop condition and stop evidence

## Privacy And Safety

- Store references to evidence instead of raw private transcripts.
- Redact secrets, tokens, credentials, customer data, and private tool output.
- Keep approvals as decisions and reason codes, not long copied discussions.
- Treat external tracker state as unverified unless opened or provided.
- Keep generated state out of source control unless the repo intentionally
  tracks that artifact.

## Output Addendum

When state is required, add:

```text
State ledger: location=...; fields=...; update rule=...; privacy boundary=...;
resume input=...; stop evidence=...
```
