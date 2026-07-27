import path from "node:path";

export function moduleNameForFile(filePath) {
  return filePath.replace(/\.[^.]+$/, "").replace(/\/index$/, "");
}

export function parseImports(rootNode, relativePath, helpers) {
  const imports = [];

  function visit(node) {
    if (!node) {
      return;
    }
    if (node.type === "import_statement") {
      imports.push(...parseImportStatement(node, relativePath, helpers));
      return;
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(rootNode);
  return imports;
}

export function resolveImportSource(fromFile, source, moduleIndex, extensions, _packageIndex, aliasIndex) {
  if (aliasIndex?.has(source)) {
    return aliasIndex.get(source);
  }

  if (!source.startsWith(".")) {
    return null;
  }

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source));
  const bases = uniqueCandidateBases(base);
  for (const candidateBase of bases) {
    if (moduleIndex.has(candidateBase)) {
      return moduleIndex.get(candidateBase);
    }

    for (const ext of extensions) {
      const withExt = `${candidateBase}${ext}`;
      if (moduleIndex.has(withExt)) {
        return moduleIndex.get(withExt);
      }
    }

    for (const ext of extensions) {
      const indexPath = `${candidateBase}/index${ext}`;
      if (moduleIndex.has(indexPath)) {
        return moduleIndex.get(indexPath);
      }
    }
  }

  return null;
}

function uniqueCandidateBases(base) {
  const withoutExtension = base.replace(/\.[^/.]+$/, "");
  return withoutExtension === base ? [base] : [base, withoutExtension];
}

function parseImportStatement(node, relativePath, helpers) {
  const source = stringNodeValue(node.childForFieldName?.("source"), helpers);
  if (!source) {
    return [];
  }

  const imports = [];
  const importClause = node.namedChildren.find((child) => child?.type === "import_clause");
  if (!importClause) {
    return imports;
  }

  for (const child of importClause.namedChildren) {
    if (!child) {
      continue;
    }

    if (child.type === "identifier") {
      imports.push({
        localName: child.text,
        importedName: "default",
        source,
        kind: "default",
        filePath: relativePath,
      });
    } else if (child.type === "named_imports") {
      for (const specifier of child.namedChildren.filter((item) => item?.type === "import_specifier")) {
        const imported = helpers.nameFromNode(specifier.childForFieldName?.("name"));
        const alias = helpers.nameFromNode(specifier.childForFieldName?.("alias"));
        imports.push({
          localName: alias || imported,
          importedName: imported,
          source,
          kind: "named",
          filePath: relativePath,
        });
      }
    } else if (child.type === "namespace_import") {
      const local = helpers.nameFromNode(child.namedChildren.find((item) => item?.type === "identifier"));
      if (local) {
        imports.push({
          localName: local,
          importedName: "*",
          source,
          kind: "namespace",
          filePath: relativePath,
        });
      }
    }
  }

  return imports;
}

function stringNodeValue(node, helpers) {
  if (!node) {
    return "";
  }
  const fragment = node.namedChildren.find((child) => child?.type === "string_fragment");
  return helpers.cleanIdentifier(fragment?.text ?? node.text);
}
