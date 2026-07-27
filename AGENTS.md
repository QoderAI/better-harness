# Better Harness

Cross-platform support is required (Windows, macOS, Linux).
Architecture, directory routing, and template ownership live in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Plan & Spec

- Write a plan or spec for new agents, hooks, or major features under
  `docs/specs/<yyyy-mm-dd>-<spec-name>.md`, using the spec's creation date.
- For non-trivial behavior changes to `skills/`, `hooks/`, `scripts/`, `templates/`, adapters, report formats, or review workflows,
  use `.agents/skills/change-traceability-review/SKILL.md` in **Spec Preparation** mode before implementation.
- Prefer `docs/specs/<yyyy-mm-dd>-<story-id>-<slug>.md` when there is a Story or issue id; otherwise use
  `docs/specs/<yyyy-mm-dd>-<slug>.md` for justified maintenance, docs-only, test-only, dependency, or infra work.
- Keep specs reviewable: include intent, acceptance scenarios with stable AC ids, non-goals, plan/tasks, and test/review evidence.
  Mark unknowns with `[NEEDS CLARIFICATION: ...]`.
- Keep `docs/specs/*.md` titles human-readable. Do not put Story ids, status, or review state in titles, and do not use YAML front matter by default.
- Put traceability metadata in the body: `Spec ID`, optional `Story`, and `Status` in a short `## Traceability` section.

## Test and Verify

- Design scripts and code for AI-friendly automated use, and validate automation with an AI agent when relevant,
  e.g. Qoder via `qodercli -p` or Codex via `codex -p`.
- For visual changes, verify with Playwright against the preview URL, inspect console/page errors, and save a screenshot for layout review.
- Run `npm run preview`, then smoke-test `http://localhost:58575/health` and `/canvas-module.js` to ensure TSX transforms and SDK runtime load.

## Doc Link Integrity

- All relative `.md` references across `skills/`, `references/`, `templates/`, `models/`, `docs/`, and `case-studies/`
  must resolve; `test/doc-link-graph.test.mjs` enforces this in `npm test`.
- After adding, moving, or renaming markdown docs, run `node --test test/doc-link-graph.test.mjs` before committing,
  and regenerate the routing graph with `node scripts/doc-link-graph/cli.mjs skills/better-harness`
  (it rewrites `docs/better-harness-doc-links.mmd`, which the test checks for staleness).
- Every reference doc shipped under `skills/better-harness/references/` must stay reachable from `SKILL.md` routing,
  otherwise agents can never load it.

## Commit Messages

- Use Conventional Commits: `<type>(<scope>): <summary>`, blank line, then a prose body when non-trivial.
- Prefer `feat`, `fix`, `test`, `docs`, `refactor`, `chore`; scopes should name affected areas such as `hooks`, `canvas`,
  `templates`, `agents`, or `deps`.
- Keep summaries imperative, lower-case after the type, and under 72 characters when practical.
  Do not use vague subjects like `update`, `changes`, or `fix stuff`.
- Agent-authored non-trivial commits need a normal prose body explaining what changed, why, and how it was validated.
- For spec-backed commits, naturally mention the Story/spec/test evidence in the body. Use `Story:`, `Spec:`, `Test:`, `Risk:`,
  `AI:`, or `Refs:` trailers only when a reviewer, host tool, or external workflow explicitly requires them.

## Change Traceability Review

- Use `.agents/skills/change-traceability-review/SKILL.md` as the Story/Spec/Test/Risk evidence-chain review guide, not a code-style guide.
- Before review, merge, or commit of a non-trivial change, run a **Review Readiness Check** over the staged or local diff:
  Story evidence, matching Spec, tests, risk, AI marker, changed modules, generated files, and staged/unstaged split.
- Use **Review Retrospective** for process tuning across recent history: commit messages, Story/Spec/Test/Risk coverage,
  oversized commits, repeated rework, automation commits, and missing review evidence.
- Do not infer Story ids, AI involvement, tracker status, CI status, or spec content from branch names, prose style, timestamps, or topic similarity.
  Count only visible local evidence or explicitly opened external evidence.
