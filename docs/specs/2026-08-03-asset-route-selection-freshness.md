# Asset route selection and freshness

## Traceability

- Spec ID: asset-route-selection-freshness
- Status: Implemented

## Intent

Keep the compact 16-route evidence budget without making a normal Better Harness review fail merely because more assets exist. The sampled routes must be the most recently modified routes available, and the envelope must state when collection occurred and how much timestamp evidence was available so reviewers can distinguish current evidence from an unqualified inventory snapshot.

## Acceptance Scenarios

- AC-1: When more than 16 owner routes exist, the baseline returns 16 items ordered by descending filesystem modification time, with deterministic fallback ordering for routes whose time is unavailable.
- AC-2: The owner-route envelope preserves `total`, `omitted`, and `truncated`, and adds an explicit `latest-modified` selection contract instead of presenting the sample as exhaustive.
- AC-3: Owner-route evidence records collection time, timestamp source, timestamped/untimestamped counts, and per-item `modifiedAt` when observable; missing file metadata remains bounded and does not abort inventory collection.
- AC-4: Intentional owner-route sampling does not make an otherwise healthy baseline partial. Truncated lint or integrity findings and unavailable stages continue to lower status exactly as before.
- AC-5: The normal evidence bundle accepts an agent-customize lane whose only incompleteness is the disclosed 16-route sample.

## Non-goals

- Increase the compact owner-route limit above 16.
- Read asset bodies, Memory bodies, or raw session content.
- Infer freshness from names, versions, route order, Git timestamps, or install metadata.
- Change finding truncation semantics or the authority boundary for user-home assets.

## Plan and Tasks

1. Add deterministic failing tests for latest-16 selection, freshness coverage, and non-blocking sampling.
2. Make the asset-baseline compactor collect file metadata through an injectable stat seam and clock, with at most 32 concurrent metadata probes.
3. Separate intentional `sampledStages` from evidence-loss `truncatedStages`; only the latter affects baseline status.
4. Add an evidence-bundle regression showing normal depth remains complete for a healthy sampled baseline.
5. Update operator-facing Better Harness reference text if it currently equates every compact owner-route omission with unavailable evidence.

Affected modules: `scripts/coding-agent-practices/asset-baseline.mjs`, the Better Harness root routing instruction, and focused baseline/evidence/Skill contract tests. The evidence-bundle adapter requires no production change because it already maps `complete` baselines to an available lane.

## Test and Review Evidence

- AC-1..AC-4: `node --test test/agent-asset-baseline.test.mjs`
- AC-5: `node --test test/better-harness-evidence-bundle.test.mjs`
- Full regression: `npm test`
- Generated doc routing after this new spec: `node scripts/doc-link-graph/cli.mjs skills/better-harness` and `node --test test/doc-link-graph.test.mjs`
- Review readiness: run the repository's Change Traceability Review over the final local diff before commit.
- Risk: filesystem timestamps may be absent or coarse. The contract reports timestamp coverage and uses deterministic fallback ordering rather than claiming false recency.

Observed on 2026-08-03:

- AC-1..AC-4: focused asset-baseline test passed, 11/11.
- AC-5: focused evidence-bundle test passed, 23/23.
- Root routing contract: focused Better Harness Skill test passed, 12/12.
- Full regression: `npm test` passed, 1020/1020, after installing lockfile dependencies.
- Documentation routing: generated graph remained current and the focused link suite passed, 6/6.
