import {
  AGENT_REACT_PROFILE_VERSION,
  type Diagnostic,
  type ProfileDiagnosticCode,
} from "../contracts/index.js";
import { type AstNode, createPositionIndex, isAstNode, memberPath, walk } from "./ast.js";

/**
 * The AgentReact language Profile.
 *
 * This is a Semantic Firewall, not the security authority. It exists so an agent
 * gets a fast, precise refusal at compile time instead of a mysterious runtime
 * failure — and so the Host has one place that answers "is this still React
 * artifact code". A bundle that defeats every rule below still cannot perform a
 * side effect: `ActionGateway` re-validates each call against the live grant.
 */

export { AGENT_REACT_PROFILE_VERSION };

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "dns",
  "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path",
  "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder",
  "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

const FORBIDDEN_CALLEES: ReadonlyMap<string, ProfileDiagnosticCode> = new Map([
  ["require", "profile/commonjs"],
  ["eval", "profile/dynamic-eval"],
  ["fetch", "profile/network"],
  ["globalThis.fetch", "profile/network"],
  ["window.fetch", "profile/network"],
  ["navigator.sendBeacon", "profile/network"],
  ["createRoot", "profile/react-dom-root"],
  ["hydrateRoot", "profile/react-dom-root"],
  ["ReactDOM.render", "profile/react-dom-root"],
  ["ReactDOM.createRoot", "profile/react-dom-root"],
  ["ReactDOM.hydrate", "profile/react-dom-root"],
]);

const FORBIDDEN_CONSTRUCTORS: ReadonlyMap<string, ProfileDiagnosticCode> = new Map([
  ["Function", "profile/dynamic-eval"],
  ["Worker", "profile/worker"],
  ["SharedWorker", "profile/worker"],
  ["XMLHttpRequest", "profile/network"],
  ["WebSocket", "profile/network"],
  ["EventSource", "profile/network"],
]);

const FORBIDDEN_MEMBERS: ReadonlyMap<string, ProfileDiagnosticCode> = new Map([
  ["module.exports", "profile/commonjs"],
  ["navigator.serviceWorker", "profile/worker"],
  ["globalThis.Worker", "profile/worker"],
]);

const REACT_CLASS_BASES = new Set([
  "React.Component", "React.PureComponent", "Component", "PureComponent",
]);

/**
 * A top-level statement that only declares something cannot run at import time.
 * Anything else can, so it is refused rather than budgeted: an unbounded "some
 * side effects allowed" rule has no test that distinguishes pass from fail.
 */
const DECLARATION_STATEMENTS = new Set([
  "ImportDeclaration", "ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration",
  "FunctionDeclaration", "ClassDeclaration", "VariableDeclaration", "EmptyStatement",
  "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration", "TSModuleDeclaration",
  "TSImportEqualsDeclaration", "TSDeclareFunction",
]);

export interface ProfileValidationInput {
  readonly modulePath: string;
  readonly text: string;
  readonly program: unknown;
  readonly allowedPackages: readonly string[];
}

export function validateAgentReactProfile(input: ProfileValidationInput): readonly Diagnostic[] {
  const positionAt = createPositionIndex(input.text);
  const allowed = new Set(input.allowedPackages);
  const diagnostics: Diagnostic[] = [];
  const report = (code: ProfileDiagnosticCode, message: string, offset: number): void => {
    const { line, column } = positionAt(offset);
    diagnostics.push({ level: "error", code, message, module: input.modulePath, line, column });
  };

  validateImports(input, allowed, report);
  validateTopLevel(input, report);
  validateExpressions(input, report);
  return diagnostics;
}

type Report = (code: ProfileDiagnosticCode, message: string, offset: number) => void;

function validateImports(input: ProfileValidationInput, allowed: Set<string>, report: Report): void {
  walk(input.program, (node) => {
    if (node.type === "ImportExpression") {
      report("profile/dynamic-import", "Dynamic `import()` is not available to an Artifact View.", node.start);
      return;
    }
    if (node.type !== "ImportDeclaration" && node.type !== "ExportNamedDeclaration" && node.type !== "ExportAllDeclaration") {
      return;
    }
    const source = node.source;
    if (!isAstNode(source) || typeof source.value !== "string") return;
    const specifier = source.value;
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) return;
    const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
    if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare)) {
      report("profile/node-builtin", `Node built-in '${specifier}' is not available in the browser Artifact runtime.`, source.start);
      return;
    }
    if (!allowed.has(specifier)) {
      report("profile/package-not-allowed", `Package import '${specifier}' is not in the AgentReact allowlist.`, source.start);
    }
  });
}

function validateTopLevel(input: ProfileValidationInput, report: Report): void {
  const program = input.program;
  const body = isAstNode(program) && Array.isArray(program.body) ? program.body.filter(isAstNode) : [];
  for (const statement of body) {
    if (DECLARATION_STATEMENTS.has(statement.type)) continue;
    if (statement.type === "ExpressionStatement" && isDirective(statement)) continue;
    report(
      "profile/top-level-effect",
      `Top-level '${statement.type}' runs at import time; move it inside a component or an Action handler.`,
      statement.start,
    );
  }
}

function isDirective(statement: AstNode): boolean {
  if (typeof statement.directive === "string") return true;
  const expression = statement.expression;
  return isAstNode(expression) && expression.type === "Literal" && typeof expression.value === "string";
}

function validateExpressions(input: ProfileValidationInput, report: Report): void {
  walk(input.program, (node) => {
    if (node.type === "CallExpression") {
      const callee = memberPath(node.callee);
      const code = callee === undefined ? undefined : FORBIDDEN_CALLEES.get(callee);
      if (code !== undefined) report(code, `Calling '${callee}' is not available to an Artifact View.`, node.start);
      return;
    }
    if (node.type === "NewExpression") {
      const callee = memberPath(node.callee);
      const code = callee === undefined ? undefined : FORBIDDEN_CONSTRUCTORS.get(callee);
      if (code !== undefined) report(code, `Constructing '${callee}' is not available to an Artifact View.`, node.start);
      return;
    }
    if (node.type === "MemberExpression") {
      const path = memberPath(node);
      const code = path === undefined ? undefined : FORBIDDEN_MEMBERS.get(path);
      if (code !== undefined) report(code, `Accessing '${path}' is not available to an Artifact View.`, node.start);
      // `exports.foo = ...` is CommonJS even though `exports` alone is not.
      if (memberPath(node.object) === "exports") {
        report("profile/commonjs", "CommonJS `exports` assignment is not available; use ESM exports.", node.start);
      }
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const base = memberPath(node.superClass);
      if (base !== undefined && REACT_CLASS_BASES.has(base)) {
        report("profile/class-component", "Artifact Views must use React function components.", node.start);
      }
    }
  });
}
