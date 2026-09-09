import { join } from 'node:path';
import { isMessage, isStudioUrl, message } from './protocol.mjs';

/** Native linking is enabled only for the approved macOS XPC host. */
export function desktopEsbuildOptions({ platform, contentsDirectory }) {
  return platform === 'darwin'
    ? { esbuildTransport: 'nsxpc', esbuildExecutable: join(contentsDirectory, 'MacOS', 'harness-esbuild-client') }
    : {};
}

/** Owns one child. No generic method dispatch or renderer IPC surface. */
export function connectStudioService(child, { token, dataDirectory, oxcExecutable, oxcTransport = 'stdio', esbuildExecutable, esbuildTransport = 'stdio', acpHostExecutable, acpHostTransport = 'stdio', evidenceHostExecutable, evidenceHostTransport = 'stdio', pickDirectory, onFailure, startupTimeout = 30_000, shutdownTimeout = 5_000 }) {
  let ready = false;
  let stopping = false;
  let exited = false;
  let picking = false;
  let stopPromise;
  let resolveExit;
  const exit = new Promise((resolve) => { resolveExit = resolve; });
  let rejectReady;
  const started = new Promise((resolve, reject) => {
    rejectReady = reject;
    const timer = setTimeout(() => {
      reject(new Error('Studio service startup timed out'));
      child.kill();
    }, startupTimeout);
    child.on('message', async (data) => {
      if (isMessage(data, 'ready') && !ready && !stopping) {
        if (!isStudioUrl(data.url)) {
          clearTimeout(timer);
          reject(new Error('Studio service returned an invalid loopback URL'));
          child.kill();
          return;
        }
        clearTimeout(timer);
        ready = true;
        resolve(data);
      } else if (isMessage(data, 'pick-directory') && ready && !stopping && !picking && Number.isSafeInteger(data.id)) {
        picking = true;
        let result;
        try { result = { path: await pickDirectory() }; }
        catch { result = { error: 'The native directory chooser could not be opened.' }; }
        finally { picking = false; }
        if (!exited && !stopping) child.postMessage(message('directory-result', { id: data.id, ...result }));
      } else if (isMessage(data, 'error')) {
        clearTimeout(timer);
        const error = new Error(typeof data.error === 'string' ? data.error : 'Studio service failed');
        if (!ready) reject(error);
        else if (!stopping) onFailure(error);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      exited = true;
      resolveExit();
      if (!ready) reject(new Error(`Studio service exited before startup (${code})`));
      else if (!stopping) onFailure(new Error(`Studio service exited unexpectedly (${code})`));
    });
  });
  child.postMessage(message('start', { token, dataDirectory, oxcExecutable, oxcTransport, esbuildExecutable, esbuildTransport, acpHostExecutable, acpHostTransport, evidenceHostExecutable, evidenceHostTransport }));
  return {
    started,
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      rejectReady(new Error('Studio startup cancelled'));
      stopPromise = (async () => {
        if (exited) return;
        const timer = setTimeout(() => child.kill(), shutdownTimeout);
        child.postMessage(message('stop'));
        await exit;
        clearTimeout(timer);
      })();
      return stopPromise;
    },
  };
}
