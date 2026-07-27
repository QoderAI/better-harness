# Triangulated Spec Review Loop

Use this reference when running multi-agent review rounds for a spec, ADR, or
architecture proposal.

## Prompt Contract

Ask each reviewer to read the same target file and return JSON:

```json
{
  "reviewer": "claude|qodercli|agent|codex",
  "verdict": "pass|fail",
  "p1_p2_clear": true,
  "summary": "...",
  "findings": [
    {
      "severity": "P1|P2|P3",
      "dimension": "complexity|convenience|evolution",
      "issue": "...",
      "evidence": "...",
      "recommendation": "..."
    }
  ]
}
```

`agent` is Cursor's CLI.

Default dimensions:

- `complexity`: whether the design is understandable and not over-factored.
- `convenience`: whether contributors and agents can find the correct edit
  target.
- `evolution`: whether the design can grow without migration traps.

## Severity Rubric

- `P1`: blocks adoption because the spec is unsafe, contradictory, or likely to
  cause wrong edits.
- `P2`: should be fixed before acceptance because the spec is ambiguous,
  inconvenient, or likely to drift.
- `P3`: useful polish that does not block acceptance.

Only `P1` and `P2` findings drive mandatory iteration.

## Reviewer Command Matrix

Prefer cross-platform argv execution from the bundled script. When running
manually, use equivalent commands:

```bash
claude -p --permission-mode dontAsk --max-budget-usd 0.50 --tools Read,Glob,Grep,LS
```

```bash
qodercli --cwd <repo> --setting-sources user,project,local --permission-mode dont_ask --max-output-tokens 3000 -p "$PROMPT"
```

```bash
agent -p --mode ask --trust --workspace <repo> "$PROMPT"
```

If `codex` is part of the requested surface, use the locally supported
noninteractive command and keep the same prompt and output schema.

## Iteration Pattern

1. Run all reviewers against the same spec.
2. Parse findings into `P1`/`P2`/`P3`.
3. Cluster duplicate issues by target concept, not by wording.
4. Patch the smallest owning section for `P1`/`P2`.
5. Run local validation.
6. Re-run reviewers with the same prompt.

Stop when all required reviewers return `p1_p2_clear: true`.

## Common Finding Patterns

- **Layer collision**: two directories own the same behavior.
- **Target-only trap**: a future directory is written as if it exists today.
- **Naming collision**: two paths share a term but have different ownership.
- **Generated-vs-source ambiguity**: package output is not marked generated.
- **Promotion gap**: example, community, or draft assets can become runtime
  policy without an explicit gate.
- **Adapter leakage**: host-specific rules leak into shared detector or report
  logic.
