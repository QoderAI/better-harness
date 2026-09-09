import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HarnessStudioState, HarnessStudioServerOptions } from './studio-types.js';
import { readJsonBody, respondJson, sameOriginRequest } from './http-utils.js';
import type { MemoryInventory, MemorySnapshot } from '../contracts/memory.js';
import { extractMemory } from './memory-parser.js';
import { MEMORY_ANALYSIS_MAX_BYTES, memoryAcpProfiles, streamMemoryAcp } from './memory-acp.js';

interface MemoryRuntime {
  discoverMemory(options: Record<string, unknown>): Promise<MemoryInventory>;
  readMemory(options: Record<string, unknown>): Promise<MemorySnapshot>;
}
let runtime: Promise<MemoryRuntime> | undefined;
export async function memoryRoute(request: IncomingMessage, response: ServerResponse, state: HarnessStudioState, options: HarnessStudioServerOptions): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!['/api/memory', '/api/memory/read', '/api/memory/analysis', '/api/memory/acp/stream'].includes(url.pathname)) return false;
  const headers = { 'Cache-Control': 'no-store' };
  if (!sameOriginRequest(request) || request.headers['sec-fetch-site'] === 'cross-site') { respondJson(response, 403, { error: 'Same-origin request required' }, headers); return true; }
  if (request.method === 'GET' && url.pathname === '/api/memory/analysis') {
    const agents = memoryAcpProfiles(options).map(profile => ({ id: profile.id, label: profile.label, available: !!profile.agent, unavailableReason: profile.unavailableReason }));
    respondJson(response, 200, { available: agents.some(agent => agent.available), agents, maxBytes: MEMORY_ANALYSIS_MAX_BYTES }, headers); return true;
  }
  try {
    const service = (options.memoryProvider as MemoryRuntime | undefined) ?? await (runtime ??= import(new URL('./runtime/memory-runtime.mjs', import.meta.url).href) as Promise<MemoryRuntime>);
    const nativeOptions = { home: options.memoryHome, schemaVersion: 2 };
    if (request.method === 'GET' && url.pathname === '/api/memory') {
      respondJson(response, 200, await service.discoverMemory(nativeOptions), headers);
    } else if (request.method === 'POST' && ['/api/memory/read', '/api/memory/acp/stream'].includes(url.pathname)) {
      const body = await readJsonBody(request) as Record<string, unknown>;
      const selection = url.pathname.endsWith('/stream') && typeof body.prompt === 'string' ? JSON.parse(body.prompt) as Record<string, unknown> : body;
      if (selection.authorized !== true || typeof selection.id !== 'string' || typeof selection.scope !== 'string') throw new Error('Explicit document selection required');
      const snapshot = await service.readMemory({ ...nativeOptions, id: selection.id, scope: selection.scope, includeMemories: true, includeMemoryContent: true });
      if (url.pathname.endsWith('/stream')) {
        if (selection.digest !== snapshot.digest) { respondJson(response, 409, { error: 'Memory changed. Read the document again before analysis.' }, headers); return true; }
        await streamMemoryAcp(request, response, state, options, body, snapshot);
      } else respondJson(response, 200, { ...snapshot, extraction: extractMemory(snapshot) }, headers);
    } else respondJson(response, 405, { error: 'Method not allowed' }, headers);
  } catch { if (!response.destroyed && !response.writableEnded && !response.headersSent) respondJson(response, 400, { error: 'Memory unavailable. Refresh and select a readable document and ACP Agent.' }, headers); }
  return true;
}
