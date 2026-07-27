import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { LANGUAGE_BY_EXTENSION, isIgnored, isSupportedSource, languageFor } from "./config.mjs";
import { listTrackedFiles } from "./git.mjs";
import { LANGUAGE_ADAPTERS } from "./languages/index.mjs";
import { extractSymbolsFromSource, normalizeTypeText } from "./parser.mjs";
import { toPosix, unique } from "./utils.mjs";

export async function buildCodeGraph(repoRoot, changedFiles, config) {
  const tracked = await listTrackedFiles(repoRoot);
  const projectFiles = unique([...changedFiles, ...tracked]).map((file) => toPosix(file));
  const sourceFiles = projectFiles
    .map((file) => toPosix(file))
    .filter((file) => isSupportedSource(file))
    .filter((file) => !isIgnored(file, config));
  const prioritized = [
    ...sourceFiles.filter((file) => changedFiles.includes(file)),
    ...sourceFiles.filter((file) => !changedFiles.includes(file)),
  ].slice(0, config.limits.maxSourceFiles);

  const symbolsByFile = new Map();
  const symbolById = new Map();
  const localSymbolsByFile = new Map();
  const exportsByFile = new Map();
  const importsByFile = new Map();
  const allSymbols = [];
  const allCallSites = [];

  for (const file of prioritized) {
    const absolute = path.join(repoRoot, file);
    if (!existsSync(absolute)) {
      continue;
    }

    const fileStat = await stat(absolute).catch(() => null);
    if (!fileStat || fileStat.size > config.limits.maxFileBytes) {
      continue;
    }

    const source = await readFile(absolute, "utf8").catch(() => "");
    const extracted = await extractSymbolsFromSource(file, source);
    symbolsByFile.set(file, extracted.symbols);
    importsByFile.set(file, extracted.imports);
    allSymbols.push(...extracted.symbols);
    allCallSites.push(...extracted.callSites);

    for (const symbol of extracted.symbols) {
      symbolById.set(symbol.id, symbol);
      addIndexedSymbol(localSymbolsByFile, file, symbol.name, symbol.id);
      for (const exportName of symbol.exportNames ?? []) {
        addIndexedSymbol(exportsByFile, file, exportName, symbol.id);
      }
    }
  }

  const moduleIndex = await buildModuleIndex(repoRoot, prioritized, projectFiles);
  const resolvedImportsByFile = new Map(
    [...importsByFile.entries()].map(([file, imports]) => {
      const resolved = imports.map((item) => {
        const sourceFiles = resolveImportSources(file, item.source, moduleIndex);
        return {
          ...item,
          sourceFile: sourceFiles[0] ?? null,
          sourceFiles,
        };
      });
      return [file, resolved];
    }),
  );

  const graphDraft = {
    symbolById,
    localSymbolsByFile,
    exportsByFile,
    resolvedImportsByFile,
  };
  const forwardEdges = new Map();
  const reverseEdges = new Map();
  const testFilesBySymbolId = new Map();

  for (const callSite of allCallSites) {
    const targetIds = resolveCallTargets(callSite, graphDraft);
    for (const targetId of targetIds) {
      if (callSite.isTest) {
        testFilesBySymbolId.set(targetId, [
          ...(testFilesBySymbolId.get(targetId) ?? []),
          callSite.filePath,
        ]);
      }

      if (!callSite.callerId || callSite.callerId === targetId) {
        continue;
      }

      forwardEdges.set(callSite.callerId, [
        ...(forwardEdges.get(callSite.callerId) ?? []),
        targetId,
      ]);
      reverseEdges.set(targetId, [
        ...(reverseEdges.get(targetId) ?? []),
        callSite.callerId,
      ]);
    }
  }

  return {
    allSymbols,
    symbolById,
    symbolsByFile,
    resolvedImportsByFile,
    forwardEdges: dedupeEdgeMap(forwardEdges),
    reverseEdges: dedupeEdgeMap(reverseEdges),
    testFilesBySymbolId: dedupeEdgeMap(testFilesBySymbolId),
    parsedFiles: prioritized.length,
    truncated: sourceFiles.length > prioritized.length,
  };
}

function addIndexedSymbol(index, file, name, id) {
  if (!name) {
    return;
  }
  const fileIndex = index.get(file) ?? new Map();
  fileIndex.set(name, [...(fileIndex.get(name) ?? []), id]);
  index.set(file, fileIndex);
}

async function buildModuleIndex(repoRoot, files, projectFiles = files) {
  const modules = new Map();
  const packages = new Map();
  const aliases = new Map();
  for (const file of files) {
    const normalized = toPosix(file);
    const withoutExt = normalized.replace(/\.[^.]+$/, "");
    modules.set(normalized, normalized);
    modules.set(withoutExt, normalized);
    const directory = path.posix.dirname(withoutExt);
    if (directory && directory !== ".") {
      packages.set(directory, [...(packages.get(directory) ?? []), normalized]);
    }
    if (withoutExt.endsWith("/index")) {
      modules.set(withoutExt.replace(/\/index$/, ""), normalized);
    }
  }
  await addTypeScriptAliases(repoRoot, projectFiles, modules, aliases);
  return { modules, packages, aliases };
}

async function addTypeScriptAliases(repoRoot, projectFiles, modules, aliases) {
  const configs = await loadTypeScriptConfigs(repoRoot, projectFiles);
  for (const config of configs) {
    const basePrefix = toPosix(path.posix.normalize(path.posix.join(config.directory, config.baseUrl ?? "")));
    addBaseUrlAliases(modules, aliases, basePrefix);

    const entries = Object.entries(config.paths ?? {}).sort(([left], [right]) => {
      return patternPrefixLength(right) - patternPrefixLength(left);
    });
    for (const [aliasPattern, replacements] of entries) {
      for (const replacement of Array.isArray(replacements) ? replacements : []) {
        addPathAliases(
          modules,
          aliases,
          aliasPattern,
          toPosix(path.posix.normalize(path.posix.join(basePrefix, replacement))),
        );
      }
    }
  }
}

function addBaseUrlAliases(modules, aliases, basePrefix) {
  if (!basePrefix || basePrefix === ".") {
    return;
  }
  const prefix = `${basePrefix.replace(/\/$/, "")}/`;
  for (const [moduleKey, file] of [...modules.entries()]) {
    if (moduleKey.startsWith(prefix)) {
      aliases.set(moduleKey.slice(prefix.length), file);
    }
  }
}

function addPathAliases(modules, aliases, aliasPattern, targetPattern) {
  if (!aliasPattern || !targetPattern) {
    return;
  }

  if (!aliasPattern.includes("*") && !targetPattern.includes("*")) {
    const resolved = modules.get(targetPattern) ?? modules.get(targetPattern.replace(/\.[^.]+$/, ""));
    if (resolved) {
      aliases.set(aliasPattern, resolved);
    }
    return;
  }

  for (const [moduleKey, file] of [...modules.entries()]) {
    const suffix = matchPattern(targetPattern, moduleKey);
    if (suffix !== null) {
      aliases.set(applyPattern(aliasPattern, suffix), file);
    }
  }
}

async function loadTypeScriptConfigs(repoRoot, projectFiles) {
  const configNames = new Set(["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]);
  const configFiles = unique([
    ...projectFiles.filter((file) => configNames.has(path.posix.basename(file))),
    ...[...configNames].filter((file) => existsSync(path.join(repoRoot, file))),
  ]);
  const configs = [];
  for (const configFile of configFiles) {
    const parsed = await readTypeScriptConfig(repoRoot, configFile);
    const compilerOptions = parsed?.compilerOptions ?? {};
    if (compilerOptions.baseUrl || compilerOptions.paths) {
      configs.push({
        directory: path.posix.dirname(configFile) === "." ? "" : path.posix.dirname(configFile),
        baseUrl: compilerOptions.baseUrl,
        paths: compilerOptions.paths,
      });
    }
  }
  return configs;
}

async function readTypeScriptConfig(repoRoot, configFile, seen = new Set()) {
  const normalized = toPosix(path.posix.normalize(configFile));
  if (seen.has(normalized)) {
    return {};
  }
  seen.add(normalized);

  const absolute = path.join(repoRoot, normalized);
  const raw = await readFile(absolute, "utf8").catch(() => "");
  if (!raw) {
    return {};
  }

  const data = parseJsonc(raw);
  const parent = await readExtendedTypeScriptConfig(repoRoot, normalized, data.extends, seen);
  return {
    ...parent,
    ...data,
    compilerOptions: {
      ...(parent.compilerOptions ?? {}),
      ...(data.compilerOptions ?? {}),
    },
  };
}

async function readExtendedTypeScriptConfig(repoRoot, configFile, extended, seen) {
  if (!extended || typeof extended !== "string" || !extended.startsWith(".")) {
    return {};
  }
  const directory = path.posix.dirname(configFile);
  let parentFile = toPosix(path.posix.normalize(path.posix.join(directory, extended)));
  if (!path.posix.extname(parentFile)) {
    parentFile = `${parentFile}.json`;
  }
  return readTypeScriptConfig(repoRoot, parentFile, seen);
}

function parseJsonc(raw) {
  try {
    return JSON.parse(stripJsonc(raw));
  } catch {
    return {};
  }
}

function stripJsonc(raw) {
  let result = "";
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === "\"") {
      result += char;
      index += 1;
      while (index < raw.length) {
        result += raw[index];
        if (raw[index] === "\\" && index + 1 < raw.length) {
          index += 1;
          result += raw[index];
        } else if (raw[index] === "\"") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < raw.length && raw[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < raw.length - 1 && !(raw[index] === "*" && raw[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(index + 2, raw.length);
      continue;
    }
    result += char;
    index += 1;
  }
  return result.replace(/,\s*([\]}])/g, "$1");
}

function patternPrefixLength(pattern) {
  return pattern.split("*")[0].length;
}

function matchPattern(pattern, value) {
  if (!pattern.includes("*")) {
    return pattern === value ? "" : null;
  }
  const [prefix, suffix = ""] = pattern.split("*");
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return null;
  }
  return value.slice(prefix.length, value.length - suffix.length);
}

function applyPattern(pattern, suffix) {
  return pattern.includes("*") ? pattern.replace("*", suffix) : pattern;
}

function resolveImportSources(fromFile, source, moduleIndex) {
  const adapter = languageAdapterForFile(fromFile);
  const resolved =
    adapter?.resolveImportSource?.(
      fromFile,
      source,
      moduleIndex.modules,
      LANGUAGE_BY_EXTENSION.keys(),
      moduleIndex.packages,
      moduleIndex.aliases,
    ) ?? null;
  if (!resolved) {
    return [];
  }
  return Array.isArray(resolved) ? resolved : [resolved];
}

function languageAdapterForFile(filePath) {
  return LANGUAGE_ADAPTERS[languageFor(filePath)];
}

function resolveCallTargets(callSite, graph) {
  const imports = graph.resolvedImportsByFile.get(callSite.filePath) ?? [];
  let candidates = [];

  if (callSite.receiver) {
    const namespaceImport = imports.find(
      (item) => item.kind === "namespace" && item.localName === callSite.receiver && item.sourceFile,
    );
    if (namespaceImport) {
      candidates = exportedCandidateIds(graph, importSourceFiles(namespaceImport), callSite.member);
    }
  } else {
    const imported = imports.find((item) => item.localName === callSite.name && item.sourceFile);
    if (imported) {
      candidates = exportedCandidateIds(graph, importSourceFiles(imported), imported.importedName);
    } else {
      candidates = graph.localSymbolsByFile.get(callSite.filePath)?.get(callSite.name) ?? [];
    }
  }

  return selectMatchingCandidates(candidates, callSite, graph);
}

function importSourceFiles(importItem) {
  return importItem.sourceFiles?.length ? importItem.sourceFiles : [importItem.sourceFile].filter(Boolean);
}

function exportedCandidateIds(graph, files, exportName) {
  return files.flatMap((file) => {
    const exportIndex = graph.exportsByFile.get(file);
    if (!exportIndex) {
      return [];
    }
    if (exportName === "default") {
      return exportIndex.get("default") ?? [];
    }
    return exportIndex.get(exportName) ?? [];
  });
}

function selectMatchingCandidates(candidateIds, callSite, graph) {
  const candidates = candidateIds.map((id) => graph.symbolById.get(id)).filter(Boolean);
  if (candidates.length <= 1) {
    return candidates.map((symbol) => symbol.id);
  }

  const arityMatches = candidates.filter((symbol) => signatureArityMatches(symbol, callSite));
  const pool = arityMatches.length > 0 ? arityMatches : candidates;
  const typeMatches = pool.filter((symbol) => signatureTypesMatch(symbol, callSite));
  const selected = typeMatches.length > 0 ? typeMatches : pool;
  const implementations = pool.filter((symbol) => symbol.hasBody);

  return unique([
    ...selected.map((symbol) => symbol.id),
    ...implementations.map((symbol) => symbol.id),
  ]);
}

function signatureArityMatches(symbol, callSite) {
  if (symbol.kind !== "function") {
    return true;
  }
  return symbol.arity === callSite.argumentCount;
}

function signatureTypesMatch(symbol, callSite) {
  if (symbol.kind !== "function" || symbol.params.length === 0) {
    return true;
  }
  return callSite.argumentTypes.every((argType, index) => {
    const paramType = normalizeTypeText(symbol.params[index]?.type ?? "");
    if (!paramType || argType === "unknown") {
      return true;
    }
    return paramAcceptsArgumentType(paramType, argType);
  });
}

function paramAcceptsArgumentType(paramType, argType) {
  const normalized = paramType.toLowerCase();
  if (normalized === "any" || normalized === "unknown") {
    return true;
  }
  if (normalized.includes("|")) {
    return normalized.split("|").some((part) => paramAcceptsArgumentType(part.trim(), argType));
  }
  if (argType === "array") {
    return normalized.endsWith("[]") || normalized.includes("array");
  }
  if (argType === "object") {
    return normalized.includes("object") || normalized.includes("{");
  }
  return normalized.includes(argType);
}

function dedupeEdgeMap(edgeMap) {
  return new Map([...edgeMap.entries()].map(([key, values]) => [key, unique(values)]));
}

function overlaps(symbol, ranges) {
  return ranges.some(([start, end]) => symbol.startLine <= end && symbol.endLine >= start);
}

function innermostSymbols(symbols) {
  return symbols.filter((symbol) => {
    const span = symbol.endLine - symbol.startLine;
    return !symbols.some((other) => {
      if (other === symbol) {
        return false;
      }
      const otherSpan = other.endLine - other.startLine;
      return (
        other.startLine >= symbol.startLine &&
        other.endLine <= symbol.endLine &&
        otherSpan < span
      );
    });
  });
}

export function mapChangedSymbols(changedFiles, ranges, graph) {
  const changed = [];
  const seen = new Set();

  for (const file of changedFiles) {
    const symbols = graph.symbolsByFile.get(file) ?? [];
    const fileRanges = ranges[file] ?? [];
    const overlapping = innermostSymbols(
      fileRanges.length > 0 ? symbols.filter((symbol) => overlaps(symbol, fileRanges)) : symbols,
    );

    for (const symbol of overlapping) {
      const key = `${symbol.filePath}:${symbol.name}:${symbol.startLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      changed.push({ ...symbol });
    }
  }

  return changed;
}
