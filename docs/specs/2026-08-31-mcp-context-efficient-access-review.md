# Context-Efficient MCP Access Review

## Traceability

- Spec ID: mcp-context-efficient-access-review
- Status: Implemented

## Intent

Improve the MCP configuration review guidance so reviewers first establish
whether a large effective MCP surface causes model-visible Schema, selection,
round-trip, payload, or discovery pressure. Only then should the review propose
Tool Search, MCP-to-CLI, Code Mode, or Context Engineering as targeted
remediations without weakening authorization, audit, or evidence boundaries.

## Acceptance Scenarios

- **AC-1:** The review keeps configured, effective, observed, healthy, and
  unavailable evidence separate from cleanup eligibility.
- **AC-2:** A high configured Server/tool count is a pressure signal, not by
  itself proof that remediation is required. The review distinguishes catalog
  size, effective/model-visible Schema, selection quality, tool-call round
  trips, polling, result payloads, and discovery turns.
- **AC-3:** After pressure is established, the review offers four targeted
  recommendations: Tool Search, MCP-to-CLI, Code Mode, and Context Engineering.
  It states the pressure each recommendation addresses and how they can layer.
- **AC-4:** Direct MCP remains the baseline or retained path when pressure is
  not established or native MCP semantics are needed. SaaS MCP is an important
  application scenario for the recommendations, not one of the four.
- **AC-5:** CLI and Code Mode recommendations preserve the underlying
  authentication, authorization, approval, secret-redaction, audit, timeout,
  retry, and output-boundary contracts.
- **AC-6:** The routed reference remains discoverable and the focused platform
  ordering and documentation-link tests pass.

## Non-goals

- Implement an MCP gateway, tool-search runtime, CLI, Code Mode executor, or
  context graph.
- Classify every MCP installation as needing one of the four remediations.
- Change Qoder configuration precedence, cleanup classifications, or runtime
  mutation authority.
- Claim that measurements from one company, model, host, or workload are
  universal performance targets.

## Plan and Tasks

1. Preserve the evidence ladder and cleanup classification contract in
   [MCP Configuration Review](../../references/agent-customize/mcp-review.md).
2. Put context-pressure evidence before remediation and keep tool count separate
   from demonstrated model-context or workflow cost.
3. Add a compact four-recommendation table plus security and output invariants
   for Shell/CLI and Code Mode paths.
4. Tighten remediation and recommendation fields while keeping platform notes
   after the shared review contract.

## Test and Review Evidence

- **AC-1–AC-5:** Review the rendered Markdown and local diff for decision
  clarity, scoped wording, and preserved evidence/authority boundaries.
- **AC-6:** Run
  `npx vitest run test/skills-docs/coding-agent-platform-notes.test.mjs test/skills-docs/doc-link-graph.test.mjs`.
- **AC-6:** Regenerate the routing graph with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness` and rerun the
  doc-link test if the generated graph changes.
- **AC-1–AC-6:** Run `git diff --check` and validate the containing Skill with
  the Skill Creator quick validator.

Implementation evidence after the recommendation-trigger correction on
2026-08-31:

- `node scripts/doc-link-graph/cli.mjs skills/better-harness` regenerated the
  39-file, 56-link graph without a tracked graph change.
- `npx vitest run test/skills-docs/coding-agent-platform-notes.test.mjs test/skills-docs/doc-link-graph.test.mjs`
  passed 12/12 tests across two files.
- `python3 /Users/phodal/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/better-harness`
  reported `Skill is valid!`.
- `git diff --check` passed for the tracked reference and generated graph; the
  new spec also passed an explicit trailing-whitespace check.

Risk is primarily premature remediation: a large catalog can be healthy when
the host already loads tools lazily, while an apparently small catalog can
still cause expensive polling or payloads. Review the final wording for an
evidence trigger, targeted recommendation, success parity, bounded execution,
and preserved host security boundaries.
