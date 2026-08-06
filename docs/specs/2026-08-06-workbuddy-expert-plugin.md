# WorkBuddy expert plugin

## Traceability

- Spec ID: `workbuddy-expert-plugin`
- Status: Draft
- Story: Pi Agent and WorkBuddy plugin completion

## Intent

Ship Better Harness as a WorkBuddy Marketplace-compatible Team plugin while
retaining the repository root as the canonical runtime root. The Team lead owns
one evidence collection and reconciliation; three named members independently
review the three bounded evidence lanes and return structured results.

## Acceptance Scenarios

- **WB-AC-01:** `.codebuddy-plugin/plugin.json`, Marketplace metadata, root
  `settings.json`, four Agent MD files, and the canonical Skill form a valid
  Team plugin with `categoryId: 10-ProjectQuality`.
- **WB-AC-02:** `codebuddy --plugin-dir .` discovers the Team and all three
  members from an empty WorkBuddy config root without copying only the Skill.
- **WB-AC-03:** A real Team run contains exactly one TeamCreate, three distinct
  members, and three independent SendMessage returns; no member delegates.
- **WB-AC-04:** The lead runs `prepare-run --platform workbuddy` once, passes
  only each member's lane envelope and input hash, verifies the returns, and
  renders only after reconciliation.
- **WB-AC-05:** `CODEBUDDY_SESSION_ID` is preferred for current-session
  exclusion; legacy `WORKBUDDY_SESSION_ID` is accepted, and conflicting values
  block the run.
- **WB-AC-06:** A real authorized run validates the three HTML artifacts under
  `.workbuddy/better-harness`; quick/normal failure behavior matches HRC.
- **WB-AC-07:** Official expert validation, Marketplace manifest validation,
  archive inspection, and cross-platform path/process smoke pass.
- **WB-AC-08:** The package contains no user configuration, transcript, secret,
  cache, symlink escape, or absolute local path.

## Non-goals

- No WorkBuddy binary database parser or automatic connector activation.
- No second copy of Better Harness judgment logic.
- No remote Marketplace registration or public release submission.

## Plan and Tasks

1. Add `.codebuddy-plugin/plugin.json`, `.codebuddy-plugin/marketplace.json`,
   root `settings.json`, role Agent MD files, and marketplace-safe avatars.
2. Register the canonical `skills/better-harness` path and document the Team
   SOP: one lead collection, one TeamCreate, three parallel members, one
   verification and one render.
3. Add local package/archive generation and a manifest/version/content validator
   that rejects private files, absolute paths, symlinks, and missing resources.
4. Add WorkBuddy fixture tests and an authorized real-host smoke using an
   isolated `WORKBUDDY_CONFIG_DIR`.

## Test and Review Evidence

- Manifest tests must cover required Team fields, exactly three members,
  `defaultInitPrompt` equality, three tags, and version synchronization.
- Archive tests must unpack into an empty directory and verify the root runtime
  resources referenced by `skills/better-harness/SKILL.md`.
- Real WorkBuddy smoke must retain only bounded counts, event types, agent IDs,
  hashes, and renderer status; raw transcripts remain private and temporary.

## Risk

WorkBuddy's Team workflow is host-owned and may change independently of the
plugin manifest. The Agent prompts and validator must treat missing Team events
as a failed runtime contract rather than a successful single-agent fallback.
