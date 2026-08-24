# @qoder-ai/harness

Harness as Code v0.3 is a parseable, lockable assembly language for coding-agent
harnesses. It states only contracts the compiler, resolver, adapter, or executor
can later falsify:

> Which workflow and capabilities does this harness require, which named
> deployment selects its runtime, and what did that adapter actually materialize?

It is not a universal agent execution language. Host tool names, controller
support, permission callbacks, models, budgets, and SDK settings stay in the
runtime layer that applies them.

## Smallest executable harness

Every document declares its language version. A deployable harness has a real
workflow, runtime, and named harness/runtime pairing:

```harness
language 0.3

skill require-tests {
  description "Do not report completion until tests or a diff review prove it."
}

workflow single-pass {
  session coder
}

harness my-agent {
  workflow single-pass
  agent coder { use skill require-tests }
}

runtime qoder {
  adapter "@harness/adapter-qoder"
}

deployment my-agent-qoder {
  harness my-agent
  runtime qoder
}
```

See [`examples/minimal.harness`](examples/minimal.harness) and the executable
tool-using [`examples/standard-coding.harness`](examples/standard-coding.harness).
[`examples/full-surface.harness`](examples/full-surface.harness) is a compile
fixture for state-machine, programmatic, custom-tool, and MCP syntax; its
unsupported deployments intentionally do not resolve on the shipped adapters.

## Resource and ownership model

| Resource | Author-owned contract |
| --- | --- |
| `skill` | Progressive guidance from `source`, inline `description`, or both |
| `tool` | An atomic callable identified by a stable contract id |
| `mcp` | A server connection the adapter must actually open and discover |
| `workflow` | One `session`, `state-machine`, or `program` control form |
| `agent` | A logical role and its capability requirements; outcomes are typed for state machines |
| `harness` | One workflow plus its logical roles |
| `runtime` | A host id and selected adapter package |
| `deployment` | One named, explicit harness/runtime pair |

There is no generic plugin, strength ladder, capability binding, permission
policy, or free-form setting in the core language. Those old fields looked
portable but shipped executors did not enforce them.

Requirements use kind-specific verbs:

```harness
agent coder {
  use skill repository-analysis
  require tool workspace.read
  connect mcp package-registry
}
```

A skill must be delivered, a tool exposed with an exact contract, and an MCP
connected. Missing capability facts fail resolution; prompt prose cannot satisfy
a callable tool requirement.

## Workflow forms

`session` is the portable form supported by the shipped Qoder and Pi adapters:

```harness
workflow coding-session { session coder }
```

Every harness using it declares exactly that one agent. Logical multi-agent
graphs do not silently degrade into one prompt session.

A typed state machine is explicit:

```harness
workflow coding-loop {
  state-machine
  entry author
  on author.ready -> verifier
  on verifier.failed -> author
  stop when verifier.passed
}

harness reviewed-coding {
  workflow coding-loop
  agent author { outcomes { ready } }
  agent verifier { outcomes { failed passed } }
}
```

Compilation validates roles, outcomes, reachability, and stops. Resolution still
fails until an adapter descriptor claims and implements `state-machine`.

A programmatic workflow names its controller instead of pretending the DSL runs
it:

```harness
workflow scripted-loop {
  program deno "./flows/coding-loop.ts"
}
```

It resolves only when the adapter supports `programmatic` and lists `deno` in
`programmaticLanguages`.

## Tool contracts

The standard tool ids can remain undeclared. Their frozen contract ids are
`builtin:<tool-id>@1`:

- `workspace.read`, `workspace.glob`, `workspace.search`
- `workspace.edit`, `workspace.write`
- `process.exec`

A custom tool declares a stable identity:

```harness
tool review.approve {
  contract "urn:acme:review.approve:v1"
  description "Record a review decision."
}
```

An adapter exposure names both the host tool and this exact contract. Input and
output name lists were removed because they were not runtime-validated schemas.

## Trust chain

```text
.harness source
      │ compile
      ▼
versioned IR bundle
      │ resolve named deployment against adapter facts
      ▼
HarnessRevision + ResolutionReport
      │ preflight and materialize
      ▼
HarnessMaterializationReceipt + run evidence
```

The IR uses `irVersion: "0.3.0"`. A revision is deeply frozen and binds content
hashes for the harness, deployment, workflow, and resolved capabilities; it also
locks runtime/adapter descriptor identity, source-backed skill bytes, and
optional component snapshot provenance. Before loading a host SDK, preflight
recomputes the revision id and bundle hashes and rejects host, adapter,
deployment, content, or source drift.

Realization entries use their native dimension (`delivered`, `exposed`,
`connected`, or `orchestrated`) plus state and mechanism. Receipts contain only
materialized facts; they do not repeat author permissions or settings that the
adapter ignored.

## Compile, resolve, execute

```ts
import {
  compileHarness,
  describeBuiltInAdapter,
  resolveDeployment,
} from "@qoder-ai/harness";
import { QoderSdkExecutor } from "@qoder-ai/harness/exec";
import { highlightHarness } from "@qoder-ai/harness/highlight";

const compiled = await compileHarness(source);
if (!compiled.bundle) {
  throw new Error(compiled.diagnostics.map((item) => item.message).join("\n"));
}

const { revision, report } = resolveDeployment(
  compiled.bundle,
  "standard-coding-qoder",
  { adapter: describeBuiltInAdapter },
);
if (!revision) throw new Error(report.errors.join("\n"));

const result = await new QoderSdkExecutor().execute(revision, compiled.bundle, {
  prompt: "Explain the repository in one sentence.",
  cwd: process.cwd(),
});

const html = await highlightHarness(source);
```

`resolveHarness(bundle, harnessId, runtimeId?, options?)` remains a convenience
for callers that identify a harness. It succeeds only when that selection maps
to exactly one declared deployment; `resolveDeployment` is the unambiguous v0.3
entrypoint.

## Artifact Provider SDK

External Artifact implementations import the host-neutral contract from the
dedicated subpath:

```ts
import {
  defineArtifactProvider,
  type ArtifactAdaptContext,
  type ExternalArtifactProvider,
} from "@qoder-ai/harness/artifacts";
```

The subpath owns descriptor and snapshot envelopes, source entries, adapter and
hosted-runtime bindings, matchers, receipts, and Provider types. It does not own
Studio's React `ArtifactView`, directory catalog, HTTP routes, activation
storage, compile execution, CSP, or iframe host. Provider-owned payload kinds
use the `external:<provider>/<schema>` namespace so built-in payloads remain a
discriminated TypeScript union.

## Shipped adapter facts

| Adapter | Skills | Tools | MCP | Workflows |
| --- | --- | --- | --- | --- |
| Qoder | Prompt-preamble delivery | Exact-contract standard tool map (`workspace.read` -> `Read`, etc.) | None | `session` |
| Pi | Prompt-preamble delivery | None | None | `session` |

The pure-data descriptor registry used during resolution must match the live
adapter descriptor used during execution. A caller-added Qoder custom tool
exposure includes `{ hostTool, contract }`; changing either changes the locked
descriptor.

Source-backed skills are delivered, not merely referenced. Their `SKILL.md`
content is locked, read under the explicit `sourceRoot`, and inlined into the
run. Missing bytes fail the run. `materializePiPackage()` uses the same preflight
and copies the real skill files into a revision-stamped Pi package.

The host SDKs are optional peers and load lazily. Qoder defaults to the locally
signed-in `qodercli` identity; automated environments should inject an auth
factory without writing credentials into source or evidence. Pi sessions are
created with tools disabled, matching their descriptor.

## Events and sessions

Executors can emit host-neutral `HarnessRunEvent` values through `onRunEvent`:
one `run-started`, framed text and tool-call activity, optional `run-error`, and
one `run-finished`. Payloads use the same redaction boundary as retained traces.

`QoderSdkAdapter` and `PiSdkAdapter` implement the experimental
`harness-adapter-v1` session contract. `execute()` is the one-turn convenience;
`doStart()` plus sequential `doPromptTurn()` calls keeps one live host session.
Unsupported optional host behavior throws `HarnessCapabilityUnsupportedError`
instead of being silently ignored.

## Compare and checkpoint execution

The package also contains two deliberately separate evidence workflows:

- `harness-compare.v1` runs baseline/candidate harness deployments in isolated
  temporary Git repositories and retains patches, redacted traces, runtime and
  materialization receipts, grader evidence, metrics, and an aggregate verdict.
  See [`examples/readme-compare/experiment.json`](examples/readme-compare/experiment.json).
- `@qoder-ai/harness/session-executor` is a Pi-first checkpoint continuation
  POC. It pairs an exact Git tree with an exact Pi JSONL entry, executes in a
  detached temporary worktree, and writes the result under
  `refs/better-harness/session-executions/<plan-id>` without switching the
  caller's branch or working tree. See
  [`examples/checkpoint-experiment/README.md`](examples/checkpoint-experiment/README.md).

These workflows own their runtime permission callbacks, tool allowlists,
timeouts, trial counts, and isolation evidence. Those controls are not DSL
claims.

## AI authoring skill

[`skills/generate-harness-dsl/SKILL.md`](skills/generate-harness-dsl/SKILL.md)
teaches compatible agents to author v0.3 and validate every named deployment:

```sh
node skills/generate-harness-dsl/scripts/validate.mjs workflow.harness
```

## Development

```sh
npm install
npm run harness:generated
npm run harness:build
npm run harness:test
```

The package supports Node `>=22.20.0 <25`. The v0.3 design and acceptance
evidence live in
[`docs/specs/2026-08-17-harness-dsl-v0.3-semantic-contraction.md`](../../docs/specs/2026-08-17-harness-dsl-v0.3-semantic-contraction.md).
Publication is repository-owned; local development commands do not publish.
