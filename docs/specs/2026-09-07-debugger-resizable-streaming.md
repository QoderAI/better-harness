# Resize Debugger panes and share streamed messages

## Traceability
- Spec ID: debugger-resizable-streaming
- Status: Draft

## Intent
Remove the two pane visibility commands, tighten tree disclosure spacing, resize
all three panes through two boundaries, and prove incremental activity display.

## Acceptance Scenarios
- AC-1: The title bar has no Execution Tree or Inspector visibility toggles.
- AC-2: Tree disclosure uses one compact target and reduced indentation; no fake
  expandable live rows with handlers that do nothing.
- AC-3: Both pane boundaries support pointer drag, Left/Right, Home/End, and
  double-click reset; panes remain bounded as the container changes size.
  Narrow layouts stack the activity, tree, and inspector with local overflow.
- AC-4: Debugger and Compare render assistant messages through one shared
  component using the existing shared streaming hook. A partial reply is visible
  before a second gated chunk and before run completion.
- AC-5: Browser tests cover resizing, incremental text, focus, bounded overflow,
  and screenshots at wide, compact, and narrow sizes.

## Non-goals
New ACP protocols, fabricated reasoning events, or changes to Compare's separate
layout redesign. Preserve that concurrent work.

## Plan and Tasks
Own layout in ResizableDebuggerPanes; remove collapsed-pane state and CSS.
Extract StreamingMessage, keep surface-specific tool presentation, and use a
controlled ACP fixture to verify visible deltas before completion.

## Test and Review Evidence
Pending builds, targeted browser/native tests, and documentation checks.
AI involvement: Codex. No external Story or commit requested.
