import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, sep, win32 } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

export const WALNUT_PROBE_KIND = "HarnessStudioWalnutProbeV1" as const;
export const WALNUT_RECEIPT_KIND = "HarnessStudioWalnutProviderReceiptV1" as const;
export const WALNUT_ACTIVE_KIND = "HarnessStudioWalnutActiveV1" as const;
export const WALNUT_SUPPORT = "experimental-local" as const;

const MAX_ASAR_HEADER_BYTES = 64 * 1024 * 1024;
const ASAR_PREFIX_BYTES = 16;
const WALNUT_FORMATS = ["docx", "pptx", "xlsx"] as const;

interface AsarFileEntry {
  size: number;
  offset: string;
  unpacked?: boolean;
}

interface AsarDirectoryEntry {
  files: Record<string, AsarNode>;
}

type AsarNode = AsarFileEntry | AsarDirectoryEntry;

interface AsarIndex {
  contentOffset: number;
  files: Map<string, AsarFileEntry>;
}

export type WalnutAssetRole = "dotnet-loader" | "dotnet-runtime" | "openxml" | "protobuf" | "walnut";

export interface WalnutAssetReceipt {
  sourcePath: string;
  relativePath: string;
  role: WalnutAssetRole;
  size: number;
  digest: `sha256:${string}`;
}

export interface WalnutApplicationIdentity {
  version: string;
  bundleIdentifier: string;
  signingIdentifier: string;
  teamIdentifier: string;
}

export interface WalnutProbe {
  kind: typeof WALNUT_PROBE_KIND;
  status: "available" | "unavailable";
  support: typeof WALNUT_SUPPORT;
  formats: readonly ["docx", "pptx", "xlsx"];
  cacheRoot: string;
  app?: WalnutApplicationIdentity & { path: string };
  archive?: {
    path: string;
    size: number;
    digest: `sha256:${string}`;
  };
  assets: WalnutAssetReceipt[];
  reason?: string;
}

export interface WalnutProviderReceipt {
  kind: typeof WALNUT_RECEIPT_KIND;
  support: typeof WALNUT_SUPPORT;
  formats: readonly ["docx", "pptx", "xlsx"];
  app: WalnutApplicationIdentity & { path: string };
  archive: {
    path: string;
    size: number;
    digest: `sha256:${string}`;
  };
  assets: WalnutAssetReceipt[];
  installedAt: string;
}

export interface WalnutVerification {
  ok: boolean;
  receipt?: WalnutProviderReceipt;
  reason?: string;
}

export interface ProbeWalnutOptions {
  appPath?: string;
  cacheRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  identity?: WalnutApplicationIdentity;
  archivePath?: string;
}

export interface InstallWalnutOptions {
  acceptLocalExperimental: boolean;
  now?: () => Date;
}

/** Studio owns this cache; it is deliberately separate from Qoder Canvas roots. */
export function defaultWalnutCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  if (env.HARNESS_STUDIO_CACHE_HOME !== undefined) return platformPath.resolve(env.HARNESS_STUDIO_CACHE_HOME);
  if (platform === "darwin") return platformPath.join(home, "Library", "Caches", "QoderAI", "HarnessStudio");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA === undefined
      ? platformPath.join(home, "AppData", "Local")
      : platformPath.resolve(env.LOCALAPPDATA);
    return platformPath.join(local, "QoderAI", "HarnessStudio", "Cache");
  }
  const xdg = env.XDG_CACHE_HOME === undefined
    ? platformPath.join(home, ".cache")
    : platformPath.resolve(env.XDG_CACHE_HOME);
  return platformPath.join(xdg, "harness-studio");
}

export async function probeWalnutApplication(options: ProbeWalnutOptions = {}): Promise<WalnutProbe> {
  const platform = options.platform ?? process.platform;
  const cacheRoot = resolve(options.cacheRoot ?? defaultWalnutCacheRoot(options.env, platform, options.home));
  if (platform !== "darwin" && options.archivePath === undefined) {
    return unavailableProbe(cacheRoot, "Walnut bootstrap currently requires a local macOS ChatGPT application.");
  }
  const appPath = resolve(options.appPath ?? "/Applications/ChatGPT.app");
  const archivePath = resolve(options.archivePath ?? join(appPath, "Contents", "Resources", "app.asar"));
  try {
    const identity = options.identity ?? await readChatGptIdentity(appPath);
    const archiveStats = await stat(archivePath);
    if (!archiveStats.isFile()) return unavailableProbe(cacheRoot, "ChatGPT app.asar is not a regular file.");
    const index = await readAsarIndex(archivePath);
    const selected = selectWalnutAssets(index);
    if (!hasRequiredWalnutRuntime(selected)) {
      return unavailableProbe(cacheRoot, "The installed ChatGPT archive does not contain the reviewed Walnut runtime layout.");
    }
    const assets: WalnutAssetReceipt[] = [];
    for (const asset of selected) {
      assets.push({
        sourcePath: asset.path,
        relativePath: posix.join("runtime", posix.basename(asset.path)),
        role: asset.role,
        size: asset.entry.size,
        digest: await digestAsarEntry(archivePath, index.contentOffset, asset.entry),
      });
    }
    return {
      kind: WALNUT_PROBE_KIND,
      status: "available",
      support: WALNUT_SUPPORT,
      formats: WALNUT_FORMATS,
      cacheRoot,
      app: { path: appPath, ...identity },
      archive: {
        path: archivePath,
        size: archiveStats.size,
        digest: await digestFile(archivePath),
      },
      assets,
    };
  } catch (error) {
    return unavailableProbe(cacheRoot, boundedReason(error));
  }
}

export async function installWalnutProvider(
  probe: WalnutProbe,
  options: InstallWalnutOptions,
): Promise<WalnutProviderReceipt> {
  if (!options.acceptLocalExperimental) {
    throw new Error("Walnut installation requires --accept-local-experimental.");
  }
  if (probe.status !== "available" || probe.app === undefined || probe.archive === undefined) {
    throw new Error(probe.reason ?? "Walnut provider is unavailable.");
  }
  const currentArchive = await stat(probe.archive.path);
  if (!currentArchive.isFile()
    || currentArchive.size !== probe.archive.size
    || await digestFile(probe.archive.path) !== probe.archive.digest) {
    throw new Error("ChatGPT app.asar changed after the Walnut probe; probe again before installing.");
  }
  const root = join(resolve(probe.cacheRoot), "walnut");
  const providerDirectory = providerDirectoryName(probe.archive.digest);
  const target = confineCachePath(root, providerDirectory);
  await mkdir(root, { recursive: true });
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("The Studio Walnut cache root must be a real directory.");
  const existing = await verifyWalnutProviderAt(target, probe.archive.digest);
  if (existing.ok && existing.receipt !== undefined) {
    await writeActivePointer(root, providerDirectory, probe.archive.digest);
    return existing.receipt;
  }
  if (await pathExists(target)) {
    throw new Error("The content-addressed Walnut cache entry exists but failed verification; remove it before reinstalling.");
  }
  const temporary = await mkdtemp(join(root, ".install-"));
  try {
    const index = await readAsarIndex(probe.archive.path);
    for (const asset of probe.assets) {
      const destination = confineCachePath(temporary, asset.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      const entry = index.files.get(asset.sourcePath);
      if (entry === undefined) throw new Error(`Walnut asset '${asset.sourcePath}' disappeared from the archive.`);
      await extractAsarEntry(probe.archive.path, index.contentOffset, entry, destination);
      if (await digestFile(destination) !== asset.digest) throw new Error(`Walnut asset '${asset.sourcePath}' failed digest verification.`);
    }
    if (await digestFile(probe.archive.path) !== probe.archive.digest) {
      throw new Error("ChatGPT app.asar changed during Walnut installation; probe again before installing.");
    }
    const receipt: WalnutProviderReceipt = {
      kind: WALNUT_RECEIPT_KIND,
      support: WALNUT_SUPPORT,
      formats: WALNUT_FORMATS,
      app: probe.app,
      archive: probe.archive,
      assets: probe.assets,
      installedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    await writeFile(join(temporary, "provider-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
    await writeActivePointer(root, providerDirectory, probe.archive.digest);
    return receipt;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyActiveWalnutProvider(cacheRoot: string): Promise<WalnutVerification> {
  const root = join(resolve(cacheRoot), "walnut");
  try {
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("The Studio Walnut cache root must be a real directory.");
    const active = parseActivePointer(JSON.parse(await readFile(join(root, "active.json"), "utf8")));
    const target = confineCachePath(root, active.providerDirectory);
    return await verifyWalnutProviderAt(target, active.archiveDigest);
  } catch (error) {
    return { ok: false, reason: boundedReason(error) };
  }
}

export async function removeWalnutProvider(cacheRoot: string): Promise<{ removed: boolean }> {
  const root = join(resolve(cacheRoot), "walnut");
  const parent = dirname(root);
  if (basename(root) !== "walnut" || !root.startsWith(parent + sep)) throw new Error("Refusing to remove an invalid Walnut cache path.");
  const removed = await pathExists(root);
  await rm(root, { recursive: true, force: true });
  return { removed };
}

async function verifyWalnutProviderAt(target: string, expectedArchiveDigest: `sha256:${string}`): Promise<WalnutVerification> {
  try {
    const targetStats = await lstat(target);
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) throw new Error("Walnut provider cache must be a real directory.");
    const targetRoot = await realpath(target);
    const receiptPath = join(targetRoot, "provider-receipt.json");
    const receiptStats = await lstat(receiptPath);
    if (!receiptStats.isFile() || receiptStats.isSymbolicLink()) throw new Error("Walnut provider receipt must be a real file.");
    const receipt = parseProviderReceipt(JSON.parse(await readFile(receiptPath, "utf8")));
    if (receipt.archive.digest !== expectedArchiveDigest) throw new Error("Walnut receipt archive digest does not match the active pointer.");
    for (const asset of receipt.assets) {
      const path = confineCachePath(targetRoot, asset.relativePath);
      const physical = await realpath(path);
      if (!physical.startsWith(targetRoot + sep)) throw new Error(`Walnut asset '${asset.relativePath}' escapes the provider cache.`);
      if (!(await lstat(path)).isFile()) throw new Error(`Walnut asset '${asset.relativePath}' is not a regular file.`);
      if ((await stat(path)).size !== asset.size || await digestFile(path) !== asset.digest) {
        throw new Error(`Walnut asset '${asset.relativePath}' failed verification.`);
      }
    }
    return { ok: true, receipt };
  } catch (error) {
    return { ok: false, reason: boundedReason(error) };
  }
}

async function readAsarIndex(path: string): Promise<AsarIndex> {
  const handle = await import("node:fs/promises").then(({ open }) => open(path, "r"));
  try {
    const prefix = Buffer.alloc(ASAR_PREFIX_BYTES);
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
    if (prefixRead.bytesRead !== prefix.length) throw new Error("ChatGPT app.asar header is truncated.");
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (headerSize < 8 || jsonSize === 0 || jsonSize > MAX_ASAR_HEADER_BYTES || jsonSize > headerSize - 8) {
      throw new Error("ChatGPT app.asar header is invalid.");
    }
    const json = Buffer.alloc(jsonSize);
    const jsonRead = await handle.read(json, 0, json.length, ASAR_PREFIX_BYTES);
    if (jsonRead.bytesRead !== json.length) throw new Error("ChatGPT app.asar index is truncated.");
    const root = JSON.parse(json.toString("utf8")) as unknown;
    const files = new Map<string, AsarFileEntry>();
    walkAsarDirectory(requireDirectory(root), [], files);
    return { contentOffset: 8 + headerSize, files };
  } finally {
    await handle.close();
  }
}

function walkAsarDirectory(directory: AsarDirectoryEntry, parts: string[], output: Map<string, AsarFileEntry>): void {
  for (const [name, node] of Object.entries(directory.files)) {
    if (name === "" || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      throw new Error("ChatGPT app.asar contains an invalid entry name.");
    }
    const next = [...parts, name];
    if (isDirectory(node)) walkAsarDirectory(node, next, output);
    else {
      const packed = packedFileEntry(node);
      if (packed !== undefined) output.set(next.join("/"), packed);
      else if (!isUnpackedFile(node) && !isAsarLink(node)) throw new Error("ChatGPT app.asar file entry is invalid.");
    }
  }
}

function selectWalnutAssets(index: AsarIndex): Array<{ path: string; entry: AsarFileEntry; role: WalnutAssetRole }> {
  const selected: Array<{ path: string; entry: AsarFileEntry; role: WalnutAssetRole }> = [];
  for (const [path, entry] of index.files) {
    const role = walnutAssetRole(path);
    if (role !== undefined) selected.push({ path, entry, role });
  }
  return selected.sort((left, right) => left.path.localeCompare(right.path));
}

function walnutAssetRole(path: string): WalnutAssetRole | undefined {
  if (!path.startsWith("webview/assets/")) return undefined;
  const name = posix.basename(path);
  if (/^Walnut\.[A-Za-z0-9_-]+\.wasm$/u.test(name)) return "walnut";
  if (/^DocumentFormat\.OpenXml(?:\.Framework)?\.[A-Za-z0-9_-]+\.wasm$/u.test(name)) return "openxml";
  if (/^Google\.Protobuf\.[A-Za-z0-9_-]+\.wasm$/u.test(name)) return "protobuf";
  if (/^System(?:\.[A-Za-z0-9]+)*\.[A-Za-z0-9_-]+\.wasm$/u.test(name)) return "dotnet-runtime";
  if (name === "dotnet.js" || /^dotnet\.native\.[A-Za-z0-9_-]+\.js$/u.test(name)) return "dotnet-loader";
  if (/^dotnet\.(?:runtime\.[A-Za-z0-9_-]+\.js|native\.[A-Za-z0-9_-]+\.wasm)$/u.test(name)) return "dotnet-runtime";
  return undefined;
}

function hasRequiredWalnutRuntime(assets: Array<{ role: WalnutAssetRole }>): boolean {
  const roles = new Set(assets.map((asset) => asset.role));
  return roles.has("walnut") && roles.has("openxml") && roles.has("protobuf") && roles.has("dotnet-loader") && roles.has("dotnet-runtime");
}

async function digestAsarEntry(
  archivePath: string,
  contentOffset: number,
  entry: AsarFileEntry,
): Promise<`sha256:${string}`> {
  const hash = createHash("sha256");
  const start = checkedAsarOffset(contentOffset, entry);
  if (entry.size === 0) return `sha256:${hash.digest("hex")}`;
  for await (const chunk of createReadStream(archivePath, { start, end: start + entry.size - 1 })) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

async function extractAsarEntry(archivePath: string, contentOffset: number, entry: AsarFileEntry, destination: string): Promise<void> {
  const start = checkedAsarOffset(contentOffset, entry);
  if (entry.size === 0) {
    await writeFile(destination, new Uint8Array(), { flag: "wx" });
    return;
  }
  await pipeline(
    createReadStream(archivePath, { start, end: start + entry.size - 1 }),
    createWriteStream(destination, { flags: "wx" }),
  );
}

function checkedAsarOffset(contentOffset: number, entry: AsarFileEntry): number {
  if (entry.unpacked === true) throw new Error("Walnut runtime assets must be packed inside app.asar.");
  if (!/^\d+$/u.test(entry.offset)) throw new Error("ChatGPT app.asar file offset is invalid.");
  const offset = Number(entry.offset);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw new Error("ChatGPT app.asar file range is invalid.");
  }
  return contentOffset + offset;
}

async function digestFile(path: string): Promise<`sha256:${string}`> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

async function readChatGptIdentity(appPath: string): Promise<WalnutApplicationIdentity> {
  const info = join(appPath, "Contents", "Info.plist");
  const [version, bundleIdentifier, signature] = await Promise.all([
    runTool("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", info]),
    runTool("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", info]),
    runTool("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], true),
    runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]),
  ]);
  const signingIdentifier = matchToolField(signature, "Identifier");
  const teamIdentifier = matchToolField(signature, "TeamIdentifier");
  const identity = { version: version.trim(), bundleIdentifier: bundleIdentifier.trim(), signingIdentifier, teamIdentifier };
  if (identity.bundleIdentifier !== "com.openai.codex"
    || identity.signingIdentifier !== "com.openai.codex"
    || identity.teamIdentifier !== "2DC432GLL2") {
    throw new Error("The application is not the reviewed OpenAI-signed ChatGPT desktop app.");
  }
  return identity;
}

async function runTool(command: string, args: string[], includeStderr = false): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 64 * 1024) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(includeStderr ? `${stdout}\n${stderr}` : stdout);
      else reject(new Error(`${basename(command)} failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

function matchToolField(output: string, field: string): string {
  const value = output.split(/\r?\n/u).find((line) => line.startsWith(`${field}=`))?.slice(field.length + 1).trim();
  if (value === undefined || value === "") throw new Error(`ChatGPT code signature has no ${field}.`);
  return value;
}

function parseProviderReceipt(value: unknown): WalnutProviderReceipt {
  if (!isRecord(value) || value.kind !== WALNUT_RECEIPT_KIND || value.support !== WALNUT_SUPPORT) {
    throw new Error("Walnut provider receipt has an unsupported kind.");
  }
  if (!sameFormats(value.formats) || !isIdentity(value.app) || !isArchive(value.archive) || typeof value.installedAt !== "string") {
    throw new Error("Walnut provider receipt is invalid.");
  }
  if (!Array.isArray(value.assets) || !value.assets.every(isAssetReceipt) || !hasRequiredWalnutRuntime(value.assets)) {
    throw new Error("Walnut provider receipt has an invalid runtime asset set.");
  }
  const sourcePaths = new Set(value.assets.map((asset) => asset.sourcePath));
  const relativePaths = new Set(value.assets.map((asset) => asset.relativePath));
  if (sourcePaths.size !== value.assets.length || relativePaths.size !== value.assets.length) {
    throw new Error("Walnut provider receipt contains duplicate runtime assets.");
  }
  return value as unknown as WalnutProviderReceipt;
}

function parseActivePointer(value: unknown): { providerDirectory: string; archiveDigest: `sha256:${string}` } {
  if (!isRecord(value) || value.kind !== WALNUT_ACTIVE_KIND || typeof value.providerDirectory !== "string" || !isDigest(value.archiveDigest)) {
    throw new Error("Walnut active pointer is invalid.");
  }
  if (!/^sha256-[0-9a-f]{64}$/u.test(value.providerDirectory)) throw new Error("Walnut active provider directory is invalid.");
  return { providerDirectory: value.providerDirectory, archiveDigest: value.archiveDigest };
}

async function writeActivePointer(root: string, providerDirectory: string, archiveDigest: `sha256:${string}`): Promise<void> {
  const activePath = join(root, "active.json");
  if (await pathExists(activePath) && (await lstat(activePath)).isSymbolicLink()) {
    throw new Error("Walnut active pointer must not be a symbolic link.");
  }
  await writeFile(
    activePath,
    `${JSON.stringify({ kind: WALNUT_ACTIVE_KIND, providerDirectory, archiveDigest }, null, 2)}\n`,
    "utf8",
  );
}

function requireDirectory(value: unknown): AsarDirectoryEntry {
  if (!isRecord(value) || !isRecord(value.files)) throw new Error("ChatGPT app.asar index root is invalid.");
  return value as unknown as AsarDirectoryEntry;
}

function packedFileEntry(value: unknown): AsarFileEntry | undefined {
  return isRecord(value) && typeof value.size === "number" && typeof value.offset === "string"
    ? value as unknown as AsarFileEntry
    : undefined;
}

function isUnpackedFile(value: unknown): boolean {
  return isRecord(value) && typeof value.size === "number" && value.unpacked === true;
}

function isAsarLink(value: unknown): boolean {
  return isRecord(value) && typeof value.link === "string";
}

function isDirectory(value: unknown): value is AsarDirectoryEntry {
  return isRecord(value) && isRecord(value.files);
}

function isIdentity(value: unknown): boolean {
  return isRecord(value)
    && [value.path, value.version, value.bundleIdentifier, value.signingIdentifier, value.teamIdentifier]
      .every((entry) => typeof entry === "string" && entry !== "");
}

function isArchive(value: unknown): boolean {
  return isRecord(value)
    && typeof value.path === "string"
    && typeof value.size === "number"
    && value.size >= 0
    && isDigest(value.digest);
}

function isAssetReceipt(value: unknown): value is WalnutAssetReceipt {
  if (!isRecord(value)
    || typeof value.sourcePath !== "string"
    || typeof value.relativePath !== "string"
    || typeof value.role !== "string"
    || typeof value.size !== "number"
    || !isDigest(value.digest)) return false;
  const role = walnutAssetRole(value.sourcePath);
  return role === value.role
    && value.relativePath === posix.join("runtime", posix.basename(value.sourcePath))
    && value.size >= 0;
}

function sameFormats(value: unknown): boolean {
  return Array.isArray(value) && value.length === WALNUT_FORMATS.length && value.every((entry, index) => entry === WALNUT_FORMATS[index]);
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function providerDirectoryName(digest: `sha256:${string}`): string {
  return digest.replace(":", "-");
}

function confineCachePath(root: string, relative: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relative);
  if (target === resolvedRoot || !target.startsWith(resolvedRoot + sep)) throw new Error("Walnut cache path escapes its root.");
  return target;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function unavailableProbe(cacheRoot: string, reason: string): WalnutProbe {
  return {
    kind: WALNUT_PROBE_KIND,
    status: "unavailable",
    support: WALNUT_SUPPORT,
    formats: WALNUT_FORMATS,
    cacheRoot,
    assets: [],
    reason,
  };
}

function boundedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/gu, " ").slice(0, 320) || "Walnut bootstrap failed.";
}
