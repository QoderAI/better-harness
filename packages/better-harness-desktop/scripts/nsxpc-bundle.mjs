import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const serviceId = 'com.qoder.harness-studio.oxc';
export const acpServiceId = 'com.qoder.harness-studio.acp';
const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>\n`;

/** Place native code in bundle code directories, never inside app.asar. */
export async function installNsxpc(appPath, binaryDirectory, { development = false } = {}) {
  const contents = join(appPath, 'Contents');
  const service = join(contents, 'XPCServices', `${serviceId}.xpc`, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(service, 'MacOS'), { recursive: true });
  await cp(join(binaryDirectory, 'harness-oxc-client'), join(contents, 'MacOS', 'harness-oxc-client'));
  await cp(join(binaryDirectory, 'harness-oxc-xpc'), join(service, 'MacOS', 'harness-oxc-xpc'));
  await writeFile(join(service, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${serviceId}</string>
<key>CFBundleExecutable</key><string>harness-oxc-xpc</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>`));
  if (development) await writeFile(join(contents, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>com.qoder.harness-studio.oxc-development</string>
<key>CFBundleExecutable</key><string>harness-oxc-client</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`));
}

/**
 * The ACP NSXPC service. Unlike OXC (one NSData request/reply), the service runs
 * one unmodified `harness-acp-host` driver child per connection, so the driver
 * binary ships *inside* the `.xpc` bundle next to `harness-acp-xpc` where the
 * service resolves it with `current_exe().parent()`. The `harness-acp-client`
 * bridge Studio spawns goes in the app's `Contents/MacOS`, like `harness-oxc-client`.
 */
export async function installAcpXpc(appPath, binaryDirectory, { development = false } = {}) {
  const contents = join(appPath, 'Contents');
  const service = join(contents, 'XPCServices', `${acpServiceId}.xpc`, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(service, 'MacOS'), { recursive: true });
  await cp(join(binaryDirectory, 'harness-acp-client'), join(contents, 'MacOS', 'harness-acp-client'));
  await cp(join(binaryDirectory, 'harness-acp-xpc'), join(service, 'MacOS', 'harness-acp-xpc'));
  await cp(join(binaryDirectory, 'harness-acp-host'), join(service, 'MacOS', 'harness-acp-host'));
  await writeFile(join(service, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${acpServiceId}</string>
<key>CFBundleExecutable</key><string>harness-acp-xpc</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>`));
  if (development) await writeFile(join(contents, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>com.qoder.harness-studio.acp-development</string>
<key>CFBundleExecutable</key><string>harness-acp-client</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`));
}
