import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHarnessStudioCli } from "../src/server/cli.js";
import {
  defaultWalnutCacheRoot,
  installWalnutProvider,
  probeWalnutApplication,
  removeWalnutProvider,
  verifyActiveWalnutProvider,
  type WalnutApplicationIdentity,
} from "../src/server/walnut-bootstrap.js";
import { discoverWalnutArtifactProvider } from "../src/server/walnut-artifact-provider.js";

const IDENTITY: WalnutApplicationIdentity = {
  version: "fixture-1",
  bundleIdentifier: "com.openai.fixture",
  signingIdentifier: "com.openai.fixture",
  teamIdentifier: "FIXTURETEAM",
};

const RUNTIME_FILES: Record<string, Uint8Array> = {
  "webview/assets/Walnut.fixture.wasm": bytes("walnut"),
  "webview/assets/DocumentFormat.OpenXml.fixture.wasm": bytes("openxml"),
  "webview/assets/Google.Protobuf.fixture.wasm": bytes("protobuf"),
  "webview/assets/System.Private.CoreLib.fixture.wasm": bytes("corelib"),
  "webview/assets/System.fixture.wasm": bytes("system"),
  "webview/assets/dotnet.js": bytes("loader"),
  "webview/assets/dotnet.runtime.fixture.js": bytes("runtime"),
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Studio-private Walnut bootstrap", () => {
  it("returns a portable unavailable receipt away from macOS", async () => {
    const probe = await probeWalnutApplication({ platform: "linux", home: "/tmp/fixture-home", env: {} });

    expect(probe).toMatchObject({
      kind: "HarnessStudioWalnutProbeV1",
      status: "unavailable",
      support: "experimental-local",
      formats: ["docx", "pptx", "xlsx"],
      assets: [],
    });
    expect(probe.reason).toContain("macOS");
  });

  it("probes only reviewed runtime roles from a synthetic ASAR", async () => {
    const fixture = await makeFixture();

    const probe = await probeFixture(fixture);

    expect(probe.status).toBe("available");
    expect(probe.assets).toHaveLength(Object.keys(RUNTIME_FILES).length);
    expect(new Set(probe.assets.map((asset) => asset.role))).toEqual(new Set([
      "walnut",
      "openxml",
      "protobuf",
      "dotnet-loader",
      "dotnet-runtime",
    ]));
    expect(probe.assets.every((asset) => asset.digest === digest(RUNTIME_FILES[asset.sourcePath]!))).toBe(true);
    expect(probe.assets.every((asset) => asset.relativePath === `runtime/${asset.sourcePath.split("/").at(-1)}`)).toBe(true);
    expect(probe.assets.some((asset) => asset.sourcePath.endsWith("unrelated.js"))).toBe(false);
  });

  it("requires consent, installs content-addressed bytes, verifies them, and removes the private cache", async () => {
    const fixture = await makeFixture();
    const probe = await probeFixture(fixture);

    await expect(installWalnutProvider(probe, { acceptLocalExperimental: false })).rejects.toThrow("--accept-local-experimental");

    const receipt = await installWalnutProvider(probe, {
      acceptLocalExperimental: true,
      now: () => new Date("2026-08-21T12:00:00.000Z"),
    });
    const verified = await verifyActiveWalnutProvider(fixture.cacheRoot);

    expect(receipt).toMatchObject({
      kind: "HarnessStudioWalnutProviderReceiptV1",
      support: "experimental-local",
      installedAt: "2026-08-21T12:00:00.000Z",
      app: IDENTITY,
    });
    expect(verified).toMatchObject({ ok: true, receipt: { archive: { digest: probe.archive?.digest } } });
    expect(JSON.stringify(await readFile(join(fixture.cacheRoot, "walnut", "active.json"), "utf8"))).not.toContain(fixture.appPath);

    const removal = await removeWalnutProvider(fixture.cacheRoot);
    expect(removal).toEqual({ removed: true });
    expect(await verifyActiveWalnutProvider(fixture.cacheRoot)).toMatchObject({ ok: false });
  });

  it("fails verification when one installed runtime asset changes", async () => {
    const fixture = await makeFixture();
    const probe = await probeFixture(fixture);
    const receipt = await installWalnutProvider(probe, { acceptLocalExperimental: true });
    const providerDirectory = probe.archive!.digest.replace(":", "-");
    const asset = receipt.assets[0]!;
    await writeFile(join(fixture.cacheRoot, "walnut", providerDirectory, asset.relativePath), bytes("changed"));

    const verification = await verifyActiveWalnutProvider(fixture.cacheRoot);

    expect(verification.ok).toBe(false);
    expect(verification.reason).toContain("failed verification");
  });

  it("projects only a verified path-redacted zero-contribution Artifact provider", async () => {
    const fixture = await makeFixture();
    const probe = await probeFixture(fixture);
    await installWalnutProvider(probe, { acceptLocalExperimental: true });

    const ready = await discoverWalnutArtifactProvider(fixture.cacheRoot);
    expect(ready.provider).toMatchObject({
      id: "chatgpt-walnut",
      acquisition: "local-derived-experimental",
      contributions: [],
      receipt: { sourceReceipt: { kind: "HarnessStudioWalnutProviderReceiptV1" } },
    });
    expect(ready.status).toMatchObject({ status: "ready", receiptVerified: true, contributions: [] });
    expect(JSON.stringify(ready)).not.toContain(fixture.root);
    expect(JSON.stringify(ready.provider?.receipt)).not.toContain("sourcePath");

    const receipt = ready.provider!.receipt.assets[0]!;
    await writeFile(join(fixture.cacheRoot, "walnut", probe.archive!.digest.replace(":", "-"), receipt.relativePath), bytes("tampered"));
    const unavailable = await discoverWalnutArtifactProvider(fixture.cacheRoot);
    expect(unavailable.provider).toBeUndefined();
    expect(unavailable.status).toMatchObject({ status: "unavailable", receiptVerified: false, contributions: [] });
    expect(JSON.stringify(unavailable.status)).not.toContain(fixture.root);
  });

  it("refuses installation when ChatGPT changes after the probe", async () => {
    const fixture = await makeFixture();
    const probe = await probeFixture(fixture);
    await writeSyntheticAsar(fixture.archivePath, {
      ...RUNTIME_FILES,
      "webview/assets/after-update.js": bytes("updated"),
    });

    await expect(installWalnutProvider(probe, { acceptLocalExperimental: true }))
      .rejects.toThrow("changed after the Walnut probe");
    expect(await verifyActiveWalnutProvider(fixture.cacheRoot)).toMatchObject({ ok: false });
  });

  it.skipIf(process.platform === "win32")("refuses a symbolic-link Studio cache root", async () => {
    const fixture = await makeFixture();
    const outside = join(fixture.root, "outside-cache");
    await mkdir(fixture.cacheRoot, { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(fixture.cacheRoot, "walnut"), "dir");
    const probe = await probeFixture(fixture);

    await expect(installWalnutProvider(probe, { acceptLocalExperimental: true }))
      .rejects.toThrow("must be a real directory");
  });

  it("routes Walnut help through the Studio CLI without starting the server", async () => {
    const stdout: string[] = [];
    const code = await runHarnessStudioCli(["walnut", "--help"], {
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("harness-studio walnut install");
  });

  it("derives a Studio-owned cache root on every supported platform", () => {
    expect(defaultWalnutCacheRoot({}, "darwin", "/users/me")).toBe("/users/me/Library/Caches/QoderAI/HarnessStudio");
    expect(defaultWalnutCacheRoot({ XDG_CACHE_HOME: "/cache" }, "linux", "/users/me")).toBe("/cache/harness-studio");
    expect(defaultWalnutCacheRoot({ LOCALAPPDATA: "C:\\cache" }, "win32", "C:\\users\\me"))
      .toBe("C:\\cache\\QoderAI\\HarnessStudio\\Cache");
  });
});

async function makeFixture(): Promise<{ root: string; appPath: string; archivePath: string; cacheRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "studio-walnut-"));
  tempDirs.push(root);
  const appPath = join(root, "ChatGPT.app");
  const archivePath = join(appPath, "Contents", "Resources", "app.asar");
  const cacheRoot = join(root, "studio-cache");
  await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
  await writeSyntheticAsar(archivePath, {
    ...RUNTIME_FILES,
    "webview/assets/unrelated.js": bytes("do not extract"),
  });
  return { root, appPath, archivePath, cacheRoot };
}

async function probeFixture(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  return await probeWalnutApplication({
    platform: "darwin",
    appPath: fixture.appPath,
    archivePath: fixture.archivePath,
    cacheRoot: fixture.cacheRoot,
    identity: IDENTITY,
  });
}

async function writeSyntheticAsar(path: string, files: Record<string, Uint8Array>): Promise<void> {
  const root: { files: Record<string, unknown> } = { files: {} };
  let offset = 0;
  const contents: Uint8Array[] = [];
  for (const [filePath, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const parts = filePath.split("/");
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const existing = directory.files[part] as { files?: Record<string, unknown> } | undefined;
      const next = existing?.files === undefined ? { files: {} } : existing;
      directory.files[part] = next;
      directory = next as { files: Record<string, unknown> };
    }
    directory.files[parts.at(-1)!] = { size: content.length, offset: String(offset) };
    contents.push(content);
    offset += content.length;
  }
  root.files["fixture-unpacked.node"] = { size: 7, unpacked: true };
  root.files["fixture-link.node"] = { link: "webview/assets/dotnet.js" };
  const json = Buffer.from(JSON.stringify(root), "utf8");
  const headerSize = align4(json.length + 8);
  const prefix = Buffer.alloc(8 + headerSize);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  await writeFile(path, Buffer.concat([prefix, ...contents.map((content) => Buffer.from(content))]));
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function digest(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
