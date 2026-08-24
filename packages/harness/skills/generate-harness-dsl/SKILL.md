---
name: generate-harness-dsl
description: Generate, revise, or review complete Harness as Code `.harness` files when a coding-agent workflow, agent role, skill, tool contract, MCP connection, runtime, or deployment must be compiler-valid and resolvable with `@qoder-ai/harness`.
---

# Generate Harness DSL

Create a standalone Harness as Code v0.3 document and prove the execution
contract with the package compiler and resolver.

## Workflow

1. Identify the host, the capabilities it must actually expose, and the real
   control owner. Use `session` for one host session. Use `state-machine` or
   `program` only when a selected adapter explicitly implements that mode.
2. Read [the DSL contract](references/dsl-contract.md). Start from
   [the minimal example](../../examples/minimal.harness); open
   [the standard example](../../examples/standard-coding.harness) when callable
   tools are required.
3. Generate one self-contained document unless the user requests a fragment.
   Include `language 0.3`, every referenced declaration, a concrete runtime,
   and a named deployment. Standard tools may remain implicit.
4. Run `scripts/validate.mjs`. Fix every compiler or resolution error and rerun.
   A compile-only state machine is not an executable Qoder or Pi deployment.
5. Return the DSL or saved file plus the harness id, deployment id, runtime,
   resolution status, and any execution boundary the selected adapter cannot
   satisfy.

## Authoring Rules

- State only falsifiable requirements. Do not add permission, setting,
  degradation, binding, input/output-name, or runtime-execution syntax; v0.3
  intentionally has none.
- Match the requirement verb to its capability: `use skill`, `require tool`,
  or `connect mcp`.
- Only the standard tool ids in the contract may be undeclared. Every custom
  tool declares a stable `contract` id that the adapter exposure must match.
- Qoder and Pi descriptors run `session` workflows only. A session workflow
  names exactly the one agent role declared by each harness that uses it.
- State-machine outcomes are typed on agents. Every route emitter, outcome,
  destination, entry, and stop must exist, and every agent must be reachable.
- A `program <language> <entry>` workflow resolves only when the adapter lists
  the same language in `programmaticLanguages`.
- Keep credentials out of source. Prefer `env.VARIABLE` for MCP endpoints, but
  remember that declaring an endpoint does not connect it; the adapter must do
  that.
- Do not invoke host SDKs, install integrations, or claim native enforcement
  while generating or validating DSL.

## Validate

From this skill directory, run:

```sh
node scripts/validate.mjs /path/to/workflow.harness [harness-id ...]
```

The command prints JSON and exits non-zero when compilation or any selected
named deployment fails resolution. A successful exit is required before
calling generated DSL executable.

When editing this skill, build the package first so `dist/` reflects the current
compiler:

```sh
npm run harness:build
```
