# Pi native runtime completion

## Traceability

- Spec ID: `pi-native-runtime-completion`
- Status: Draft
- Story: Pi Agent and WorkBuddy plugin completion

## Intent

Turn the existing Pi package into a native Pi extension with one unambiguous
`/better-harness` command. The extension must run three fresh read-only Pi RPC
contexts, preserve lane isolation, and pass validated results to the current
Pi lead for reconciliation and HTML rendering.

## Acceptance Scenarios

- **PI-AC-01:** A clean `pi install` or `pi -e` run discovers exactly one
  `/better-harness` command and the canonical Skill.
- **PI-AC-02:** `host-doctor --platform pi` distinguishes missing Node, missing
  package resources, missing model/auth, current-session ambiguity, and an
  unwritable output root.
- **PI-AC-03:** The command launches three parallel RPC children with
  `--no-session`, `--no-tools`, `--no-extensions`, `--no-skills`,
  `--no-prompt-templates`, `--no-context-files`, and `--no-approve`; lane data
  travels over RPC stdin rather than process arguments.
- **PI-AC-04:** The current Pi session is excluded from evidence and cannot be
  reintroduced by a custom session directory.
- **PI-AC-05:** A real authorized model run creates and validates
  `findings.json`, `report.md`, and `report.html` under `.pi/better-harness`.
- **PI-AC-06:** Abort, timeout, malformed JSON, duplicate context, and single
  lane failure terminate all children and follow the shared quick/normal policy.
- **PI-AC-07:** Extension discovery and focused tests pass on Node 22.20, 24,
  and 25; the package engine range includes the supported Pi runtime.

## Non-goals

- No Pi-native MCP registry or theme inventory.
- No mutation tools in specialist children.
- No hand-written report renderer or Canvas output for Pi.
- No automatic access to user-home data without explicit scope.

## Plan and Tasks

1. Add `extensions/pi/better-harness.ts`, register it through `package.json`,
   and remove the Pi prompt-template collision while retaining the Skill.
2. Implement a subprocess adapter using Pi RPC JSONL, inherited provider/model
   selection, bounded stdin prompts, timeout/abort handling, and child cleanup.
3. Invoke the shared host runtime contract, then inject the validated lead and
   specialist results into the current Pi turn for reconciliation and renderer
   validation.
4. Add Pi discovery, command collision, fake-RPC, privacy, cancellation, and
   real-host smoke tests.

## Test and Review Evidence

- Isolated `pi list`/`pi --mode rpc` discovery evidence must show one command.
- Fake child tests must assert every safety flag and empty argv payload.
- Real E2E must record three distinct child identities and renderer `status:
  pass`; credentials and raw model output are not committed.
- Package verification must include the extension and peer dependency contract.

## Risk

Pi intentionally has no built-in sub-agent abstraction. Subprocess RPC is the
portable, auditable boundary, but Pi version drift can change RPC events; the
adapter must fail closed on unknown response shapes.
