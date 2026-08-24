# Leaf command help

## Traceability

- Spec ID: 37-leaf-command-help
- Story: #37
- Status: Implemented

## Intent

Make `--help` and `-h` immediate, side-effect-free discovery requests for every registered Better Harness terminal path. The root dispatcher must select the registered command owner before it forwards help so invalid or incomplete user arguments cannot reach runtime handlers. Each selected owner must return help before reading workspace, home, or stdin state; writing files; starting processes; or accessing the network.

## Acceptance Scenarios

- AC-1: Every canonical registered command path and direct-command alias exits successfully with its canonical help on stdout and no stderr when either `--help` or `-h` appears after arbitrary or incomplete arguments.
- AC-2: The dispatcher removes arbitrary arguments before invoking the exact registered leaf owner, retaining only a registered direct subcommand when that subcommand shares its owner's script.
- AC-3: Root, group, and built-in discovery help retain their existing behavior, including audience filtering, JSON/schema output, and unknown-subcommand diagnostics; an unknown root command falls back to root help when a help flag is present.
- AC-4: A positional value named `help` is not treated as a help flag and preserves normal command dispatch.
- AC-5: Every AC-1 path returns before target-workspace, user-home, stdin, write, child-process, Git, or network operations.

## Non-goals

- Changing command execution when no help flag is present.
- Changing command registry metadata or adding command paths or aliases.

## Plan and Tasks

1. Preserve built-in discovery handlers, then detect only `--help` and `-h` before runtime dispatch.
2. Resolve a direct or group leaf only from the registry and forward a canonical help argument list to its exact owner.
3. Add early help exits to every selected owner that otherwise reads runtime state.
4. Add an inventory-driven, isolated non-Git regression that covers canonical paths, aliases, both help flags, exact owner dispatch, canonical stdout, and prohibited-operation canaries.

## Test and Review Evidence

- AC-1 and AC-2: `node --test test/better-harness-cli.test.mjs` exercises every inventory-derived route from an isolated non-Git directory, with an invalid argument before each help flag, and compares stdout with the route's canonical help.
- AC-3 and AC-4: The same focused test covers discovery commands, audience filtering, and a literal positional `help` value.
- AC-5: A preloaded test guard rejects target-workspace, user-home, stdin, write, child-process, Git, and network access while allowing only the exact owner invocation.
- Regression gate: `npm test`.
- Risk: centralized early exit could alter metadata command behavior or normalize positional values. The implementation scopes leaf dispatch through the existing registry, preserves discovery handlers, and recognizes only explicit help flags.
