import {
  type ReactSemanticIndex,
  type SemanticComponentEntry,
  type SemanticJsxNodeEntry,
  sourceNodeId,
} from "../contracts/index.js";
import {
  type AstNode,
  createPositionIndex,
  isAstNode,
  isIntrinsicElementName,
  jsxElementName,
  memberPath,
  walk,
} from "./ast.js";

/**
 * The semantic index answers "what is in this module" for Diff, navigation, and
 * local edits across Revisions. It deliberately carries no permission
 * information: a later semantic Diff that could widen a grant would turn a
 * convenience index into an authorization path.
 */
export function buildSemanticIndex(
  modulePath: string,
  text: string,
  program: unknown,
): ReactSemanticIndex {
  const positionAt = createPositionIndex(text);
  const body = isAstNode(program) && Array.isArray(program.body) ? program.body.filter(isAstNode) : [];

  const components: SemanticComponentEntry[] = [];
  const imports = new Set<string>();
  const exports = new Set<string>();
  for (const statement of body) {
    if (statement.type === "ImportDeclaration"
      || statement.type === "ExportNamedDeclaration"
      || statement.type === "ExportAllDeclaration") {
      const source = statement.source;
      if (isAstNode(source) && typeof source.value === "string") imports.add(source.value);
      if (statement.type === "ImportDeclaration") continue;
    }
    const exported = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
    if (statement.type === "ExportDefaultDeclaration") exports.add("default");
    const declaration = exported && isAstNode(statement.declaration) ? statement.declaration : statement;
    collectComponents(declaration, exported, positionAt, components, exports);
  }

  const jsxNodes: SemanticJsxNodeEntry[] = [];
  walk(program, (node, ancestors) => {
    if (node.type !== "JSXElement") return;
    const elementType = jsxElementName(node);
    if (elementType === undefined) return;
    const { line, column } = positionAt(node.start);
    const structurePath = ancestors
      .filter((ancestor) => ancestor.type === "JSXElement")
      .map((ancestor) => jsxElementName(ancestor) ?? "?");
    jsxNodes.push({
      sourceNodeId: sourceNodeId({ modulePath, line, column, elementType }),
      elementType,
      intrinsic: isIntrinsicElementName(elementType),
      line,
      column,
      structurePath: Object.freeze(structurePath),
      staticAttributes: Object.freeze(staticAttributeNames(node)),
    });
  });

  const stateReferences = new Set<string>();
  const actionReferences = new Set<string>();
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = memberPath(node.callee);
    if (callee !== "useArtifactState" && callee !== "useArtifactAction") return;
    const first = Array.isArray(node.arguments) ? node.arguments[0] : undefined;
    const literal = isAstNode(first) && first.type === "Literal" && typeof first.value === "string" ? first.value : undefined;
    if (literal === undefined) return;
    if (callee === "useArtifactState") stateReferences.add(literal);
    else actionReferences.add(literal);
  });

  return Object.freeze({
    module: modulePath,
    components: Object.freeze(components),
    imports: Object.freeze([...imports].sort()),
    exports: Object.freeze([...exports].sort()),
    jsxNodes: Object.freeze(jsxNodes),
    stateReferences: Object.freeze([...stateReferences].sort()),
    actionReferences: Object.freeze([...actionReferences].sort()),
  });
}

function collectComponents(
  declaration: AstNode,
  exported: boolean,
  positionAt: (offset: number) => { line: number },
  components: SemanticComponentEntry[],
  exports: Set<string>,
): void {
  if (declaration.type === "FunctionDeclaration") {
    const id = declaration.id;
    const name = isAstNode(id) && typeof id.name === "string" ? id.name : undefined;
    if (name === undefined) return;
    if (exported) exports.add(name);
    if (isComponentName(name)) components.push({ name, exported, line: positionAt(declaration.start).line });
    return;
  }
  if (declaration.type !== "VariableDeclaration") return;
  const declarators = Array.isArray(declaration.declarations) ? declaration.declarations.filter(isAstNode) : [];
  for (const declarator of declarators) {
    const id = declarator.id;
    const name = isAstNode(id) && typeof id.name === "string" ? id.name : undefined;
    if (name === undefined) continue;
    if (exported) exports.add(name);
    const init = declarator.init;
    const isFunction = isAstNode(init) && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression");
    if (isFunction && isComponentName(name)) {
      components.push({ name, exported, line: positionAt(declarator.start).line });
    }
  }
}

/** React's own rule: a component is a capitalized binding. */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function staticAttributeNames(element: AstNode): string[] {
  const opening = element.openingElement;
  const attributes = isAstNode(opening) && Array.isArray(opening.attributes) ? opening.attributes.filter(isAstNode) : [];
  const names: string[] = [];
  for (const attribute of attributes) {
    if (attribute.type !== "JSXAttribute") continue;
    const name = isAstNode(attribute.name) ? memberPath(attribute.name) : undefined;
    const value = attribute.value;
    const isStatic = value === null || (isAstNode(value) && value.type === "Literal");
    if (name !== undefined && isStatic) names.push(name);
  }
  return names.sort();
}
