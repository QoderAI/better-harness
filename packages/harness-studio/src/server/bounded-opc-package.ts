import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { posix } from "node:path";
import { unzipSync } from "fflate";
import type { ArtifactDescriptor } from "../artifact-model.js";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2_048;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;

export interface BoundedOpcArchiveOptions {
  path: string;
  expectedDigest: ArtifactDescriptor["revision"]["digest"];
  format: "DOCX" | "PPTX" | "XLSX";
  include: (path: string) => boolean;
}

/** Load exact revision bytes through one ZIP/OPC safety and expansion budget. */
export async function loadBoundedOpcArchive(options: BoundedOpcArchiveOptions): Promise<Record<string, Uint8Array>> {
  if ((await stat(options.path)).size > MAX_INPUT_BYTES) {
    throw new Error(`${options.format} exceeds the adapter input limit.`);
  }
  const bytes = new Uint8Array(await readFile(options.path));
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`${options.format} exceeds the adapter input limit.`);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== options.expectedDigest) {
    throw new Error(`${options.format} bytes no longer match the requested artifact revision.`);
  }

  let entryCount = 0;
  let expandedBytes = 0;
  const entryNames = new Set<string>();
  return unzipSync(bytes, {
    filter(file) {
      entryCount += 1;
      if (entryCount > MAX_ENTRY_COUNT) throw new Error(`${options.format} contains too many archive entries.`);
      const isDirectory = file.name.endsWith("/");
      const path = isDirectory ? file.name.slice(0, -1) : file.name;
      assertSafeOpcPath(path, options.format);
      if (entryNames.has(path)) throw new Error(`${options.format} archive contains a duplicate entry path.`);
      entryNames.add(path);
      if (file.originalSize > MAX_ENTRY_BYTES) {
        throw new Error(`${options.format} archive entry exceeds the expansion limit.`);
      }
      expandedBytes += file.originalSize;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error(`${options.format} expanded content exceeds the limit.`);
      }
      return !isDirectory && options.include(path);
    },
  });
}

/** Decode one bounded XML part and reject DTD/entity declarations consistently. */
export function readBoundedOpcXmlSource(
  archive: Record<string, Uint8Array>,
  path: string,
  format: BoundedOpcArchiveOptions["format"],
  maxBytes: number,
): string {
  assertSafeOpcPath(path, format);
  const bytes = archive[path];
  if (bytes === undefined) {
    throw new Error(format === "XLSX"
      ? `XLSX package part is missing: ${posix.basename(path)}.`
      : `${format} required part '${path}' is missing.`);
  }
  if (bytes.byteLength > maxBytes) throw new Error(`${format} XML part exceeds the parse limit.`);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
    throw new Error(`${format} XML declarations and entities are not supported, including external entities.`);
  }
  return source;
}

/** Resolve an internal OPC relationship target with portable path semantics. */
export function resolveOpcPackageTarget(
  ownerPath: string,
  target: string,
  format: BoundedOpcArchiveOptions["format"],
): string {
  if (target.includes("\\") || target.includes("\0")) throw new Error(`${format} relationship target is unsafe.`);
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    throw new Error(`${format} relationship target is unsafe.`);
  }
  const candidate = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(ownerPath), decoded));
  assertSafeOpcPath(candidate, format);
  return candidate;
}

export function assertSafeOpcPath(path: string, format: BoundedOpcArchiveOptions["format"]): void {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`${format} archive contains an unsafe entry path.`);
  }
  const normalized = posix.normalize(path);
  if (normalized !== path
    || normalized === ".."
    || normalized.startsWith("../")
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${format} archive contains an unsafe entry path.`);
  }
}

export function artifactSnapshotCacheKey(descriptor: ArtifactDescriptor): string {
  return [
    descriptor.id,
    descriptor.revision.id,
    descriptor.revision.digest,
    descriptor.adapter.snapshotId,
    descriptor.adapter.id,
    descriptor.adapter.version,
    descriptor.adapter.schemaId,
  ].join(":");
}

export function readLruCache<Value>(cache: Map<string, Value>, key: string): Value | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

export function writeLruCache<Value>(cache: Map<string, Value>, key: string, value: Value, maxEntries = 8): void {
  cache.set(key, value);
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
}

export function assertBoundedArtifactSnapshot(snapshot: unknown, format: BoundedOpcArchiveOptions["format"]): void {
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error(`${format} snapshot exceeds the response limit.`);
  }
}
