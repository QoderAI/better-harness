# MCP Configuration Review

Use this reference for an explicit Customization Checkup or MCP cleanup request.
MCP gives an agent access to external systems; it does not by itself prove that
the access is useful, safe, or used.

## Evidence Ladder

Keep these states separate:

- **Configured**: a source file declares the server.
- **Effective**: the selected platform resolves the server after precedence,
  enablement, and plugin ownership are applied.
- **Observed**: a bounded session or runtime snapshot shows a tool/resource from
  the server was used.
- **Healthy**: the effective server is reachable or has visible tools/resources
  and no current attention signal.
- **Unavailable**: active configuration, runtime, authentication, or session evidence
  cannot be established.

`Configured` without `Observed` is `configured-only` or `unobserved`; it is not
an unused finding.

## Classification Rules

- `healthy`: effective and observed, or effective with a healthy runtime when
  the request is configuration-only.
- `shadowed-here`: a project server with the same canonical name wins over a
  user server in this workspace. This is not global unused evidence.
- `configured-only`: configured and enabled, but runtime/session observation
  was not requested or is unavailable.
- `unobserved`: a sufficiently covered bounded window contains no mapped use;
  keep it separate from cleanup eligibility.
- `candidate`: enabled, outside the new-install grace period, not shadowed,
  owner-mapped, and unobserved in a sufficiently covered workspace or
  user-global window.
- `unavailable`: identity, active source, runtime state, or coverage is too
  ambiguous to classify.

Plugin-owned MCP servers inherit plugin ownership. Prefer disabling the owning
plugin or using a platform-supported override. Never patch plugin caches,
generated configuration, or runtime snapshots.

## Context-Pressure Review

A high configured Server or tool count is an inventory signal, not by itself a
finding that MCP is "too many." First resolve the effective surface and show
which cost reaches the selected model or workflow. Keep these quantities
separate:

- configured and effective servers;
- catalogued tools/resources versus definitions immediately visible to the
  model, definitions loaded after search, and tools actually invoked;
- plugin-provided MCP count, duplicate/shadowed names, and always-loaded
  descriptions or metadata bytes;
- tool-selection errors or retries attributable to a broad visible surface;
- model/tool boundary crossings, calls, status polls, pages, retries, and
  elapsed time for the same task;
- raw response rows/bytes, content returned to the model, and content retained
  as a host-owned artifact with a bounded summary;
- search turns spent locating the correct service, table, document, or owner.

Schema bytes, catalog size, and tool count are surface-pressure evidence, not
exact prompt-token savings. External benchmark numbers are investigation leads,
not universal thresholds. Claim a measured improvement only from a like-for-like
comparison using the same task, model, permissions, data snapshot, and success
criteria. Include correctness and latency with context/token cost; lower token
use is not a win when task success or necessary evidence falls.

## Recommendations After Confirmed Pressure

Apply only the recommendation that matches demonstrated pressure. These are
remediations after review, not four MCP types or mandatory replacements for
Direct MCP.

| Recommendation | Use when review shows | Suggested shape |
|---|---|---|
| Tool Search | A broad or changing catalog creates eager-Schema or tool-selection pressure. | Search the MCP catalog and load only the selected tool definition before invoking it through the gateway. Measure selection quality and fallback behavior. |
| MCP-to-CLI | Many MCP capabilities must remain available across agents without loading their Schemas into every session. | Map MCP tools to structured CLI commands that resolve and call the governed MCP gateway, returning bounded machine-readable output. |
| Code Mode | Polling, pagination, batching, filtering, or aggregation creates repeated model/tool turns or large intermediate responses. | Use a script or focused Skill to compose the governed CLI or gateway-function surface, then return only the decision-relevant summary, failures, and receipt. |
| Context Engineering | The agent spends repeated turns locating the correct service, table, document, owner, or prior usage evidence. | Query a bounded catalog or context graph with provenance and freshness, and load only selected facts into active context. |

The recommendations can layer: Context Engineering can identify the right
resource, Tool Search can select its MCP tool, MCP-to-CLI can expose the call
without eager Schema, and Code Mode can execute a deterministic multi-call
workflow. Keep Direct MCP when the pressure is not established or when the
model needs native MCP resources, subscriptions, UI, or intermediate results.

## SaaS MCP Application

SaaS MCP is a high-pressure application case, not a fifth recommendation.
Vendor Servers often expose broad product catalogs, so review their effective
and model-visible tool surface and apply the same Tool Search, MCP-to-CLI, and
Code Mode recommendations through the governed gateway. A focused Skill is
appropriate only for a demonstrated frequent workflow; do not create one per
vendor or copy the vendor's full Schema catalog. Gateway routing does not reduce
the underlying SaaS privilege, tenancy, or data-handling scope.

## Security And Output Invariants

Changing the model-facing execution shape changes context and orchestration,
not the underlying privilege. CLI and Code Mode in particular are not
permission escapes:

- preserve gateway or server authentication, authorization, policy checks,
  user confirmations, tenancy, and audit attribution;
- pass validated arguments through structured process APIs rather than
  concatenating untrusted values into a Shell command;
- use documented, versioned machine-readable output and distinguish tool
  failure, timeout, cancellation, partial result, and truncation;
- bound polling, retries, pagination, concurrency, runtime, and output size;
- keep large intermediate data outside active model context only when the model
  does not need it for a decision, and retain a reviewable receipt with tool
  identity, status, counts, timing, omissions, and artifact identity/digest;
- apply the same preview, confirmation, idempotency, and rollback requirements
  to external mutations whether they originate from MCP, CLI, or a script.

Never print environment values, auth headers, URL credentials, raw arguments,
tokens, or secret-looking config values. Report env key names, transport type,
package/version pinning, and redacted endpoint identity only.

## Remediation Order

1. Resolve the active configuration source and ownership.
2. Fix parse, authentication, or runtime attention before cleanup.
3. Measure whether the effective surface creates eager-Schema, tool-selection,
   model/tool round-trip, result-payload, or discovery pressure.
4. When pressure is not established, keep Direct MCP and report the surface as
   inventory or `configured-only`; do not manufacture an efficiency finding.
5. For eager-Schema or selection pressure, recommend Tool Search, MCP-to-CLI,
   or both while preserving the governed MCP gateway.
6. For deterministic multi-call or payload pressure, recommend bounded Code
   Mode over the governed CLI or gateway-function surface.
7. For repeated resource/owner discovery, recommend bounded Context
   Engineering rather than treating more tool exposure as the fix.
8. For broad SaaS MCP, apply the same evidence and recommendations; package a
   focused Skill only for a demonstrated frequent workflow.
9. Prefer disable-first for a true cleanup `candidate`, with a reviewable plan,
   rollback, and verification.
10. Use the selected platform's supported configuration operations.
11. Leave deletion, uninstall, and cache cleanup for a separately confirmed
   later action.

Every plan names the target workflow and scope, evidence status, demonstrated
pressure, selected recommendation and why it matches, preserved gateway
capability and security invariants, expected measurable reduction,
like-for-like validation, rollback, source fingerprints, and whether a host
refresh or new session is still required. Label the expected reduction as an
estimate until the selected host exposes direct measurement or the remediation
passes an A/B task check.

## Platform Notes

Load only the notes for the selected platform. Platform paths and precedence
rules are implementation details, not shared MCP review semantics.

### Qoder

Resolve one active Qoder home before comparing MCP state:

1. an explicit `--qoder-home` or injected fixture home;
2. `QODER_HOME` or a host-provided work directory when visible;
3. the active executable/product layout;
4. the platform product default.

The user-authored source is `<qoder-home>/mcp.json`. Project configuration
prefers `.qoder/mcp.json`; root `.mcp.json` is compatibility fallback. The
merged `<qoder-home>/extension/local/mcp.json`, runtime metadata/tool snapshots,
plugin cache files, and logs are evidence only and must never be edited.

Multiple historical homes may exist. Report all discovered homes, but do not
merge them into one effective inventory unless active-home evidence supports
that choice.

For Qoder-managed state, use supported Qoder CLI argv operations. Do not patch
merged runtime files or plugin caches.

Read [Global Coding-Agent Assets](global-assets.md) for the shared
presence-versus-use contract and [Agent Customize Routing](routing.md)
when MCP is only a supporting access layer for a Skill, Agent, Hook, or loop.
