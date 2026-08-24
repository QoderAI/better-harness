# Harness as Code v0.3 contract

The grammar and runtime are owned by `packages/harness/src/`; this reference is
the compact authoring contract.

- [Document and deployment](#document-and-deployment)
- [Harness and workflow](#harness-and-workflow)
- [Capabilities](#capabilities)
- [Semantic checklist](#semantic-checklist)

## Document and deployment

Every document starts with its language version. A deployable assembly declares
its runtime and names the exact harness/runtime pair:

```harness
language 0.3

skill require-tests {
  description "Do not report completion until tests prove it."
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

Only named deployments are resolvable. This makes composition sparse and
auditable: two harnesses and two runtimes do not silently create four products.
Deployment ids and harness/runtime pairs must be unique.

Comments use `//` or `/* ... */`. Identifiers match
`[_a-zA-Z][\w-]*`; capability ids may be dotted. Strings use double quotes and
do not support embedded escaped quotes.

## Harness and workflow

A harness declares logical agent roles and exactly one workflow reference. The
workflow has exactly one form.

Portable single host session:

```harness
workflow coding-session { session coder }
```

Each harness using it must declare exactly the named agent. Qoder and Pi support
this mode; they do not turn multiple logical roles into separate sessions.

Adapter-owned state machine:

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

Outcomes are typed per emitting role. Every agent must be reachable from
`entry`, every route must name declared roles/outcomes, and at least one stop is
required. Compilation proves graph shape; resolution still fails unless the
selected adapter declares and implements `state-machine` orchestration.

Programmatic controller:

```harness
workflow scripted-loop {
  program deno "./flows/coding-loop.ts"
}
```

The adapter must support `programmatic` workflows and list `deno` as a
controller language. The DSL does not execute the file by itself.

## Capabilities

Requirements use kind-specific verbs:

```harness
agent coder {
  use skill repository-analysis
  require tool workspace.read
  connect mcp package-registry
}
```

- A skill needs `source`, `description`, or both. Resolution means the adapter
  can deliver it; source-backed skill bytes are locked and delivered at run
  time.
- Standard tools may be implicit: `workspace.read`, `workspace.glob`,
  `workspace.search`, `workspace.edit`, `workspace.write`, and `process.exec`.
  Their frozen contracts are `builtin:<tool-id>@1`.
- A custom tool must declare its contract identity:

  ```harness
  tool review.approve {
    contract "urn:acme:review.approve:v1"
    description "Record a review decision."
  }
  ```

  The adapter must expose the same capability id and exact contract, not merely
  a similarly named host tool.
- An MCP declaration describes the server connection. `stdio` requires
  `command`; `http` and `sse` require `url`, which may be a string or
  `env.VARIABLE`. Resolution means the adapter really connects and discovers
  the server. Shipped Qoder and Pi descriptors currently declare no MCP support.

There is no cross-kind strength ladder. A requirement is satisfied in its own
dimension (`delivered`, `exposed`, or `connected`) or deployment resolution
fails.

## Semantic checklist

- Start with `language 0.3`.
- Declare every referenced skill, custom tool, MCP entry, workflow, runtime,
  harness, and deployment.
- Match `use`/`require`/`connect` to skill/tool/MCP.
- Use one agent for a `session`; type and connect all outcomes for a
  `state-machine`.
- Give custom tools stable contract ids; never invent input/output lists that
  look like schemas.
- Treat adapter mechanisms, workflow support, and program languages as runtime
  facts, not author claims.
- Give source-backed skills a real source path before executing.
- Keep host permission callbacks, tool allowlists, models, budgets, and timeouts
  in the runtime/experiment configuration that actually applies them.
- Run `scripts/validate.mjs` and inspect every deployment report.
