# Friendly CLI Protocol for Agents

## Purpose

An agent-friendly CLI is more than a human CLI with `--json`. Treat it as a
versioned tool protocol that is discoverable, constrained, recoverable, and
verifiable while remaining useful to humans.

Before and after a call, an agent should be able to answer four questions:

1. Is this command appropriate for the current task?
2. What context, resources, and external systems can it read or modify?
3. What actually happened, including partial effects?
4. If the call failed or the result is uncertain, what is the safe recovery
   path?

Use the repository's
[Agent-Friendly CLI architecture](../../docs/ARCHITECTURE.md#agent-friendly-cli-contracts)
for local placement and cross-platform rules. The envelopes and `--agent` mode
in this reference are recommended target patterns, not claims about that runtime.

## Load When

- Designing or reviewing a CLI used by agents, CI, scripts, or MCP adapters.
- A command can emit JSON but still prompts, hides context, streams unbounded
  text, or returns opaque failures.
- A mutation needs safe retry, drift protection, verification, or recovery.
- CLI help, Skills, MCP tools, documentation, and tests describe the same
  capability differently.

## Protocol Layers

Keep four layers explicit rather than treating output formatting as the whole
design:

| Layer | Agent question | Required contract |
| --- | --- | --- |
| Selection | Should I use this command? | Purpose, use and avoid conditions, limits, effects, and progressive discovery |
| Invocation | What will it operate on? | Typed inputs, resolved context, permissions, timeout, and execution policy |
| Observation | What happened? | Versioned result or event schema, actual effects, warnings, artifacts, and verification |
| Recovery | What should happen next? | Stable error code, retry safety, remediation, operation identity, rollback or compensation |

Exit code and JSON are parts of these layers, not substitutes for them.

## Nine Design Patterns

| Pattern | Recommended design | Problem it solves |
| --- | --- | --- |
| Task-oriented commands | Expose `logs search`, `customer context`, or `deploy plan` around user intent instead of mirroring every REST endpoint | Reduces tool-choice ambiguity and repeated calls |
| Progressive discovery | Provide capability inventory, command descriptions, schemas, and examples as separate on-demand surfaces | Avoids loading the complete manual into context |
| Explicit agent mode | Let `--agent` select non-interactive, parser-safe, colorless, bounded, time-limited behavior | Prevents prompts, spinners, and progress UI from blocking an agent |
| Strongly typed input | Publish JSON Schema, enums, formats, defaults, and `--input -` for complex stdin documents | Removes natural-language and shell-escaping ambiguity |
| Explicit context | Resolve and return account, project, region, working directory, target, and relevant revision | Prevents operations against an unintended environment |
| Token-bounded output | Support field selection, filters, limits, opaque cursors, detail levels, and artifact references | Keeps large results out of the model context |
| Structured results | Use a stable envelope that separates facts, effects, warnings, artifacts, and verification | Distinguishes process completion from target-state success |
| Recoverable errors | Return stable codes, categories, retry semantics, missing inputs, and structured remediation | Lets an agent repair a call without parsing prose or a stack trace |
| Safe mutation protocol | Separate plan, apply, and verify; bind writes to a plan, expected state, idempotency key, and recovery data | Prevents drift, duplicate effects, and ambiguous changes |

These patterns are a synthesized design recommendation. The external anchors at
the end support individual parts; no cited project implements this exact
combined protocol.

## Task-Oriented Commands and Progressive Discovery

Model the smallest stable task, not the transport topology. A command should
return a useful task result rather than force an agent to discover and compose a
long sequence of endpoint-shaped commands. Keep low-level API access as an
advanced escape hatch when it remains necessary.

Offer discovery in layers:

```text
tool capabilities --agent
tool command describe logs.search --agent
tool schema logs.search --agent
tool examples logs.search --agent
```

The initial capability and command descriptions should be short enough for
selection. Put the complete argument contract in the schema and load examples
only after selection. A compact descriptor can use this shape:

```yaml
name: logs.search
purpose: Search bounded logs that match known criteria.
use_when: A keyword, time range, trace ID, or request ID is known.
do_not_use_when: The task needs an unbounded live subscription.
returns: Matching rows, small surrounding context, result count, and next cursor.
limitations: Scans at most 24 hours and returns 50 rows by default.
effects:
  read_only: true
  destructive: false
  idempotent: true
  open_world: false
```

Descriptions should enable selection, not encode the entire manual. A 2026
preprint studied 856 tools across 103 MCP servers and reported at least one
description smell in 97.1% of its sample. Fully augmenting descriptions improved
some outcome measures, but also increased median execution steps by 67.46% and
regressed some cases. Treat those figures as results from the authors' sample
and scanner, not a universal ecosystem census. The practical lesson is to keep
selection text compact and load schema, policy, guidance, and examples on
demand.

## Explicit Agent Mode

`--agent` should be a documented compound mode, not a hidden collection of
terminal heuristics:

| Concern | Recommended `--agent` behavior |
| --- | --- |
| Interaction | Never prompt; either use documented defaults or return `INPUT_REQUIRED` with all missing arguments |
| Output | Emit one JSON result or a documented JSONL event stream |
| Presentation | Disable ANSI, tables, spinner frames, progress animation, and decorative status output |
| Bounds | Apply documented default fields, result limit, timeout, and maximum inline bytes |
| Context | Resolve and echo the actual account, project, region, cwd, target, and revision when relevant |
| Failure | Emit a structured error result and a non-zero coarse exit code |
| Diagnostics | Keep parser output on stdout and operational logs on stderr; provide an opt-in debug artifact for deeper diagnostics |

Keep granular flags such as `--non-interactive`, `--output json`, `--no-color`,
`--quiet`, `--limit`, and `--timeout` for humans and existing automation.
`--agent` can normalize them into one supported contract. Explicit conflicting
flags should fail fast instead of silently degrading machine output.

Agent-environment detection may choose presentation defaults, but it must not
infer an account, target, permission, confirmation, or mutation scope. An
explicit `--agent` flag remains the auditable source of protocol selection.

## Typed Input and Resolved Context

Publish JSON Schema or an equivalent type contract for every command input:

- Mark required fields and distinguish omitted, empty, and null values.
- Use enums for closed choices and formats for timestamps, durations, IDs,
  paths, URIs, revisions, and hashes.
- Document defaults in the schema and return the resolved values in context.
- Accept simple scalar values as flags; accept complex objects through
  `--input <file>` and `--input -` for stdin.
- Validate the complete input before starting side effects and return every
  correctable validation error in one response when practical.
- Never return secrets, raw credentials, environment values, authorization
  headers, or sensitive input fields in context, logs, artifacts, or errors.

Define one context precedence rule, for example:

```text
explicit flag > input document > environment/config > cwd-derived default
```

Return the resolved source and value for operational context. If two sources
conflict, or a high-risk target was inferred rather than supplied, return a
structured ambiguity or confirmation error before any effect.

## Token-Bounded Results

Every list, search, log, diff, scan, or artifact-producing command needs an
output budget:

- `--fields` selects stable fields before serialization.
- `--limit` has a safe default and a documented maximum.
- `--filter` or task-specific predicates reduce the source set before output.
- `--cursor` consumes an opaque cursor; clients must not parse or synthesize it.
- `--detail concise|standard|detailed` chooses a documented projection, not an
  arbitrary verbosity level.
- Large content returns a summary, bounded preview, and artifact reference with
  media type, size, digest, and retention information when known.

When output is truncated, say so explicitly and return `next_cursor`. Never
silently omit rows. An empty query result is a successful empty collection, not
an exception:

```json
{
  "status": "success",
  "data": { "items": [] },
  "page": {
    "returned": 0,
    "truncated": false,
    "next_cursor": null
  }
}
```

Stable ordering is part of pagination correctness. Define the sort key and
tiebreaker so retries and page transitions do not duplicate or skip entries.

## Success Result Envelope

Do not return only `Done!`. Return a short semantic summary and machine-owned
facts. This is a recommended example, not the current Better Harness facade schema:

```json
{
  "schema_version": "1.0",
  "status": "success",
  "summary": "Closed issue BUG-142",
  "context": {
    "account": "acme",
    "project": "payments"
  },
  "data": {
    "id": "BUG-142",
    "state": "closed"
  },
  "effects": [
    {
      "resource": "issue/BUG-142",
      "action": "update",
      "changed_fields": ["state"]
    }
  ],
  "verification": {
    "passed": true,
    "checks": [
      {
        "name": "issue.state",
        "expected": "closed",
        "actual": "closed",
        "passed": true
      }
    ]
  },
  "warnings": [],
  "artifacts": [],
  "request_id": "req_01J..."
}
```

Field roles:

- `summary`: fast orientation for a model or human; never the fact source.
- `data`: schema-governed result facts that clients may depend on.
- `context`: the resolved environment and target, with sensitive values
  removed.
- `effects`: actual observed mutations, not the planned or requested effects.
- `verification`: whether the requested target condition was checked and met.
  Use `passed: null` with an explicit `not_run` or `unavailable` reason rather
  than pretending an unchecked condition passed.
- `warnings`: non-fatal conditions that can change interpretation or next
  steps.
- `artifacts`: typed references for content too large or sensitive to inline.
- `request_id`: correlation, audit, operation lookup, and support identity.

Top-level `status: success` means the command's declared success conditions are
met, not merely that its process exited or a remote request was accepted. A
mutation with partial, unknown, or failed verification should return an error
envelope that preserves observed effects, or a separately versioned `partial`
or `accepted` status with documented terminal semantics.

Keep fields additive within a compatible minor version. Require clients to
ignore unknown optional fields and reject unsupported major versions. Do not
reuse a field name with changed semantics.

## Recoverable Error Envelope

An error should tell the agent what failed, whether another attempt is safe,
and which constrained action can repair it:

```json
{
  "schema_version": "1.0",
  "status": "error",
  "error": {
    "code": "AUTH_EXPIRED",
    "category": "authentication",
    "message": "Token for account acme has expired.",
    "retryable": false,
    "safe_to_retry": false,
    "remediation": [
      {
        "action": "auth.login",
        "args": {
          "account": "acme"
        },
        "requires_user": true
      }
    ]
  },
  "request_id": "req_01J..."
}
```

Use stable codes and categories such as `validation`, `authentication`,
`authorization`, `not_found`, `conflict`, `precondition`, `rate_limit`,
`timeout`, `partial_failure`, and `internal`.

Keep two retry concepts separate:

- `retryable`: the condition may succeed after time, authentication, input
  repair, or another stated remediation.
- `safe_to_retry`: repeating the same invocation cannot create a duplicate or
  additional effect under the current operation and idempotency contract.

A timeout after a remote write may be retryable but not safe to retry. Return an
operation or request lookup action before suggesting replay. If a call has
partial effects, list the observed effects, unknown effects, verification
state, and compensation or support path.

Do not make agents parse `401 Unauthorized`, human prose, or a stack trace to
recover. Put stack traces and raw transport diagnostics in an opt-in debug
artifact, redact sensitive data, and keep them outside the stable error schema.

## stdout, stderr, Exit Codes, and Time

In agent mode:

- stdout contains exactly one JSON object, or a documented JSONL stream with
  one object per line.
- stderr contains operational logs and debug diagnostics, never the only copy
  of a machine-actionable error.
- exit code represents coarse success or failure; `error.code` provides the
  stable fine-grained reason.
- exit code, terminal JSON status, and terminal event must agree.
- timestamps use RFC 3339 / ISO 8601 UTC with a `Z` suffix; durations use a
  named unit such as `duration_ms`.
- no-result queries exit successfully with an empty collection.
- ANSI escapes, table borders, spinner frames, and animated or decorative
  status output never enter the machine stream.

Document a small stable exit-code table for the product. At minimum, keep `0`
for protocol success, a separate invocation/validation bucket, and one or more
runtime failure buckets. Do not assign every `error.code` its own process code;
many shells and hosts reduce or reinterpret large exit-code ranges.

## Long-Running Operations and JSONL

Builds, deployments, scans, migrations, and imports should not emit an
unparseable rolling log. Use a versioned JSONL event stream or return a durable
operation handle that can be inspected with `status`, `wait`, `cancel`, and
`result` commands.

```jsonl
{"schema_version":"1.0","type":"operation_started","operation_id":"op_123","sequence":1,"timestamp":"2026-07-17T08:00:00Z"}
{"schema_version":"1.0","type":"progress","operation_id":"op_123","sequence":2,"phase":"build","completed":42,"total":100,"timestamp":"2026-07-17T08:00:12Z"}
{"schema_version":"1.0","type":"warning","operation_id":"op_123","sequence":3,"code":"CACHE_MISS","message":"Remote cache entry was unavailable.","timestamp":"2026-07-17T08:00:13Z"}
{"schema_version":"1.0","type":"operation_completed","operation_id":"op_123","sequence":4,"status":"success","artifact":"build://op_123","timestamp":"2026-07-17T08:00:30Z"}
```

Event requirements:

- Every line is a complete JSON object with schema version, event type,
  operation ID, monotonic sequence, and timestamp.
- The first event identifies protocol and operation versions; a terminal event
  is mandatory for a completed stream.
- Progress totals may be unknown, but progress must not move backward within a
  phase.
- Events from concurrent resources may interleave; include resource or phase
  identity when ordering matters.
- Unknown compatible event types and optional fields are ignored; unsupported
  major versions fail explicitly.
- A disconnected client can resume from an operation ID or sequence cursor
  without starting the operation again.
- Cancellation reports whether execution stopped and which effects remain; it
  is not synonymous with rollback.

Terraform's machine-readable UI is a useful JSONL precedent, but the event
names above are this reference's example rather than Terraform's schema. MCP
2025-11-25 also defines task-augmented execution and deferred result retrieval,
but that Tasks facility is currently experimental.

## Mutation Protocol: Plan, Apply, Verify, Recover

State-changing commands need a stricter contract than queries:

```text
tool deploy plan --input request.json --agent
tool deploy apply --plan-id plan_123 --expect-hash abc123 --idempotency-key task_456 --agent
tool operation wait op_789 --timeout 60s --agent
```

The plan should return:

- resolved target and context;
- proposed effects and unchanged resources;
- risk, permission, approval, and irreversibility markers;
- source and target revision or state hash;
- a stable `plan_id`, digest, expiry, and schema version;
- preconditions, verification checks, and recovery options.

Apply consumes the exact plan rather than reinterpreting natural language. It
must reject expired plans, target mismatches, digest changes, failed
preconditions, or insufficient approval before starting an effect.
`--expect-hash` or an expected version prevents a lost update when state has
drifted since planning.

Bind an idempotency key to the authenticated principal, command, target, and
canonical input digest. Reusing the key with different inputs returns an
idempotency conflict. Document the retention window and whether a repeated call
returns the original result or an operation lookup. An idempotency key enables
safe replay only for the effects covered by that implementation; it does not
make every failure safe to retry.

Verification returns the actual postcondition and observed effects. When the
command cannot verify, it should return `verification: unavailable` and a
bounded next command rather than report success from process completion alone.

Rollback is only one recovery shape. Also model retry, resume, cancellation,
compensation, restore, and safe abort. Use
[Rollback and Recovery Evidence](recovery-evidence.md)
when evaluating a concrete project's recovery mechanism.

Delete, publish, payment, production deployment, permission changes, and other
high-impact operations need command-specific approval and policy. A generic
`--yes` may acknowledge an already bounded plan; it must not bypass
authorization, target checks, drift checks, irreversible-operation policy, or
required human approval.

## One Command Contract, Multiple Surfaces

Do not maintain independent semantics for CLI, Skill, and MCP surfaces. Define
one versioned Command Contract:

```text
Command Contract
= Identity and Purpose
+ Use / Avoid Conditions
+ Input Schema and Context Resolution
+ Output and Event Schemas
+ Effect Annotations
+ Error Taxonomy
+ Execution, Permission, and Recovery Policy
+ Examples and Contract Tests
```

A minimal contract can include:

```yaml
contract_version: 1.0
name: deploy.apply
purpose: Apply one previously reviewed deployment plan.
use_when: A valid plan ID and expected target digest are available.
do_not_use_when: The caller needs to explore or revise the requested change.
input_schema: schemas/deploy-apply-input.v1.json
output_schema: schemas/command-result.v1.json
effects:
  read_only: false
  destructive: true
  idempotent_with_key: true
  open_world: true
execution:
  mode: long_running
  timeout_default_ms: 60000
  requires_plan: true
  requires_verification: true
errors:
  taxonomy: command-errors.v1
```

Generate or validate these projections from the same owner:

- human `--help` and examples;
- agent capability inventory, command description, schema, and result;
- focused Skill workflow guidance;
- MCP tool definition;
- documentation and compatibility tables;
- fixtures, golden examples, and contract tests.

Generation is not mandatory on day one, but semantic drift checks are. A Skill
may add workflow sequencing and judgment; it must not redefine command inputs,
effects, or error meaning.

## MCP Projection

Map the Command Contract to MCP vocabulary when an MCP surface is appropriate:

| Command Contract | MCP tool surface |
| --- | --- |
| Purpose and short selection text | Tool `name`, `title`, and `description` |
| Typed input | `inputSchema` |
| Structured result | `outputSchema` and `structuredContent` |
| Effect classification | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` |
| Long-running policy | `execution.taskSupport` plus negotiated Tasks capability |

MCP annotations are hints, not a trusted enforcement boundary. Validate
permissions, target context, preconditions, approvals, and effects in the
runtime. The current MCP Tasks facility is experimental, so retain version and
capability negotiation rather than assuming universal client support.

## Contract Test Matrix

Test the protocol, not only the happy-path business behavior:

| Area | Minimum evidence |
| --- | --- |
| Selection | A task can choose the intended command from compact descriptions and reject a nearby wrong command |
| Discovery | Capability, description, schema, and example surfaces work without source reading or mutation |
| Non-interaction | Agent mode never prompts, opens a browser, or waits indefinitely for stdin |
| Parser safety | Success and failure stdout parse as one JSON value or valid JSONL; no ANSI or progress text leaks |
| Validation | Missing and invalid arguments return all safe-to-disclose corrections with no effects |
| Context | The resolved account, project, region, cwd, target, and revision match the invocation |
| Bounds | Empty results succeed; limits, fields, stable ordering, truncation, and opaque cursors behave deterministically |
| Errors | Stable codes map to actionable remediation and correct retry/safe-retry semantics |
| Long operations | Started, progress, warning, terminal, resume, wait, timeout, and cancel paths remain correlated |
| Mutation | Plan digest, expiry, expected state, approval, idempotent replay, actual effects, and verification are exercised |
| Recovery | Partial or uncertain effects return lookup, retry, resume, compensation, or rollback guidance |
| Compatibility | Unknown minor fields are tolerated, unsupported major versions fail, and human help remains usable |
| Portability | argv arrays, paths, stdin, stdout/stderr, signals, and exit codes work on Windows, macOS, and Linux |

Add agent evals for four outcomes: correct tool selection, correct argument
construction, recovery from a structured failure, and refusal to perform an
unsafe mutation. Measure calls, execution steps, output bytes or tokens,
wall-clock time, and target-state success; a richer description that increases
steps without improving the outcome is not automatically better.

## First-Version Priorities

If only one incremental release is available, implement these five pieces in
order:

1. Explicit `--agent` mode with no prompts and parser-safe output.
2. One versioned success envelope with context, effects, and verification.
3. Structured errors with stable codes and retry/remediation semantics.
4. Pagination, field selection, result limits, and artifact references.
5. Plan/apply/verify plus drift checks and idempotency for mutations.

Start with high-value read commands and one carefully bounded mutation. Capture
real agent failures and turn only repeated, stable lessons into new contract
fields or focused Skill guidance.

## Review Checklist

- Command names express user tasks rather than transport endpoints.
- Compact discovery answers purpose, use/avoid, return shape, limits, and
  effects.
- `--agent` cannot prompt, animate, silently expand scope, or infer approval.
- Inputs and resolved context are typed, explicit, and safe to echo.
- Output is bounded and reports truncation, ordering, cursors, and artifacts.
- Success distinguishes requested, executed, observed, and verified state.
- Errors distinguish retryable from safe to retry and provide constrained
  remediation.
- Long work has operation identity, terminal state, resume, timeout, and cancel
  semantics.
- Mutations bind plan, expected state, idempotency, approval, actual effects,
  verification, and recovery.
- CLI, Skill, MCP, docs, examples, and tests share one semantic contract.
- Human defaults remain understandable without weakening the agent protocol.

## External Anchors

These sources support parts of the design. Local architecture and capability
contracts remain authoritative for Better Harness.

- [Speakeasy, Making your CLI agent-friendly (2026)](https://www.speakeasy.com/blog/engineering-agent-friendly-cli): real-world prompt, spinner, non-interactive, structured-output, and focused-Skill lessons. Speakeasy uses several flags; the compound `--agent` mode here is this reference's recommendation.
- [Command Line Interface Guidelines](https://clig.dev/): stdout/stderr, exit status, non-interactive, color, animation, stdin, and machine-readable output conventions.
- [GitHub CLI formatting](https://cli.github.com/manual/gh_help_formatting): selectable JSON fields and pre-context `--jq` filtering.
- [Terraform machine-readable UI](https://developer.hashicorp.com/terraform/internals/machine-readable-ui): versioned, typed, one-object-per-line event output for long-running commands.
- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) and [apply](https://developer.hashicorp.com/terraform/cli/commands/apply): saved-plan automation and final-plan review patterns.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests): replay protection for uncertain create/update results under a documented idempotency contract.
- [MCP 2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [Schema](https://modelcontextprotocol.io/specification/2025-11-25/schema), and [Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks): input/output schemas, structured content, effect hints, and experimental task-augmented execution.
- [Hasan et al., “MCP Tool Descriptions Are Smelly!” (2026 preprint)](https://arxiv.org/abs/2602.14878): empirical description-quality and cost trade-offs across the authors' sampled tools.
- [RFC 9457, Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html), [RFC 9110 conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html), and [Google AIP-151](https://google.aip.dev/151): adjacent patterns for structured errors, state preconditions, and long-running operation handles. They are design analogies, not required wire compatibility.
