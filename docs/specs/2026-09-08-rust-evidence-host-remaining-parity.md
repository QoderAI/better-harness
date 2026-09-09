# Finish remaining Desktop snapshot parity

## Traceability

- Spec ID: rust-evidence-host-remaining-parity
- Status: Implemented
- Follows: `docs/specs/2026-09-08-rust-evidence-host-snapshot-depth.md`

## Intent

Move the last Desktop-visible JS snapshot behaviors into the Rust host:
packed DSH rows, injected-context stripping, and path/`<id>` rewriting in
retained text. Keep structured `filePath` as real paths. Do not port the DSH
fail-closed validator or interpret encrypted reasoning.

## Acceptance Scenarios

- **AC-1:** A DSH `text-chunks` row becomes one assistant excerpt. A
  `tool-call-chunks` row becomes one tool call whose joined `args` parse as
  JSON when valid. `reasoning-chunks` are omitted.
- **AC-2:** A malformed packed row is omitted; discovery of the rest of that
  session continues.
- **AC-3:** Prompt text that is only injected context (`<environment_context>`,
  `# AGENTS.md instructions`) is dropped. A real request after a `My request:`
  marker is kept.
- **AC-4:** Retained prompt/detail/output/assistant text rewrites POSIX
  `/Users|/home|/var|/private|/tmp|/opt` paths, Windows drive paths, relative
  `dir/file` paths, and UUID-shaped ids to `<path>` / `<id>`. Structured
  `filePath` fields are unchanged.
- **AC-5:** Existing host fixtures still pass.

## Non-goals

- Porting DSH's event-shape fail-closed validator, packed-row exactKeys
  enforcement, or custom Zstd frame scanner.
- Interpreting encrypted reasoning or opening tool-output sidecar files (JS
  session-analysis does not open sidecars either).
- Replacing `scripts/session-analysis` as the CLI owner.

## Plan and Tasks

1. Fold packed DSH rows in `dsh.rs` before the existing event match.
2. Extend `privacy.rs` with injected-context strip, markdown image/link
   collapse, path/`<id>` rewrite; keep calling it from `bound_session_text`
   and `Snapshot::finish`.

## Test and Review Evidence

- `rustup run 1.96.0 cargo test`: 20 lib tests and 18 stdio-host tests passed,
  including packed DSH rows, path/`<id>` rewrite, and injected-context strip.
- Risk: path rewrite in prompt text can hide a relative path the reader would
  have recognized; Artifact observations still use `filePath`. The DSH
  fail-closed validator is still JS-only.
