#!/usr/bin/env node

import { deflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANGUAGE_WASM } from "../../hooks/git-scripts/blast-radius/config.mjs";

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");

const ROOT_FILES = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
];

const RUNTIME_ROOTS = [
  ".qoder-plugin",
  "case-studies",
  "docs",
  "hooks",
  "models",
  "references",
  "scripts",
  "skills",
  "templates",
];

// Repository docs remain part of the Qoder runtime, but the colocated
// Docusaurus application is a publication surface rather than runtime input.
// Keep these paths explicit so canonical docs such as docs/ARCHITECTURE.md and
// docs/specs/ continue to ship.
const RUNTIME_EXCLUDED_PATHS = [
  "docs/.docusaurus",
  "docs/.gitignore",
  "docs/build",
  "docs/docs",
  "docs/i18n",
  "docs/node_modules",
  "docs/scripts",
  "docs/src",
  "docs/static",
  "docs/docusaurus.config.js",
  "docs/package-lock.json",
  "docs/package.json",
  "docs/sidebars.js",
  "scripts/packaging",
];

const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 33;

function parseArgs(argv) {
  const args = {
    out: path.join(repoRoot, "dist", "better-harness-runtime.zip"),
    quiet: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      args.out = argv[++index] ?? args.out;
    } else if (arg.startsWith("--out=")) {
      args.out = arg.slice("--out=".length);
    } else if (arg === "--quiet") {
      args.quiet = true;
    }
  }
  return args;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function shouldSkip(filePath) {
  const base = path.basename(filePath);
  return base === ".DS_Store"
    || base === ".plugin-eval"
    || base.endsWith(".tmp")
    || base.endsWith(".log");
}

function shouldSkipRuntimePath(relativePath) {
  const normalized = toZipPath(relativePath);
  return RUNTIME_EXCLUDED_PATHS.some(
    (excluded) => normalized === excluded || normalized.startsWith(`${excluded}/`),
  );
}

function toZipPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function collectTreeSitterFiles() {
  let packageJson;
  try {
    packageJson = require.resolve("@vscode/tree-sitter-wasm/package.json");
  } catch {
    throw new Error("Missing @vscode/tree-sitter-wasm. Run npm install before creating the runtime bundle.");
  }

  const packageRoot = path.dirname(packageJson);
  const wasmNames = [
    "tree-sitter.js",
    "tree-sitter.wasm",
    ...new Set(Object.values(LANGUAGE_WASM)),
  ];
  return [
    { source: packageJson, zipPath: "vendor/tree-sitter-wasm/package.json" },
    ...["LICENSE", "README.md", "SECURITY.md"].map((name) => ({
      source: path.join(packageRoot, name),
      zipPath: `vendor/tree-sitter-wasm/${name}`,
    })),
    ...wasmNames.map((name) => ({
      source: path.join(packageRoot, "wasm", name),
      zipPath: `vendor/tree-sitter-wasm/wasm/${name}`,
    })),
  ];
}

function collectEsbuildWasmFiles() {
  let packageJson;
  try {
    packageJson = require.resolve("esbuild-wasm/package.json");
  } catch {
    throw new Error("Missing esbuild-wasm. Run npm install before creating the runtime bundle.");
  }

  const entries = [];
  collectPathEntries(path.dirname(packageJson), "vendor/esbuild-wasm", entries);
  return entries;
}

function collectYamlFiles() {
  let packageJson;
  try {
    packageJson = require.resolve("yaml/package.json");
  } catch {
    throw new Error("Missing yaml. Run npm install before creating the runtime bundle.");
  }

  const entries = [];
  collectPathEntries(path.dirname(packageJson), "node_modules/yaml", entries);
  return entries;
}

function collectPathEntries(rootPath, relativePath, entries) {
  if (!fs.existsSync(rootPath) || shouldSkip(rootPath) || shouldSkipRuntimePath(relativePath)) {
    return;
  }
  const stat = fs.statSync(rootPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
      collectPathEntries(
        path.join(rootPath, entry.name),
        relativePath ? path.join(relativePath, entry.name) : entry.name,
        entries,
      );
    }
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  entries.push({
    source: rootPath,
    zipPath: toZipPath(relativePath),
  });
}

function collectEntries() {
  const entries = ROOT_FILES.map((file) => ({
    source: path.join(repoRoot, file),
    zipPath: file,
  }));
  for (const root of RUNTIME_ROOTS) {
    collectPathEntries(path.join(repoRoot, root), root, entries);
  }
  entries.push(...collectTreeSitterFiles().filter((entry) => fs.existsSync(entry.source)));
  entries.push(...collectEsbuildWasmFiles().filter((entry) => fs.existsSync(entry.source)));
  entries.push(...collectYamlFiles().filter((entry) => fs.existsSync(entry.source)));

  const byPath = new Map();
  for (const entry of entries) {
    byPath.set(entry.zipPath, entry);
  }
  return [...byPath.values()].sort((left, right) => left.zipPath.localeCompare(right.zipPath));
}

function u16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function localHeader(entry) {
  const name = Buffer.from(entry.zipPath);
  return Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(8),
    u16(FIXED_DOS_TIME),
    u16(FIXED_DOS_DATE),
    u32(entry.crc),
    u32(entry.compressed.length),
    u32(entry.raw.length),
    u16(name.length),
    u16(0),
    name,
  ]);
}

function centralHeader(entry) {
  const name = Buffer.from(entry.zipPath);
  return Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(8),
    u16(FIXED_DOS_TIME),
    u16(FIXED_DOS_DATE),
    u32(entry.crc),
    u32(entry.compressed.length),
    u32(entry.raw.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(entry.offset),
    name,
  ]);
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  return Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entryCount),
    u16(entryCount),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ]);
}

function zipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const sourceEntry of entries) {
    const raw = fs.readFileSync(sourceEntry.source);
    const compressed = deflateRawSync(raw, { level: 9 });
    const entry = {
      ...sourceEntry,
      raw,
      compressed,
      crc: crc32(raw),
      offset,
    };
    const header = localHeader(entry);
    localParts.push(header, compressed);
    offset += header.length + compressed.length;
    centralParts.push(centralHeader(entry));
  }

  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    endOfCentralDirectory(entries.length, central.length, offset),
  ]);
}

export function createBundle(options = {}) {
  const out = path.resolve(options.out ?? path.join(repoRoot, "dist", "better-harness-runtime.zip"));
  const entries = collectEntries();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zipEntries(entries));
  return {
    out,
    entries: entries.map((entry) => entry.zipPath),
    size: fs.statSync(out).size,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = createBundle({ out: args.out });
    if (!args.quiet) {
      process.stdout.write(
        `created ${result.out} (${result.entries.length} files, ${result.size} bytes)\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`bundle creation failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
