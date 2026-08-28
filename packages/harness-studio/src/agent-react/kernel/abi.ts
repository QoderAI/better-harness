import {
  AGENT_REACT_RUNTIME_PACKAGE,
  type ArtifactStateDeclaration,
  type ArtifactViewDeclaration,
  type Diagnostic,
} from "../contracts/index.js";
import {
  type AstNode,
  createPositionIndex,
  integerLiteral,
  isAstNode,
  objectProperties,
  propertyName,
  stringLiteral,
} from "./ast.js";

export const DEFINE_ARTIFACT_VIEW = "defineArtifactView";

export interface AbiExtraction {
  readonly declaration?: ArtifactViewDeclaration;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Reads the Artifact View ABI out of the entry module.
 *
 * Everything the Host later uses to negotiate permission must be a static
 * literal. A capability inferred from what the code *does* would grant exactly
 * what the author wrote, which is the opposite of a permission model, so the
 * validator refuses any shape it cannot read without executing.
 */
export function extractArtifactViewDeclaration(
  modulePath: string,
  text: string,
  program: unknown,
): AbiExtraction {
  const positionAt = createPositionIndex(text);
  const diagnostics: Diagnostic[] = [];
  const fail = (code: "abi/missing-view" | "abi/not-static" | "abi/duplicate-state-path", message: string, offset: number): AbiExtraction => {
    const { line, column } = positionAt(offset);
    diagnostics.push({ level: "error", code, message, module: modulePath, line, column });
    return { diagnostics };
  };

  const body = isAstNode(program) && Array.isArray(program.body) ? program.body.filter(isAstNode) : [];
  const runtimeLocalNames = collectRuntimeImportNames(body);
  const defaultExport = body.find((statement) => statement.type === "ExportDefaultDeclaration");
  if (defaultExport === undefined) {
    return fail("abi/missing-view", `Entry module must default-export ${DEFINE_ARTIFACT_VIEW}(...).`, 0);
  }

  const call = defaultExport.declaration;
  if (!isAstNode(call) || call.type !== "CallExpression") {
    return fail("abi/missing-view", `Default export must be a direct ${DEFINE_ARTIFACT_VIEW}(...) call.`, defaultExport.start);
  }
  const callee = call.callee;
  const calleeName = isAstNode(callee) && callee.type === "Identifier" && typeof callee.name === "string" ? callee.name : undefined;
  if (calleeName === undefined || !runtimeLocalNames.has(calleeName)) {
    return fail(
      "abi/missing-view",
      `Default export must call ${DEFINE_ARTIFACT_VIEW} imported from '${AGENT_REACT_RUNTIME_PACKAGE}'.`,
      call.start,
    );
  }

  const args = Array.isArray(call.arguments) ? call.arguments.filter(isAstNode) : [];
  const definition = args[0];
  if (args.length !== 1 || definition === undefined || definition.type !== "ObjectExpression") {
    return fail("abi/not-static", `${DEFINE_ARTIFACT_VIEW} takes exactly one object literal.`, call.start);
  }

  const fields = new Map<string, AstNode>();
  for (const property of objectProperties(definition)) {
    if (property.type !== "Property" || property.kind !== "init" || property.shorthand === true) {
      return fail("abi/not-static", "Artifact View definition fields must be plain `key: value` literals.", property.start);
    }
    const name = propertyName(property);
    if (name === undefined) {
      return fail("abi/not-static", "Artifact View definition keys must be static.", property.start);
    }
    if (fields.has(name)) {
      return fail("abi/not-static", `Artifact View definition declares '${name}' twice.`, property.start);
    }
    fields.set(name, property);
  }

  const idProperty = fields.get("id");
  const id = idProperty === undefined ? undefined : stringLiteral(idProperty.value);
  if (idProperty === undefined || id === undefined || id.length === 0) {
    return fail("abi/not-static", "Artifact View `id` must be a non-empty string literal.", idProperty?.start ?? definition.start);
  }

  const stateProperty = fields.get("state");
  const state: ArtifactStateDeclaration[] = [];
  if (stateProperty !== undefined) {
    const stateObject = stateProperty.value;
    if (!isAstNode(stateObject) || stateObject.type !== "ObjectExpression") {
      return fail("abi/not-static", "Artifact View `state` must be an object literal.", stateProperty.start);
    }
    const seen = new Set<string>();
    for (const entry of objectProperties(stateObject)) {
      const path = entry.type === "Property"
        && entry.kind === "init"
        && entry.computed !== true
        && entry.shorthand !== true
        ? stringLiteral(entry.key)
        : undefined;
      if (path === undefined || !path.startsWith("/")) {
        return fail("abi/not-static", "Artifact View state keys must be string literals rooted at '/'.", entry.start);
      }
      if (seen.has(path)) {
        return fail("abi/duplicate-state-path", `Artifact View declares state path '${path}' twice.`, entry.start);
      }
      seen.add(path);
      const value = entry.value;
      if (!isAstNode(value) || value.type !== "ObjectExpression") {
        return fail("abi/not-static", `State path '${path}' must use a literal schema descriptor.`, entry.start);
      }
      const descriptorFields = new Map<string, AstNode>();
      for (const field of objectProperties(value)) {
        const name = field.type === "Property"
          && field.kind === "init"
          && field.computed !== true
          && field.shorthand !== true
          ? propertyName(field)
          : undefined;
        if ((name !== "schema" && name !== "version") || descriptorFields.has(name)) {
          return fail(
            "abi/not-static",
            `State path '${path}' must contain exactly literal \`schema\` and \`version\` fields.`,
            field.start,
          );
        }
        descriptorFields.set(name, field);
      }
      if (descriptorFields.size !== 2) {
        return fail(
          "abi/not-static",
          `State path '${path}' must contain exactly literal \`schema\` and \`version\` fields.`,
          entry.start,
        );
      }
      const schemaProperty = descriptorFields.get("schema");
      const versionProperty = descriptorFields.get("version");
      const schema = schemaProperty === undefined ? undefined : stringLiteral(schemaProperty.value);
      const version = versionProperty === undefined ? undefined : integerLiteral(versionProperty.value);
      if (schema === undefined || version === undefined || version < 1) {
        return fail(
          "abi/not-static",
          `State path '${path}' must declare a literal \`schema\` string and a positive integer \`version\`.`,
          entry.start,
        );
      }
      state.push({ path, schema, version });
    }
  }

  const capabilitiesProperty = fields.get("capabilities");
  const capabilities = new Set<string>();
  if (capabilitiesProperty !== undefined) {
    const array = capabilitiesProperty.value;
    if (!isAstNode(array) || array.type !== "ArrayExpression" || !Array.isArray(array.elements)) {
      return fail("abi/not-static", "Artifact View `capabilities` must be an array literal.", capabilitiesProperty.start);
    }
    for (const element of array.elements) {
      const capability = stringLiteral(element);
      if (capability === undefined || capability.length === 0) {
        return fail(
          "abi/not-static",
          "Artifact View capability requests must be non-empty string literals.",
          isAstNode(element) ? element.start : capabilitiesProperty.start,
        );
      }
      capabilities.add(capability);
    }
  }

  const componentProperty = fields.get("component");
  const componentName = componentProperty === undefined
    ? undefined
    : isAstNode(componentProperty.value) && componentProperty.value.type === "Identifier" && typeof componentProperty.value.name === "string"
      ? componentProperty.value.name
      : undefined;
  if (componentProperty === undefined || componentName === undefined) {
    return fail(
      "abi/not-static",
      "Artifact View `component` must name a binding in this module.",
      componentProperty?.start ?? definition.start,
    );
  }
  if (!isComponentBinding(body, componentName)) {
    return fail(
      "abi/not-static",
      `Artifact View component '${componentName}' must be a local function or an import from this Revision.`,
      componentProperty.start,
    );
  }

  return {
    declaration: Object.freeze({
      id,
      state: Object.freeze([...state].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))),
      capabilities: Object.freeze([...capabilities].sort()),
      componentName,
      module: modulePath,
    }),
    diagnostics,
  };
}

function collectRuntimeImportNames(body: readonly AstNode[]): Set<string> {
  const names = new Set<string>();
  for (const statement of body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (stringLiteral(statement.source) !== AGENT_REACT_RUNTIME_PACKAGE) continue;
    const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers.filter(isAstNode) : [];
    for (const specifier of specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported;
      const local = specifier.local;
      const importedName = isAstNode(imported) && typeof imported.name === "string" ? imported.name : undefined;
      const localName = isAstNode(local) && typeof local.name === "string" ? local.name : undefined;
      if (importedName === DEFINE_ARTIFACT_VIEW && localName !== undefined) names.add(localName);
    }
  }
  return names;
}

/** A component is a local function or a named/default import from this Revision. */
function isComponentBinding(body: readonly AstNode[], name: string): boolean {
  for (const statement of body) {
    const declaration = statement.type === "ExportNamedDeclaration" && isAstNode(statement.declaration)
      ? statement.declaration
      : statement;
    if (declaration.type === "FunctionDeclaration") {
      const id = declaration.id;
      if (isAstNode(id) && id.name === name) return true;
    }
    if (declaration.type === "VariableDeclaration") {
      const declarators = Array.isArray(declaration.declarations) ? declaration.declarations.filter(isAstNode) : [];
      for (const declarator of declarators) {
        const id = declarator.id;
        if (!isAstNode(id) || id.name !== name) continue;
        const init = declarator.init;
        if (isAstNode(init) && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")) return true;
      }
    }
    if (declaration.type === "ImportDeclaration") {
      const source = stringLiteral(declaration.source);
      if (source === undefined || (!source.startsWith(".") && !source.startsWith("/"))) continue;
      const specifiers = Array.isArray(declaration.specifiers) ? declaration.specifiers.filter(isAstNode) : [];
      for (const specifier of specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") continue;
        const local = specifier.local;
        if (isAstNode(local) && local.name === name) return true;
      }
    }
  }
  return false;
}
