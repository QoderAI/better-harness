# New Coding Agent Contribution Guide

## Traceability

- Spec ID: `new-coding-agent-contribution-guide`
- Status: Implemented

## Intent

Give contributors one evidence-first route for adding a Coding Agent host to
Better Harness. The guide should turn the lessons visible in the Qwen Code and
GitHub Copilot contributions into a reusable contract without making either
pull request the source of truth.

## Acceptance Scenarios

- **NCAG-AC-1 (discoverable route):** A contributor starting from the root
  `AGENTS.md`, root README, `CONTRIBUTING.md`, community extension map,
  canonical host matrix, or published Hosts documentation can reach the new
  guide.
- **NCAG-AC-2 (complete host slices):** The guide distinguishes native host
  research, thin shell metadata, configured-asset collection, session evidence,
  shared registration, documentation, packaging, and output routing, while
  allowing unsupported slices to remain explicitly unavailable.
- **NCAG-AC-3 (evidence and safety):** The guide requires native-contract
  evidence, workspace qualification, privacy-safe normalization, deterministic
  fixtures, real-host smoke evidence or an explicit unavailable note, and
  Windows/macOS/Linux validation proportional to the changed behavior.
- **NCAG-AC-4 (traceable workflow):** The guide routes contributors through a
  spec, stable acceptance ids, scoped commits, Review Readiness Check evidence,
  and the repository's pull request template without inventing Story, AI, CI,
  or host-support claims.
- **NCAG-AC-5 (worked examples):** The guide links
  [PR #6](https://github.com/QoderAI/better-harness/pull/6) and
  [PR #22](https://github.com/QoderAI/better-harness/pull/22) as contrasting
  worked examples and states what lesson to inspect in each, without treating
  their descriptions or current states as timeless contracts.
- **NCAG-AC-6 (publication integrity):** English canonical guidance and the
  English/zh-Hans curated site pages remain consistent, all relative Markdown
  links resolve, and the Docusaurus site builds with zero broken links.

## Non-goals

- Adding, repairing, approving, merging, or otherwise changing PR #6 or PR #22.
- Adding a new host adapter, provider enum, manifest, session parser, report
  mode, or packaging target.
- Declaring every host capable of session evidence or every shell publishable.
- Replacing `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/community.md`, or the
  canonical host matrix as their respective sources of truth.
- Freezing third-party host internals in this guide; contributors must cite the
  host version and primary source they actually verified.

## Plan and Tasks

1. Add `docs/adapters/contributing-new-coding-agent.md` as the canonical
   contribution workflow beside the host matrix.
2. Structure it as a sequence from research and support-scope decisions through
   implementation slices, evidence, packaging, documentation, and review.
3. Link the two pull requests in a bounded worked-examples section and link the
   repository instructions and architecture owners throughout the route.
4. Add an English curated page under `docs/docs/hosts/`, a matching zh-Hans
   translation, and sidebar routing without duplicating canonical judgment.
5. Add navigation from `AGENTS.md`, `CONTRIBUTING.md`, `README.md`,
   `README.zh-CN.md`, `docs/community.md`, `docs/adapters/README.md`, and the
   published adapter matrix pages.
6. Run the link graph, site build, focused tests, full repository tests, and a
   final diff/readiness review; update this status only when evidence supports
   it.

## Test and Review Evidence

- **NCAG-AC-1/5:** inspect the final diff and follow every guide/PR/instruction
  link from each named entry page.
- **NCAG-AC-6:** regenerate the Better Harness Markdown graph with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then run
  `node --test test/doc-link-graph.test.mjs test/docs-site.test.mjs`.
- **NCAG-AC-6:** run `npm ci && npm run build` from `docs/`; both locales must
  build with zero broken links.
- **NCAG-AC-2/3/4:** run `npm test` because repository tests enforce some
  provider and documentation contracts; no runtime behavior should change.
- **All ACs:** run `git diff --check`, inspect staged/unstaged scope separately,
  and apply the Change Traceability Review Readiness Check before handoff.

Observed on 2026-07-30:

- `node scripts/doc-link-graph/cli.mjs skills/better-harness` regenerated the
  34-file / 50-link graph with no tracked drift.
- `node --test test/doc-link-graph.test.mjs test/docs-site.test.mjs` passed 7/7.
- `npm ci && npm run build` from `docs/` built English and zh-Hans with zero
  broken links.
- `npm test` passed 867/867 after preserving the tested canonical-owner phrase
  in the community intake matrix.
- `npm run pack:verify` passed with 311 npm entries and 337 runtime ZIP entries.
- `git diff --check` passed; the final readiness review found documentation and
  site-source changes only, with no staged files or generated graph drift.

## Risks

- **Guide drift:** concrete path lists can become stale as new hosts arrive.
  Mitigation: point to registry/search commands and canonical owners, and use
  the PRs only as examples.
- **False parity:** contributors may copy another adapter and overclaim support.
  Mitigation: require a per-slice support decision, source-backed host contract,
  and explicit unavailable/partial states.
- **Credential or transcript exposure:** real-host validation can leak private
  data. Mitigation: require sanitized fixtures, bounded smoke output, and no raw
  transcripts or secrets in commits or PR text.
- **Published-doc duplication:** the curated website can diverge from repository
  guidance. Mitigation: keep the repository guide canonical and make the site
  page a concise route back to it.
