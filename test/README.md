# Test suite layout

Tests are grouped by the production capability that owns the behavior. Keep a
new test beside its primary owner even when it crosses unit, integration, and
CLI boundaries. Shared fixtures stay in `test/fixtures`. Vitest discovers tests
directly from the capability directories; test support code is not published
with the package.

## Categories

- `agents/` — agent inventory, customization, linting, guardrails, and Checkup.
- `cli/` — root command routing, doctor, quickstart, read-only behavior, and
  terminal demos.
- `governance/` — change impact, dependency policy, review triggers, test
  mapping, repository topology, and contribution census.
- `learning/` — learning capture, intervention state, demand signals, and
  learning-loop review.
- `plugins/` — host support, plugin lifecycle, manifests, and packaged host
  artifacts.
- `reporting/` — evidence projection, report models, Canvas/HTML rendering,
  validation, Inspector, findings, and repair flows.
- `sessions/` — provider ingestion, selection, correlation, usage, workspace
  matching, and episode contracts.
- `skills-docs/` — shipped Skill contracts, prompt templates, platform notes,
  and documentation link integrity.

## Commands

Run the complete suite:

```sh
npm test
```

Run the CI presentation locally, including human-readable failures, GitHub
Actions reporting when applicable, and the JUnit file:

```sh
npm run test:ci
```

Run one capability:

```sh
npx vitest run test/sessions
npx vitest run test/reporting
```

Run one file:

```sh
npx vitest run test/plugins/plugin-lifecycle.test.mjs
```

Do not add a second test manifest. Both local and CI commands use the same
Vitest discovery configuration for `*.test.mjs` files; this document explains
ownership and routing.
