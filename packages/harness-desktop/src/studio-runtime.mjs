import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { message, isMessage } from './protocol.mjs';
import {
  startHarnessStudioServer, defaultAppDir,
  createBundledInspectorWorkspaceSessionProvider, createBundledAgentCustomizationCollector,
} from '@qoder-ai/harness-studio';

const port = parentPort;
if (!port) throw new Error('Studio service requires an Electron utility parent');
let server;
let starting = false;
let stopping = false;
let pendingPicker;
let pickerId = 0;

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
  await server?.close();
  process.exit(0);
}

port.on('message', async (data) => {
  try {
    if (isMessage(data, 'start') && !starting && !stopping) {
      if (typeof data.token !== 'string' || data.token.length !== 64 || typeof data.dataDirectory !== 'string') {
        throw new Error('Invalid Studio startup contract');
      }
      starting = true;
      // Native dependency proof happens in the same process that hosts Studio.
      const { parseSync } = await import('oxc-parser');
      const parsed = parseSync('desktop-smoke.ts', 'const desktop: number = 1');
      if (parsed.errors.length) throw new Error('oxc startup probe failed');
      server = await startHarnessStudioServer({
        appDir: defaultAppDir(), host: '127.0.0.1', port: 0, accessToken: data.token,
        cwd: data.dataDirectory,
        runDirectory: join(data.dataDirectory, 'runs'),
        artifactProviderStateRoot: join(data.dataDirectory, 'providers'),
        walnutCacheRoot: join(data.dataDirectory, 'cache'),
        workspaceSessionProvider: createBundledInspectorWorkspaceSessionProvider(),
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
