# Normalize Qoder dialogue before Inspector renders it

## Traceability

- Spec ID: inspector-qoder-dialogue-normalization
- Status: Implemented
- Extends the Qoder evidence path used by
  [Harness Inspector](2026-08-12-harness-inspector.md).

## Intent

Qoder transcript rows store assistant content as structured arrays containing
`thinking`, `text`, and `tool_use` items. The provider currently serializes the
whole assistant message object when it cannot find a top-level string. Session
Detail consequently renders raw `role/content/input` JSON as an intermediate
response, even though the same tool request is already normalized into the Tool
calls lane.

Qoder must project structured message items into provider-neutral dialogue
before Inspector receives them. Readers should see readable retained assistant
text and structured tool calls, never transport JSON duplicated as prose.

## Acceptance Scenarios

- AC-1: A Qoder assistant `thinking` item becomes readable intermediate text,
  without the surrounding `role`, `content`, or item-type JSON envelope.
- AC-2: Qoder `text` and `output_text` items retain their text in the normalized
  assistant event and Session Detail response flow.
- AC-3: A `tool_use`-only assistant row contributes its structured tool request
  event but no assistant prose, raw tool input, or serialized JSON note.
- AC-4: Mixed assistant content preserves textual item order while tool items
  remain exclusively in the structured tool lifecycle.
- AC-5: Malformed or unknown structured items do not make the provider throw and
  do not fall back to serializing the transport object.
- AC-6: Existing Qoder user prompts, tool request/result pairing, file
  attribution, redaction, and cross-provider dialogue behavior remain intact.

## Non-goals

- Parsing Qoder transport JSON in Inspector UI code.
- Rendering raw tool inputs, tool results, credentials, or absolute paths as
  assistant prose.
- Changing Qoder's native session files or resuming a session.
- Reclassifying provider-neutral tool names or evidence confidence.

## Plan and Tasks

1. Replace the Qoder provider's object-level `JSON.stringify` fallback with a
   structured message-text projector.
2. Recognize retained `thinking`, `text`, and `output_text` strings; ignore
   `tool_use`, `tool_result`, and unknown structured objects in dialogue text.
3. Add provider tests for thinking, text, tool-only, mixed, and unknown items.
4. Run Qoder session normalization, commit/session dialogue, Inspector, and
   package-boundary regression checks.

## Test and Review Evidence

- AC-1..AC-5: focused tests in `test/sessions/session-analysis.test.mjs` inspect
  normalized events rather than matching provider source text.
- AC-3/AC-6: the existing Qoder transcript tool lifecycle test must still pair
  `tool_use` and `tool_result` with observed latency.
- Dialogue regression: `test/sessions/commit-session-link.test.mjs` and
  `test/reporting/harness-inspector.test.mjs`.
- Real-file smoke: render the workspace session shown in the reported defect
  and verify Session Detail contains no serialized assistant envelope.
- Real-file result: a 40-session Qoder report retained readable intermediate
  text for the reported session with zero raw assistant envelopes; the browser
  Session Detail showed the readable rows, no `role`/`tool_use` JSON, and no
  console warning or error.
- Full regression: `npm run check` passed 94 files / 1324 tests, followed by
  package verification of 521 npm entries and 543 runtime-zip entries.

## Risks

- Content loss: an unrecognized future Qoder textual item could be omitted. The
  projector accepts conservative string/text fields while refusing object
  serialization, and fixtures pin known variants.
- Privacy: thinking text is retained only as the provider's existing bounded
  intermediate dialogue projection; tool input and result objects remain out of
  assistant prose and continue through existing redaction/tool seams.
- Duplicate evidence: the parent assistant event and embedded lifecycle events
  share a source row. Only the lifecycle events may carry tool facts.
