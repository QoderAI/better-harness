# Position Better Harness Around Agent Work Loop Insights

## Traceability

- Spec ID: `agent-work-loop-insights-positioning`
- Status: Implemented

## Intent

Position Better Harness as an open-source source of insights for the Agent Work
Loop rather than as a generic workflow review tool. Search and repository
visitors should understand that coding work can be delegated to agents while
Better Harness helps them analyze and improve the engineering workflow around
those agents with bounded evidence.

Keep `review` where it describes a real human or pull-request quality gate, but
remove it from category-level positioning and user prompts where `analyze`,
`insights`, `improve`, or `verify` describes the product more accurately.

## Acceptance Scenarios

- ALI-AC-1: The English home page identifies Better Harness as open-source
  insights for the Agent Work Loop and leads with the outcome `Delegate coding
  to agents. Improve the loop around them.` The supporting copy explains the
  evidence-to-insights-to-improvement path without promising continuous
  telemetry or causal improvement.
- ALI-AC-2: The Simplified Chinese home page carries the same positioning in
  natural Chinese, keeps the established `Agent Work Loop` concept visible,
  and preserves the existing host-selection and sample-report actions.
- ALI-AC-3: English and Chinese metadata retain the established search terms
  `AI coding`, `agent`, and `workflow` while replacing generic workflow-review
  positioning with workflow insights and improvement language.
- ALI-AC-4: The English and Chinese README openings, Quick Start introductions,
  and Introduction pages use the same delegation, evidence, insights, and
  improvement vocabulary. Host invocation prompts ask Better Harness to
  analyze the workflow and generate an evidence-backed report.
- ALI-AC-5: Operational uses of `review` remain where they refer to PR review,
  human review, review-ready output, or an explicit review workflow. Generic
  feedback sensors use evaluation language instead. No report schema, scoring
  behavior, installation command, host support level, or output contract
  changes.
- ALI-AC-6: Focused source-contract tests, English and Simplified Chinese docs
  builds, markdown link checks, whitespace checks, and browser inspection of
  the two home-page heroes pass without layout overflow or console errors.

## Non-goals

- Do not rename the Better Harness skill, report format, scoring model, or
  `Agent Work Loop` dimensions.
- Do not claim live tracing, continuous observability, autonomous optimization,
  or causally proven improvement.
- Do not redesign the landing-page layout, colors, typography, navigation, host
  cards, or sample report.
- Do not change GitHub repository metadata, deploy Pages, publish packages, or
  include unrelated developer-experience and ADR work already in the worktree.

## Plan and Tasks

1. Update the home-page category label, hero, lead, proof language, and metadata
   in the English source and paired Simplified Chinese translations.
2. Align the README openings, Quick Start introductions, workflow explanation,
   and host invocation prompts with Agent Work Loop Insights positioning.
3. Align the English and Simplified Chinese Introduction pages while preserving
   evidence and causal-proof boundaries.
4. Update focused documentation tests to protect the new positioning and reject
   the retired category-level review phrases.
5. Build and inspect both locales at desktop and mobile widths, then record
   verification evidence and remaining positioning risks.

## Test and Review Evidence

- ALI-AC-1 through ALI-AC-5: run `node --test test/docs-site.test.mjs
  test/docs-entrypoints.test.mjs` and inspect focused diffs and search results.
- ALI-AC-4 and markdown routing: run
  `node --test test/doc-link-graph.test.mjs`; regenerate the routing graph only
  if the test reports staleness.
- ALI-AC-2, ALI-AC-3, and ALI-AC-6: run `npm run build` in `docs/` and inspect
  English and Simplified Chinese output.
- ALI-AC-6: run `git diff --check`, then use the repository preview and browser
  inspection at desktop and 390-pixel mobile widths. Check hero wrapping,
  actions, horizontal overflow, and console/page errors in both locales.

### Implementation Evidence

- ALI-AC-1 through ALI-AC-5: `node --test test/docs-site.test.mjs
  test/docs-entrypoints.test.mjs test/docs-dx.test.mjs` passed 22 of 22 tests.
- ALI-AC-4 and markdown routing: `node --test
  test/doc-link-graph.test.mjs` passed 6 of 6 tests; the generated routing graph
  remained current.
- ALI-AC-2, ALI-AC-3, and ALI-AC-6: `npm run build` in `docs/` produced both
  English and Simplified Chinese optimized builds successfully.
- ALI-AC-6: the repository preview returned `ok` from `/health` and JavaScript
  with HTTP 200 from `/canvas-module.js`; `git diff --check` passed.
- ALI-AC-6: in-app browser inspection at 1440x1024 and 390x844 confirmed both
  locales had matching titles and descriptions, readable hero wrapping, visible
  primary actions, no horizontal overflow, and no console errors or warnings.
  Screenshots are stored under
  `~/.codex/visualizations/2026/07/31/agent-work-loop-insights-verification/`.
- Full-suite boundary: root `npm test` passed 1003 of 1004 tests. The remaining
  `test/legacy-product-names.test.mjs` failure is caused by pre-existing,
  unrelated developer-experience review artifacts under `.harness/state` that
  contain personal username strings; those files are outside this spec's scope
  and were left unchanged.

## Risks

- **New-category comprehension:** `Agent Work Loop` is ownable but unfamiliar.
  Mitigation: keep the category in the eyebrow and explain the concrete user
  outcome in the H1 and lead.
- **Search-language drift:** replacing `review` could remove a familiar search
  term before query evidence exists. Mitigation: retain `AI coding`, `coding
  agents`, and `workflow` in metadata and measure search impact separately.
- **Capability overstatement:** `insights` and `improve` can imply telemetry or
  automatic optimization. Mitigation: say that Better Harness turns project and
  session evidence into prioritized, verifiable next steps, and preserve the
  explicit causal-proof boundary.
- **Bilingual layout regression:** the new Chinese hero can wrap differently
  from English. Mitigation: inspect both locales at desktop and mobile widths.
