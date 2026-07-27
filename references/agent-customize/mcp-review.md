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

## Context And Security Review

Report concrete surface pressure:

- effective server count;
- visible tool and resource count;
- plugin-provided MCP count;
- duplicate/shadowed names;
- always-loaded descriptions or metadata bytes when measurable.

These are surface measurements, not exact prompt-token savings. Label token
savings as estimates unless the selected platform exposes direct model-visible
context.

Never print environment values, auth headers, URL credentials, raw arguments,
tokens, or secret-looking config values. Report env key names, transport type,
package/version pinning, and redacted endpoint identity only.

## Remediation Order

1. Resolve the active configuration source and ownership.
2. Fix parse, authentication, or runtime attention before cleanup.
3. Narrow tool exposure or workflow ownership when one server is too broad.
4. Prefer disable-first with a reviewable plan, rollback, and verification.
5. Use the selected platform's supported configuration operations.
6. Leave deletion, uninstall, and cache cleanup for a separately confirmed
   later action.

Every plan names target scope, evidence status, expected surface reduction,
validation, rollback, source fingerprints, and whether a host refresh or new
session is still required.

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
