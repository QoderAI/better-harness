# Route Better Harness recommendations by user support stage

## Traceability

- Spec ID: better-harness-user-support-tracks
- Status: Implemented
- Builds on: [Align Better Harness evidence domains](2026-07-24-better-harness-evidence-domain-alignment.md)

## Intent

Keep Better Harness scoring and finding eligibility evidence-bound while adapting
the final recommendation style to the user's next operating stage. Add three
flat, conditionally loaded Skill references for Bootstrap, Operationalize, and
Optimize guidance. Keep the root Skill responsible only for selecting one track
after findings and dimension scores are frozen.

Treat `0 -> 1`, `1 -> 60`, and `60 -> 100` as user-journey labels, not score
bands. A high or low score alone must never select a track.

## Acceptance Scenarios

- BHST-AC-1: `skills/better-harness/SKILL.md` selects exactly one primary
  support track after findings and dimension scores are frozen, or reports the
  track as undetermined when required evidence is unavailable.
- BHST-AC-2: Bootstrap guidance combines authorized project facts, Agent
  Customize evidence, and user configuration to propose the smallest useful
  `AGENTS.md`, Rules, validation, or risk-boundary artifact without inventing
  commands or gaining mutation authority.
- BHST-AC-3: Operationalize guidance converts supported present-but-not-wired or
  wired-but-not-exercised gaps into observable priority moves, concrete durable
  owners, and verification or recovery boundaries.
- BHST-AC-4: Optimize guidance requires comparable Session Episodes before
  recommending workflow or asset changes, prefers built-in and existing owners
  before extension or creation, and requires later outcomes before claiming
  effectiveness.
- BHST-AC-5: The three references stay flat and link directly from `SKILL.md`.
  Only the selected reference is loaded; no new score, finding, report field,
  specialist lane, delegated agent, or runtime command is introduced.
- BHST-AC-6: Each track links to a repository case study that calibrates its
  advice, and focused tests verify routing, evidence gates, file budgets, and
  Markdown link integrity.

## Non-goals

- Recalibrating Agent Work Loop scores or interpreting score ranges as maturity.
- Treating missing `AGENTS.md`, Rules, Skills, Hooks, Memory, or Session evidence
  as a finding by itself.
- Generating or mutating project assets during read-only Better Harness analysis.
- Adding a support-track field to `findings.json` or changing renderer schemas.
- Duplicating the detailed Session, Project Harness, Agent Customize, finding,
  repair, or Loop Discovery contracts inside the new references.

## Plan and Tasks

1. Add three compact flat references with track-specific evidence and output
   rules, routing each to existing canonical owners and case studies.
2. Add a compact post-score selection gate to the root Skill and keep all final
   finding, authorization, and report boundaries unchanged.
3. Extend the focused Better Harness Skill test and generated Markdown routing
   graph for the new one-hop references.
4. Run Skill validation, focused tests, link checks, package verification, and
   example-driven forward tests; iterate on any ambiguous route.

## Test and Review Evidence

- BHST-AC-1..AC-5: `node --test test/better-harness-skill.test.mjs`.
- BHST-AC-5..AC-6: `node scripts/doc-link-graph/cli.mjs skills/better-harness`
  and `node --test test/doc-link-graph.test.mjs`.
- Skill structure: Skill Creator `quick_validate.py` against
  `skills/better-harness`.
- Package surface: `npm run pack:verify`.
- Example behavior: read-only forward tests using the Agent Customize
  `AGENTS.md` fragments, Project Harness artifact catalog, and existing
  bug-diagnosis Skill case studies.

## Verification Evidence

- Skill Creator `quick_validate.py` passed for `skills/better-harness`.
- `node --test test/better-harness-skill.test.mjs` passed 10 of 10 tests.
- The regenerated Better Harness link graph contains 34 files and 50 links;
  `node --test test/doc-link-graph.test.mjs` passed 5 of 5 tests.
- `npm run pack:verify` passed with an isolated writable npm cache: 288 npm
  package entries and 322 runtime zip entries.
- `npm test` passed 816 of 819 tests in the sandbox. The only failures were the
  three unchanged preview-server cases blocked by `listen EPERM 127.0.0.1`;
  `node --test test/preview-servers.test.mjs` then passed 8 of 8 in a
  loopback-capable environment.
- The three support references match the Hyperdrive source commit byte for byte.
  That source passed fresh read-only Bootstrap, Operationalize, and Optimize
  example forward tests without inventing evidence, expanding mutation authority,
  or creating a duplicate Skill when existing coverage matched the demand.
