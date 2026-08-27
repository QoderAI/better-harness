# @qoder-ai/harness-studio

A local React control plane for [`@qoder-ai/harness`](../harness/README.md):
durable Harness objects organize the evidence, inspection, live-run, and
experiment surfaces the Harness toolchain produces.

- **Harness control plane** — organizes work as `Overview`, `Inspector`,
  `Harnesses`, `Task Suites`, `Experiments`, and `Registry`. Unimplemented
  source, suite, and promotion capabilities stay visibly marked as foundations
  instead of appearing as working controls.

- **Inspector workspace** — embeds an explicitly supplied, self-contained
  Harness Inspector report behind a sandboxed, read-only document boundary.

- **Run view** — drives a live harness run over the AG-UI protocol served by
  [`@qoder-ai/harness-ui`](../harness-ui/README.md) (embedded under `/agui`),
  rendering streamed assistant messages, warnings, and workbench-style
  expandable tool cards with arguments, retained results, execution state,
  failed/result-unavailable states, bounded-result truncation evidence, and the
  final run result.
- **Compare view** — loads a `harness-compare.v1` evidence directory and
  renders the frozen `verdict.json`: per-variant pass rate, mean score, cost,
  and per-trial outcomes.

The existing static outputs (the zero-dependency harness inspector HTML and
the compare `verdict.html`) stay authoritative and offline-friendly; the
studio reads the same evidence and adds interactivity on top.

## Usage

```sh
# Inspector evidence only
npx @qoder-ai/harness-studio --inspector ./harness-inspector.html

# Compare evidence only
npx @qoder-ai/harness-studio --evidence ./harness-readme-compare-evidence

# Live runs only
npx @qoder-ai/harness-studio --harness my-agent.harness

# Combined control plane on one port
npx @qoder-ai/harness-studio \
  --inspector ./harness-inspector.html \
  --harness my-agent.harness \
  --evidence ./evidence

# Discover project history, resolve a checkpoint, and lock it before Run
npx @qoder-ai/harness-studio \
  --experiment ./experiment.json \
  --history-catalog ./checkpoint-history.json \
  --experiment-locks ./.harness-studio-locks
```

Then open the printed URL (default `http://127.0.0.1:3311`). The server binds
to loopback; live runs execute through the same v0.2 executors and redaction
rules as the core package. The embedded run endpoint accepts same-origin JSON
browser requests only; use the standalone `@qoder-ai/harness-ui` server with
an explicit `--allow-origin` when the frontend is hosted on another origin.

A `source`-backed skill is locked and read from `--source-root`, which
defaults to the directory containing `--harness`. Pass it explicitly when the
harness's skills live somewhere else.

The optional `checkpoint-history.v1` catalog is the first file-backed history
adapter. Studio exposes only opaque item ids and display projections to the
browser. Resolving an item verifies its checkpoint, prompt, and trajectory but
does not create a worktree or sandbox. `Lock selected history` writes a
content-addressed experiment definition and makes it active only after the
existing experiment loader accepts it; isolated lane copies are still created
only by Run. Other providers, including versioned document or presentation
systems, can inject the same server adapter interface without adopting the
catalog's storage format.

An embedding application can install an Artifact Provider implemented against
`@qoder-ai/harness/artifacts`, activate one exact fingerprint-bound
contribution, and inject it explicitly:

```ts
import {
  activateArtifactContribution,
  startHarnessStudioServer,
} from "@qoder-ai/harness-studio";

await activateArtifactContribution(
  provider,
  "my-format",
  "external-fallback",
  { extensions: ["my-format"] },
  { root: stateRoot },
);

await startHarnessStudioServer({
  appDir,
  artifactDirectory,
  artifactProviderStateRoot: stateRoot,
  artifactProviders: [provider],
  artifactCompileLimits: { maxSourceFiles: 128 },
});
```

Numeric compile limits may be adjusted only within Studio's hard ceilings and
are part of build/cache identity. They do not expand the package allowlist.
Injected Provider receipts are fingerprint-checked, and an inactive or changed
fingerprint never enters selection.

The standalone CLI accepts the same boundary without importing Provider-private
files. Install the Provider beside Studio, then name its public module
explicitly (loading it executes trusted local code):

```bash
harness-studio \
  --artifact-provider-module @homology/integration-harness-notebook-provider \
  --artifacts ./artifacts
```

The module must export `createArtifactProvider()`. Contributions remain inactive
until `harness-studio artifact-provider activate` records the exact Provider
fingerprint and matcher.

### AgentReact artifacts

Studio selects the production AgentReact runtime only for the explicit compound
suffix `*.agent.canvas.tsx`; existing `*.canvas.tsx` keeps the general React
preview, and ordinary TSX remains source-only. The static view id must equal the
portable filename stem before `.agent.canvas.tsx`:

```tsx
import {
  defineArtifactView,
  useArtifactAction,
  useArtifactState,
} from "@studio/agent-react";

function Orders() {
  const [orders, setOrders] = useArtifactState<readonly string[]>("/orders");
  const showSource = useArtifactAction("studio.show-source");
  return <main>
    <h1>Orders</h1>
    <output>{orders.length}</output>
    <button onClick={() => setOrders([...orders, "next"])}>Add</button>
    <button onClick={() => void showSource()}>Show source</button>
  </main>;
}

export default defineArtifactView({
  id: "orders", // orders.agent.canvas.tsx
  state: { "/orders": { schema: "list", version: 1 } },
  capabilities: ["studio.show-source"],
  component: Orders,
});
```

The built-in Host provides `json@1`, `list@1`, and `record@1` state and grants
only `studio.show-source`; other requested actions fail closed. Source is
compiled by a deadline-enforced Worker and runs only after an opaque, no-network
staging frame verifies the build. A failed replacement leaves the last verified
Current frame visible. See the
[AgentReact production foundation spec](../../docs/specs/2026-08-27-agent-react-artifact-runtime-poc.md)
for the exact language profile, ABI, and evidence boundary.

## Architecture

```text
dist/app/          esbuild-bundled React app (index.html + assets/app.js)
src/contracts/      types and wire formats shared by app and server
                     (artifact, debugger-session, experiment, git-history,
                     input-trace, intent-correlation, workspace-artifact)
src/app/            shell (App.tsx, studio-shell-model.ts, studio-theme.ts)
                     plus feature areas, each a components+state pair:
                       run/          live run view, AG-UI reducer, Debugger
                                     cursor navigation, recorded sample
                       experiment/   three-lane experiment trace view
                       artifacts/    per-format Artifact Surface views and
                                     the surface registry
                       code/         shared code/diff rendering (Shiki
                                     highlighting, ArtifactCodeView)
                     and single-view areas at the top level (Compare,
                     Customizations, GitHistory, InputTrace, Inspector,
                     ArtifactsWorkspace)
src/server/          static host + /api/config + /api/evidence + embedded
                     /agui, grouped by domain:
                       artifacts/registry/   catalog, compile runtime,
                                             Provider activation/discovery
                       artifacts/adapters/   built-in docx/markdown/pdf/
                                             pptx/xlsx format adapters
                       providers/qoder/      Qoder-specific Provider,
                                             Canvas bridge, intent analyzer
                       providers/walnut/     Walnut Provider and bootstrap
                       experiment/           experiment events + locking
                       workspace/            workspace/session discovery
                       query/               read-only route query helpers
```

The pure modules are the tested seam; the React components are direct renders
of their outputs. `src/index.ts` is the Node entry point (server, CLI,
Provider activation); `src/client.ts` re-exports only the browser-safe subset
(also available from the package as `@qoder-ai/harness-studio/client`) so a
browser bundle never pulls in Node-only code.

## Development

```sh
npm run harness-studio:dev                  # live reload at http://127.0.0.1:3311
npm run harness-studio:dev -- --port 4311   # forward workspace launcher options
npm run harness-studio:build   # tsc + esbuild-wasm bundle
npm run harness-studio:test
npm run harness-studio:test:browser   # built-app Playwright interaction
```

Run the development command from the repository root. It incrementally rebuilds
Studio browser dependencies plus its HTML and styles, then reloads open pages
after a successful build. A browser build error leaves the server running and
the next valid edit recovers normally. The repository's local workspace launcher
supplies Session discovery and the default ACP Agent. Server-side source changes
still require restarting the command; this is live reload rather than React Fast
Refresh.

Publication is repository-owned: select `harness-studio` in the protected
GitHub Actions `Publish npm` workflow. Local commands only build, test, pack,
or dry-run; do not publish this workspace from a developer machine.

See the spec:
[Harness UI and Studio](https://github.com/QoderAI/better-harness/blob/main/docs/specs/2026-08-15-harness-ui-studio.md)
and [Harness Studio information architecture](../../docs/specs/2026-08-18-harness-studio-information-architecture.md).
