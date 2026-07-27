# Analyst Positioning

A maturity report for positioning, segmentation, and benchmarking. It explains
where the assessed object sits, how it differs from peers, and where it should
move next.

## Reference Mood

Gartner / Forrester / IDC-style analyst research reports. Define the evaluation
frame first, then express relative position through matrices, quadrants, bands,
segments, or benchmarks.

Use the positioning method and research-report feel as inspiration, but do not copy branded quadrants, naming systems, marks, or layouts.

## When To Use

- Comparisons across teams, projects, repositories, vendors, or product lines.
- Portfolio reviews, technology strategy assessments, and platform capability benchmarking.
- Situations that need to answer "what type are we," "how far are we from the target state," and "where should we move next."
- Assessments where samples differ meaningfully and need to be tiered or classified.

## Information Architecture

- Define the coordinate system first, then present the positioning result.
- Explain the classification basis before explaining why each object lands where it does.
- Position judgments must include a reference frame: target state, portfolio average, leading practice, or peer group.
- Recommendations should vary by segment; different object types should not receive the same upgrade path.

## Structure Pattern

1. Position statement: state the current segment, maturity level, and relative position.
2. Evaluation frame: define evaluation dimensions, axes, tiering rules, and sample scope.
3. Positioning matrix: show position through quadrants, bands, or waves.
4. Segment definitions: explain each segment's traits, risks, capability boundaries, and next move.
5. Peer comparison: show gaps against internal teams, portfolio average, target state, or leading practice.
6. Movement path: describe the conditions required to move from the current position to the target position.
7. Segment recommendations: give differentiated recommendations by type and avoid one-size-fits-all prescriptions.

## Visual Language

- Research-report feel, emphasizing classification, position, and relative relationships.
- Works well with a 2x2 quadrant, band, benchmark bar, segment cards, and movement arrow.
- Quadrants must explain the horizontal axis, vertical axis, and boundary logic.
- Segment cards should include traits, risks, and next move.
- Comparison visuals must be interpretable; avoid graphics that only add decoration.

## Visualization Style

- Primary visualization family: benchmark, segment, or movement-path comparison;
  use bars, lines, bands, quadrants, or movement arrows to show relative
  position and direction of travel.
- The second report section should be a positioning matrix that explains where
  issues cluster by axis, segment, or movement barrier.
- Supporting visualization blocks: segment table, movement-path rows, and an
  optional radar profile only when the report has multi-axis positioning values
  on a shared scale.
- Keep axes and peer labels short. Do not turn analyst positioning into a
  prescription-first engineering diagnosis.
- If the Markdown `Score model` says `no aggregate score used`, any numeric
  chart values must be labeled as ordinal indicators, sampled counts, or another
  explicit non-aggregate measure. Include adjacent criteria for why each segment
  or axis gets its value; do not let values such as `5, 5, 4, 4, 5` read like
  unsupported precision.

## Content Granularity

- Keep each segment definition brief; do not turn it into a long introduction.
- Benchmark gaps should state which dimension differs, not simply say ahead or behind.
- Movement paths should describe prerequisites, not become execution plans.
- When the sample size is small, focus on comparison with the target state instead of forcing an industry ranking.

## Boundaries

- Do not write a single-project engineering diagnosis.
- Do not stack execution roadmaps.
- Do not build an audit evidence register.
- Do not provide an industry ranking without data support.
- Do not copy Gartner Magic Quadrant or any branded analyst layout.
