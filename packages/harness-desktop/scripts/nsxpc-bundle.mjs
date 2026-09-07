import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const serviceId = 'com.qoder.harness-studio.oxc';
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
