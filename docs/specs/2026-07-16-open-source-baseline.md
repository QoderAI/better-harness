# Open-source project baseline

## Traceability

- Spec ID: open-source-baseline
- Status: Implemented
- Maintained by: [Clean the pre-public project identity](2026-07-24-pre-public-identity-cleanup.md)
- Core-boundary follow-up: [Remove the configurable core boundary](2026-07-27-remove-configurable-core-boundary.md)

## Intent

Prepare Better Harness for public collaboration and distribution. The repository
must be installable across its supported hosts, disclose its local-data
boundaries, preserve license information in every artifact, and provide enough
governance and automated evidence for an outside contributor to make a safe
change.

## Acceptance Scenarios

- AC-1: Qoder, Codex, and Cursor plugin manifests exist, share the same product
  identity and version, route to the canonical root `skills/`, and pass the
  repository and Codex plugin validators.
- AC-2: The npm package uses the public `@qoder-ai/better-harness` identity, contains
  public registry and repository metadata, has no internal registry references,
  and includes every Markdown document reachable from packaged runtime guidance.
- AC-3: Every npm, runtime zip, and generated host-plugin artifact contains the
  MIT license and aligned package metadata; package verification rejects an
  incomplete artifact.
- AC-4: `session-analysis --help` and `harness checkup --help` return help
  without reading session stores, and quickstart offers an explicit way to skip
  local session discovery.
- AC-5: The previously referenced project-owned core-boundary configuration and
  Harness benchmark are present, and the complete automated test suite passes.
- AC-6: Contributors can find contribution, conduct, security, support,
  governance, privacy, provenance, and changelog policies plus issue and pull
  request templates.
- AC-7: CI exercises Linux, macOS, and Windows on the declared Node.js baseline,
  with a current-Node compatibility job, and runs both tests and package
  verification.

## Non-goals

- Creating the public GitHub repository, configuring branch protection, or
  publishing a new npm release.
- Reconstructing private pre-import Git history.
- Adding a new runtime host adapter or copying canonical behavior into plugin
  shell directories.
- Changing session-analysis output schemas or silently redacting evidence that
  advanced local workflows currently rely on.

## Plan and Tasks

1. Restore the missing source-owned plugin shells, benchmark, and project-owned
   core-boundary configuration, using the existing Qoder shell and Superpowers
   manifests as structural references.
2. Align npm, lockfile, host-manifest, documentation, and generated-artifact
   metadata around `@qoder-ai/better-harness` and the planned public repository URL.
3. Make license and reachable documentation inclusion explicit in package and
   host-artifact builders and verifiers.
4. Make help paths side-effect free, add the quickstart session opt-out, and
   document local-data handling.
5. Add the minimum public governance surface, contribution templates,
   cross-platform CI, and dependency update automation.
6. Run focused validation first, then the complete test and packaging gates;
   perform a Review Readiness Check before committing and publishing the branch.

## Test and Review Evidence

- AC-1: `node --test test/plugin-manifests.test.mjs test/host-plugin-artifact.test.mjs`
  and `python3 <codex-home>/skills/.system/plugin-creator/scripts/validate_plugin.py .`.
- AC-2/AC-3: `npm run pack:verify`; inspect `npm pack --json` metadata and
  generated artifact entries for public URLs and `LICENSE`.
- AC-4: focused session-analysis, checkup, and quickstart tests with temporary
  homes whose readers fail if invoked from a help path.
- AC-5: `npm test` and `git diff --check`.
- AC-6: `node --test test/doc-link-graph.test.mjs` plus a manual scan of the
  root README community links.
- AC-7: validate the workflow YAML locally by reviewing its explicit OS/Node
  matrix; hosted CI status remains unavailable until the repository is mirrored.
- Risk: expanding packaged documentation increases artifact size slightly;
  verify the packed file list and retain source-local/test exclusions.
- Risk: the planned public repository URL may not resolve until external mirror
  creation, which is explicitly outside this change.

## Implementation Evidence

- `npm test`: 690 tests passed with no failures.
- `npm run pack:verify`: the npm package and runtime bundle passed file,
  metadata, documentation, and dependency-license checks.
- Qoder source and extracted-runtime validation, Codex validation, and the
  pinned official Cursor plugin/marketplace schemas all passed.
- Focused privacy/help tests, documentation-link checks, the high-severity
  secret scan, public-registry dry run, and `git diff --check` passed.
- The release workflow remains deliberately gated on the future public GitHub
  mirror and npm trusted-publisher configuration.
