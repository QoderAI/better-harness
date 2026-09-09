# DSH plugin runtime compiler

Compile a local TypeScript plugin with esbuild-wasm and replace its registration
in a running official DSH process. The official Web interface stays open; DSH's
native Profile loader disposes the previous plugin and applies the next one.
The standalone CLI experiment is described in the
[spec](../../docs/specs/2026-09-09-dsh-wasm-plugin-runtime.md).

## Harness Design in Studio Desktop

Harness Design uses DSH exclusively. Start it with the page's single button,
then use the official DSH composer and tools. The first launched Project gets
`.harness-design/plugin.ts` if that file does not exist. Ask DSH to edit it and
call `harness_compile_plugin`. Finish the current agent turn so activation can
claim idle maintenance lanes; `harness_design_status` reports the result and
source path. Studio also shows a compact status/error row beneath the official
interface. There is no per-keystroke automatic activation.

Desktop owns a separate DSH home beneath its data directory. Configure that
home's provider credentials through the official UI. Changing the selected DSH
workspace does not rebind the compiler source in an already-running process.

`index.mjs` is the public compiler/bootstrap entrypoint. Studio bundles it and
the fixed controller resources, reusing its existing `esbuild-wasm` dependency.
Only plugin TypeScript and local imports are compiled; DSH and the app are
already installed. This does not remove DSH's dependency footprint.
Packaged Desktop unpacks this bundle and the full WASM dependency beside
`app.asar`, then supplies the real path to external DSH. Bootstrap writes a
no-op ESM seed; it does not start a compiler inside Electron.

The Studio Profile uses native `startup` patch policy: the controller alone
awaits native activation and then persists the revision. This avoids a file
watcher racing explicit activation. All existing agents are reserved through
native maintenance; new Agent publication is vetoed only during activation.
Waiting times out after 60 seconds. Shutdown cancels waiting; in-flight native
loader work retains its leases until completion or process termination.

Compile errors keep the old patch. Native apply failure attempts restoration
of the previous full module, including an upstream 0.1.2-rc.1 rollback case
that loses injection metadata. Restoration failure is reported and requires
restarting DSH. Arbitrary plugin side effects are not transactional. A hung
plugin lifecycle can require stopping the app. Old ESM modules remain cached
until exit and their immutable files persist in the owned home.

Run the integrated receipt after building Studio:

```sh
node scripts/dsh-plugin-runtime/design-smoke.mjs /path/to/node_modules/@deepseek-ai/dsh --browser
```

It uses a temporary home, copied distribution, real native tools/maintenance,
failure recovery and official Web draft retention without model calls. Its
authenticated test bridge is not shipped in Studio. See the
[integration spec](../../docs/specs/2026-09-09-studio-dsh-harness-design.md).

## Start and update

Use repository dependencies and Node 24. Supply an already installed
`@deepseek-ai/dsh` JavaScript CLI; the native smoke is pinned to `0.1.2-rc.1`.
No installer or DSH dependency is added by this capability.

From the repository root, replace the DSH path below with your installation:

```sh
node scripts/dsh-plugin-runtime/cli.mjs run --entry scripts/dsh-plugin-runtime/examples/plugin.ts --home dist/dsh-runtime-home --dsh-cli /path/to/node_modules/@deepseek-ai/dsh/lib/bin.js
```

This compiles first, then starts a **new** official DSH Web process on a random
loopback port. Open the URL printed by DSH, complete its first-start notice and
choose a workspace. The explicit home must be empty or already owned by this
experiment. Your normal DSH home is not used.

Edit `examples/greeting.ts`, then run in another terminal:

```sh
node scripts/dsh-plugin-runtime/cli.mjs build --entry scripts/dsh-plugin-runtime/examples/plugin.ts --home dist/dsh-runtime-home --json
```

The running DSH loads the new plugin without a process restart. The example
registers `harness_greeting` and a GET-only `/harness-wasm-probe` route. The route
returns the current greeting, the actual registered tool definition's result
and PID, so activation can be checked without making a model request. It does
not exercise DSH's full permission/approval/tool dispatch pipeline.

For automatic compilation and activation on save, add `--watch` to `run`, or
start a separate `watch` command with the same entry and home. Polling compares
source bytes every 500 ms, including local imported files. Use an idle
experiment session: this implementation does not coordinate with active Agent
turns. Without watch, saves take effect only after an explicit build.

Stop `run` with Ctrl+C; it terminates the child it launched. Automation may use
`run --control-stdio` and send `stop` or close stdin. Standalone `watch` only owns
its compiler, so stopping it leaves DSH running. `--port` selects a fixed port.
This command does not discover or attach to arbitrary existing DSH sessions.

## Publication contract

The compiler creates an isolated `wasm` Profile with fixed official base and
Web bundles and `patchReload: "live"`. Local code is bundled into an immutable
`profiles/wasm/modules/<sha256>.mjs`. Node built-ins and `@deepseek-ai/*` imports
stay external and resolve through the installed DSH runtime. Other bare imports
are rejected; this is not a package installation mechanism.

The module is written before an atomic replacement of `cordis.patch.yml`
(JSON syntax, which is valid YAML). Each revision changes the same plugin row's
module URL. This avoids reusing a cached ESM module. Compilation errors leave
the last published patch intact. Manually changed Profile manifests or patches
are rejected instead of being overwritten.

`build --json` and `watch --json` emit one result per attempted build. A
`published` result contains the revision, paths, byte count, duration, whether
the patch changed, and `activation: "pending-native-loader"`. Publication does
not prove successful native activation. `failed` contains diagnostics; a failed
one-shot build exits nonzero. Setup/argument failures go to stderr and exit
nonzero. An unchanged watch iteration emits nothing.

A per-home directory lock excludes simultaneous compilers. After a crashed
compiler, use a fresh empty home, or remove its `.compiler-lock` only after
confirming no compiler is using that home. The experiment does not steal locks.

## Scope and comparison with Pi

Both this experiment and [the Pi experiment PR](https://github.com/QoderAI/better-harness/pull/159)
keep the application runtime preinstalled and compile only changing extensions.
Pi uses its extension reload API; DSH uses its existing live Profile patch
watcher and Cordis lifecycle. No custom conversation UI is introduced here.

The compiler reuses the repository's existing esbuild-wasm dependency. The
example module is 1,369 bytes in the native smoke; this does **not** reduce the
installed DSH dependency closure or mean the whole application fits in that
size. No package or lockfile change is needed.

Plugin code executes with DSH host authority. Compilation does not type-check,
sandbox code, or guarantee an `apply` export is callable. Native activation
errors and arbitrary side effects do not have a rollback guarantee. Plugins
must bind cleanup to Cordis effects; the example scopes its route this way.
Immutable modules accumulate on disk and in the process ESM cache; restart for
long editing sessions and delete the dedicated home after stopping the runtime
if its experiment state is no longer needed.

Changing the Bundle set still requires restart. This does not compile the DSH
core or browser client at runtime, modify Studio, or add a supported host adapter.
See the upstream pinned
[Profile contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/reference/README.md)
and [native loader contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/vendor/loader/README.md).

## Validation

```sh
npx vitest run test/dsh-plugin-runtime
node scripts/dsh-plugin-runtime/native-smoke.mjs /path/to/node_modules/@deepseek-ai/dsh
node scripts/dsh-plugin-runtime/native-smoke.mjs /path/to/node_modules/@deepseek-ai/dsh --browser
```

The optional browser smoke uses the workspace's Playwright and installed
Chromium. It selects DSH's official browser directory picker for headless use,
opens a temporary workspace, focuses the official input, retains an unsent
draft across two native reloads, and captures screenshots and a JSON receipt in
`dist/dsh-wasm-smoke/`. It cleans up its temporary runtime and makes no model
requests.

Local macOS / Node 24.20.0 / DSH 0.1.2-rc.1 evidence: two reloads in the same
process, all three plugin instances disposed, syntax failure retained v2,
recovery activated v3, official Web draft retained, zero browser errors. One
run measured 183 ms initial compilation and 83 ms incremental compilation;
these timings exclude native loader activation and are not a benchmark.
Windows/Linux native execution and packaged Studio acceptance remain unverified.
