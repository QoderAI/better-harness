# Deepen Desktop evidence snapshots

## Traceability

- Spec ID: rust-evidence-host-snapshot-depth
- Status: Implemented
- Follows: `docs/specs/2026-09-08-rust-evidence-host-remaining-adapters.md`

## Intent

The remaining-adapter slice found every host, but several real Desktop
sessions still disappear or leak private text: compressed DSH artifacts, Pi
custom session directories, forked Pi transcripts that double-count a parent,
and retained prompts/tool detail that still carry credentials. Deepen the
existing snapshot — do not port the JS analyzers.

## Acceptance Scenarios

- **AC-1:** A workspace-qualified DSH `session.jsonl.zstd` is discovered when
  no uncompressed `session.jsonl` is present. Decode failure omits that
  artifact. Both files in one session directory are omitted as ambiguous.
- **AC-2:** Pi discovery honors `PI_CODING_AGENT_SESSION_DIR`, then
  `<workspace>/.pi/settings.json` `sessionDir`, then `<agent-dir>/settings.json`
  `sessionDir`, else the default `--<slug>--` tree. A custom directory is a
  flat JSONL folder still qualified by the session-header cwd.
- **AC-3:** When a Pi fork and its parent are both discovered, records stamped
  before the fork header are owned by the parent only.
- **AC-4:** Retained prompt, tool detail, tool output, and assistant text
  redact bearer tokens, `api_key`/`password`/`secret` assignments, and common
  `sk-`/`ghp-`/`glpat-`/`AKIA` prefixes. Structured `filePath` fields stay
  paths so Artifact observations still work.
- **AC-5:** When a record carries model or token fields, the snapshot keeps
  `models` and `tokenUsage` with non-negative observed numbers. Missing fields
  stay absent, not zero.
- **AC-6:** Tool results update the existing call by id (status, bounded
  output) instead of creating a second call.

## Non-goals

- DSH event-shape fail-closed validation, packed-row expansion, or Zstd
  frame-by-frame checksum scanning beyond what libzstd already decodes.
- JS `sanitizePrivateReviewText` path-to-`<path>` display rewriting.
- Encrypted reasoning, tool output sidecars, billing estimates, or replacing
  `scripts/session-analysis`.

## Plan and Tasks

1. Decode DSH `.jsonl.zstd` with the `zstd` crate; keep uncompressed JSONL.
2. Resolve Pi sessionDir in the same order as the JS adapter; probe forks.
3. Redact secrets in `bound_session_text` so every adapter shares one seam.
4. Extend `Snapshot` with usage/model observation and call-id result pairing.

## Test and Review Evidence

- `rustup run 1.96.0 cargo test`: 20 lib tests and 17 stdio-host tests passed,
  including DSH zstd, Pi custom sessionDir + fork cutoff, secret redaction with
  preserved `filePath`, usage fields, and tool-result pairing.
- Risk: libzstd decode of a torn DSH multi-frame file omits the session rather
  than partial replay. Pi `PI_CODING_AGENT_SESSION_DIR` is process-wide; tests
  use settings.json. Path-to-`<path>` display rewriting is still JS-only.
