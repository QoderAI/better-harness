# Review Trigger Hooks

This directory is the hook-facing entrypoint for the default proactive review
chain. Keep lifecycle wiring and source routing visible here; keep reusable
runtime code in capability-owned `scripts/` modules.

## Default Stop Chain

```text
hooks/hooks.json.template
  -> node scripts/review-trigger/cli.mjs --mode=stop
  -> source normalizers
  -> findings envelope
```

The current default sources are:

| Source | Code owner | Purpose |
|---|---|---|
| Agent instructions | `scripts/agent-lint` with `agents-md-review` | Root guide length, missing references, command/risk/fact gaps |
| Change test evidence | `scripts/review-trigger` using lightweight git diff metrics | Large changes without changed test files |

## Output Contract

The Stop chain produces a findings envelope, not a single finding:

```json
{
  "kind": "better-harness.review-trigger",
  "status": "ok|findings|skipped",
  "summary": {
    "findings": 0,
    "errors": 0,
    "warnings": 0,
    "advisories": 0,
    "maxSeverity": "none"
  },
  "findings": []
}
```

Each source may emit zero or more finding rows. Local summary counts describe
the full collected list.

## Extension Rules

- Add reusable collection or scoring logic under the owning `scripts/`
  capability, not under this directory.
- Add review-trigger normalization under `scripts/review-trigger/` when a source
  should feed Stop-hook findings.
- Keep default Stop sources offline, deterministic, non-blocking, and
  cross-platform. Default sources should avoid full repository parsing.
- Keep repo-local evidence separate from user/global capability evidence.
  User/global Skills, MCPs, or memories require an explicit scope flag.
- Report configured assets as configured evidence only; do not claim runtime use
  without session, hook, or runtime evidence.

## Candidate Asset Threshold Source

Asset threshold findings should reuse `scripts/agent-lint` and
`scripts/agent-customize` inventory.

| Asset | Comfortable range | Scope |
|---|---:|---|
| Core instruction files: `AGENTS.md`, `CLAUDE.md`, project Rules | 1-3 files; root files below 200 lines | project default |
| Repo Skills | 3-10 Skills | project default |
| User/global Skills | 10-30 Skills | explicit user/global only |
| Single MCP server high-value tools | 5-15 tools; split or namespace above 20 | visible configured/runtime evidence |

When this source is enabled, it should emit ordinary finding rows in the same
envelope instead of creating a separate threshold report.
