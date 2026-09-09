import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateInventory } from './contract.mjs';
export { validateInventory } from './contract.mjs';

/** Native transport only. No JS discovery fallback or implicit cargo build. */
function executable() {
  if (process.env.BETTER_HARNESS_EVIDENCE_HOST) return process.env.BETTER_HARNESS_EVIDENCE_HOST;
  const name = process.platform === 'win32' ? 'harness-evidence-host.exe' : 'harness-evidence-host';
  for (const relative of [
    `../../packages/better-harness-desktop/dist/native/${name}`,
    `../../../../better-harness-desktop/dist/native/${name}`,
  ]) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Rust Memory host unavailable. Build the desktop Rust services or set BETTER_HARNESS_EVIDENCE_HOST.');
}
export function callMemory(method, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(), [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const chunks = []; let bytes = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); child.kill();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Rust Memory host timed out')), 60_000);
    child.on('error', () => finish(new Error('Rust Memory host could not start')));
    child.stdin.on('error', () => finish(new Error('Rust Memory input closed')));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) finish(new Error('Rust Memory response too large'));
      else chunks.push(chunk);
    });
    child.on('close', code => {
      if (code !== 0) return finish(new Error('Rust Memory host exited'));
      try {
        const frame = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (frame.version !== 1 || frame.id !== 1) throw new Error('Invalid Rust Memory envelope');
        if (frame.error) throw new Error(frame.error.message ?? 'Rust Memory request failed');
        if (!frame.result) throw new Error('Empty Rust Memory result');
        finish(null, frame.result);
      } catch (error) { finish(error); }
    });
    child.stdin.end(`${JSON.stringify({ version: 1, id: 1, method, params: options })}\n`);
  });
}
export async function discoverMemory(options) { return validateInventory(await callMemory('memory.discover', options)); }
export async function readMemory(options) {
  const value = await callMemory('memory.read', options);
  return Object.freeze({ ...value, workspace: Object.freeze(value.workspace), provenance: Object.freeze(value.provenance) });
}
