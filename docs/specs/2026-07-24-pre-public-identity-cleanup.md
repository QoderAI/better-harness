# Clean the pre-public project identity

## Traceability

- Spec ID: pre-public-identity-cleanup
- Status: Implemented

## Intent

Prepare Better Harness for its first public release by removing developer-local
paths and retired pre-public product identities from tracked documentation,
runtime compatibility readers, tests, package contents, and migration-only
specifications. Because none of those earlier identities were publicly released,
the repository should present one current product and should not carry migration
or compatibility behavior that no external user can depend on.

## Acceptance Scenarios

- AC-1: Tracked reader-facing documentation contains no developer-specific home
  directory or evaluation-workspace path; terminal-demo commands use portable
  placeholders and only the current Better Harness report roots.
- AC-2: Active source, tests, documentation, changelog, and packaged specs contain
  no retired pre-public product, CLI, package, plugin, report-root, callback, or
  session-salt identity. Better Harness is the only product identity.
- AC-3: Runtime discovery and validation accept only current Better Harness
  commands, paths, callbacks, and generated artifacts. The terminal demo does
  not discover retired report roots, and no compatibility wrapper remains.
- AC-4: Migration-only specifications are deleted. Enduring capability specs are
  updated to describe current owners and commands, all remaining Markdown links
  resolve, and the generated documentation graph is current.
- AC-5: Renderer module names, exports, check ids, package guards, and tests use
  the current identity without changing the report file contract or the Agent
  Work Loop semantics.
- AC-6: Focused tests, the complete test suite, package verification, stale-name
  scans, developer-path scans, and `git diff --check` pass.

## Non-goals

- Removing or renaming Agent Work Loop, Loop Engineering, loop blueprint, or
  other current methodology concepts that use "loop" as a domain term.
- Publishing the GitHub repository, npm package, or host marketplace listings.
- Preserving compatibility with pre-public local report directories, callbacks,
  generated session references, commands, or plugin identities.
- Deleting ignored local recordings or other user-owned untracked files.

## Plan and Tasks

1. Replace developer-local paths in the terminal-demo guide with portable
   examples and keep discovery limited to current report roots.
2. Remove the obsolete terminal compatibility wrapper and migration-only specs;
   update surviving specs and links around the current Better Harness owners.
3. Remove retired aliases from report repair/validation, session classification,
   learning-state discovery, artifact filtering, and contribution attribution.
4. Rename the report renderer owner and exported identifiers to Better Harness,
   then update focused tests and check ids.
5. Regenerate the documentation graph and run focused, full, packaging, and
   repository-hygiene validation.

## Test and Review Evidence

- AC-1/AC-2: repository-wide tracked-file scans for developer home paths and the
  agreed retired pre-public identifier set must return no matches.
- AC-3/AC-5: run the terminal-demo, session-analysis, report-quality,
  Canvas-validation, Skill, renderer, manifest, and host-artifact tests.
- AC-4: run `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs`.
- AC-6: run `npm test`, `npm run pack:verify`, and `git diff --check`.
- Risk: existing local pre-public histories, callbacks, and session references
  will no longer be discovered or accepted. This is intentional because the
  user confirmed the old surface was never public and is no longer required.
- Risk: removing migration specs can break relative links. Delete or update every
  inbound reference before regenerating the documentation graph.

## Implementation Evidence

- AC-1/AC-2: the tracked repository scan for the agreed retired identifiers and
  developer-specific home paths returned no matches. Ignored local terminal
  recordings remained outside the public surface, as required by the non-goals.
- AC-3/AC-5: focused coverage passed during implementation, followed by the full
  `npm test` suite with 818 tests passing and no failures.
- AC-4: the documentation graph regenerated with 27 files and 32 links; the
  complete suite included the repository-wide Markdown-link and graph checks.
- AC-6: `npm run pack:verify` passed with 284 npm entries and 318 runtime-zip
  entries. `git diff HEAD --check` and the final stale-identity scans passed.
