# Engineering Diagnosis

A maturity diagnosis for engineering systems or code repositories. It shows
diagnostic status, observed symptoms, root causes, risks, repair actions, and
follow-up checks for engineering teams.

## Reference Mood

Engineering diagnostics / system diagnosis reports / technical remediation
reviews. Organize information around diagnostic status, observed signals,
symptoms, root causes, and next actions.

The emphasis is diagnosis and repair, not formal audit or executive strategy reporting.

## When To Use

- Diagnostic assessments for code repositories, engineering systems, verification systems, delivery paths, and platform engineering.
- Materials for engineering teams, Tech Leads, architects, platform teams, and R&D managers.
- Situations that need to answer "what is broken," "why is it happening," and "what should be fixed first."
- Inputs that contain scan signals, failure modes, risks, validation results, or historical trends.

## Information Architecture

- Start with the diagnostic verdict, then break down the diagnostic signals.
- Symptoms should present only observed phenomena and evidence; Diagnosis explains the causes.
- Organize repair actions by priority, not by discovery order.
- Every repair recommendation should include a follow-up method or pass criteria.

## Structure Pattern

1. Diagnostic verdict: state the overall diagnostic status, maturity level, risk level, and next-stage feasibility.
2. Diagnostic signals: show signals such as test coverage, CI stability, validation repeatability, rollback, permissions, and observability.
3. Symptoms detected: list symptoms, trigger signals, evidence, severity, and affected scope.
4. Diagnosis: explain primary diagnosis, secondary diagnosis, root-cause chain, and excluded causes.
5. Risk and impact: describe the engineering or delivery risk if the issue is not fixed.
6. Repair actions: give short-term fixes, medium-term governance actions, and long-term optimizations.
7. Follow-up checks: define the review time, review metrics, and pass criteria.

## Visual Language

- Technical diagnostic feel: direct, engineering-oriented, and actionable.
- Works well with a diagnostic badge, signal cards, symptom cards, root-cause map, and repair-action table.
- Lightweight status colors are fine, but avoid alarmist language.
- The diagnosis area should emphasize causal chains; the repair area should emphasize priority and verifiable action.
- The follow-up checklist should be more specific than the recommendation prose.
- For high-impact systems, keep severity, blast radius, affected subsystem,
  evidence strength, root-cause chain, and risk if unfixed visible near the top.

## Visualization Style

- Primary visualization family: diagnostic path; use a stage path, ribbon,
  or ladder that shows the current diagnostic stage, blocker, and next feasible
  movement.
- The second report section should be a diagnostic signal matrix when dimensions
  are scored, or a compact finding-evidence table when they are not.
- Supporting visualization blocks: priority repair action card and follow-up
  checks. Use compact tables for follow-up checks.

- Define the score scale near the diagnostic path when numeric stage values are
  shown. When the Markdown `Score model` says `no aggregate score used`, label
  the values as ordinal stage signals.
- Use section spacing and padding instead of bare Divider separators.
- When there are multiple priority repair actions, place them in a responsive
  grid; wide screens should show two cards per row.
- If a path or flow visual is unavailable in the selected output mode, use a
  bar or line-style diagnostic-signal chart and keep the fallback note visible instead
  of downgrading to cards and tables only.
- Do not lead with a radar profile, risk heatmap, or dashboard KPI strip.

## Content Granularity

- The diagnostic verdict should be brief, not a long background explanation.
- Diagnostic signals should focus on signals, not become a full capability maturity table.
- Diagnosis should not repeat Symptoms; it should explain the mechanism behind them.
- High-impact unverified paths should remain risk findings, not soft caveats.
- Repair actions should distinguish short-term containment, medium-term governance, and long-term optimization.

## Boundaries

- Do not provide only a maturity level; explain symptoms and root causes.
- Do not attribute every symptom to a single cause.
- Do not write a board-level strategy brief.
- Do not write a formal audit report or industry opinion piece.
