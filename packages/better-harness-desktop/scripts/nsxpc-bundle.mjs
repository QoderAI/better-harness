import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const boxServiceId = 'com.qoder.harness-studio.box';
export const serviceId = 'com.qoder.harness-studio.oxc';
export const acpServiceId = 'com.qoder.harness-studio.acp';
export const evidenceServiceId = 'com.qoder.harness-studio.evidence';
export const esbuildServiceId = 'com.qoder.harness-studio.esbuild';
const plist = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${body}</dict></plist>\n`;

/** The Go archive is linked into the service, not shipped as another process. */
export async function installEsbuildXpc(appPath, binaryDirectory, { development = false } = {}) {
  const contents = join(appPath, 'Contents');
  const service = join(contents, 'XPCServices', `${esbuildServiceId}.xpc`, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(service, 'MacOS'), { recursive: true });
  await mkdir(join(service, 'Resources'), { recursive: true });
  await cp(join(binaryDirectory, 'harness-esbuild-service.NOTICES.txt'), join(service, 'Resources', 'THIRD-PARTY-NOTICES.txt'));
  await cp(join(binaryDirectory, 'harness-esbuild-client'), join(contents, 'MacOS', 'harness-esbuild-client'));
  await cp(join(binaryDirectory, 'harness-esbuild-xpc'), join(service, 'MacOS', 'harness-esbuild-xpc'));
  await writeFile(join(service, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${esbuildServiceId}</string>
<key>CFBundleExecutable</key><string>harness-esbuild-xpc</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>`));
  if (development) await writeFile(join(contents, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${esbuildServiceId}.development</string>
<key>CFBundleExecutable</key><string>harness-esbuild-client</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`));
}

/**
 * The microVM service. Alone among these it is `ServiceType: User`.
 *
 * BoxLite locks its home directory to one runtime, and `Application` gives each
 * calling *process* its own service instance — which would mean one runtime per
 * caller and every caller after the first failing to start. `User` gives this
 * login session a single instance for every connection to share, which is what
 * lets two Debugger runs sit in boxes at once.
 */
export async function installBoxXpc(appPath, binaryDirectory, { development = false } = {}) {
  const contents = join(appPath, 'Contents');
  const service = join(contents, 'XPCServices', `${boxServiceId}.xpc`, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(service, 'MacOS'), { recursive: true });
  await cp(join(binaryDirectory, 'harness-box-client'), join(contents, 'MacOS', 'harness-box-client'));
  await cp(join(binaryDirectory, 'harness-box-xpc'), join(service, 'MacOS', 'harness-box-xpc'));
  // The service resolves the driver beside its own executable.
  await cp(join(binaryDirectory, 'harness-box-host'), join(service, 'MacOS', 'harness-box-host'));
  await writeFile(join(service, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${boxServiceId}</string>
<key>CFBundleExecutable</key><string>harness-box-xpc</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>XPCService</key><dict><key>ServiceType</key><string>User</string></dict>`));
  if (development) await writeFile(join(contents, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${boxServiceId}-development</string>
<key>CFBundleExecutable</key><string>harness-box-client</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`));
}

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

/**
 * Evidence NSXPC service: one unmodified `harness-evidence-host` driver per
 * connection, same shape as ACP. The bridge goes in Contents/MacOS.
 */
export async function installEvidenceXpc(appPath, binaryDirectory, { development = false } = {}) {
  const contents = join(appPath, 'Contents');
  const service = join(contents, 'XPCServices', `${evidenceServiceId}.xpc`, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(service, 'MacOS'), { recursive: true });
  await cp(join(binaryDirectory, 'harness-evidence-client'), join(contents, 'MacOS', 'harness-evidence-client'));
  await cp(join(binaryDirectory, 'harness-evidence-xpc'), join(service, 'MacOS', 'harness-evidence-xpc'));
  await cp(join(binaryDirectory, 'harness-evidence-host'), join(service, 'MacOS', 'harness-evidence-host'));
  await writeFile(join(service, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>${evidenceServiceId}</string>
<key>CFBundleExecutable</key><string>harness-evidence-xpc</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>`));
  if (development) await writeFile(join(contents, 'Info.plist'), plist(`
<key>CFBundleIdentifier</key><string>com.qoder.harness-studio.evidence-development</string>
<key>CFBundleExecutable</key><string>harness-evidence-client</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>`));
}
