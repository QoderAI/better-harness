# Style Routing

* `consulting-deck.md`: use for executive choices, strategic gaps, roadmap, and asks.
* `analyst.md`: use for axes, segments, benchmarks, comparisons, and movement paths.
* `audit-scorecard.md`: use when ratings need traceable evidence, scoring logic, and review confidence.
* `engineering-diagnosis.md`: use for symptoms, root causes, repair actions, follow-up checks, and improvement hints.
* `executive-dashboard.md`: use for KPIs, trends, anomalies, risks, and action status.
* `editorial-insight.md`: use for trend meaning, cases, maturity shifts, narrative interpretation, and implications.
* `transformation-playbook.md`: use for target state, initiatives, roadmap, RACI, operating model, and metrics.

## Internal Style Labels

Use stable file names as style ids and the English labels below for internal
routing. Selection prompts may localize them naturally, but report text, Canvas
metadata, HTML notes, titles, headings, and visual labels must not expose these
internal labels.

| Style id                     | Internal label          |
| ---------------------------- | ----------------------- |
| `consulting-deck.md`         | Consulting Brief        |
| `analyst.md`                 | Analyst Report          |
| `audit-scorecard.md`         | Audit Scorecard         |
| `engineering-diagnosis.md`   | Engineering Diagnosis   |
| `executive-dashboard.md`     | Executive Dashboard     |
| `editorial-insight.md`       | Editorial Insight       |
| `transformation-playbook.md` | Transformation Playbook |

# Combination Guidance

Usually choose one primary style. Borrowed elements should stay under 15% of
the report and serve the primary style's core question.

# Visualization Style Ownership

Each style file owns its own `Visualization Style` section. Use it for any
visual companion.

Style files should not repeat output-mode boilerplate. Keep them limited to
primary visual family, supporting blocks, evidence semantics, layout behavior,
and fallback guidance. `templates/reporting/routing.md` owns
output-mode selection and mutual exclusions; output-mode templates own
runtime-specific component names, imports, and prop shapes.

Do not add style-specific TSX examples to style files. Shared output-mode
templates may include compact prop-shape examples. Keep style files directive
rather than prescriptive so the host can adapt the visual layout to the evidence.
