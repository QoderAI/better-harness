# Compile and reload plugins in the official DSH runtime

## Traceability

- Spec ID: dsh-wasm-plugin-runtime
- Status: Implemented as a local experiment
- Request: a DSH equivalent of the Pi runtime extension compiler experiment.
- Independent branch from main; no Story id was supplied.

## Intent

Keep the preinstalled official DSH runtime and Web interface running while
compiling a changing local TypeScript plugin with esbuild-wasm. Publish a new
immutable module and update its Profile entry through DSH's existing live patch
mechanism, avoiding changes to the installed Bundle set or global module HMR.

## Acceptance scenarios

- **AC-1:** Build an entry and its local imports with existing esbuild-wasm,
  retaining DSH-owned packages as external imports. Require named `apply` and
  emit a content-addressed module. Compilation errors preserve the active patch.
- **AC-2:** A new explicitly selected experiment home owns its Profile manifest
  and patch. Reject non-owned nonempty homes; never alter the user's default
  DSH home or an existing general-purpose Profile. Publish the module before
  atomically replacing the patch. Only one writer may own a given home.
- **AC-3:** Run an explicitly selected installed DSH JS CLI with the official
  base/Web bundles and live Profile patches. A later build updates the plugin
  in the same DSH process. Optional watch mode explicitly authorizes rebuild
  and activation after saves. Shutdown disposes the compiler and child process.
- **AC-4:** A real DSH smoke observes v1 -> v2, old-instance disposal, unchanged
  PID and Web URL, compilation-error retention and recovery. Verify the native
  Web shell, a registered tool and a probe route without model calls. Test the
  official browser interface separately from a fixture or HTTP-only claim.
- **AC-5:** Cover portable path/CLI/JSON contracts, publication failure,
  ownership and lifecycle; document differences from Pi and runtime limits.

## Non-goals

Studio page changes, a DSH replacement UI, full-application source compilation,
Bundle installation, default-home mutation, a new supported agent adapter,
arbitrary runtime side-effect rollback, automatic idle detection across all
Agents, browser client compilation, packaged desktop acceptance, or removal of
dependencies already present in DSH.

## Plan and tasks

1. Add a capability under `scripts/dsh-plugin-runtime/` with build/watch/run,
   a DSH-specific compiler and owned Profile publisher. No imports from Pi's
   private capability implementation and no package/lockfile changes.
2. Store content-addressed modules under the experiment Profile, letting DSH's
   installation fallback resolve native imports. A single named Profile row
   changes its module URL on each code revision; existing bundles stay fixed.
3. Demonstrate a native model-facing greeting tool and an inert read-only probe
   route. Bind routes and lifecycle receipts to Cordis effects so reload removes
   old registrations. No privileged mutation endpoint is introduced.
4. Exercise actual official Web boot and native reload, plus compile failures,
   duplicate publication and graceful shutdown. Record evidence and limitations.

## Test and review evidence

- AC-1/2/3/5: 13 focused runtime and CLI tests pass, including immutable module
  execution, imported same-length edits, failed-build retention/recovery,
  ownership/patch mutation rejection, writer lock exclusion, watch activation
  publication and child shutdown through stdin control.
- AC-4: native smoke against installed DSH 0.1.2-rc.1 on macOS / Node 24.20.0
  observes v1 -> v2 -> v3 in one PID and Web URL, with disposal of each replaced
  instance and final disposal on shutdown. Syntax error leaves v2 callable;
  recovery activates v3. GET probe invokes the actual registered tool
  definition; it does not exercise the full tool dispatch or model pipeline.
- AC-4: Playwright opened official Web, confirmed first-start notice, selected
  a temporary workspace through the official browser picker, focused the input,
  and retained an unsent draft across both reloads. Zero console/page errors;
  before/after screenshots were inspected. No model requests were made.
- One browser smoke measured 183 ms initial compilation, 83 ms incremental
  compilation and a 1,369-byte example module. Timings exclude native activation.
  Receipts/screenshots live under ignored `dist/dsh-wasm-smoke/`.
- Combined focused, doc-link, scripts architecture and Antigravity artifact
  checks: 63 passed, 1 skipped. Doc-link graph regeneration produced no diff.
- A bounded Codex CLI consumer read only README/help before invoking three
  builds: valid publication, invalid syntax with nonzero exit and unchanged
  patch, then valid recovery with a different revision. No documentation
  problem was observed; it did not start DSH or inspect the implementation.
- `npm run preview` could not start because the local Canvas SDK runtime is
  absent; its `/health` and `/canvas-module.js` were not verified. This is
  separate from the successful native DSH Web browser smoke.
- Windows/Linux native DSH execution, packaged Studio and hosted CI are not
  part of the local acceptance claim. No Studio visual surface changed.

Readiness scope: the compiler, CLI, example, native smoke, tests and capability
README implement this spec. No supplied Story id, package changes, generated
changes or unrelated checkout edits are included. Local code was reviewed for
publication ordering, native lifecycle cleanup, host path handling and the
published/activated distinction. The commit records its AI co-author explicitly.

## Risks and boundaries

Trusted local plugin code executes with DSH host authority. Compilation is not
type checking or a sandbox. Updating a plugin may interrupt its active work;
use an idle experiment session. Invalid runtime behavior after successful
compilation is not guaranteed to roll back. Immutable modules avoid ESM cache
reuse but remain in the process module cache until exit; repeated long-running
editing sessions should restart periodically. Profile module updates differ
from changes to Bundle membership, which still require process restart.
