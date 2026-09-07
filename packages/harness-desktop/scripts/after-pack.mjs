import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installNsxpc, serviceId } from './nsxpc-bundle.mjs';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await installNsxpc(app, join(root, 'dist', 'native'));
  // Development signatures only. Release identity/notarization is separate.
  for (const target of [join(app, 'Contents', 'XPCServices', `${serviceId}.xpc`), join(app, 'Contents', 'MacOS', 'harness-oxc-client')]) {
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'inherit' });
  }
}
