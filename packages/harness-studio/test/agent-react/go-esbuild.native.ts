import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createGoEsbuildLinker } from "../../src/agent-react/host/go-esbuild-linker.js";
import { createOxcCompiler } from "../../src/agent-react/kernel/compiler.js";
import { createBuildCoordinator } from "../../src/agent-react/host/build-coordinator.js";
import { createAllowedPackageResolver, linkArtifactBundle, type ArtifactLinkerFactory, type LinkInput } from "../../src/agent-react/linker/index.js";
import { startHarnessStudioServer } from "../../src/server/server.js";
import { resetArtifactCompileRuntime } from "../../src/server/artifacts/registry/artifact-compile-runtime.js";
import { compileAgentReactProduction } from "../../src/server/artifacts/registry/agent-react-production-runtime.js";
import { ORDERS_VIEW_MODULE, STAT_ROW_MODULE, TEST_RUNTIME_PACKAGES, revisionOf } from "./pipeline-fixture.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../better-harness-desktop/dist/native');
const stdio = join(root, process.platform === 'win32' ? 'harness-esbuild-service.exe' : 'harness-esbuild-service');
const xpc = join(root, 'Harness Esbuild.app', 'Contents', 'MacOS', 'harness-esbuild-client');
const transports = [{ transport: 'stdio' as const, executable: stdio },
  ...(process.platform === 'darwin' ? [{ transport: 'nsxpc' as const, executable: xpc }] : [])];
const runtime = `data:text/javascript,${encodeURIComponent('export function setActiveArtifactRuntime(){};export function clearActiveArtifactRuntime(){};')}`;
const packages = TEST_RUNTIME_PACKAGES.map((entry) => ({ ...entry, external: runtime }));
function input(code = 'import {value} from "./nested/value.js"; export default {id:"sample",value};'): LinkInput {
  const compiledModules = new Map([['/view.tsx', code], ['/nested/value.ts', 'export const value = "你好😀";']]);
  return { compiledModules, entryModule: '/view.tsx', maxOutputBytes: 1024 * 1024,
    resolver: createAllowedPackageResolver({ modulePaths: [...compiledModules.keys()], runtimePackages: packages }) };
}

describe.each(transports)('Go esbuild $transport', ({ executable, transport }) => {
  it('executes a native-linked module with TypeScript resolution and trusted runtime externals', async () => {
    const linker = createGoEsbuildLinker({ executable, transport });
    const directory = await mkdtemp(join(tmpdir(), 'go-linker-execution-'));
    try {
      const actual = await linker.link(input());
      const expected = await linkArtifactBundle(input());
      expect(actual).toEqual(expected);
      if (actual.status !== 'ready') throw new Error('link failed');
      const filename = join(directory, 'bundle.mjs');
      await writeFile(filename, actual.bundle);
      const bundle = await import(pathToFileURL(filename).href);
      expect(bundle.view).toEqual({ id: 'sample', value: '你好😀' });
      expect(bundle.activateArtifactRuntime({})).toBe(bundle.view);
      bundle.deactivateArtifactRuntime();
      expect(linker.processId).toBeGreaterThan(0);
      expect(linker.processId).not.toBe(process.pid);
      if (transport === 'nsxpc') expect(linker.processId).not.toBe(linker.bridgeProcessId);
    } finally { await linker.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it('preserves OXC semantic outputs while binding linker identity into the build digest', async () => {
    const linker = createGoEsbuildLinker({ executable, transport });
    const revision = revisionOf('orders.dashboard', '/view.tsx', [ORDERS_VIEW_MODULE, STAT_ROW_MODULE]);
    const options = { compiler: createOxcCompiler(), runtimePackages: TEST_RUNTIME_PACKAGES };
    try {
      const expected = await createBuildCoordinator(options).build(revision);
      const actual = await createBuildCoordinator({ ...options, linker }).build(revision);
      expect(actual.status).toBe('ready');
      expect(actual.bundle).toBe(expected.bundle);
      expect(actual.semanticIndex).toEqual(expected.semanticIndex);
      expect(actual.sourceMaps).toEqual(expected.sourceMaps);
      expect(actual.viewDeclaration).toEqual(expected.viewDeclaration);
      expect(actual.buildPolicyDigest).not.toBe(expected.buildPolicyDigest);
      expect(actual.buildDigest).not.toBe(expected.buildDigest);
      const nextVersion = await createBuildCoordinator({ ...options, linker: { ...linker, linkerVersion: 'next' } }).build(revision);
      expect(nextVersion.bundle).toBe(actual.bundle);
      expect(nextVersion.buildDigest).not.toBe(actual.buildDigest);
    } finally { await linker.close(); }
  });

  it('refuses forbidden packages, host files and oversized output', async () => {
    const linker = createGoEsbuildLinker({ executable, transport });
    try {
      for (const [specifier, code] of [['node:fs', 'link/package-not-allowed'], ['https://example.com/mod.js', 'link/package-not-allowed'], ['/etc/passwd', 'link/failed'], ['./missing.js', 'link/failed']]) {
        const result = await linker.link(input(`import value from ${JSON.stringify(specifier)}; export default value;`));
        expect(result.status).toBe('failed');
        expect(result.diagnostics.some((entry) => entry.code === code)).toBe(true);
      }
      expect((await linker.link({ ...input(), maxOutputBytes: 1 })).diagnostics[0]?.code).toBe('limit/output-bytes');
    } finally { await linker.close(); }
  });

  it('rejects a Profile violation before any native link request', async () => {
    const linker = createGoEsbuildLinker({ executable, transport });
    try {
      const result = await createBuildCoordinator({ compiler: createOxcCompiler(), runtimePackages: TEST_RUNTIME_PACKAGES, linker })
        .build(revisionOf('orders.dashboard', '/view.tsx', [{ ...ORDERS_VIEW_MODULE, text: 'import fs from "node:fs";\n' + ORDERS_VIEW_MODULE.text }, STAT_ROW_MODULE]));
      expect(result.status).toBe('failed');
      expect(result.diagnostics.some((entry) => entry.code === 'profile/node-builtin')).toBe(true);
      expect(linker.bridgeProcessId).toBeUndefined();
    } finally { await linker.close(); }
  });

  it('recovers after timeout, exit, malformed and incompatible responses without fallback', async () => {
    for (const code of ['setInterval(()=>{},1000)', 'process.exit(1)', 'process.stdout.write("invalid\\n");setInterval(()=>{},1000)',
      'process.stdout.write("x".repeat(64*1024*1024+1));setInterval(()=>{},1000)',
      'process.stdout.write(JSON.stringify({version:1,id:1,pid:process.pid,engineVersion:"esbuild-go-0.28.2+link-v1",result:{status:"ready",bundle:"",diagnostics:[{level:["warning"],code:"link/failed",message:"invalid level"}]}})+"\\n");setInterval(()=>{},1000)',
      'process.stdout.write(JSON.stringify({version:1,id:1,pid:process.pid,engineVersion:"unexpected",result:{status:"ready",bundle:"",diagnostics:[]}})+"\\n");setInterval(()=>{},1000)']) {
      let launches = 0;
      const linker = createGoEsbuildLinker({ executable, transport, timeoutMs: 1_000,
        spawnProcess(binary) { return ++launches === 1 ? spawn(process.execPath, ['-e', code], { stdio: 'pipe' }) : spawn(binary, [], { stdio: 'pipe' }); },
      });
      try {
        expect((await linker.link(input())).diagnostics[0]?.code).toBe('limit/compile-timeout');
        expect((await linker.link(input())).status).toBe('ready');
        expect(launches).toBe(2);
      } finally { await linker.close(); }
    }
  });

  it('re-queues work that never reached a killed service instead of failing it', async () => {
    // The service links one request at a time, so a stalled first request must not
    // take down a request that was still waiting its turn to be written.
    let launches = 0;
    const linker = createGoEsbuildLinker({ executable, transport, timeoutMs: 1_000,
      spawnProcess(binary) { return ++launches === 1 ? spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'pipe' }) : spawn(binary, [], { stdio: 'pipe' }); },
    });
    try {
      const [stalled, queued] = await Promise.all([linker.link(input()), linker.link(input())]);
      expect(stalled.diagnostics[0]?.code).toBe('limit/compile-timeout');
      expect(queued.status).toBe('ready');
      expect(launches).toBe(2);
    } finally { await linker.close(); }
  });

  it('bounds admission, correlates parallel requests and closes pending work', async () => {
    const linker = createGoEsbuildLinker({ executable, transport });
    try {
      expect((await linker.link(input('x'.repeat(1024 * 1024 + 1)))).status).toBe('failed');
      expect(linker.bridgeProcessId).toBeUndefined();
      const results = await Promise.all([linker.link(input()), linker.link(input('const ='))]);
      expect(results.map((result) => result.status)).toEqual(['ready', 'failed']);
    } finally { await linker.close(); }
    const stalled = createGoEsbuildLinker({ executable, transport,
      spawnProcess: () => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'pipe' }),
    });
    const pending = stalled.link(input());
    await stalled.close();
    expect((await pending).diagnostics[0]?.code).toBe('limit/compile-timeout');
    await expect(stalled.link(input())).rejects.toThrow('closed');
  });

  it('build and preview routes inject and close the linker, and separate factory caches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'go-linker-http-'));
    const source = 'import {defineArtifactView} from "@studio/agent-react";function Sample(){return <h1>你好😀</h1>}export default defineArtifactView({id:"sample",component:Sample});';
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Studio</title>');
    await writeFile(join(directory, 'sample.agent.canvas.tsx'), source);
    let linked = 0; let closed = 0;
    const factory: ArtifactLinkerFactory = (options) => {
      const linker = createGoEsbuildLinker({ executable, transport, ...options });
      return { ...linker, async link(input) { linked++; return linker.link(input); }, async close() { closed++; await linker.close(); } };
    };
    const first = await startHarnessStudioServer({ appDir: directory, artifactDirectory: directory, artifactLinkerFactory: factory });
    const second = await startHarnessStudioServer({ appDir: directory, artifactDirectory: directory, artifactLinkerFactory: (options) => ({ ...factory(options), linkerVersion: "next-linker-version" }) });
    try {
      const catalog = await (await fetch(`${first.url}/api/artifacts`)).json();
      const entry = catalog.artifacts.find((artifact: { label: string }) => artifact.label === 'sample.agent.canvas.tsx');
      const build = await (await fetch(first.url + entry.build.snapshotUri)).json();
      expect(build.status).toBe('ready');
      expect(linked).toBe(1); expect(closed).toBe(1);
      const secondBuild = await (await fetch(second.url + entry.build.snapshotUri)).json();
      expect(secondBuild.status).toBe('ready');
      expect(secondBuild.buildId).not.toBe(build.buildId);
      expect(linked).toBe(2); expect(closed).toBe(2);
      resetArtifactCompileRuntime();
      expect((await fetch(first.url + build.previewUri)).status).toBe(200);
      expect(linked).toBe(3); expect(closed).toBe(3);
    } finally { await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it('does not cache transient native linker failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'go-linker-production-'));
    const entryPath = join(directory, 'sample.tsx');
    await writeFile(entryPath, 'import {defineArtifactView} from "@studio/agent-react";function Sample(){return <h1/>}export default defineArtifactView({id:"sample",component:Sample});');
    let closed = 0;
    try {
      const result = await compileAgentReactProduction({ artifactRoot: directory, entryPath, viewId: 'sample', maxModules: 8,
        maxSourceBytes: 1024 * 1024, maxOutputBytes: 4 * 1024 * 1024, timeoutMs: 20_000,
        artifactLinkerFactory: () => {
          const linker = createGoEsbuildLinker({ executable, transport, timeoutMs: 100,
            spawnProcess: () => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'pipe' }) });
          return { ...linker, async close() { closed++; await linker.close(); } };
        },
      });
      expect(result.status).toBe('failed'); expect(result.cacheable).toBe(false); expect(closed).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe.skipIf(process.platform !== 'darwin')('Go NSXPC transport identity', () => {
  it('rejects a plain stdio executable when the host requires NSXPC', async () => {
    const linker = createGoEsbuildLinker({ executable: stdio, transport: 'nsxpc' });
    try { expect((await linker.link(input())).diagnostics[0]?.code).toBe('limit/compile-timeout'); }
    finally { await linker.close(); }
  });

  it('reconnects after an unresponsive XPC service is terminated', async () => {
    const linker = createGoEsbuildLinker({ executable: xpc, transport: 'nsxpc', timeoutMs: 1_000 });
    let pid: number | undefined;
    try {
      expect((await linker.link(input())).status).toBe('ready');
      pid = linker.processId!;
      process.kill(pid, 'SIGSTOP');
      expect((await linker.link(input())).diagnostics[0]?.code).toBe('limit/compile-timeout');
      await linker.close();
      expect(() => process.kill(linker.bridgeProcessId!, 0)).toThrow();
    } finally {
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ } }
      await linker.close();
    }
    const recovered = createGoEsbuildLinker({ executable: xpc, transport: 'nsxpc', timeoutMs: 20_000 });
    try {
      expect((await recovered.link(input())).status).toBe('ready');
      expect(recovered.processId).not.toBe(pid);
    } finally { await recovered.close(); }
  });
});
