# Pi extension runtime compiler

An experimental, local compiler for extensions loaded by **official Pi**.
It uses the existing `esbuild-wasm@0.28.2` dependency, bundles TypeScript and
local imports, and publishes complete revisions. It does not install Pi or
replace its terminal, tool runner, session manager or extension API.

## Try it

Use the repository's supported Node 22.20+ or Node 24 and installed dependencies.
Supply the JavaScript CLI entry from an existing Pi installation; for the tested
`@earendil-works/pi-coding-agent@0.85.1` npm package it is `dist/bundle/cli.js`.
The path is an argument to Node, not an npm shell shim or a compiled executable.

From the repository root (the same single-line command works in supported shells):

```sh
node scripts/pi-extension-runtime/cli.mjs run --entry scripts/pi-extension-runtime/examples/extension.ts --out dist/pi-extension/compiled.ts --pi-cli /path/to/pi-coding-agent/dist/bundle/cli.js -- --no-session
```

1. In Pi, enter `/harness-hello` to observe v1.
2. Edit `scripts/pi-extension-runtime/examples/greeting.ts`.
3. Enter `/harness-reload`, then `/harness-hello` to observe the new value.
4. Introduce a syntax error and repeat. Pi reports the compilation error; the
   previous command still works. Fix the source and reload again to recover.

Pi also receives a `harness_reload` tool. An agent can edit the configured
source with its native file tools, then queue this reload command. Its immediate
result says **queued**, not activated. The command waits for idle and reports
compilation errors through Pi's UI. Native reload recreates extension state and
reloads other Pi resources too. The smoke tests do not invoke a real model.

The source entry and output are fixed at launch through child-scoped environment
variables. Existing Pi project/user discovery and trust checks still apply;
this is the user's normal Pi runtime unless they select an isolated Pi profile.
For verification, the native smoke uses a temporary project and agent directory.

## Build and watch independently

```sh
node scripts/pi-extension-runtime/cli.mjs build --entry scripts/pi-extension-runtime/examples/extension.ts --out dist/pi-extension/compiled.ts --json
node scripts/pi-extension-runtime/cli.mjs watch --entry scripts/pi-extension-runtime/examples/extension.ts --out dist/pi-extension/compiled.ts --json
```

`build` exits 1 on compilation failure. `watch` polls every 500 ms with an
incremental esbuild context and emits JSONL on revision or diagnostic changes.
It retries missing/invalid imports and stops on Ctrl+C or termination. Watch
compiles only: a separately running Pi requires its native `/reload` to load the
artifact. Use one writer per output; do not watch an output concurrently with
the `run` command's control extension. `run` compiles on explicit
`/harness-reload` or `harness_reload`, not on every file save.

Successful receipts contain a SHA-256 digest of the emitted JavaScript, byte
count, compilation duration and diagnostics. This is a **code revision**, not a
digest of external Pi modules or assets. Failure keeps the prior artifact;
`revision: null` means this compiler instance has not published a valid revision.

## Loading and lifecycle constraints

- The output must use **`.ts`**, although its contents are bundled JavaScript.
  Pi 0.85.1's Jiti loader can route `.mjs` and ESM-project `.js` files into Node's
  persistent ESM cache. The official TUI then reports a successful reload while
  executing old code. A `.ts` entry forces Pi's reloadable loading path. This
  was reproduced with a dependency-free extension and fixed in the live TUI.
- Pi-provided API/TUI/AI/TypeBox imports and Node builtins stay external. Local
  source imports are bundled. Other bare runtime imports fail with a diagnostic;
  this experiment does not install dependencies or handle arbitrary asset files.
- `harness_reload` uses `expandPromptTemplates: true` to dispatch the extension
  command in Pi 0.85.1; otherwise Pi treats the string as literal model input.
- Syntax, resolution and default-export checks happen before atomic replacement.
  esbuild does not typecheck or execute the factory. This is trusted local code,
  not a sandbox. Runtime exceptions and external side effects during activation
  are not transactionally rolled back. Extension authors own their cleanup.
- The control extension disposes its compiler on session shutdown, including
  reload. An incremental context survives repeated attempts within that instance,
  but a full Pi reload creates a new instance. Whole-session warm state is not
  promised. Long-running tool calls must reach idle before the reload proceeds.

## DSH comparison and footprint

DSH has a related route, with different lifecycle contracts. At source revision
`0a53fb55bea101816fa226bb964ae2bed71c343b`, ordinary `cordis.patch.yml` edits can
reload live. The profile bootstrap installs a configuration-only HMR fallback
with no module roots when module HMR is not enabled. Source module HMR is opt-in;
adding/removing/updating Bundle membership requires a Profile restart. Browser
client bundles still require their own build. Therefore compiling a plugin with
WASM is plausible, but activation, disposal and client reload need a DSH-specific
adapter and native verification. This PR implements the Pi experiment only.

Sources: [DSH profile bootstrap](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts),
[DSH CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/reference/README.md),
[Pi extensions](https://github.com/earendil-works/pi/blob/faa9863cb8b54689f1d0c2df9dbab1ee1fa9de19/packages/coding-agent/docs/extensions.md),
[esbuild incremental contexts](https://esbuild.github.io/api/#rebuild).

The local esbuild-wasm package is 14,532,821 bytes (13.86 MiB), including a
13,978,850-byte WASM binary (13.33 MiB). It is already a root dependency, so this
PR adds no package or lockfile changes. These are logical file bytes, excluding
Node, Pi, compiler RSS and application packaging. **Using this compiler does
not remove native esbuild from Pi's installed dependency closure.** The raw
distribution comparison remains in [PR #158](https://github.com/QoderAI/better-harness/pull/158).

## Verification

```sh
npx vitest run test/pi-extension-runtime
node scripts/pi-extension-runtime/native-smoke.mjs /path/to/installed/pi-coding-agent
```

The native smoke pins Pi 0.85.1, loads the real SDK with isolated directories,
executes commands, checks native reload and lifecycle events, exercises the
reload tool's command dispatch, and verifies recovery after invalid source.
It does not install packages. SDK evidence and official terminal interaction
evidence are recorded separately in the [experiment spec](../../docs/specs/2026-09-09-pi-wasm-extension-runtime.md).
