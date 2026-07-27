# Hook Configuration And Performance Review

Use this reference for an explicit Customization Checkup or hook-performance
request. Use [Agent Lifecycle Hooks](agent-hooks.md) for hook design and
implementation practice.

## Inspection Contract

Inventory project, user/global, enterprise-plugin, normal-plugin, and local
hook sources. Preserve, when visible:

- lifecycle event;
- matcher;
- handler type and sanitized command identity;
- timeout;
- `if` condition;
- `async` state;
- source scope and plugin owner.

Configuration proves only that a hook is wired. Runtime claims require session
or host-log evidence.

Ordinary Better Harness source generation runs the read-only asset-integrity
pass. It can report more than 10 enabled Hooks, exact full-configuration digest
duplicates, and event-plus-matcher fan-out that reaches the existing static
review threshold. These are configuration observations, not proof of latency,
failure, or one command's runtime cost. Use explicit Customization Checkup for
runtime attribution, p95, failure evidence, and cleanup eligibility.

## Runtime Attribution

For Qoder session evidence:

- `hook.started` may carry event, source, index, and command identity;
- `hook.finished` carries completion, success/failure, and `duration_ms` when
  the runtime emits them;
- one finished event counts as one execution; do not double-count its start;
- join start/finish only through stable source/index/invocation evidence;
- when parallel hooks finish without identity, attribute latency to the hook
  event group, not to one command.

Plaintext Qoder hook logs may add per-command duration when available. Missing
logs lower attribution confidence; they do not fail the scan. Never replay a
hook merely to benchmark it because hooks can write files, call networks, or
block lifecycle actions.

## Initial Diagnostic Budgets

Use configurable budgets as review triggers, not universal performance scores:

- high-frequency Pre/Post tool hooks: p95 at or below 500 ms;
- prompt, session, and Stop hooks: p95 at or below 2 s;
- command-specific slow findings: at least five attributable finished samples.

Timeouts, repeated failures, duplicate registrations, and unnecessarily broad
high-frequency matchers are independent findings even when latency samples are
insufficient.

## Finding States

- `configured-only`: static hook exists; no runtime window was requested.
- `observed`: at least one execution is attributable.
- `healthy`: observed results remain inside configured budgets without repeated
  failures or duplicates.
- `candidate`: evidence supports a specific narrow remediation.
- `unavailable`: completion identity or duration cannot be safely attributed.

Do not name one command as slow when only group-level timing exists.

## Remediation Order

Prefer the smallest safe move:

1. narrow a matcher or lifecycle event;
2. remove a duplicate registration;
3. eliminate redundant repeated work;
4. make a purely observational non-blocking hook async when the host contract
   supports it;
5. increase or split timeouts only after inspecting the work;
6. disable only through a confirmed owner plan.

Never convert security, permission, approval, or blocking hooks to async only
to improve latency. Never patch plugin caches. Plugin-owned hooks are repaired
through the plugin owner unless a supported per-hook override exists.

## Verification

After an approved change, reparse the owning source, run the smallest safe
fixture/parser check, and distinguish disk/config success from runtime reload.
A new session or host refresh may still be required before the new behaviour is
`Observed`.
