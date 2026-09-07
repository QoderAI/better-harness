import { cp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNsxpc, serviceId } from './nsxpc-bundle.mjs';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await installNsxpc(app, join(root, 'dist', 'native'));
  // ACP is a cross-platform stdio service, not part of the OXC XPC bundle.
  // Keep it in Resources/native, the same location Windows/Linux extraResources
  // use, so the main process has one packaged-path rule on every platform.
  const nativeResources = join(app, 'Contents', 'Resources', 'native');
  await mkdir(nativeResources, { recursive: true });
  await cp(join(root, 'dist', 'native', 'harness-acp-host'), join(nativeResources, 'harness-acp-host'));
  // Development signatures only. Release identity/notarization is separate.
  for (const target of [
    join(app, 'Contents', 'XPCServices', `${serviceId}.xpc`),
    join(app, 'Contents', 'MacOS', 'harness-oxc-client'),
    join(nativeResources, 'harness-acp-host'),
  ]) {
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'inherit' });
  }
}
