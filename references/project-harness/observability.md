# Observability for AI Debugging

Use this reference to inspect whether an AI agent can diagnose a runtime failure
with the project's existing logging architecture. Logs are the primary surface;
traces, metrics, health endpoints, profiles, and test artifacts extend it when
the project actually uses them.

This file owns the bounded inspection procedure. The
[Agent Work Loop core and high-impact observability judgment](../../models/agent-work-loop.md#core-and-high-impact-observability-judgment)
owns applicability, `Ready` / `Partial` / `Blocked` interpretation, pass/block
decisions, and scoring.

## Inspection Question

Can the agent find the real framework, run one small reproduction, retrieve
readable output, correlate the failing path, and verify a hypothesis? For core
files, name the trigger -> boundary/decision -> failure/recovery -> result
chain. Do not infer coverage from imports, call counts, `api/`, or `tests/`.

## 1. Discover the Existing Logging Architecture

- **Route**: read scoped instructions, logging/observability docs, runbooks, and
  test guidance. Check content: reactive `Observable` guidance is not runtime
  observability.
- **Framework**: identify the runtime framework, project logger facade, adapters,
  and underlying library.
- **Wiring**: find initialization, profiles, levels, middleware/interceptors,
  buffering, rotation, and flush. An unused dependency proves nothing.
- **Output**: locate stdout/stderr, files, IDE channels, test capture, CI
  artifacts, or query systems; record format and encryption. For multi-process
  apps, map process/component-to-file instead of naming one directory.
- **Correlation**: identify request, trace, session, task, test, job, or run id
  and verify it crosses the failing boundary.
- **Safety**: record redaction, sensitive data, production access, retention,
  and whether the current agent can read the output.

Prefer the established framework and test capture. Recommend a new logging
library only when no coherent route exists or the current route cannot satisfy
the diagnostic need.

## 2. Prove an Executable Debug Route

| Workload | Smallest route | Required evidence |
| --- | --- | --- |
| REST or RPC service | Focused handler test, or local service plus one safe request with a stable request id. | Response plus captured/runtime logs for the same id. |
| Unit or integration test | One named test using the real runner and profile. | Exit/assertion plus captured logs or stderr. |
| CLI, worker, or job | One bounded invocation with fixed local input. | Result, diagnostic output, run/job id, and final state. |
| UI, IDE, desktop, or E2E | Focused launch/test profile with a test-owned log path. | Relevant process logs, console/trace/screenshot, correlation id, and visible result. |

The route should form:

```text
start or focused test -> stable id -> readable filtered output
-> failing boundary/decision -> assertion, response, or state check
```

Do not invent a `curl` command, port, test script, log path, or environment flag.
Missing credentials, private dependencies, platform support, startup commands,
or readable sinks are debugging constraints, not minor documentation gaps.

## 3. Return Direct AI-Debug Evidence

- **Discoverable**: framework, command, sink, component map, and safety boundary
  are findable; commands/paths support the declared platforms.
- **Runnable**: the current agent can execute the focused route.
- **Readable**: output is machine-readable; encrypted or remote-only output needs
  a safe query/decryption route.
- **Correlatable**: one stable id joins trigger, boundary, failure/decision,
  recovery, and result.
- **Verifiable**: evidence can confirm or refute a hypothesis and support recheck.
- **Safe and reversible**: access and temporary probes respect least privilege,
  cleanup, secrets, and production boundaries.

Return each gate separately for one bounded scenario and profile. Do not widen
the scope: a focused test and a live or production route are different
scenarios. The model classifies the combined result.

Map the result by failure state. If no failure was observed but an affected
core or high-impact path has no focused diagnostic route, return the gap to
`relevant-check`. If a failure was observed but missing, unreadable, or
uncorrelated output blocks diagnosis, return it to `failure-repair`. Logger
imports, log-call counts, or generally “few logs” remain search leads. A finding
must name the missing chain segment and the reproduction, diagnosis, or
verification outcome it blocks.

## 4. Recommend the Earliest Missing Move

Prefer, in order: document the real command; expose existing local/test capture;
enable existing request/trace middleware; preserve correlation across boundaries;
add one focused failure-path test; link concise architecture/access guidance;
then consider a new logger, tracer, collector, or debug endpoint. Do not scatter
entry/exit logs across every function.

## What Belongs in AGENTS.md

Load [agents-md-review.md](../agent-customize/agents-md-review.md) when instructions are in scope.
Keep only non-inferable facts:

- actual logging facade and architecture link;
- exact start, reproduction, and focused-test commands;
- output location/format, profile switch, test capture, and component map;
- correlation id and how to supply/filter it;
- encrypted, remote-only, access, redaction, and platform constraints.

Logging style rules do not make a project AI-debuggable without a runnable
consumption route. Keep credentials and long framework tutorials out of root
instructions.

## Review Result

```text
scenario/profile -> framework -> command -> output/correlation
-> six gate results -> missing segment/impact -> move/re-check
```

Use this result as evidence for Controlled Execution or Change Validation; it does not
by itself prove delivery or longitudinal improvement. Follow
[Agent Work Loop](../../models/agent-work-loop.md) for those claim boundaries.
