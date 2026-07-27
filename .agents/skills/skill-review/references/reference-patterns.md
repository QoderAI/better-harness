# Reference Patterns

Use these patterns as review lenses, not mandatory sections for every skill.
Recommend one only when it matches the skill's failure mode, workflow risk, or
output contract.

## Trigger / Protocol Split

Keep frontmatter `description` focused on observable trigger conditions. Put the
execution protocol in the body so agents load the full skill before acting.

Example: `description: Use when encountering any bug, test failure, or
unexpected behavior, before proposing fixes`; body owns the debugging phases.

## Iron Law + Rationalization Firewall

Use for discipline skills where an agent may knowingly skip the rule under
pressure. Pair a non-negotiable rule with no-exception wording, common excuses,
and red flags.

Example: `NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE`, followed by
a table mapping "should work now" to "run the verification".

## Step 0 State Detection

Start operational skills by detecting the current state before creating,
deleting, delegating, or validating anything. This prevents duplicate setup and
wrong-environment actions.

Example: before creating a worktree, inspect `git rev-parse --git-dir`,
`git rev-parse --git-common-dir`, current branch, and submodule state.

## Gate Function

Turn important claims into a small evidence gate: identify what proves the
claim, run the current command, read the output, then state only what the
evidence supports.

Example: before saying tests pass, run the full relevant test command, inspect
exit status and failures, then report the command and result.

## Finite-State Workflow

Model complex workflows as ordered phases with entry criteria, exit criteria,
and stop/loop-back behavior. Avoid unordered advice when sequence matters.

Example: debugging moves through investigation, pattern analysis, hypothesis
testing, and implementation; a failed fix loops back instead of piling on
another guess.

## Controller / Implementer / Reviewer Protocol

For multi-agent workflows, define the controller role, subagent roles, handoff
artifacts, status values, and who owns final consistency.

Example: implementer returns `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or
`NEEDS_CONTEXT` plus a report file; reviewer reads the task brief, report, and
diff package before returning a verdict.

## Review Calibration Contract

Reviewer prompts should constrain scope, evidence, severity, and output shape.
This keeps reviews from becoming generic advice or broad codebase crawls.

Example: reviewer is read-only, diff-scoped, does not trust the implementer
report, categorizes findings by severity, and starts with a spec-compliance
verdict.

## Pressure Scenario Testing

Validate behavior-changing skills by first observing baseline failure without
the skill, then retesting with the skill under realistic pressure.

Example: combine time pressure, sunk cost, authority, and explicit options such
as "delete and restart with TDD" versus "commit now, test later".

## Output Contract Slots

For plans, reports, reviews, and templates, prefer required slots over prose
reminders. Slots make omissions visible and parser-sensitive fields stable.

Example: a task plan requires `Files`, `Interfaces`, exact steps, commands,
expected output, and a self-review check; `TODO`, `TBD`, and "similar to above"
are invalid.

## Exact Option Menu

When the next step requires a user decision, present a fixed menu tied to
concrete follow-up behavior instead of an open-ended "what next?" prompt.

Example: after branch work, offer exactly merge locally, push and create PR,
keep as-is, or discard; detached HEAD removes the local-merge option.
