/**
 * Minimal AST access for the Oxc Semantic Kernel.
 *
 * `oxc-parser` emits an ESTree-compatible tree, so a structural walk is enough
 * for the Profile, ABI, and index passes. This module is the only place allowed
 * to know that shape: everything above it consumes `OxcCompilerPort` output.
 */

export interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

export function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object"
    && value !== null
    && typeof (value as { type?: unknown }).type === "string"
    && typeof (value as { start?: unknown }).start === "number";
}

/** Depth-first walk. Returning `false` from `visit` skips the node's children. */
export function walk(
  root: unknown,
  visit: (node: AstNode, ancestors: readonly AstNode[]) => boolean | void,
  ancestors: AstNode[] = [],
): void {
  if (Array.isArray(root)) {
    for (const item of root) walk(item, visit, ancestors);
    return;
  }
  if (typeof root !== "object" || root === null) return;
  if (!isAstNode(root)) {
    for (const value of Object.values(root)) walk(value, visit, ancestors);
    return;
  }
  if (visit(root, ancestors) === false) return;
  ancestors.push(root);
  for (const [key, value] of Object.entries(root)) {
    if (key === "type" || key === "start" || key === "end") continue;
    walk(value, visit, ancestors);
  }
  ancestors.pop();
}

export interface Position {
  readonly line: number;
  readonly column: number;
}

/**
 * Offset → 1-based line/column, matching what the automatic development JSX
 * transform writes into `__source`. The runtime derives node addresses from
 * `__source`, so any drift here would silently split one JSX element into two
 * different identities.
 */
export function createPositionIndex(text: string): (offset: number) => Position {
  const lineStarts: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  return (offset: number): Position => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low]! + 1 };
  };
}

export function propertyName(property: AstNode): string | undefined {
  if (property.computed === true) return undefined;
  const key = property.key;
  if (!isAstNode(key)) return undefined;
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

export function objectProperties(node: unknown): readonly AstNode[] {
  if (!isAstNode(node) || node.type !== "ObjectExpression") return [];
  const properties = node.properties;
  return Array.isArray(properties) ? properties.filter(isAstNode) : [];
}

export function stringLiteral(node: unknown): string | undefined {
  return isAstNode(node) && node.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

export function integerLiteral(node: unknown): number | undefined {
  return isAstNode(node) && node.type === "Literal" && typeof node.value === "number" && Number.isSafeInteger(node.value)
    ? node.value
    : undefined;
}

/** Flattens `a`, `a.b`, and `React.Component` into a dotted string. */
export function memberPath(node: unknown): string | undefined {
  if (!isAstNode(node)) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "JSXIdentifier" && typeof node.name === "string") return node.name;
  if (node.type === "MemberExpression" || node.type === "JSXMemberExpression") {
    if (node.computed === true) return undefined;
    const object = memberPath(node.object);
    const property = memberPath(node.property);
    return object === undefined || property === undefined ? undefined : `${object}.${property}`;
  }
  return undefined;
}

export function jsxElementName(element: AstNode): string | undefined {
  const opening = element.openingElement;
  return isAstNode(opening) ? memberPath(opening.name) : undefined;
}

/** React treats a lowercase, dot-free name as an intrinsic DOM element. */
export function isIntrinsicElementName(name: string): boolean {
  return !name.includes(".") && name[0] === name[0]?.toLowerCase() && /^[a-z]/.test(name);
}
