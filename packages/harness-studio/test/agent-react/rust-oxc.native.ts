import { startHarnessStudioServer } from "../../src/server/server.js";
import { resetArtifactCompileRuntime } from "../../src/server/artifacts/registry/artifact-compile-runtime.js";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRustOxcCompiler } from "../../src/agent-react/host/rust-oxc-compiler.js";
import { createOxcCompiler } from "../../src/agent-react/kernel/compiler.js";
import { createSemanticOxcCompiler } from "../../src/agent-react/kernel/semantic-compiler.js";
import { compileAgentReactProduction } from "../../src/server/artifacts/registry/agent-react-production-runtime.js";
import type { CompileModuleInput } from "../../src/agent-react/contracts/index.js";

const stdioExecutable = resolve(dirname(fileURLToPath(import.meta.url)), '../../../better-harness-desktop/dist/native', process.platform === 'win32' ? 'harness-oxc-service.exe' : 'harness-oxc-service');
const source = `import { defineArtifactView } from "@studio/agent-react";
function Orders() { return <h1 title="你好😀">Orders</h1>; }
export default defineArtifactView({ id: "orders", component: Orders });`;
const input = (text = source): CompileModuleInput => ({ module: { path: '/orders.tsx', text }, entry: true,
  allowedPackages: ['react', '@studio/agent-react', '@studio/agent-react/jsx-dev-runtime'] });

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../better-harness-desktop/dist/native');
const xpcExecutable = join(nativeRoot, 'Harness OXC.app', 'Contents', 'MacOS', 'harness-oxc-client');
const transports = [
  { transport: 'stdio' as const, executable: stdioExecutable },
  ...(process.platform === 'darwin' ? [{ transport: 'nsxpc' as const, executable: xpcExecutable }] : []),
];
describe.each(transports)('Rust OXC $transport service', ({ executable, transport }) => {
  it('build and preview HTTP routes both use the injected Rust compiler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rust-oxc-http-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Studio</title>');
    await writeFile(join(root, 'orders.agent.canvas.tsx'), source);
    let calls = 0;
    const server = await startHarnessStudioServer({ appDir: root, artifactDirectory: root,
      oxcCompilerFactory(options) { calls++; return createRustOxcCompiler({ executable, transport, ...options }); },
    });
    try {
      const catalog = await (await fetch(`${server.url}/api/artifacts`)).json();
      const entry = catalog.artifacts.find((artifact: { label: string }) => artifact.label === 'orders.agent.canvas.tsx');
      const result = await fetch(server.url + entry.build.snapshotUri);
      expect(result.status).toBe(200);
      const build = await result.json();
      expect(build.status).toBe('ready');
      expect(calls).toBe(1);
      resetArtifactCompileRuntime();
      const preview = await fetch(server.url + build.previewUri);
      expect(preview.status).toBe(200);
      expect(calls).toBe(2);
    } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
  });

  it('preserves semantic outputs, diagnostic coordinates, code and source maps across the native backends', async () => {
    const rust = createRustOxcCompiler({ executable, transport });
    const napi = createOxcCompiler();
    try {
      for (const text of [source, source.replace('return <h1', "const greeting = '你好😀'; return <h1"), source.replace('<h1', '<div').replace('</h1>', '</div>'), 'const 中文 = "😀"; const =', 'import fs from "node:fs";\n' + source, source.replace('return <h1', 'fetch("https://example.com"); return <h1'), source.replace('id: "orders"', 'id: dynamic')]) {
        const expected = await napi.compileModule(input(text));
        const actual = await rust.compileModule(input(text));
        expect({ ...actual, sourceMap: actual.sourceMap && JSON.parse(actual.sourceMap) })
          .toEqual({ ...expected, sourceMap: expected.sourceMap && JSON.parse(expected.sourceMap) });
      }
      expect(rust.processId).toBeGreaterThan(0);
      expect(rust.processId).not.toBe(process.pid);
      if (transport === 'nsxpc') expect(rust.processId).not.toBe(rust.bridgeProcessId);
    } finally { await rust.close(); }
  });

  it('refuses profile violations before requesting native transformation', async () => {
    const napi = createOxcCompiler();
    const { parseSync } = await import('oxc-parser');
    let transforms = 0;
    const semantic = createSemanticOxcCompiler({
      async parse(filename, text) { return parseSync(filename, text, { lang: 'tsx', sourceType: 'module' }); },
      async transform() { transforms++; throw new Error('unexpected transform'); },
    }, napi.compilerVersion);
    const output = await semantic.compileModule(input('import fs from "node:fs";\n' + source));
    expect(output.diagnostics.some((d) => d.code === 'profile/node-builtin')).toBe(true);
    expect(output.code).toBeUndefined();
    expect(transforms).toBe(0);
  });

  it('recovers with a fresh Rust process after timeout, crash, malformed and oversized output', async () => {
    for (const code of ['setInterval(() => {}, 1000)', 'process.exit(0)', 'process.stdout.write("not-json\\n"); setInterval(()=>{},1000)', 'process.stdout.write("x".repeat(17 * 1024 * 1024)); setInterval(()=>{},1000)']) {
      let launches = 0;
      const rust = createRustOxcCompiler({ executable, transport, timeoutMs: 1_000,
        spawnProcess(binary) {
          launches++;
          return launches === 1 ? spawn(process.execPath, ['-e', code], { stdio: 'pipe' }) : spawn(binary, [], { stdio: 'pipe' });
        },
      });
      try {
        expect((await rust.compileModule(input())).diagnostics[0]?.code).toBe('limit/compile-timeout');
        expect((await rust.compileModule(input())).diagnostics).toEqual([]);
        expect(launches).toBe(2);
      } finally { await rust.close(); }
    }
  });

  it('close cancels pending work and refuses later compilation', async () => {
    const rust = createRustOxcCompiler({ executable, transport, spawnProcess: () => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'pipe' }) });
    const compiling = rust.compileModule(input());
    await rust.close();
    expect((await compiling).diagnostics[0]?.code).toBe('limit/compile-timeout');
    await expect(rust.compileModule(input())).rejects.toThrow('closed');
  });

  it('bounds source admission before launching and correlates concurrent requests', async () => {
    const rust = createRustOxcCompiler({ executable, transport });
    try {
      expect((await rust.compileModule(input('x'.repeat(513 * 1024)))).diagnostics[0]?.code).toBe('limit/module-bytes');
      expect(rust.processId).toBeUndefined();
      const outputs = await Promise.all([rust.compileModule(input()), rust.compileModule(input('const ='))]);
      expect(outputs[0]?.viewDeclaration?.id).toBe('orders');
      expect(outputs[1]?.diagnostics[0]?.code).toBe('syntax/parse-failed');
    } finally { await rust.close(); }
  });

  it('the production compiler uses and closes the injected Rust factory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rust-oxc-production-'));
    const entryPath = join(root, 'orders.tsx');
    await writeFile(entryPath, source);
    let compiled = 0;
    let closed = 0;
    try {
      const result = await compileAgentReactProduction({ artifactRoot: root, entryPath, viewId: 'orders', maxModules: 8,
        maxSourceBytes: 1024 * 1024, maxOutputBytes: 4 * 1024 * 1024, timeoutMs: 20_000,
        oxcCompilerFactory(options) {
          const rust = createRustOxcCompiler({ executable, transport, ...options });
          return { ...rust, compileModule(module) { compiled++; return rust.compileModule(module); }, async close() { closed++; await rust.close(); } };
        },
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.status).toBe('ready');
      expect(compiled).toBeGreaterThan(0);
      expect(closed).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});


describe.skipIf(process.platform !== 'darwin')('Apple NSXPC lifecycle', () => {
  it('bounds an unresponsive service, closes the bridge, and reconnects after service termination', async () => {
    const stalled = createRustOxcCompiler({ executable: xpcExecutable, transport: 'nsxpc', timeoutMs: 1_000 });
    let pid: number | undefined;
    try {
      expect((await stalled.compileModule(input())).diagnostics).toEqual([]);
      pid = stalled.processId!;
      process.kill(pid, 'SIGSTOP');
      expect((await stalled.compileModule(input())).diagnostics[0]?.code).toBe('limit/compile-timeout');
      await stalled.close();
      expect(() => process.kill(stalled.bridgeProcessId!, 0)).toThrow();
    } finally {
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ } }
      await stalled.close();
    }
    // launchd may throttle immediate relaunch after termination.
    const recovered = createRustOxcCompiler({ executable: xpcExecutable, transport: 'nsxpc', timeoutMs: 20_000 });
    try {
      expect((await recovered.compileModule(input())).diagnostics).toEqual([]);
      expect(recovered.processId).not.toBe(pid);
    } finally { await recovered.close(); }
  });

  it('refuses a stdio service when the host explicitly requires NSXPC', async () => {
    const rust = createRustOxcCompiler({ executable: stdioExecutable, transport: 'nsxpc' });
    try { expect((await rust.compileModule(input())).diagnostics[0]?.code).toBe('limit/compile-timeout'); }
    finally { await rust.close(); }
  });
});
