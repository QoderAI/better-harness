# Support-declaration Consistency Tests

Add a contract test that keeps the platform support declarations named by
the roadmap Definition of Done in agreement: CLI help, the agent-customize
provider registry, session-analysis platform loading, Harness report
platform gating, and the host adapter matrix. This is roadmap P0 item A-06.

## Traceability

- Spec ID: 2026-07-28-a06-support-declaration-consistency
- Story: roadmap.md TODO A-06
- Status: Implemented

## Intent

The supported platform set (`qoder`, `codex`, `claude`, `cursor`, `qwen`,
`copilot`) is declared
independently in at least five places:

- `scripts/session-analysis.mjs` and `scripts/session-analysis/analyzer.mjs`
  help text and `loadPlatform` gates;
- `scripts/agent-customize/providers/index.mjs` `PROVIDER_COLLECTORS`;
- `scripts/harness-analysis/report-run.mjs` `ANALYZE_HELP` and the
  `reportPlatform` whitelist (whose rejection now names the supported set,
  matching the other gates);
- `scripts/coding-agent-practices/asset-baseline.mjs` provider gate;
- `docs/adapters/README.md` host adapter matrix rows.

Nothing asserts these declarations agree. Adding or dropping a host in one
owner silently leaves the others stale, so CLI help, error messages, and docs
can advertise different platform sets. The roadmap Definition of Done requires
that "CLI help, provider registry, session platforms, report platforms, and
docs agree".

## Acceptance

- AC-1: A test derives the platform list each surface declares — help output,
  registry keys, loader and gate error messages, and adapter matrix module
  paths — and asserts every list equals the canonical supported set.
- AC-2: The test exercises public routes only: the root facade CLI, the
  `scripts/session-analysis/index.mjs` and
  `scripts/agent-customize/providers/index.mjs` import surfaces, and the
  shipped docs file. No private helper is imported.
- AC-3: Unsupported platform input keeps failing closed on each gated route,
  and the failure message names the full supported set.
- AC-4: `npm test` picks the test up automatically (default `node --test`
  discovery under `test/`).

## Non-goals

- No change to which platforms are supported.
- No new shared runtime constant across modules; each capability keeps owning
  its own declaration, and the test only proves the declarations agree. The
  `reportPlatform` whitelist is extracted to a file-local `REPORT_PLATFORMS`
  constant so its gate and error message share one source; `ANALYZE_HELP`
  keeps its own prose list, which the contract test asserts separately.
- No assertions on prose wording beyond the declared platform lists.
- Other commands that declare their own platform or provider lists
  (coding-agent-practices `inventory` and `asset-integrity`,
  `agent-customize`, `agent-lint`, `evidence-bundle`, `task-loop-source`,
  `selection-profile`) stay out of scope; the roadmap Definition of Done
  names only the surfaces above.

## Plan

1. Add `test/support-declarations.test.mjs` with one canonical
   `SUPPORTED_PLATFORMS` list and set-equality helpers.
2. Extend `reportPlatform` in `scripts/harness-analysis/report-run.mjs` so its
   rejection error names the full supported set, matching the session-analysis
   and asset-baseline gates, so the contract test can assert the declared list
   rather than only that an unsupported value is rejected.
3. Cover the five surfaces: session-analysis CLI help plus its platform
   gate, the exported `SESSION_ANALYSIS_HELP`, `harness analyze` help plus
   its platform gate, `PROVIDER_COLLECTORS`, `createAnalyzer` rejection,
   the asset-baseline provider gate, and the adapter matrix module
   references.
4. Mark roadmap A-06 done.

## Test Evidence

- `node --test test/support-declarations.test.mjs`
- `node --test test/doc-link-graph.test.mjs`
