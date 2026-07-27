# Audit Scorecard

A maturity score report designed to be reviewable and traceable. It closes the
loop from scope to score to evidence to gaps to remediation.

## Reference Mood

CMMI / ISO / NIST CSF / Secure SDLC / internal control audit reports. The
pattern is clear scope, stable scoring criteria, traceable evidence, reviewable
exceptions, and trackable remediation.

Credibility comes from the evidence chain, not narrative packaging.

## When To Use

- Security, compliance, governance, Secure SDLC, and internal control maturity assessments.
- Formal assessments, audit trails, governance reviews, and remediation tracking.
- Situations where ratings must be reviewable, signable, and traceable.
- Inputs that include controls, scoring dimensions, evidence materials, and remediation accountability.

## Information Architecture

- Define assessment scope and scoring criteria before giving the rating.
- Every score must trace back to evidence or missing evidence.
- Risks and exceptions should be differentiated by severity; do not present every issue as equal.
- Remediation items should close back to controls, not remain generic suggestions.

## Structure Pattern

1. Scope and method: describe object, timing, scope, exclusions, scoring criteria, and data sources.
2. Overall rating: provide overall score, maturity level, confidence, and pass/fail status.
3. Scoring criteria: explain dimensions, weights, level definitions, and scoring rules.
4. Control scorecard: list each control, score, status, evidence, and gap.
5. Evidence register: record evidence name, source, covered dimension, credibility, and missing items.
6. Findings and exceptions: list nonconformities, severity, impact, evidence, and owner.
7. Remediation tracker: list remediation items, priority, owner, due date, and verification method.

## Visual Language

- Tables, matrices, status labels, evidence registers, and remediation trackers.
- Keep status enums stable: Pass, Partial, Missing, Risk, Not assessed.
- Use High, Medium, and Low for confidence.
- Risk and Missing should be clearly visible, but avoid large areas of warning color.
- Pages should be stable, restrained, and easy to review; do not pursue visual drama.

## Visualization Style

- Primary visualization family: risk/control concentration heatmap that exposes
  where evidence, exceptions, residual risk, or control gaps cluster.
- The findings section should use that heatmap as a risk/gap concentration
  view, then show the evidence register, control scorecard, and remediation
  tracker. Use a maturity matrix only when maturity levels are explicitly
  scored; otherwise omit it.
- Heatmap cells must represent residual risk, missing evidence, exception
  concentration, or control gaps. Do not encode a strong control as `high` or
  `critical`; use those values only when the cell is risky.
- Name heatmap axes as risk or gap axes, such as `Evidence risk` or
  `Execution risk`, or add nearby text explaining that low/medium/high encode
  risk intensity rather than evidence strength.
- Include a visible `Risk heatmap criteria` or `Risk hotspot rationale` table in
  Markdown and the visual companion. Each row should connect the heatmap area to
  inspected evidence, missing proof, and the reason for the risk level.
- When a static numeric score is shown, add a `Score model` or audit caveat
  table explaining the formula, scale, and static-only boundary.
- The evidence panel should cover the concrete inspected evidence named in the
  Evidence Boundary. If a file was only filename-inspected, label it that way
  instead of treating it as content-level proof.
- Prefer one compact remediation tracker for mobile readability. If the source
  action table is wide, repeat trigger, next action, pass check, owner, timing,
  evidence artifact, and impact in the compact row instead of splitting the same
  action into multiple duplicate tables.

## Content Granularity

- Findings should be short and explicit, with impact and evidence references.
- The evidence register should not be hidden in prose; make it a scannable table.
- Heatmap values must not stand alone; include the criteria or rationale that
  explains why a cell is `low`, `medium`, `high`, or `critical`.
- Remediation must include responsibility, timing, or verification method; otherwise mark it as TBD.
- Data limitations, uncovered scope, and confidence limits must be shown clearly.

## Boundaries

- A control without evidence cannot default to passing.
- Missing evidence must be marked as Missing, `[evidence not provided]`, or `[needs validation]`.
- Do not replace evidence with storytelling.
- Do not write this as a consulting brief, opinion piece, or promotional material.
