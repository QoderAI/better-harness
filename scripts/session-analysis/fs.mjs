import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export async function pathStat(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function pathExists(filePath) {
  return Boolean(await pathStat(filePath));
}

export async function isDirectory(filePath) {
  const value = await pathStat(filePath);
  return Boolean(value?.isDirectory());
}

export async function forEachJsonLine(filePath, onRecord, options = {}) {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let invalidLines = 0;
  let shouldStop = false;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (options.maxLines && lineNumber > options.maxLines) {
        break;
      }
      if (shouldStop || line.trim().length === 0) {
        continue;
      }
      try {
        const result = await onRecord(JSON.parse(line), lineNumber);
        if (result === false) {
          shouldStop = true;
          lines.close();
        }
      } catch (error) {
        invalidLines += 1;
        // Adapters that require an authoritative first record (for example
        // Pi's session header) must be able to distinguish a malformed JSON
        // line from an empty file. Keep this opt-in so existing collectors
        // retain their current fail-soft behavior.
        if (typeof options.onInvalid === "function") {
          try {
            await options.onInvalid(error, line, lineNumber);
          } catch {
            // Diagnostics are best-effort and must not turn a malformed input
            // into an unbounded reader failure.
          }
        }
      }
    }
  } finally {
    input.destroy();
  }

  return { lineCount: lineNumber, invalidLines };
}

export async function walkFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? Infinity;
  const limit = options.limit ?? Infinity;
  const files = [];
  const visitedDirs = new Set();

  async function resolveDirIdentity(dir) {
    try {
      return await realpath(dir);
    } catch {
      return path.resolve(dir);
    }
  }

  async function visit(dir, depth) {
    if (files.length >= limit || depth > maxDepth) {
      return;
    }
    const realDir = await resolveDirIdentity(dir);
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= limit) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      // Dirent isDirectory/isFile are false for symlinks; follow them so hosts
      // that install skills via ln -s (e.g. Grok ~/.grok/skills) are inventoried.
      // Track realpath identities so symlink cycles cannot re-enter a directory.
      const linkedDirectory = entry.isSymbolicLink() ? await isDirectory(fullPath) : false;
      if (entry.isDirectory() || linkedDirectory) {
        await visit(fullPath, depth + 1);
      } else if (
        (entry.isFile() || entry.isSymbolicLink())
        && (!options.match || options.match(fullPath))
      ) {
        if (entry.isFile() || (await pathStat(fullPath))?.isFile()) {
          files.push(fullPath);
        }
      }
    }
  }

  if (await isDirectory(root)) {
    await visit(root, 0);
  }
  return files;
}
