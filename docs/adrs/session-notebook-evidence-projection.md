# Session notebook trace and outcome projection

## Status

Proposed

## Context

Harness Inspector projects privacy-filtered host events into a read-only Session
Notebook. The retained source can contain prompts, assistant messages, tool-call
requests, correlated commits, and partial timing. It does not necessarily retain
tool results, a patch snapshot, a final assistant response, or enough evidence to
prove that an edit or verification succeeded.

The initial notebook presentation treated the last retained assistant message as
the Turn result and independently grouped assistant messages and tool calls for
display. That made a visually tidy notebook, but it could move an intermediate
assistant message after later tool calls and could present an unfinished sentence
as `Out`. Deriving a diff from the current worktree would be worse: the worktree is
mutable, can contain unrelated user changes, and is not session-scoped evidence.

The Inspector and Harness Studio may share a notebook visual grammar, but their
authority differs. Inspector presents retained evidence and must remain read-only.
Studio owns checkpoint-backed execution and comparison through its existing
contracts.

## Decision

### Preserve one canonical Turn event order

The session-analysis projection owns the ordered Turn stream. Assistant messages
and tool requests enter that stream in observed source order after existing
deduplication and privacy filtering. Presentation code may collapse contiguous
tool-call runs, but it must not regroup all events by kind or otherwise reconstruct
chronology.

An assistant message is promoted from the ordered stream to the terminal response
only when it is the final retained event in the Turn. If a later tool request was
observed, the Turn is incomplete in retained evidence and the earlier assistant
message remains an intermediate response. Missing timestamps remain missing; the
projection does not manufacture exact times for assistant messages.

### Separate process, response, and outcome

`Process` is an ordered evidence trace:

- assistant messages render as privacy-filtered, sanitized Markdown;
- tool calls retain structured identity, operation, status, paths, and observed
  timing where available;
- compact grouping is limited to adjacent tool calls and preserves their order.

`Assistant response` is optional retained prose, not proof of success.

`Outcome` is an evidence-bounded summary of what the Turn retained. It may include
observed edit paths, verification calls, correlated commit statistics, and the
terminal assistant response. A code diff appears only when a session-scoped patch
or equivalent immutable artifact was captured by the report contract. Until that
artifact exists, the notebook states that the patch is unavailable and must not
substitute the current worktree diff.

### Keep the report boundary bounded and read-only

The report model carries explicit response availability and ordered steps into the
self-contained Inspector document. This is a private projection contract unless a
second external consumer requires versioned public ownership. Existing selection,
deep-link, privacy, and redaction boundaries remain authoritative.

Inspector does not gain Continue, Fork, rollback, checkpoint mutation, or replay
execution. Studio does not consume Inspector's dialogue projection merely to share
the notebook appearance.

## Consequences

- A Turn can end with `responseStatus: incomplete` even when an assistant message
  was retained earlier.
- Counts distinguish intermediate assistant responses, tool calls, and total
  retained process events instead of labeling tool calls as intermediate events.
- Process views become longer in highly interleaved sessions. The UI may collapse
  adjacent tool runs and keep Process closed by default, but ordering stays visible
  when expanded.
- Existing reports without the new status field remain readable through a
  conservative compatibility projection.
- A true code-diff output requires a later capture and schema decision; this ADR
  explicitly prevents a misleading worktree-derived shortcut.

## Validation gates

- Parser tests cover tool -> assistant -> tool order, terminal response promotion,
  deduplication, truncation, and incomplete Turns.
- Report-model tests assert ordered steps and explicit response availability.
- Browser verification checks sanitized Markdown, adjacent tool-run ordering,
  evidence-bounded Outcome copy, selection/deep links, and desktop/narrow controls.
- Privacy tests continue to prove that secrets and non-repository paths are not
  retained in the notebook projection.

## Traceability

- ADR ID: ADR-0006
- Decision date: 2026-08-18
- Spec: [Make session review and harness comparison read like a notebook](../specs/2026-08-18-notebook-session-and-studio.md)
