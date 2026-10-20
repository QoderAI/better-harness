# Native Pi extension for Better Harness

## Traceability

- Spec ID: `pi-native-extension`
- Story: #123
- Status: Accepted

## Intent

Turn the existing Pi package (Skill + prompt template from #25) into a native Pi
extension owning one unambiguous `/better-harness` command. The extension runs
environment checks, spawns three isolated read-only RPC children for the three
evidence lanes, validates their returns, and injects the result into the
current Pi session for reconciliation and rendering. Orchestration is
Pi-private; evidence collection and report semantics stay in the canonical
`scripts/` tree.

## Decision: Host-Runtime Dependency

The #72 extension imported the shared host-runtime contract
(`hostDoctor`/`prepareHostRun`/`verifyHostRun`) introduced by that same PR, and
that contract is not on `main` and currently has no owner. Options:

- **A:** wait for lane 1 (the shared host-runtime contract) to land separately
  and build the extension on it.
- **B (confirmed):** implement the orchestration the Pi extension needs as
  Pi-private code inside `extensions/pi/`, calling existing `main` contracts
  (`scripts/` capability exports) for evidence collection and rendering. No
  shared contract is introduced and no part of lane 1's broader host-neutral
  scope is duplicated. Per-host implementation is the repository's existing
  pattern for providers, session platforms, and host-support profiles; if
  maintainers later land a shared contract, consolidating is their
  tested-migration decision, not a commitment of this spec.

Rejected alternative: driving the in-process SDK `AgentSession` instead of
spawning RPC subprocesses. Process-level isolation is harder and more auditable
(fake-child tests can assert every isolation flag directly), so subprocess RPC
stays the boundary.

[Confirmed by the maintainer on 2026-08-28 in the spec review
(<https://github.com/QoderAI/better-harness/pull/125#issuecomment-5450341625>):
Option B is accepted; there is no need to wait for the shared host runtime.
"Please keep the Pi extension limited to RPC orchestration and lifecycle
management, while reusing the canonical evidence, lane semantics, schema, and
rendering contracts."]

## Acceptance Scenarios

- **PI-AC-01 (single command):** A clean `pi install` or `pi -e` discovers
  exactly one `/better-harness` entry point plus the canonical Skill.
  `prompts/better-harness.md` is removed from Pi discovery so no duplicate or
  numbered-collision command can appear.
- **PI-AC-02 (fail closed):** A doctor pass distinguishes missing Node, missing
  package resources, missing model/auth, current-session ambiguity, and an
  unwritable output root, and refuses to run on failure.
- **PI-AC-03 (isolated lanes):** The command spawns three parallel RPC children
  with `--mode rpc --no-session --no-tools --no-extensions --no-skills
  --no-prompt-templates --no-context-files --no-approve` (flag set verified
  against pi 0.84.3). Lane data travels over RPC stdin, never argv. Children
  inherit the current provider and model.
- **PI-AC-04 (privacy):** The current Pi session is excluded from evidence and
  cannot be reintroduced through a custom session directory.
- **PI-AC-05 (durable output):** A real authorized run creates and validates
  `findings.json`, `report.md`, and `report.html` under
  `<target>/.pi/better-harness`.
- **PI-AC-06 (failure policy):** Abort, timeout, malformed JSON, duplicate lane
  identity, and single-lane failure terminate all children and follow the
  quick/normal policy: normal runs block on any unavailable or partial
  specialist; quick runs preserve the gap and lower confidence.
- **PI-AC-07 (RPC framing):** The JSONL reader splits on LF only. Node
  `readline` is prohibited: it also splits on U+2028/U+2029, which are valid
  inside JSON strings.
- **PI-AC-08 (smoke receipt):** A real interactive report-loop smoke on the
  better-harness repository itself is the completion gate for the
  implementation PR. The receipt is bounded facts: commands, versions, exit
  codes, artifact manifest with hashes, and renderer validation status. Raw
  transcripts, model output, and credentials are never committed. A second
  smoke on a real private project is additional evidence, not a substitute.

## Non-goals

- No shared host-runtime contract, no WorkBuddy, no generalized
  provider/reporting changes, no release metadata.
- No persistent `plugin plan/apply` lifecycle operations for Pi; those require
  separate native install/update/remove evidence.
- No MCP registry or theme inventory, no mutation tools in specialist
  children, no hand-written report renderer or Canvas output for Pi.
- No dependency on third-party extensions such as pi-subagents.

## Plan and Tasks

1. Add `extensions/pi/better-harness.ts`, register it through the
   `package.json` pi manifest, remove `prompts/better-harness.md` from Pi
   discovery, and keep the canonical Skill.
2. Implement the Pi-private orchestration: doctor, three-lane prepare with
   bounded input hashes, verify, and injection of validated results into the
   current Pi turn.
3. Implement the subprocess adapter: spawn with the isolation flags, LF-only
   JSONL framing, bounded stdin prompts, timeout (default 120s) and abort
   handling, and child cleanup.
4. Add focused tests: discovery, command collision, fake-RPC
   (timeout/abort/malformed JSON/duplicate lane), privacy, and package and
   discovery coverage.
5. Run the interactive smoke and attach the bounded receipt.

## Test and Review Evidence

- Discovery: isolated `pi list` / `pi --mode rpc` `get_commands` evidence shows
  exactly one command.
- Fake-child tests assert every isolation flag and that no lane data appears in
  argv.
- Real E2E records three distinct child identities and renderer
  `status: pass`.
- Package verification includes the extension file and the updated pi manifest.

## Risk

Pi RPC events can drift across versions; the adapter must fail closed on
unknown response shapes. Removing the prompt template is user-visible and
should be called out in the implementation PR description.
