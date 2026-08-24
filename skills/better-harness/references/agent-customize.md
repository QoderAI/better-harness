# Agent Customize Evidence

Review the configured coding-agent layer and return independent finding
candidates. The lead supplies deterministic Step 1 inventory, lint, and asset
integrity envelopes; consume them rather than rerunning scanners. The lead owns
joins, deduplication, severity, scores, recommendations, and report copy.

## Boundary

- Inspect Rules/`AGENTS.md`, Skills, MCP/connectors, Memory/knowledge, Custom
  Agents, Hooks/gates/permissions, Commands, Workflows, and Plugins.
- Project assets are in scope by default, including selected-workspace Qoder Memory title metadata.
  User/global or Codex Memory, installed-plugin/marketplace metadata, and every Memory body require explicit lead authority.
- Do not inspect application code, Session facts, another brief, raw Memory bodies, private caches, transcripts, databases, or provider internals.
- Do not run Session/Harness analysis, asset scanners, cleanup, apply, or
  mutation commands. A failed Step 1 envelope stays unavailable.
- Open at most three relevant assets in quick mode or five in normal mode across all surfaces. Metadata rows do not consume the limit.

## Interpret the Baseline

Counts route inspection; they do not create findings or scores.

- Zero project Skills makes repeated-work discovery important, but may be
  correct when built-ins or simple instructions already own the work.
- Many Skills require trigger, routing, overlap, and maintainability review.
- Many Memories require exact/near duplicate, conflict, provenance, staleness,
  and retrieval-value review. Count never earns Learning Capture credit.
- Many MCPs require capability overlap, discoverability, least privilege, and
  workflow-owner review.
- Multiple Plugins require canonical-name, capability-fingerprint, version,
  replacement, and child-asset ownership review.
- A short `AGENTS.md` is not defective by length. Check whether it routes to
  current owners and states the few always-needed constraints. A long file is
  not defective without model-visible load or maintenance impact.

The deterministic `asset-integrity` envelope takes precedence over raw counts:

- prioritize authorized lint errors over count or similarity leads, but first
  corroborate the referenced target and canonical file identity;
- always return exact same-scope Memory-title collisions and verified Plugin
  name/capability overlaps as governance candidates with bounded evidence;
- treat near-title and plugin-family similarity as manual review leads only;
- never infer duplicate bodies, conflict, staleness, runtime cost, or removal
  authority from metadata similarity;
- inspect the smallest safe owner needed to corroborate conflict, replacement,
  stale truth, shadowing, or routing impact.

Account for every authorized surface as inspected, inventory-only, unavailable,
or not applicable; never omit one silently. This natural-language ledger is not
a finding schema, and metadata rows do not consume the asset-open limit.
If selected-workspace Qoder Memories are nonzero but integrity is unavailable,
return a blocking evidence condition; never call them clean or unobserved.

## Review Quality and Ownership

For the few task-relevant assets, keep these axes separate:

- **Presence:** configured, resolved-active, absent-in-scope, or unavailable.
- **Content:** relevant, current, discoverable, executable, maintainable, or not
  inspected.
- **Use:** routed and applied in the same Task Episode; a file read, invocation
  name, loaded prompt, or count does not prove use.
- **Outcome:** effective only after a comparable later outcome without a
  guardrail regression.

Load only the matching one-hop practice: [Rules/AGENTS.md](../../../references/agent-customize/agents-md-review.md), [Skill evaluation](../../../references/agent-customize/skill-eval.md), [Skill quality](../../../references/agent-customize/skill-review.md),
[Skill discovery](../../../references/agent-customize/skill-discovery.md), [MCP](../../../references/agent-customize/mcp-review.md), [Memory](../../../references/agent-customize/memory-review.md),
[Custom Agents](../../../references/agent-customize/custom-agents-review.md),
or [Hooks](../../../references/agent-customize/hooks-review.md). Use
[Knowledge Assets](../../../references/agent-customize/knowledge-assets-review.md)
for cross-surface use/coverage and
[Global Assets](../../../references/agent-customize/global-assets.md)
for Plugins, Commands, Workflows, provider scope, and platform-specific routes.
These references guide evidence; they do not expand authority or asset limits.

For Skills, inspect trigger quality, procedural content, routing, overlap, and
available use evidence. For Memory, positive value requires:
`exists -> retrieved -> relevant -> applied -> later outcome improved`.
Before proposing any future Skill or Memory, the lead must check for an
observed, built-in, configured, or extendable owner and deduplicate first.

## Build the Asset Coverage Map

Inventory does not reveal what knowledge is missing. For each inspected owner
chain, summarize only what its evidence can support:

- provider and project/user/plugin scope, canonical owner, and active or
  shadowed version relationship;
- trigger, lookup, or routing surface and the task/procedure family it claims;
- provenance and freshness boundary, plus deterministic integrity candidates;
- `Presence`, `Content`, `Use`, and `Outcome` state without collapsing them.

For Memory, distinguish exact-title collision, possible semantic overlap,
conflict/staleness, demonstrated coverage, and an unknown coverage area. One
exact duplicate title does not imply that other Memories are healthy, useful,
or complete. Do not infer a missing Memory from inventory alone; only the lead
may identify a coverage gap after joining repeated Session knowledge demand
with this map and current project truth. Never return user-home Memory paths or
titles; provider, scope, count, scan state, and truncation are sufficient.

For Plugins, map the distributed Skills, MCPs, apps, Commands, and Workflows to
their canonical package and version. Separate name overlap, capability overlap,
replacement, shadowing, and coexisting complementary routes. Installation or
configuration proves availability only, not selection, invocation, relevance,
or outcome value.

## Return

Write a compact Markdown brief in the user's language. Include scope and
authority, the important inventory facts, inspected owner chains, deterministic
integrity results, the bounded asset coverage map, runtime-use limits, and
normally three to five potential findings (up to three in quick mode).

Express potential findings naturally; no fixed fields or JSON schema are
required. Each must state enough evidence and uncertainty for the lead to judge
it. Return fewer when evidence is weak and never fill a quota. Do not assign
final severity, score, repair, cleanup, or recommendation. End with the claims
the lead must not make from this evidence.
