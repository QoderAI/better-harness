# Executive Dashboard

A maturity dashboard for recurring status monitoring. It helps readers see
current status, trend changes, anomalies, risk concentration, and current-cycle
actions quickly.

## Reference Mood

Power BI / Tableau / business operating dashboards / executive cockpits. Explain
status at a glance, emphasize anomalies and trends, and keep hierarchy clear.

The visuals should support scanning and management follow-up, not showmanship.

## When To Use

- Monthly, quarterly, or recurring maturity operations reviews.
- Multi-team, multi-project, multi-repository, or multi-dimensional engineering maturity monitoring.
- Materials for CTOs, VPs of Engineering, platform leads, PMOs, or organizational operations teams.
- Data that includes time series, team dimensions, risk status, or action status.

## Information Architecture

- Start with overall status, then trend, then anomalies, then actions.
- Metrics must serve management judgment; do not dump every available number.
- Anomalies, risks, and owners take priority over background explanation.
- Current-cycle actions should be tied to risks or metric changes.

## Structure Pattern

1. Status header: show overall level, average score, trend, risk count, last updated time, and data scope.
2. KPI cards: show core metrics, period-over-period change, target line, and status.
3. Maturity trend: show period changes, target gaps, and sources of change.
4. Portfolio heatmap: use team by dimension to identify low-score areas and risk clusters.
5. Distribution: show L1-L5 distribution, segment share, or team status structure.
6. Anomalies and top risks: list declining areas, abnormal movements, risks above threshold, and owners.
7. Actions this cycle: show current-cycle actions, responsible people, due dates, and status.

## Visual Language

- Short, dense, and scannable: status first, then anomalies, then actions.
- Works well with a KPI strip, sparkline, heatmap, distribution chart, risk table, and action tracker.
- Use status colors only for semantics such as Good, Watch, Risk, and Blocked.
- Static numbers must explain direction of change, threshold meaning, or target gap.
- Charts should be few and clear; do not imply complex interactivity that is not actually present.

## Visualization Style

- Primary visualization family: KPI strip plus trend or category movement
  chart that can be scanned without reading the whole report.
- The second report section should be a risk concentration heatmap or anomaly
  matrix, followed by the current-cycle action table.
- Heatmap cells must represent residual risk, anomaly concentration, or
  target gaps. Do not encode healthy status as `high` or `critical`; those
  values are reserved for risk intensity.
- Include a visible `Risk heatmap rationale` table in Markdown and the visual
  companion. Each row should define the heatmap axis, risk value, and evidence
  or missing proof that justifies the cell.
- If the current-cycle action table has many fields, add a compact action
  summary before the wide table so owner, timing, evidence artifact, and impact
  remain readable in mobile preview.
- Do not build a long diagnostic report or a single maturity matrix as the main
  view.

## Content Granularity

- Limit the number of KPI cards; prioritize anomalies and target gaps.
- Use heatmaps to find differences, not to show every detail.
- Top risks need an owner or status, otherwise they cannot drive follow-up.
- Actions this cycle should show the current period, not expand into a long-term roadmap.

## Boundaries

- Do not write a long diagnostic report.
- Do not build a formal audit scorecard.
- Do not give every metric equal visual weight.
- Do not use a dark, flashy command-center style.
- If period data is missing, mark it as `[period data not provided]`.
