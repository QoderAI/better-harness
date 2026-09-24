# Compile Pi extensions while the agent is running

## Traceability

- Spec ID: pi-wasm-extension-runtime
- Status: Implemented experiment (local validation; draft PR)
- Request: independent experiment from main after native-interface PR #158;
  use Pi and esbuild-wasm, and compare DSH's reload capabilities.
- No Story or issue id was supplied.

## Intent

Compile a changing TypeScript extension and its local imports into a module
that the official Pi runtime loads. Keep Pi's own terminal, commands, tools,
session lifecycle and extension API. Demonstrate real native reload without
requiring a model request or copying the Studio interface work from PR #158.

## Acceptance scenarios

- **AC-1:** Build a TypeScript entry and local dependency with esbuild-wasm;
  return structured diagnostics, SHA-256 revision and timing. No native esbuild
  dependency is introduced. Require a default export and explicit .ts output
  path; emitted content is JavaScript, while this suffix keeps Pi's loader from
  reusing Node's ESM cache for .mjs / type:module .js entries.
- **AC-2:** Reuse an incremental build context for repeated builds/watch.
  Publish a complete module by atomic replacement only after a successful
  build; syntax/import/export errors preserve the prior artifact. Dispose the
  context on shutdown. Serialize writes and reject builds after disposal.
- **AC-3:** Run an explicitly provided installed Pi CLI with the generated
  extension and a small control extension. `/harness-reload` waits for idle,
  compiles current source, and calls Pi's native `ctx.reload()` only on success.
  A tool can queue this command through Pi's official follow-up mechanism.
  Compilation failure leaves the running extension available. Source edits do
  not implicitly execute code unless the user invokes reload or the tool.
- **AC-4:** A real pinned Pi SDK loads and executes v1, reloads v2, preserves v2
  after invalid source, and observes session lifecycle events. No model calls,
  user profiles or global installs. Record native versus fixture evidence.
- **AC-5:** CLI help, invalid arguments, JSON output, filesystem paths with
  spaces/Unicode and process cleanup have observable coverage. Explain DSH's
  profile/module/bundle boundaries from upstream source and record compiler
  footprint separately from the unchanged Pi distribution.

## Non-goals

A new Coding Agent host adapter, Studio page, browser execution of Node
extensions, TypeScript type checking, a sandbox, arbitrary extension activation
rollback, preservation of extension in-memory state, complete Pi dependency
replacement, automatic package installation, signed desktop releases, and DSH
implementation. Existing native side effects remain owned by each extension.

## Plan and tasks

1. Add a copyable capability under `scripts/pi-extension-runtime/`, using the
   existing root esbuild-wasm dependency. The compiler owns bundle policy and
   artifact publication; the CLI owns build/watch/run and argv-based launch.
2. Keep Pi-owned runtime packages external so Pi resolves its own API, TUI and
   TypeBox modules. Bundle local source imports. Reject unsupported bare
   imports rather than silently publishing unresolved dependencies.
3. Add a control extension and a small editable example. Keep its build context
   for repeated attempts and dispose on session shutdown, including native
   reload. Native reload creates a new control instance; there is no promise
   of warm incremental state across a full Pi reload.
4. Test compilation/publication errors and real native reload. Inspect upstream
   DSH config hot reload versus opt-in module HMR and bundle restart.

## Test and review evidence

- Capability and usage: [Pi extension runtime compiler](../../scripts/pi-extension-runtime/README.md).
- AC-1/2/5: Node 24.20.0, 14 focused Vitest tests passed. Tests execute compiled
  modules, edit local imports, preserve prior output on syntax/resolution/export
  failure, drain concurrent builds, reject unsafe output paths/suffixes, exercise
  CLI JSON/error/argv behavior, observe watch recovery, and terminate its process.
- AC-3/4: real Pi 0.85.1 SDK passed in isolated temporary directories. Three
  native reloads, seven start/stop events, TypeBox tool registration, v1 -> v2,
  failed syntax retaining v2, recovery to v3, and tool-dispatched v4. No model
  requests. The smoke uses the installed package's public SDK entrypoint.
- AC-3/4: official npm `dist/bundle/cli.js` also ran through `run` in a real PTY,
  in a project with `type: module`. Native `/harness-hello` observed a changed
  value after `/harness-reload`; invalid source retained it, and another repaired
  revision became visible. Ctrl+D exited both Pi and the wrapper successfully.
  The isolated Pi profile downloaded its own `fd` helper on first startup;
  that download is not part of the compiler footprint or a model call.
- Regression found during native terminal verification: `.mjs` and ESM `.js`
  output can retain the old native ESM module after Pi reports reload success.
  Using a `.ts` entry containing compiled JavaScript forces Pi's uncached loader.
  The SDK test's runtime TypeBox import had masked this by forcing fallback
  resolution; dependency-free official terminal verification caught it.
- Tool dispatch also needed `expandPromptTemplates: true` with Pi 0.85.1.
  Without it the command string was treated as literal input. Native smoke now
  exercises this exact dispatch, beyond registration-only evidence.
- AC-5: esbuild-wasm 0.28.2 occupies 14,532,821 logical bytes locally; its WASM
  binary is 13,978,850 bytes. Existing root dependency, no dependency/lockfile
  changes. This does not replace Pi's own installed native esbuild dependencies.
- Markdown link tests: 8 passed; generated routing graph unchanged. Preview
  launch failed at its existing prerequisite: missing Canvas SDK runtime.
  `/health` and `/canvas-module.js` were not verified. No Studio UI changed.
- Antigravity artifact and governance mapping checks: 41 passed, 1 skipped.
  An independent Codex CLI consumer read the help/README, compiled a temporary
  extension through the documented command, checked the receipt's SHA-256,
  introduced invalid syntax, and verified exit 1 plus unchanged artifact bytes.
  No repository edits, package installs or Pi model calls in that validation.
- Windows/Linux native Pi and installed Desktop packaging are not claimed
  verified. Hosted cross-platform CI results must be recorded separately.
- Review: maintainer-requested experiment, no inferred Story. Source/compiler,
  CLI/control extension, example, behavior tests and spec form one scoped change.
  AI implementation: Codex. No change from native-interface PR #158 is imported.

## Risks and decision boundaries

Only trusted local extension source is executed. Compilation is not validation
of a factory's runtime behavior. An exception or side effect during native
activation is not rolled back by atomic file publication. Reload affects all
Pi resources and uses upstream session shutdown/start events. Source edits made
during compilation may require a subsequent build; no per-token compilation.
WASM adds a portable compiler, but does not remove native esbuild already in the
installed Pi dependency closure. DSH parity requires a separate accepted slice.
