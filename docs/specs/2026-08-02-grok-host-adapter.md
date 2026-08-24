# Spec: Grok CLI host adapter

**Date:** 2026-08-02
**Host id:** `grok`
**Host version (verified):** Grok CLI 0.2.x (user-guide + local `~/.grok`)
**Capability level (this PR):** Partial adapter → Verified assets + sessions + HTML render path
**Non-goals:** Grok marketplace packaging into public npm shell; Canvas mode; reading `auth.json` secrets; claiming full Quickstart until native install smoke is recorded.

## Support slices

| Slice | Status | Owner |
| --- | --- | --- |
| Shell / discovery | Partial — Skill path + optional thin docs; no `.grok-plugin` required for analysis | docs + `skills/better-harness` |
| Configured assets | Claimed | `scripts/agent-customize/providers/grok.mjs` |
| Session evidence | Claimed | `scripts/session-analysis/platforms/grok.mjs` |
| Evidence bundle / registries | Claimed | capability indexes + `evidence-bundle` |
| Output | Claimed — HTML visual | `.grok/better-harness` host root |
| Packaging (npm shell) | Unavailable this PR | — |

## Native contract (verified)

| Item | Value |
| --- | --- |
| Home | `GROK_HOME` env, else `~/.grok` |
| Config | `$GROK_HOME/config.toml`; project may also use `<ws>/.grok/config.toml` |
| Skills | `$GROK_HOME/skills/`, `$GROK_HOME/bundled/skills/`, `~/.agents/skills/`, `<ws>/.grok/skills/`, `<ws>/.agents/skills/` |
| Hooks | `$GROK_HOME/hooks/*.json`, project `.grok/hooks` when present |
| MCP | `[mcp_servers.<name>]` tables in user and project `config.toml` (enabled flag) |
| Plugins | Trusted user `$GROK_HOME/plugins/`, legacy `$GROK_HOME/installed-plugins/`, project `<ws>/.grok/plugins/`, plus `[plugins].paths` from config; physical roots are deduped by realpath while distinct roots keep distinct ids |
| Sessions | `$GROK_HOME/sessions/<url-encoded-cwd>/<session-id>/` with `summary.json`, `updates.jsonl`, optional `chat_history.jsonl`, `signals.json` |
| Long cwd groups | When `encodeURIComponent(cwd)` exceeds 255 bytes, Grok uses a slug+hash group directory and stores the original path in `.cwd` |
| Report root | `<workspace>/.grok/better-harness/` |
| Output mode | `html` |

### Workspace qualification

- Prefer `summary.json` → `info.cwd` (or equivalent) matched via existing workspace-match helpers.
- Session group directory name is normally `encodeURIComponent(absoluteCwd)` (e.g. `/Users/work` → `%2FUsers%2Fwork`).
- Long-path groups are also matched when `.cwd` records a workspace-qualified path.
- Foreign-workspace sessions never enter facts for a report.

### Conversation evidence

- `updates.jsonl` is the authoritative conversation log; `chat_history.jsonl` is only used when updates are missing (never both).
- Terminal tool results require an explicit terminal status (`completed` / `failed` / `error` / `cancelled` / `canceled`); progress and status-less `tool_call_update` stay metadata.
- Model usage comes from `turn_completed.usage` on `_x.ai/session/update` records; nested `usage.modelUsage.<modelId>` values are summed and fill only the fields flat usage did not report.
- `signals.contextTokensUsed` is context-window occupancy, not total spend; it is never mapped to `totalTokens`.

### Privacy

- Never serialize `auth.json`, API keys, or MCP `env` secret values.
- Inventory may record server names, enabled flags, and path existence only.

### Stated approximations

- Plugin `enabled` follows `[plugins].enabled` / `[plugins].disabled` when present. When neither list is declared, discovered plugin directories are treated as enabled for inventory (filesystem presence), which is a documented approximation of Grok's runtime enablement/trust model rather than a full parity claim.
- The user and project `[plugins]` tables are unioned rather than overridden, so neither config can silently drop the other's declared paths, and the declaring scope is not recorded per entry.
- Marketplace catalog entries under `marketplace-cache/` are not treated as installed plugins without an install root.

## Acceptance ids

| Id | Criterion |
| --- | --- |
| Grok-A1 | Provider inventory returns skills/hooks/mcp/plugins scopes for synthetic home + workspace |
| Grok-A2 | `GROK_HOME` / `--grok-home` overrides default without foreign home fallback |
| Grok-A3 | One physical plugin root discovered via multiple path aliases counts once (realpath dedupe); two distinct roots sharing a directory name stay distinct |
| Grok-A4 | Project-scope inventory (`includeUserHome: false`) records no user-home plugin roots or user config path |
| Grok-S1 | Session sources list only cwd-matching sessions under encoded group dir |
| Grok-S2 | Foreign session group excluded from sources |
| Grok-S3 | Missing `signals.json` usage stays unobserved (not zero-filled); `contextTokensUsed` alone does not invent totals |
| Grok-S4 | Unknown `updates.jsonl` events preserved as metadata |
| Grok-S5 | Nested `turn_completed.usage.modelUsage` contributes observed model usage, including completing partial flat records |
| Grok-R1 | `platform=grok` accepted by evidence-bundle and session-analysis CLI help |
| Grok-R2 | HTML render default out root resolves to `.grok/better-harness`; unsupported `--platform` values fail closed while `--help` stays usable |

## Smoke (local)

```bash
node scripts/session-analysis.mjs sources --platform grok --workspace <path>
node scripts/better-harness.mjs agent-customize inventory --provider grok --workspace <path>
node scripts/better-harness.mjs harness evidence-bundle --platform grok --workspace <path> --depth quick --format json
```

Install skill for Grok TUI:

```bash
ln -sfn <repo>/skills/better-harness ~/.grok/skills/better-harness
# then in a target repo: /better-harness …
```
