# Provider-aware Checkup Plan Binding

Make checkup plan and apply fail closed across hosts so non-Qoder providers
never receive `qodercli` mutations and `provider-home` paths always resolve
through the plan's explicit provider.

## Traceability

- Spec ID: 2026-07-31-ha02-provider-aware-checkup-plan
- Story: roadmap.md Host Adapter Enablement HA-02
- Status: Implemented

## Intent

Checkup plan currently hard-codes Qoder mutation and home binding:

1. `buildCheckupPlan()` always emits `qoder-cli` / `qodercli` disable actions
   for Skill, MCP, and plugin candidates, including when `scan.provider` is
   `codex`, `cursor`, or another host.
2. `resolveSourceRef()` and scan fingerprinting always bind `provider-home` to
   Qoder home (`qoderHome` / `~/.qoder`), so a patch can resolve into another
   host's configuration root.

Roadmap HA-02 requires provider-aware planning and fail-closed binding:
source references and provider-home paths bind to one explicit provider, and
no plan routes through another host's executor or configuration root.

## Acceptance Scenarios

- AC-1: For `provider=qoder`, plan still emits disable-first `qoder-cli`
  mutations for eligible Skill, MCP, and plugin candidates, and apply still
  executes confirmed Qoder argv without a shell.
- AC-2: For non-Qoder providers (`codex`, `cursor`, `claude`, and other
  inventory hosts), candidate plans never contain `qoder-cli` or `qodercli`
  mutations. Unsupported automatic disable becomes `manual-review`.
- AC-3: `provider-home` source resolution and scan fingerprints use the home
  owned by the explicit plan/scan provider. A Codex plan with only
  `codexHome` never resolves into a Qoder home path.
- AC-4: Apply rejects `qoder-cli` mutations when `plan.provider !== "qoder"`
  before spawning any process.
- AC-5: Existing Qoder plan digest stability for pure Qoder fixtures remains
  covered; focused checkup tests pass.

## Non-goals

- Do not implement HA-01 capability profiles (`full-session`,
  `inventory-only`, `unsupported`).
- Do not invent provider-native automatic apply for Codex, Cursor, Claude,
  Qwen, Copilot, Pi, or WorkBuddy.
- Do not redesign the checkup finding model, observation window, or cleanup
  eligibility census.
- Do not change Secret Guard, report, or session-analysis behavior outside
  checkup plan/apply home binding.

## Plan and Tasks

1. Add a shared provider-home resolver that maps an explicit provider to the
   matching inventory/options home field (`qoderHome`, `codexHome`,
   `cursorHome`, `claudeHome`, `qwenHome`, `copilotHome`, `piHome`,
   `workbuddyHome`) with portable defaults only when needed for that provider.
2. Update `relativeSourceRef`, fingerprint collection, and `resolveSourceRef`
   to require/use that provider-owned home for `provider-home` bases.
3. Gate `qoderMutation()` and plan confirmation so only `provider=qoder` can
   produce or advertise automatic `qoder-cli` apply; other providers emit
   `manual-review` and mark apply unavailable when no applyable mutation
   remains.
4. Make apply refuse cross-provider `qoder-cli` execution.
5. Add focused regression tests for AC-1 through AC-4.

## Test and Review Evidence

- `node --test test/harness-checkup.test.mjs`
- Manual reproduction before/after:
  `buildCheckupPlan({ provider: "codex", ...candidate })` must not emit
  `qodercli`.
- Risk: low/medium safety fix; Qoder path remains the only automatic apply
  executor. Residual risk: source-patch still applies only to allowed
  extensions under workspace or the bound provider home; no new host mutation
  contract is claimed.
