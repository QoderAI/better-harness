/**
 * Capability source locking for reproducible revisions.
 *
 * A skill declaration carries a path (`source "./skills/impact-analysis"`), and
 * a path is not content. Locking digests the real bytes behind every declared
 * source so a revision can be verified against the workspace it was resolved
 * against: same path plus different content is a different run.
 *
 * Lock creation is explicit and caller-driven because the resolver is
 * synchronous, but a source-backed capability cannot produce a revision until
 * the caller supplies its lock.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256Hex } from "../ir/canonical.js";
import type { HarnessIrBundle, HarnessRevision, SourceLock } from "../ir/index.js";
import { HarnessSourceLockError } from "../ir/revision.js";

export interface SourceLockOptions {
  /** Workspace root every declared relative source resolves against. */
  root: string;
  /** Largest tree a lock walks, so a mis-typed source cannot hang a resolve. */
  maxFiles?: number;
}

export class HarnessSourceRootRequiredError extends Error {
  constructor(readonly revisionId: string) {
    super(
      `Harness revision '${revisionId}' contains source locks; provide the source root ` +
        "used to create them instead of deriving it from the task working directory.",
    );
    this.name = "HarnessSourceRootRequiredError";
  }
}

const DEFAULT_MAX_FILES = 2_000;

/**
 * Digest every declared capability source in the bundle.
 *
 * Capabilities without a `source` contribute no lock: their whole contract
 * already lives in the IR and is covered by the capability content hash.
 */
export async function lockCapabilitySources(
  bundle: HarnessIrBundle,
  options: SourceLockOptions,
): Promise<SourceLock[]> {
  const locks: SourceLock[] = [];
  for (const skill of bundle.skills) {
    if (skill.source === undefined) {
      continue;
    }
    locks.push(await lockOneSource(skill.id, skill.source, options));
  }
  return locks.sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0));
}

/**
 * Re-verify a revision's locks against the workspace.
 *
 * A revision without locks verifies trivially: it never claimed to cover its
 * source trees, and pretending otherwise would be the same dishonesty the lock
 * exists to remove.
 */
export async function verifyRevisionSourceLocks(
  revision: HarnessRevision,
  options?: SourceLockOptions,
): Promise<void> {
  if (revision.sourceLocks.length === 0) {
    return;
  }
  if (options === undefined) {
    throw new HarnessSourceRootRequiredError(revision.revisionId);
  }
  const drifted: string[] = [];
  for (const lock of revision.sourceLocks) {
    let current: SourceLock;
    try {
      current = await lockOneSource(lock.capabilityId, lock.uri, options);
    } catch (error) {
      drifted.push(`${lock.capabilityId} (${lock.uri}): ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (current.digest !== lock.digest) {
      drifted.push(`${lock.capabilityId} (${lock.uri}) now digests ${current.digest}`);
    }
  }
  if (drifted.length > 0) {
    throw new HarnessSourceLockError(revision.revisionId, drifted);
  }
}

/**
 * Resolve a declared source against the workspace root, rejecting anything that
 * leaves it.
 *
 * Both a lexical and a `realpath` check are needed: the first rejects `../`
 * traversal in the declaration, the second rejects a symlink inside the root
 * that points out of it. Shared with skill delivery so the bytes a run reads
 * are bounded by exactly the same rule as the bytes a lock digests.
 */
export async function resolveContainedSource(root: string, source: string): Promise<string> {
  const lexicalRoot = resolve(root);
  const lexicalSource = resolve(lexicalRoot, source);
  const lexicalPrefix = lexicalRoot.endsWith(sep) ? lexicalRoot : `${lexicalRoot}${sep}`;
  if (lexicalSource !== lexicalRoot && !lexicalSource.startsWith(lexicalPrefix)) {
    throw new Error(`source '${source}' escapes the workspace root`);
  }
  const realRoot = await realpath(lexicalRoot);
  const absolute = await realpath(lexicalSource);
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (absolute !== realRoot && !absolute.startsWith(prefix)) {
    throw new Error(`source '${source}' resolves outside the workspace root`);
  }
  return absolute;
}

async function lockOneSource(
  capabilityId: string,
  source: string,
  options: SourceLockOptions,
): Promise<SourceLock> {
  const absolute = await resolveContainedSource(options.root, source);
  const metadata = await stat(absolute);
  const entries: Array<{ path: string; sha256: string }> = [];
  if (metadata.isFile()) {
    entries.push({ path: portable(source), sha256: sha256Hex(await readFile(absolute)) });
  } else if (metadata.isDirectory()) {
    await walk(absolute, absolute, entries, options.maxFiles ?? DEFAULT_MAX_FILES);
  } else {
    throw new Error(`source '${source}' is neither a file nor a directory`);
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    capabilityId,
    uri: portable(source),
    digest: `sha256:${sha256Hex(canonicalJson(entries))}`,
    files: entries.length,
  };
}

async function walk(
  root: string,
  directory: string,
  entries: Array<{ path: string; sha256: string }>,
  maxFiles: number,
): Promise<void> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, entries, maxFiles);
      continue;
    }
    if (!entry.isFile()) {
      // Symlinks and devices carry no reproducible content contract.
      throw new Error(`'${portable(relative(root, absolute))}' is not a regular file`);
    }
    if (entries.length >= maxFiles) {
      throw new Error(`source tree exceeds the ${maxFiles} file lock limit`);
    }
    entries.push({
      path: portable(relative(root, absolute)),
      sha256: digestFile(await readFile(absolute)),
    });
  }
}

/**
 * Digest one file's bytes.
 *
 * Locking walks whole skill trees, so this is the only hot hashing path in the
 * package and it is Node-only by construction. `node:crypto` is used directly
 * here; the portable implementation in `ir/canonical.ts` stays reserved for the
 * small canonical documents that must also hash in a browser.
 */
function digestFile(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function portable(value: string): string {
  return value.replaceAll("\\", "/");
}
