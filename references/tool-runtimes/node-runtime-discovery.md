# Node Runtime Discovery

Use this reference before running Better Harness Node-backed tools when `node` is
not available on `PATH` or `node --version` fails. Treat the resolved executable
as `<node>` in command examples.

Do not install Node, mutate PATH, or create symlinks as part of discovery.

## Discovery Order

1. Use `NODE_REPL_NODE_PATH` or a user-provided Node path when present.
2. Use `node` from `PATH` only if `node --version` succeeds.
3. Prefer standalone Codex and Cursor helpers:
   - macOS Codex:
     `/Applications/Codex.app/Contents/Resources/cua_node/bin/node`
   - macOS Cursor:
     `/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node`
4. Only use Electron-as-Node as a final fallback after validating that it runs
   as Node and exits quickly. For example:
   - macOS:
      `ELECTRON_RUN_AS_NODE=1 /Applications/Qoder.app/Contents/MacOS/Electron`
    - Windows PowerShell:
     `$env:ELECTRON_RUN_AS_NODE="1"; & "$env:LOCALAPPDATA\Programs\Qoder\Qoder.exe" -e "console.log(process.version)"`
   - Windows CMD:
     `set "ELECTRON_RUN_AS_NODE=1" && "%LOCALAPPDATA%\Programs\Qoder\Qoder.exe" -e "console.log(process.version)"`

Qoder app binaries that are not named `node` or `node.exe` are not automatically
valid Node helpers. Probe them only when a user provides the path, and skip them
unless validation proves they behave as Node.

## Candidate Validation

Validate every candidate before using it:

```sh
"$NODE" -p 'JSON.stringify({node:process.versions.node,electron:process.versions.electron||null})'
```

Accept the candidate only when the command exits quickly, returns valid JSON,
and reports `node >= 22.22.0`.

For Electron-as-Node, set the host's Node mode if needed, run the same
validation with a short timeout, and require quick exit. If it launches the app,
hangs, or reports an older Node version, reject it.

## Command Usage

After resolving `<node>`, run Better Harness `.mjs` tools with that executable:

```sh
"<node>" <better-harness-root>/scripts/session-analysis.mjs sources --platform <platform> --workspace <absolute-target-path> --format markdown
"<node>" scripts/core-change-watch/evidence-pack.mjs --cwd <repo> --json
"<node>" scripts/harness-analysis/report-quality.mjs --report <report.md>
```

When command execution becomes report evidence, cite the resolved runtime source
and version, for example `Node runtime: Qoder.app helper v24.x` or
`Node runtime: PATH node v22.22.0`.

If no candidate validates, ask the user to install Node.js `>=22.22.0` or
provide `NODE_REPL_NODE_PATH`.
