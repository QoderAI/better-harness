# AI plugin scanner CI

## Traceability

- Spec ID: ai-plugin-scanner-ci
- Status: Implemented

## Intent

Run the HOL AI Plugin Scanner in GitHub Actions so repository changes receive
the security and publishability gate required by the Awesome AI Plugins
contribution process.

## Acceptance Scenarios

- AC-1: A push starts a workflow that scans the repository root in `scan` mode.
- AC-2: A pull request starts the same scanner workflow.
- AC-3: The scanner fails when the score is below 80 or a high-or-greater
  severity finding is present.
- AC-4: The workflow invokes the canonical
  `hashgraph-online/ai-plugin-scanner-action` action and is accepted by the
  upstream contribution gate.
- AC-5: Reviewed false positives are suppressed by path without disabling
  scanner rules or weakening the required score and severity thresholds.

## Non-goals

- Changing scanner findings unrelated to installing the required CI gate.
- Enabling SARIF upload, automated submissions, or pull-request comments.
- Changing existing CI, release, or Pages workflows.

## Plan and Tasks

1. Add a least-privilege workflow under `.github/workflows/` for pushes and
   pull requests.
2. Pin the checkout and scanner actions while retaining the scanner's `v1`
   compatibility annotation for reviewability.
3. Configure the repository root, scan mode, score threshold, and severity
   threshold required by the upstream contribution gate.
4. Add path-scoped suppressions only for reviewed test, generated, documentation,
   asset, and source-code false positives.
5. Validate the workflow structure locally, then observe the pushed GitHub
   Actions run and the upstream contribution gate.

## Test and Review Evidence

- AC-1, AC-2: Parse the workflow and inspect the declared event keys.
- AC-3, AC-4: Parse the scanner step and assert its action identity and four
  required input values.
- AC-5: Run the same scanner version as CI and require score 80 or greater with
  no critical or high findings.
- AC-1 through AC-4: Push the workflow and inspect its GitHub Actions result.
- Risk: The scanner may expose pre-existing findings. Those findings remain
  visible follow-up work rather than being hidden or weakened by this change.
