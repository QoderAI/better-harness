# Prerelease npm dist-tags

## Traceability

- Spec ID: `2026-09-03-prerelease-npm-dist-tag`
- Status: Implemented

## Intent

Publish Better Harness prerelease versions through the existing GitHub-owned
npm workflow without moving npm's stable `latest` dist-tag away from the most
recent stable release. Stable releases should keep the current `latest`
behavior, while alpha, beta, and release-candidate versions should receive the
matching prerelease channel.

## Acceptance Scenarios

- **AC-1 — Stable releases remain latest:** a stable semantic version such as
  `0.7.0` resolves to the npm dist-tag `latest`.
- **AC-2 — Prereleases use their channel:** versions beginning with an
  `alpha`, `beta`, or `rc` prerelease identifier resolve to `alpha`, `beta`, or
  `rc` respectively, including compact identifiers such as `0.7.0-alpha1`.
- **AC-3 — Unsupported versions fail closed:** malformed versions and
  unrecognized prerelease identifiers do not publish under an inferred tag.
- **AC-4 — The selected package controls publication:** the release workflow
  resolves the version from the selected root or workspace package and passes
  its resolved tag explicitly to `npm publish`.

## Non-goals

- Changing the set of publishable packages or introducing automatic releases.
- Moving or deleting existing npm dist-tags.
- Publishing directly from a maintainer workstation.

## Plan and Tasks

1. Add a small Node.js resolver for stable and supported prerelease versions.
2. Cover stable, compact alpha, dotted alpha, beta, rc, and invalid inputs with
   behavior tests.
3. Update the manual release workflow to resolve the selected package version
   and pass the resulting tag explicitly to both root and workspace publishes.
4. Validate the workflow path with focused tests, the repository checks, and an
   npm publish dry-run before dispatching the release.

## Test and Review Evidence

- **AC-1 through AC-3:** focused unit tests call the exported resolver and
  assert returned tags and fail-closed errors.
- **AC-4:** a focused workflow test parses the YAML and verifies that both
  publish branches consume the resolved tag; the release dry-run must identify
  `@qoder-ai/better-harness@0.7.0-alpha1` before dispatch.
- **Risk:** omitting or misrouting the explicit tag could replace `latest` with
  a prerelease. Post-publish verification must confirm `alpha` points to the new
  version and `latest` remains on the prior stable version.
