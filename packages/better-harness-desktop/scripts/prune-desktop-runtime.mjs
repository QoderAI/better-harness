import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

const PHOSPHOR_SCOPE = "@phosphor-icons";
const PDFJS_PACKAGE = "pdfjs-dist";
const PDFJS_SUPPORT_TREES = new Set(["cmaps", "wasm", "standard_fonts", "iccs", "image_decoders"]);
const PDFJS_LEGACY_RUNTIME = new Set(["pdf.mjs", "pdf.worker.mjs"]);
const README_NAMES = new Set(["readme", "readme.md", "readme.txt", "readme.markdown", "readme.rst"]);

/** Debug metadata is never required to start the packaged Studio runtime. */
export function isDebugMetadataFile(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".map")) return true;
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) return true;
  return README_NAMES.has(lower);
}

function relativeSegments(from, to) {
  const rel = relative(from, to);
  if (rel === "") return [];
  const segments = [];
  let current = rel;
  while (current && current !== ".") {
    segments.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return segments;
}

/** Keep only the Node PDF.js entry Studio imports, plus its support trees. */
export function isKeptPdfjsPath(packageRoot, filePath) {
  const segments = relativeSegments(packageRoot, filePath);
  if (segments.length === 1 && (segments[0] === "package.json" || segments[0] === "LICENSE")) return true;
  if (segments[0] === "legacy" && segments[1] === "build" && segments.length === 3) {
    return PDFJS_LEGACY_RUNTIME.has(segments[2]);
  }
  if (PDFJS_SUPPORT_TREES.has(segments[0])) return true;
  if (segments[0] === "legacy" && segments[1] === "image_decoders") return true;
  return false;
}

async function removeEmptyDirectories(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    await removeEmptyDirectories(full);
    const leftover = await readdir(full);
    if (leftover.length === 0) await rm(full, { recursive: true, force: true });
  }
}

async function pruneDebugMetadata(root, stats) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (isDebugMetadataFile(entry.name)) {
        await rm(full, { force: true });
        stats.removed += 1;
      }
      continue;
    }
    if (entry.isDirectory()) {
      await pruneDebugMetadata(full, stats);
      continue;
    }
    if (entry.isFile() && isDebugMetadataFile(entry.name)) {
      await rm(full, { force: true });
      stats.removed += 1;
    }
  }
}

function isKeptPdfjsPrefix(packageRoot, directoryPath) {
  const segments = relativeSegments(packageRoot, directoryPath);
  if (segments.length === 0) return true;
  if (PDFJS_SUPPORT_TREES.has(segments[0])) return true;
  if (segments[0] !== "legacy") return false;
  if (segments.length === 1) return true;
  if (segments[1] === "build" && segments.length === 2) return true;
  return segments[1] === "image_decoders";
}

async function prunePdfjsPackage(packageRoot, current, stats) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (!isKeptPdfjsPrefix(packageRoot, full)) {
        await rm(full, { recursive: true, force: true });
        stats.removed += 1;
        continue;
      }
      await prunePdfjsPackage(packageRoot, full, stats);
      continue;
    }
    if (!isKeptPdfjsPath(packageRoot, full)) {
      await rm(full, { force: true });
      stats.removed += 1;
    }
  }
}

async function visitNodeModules(dir, stats) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.name === PHOSPHOR_SCOPE) {
      await rm(full, { recursive: true, force: true });
      stats.removed += 1;
      stats.removedPhosphor = true;
      continue;
    }
    if (entry.name === PDFJS_PACKAGE) {
      await prunePdfjsPackage(full, full, stats);
      continue;
    }
    if (entry.name === "node_modules" || entry.name.startsWith("@")) {
      await visitNodeModules(full, stats);
      continue;
    }
    await visitNodeModules(join(full, "node_modules"), stats);
  }
}

/** Drop pack-only weight from a staged Electron app root. */
export async function pruneDesktopRuntime(appRoot) {
  const nodeModules = join(appRoot, "node_modules");
  const stats = { removed: 0, removedPhosphor: false };
  await visitNodeModules(nodeModules, stats);
  await pruneDebugMetadata(nodeModules, stats);
  await removeEmptyDirectories(nodeModules);
  return stats;
}
