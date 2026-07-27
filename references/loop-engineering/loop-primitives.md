# Loop Primitives Reference

Use this after `loop-discovery.md` proves a loop candidate but the durable
building blocks are still unclear. Keep the decision owner-focused: primitives
are ingredients, not answers by themselves.

## Primitive Map

| Primitive | Use when | Better Harness owner |
|---|---|---|
| Automation | The trigger is scheduled or event-like and each run can start from stable input | `automation-readiness.md`, then host automation |
| Worktree | More than one agent or run may write files, or background work must not touch active local edits | Git/worktree policy plus selected loop owner |
| Skill | The durable asset is procedural knowledge, examples, references, scripts, or validation steps | `../agent-customize/skill-discovery.md` |
| Plugin / Connector | The loop must be installed across repos or access external systems | Plugin packaging or MCP-backed access after an owner exists |
| Subagent | Independent exploration, maker/checker review, or parallel evidence collection is valuable | Custom Agent/Subagent route |
| State | The loop spans turns, days, runs, worktrees, or external systems | `loop-state-ledger.md` |

## Selection Rules

- Prefer one primary owner and only the primitives needed to make it reliable.
- Use automation for the heartbeat, not for broad judgment.
- Use worktrees when file isolation is the main risk; do not use them as a
  substitute for review.
- Use Skills for reusable procedure; do not use them as runtime memory,
  scheduling, approval, or tracing infrastructure.
- Use plugins only after the canonical Skill, hook, script, agent, or reference
  is stable enough to distribute.
- Use MCP/connectors as access layers. The workflow owner still needs trigger,
  input, validation, stop, and safety contracts.
- Use subagents when the split improves evidence quality, not merely to make a
  task sound more autonomous.
- Use state ledgers when the next run must know what already happened.

## Output Addendum

When Loop Discovery needs primitive detail, add this compact line to the result:

```text
Primitives: primary=<owner>; support=<automation|worktree|skill|plugin|connector|subagent|state>; why=<one sentence>
```

If no primitive is needed beyond the selected owner, say so explicitly.
