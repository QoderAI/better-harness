import { createRustOxcCompiler } from "@qoder-ai/harness-studio/oxc-service";
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { message, isMessage } from './protocol.mjs';
import {
  startHarnessStudioServer, defaultAppDir, discoverAcpAgentProfiles,
  createRustEvidenceHost, createRustEvidenceWorkspaceSessionProvider,
  createBundledAgentCustomizationCollector,
} from '@qoder-ai/harness-studio';

const port = parentPort;
if (!port) throw new Error('Studio service requires an Electron utility parent');
let server;
let starting = false;
let stopping = false;
let pendingPicker;
let pickerId = 0;
const compilers = new Set();

function pickDirectory() {
  if (pendingPicker) return Promise.reject(new Error('Directory chooser already open'));
  return new Promise((resolve, reject) => {
    const id = ++pickerId;
    const timer = setTimeout(() => {
      pendingPicker = undefined;
      reject(new Error('Directory chooser timed out'));
    }, 10 * 60 * 1000);
    pendingPicker = { id, resolve, reject, timer };
    port.postMessage(message('pick-directory', { id }));
  });
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (pendingPicker) {
    clearTimeout(pendingPicker.timer);
    pendingPicker.reject(new Error('Studio is shutting down'));
    pendingPicker = undefined;
  }
  await Promise.all([...compilers].map((compiler) => compiler.close()));
  await server?.close();
  process.exit(0);
}

port.on('message', async (data) => {
  try {
    if (isMessage(data, 'start') && !starting && !stopping) {
      if (typeof data.token !== 'string' || data.token.length !== 64 || typeof data.dataDirectory !== 'string' || typeof data.oxcExecutable !== 'string' || typeof data.acpHostExecutable !== 'string' || typeof data.evidenceHostExecutable !== 'string' || !['stdio', 'nsxpc'].includes(data.oxcTransport) || !['stdio', 'nsxpc'].includes(data.acpHostTransport) || !['stdio', 'nsxpc'].includes(data.evidenceHostTransport)) {
        throw new Error('Invalid Studio startup contract');
      }
      starting = true;
      const oxcCompilerFactory = ({ timeoutMs }) => {
        if (stopping) throw new Error('Studio is shutting down');
        const compiler = createRustOxcCompiler({ executable: data.oxcExecutable, transport: data.oxcTransport, timeoutMs });
        const close = compiler.close.bind(compiler);
        compiler.close = async () => { try { await close(); } finally { compilers.delete(compiler); } };
        compilers.add(compiler);
        return compiler;
      };
      const probe = oxcCompilerFactory({ timeoutMs: 5_000 });
      let oxcPid;
      let bridgePid;
      try {
        const compiled = await probe.compileModule({ module: { path: '/desktop-smoke.tsx', text: 'export const Desktop = () => <h1>你好</h1>;' }, entry: false, allowedPackages: ['@studio/agent-react/jsx-dev-runtime'] });
        if (compiled.diagnostics.length || !compiled.code) throw new Error('Rust OXC startup probe failed');
        oxcPid = probe.processId;
        bridgePid = probe.bridgeProcessId;
      } finally { await probe.close(); }
      const nativeLibraries = process.report.getReport().sharedObjects;
      if (nativeLibraries.some((library) => /oxc[_-](parser|transform)/i.test(library))) throw new Error('OXC NAPI unexpectedly loaded in Studio');
      // Local diagnostic receipt, without source text or credentials.
      console.info(JSON.stringify({ kind: 'better-harness-desktop.oxc-proof', rust: true, transport: data.oxcTransport, bridgePid, oxcPid, studioPid: process.pid, oxcNativeLoaded: false, acpTransport: data.acpHostTransport, acpRuntime: data.acpHostTransport === 'nsxpc' ? 'acp-v1-nsxpc' : 'acp-v1-rust', evidenceTransport: data.evidenceHostTransport, evidenceRuntime: data.evidenceHostTransport === 'nsxpc' ? 'evidence-v1-nsxpc' : 'evidence-v1-rust' }));
      const acpAgents = await discoverAcpAgentProfiles();
      const evidenceHost = createRustEvidenceHost({
        executable: data.evidenceHostExecutable,
        transport: data.evidenceHostTransport,
      });
      compilers.add({ close: () => evidenceHost.close() });
      await evidenceHost.describe();
      server = await startHarnessStudioServer({
        oxcCompilerFactory,
        acpHostExecutable: data.acpHostExecutable,
        acpHostTransport: data.acpHostTransport,
        acpAgents,
        harnessMode: 'workspace-default',
        appDir: defaultAppDir(), host: '127.0.0.1', port: 0, accessToken: data.token,
        cwd: data.dataDirectory,
        runDirectory: join(data.dataDirectory, 'runs'),
        artifactProviderStateRoot: join(data.dataDirectory, 'providers'),
        walnutCacheRoot: join(data.dataDirectory, 'cache'),
        // Remembered Projects: a relaunch resumes the reader's Project instead
        // of opening on the empty gate.
        projectStateRoot: join(data.dataDirectory, 'state'),
        workspaceSessionProvider: createRustEvidenceWorkspaceSessionProvider(evidenceHost),
        memoryProvider: evidenceHost,
        sessionPerformanceProvider: evidenceHost,
        customizationCollector: createBundledAgentCustomizationCollector(),
        workspaceDirectoryPicker: pickDirectory,
      });
      port.postMessage(message('ready', {
        url: server.url, pid: process.pid, node: process.versions.node, oxc: true,
      }));
    } else if (isMessage(data, 'directory-result') && pendingPicker?.id === data.id) {
      const pending = pendingPicker;
      pendingPicker = undefined;
      clearTimeout(pending.timer);
      if (typeof data.error === 'string') pending.reject(new Error(data.error));
      else if (data.path === undefined || typeof data.path === 'string') pending.resolve(data.path);
      else pending.reject(new Error('Invalid directory result'));
    } else if (isMessage(data, 'stop')) await stop();
  } catch (error) {
    port.postMessage(message('error', { error: error instanceof Error ? error.message : String(error) }));
    await stop();
  }
});
