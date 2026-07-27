export function exportNamesForSymbol(symbol, context) {
  if (!context.topLevel || !/^[A-Z]/.test(symbol.name)) {
    return [];
  }
  return [symbol.name];
}

export function moduleNameForFile(filePath) {
  return filePath.replace(/\.go$/, "");
}

export function parseImports(rootNode, relativePath) {
  const imports = [];

  function visit(node) {
    if (!node) {
      return;
    }
    if (node.type === "import_spec") {
      const source = stringLiteralValue(node);
      if (source) {
        const aliasNode = node.namedChildren.find((child) => child?.type === "package_identifier");
        const localName = aliasNode?.text ?? source.split("/").at(-1);
        imports.push({
          localName,
          importedName: "*",
          source,
          kind: "namespace",
          filePath: relativePath,
        });
      }
      return;
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(rootNode);
  return imports;
}

export function resolveImportSource(_fromFile, source, moduleIndex, _extensions, packageIndex) {
  const parts = source.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const suffix = parts.slice(index).join("/");
    if (packageIndex?.has(suffix)) {
      return packageIndex.get(suffix);
    }
    if (moduleIndex.has(suffix)) {
      return moduleIndex.get(suffix);
    }
  }
  return null;
}

function stringLiteralValue(node) {
  const literal = node.namedChildren.find((child) => child?.type === "interpreted_string_literal" || child?.type === "raw_string_literal");
  if (!literal) {
    return "";
  }
  const content = literal.namedChildren.find((child) => child?.type === "interpreted_string_literal_content" || child?.type === "raw_string_literal_content");
  return content?.text ?? literal.text.replace(/^["`]|["`]$/g, "");
}
