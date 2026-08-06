# Contributing to Better Harness

Thank you for helping improve Better Harness. This guide is the human entry point
for contributions to Better Harness. Repository location:
<https://github.com/QoderAI/better-harness>.

By submitting a contribution, you confirm that you have the right to contribute
it and agree that it may be distributed under the repository's [MIT License](LICENSE).

## Before You Start

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues before proposing a change. Use the bug or feature issue
  form when the repository issue tracker is available.
- Read [Community Extensibility](docs/community.md) before adding a Skill,
  model, hook, analysis capability, host adapter, report mode, or style.
- Read [Architecture Principles](docs/ARCHITECTURE.md) and the root
  [agent instructions](AGENTS.md) before changing ownership boundaries or
  runtime behavior.
- Read the
  [Developer Experience System ADR](docs/adrs/developer-experience-system.md)
  before changing public entrypoints, Quickstarts, CLI/help/error contracts,
  Preview prerequisites, host support claims, diagnostics, privacy or support
  behavior, release claims, or DX measures.
- Follow [Contributing a New Coding Agent Host](docs/adapters/contributing-new-coding-agent.md)
  before adding or widening host support.

Small, focused fixes can go directly to a pull request. Open an issue first when
the change affects public behavior, schemas, report contracts, packaging,
compatibility boundaries, or more than one canonical owner.

## Development Setup

Better Harness 0.4.0 supports Node.js `>=22.20.0 <26.0.0` and npm
`>=10.9.3 <12.0.0`. The supported project targets are Windows, macOS, and Linux.

```bash
npm ci
npm test
```

Useful focused checks:

```bash
# Markdown links and the generated Harness routing graph
node --test test/doc-link-graph.test.mjs

# Package and runtime-bundle boundaries
npm run pack:verify

# Local visual preview for Canvas changes
npm run preview
```

For visual changes, also check `http://localhost:58575/health` and
`http://localhost:58575/canvas-module.js`, inspect browser console errors, and
retain a screenshot for review. Do not run package publishing commands as part
of an ordinary contribution.

If a documented baseline command fails before your change, record the exact
failure in the issue or pull request instead of silently omitting the check.

## Choose the Correct Owner

Start with the two common extension routes in
[docs/community.md](docs/community.md):

- Workflow guidance belongs in `skills/<skill>/references/` or shared
  `references/`.
- Visual style grammar belongs in `templates/style/` and must be registered in
  `templates/style/routing.md`.

Executable behavior, host adapters, models, hooks, packaging, and report
contracts have additional owner and evidence requirements. Follow the complete
extensibility matrix instead of adding a parallel implementation.

For a Coding Agent host, use the dedicated
[host contribution guide](docs/adapters/contributing-new-coding-agent.md). It
separates shell, configured-asset, session, output, and packaging claims so a
host can land partial support without overstating its coverage.

## Plan the Change

For non-trivial behavior, hook, Skill, template, adapter, report, or review-flow
changes, follow the spec policy in [AGENTS.md](AGENTS.md). Keep one canonical
spec, stable acceptance-criteria IDs, explicit non-goals, and named validation
evidence. Documentation-only maintenance can explain why no Story or behavior
spec is required.

Keep the pull request bounded to one outcome. Do not mix generated artifacts,
unrelated cleanup, dependency changes, or local host state into the same change.

## Test and Document

Run the smallest relevant tests while developing, then the broader gate justified
by the risk:

- Markdown moves or links: `node --test test/doc-link-graph.test.mjs`.
- Runtime logic: focused `node --test test/<area>.test.mjs`, then `npm test`.
- Package/runtime roots: `npm run pack:verify`.
- Visual output: preview smoke, console inspection, and screenshot review.
- Cross-platform command changes: verify argv-based execution and avoid
  shell-specific syntax.

Update user-facing documentation and [CHANGELOG.md](CHANGELOG.md) when a change
alters installation, commands, output, compatibility, or public extension
contracts.

## Commits and Pull Requests

Use Conventional Commits:

```text
<type>(<scope>): <imperative summary>

Explain what changed, why it changed, and how it was validated.
```

Prefer `feat`, `fix`, `test`, `docs`, `refactor`, or `chore`. Keep the summary
concise and add a prose body for non-trivial changes.

Complete the pull request template with:

- linked issue or a clear no-issue rationale;
- spec and acceptance-criteria references when applicable;
- exact changed owners and explicit non-goals;
- test commands and observed outcomes, not intended future checks;
- compatibility, packaging, and rollback risks;
- material AI assistance and the human review performed on its output.

## Review and Merge

Maintainers review correctness, evidence, scope, architecture ownership,
cross-platform behavior, compatibility impact, and license compatibility.
Approval does not imply immediate merge when release or compatibility questions
remain open.
