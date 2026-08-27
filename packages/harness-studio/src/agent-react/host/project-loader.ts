import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import type { ArtifactRevision, Diagnostic, OxcCompilerPort } from "../contracts/index.js";
import { AgentStreamAssembler } from "./stream-assembler.js";

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"] as const;

export interface AgentReactSourceStamp {
  readonly signature: string;
  readonly digest: string;
}

export interface LoadedAgentReactProject {
  readonly revision: ArtifactRevision;
  readonly sources: ReadonlyMap<string, AgentReactSourceStamp>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface LoadAgentReactProjectOptions {
  readonly root: string;
  readonly entry: string;
  readonly artifactId: string;
  readonly compiler: OxcCompilerPort;
  readonly allowedPackages: readonly string[];
  readonly maxModules?: number;
  readonly maxSourceBytes?: number;
}

const DEFAULT_MAX_MODULES = 64;
const DEFAULT_MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Loads only the static module graph admitted by the AgentReact compiler. */
export async function loadAgentReactProject(
  options: LoadAgentReactProjectOptions,
): Promise<LoadedAgentReactProject> {
  const root = await realpath(options.root);
  const entry = await realpath(options.entry);
  assertWithin(root, entry);
  const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  const queue = [entry];
  const seen = new Set<string>();
  const modules = new Map<string, string>();
  const sources = new Map<string, AgentReactSourceStamp>();
  const diagnostics: Diagnostic[] = [];
  let sourceBytes = 0;

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    if (seen.size > maxModules) throw new Error(`AgentReact project exceeds the ${maxModules}-module limit.`);
    await assertRegularUnlinkedSource(root, path);
    const bytes = await readFile(path);
    sourceBytes += bytes.byteLength;
    if (sourceBytes > maxSourceBytes) {
      throw new Error(`AgentReact project exceeds the ${maxSourceBytes}-byte source limit.`);
    }
    const text = bytes.toString("utf8");
    const modulePath = revisionPath(root, path);
    modules.set(modulePath, text);
    const stats = await lstat(path);
    sources.set(path, {
      signature: `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.nlink}`,
      digest: createHash("sha256").update(bytes).digest("hex"),
    });

    const inspected = await options.compiler.compileModule({
      module: { path: modulePath, text },
      entry: path === entry,
      allowedPackages: options.allowedPackages,
    });
    diagnostics.push(...inspected.diagnostics);
    for (const specifier of inspected.semanticIndex?.imports ?? []) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
      const dependency = await resolveProjectImport(root, path, specifier);
      if (dependency !== undefined && !seen.has(dependency)) queue.push(dependency);
    }
  }

  const assembler = new AgentStreamAssembler({
    id: options.artifactId,
    entry: revisionPath(root, entry),
  });
  for (const [path, text] of [...modules].sort(([left], [right]) => left.localeCompare(right))) {
    assembler.applyModulePatch({ path, text, mode: "replace" });
    assembler.sealModule(path);
  }
  return { revision: assembler.commitArtifactRevision(), sources, diagnostics };
}

async function resolveProjectImport(root: string, importer: string, specifier: string): Promise<string | undefined> {
  const base = specifier.startsWith("/")
    ? resolve(root, `.${specifier}`)
    : resolve(dirname(importer), specifier);
  assertWithin(root, base);
  const withoutJs = base.replace(/\.(?:js|mjs)$/u, "");
  const roots = withoutJs === base ? [base] : [base, withoutJs];
  const candidates = extname(base) === ""
    ? [
      ...roots,
      ...roots.flatMap((candidate) => SOURCE_EXTENSIONS.map((extension) => `${candidate}${extension}`)),
      ...roots.flatMap((candidate) => SOURCE_EXTENSIONS.map((extension) => resolve(candidate, `index${extension}`))),
    ]
    : [...roots, ...roots.flatMap((candidate) => SOURCE_EXTENSIONS.map((extension) => `${candidate}${extension}`))];
  const matches: string[] = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const stats = await lstat(candidate);
      if (stats.isFile() && !stats.isSymbolicLink()) matches.push(await realpath(candidate));
    } catch {
      // Missing candidates are resolved after every supported extension is tried.
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length === 0) return undefined;
  if (unique.length > 1) throw new Error(`AgentReact import '${specifier}' is ambiguous; include its extension.`);
  assertWithin(root, unique[0]!);
  return unique[0];
}

async function assertRegularUnlinkedSource(root: string, path: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) {
    throw new Error("AgentReact imports must resolve to one regular, non-linked file.");
  }
  const parts = relative(root, path).split(sep).filter((part) => part !== "");
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("AgentReact imports cannot cross symbolic links.");
  }
}

function revisionPath(root: string, path: string): string {
  return `/${relative(root, path).split(sep).join("/")}`;
}

function assertWithin(root: string, path: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new Error("AgentReact source escapes the configured Artifact directory.");
  }
}
