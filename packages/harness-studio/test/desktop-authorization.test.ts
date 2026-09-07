import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startHarnessStudioServer } from '../src/server/server.js';

it('desktop credentials protect both static content and API calls; browser mode remains open', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'studio-desktop-auth-'));
  await writeFile(join(appDir, 'index.html'), '<!doctype html><title>Studio</title>');
  try {
    for (const accessToken of ['test-launch-secret', undefined]) {
      const service = await startHarnessStudioServer({ appDir, accessToken });
      try {
        for (const path of ['/', '/api/config']) {
          expect((await fetch(service.url + path)).status).toBe(accessToken ? 401 : 200);
          expect((await fetch(service.url + path, { headers: { 'x-harness-studio-token': 'wrong' } })).status).toBe(accessToken ? 401 : 200);
          if (accessToken) expect((await fetch(service.url + path, { headers: { 'x-harness-studio-token': accessToken } })).status).toBe(200);
        }
      } finally { await service.close(); }
    }
  } finally { await rm(appDir, { recursive: true, force: true }); }
});
