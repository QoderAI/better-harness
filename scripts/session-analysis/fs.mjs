import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

export async function pathStat(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
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
      } catch {
        invalidLines += 1;
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

  async function visit(dir, depth) {
    if (files.length >= limit || depth > maxDepth) {
      return;
    }
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
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && (!options.match || options.match(fullPath))) {
        files.push(fullPath);
      }
    }
  }

  if (await isDirectory(root)) {
    await visit(root, 0);
  }
  return files;
}
