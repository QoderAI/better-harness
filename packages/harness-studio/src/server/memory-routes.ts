import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HarnessStudioState, HarnessStudioServerOptions } from './studio-types.js';
import { readJsonBody, respondJson, sameOriginRequest } from './http-utils.js';
import type { MemoryInventory, MemorySnapshot } from '../contracts/memory.js';

interface MemoryRuntime {
  discoverMemory(options: Record<string, unknown>): Promise<MemoryInventory>;
  readMemory(options: Record<string, unknown>): Promise<MemorySnapshot>;
}
let runtime: Promise<MemoryRuntime> | undefined;
export async function memoryRoute(request: IncomingMessage, response: ServerResponse, state: HarnessStudioState, home?: string, provider?: HarnessStudioServerOptions['memoryProvider']): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!['/api/memory', '/api/memory/read'].includes(url.pathname)) return false;
  const headers = { 'Cache-Control': 'no-store' };
  if (!sameOriginRequest(request) || request.headers['sec-fetch-site'] === 'cross-site') { respondJson(response, 403, { error: 'Same-origin request required' }, headers); return true; }
  try {
    const service = provider ?? await (runtime ??= import(new URL('./runtime/memory-runtime.mjs', import.meta.url).href) as Promise<MemoryRuntime>);
    const workspace = state.workspace?.localDirectory;
    if (request.method === 'GET' && url.pathname === '/api/memory') {
      respondJson(response, 200, await service.discoverMemory({ workspace, home }), headers);
    } else if (request.method === 'POST' && url.pathname === '/api/memory/read') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      if (body.authorized !== true || typeof body.id !== 'string' || typeof body.scope !== 'string') throw new Error('Explicit document authorization required');
      const snapshot = await service.readMemory({ workspace, home, id: body.id, scope: body.scope, includeMemories: true, includeMemoryContent: true });
      if (state.workspace?.localDirectory !== workspace) throw new Error('Workspace changed; refresh Memory');
      respondJson(response, 200, snapshot, headers);
    } else respondJson(response, 405, { error: 'Method not allowed' }, headers);
  } catch { respondJson(response, 400, { error: 'Memory unavailable. Refresh sources and explicitly select a readable document.' }, headers); }
  return true;
}
