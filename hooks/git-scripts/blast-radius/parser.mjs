import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LANGUAGE_WASM, TEST_PATH_RE, languageFor } from "./config.mjs";
import { LANGUAGE_ADAPTERS } from "./languages/index.mjs";
import { toPosix } from "./utils.mjs";

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..", "..");

const FUNCTION_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "method_definition",
  "method_declaration",
  "generator_function_declaration",
  "function_item",
  "function_signature",
]);

const CLASS_TYPES = new Set([
  "class_declaration",
  "class_definition",
  "class",
  "interface_declaration",
  "struct_item",
  "enum_item",
]);

const VARIABLE_FUNCTION_TYPES = new Set(["variable_declarator", "lexical_declaration"]);
const CALL_TYPES = new Set(["call_expression", "call", "method_invocation"]);
const IDENTIFIER_TYPES = new Set([
  "identifier",
  "property_identifier",
  "field_identifier",
  "type_identifier",
  "shorthand_property_identifier",
]);

let treeSitterState;

async function loadTreeSitter() {
  if (treeSitterState) {
    return treeSitterState;
  }

  const treeSitterPath = resolveTreeSitterRuntime();
  const wasmDir = path.dirname(treeSitterPath);
  const module = await import(pathToFileURL(treeSitterPath).href);
  const treeSitter = module.default ?? module;
  const Parser = treeSitter.Parser;

  await Parser.init({
    locateFile: (file) => path.join(wasmDir, file),
  });

  treeSitterState = {
    Parser,
    Language: treeSitter.Language,
    wasmDir,
    languages: new Map(),
  };
  return treeSitterState;
}

function resolveTreeSitterRuntime() {
  try {
    return require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter.js");
  } catch {
    return path.join(repoRoot, "vendor", "tree-sitter-wasm", "wasm", "tree-sitter.js");
  }
}

async function loadLanguage(languageId) {
  const state = await loadTreeSitter();
  if (state.languages.has(languageId)) {
    return state.languages.get(languageId);
  }

  const wasmName = LANGUAGE_WASM[languageId];
  if (!wasmName) {
    return null;
  }

  const language = await state.Language.load(path.join(state.wasmDir, wasmName));
  state.languages.set(languageId, language);
  return language;
}

function cleanIdentifier(text) {
  return (text ?? "").replace(/^["'`]|["'`]$/g, "").trim();
}

function firstNamedChild(node) {
  return node?.namedChildren?.find(Boolean) ?? null;
}

function lastNamedChild(node) {
  const children = node?.namedChildren?.filter(Boolean) ?? [];
  return children.at(-1) ?? null;
}

function nameFromNode(node) {
  if (!node) {
    return "";
  }

  if (IDENTIFIER_TYPES.has(node.type)) {
    return cleanIdentifier(node.text);
  }

  const fieldNames = ["name", "property", "field", "attribute", "declarator"];
  for (const field of fieldNames) {
    const child = node.childForFieldName?.(field);
    const name = nameFromNode(child);
    if (name) {
      return name;
    }
  }

  return nameFromNode(lastNamedChild(node));
}

function functionNameFromVariable(node) {
  const declarators =
    node.type === "lexical_declaration" ? node.namedChildren : [node];
  for (const declarator of declarators) {
    const value = declarator.childForFieldName?.("value");
    if (!value || !["arrow_function", "function", "function_expression"].includes(value.type)) {
      continue;
    }
    return nameFromNode(declarator.childForFieldName?.("name"));
  }
  return "";
}

function parseParams(node) {
  const paramsNode = node.childForFieldName?.("parameters");
  if (!paramsNode) {
    return {
      params: [],
      arity: 0,
      signature: "()",
    };
  }

  const params = paramsNode.namedChildren
    .filter(Boolean)
    .filter((child) => child.type !== "comment")
    .map((child) => {
      const name = nameFromNode(child.childForFieldName?.("name")) || nameFromNode(firstNamedChild(child));
      const typeNode = child.childForFieldName?.("type") ?? child.namedChildren.find((item) => item?.type === "type_annotation");
      const type = normalizeTypeText(typeNode?.text ?? "");
      return {
        name,
        type,
        optional: child.type.includes("optional") || /\?\s*:/.test(child.text),
        rest: child.type.includes("rest") || child.text.trim().startsWith("..."),
      };
    });

  return {
    params,
    arity: params.filter((param) => !param.rest).length,
    signature: `(${params.map((param) => param.type || "unknown").join(",")})`,
  };
}

export function normalizeTypeText(typeText) {
  return typeText
    .replace(/^:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFunctionBody(node) {
  return node.type !== "function_signature" && Boolean(node.childForFieldName?.("body") ?? node.namedChildren.find((child) => child?.type === "statement_block"));
}

function symbolFromNode(node, relativePath, languageId, context = {}) {
  let name = "";
  let kind = "";

  if (FUNCTION_TYPES.has(node.type)) {
    name = nameFromNode(node.childForFieldName?.("name")) || nameFromNode(node);
    kind = "function";
  } else if (CLASS_TYPES.has(node.type)) {
    name = nameFromNode(node.childForFieldName?.("name")) || nameFromNode(node);
    kind = "class";
  } else if (VARIABLE_FUNCTION_TYPES.has(node.type)) {
    name = functionNameFromVariable(node);
    kind = name ? "function" : "";
  }

  if (!name) {
    return null;
  }

  const params = kind === "function" ? parseParams(node) : { params: [], arity: 0, signature: "" };
  const adapter = LANGUAGE_ADAPTERS[languageId];
  const exportNames = context.defaultExport
    ? ["default"]
    : context.exported || (context.topLevel && adapter?.exportsTopLevelByName)
      ? [name]
      : adapter?.exportNamesForSymbol?.({ name, kind }, context) ?? [];
  const symbol = {
    name,
    exportNames,
    qualifiedName: `${moduleNameForFile(relativePath, languageId)}#${name}`,
    kind,
    filePath: relativePath,
    language: languageId,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    arity: params.arity,
    params: params.params,
    signature: params.signature,
    hasBody: kind === "function" ? hasFunctionBody(node) : true,
    parser: "tree-sitter",
  };
  symbol.id = symbolId(symbol);
  return symbol;
}

function symbolId(symbol) {
  return `${symbol.filePath}:${symbol.name}:${symbol.signature}:${symbol.startLine}`;
}

function callNameFromNode(node) {
  if (!CALL_TYPES.has(node.type)) {
    return null;
  }

  const argsNode = node.childForFieldName?.("arguments");
  const args = parseCallArguments(argsNode);

  if (node.type === "method_invocation") {
    return {
      rawName: nameFromNode(node.childForFieldName?.("name")),
      name: nameFromNode(node.childForFieldName?.("name")),
      receiver: nameFromNode(node.childForFieldName?.("object")),
      member: nameFromNode(node.childForFieldName?.("name")),
      argumentCount: args.length,
      argumentTypes: args,
    };
  }

  const callee =
    node.childForFieldName?.("function") ??
    node.childForFieldName?.("callee") ??
    firstNamedChild(node);
  if (callee?.type === "member_expression" || callee?.type === "attribute" || callee?.type === "selector_expression") {
    const receiver = nameFromNode(callee.childForFieldName?.("object")) || nameFromNode(callee.namedChildren[0]);
    const member = nameFromNode(
      callee.childForFieldName?.("property") ??
        callee.childForFieldName?.("attribute") ??
        callee.childForFieldName?.("field") ??
        callee.namedChildren[1],
    );
    return {
      rawName: `${receiver}.${member}`,
      name: member,
      receiver,
      member,
      argumentCount: args.length,
      argumentTypes: args,
    };
  }

  const name = nameFromNode(callee);
  return {
    rawName: name,
    name,
    receiver: null,
    member: null,
    argumentCount: args.length,
    argumentTypes: args,
  };
}

function parseCallArguments(argsNode) {
  if (!argsNode) {
    return [];
  }
  return argsNode.namedChildren.filter(Boolean).map((arg) => inferLiteralType(arg));
}

function inferLiteralType(node) {
  if (!node) {
    return "unknown";
  }
  if (
    node.type === "string" ||
    node.type === "template_string" ||
    node.type === "interpreted_string_literal" ||
    node.type === "raw_string_literal"
  ) {
    return "string";
  }
  if (node.type === "number" || node.type === "int_literal" || node.type === "float_literal") {
    return "number";
  }
  if (node.type === "true" || node.type === "false") {
    return "boolean";
  }
  if (node.type === "null") {
    return "null";
  }
  if (node.type === "object" || node.type === "object_pattern") {
    return "object";
  }
  if (node.type === "array") {
    return "array";
  }
  return "unknown";
}

function extractImports(rootNode, relativePath) {
  const adapter = LANGUAGE_ADAPTERS[languageFor(relativePath)];
  return adapter?.parseImports?.(rootNode, relativePath, { nameFromNode, cleanIdentifier }) ?? [];
}

function moduleNameForFile(filePath, languageId = languageFor(filePath)) {
  const adapter = LANGUAGE_ADAPTERS[languageId];
  return adapter?.moduleNameForFile?.(toPosix(filePath)) ?? toPosix(filePath).replace(/\.[^.]+$/, "");
}

export function isTestFile(filePath) {
  return TEST_PATH_RE.test(filePath);
}

export async function extractSymbolsFromSource(relativePath, source) {
  const languageId = languageFor(relativePath);
  if (!languageId) {
    return {
      symbols: [],
      callSites: [],
      parser: null,
    };
  }

  const state = await loadTreeSitter();
  const language = await loadLanguage(languageId);
  if (!language) {
    return {
      symbols: [],
      callSites: [],
      parser: null,
    };
  }

  const parser = new state.Parser();
  parser.setLanguage(language);

  const tree = parser.parse(source);
  if (!tree) {
    parser.delete();
    return {
      symbols: [],
      callSites: [],
      parser: null,
    };
  }

  const symbols = [];
  const callSites = [];
  const imports = extractImports(tree.rootNode, relativePath);

  function visit(node, enclosingSymbol = null, context = {}) {
    if (!node) {
      return;
    }

    const isExportStatement = node.type === "export_statement";
    const nextContext = isExportStatement
      ? {
          ...context,
          exported: true,
          defaultExport: /^export\s+default\b/.test(node.text),
        }
      : context;

    const symbol = symbolFromNode(node, relativePath, languageId, {
      ...context,
      topLevel: !enclosingSymbol,
    });
    const nextEnclosing = symbol ?? enclosingSymbol;
    if (symbol) {
      symbols.push(symbol);
    }

    const callInfo = callNameFromNode(node);
    if (callInfo?.name) {
      callSites.push({
        ...callInfo,
        filePath: relativePath,
        line: node.startPosition.row + 1,
        callerId: enclosingSymbol?.id ?? null,
        callerName: enclosingSymbol?.name ?? null,
        isTest: isTestFile(relativePath),
      });
    }

    for (const child of node.namedChildren) {
      visit(child, nextEnclosing, nextContext);
    }
  }

  visit(tree.rootNode);
  tree.delete();
  parser.delete();

  return {
    symbols,
    callSites,
    imports,
    parser: "tree-sitter",
  };
}
