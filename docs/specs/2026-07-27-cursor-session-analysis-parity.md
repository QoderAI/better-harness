# Complete Cursor session-analysis parity

## Traceability

- Spec ID: `cursor-session-analysis-parity`
- Status: Implemented

## Intent

Make the existing Cursor session provider discoverable and evidence-safe through
the same Better Harness workflow used by the other supported hosts. Align host
metadata with the package version, route Cursor through the canonical Session
Diagnostics and portable HTML contracts, and preserve transcript, metadata,
and audit coverage in the production facts envelope.

The workflow must distinguish a successfully scanned empty workspace from a
workspace whose Cursor transcripts exist but cannot support bounded Session
facts. Missing timestamps, message content, metadata joins, or audit joins stay
explicit evidence boundaries and never become zero activity or a clean result.

## Acceptance Scenarios

- **CSP-AC-1 (version alignment):** `package.json`, `package-lock.json`, and the
  Qoder, Codex, Claude Code, and Cursor plugin manifests expose the same package
  version, and the existing manifest contract test passes.
- **CSP-AC-2 (canonical routing):** Session Diagnostics documents Qoder, Codex,
  Claude Code, and Cursor as supported `session-analysis` providers and includes
  Cursor-specific transcript, metadata, audit, workspace, and privacy
  boundaries. It does not route agents to the opaque Cursor database.
- **CSP-AC-3 (host and output routing):** The host adapter matrix points Cursor
  at `scripts/session-analysis/platforms/cursor.mjs`, and portable HTML routing
  explicitly includes Cursor while keeping Qoder as the only Canvas host.
- **CSP-AC-4 (facts coverage contract):** Cursor `session-core-facts` contains a
  privacy-safe `sourceCoverage` envelope that distinguishes `absent`,
  `out-of-window`, `unobserved`, `partial`, and `observed` coverage. It reports
  only bounded aggregate counts for workspace transcripts, in-window sessions,
  timestamp coverage, request/conversation content, terminal-only or unreadable
  transcripts, chat metadata joins, and audit joins.
- **CSP-AC-5 (bundle propagation):** The Session Evidence collector keeps
  `absent`, `out-of-window`, and `observed` facts available, but maps
  `unobserved` and `partial` Cursor coverage to a `partial` lane. Normal bundles
  therefore fail closed on incomplete Cursor Session evidence while quick
  bundles retain the explicit partial boundary.
- **CSP-AC-6 (provider behavior):** Deterministic fixtures cover no transcript,
  dated transcripts outside the requested window, terminal-only or invalid
  transcripts, missing metadata/audit joins, and fully joined transcripts. Raw
  session ids, paths, prompts, commands, output, and secrets do not enter
  production facts.
- **CSP-AC-7 (real-home boundary):** A bounded read-only probe against the
  current Cursor home reports the selected workspace's actual coverage state
  and never persists raw session content.
- **CSP-AC-8 (documentation integrity):** Markdown links and the generated
  Better Harness documentation routing graph remain current.

## Non-goals

- Modify `~/.cursor`, install or publish a Cursor plugin, or replace a user-level
  `sessions-diagnostics` Skill.
- Add a second Cursor analyzer or move provider logic into `.cursor-plugin/`.
- Decode Cursor `store.db` or infer transcript content from opaque application
  state.
- Add Cursor metadata to the Qoder npm package or runtime bundle.
- Treat missing Session evidence, zero candidates, or configured plugin assets
  as proof of runtime quality or Skill invocation.

## Plan and Tasks

1. Align `package-lock.json` and the four host manifests with the package
   version while preserving the existing Qoder-only packaging boundary.
   (CSP-AC-1)
2. Update the canonical Session Diagnostics, host adapter matrix, report
   routing, and focused Skill assertions for Cursor. (CSP-AC-2, CSP-AC-3)
3. Add bounded Cursor transcript-shape and join accounting in the provider,
   project it through the versioned Session facts contract, and map incomplete
   coverage to the evidence-bundle lane status. (CSP-AC-4, CSP-AC-5)
4. Add deterministic provider and bundle fixtures for every coverage state and
   privacy boundary. (CSP-AC-5, CSP-AC-6)
5. Run focused tests, the real-home aggregate probe, documentation graph
   regeneration/checks, the full suite, and package verification. Update this
   spec to `Implemented` only when the visible evidence passes. (CSP-AC-1 through
   CSP-AC-8)

## Test and Review Evidence

- CSP-AC-1: `node --test test/plugin-manifests.test.mjs`.
- CSP-AC-2 and CSP-AC-3: `node --test test/better-harness-skill.test.mjs
  test/coding-agent-platform-notes.test.mjs`.
- CSP-AC-4 through CSP-AC-6: `node --test
  test/session-analysis-providers.test.mjs
  test/session-analysis-core-facts.test.mjs
  test/better-harness-evidence-bundle.test.mjs`.
- CSP-AC-7: run `node scripts/session-analysis.mjs facts --platform cursor
  --workspace <current-workspace> --selection all-eligible --limit 5 --format
  json` and inspect only coverage state, warning codes, and aggregate counts.
- CSP-AC-8: run `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs`.
- Regression: run `npm test` and `npm run pack:verify` with a writable isolated
  npm cache when required.
- Risk review: confirm the facts envelope remains within its byte/token budget,
  no raw Cursor identifiers or paths are serialized, an empty workspace remains
  a successful empty collection, and normal evidence bundles fail closed only
  for genuinely incomplete Session coverage.

Implemented evidence:

- CSP-AC-1: manifest schema, host resource, and Qoder-only packaging tests
  passed. Package, lockfile, host manifests, and the Claude marketplace now
  resolve version `0.3.0`.
- CSP-AC-2 and CSP-AC-3: Session Diagnostics, adapter architecture, Better
  Harness Skill, platform-note, and report-routing tests passed.
- CSP-AC-4 through CSP-AC-6: the final focused provider, facts, bundle,
  manifest, CLI, and documentation suite passed 150 tests. Internal
  `episode-fact-candidates` remains schema 2 while public
  `session-core-facts` is schema 3.
- CSP-AC-7: the bounded real-home probe returned `unobserved` for one
  terminal-only workspace transcript with no metadata or audit join. The quick
  evidence bundle returned `partial`; the normal bundle failed closed with
  `sessionEvidence` listed as partial and incomplete.
- CSP-AC-8: the generated graph contains 34 files and 50 links; all link-graph
  tests passed.
- Full `node --test --test-reporter=dot` passed with loopback access. The first
  restricted run reproduced only the expected `listen EPERM` preview boundary
  plus two stale schema assertions, which were updated and revalidated.
- `env npm_config_cache=/tmp/harness-expert-v0-3-0-npm-cache npm run
  pack:verify` passed with 293 npm entries and 327 runtime-zip entries.
- Review Readiness: no Story was supplied or inferred; this maintenance spec
  covers every changed module and test. The local diff contains only the Cursor
  parity and `0.3.0` release-surface changes, the generated documentation graph
  is current, and no unrelated local change is included.
