import { DEFAULT_OXC_COMPILE_LIMITS, type OxcCompileLimits } from "./compiler-policy.js";
import {
  AGENT_REACT_PROFILE_VERSION,
  type CompileModuleInput,
  type CompileModuleOutput,
  type Diagnostic,
  type OxcCompilerPort,
} from "../contracts/index.js";
import { extractArtifactViewDeclaration } from "./abi.js";
import { createPositionIndex } from "./ast.js";
import { validateAgentReactProfile } from "./profile.js";
import { buildSemanticIndex } from "./semantic-index.js";

/**
 * The Oxc Semantic Kernel, wired as the POC's `OxcCompilerPort`.
 *
 * Order matters and is not an implementation detail: the Profile and the ABI run
 * on the *parsed source*, before any code is emitted, so a refused module never
 * produces a bundle for the linker to pick up. A validator that ran after
 * codegen would be advisory rather than a gate.
 */
export interface NativeOxcError { readonly message: string; readonly labels?: readonly { start: number }[] }
export interface NativeOxcBackend {
  parse(filename: string, source: string): Promise<{ program: unknown; errors: readonly NativeOxcError[] }>;
  transform(filename: string, source: string): Promise<{ code: string; map?: unknown; errors?: readonly NativeOxcError[] }>;
}

export function createSemanticOxcCompiler(backend: NativeOxcBackend, compilerVersion: string, limits: Partial<OxcCompileLimits> = {}): OxcCompilerPort {
  const resolved: Readonly<OxcCompileLimits> = Object.freeze({ ...DEFAULT_OXC_COMPILE_LIMITS, ...limits });
  return {
    compilerVersion,
    profileVersion: AGENT_REACT_PROFILE_VERSION,
    policyFingerprint: JSON.stringify(resolved),
    async compileModule(input: CompileModuleInput): Promise<CompileModuleOutput> {
      return compileModule(backend, input, resolved);
    },
  };
}

async function compileModule(backend: NativeOxcBackend, input: CompileModuleInput, limits: Readonly<OxcCompileLimits>): Promise<CompileModuleOutput> {
  const { module, entry, allowedPackages } = input;
  const byteLength = utf8Length(module.text);
  if (byteLength > limits.maxModuleBytes) {
    return {
      module: module.path,
      diagnostics: [{
        level: "error",
        code: "limit/module-bytes",
        message: `Module is ${byteLength} bytes, over the ${limits.maxModuleBytes}-byte module limit.`,
        module: module.path,
      }],
    };
  }

  const filename = module.path;
  const parsed = await backend.parse(filename, module.text);
  const parseErrors = parseDiagnostics(module.path, module.text, parsed.errors);
  if (parseErrors.length > 0) return { module: module.path, diagnostics: parseErrors };

  const diagnostics: Diagnostic[] = [
    ...validateAgentReactProfile({
      modulePath: module.path,
      text: module.text,
      program: parsed.program,
      allowedPackages,
    }),
  ];

  let viewDeclaration: CompileModuleOutput["viewDeclaration"];
  if (entry) {
    const abi = extractArtifactViewDeclaration(module.path, module.text, parsed.program);
    diagnostics.push(...abi.diagnostics);
    viewDeclaration = abi.declaration;
  }

  const semanticIndex = buildSemanticIndex(module.path, module.text, parsed.program);
  if (diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    return { module: module.path, diagnostics, semanticIndex, ...(viewDeclaration === undefined ? {} : { viewDeclaration }) };
  }

  const transformed = await backend.transform(filename, module.text);
  const transformErrors = (transformed.errors ?? []).map((error): Diagnostic => ({
    level: "error",
    code: "syntax/parse-failed",
    message: error.message,
    module: module.path,
  }));
  if (transformErrors.length > 0) {
    return { module: module.path, diagnostics: [...diagnostics, ...transformErrors], semanticIndex };
  }
  if (utf8Length(transformed.code) > limits.maxOutputBytes) {
    return {
      module: module.path,
      diagnostics: [...diagnostics, {
        level: "error",
        code: "limit/output-bytes",
        message: `Emitted module is over the ${limits.maxOutputBytes}-byte output limit.`,
        module: module.path,
      }],
      semanticIndex,
    };
  }

  return {
    module: module.path,
    code: transformed.code,
    ...(transformed.map === undefined ? {} : { sourceMap: JSON.stringify(transformed.map) }),
    diagnostics,
    semanticIndex,
    ...(viewDeclaration === undefined ? {} : { viewDeclaration }),
  };
}

/**
 * Oxc writes the filename it is given into `_jsxFileName`, and the runtime hashes
 * that value into every node address. The Revision-relative path is therefore
 * passed verbatim — the same value the semantic index hashes — so addresses carry
 * no host filesystem layout and a build on Windows addresses the same nodes as a
 * build on Linux.
 */
function parseDiagnostics(
  modulePath: string,
  text: string,
  errors: readonly { message: string; labels?: readonly { start: number }[] }[],
): Diagnostic[] {
  if (errors.length === 0) return [];
  const positionAt = createPositionIndex(text);
  return errors.map((error): Diagnostic => {
    const offset = error.labels?.[0]?.start;
    const position = offset === undefined ? undefined : positionAt(offset);
    return {
      level: "error",
      code: "syntax/parse-failed",
      message: error.message,
      module: modulePath,
      ...(position === undefined ? {} : { line: position.line, column: position.column }),
    };
  });
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
