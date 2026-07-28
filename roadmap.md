# Adapter Roadmap

References: [Architecture](docs/ARCHITECTURE.md) ·
[Host Adapter Matrix](docs/adapters/README.md) ·
[Directory Structure ADR](docs/adrs/directory-structure.md)

## Current Platform Coverage

Legend: **Yes** = implemented and tested; **Partial** = limited or source-local;
**Broken** = publicly exposed but currently fails or routes incorrectly;
**No** = intentionally unavailable until a real evidence source exists.

| Capability | Qoder | Codex | Cursor | Claude Code |
| --- | --- | --- | --- | --- |
| Host shell | Yes | Yes | Yes | Yes |
| Installation / distribution | Yes: built-in + npm bundle | Partial: source-local artifact | Partial: source-local plugin | Partial: repository marketplace |
| Configured asset inventory | Yes | Yes | Yes: unmatched plugin IDs remain unknown | Yes |
| Session evidence | Yes | Yes | Yes: local coverage remains explicit | Yes: local coverage remains explicit |
| Hook runtime evidence | Yes | Partial: hook facets are empty | No | No |
| Model / token evidence | Yes | Partial: model facets are empty | No | No |
| Harness analysis | Yes | Yes | Yes | Yes |
| Durable report | Qoder Canvas | Markdown + HTML | Markdown + HTML | Markdown + HTML |
| Checkup scan | Yes | Partial | Broken: advertised but no analyzer | No |
| Checkup plan / apply | Yes: bounded Qoder actions | Broken: may generate `qodercli` actions | Broken if scan is bypassed | No |
| Standalone host artifact | npm bundle | Yes | No | No |
| Real host smoke test | Partial | Partial | No | No |

### Summary

- **Qoder:** the only first-class product host today; it remains the only host
  with the Qoder Canvas output and provider-native bounded checkup actions.
- **Codex:** read, analyze, and report are usable; mutation is not safely isolated.
- **Cursor:** configured assets, session evidence, analysis, and portable reports
  are implemented. Evidence coverage and checkup behavior remain bounded.
- **Claude Code:** configured assets, session evidence, analysis, and portable
  reports are implemented. Checkup behavior remains bounded.
- **Operating systems:** unit tests and package verification run on Windows,
  macOS, and Linux, but this does not prove installed host runtime behavior.

## TODO List

Work top to bottom. P0 items are contract and safety fixes; later items add
platform depth.

| Done | Priority | ID | TODO | Acceptance |
| --- | --- | --- | --- | --- |
| [ ] | P0 | A-01 | Add `full-session`, `inventory-only`, and `unsupported` checkup capability states. | Cursor inventory scan succeeds without session evidence and produces no cleanup candidates. |
| [ ] | P0 | A-02 | Make checkup plan/apply provider-aware and fail closed by default. | Codex and Cursor plans never contain `qodercli` actions. |
| [ ] | P0 | A-03 | Bind source references and provider-home paths to an explicit provider. | A patch cannot resolve into another host's configuration root. |
| [ ] | P0 | A-04 | Add a help-only path to `agent-customize`. | `--help` returns before reading HOME, workspace, SQLite, or plugin caches. |
| [x] | P0 | A-05 | Fix stale adapter documentation and smoke commands. | The matrix uses current `harness analyze` / `harness render` commands and does not overstate Cursor output support. |
| [x] | P0 | A-06 | Add support-declaration consistency tests. | Provider registry, session platforms, report platforms, and docs agree for declared support. |
| [ ] | P1 | C-01 | Add Codex-specific configuration source precedence. | Checkup distinguishes editable sources from cache, audit, and session data. |
| [ ] | P1 | C-02 | Normalize Codex model, usage, and hook evidence when present. | Missing data stays unavailable; no model, token, or hook values are invented. |
| [ ] | P1 | C-03 | Add a real Codex installation smoke. | Build, install, discover Skills, analyze, render HTML, validate, and reinstall all pass. |
| [ ] | P1 | C-04 | Decide whether Codex apply remains read-only. | Automatic apply is added only after an accepted provider-native mutation contract. |
| [ ] | P2 | U-01 | Remove deterministic Cursor plugin assignment by cache order. | Unmatched numeric IDs remain unknown instead of being attached to the wrong plugin. |
| [ ] | P2 | U-02 | Add Cursor inventory-only checkup. | Results are configured-only and cleanup/apply remains blocked. |
| [x] | P2 | U-03 | Add a Cursor Harness report route. | HTML/Markdown output passes validation and preserves explicit session-evidence coverage boundaries. |
| [ ] | P2 | U-04 | Add a Cursor artifact and runtime smoke. | A packaged plugin works with `cursor-agent --plugin-dir` without source-tree assumptions. |
| [x] | P2 | U-05 | Evaluate a real Cursor session source. | A session adapter is added only with stable provenance, workspace binding, privacy rules, and drift fixtures. |
| [x] | P3 | L-01 | Add a Claude Code configured-asset provider. | Inventory covers Skills, Commands, Agents, Hooks, MCP, plugins, and instruction files. |
| [ ] | P3 | L-02 | Connect Claude instruction lint to the unified provider contract. | Help, inventory, lint, and checkup use the same support status. |
| [x] | P3 | L-03 | Add a Claude Harness report route. | HTML/Markdown output is validated and makes no runtime-use claims. |
| [ ] | P3 | L-04 | Run native Claude plugin validation in CI. | `claude plugin validate --strict .` is an integration gate. |
| [x] | P3 | L-05 | Evaluate a real Claude session source. | The session adapter keeps provenance and privacy boundaries explicit. |
| [ ] | P4 | X-01 | Add Host × OS smoke coverage for supported combinations. | Each claimed combination installs, discovers, runs, validates, and upgrades. |
| [ ] | P4 | X-02 | Define the entry checklist for future hosts. | New adapters require install, inventory, evidence, output, mutation, packaging, and smoke contracts. |

## Definition of Done

An adapter capability is complete only when:

- the CLI, docs, implementation, and tests declare the same support state;
- unsupported behavior fails before reading private data or changing files;
- session and runtime claims come from real host evidence;
- automatic changes use a provider-native executor, explicit confirmation,
  rollback, and read-back verification;
- host runtime smoke is reported separately from unit and fixture tests.

## Non-goals

- Do not force all hosts to have identical capabilities.
- Do not create synthetic session, hook, model, or token evidence.
- Do not ship Claude, Codex, or Cursor shells in the Qoder npm package.
- Do not create a second generic adapter framework.
- Do not automate mutation without a provider-native contract.

## Open Decisions

| Decision | Default until resolved |
| --- | --- |
| Should Codex checkup support automatic apply? | Keep it read-only / manual-review. |
| Is there a stable, workspace-bound Cursor session source? | Keep session evidence unsupported. |
| Does Claude Code need a standalone artifact? | Prefer native marketplace installation. |
| Is there a supported Claude session source? | Keep session evidence unsupported. |
