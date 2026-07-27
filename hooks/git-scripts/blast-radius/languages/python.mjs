import path from "node:path";

export const exportsTopLevelByName = true;

export function moduleNameForFile(filePath) {
  return filePath.replace(/\.py$/, "").replace(/\/__init__$/, "").replaceAll("/", ".");
}

export function parseImports(rootNode, relativePath) {
  const imports = [];

  function visit(node) {
    if (!node) {
      return;
    }
    if (node.type === "import_from_statement") {
      imports.push(...parseImportFrom(node, relativePath));
      return;
    }
    if (node.type === "import_statement") {
      imports.push(...parseImport(node, relativePath));
      return;
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(rootNode);
  return imports;
}

export function resolveImportSource(fromFile, source, moduleIndex) {
  const asPath = sourceToPath(fromFile, source);
  if (moduleIndex.has(source)) {
    return moduleIndex.get(source);
  }
  if (moduleIndex.has(asPath)) {
    return moduleIndex.get(asPath);
  }
  if (moduleIndex.has(`${asPath}/__init__`)) {
    return moduleIndex.get(`${asPath}/__init__`);
  }
  return null;
}

function sourceToPath(fromFile, source) {
  if (!source.startsWith(".")) {
    return source.replaceAll(".", "/");
  }

  const match = /^(\.+)(.*)$/.exec(source);
  const dotCount = match?.[1]?.length ?? 0;
  const tail = (match?.[2] ?? "").replace(/^\./, "");
  const parts = path.posix.dirname(fromFile).split("/").filter(Boolean);

  for (let index = 1; index < dotCount; index += 1) {
    parts.pop();
  }

  if (tail) {
    parts.push(...tail.split(".").filter(Boolean));
  }

  return parts.join("/");
}

function parseImportFrom(node, relativePath) {
  const sourceNode = node.namedChildren.find((child) => child?.type === "dotted_name" || child?.type === "relative_import");
  const source = sourceNode?.text ?? "";
  if (!source) {
    return [];
  }

  const imports = [];
  for (const child of node.namedChildren) {
    if (child === sourceNode) {
      continue;
    }
    if (child.type === "aliased_import") {
      const imported = child.namedChildren.find((item) => item?.type === "dotted_name")?.text ?? "";
      const alias = child.namedChildren.find((item) => item?.type === "identifier")?.text ?? "";
      imports.push(...fromImportEntries(source, imported, alias, relativePath));
    } else if (child.type === "dotted_name") {
      imports.push(...fromImportEntries(source, child.text, "", relativePath));
    }
  }
  return imports;
}

function fromImportEntries(source, imported, alias, relativePath) {
  if (!imported) {
    return [];
  }

  const localName = alias || imported.split(".").at(-1);
  return [
    {
      localName,
      importedName: imported.split(".").at(-1),
      source,
      kind: "named",
      filePath: relativePath,
    },
    {
      localName,
      importedName: "*",
      source: joinImportSource(source, imported),
      kind: "namespace",
      filePath: relativePath,
    },
  ];
}

function joinImportSource(source, imported) {
  if (!source) {
    return imported;
  }
  return /^\.+$/.test(source) ? `${source}${imported}` : `${source}.${imported}`;
}

function parseImport(node, relativePath) {
  const imports = [];
  for (const child of node.namedChildren) {
    if (child.type === "aliased_import") {
      const source = child.namedChildren.find((item) => item?.type === "dotted_name")?.text ?? "";
      const alias = child.namedChildren.find((item) => item?.type === "identifier")?.text ?? "";
      if (source && alias) {
        imports.push({
          localName: alias,
          importedName: "*",
          source,
          kind: "namespace",
          filePath: relativePath,
        });
      }
    } else if (child.type === "dotted_name") {
      imports.push({
        localName: child.text.split(".")[0],
        importedName: "*",
        source: child.text,
        kind: "namespace",
        filePath: relativePath,
      });
    }
  }
  return imports;
}
