import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { matchesAnyPattern, toPosix, unique } from "./utils.mjs";

export const CONFIG_PATH = ".better-harness/blast-radius.json";

export const DEFAULT_CONFIG = Object.freeze({
  thresholds: {
    changedFiles: { warn: 8, high: 16, critical: 30 },
    changedLines: { warn: 250, high: 700, critical: 1500 },
    changedSymbols: { warn: 6, high: 14, critical: 30 },
    callerCount: { warn: 6, high: 20, critical: 50 },
    impactedSymbols: { warn: 10, high: 30, critical: 80 },
    impactedFiles: { warn: 4, high: 10, critical: 20 },
    reviewScore: 45,
  },
  limits: {
    maxSourceFiles: 800,
    maxFileBytes: 512_000,
    maxImpactSymbols: 120,
    blastRadiusDepth: 2,
  },
  ignore: [
    ".git/**",
    ".better-harness/state/**",
    ".qoder/better-harness/**",
    "AI_READINESS_FINDINGS.json",
    "REPORT_SUMMARY.txt",
    "report.canvas.tsx",
    "test-report.canvas.tsx",
    "node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".next/**",
    "out/**",
  ],
  core: [
    {
      name: "security/auth",
      paths: [
        "**/auth/**",
        "**/security/**",
        "**/permission/**",
        "**/permissions/**",
        "**/crypto/**",
      ],
      symbols: [
        "*auth*",
        "*Auth*",
        "authorize*",
        "validate*",
        "verify*",
        "encrypt*",
        "decrypt*",
        "sign*",
        "token*",
        "session*",
      ],
      risk: "medium",
    },
    {
      name: "delivery/infra",
      paths: ["**/.github/workflows/**", "**/deploy/**", "**/infra/**"],
      risk: "medium",
    },
  ],
});

export const LANGUAGE_BY_EXTENSION = new Map([
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".tsx", "tsx"],
  [".go", "go"],
  [".java", "java"],
  [".py", "python"],
  [".rb", "ruby"],
  [".rs", "rust"],
  [".cs", "csharp"],
  [".cpp", "cpp"],
  [".cc", "cpp"],
  [".cxx", "cpp"],
  [".c", "c"],
  [".h", "c"],
  [".hpp", "cpp"],
  [".hh", "cpp"],
  [".sh", "bash"],
  [".bash", "bash"],
  [".zsh", "bash"],
  [".php", "php"],
]);

export const LANGUAGE_WASM = {
  bash: "tree-sitter-bash.wasm",
  c: "tree-sitter-cpp.wasm",
  cpp: "tree-sitter-cpp.wasm",
  csharp: "tree-sitter-c-sharp.wasm",
  go: "tree-sitter-go.wasm",
  java: "tree-sitter-java.wasm",
  javascript: "tree-sitter-javascript.wasm",
  php: "tree-sitter-php.wasm",
  python: "tree-sitter-python.wasm",
  ruby: "tree-sitter-ruby.wasm",
  rust: "tree-sitter-rust.wasm",
  tsx: "tree-sitter-tsx.wasm",
  typescript: "tree-sitter-typescript.wasm",
};

export const TEST_PATH_RE = /(^|\/)(__tests__|tests?|specs?)(\/|$)|[._-](test|spec)\.[^.]+$/i;
export const SECURITY_REMOVAL_RE =
  /\b(auth|authorize|permission|role|admin|owner|token|session|validate|verify|encrypt|decrypt|sign|sanitize|escape|csrf|xss|sql|limit|allow|deny)\b|throw\s+new|return\s+false|assert|require\(/i;

function normalizeThreshold(value, defaults) {
  if (typeof value === "number") {
    return {
      warn: value,
      high: value * 2,
      critical: value * 4,
    };
  }

  if (value && typeof value === "object") {
    return {
      ...defaults,
      ...value,
    };
  }

  return { ...defaults };
}

function normalizeCoreRule(rule) {
  if (typeof rule === "string") {
    return {
      name: rule,
      paths: [rule],
      symbols: [],
      risk: "medium",
    };
  }

  return {
    name: rule.name ?? "core code",
    paths: Array.isArray(rule.paths) ? rule.paths : [],
    symbols: Array.isArray(rule.symbols) ? rule.symbols : [],
    risk: rule.risk ?? "medium",
    message: rule.message ?? "",
  };
}

function normalizeConfig(userConfig = {}) {
  const defaultThresholds = DEFAULT_CONFIG.thresholds;
  const thresholds = {
    changedFiles: normalizeThreshold(
      userConfig.thresholds?.changedFiles,
      defaultThresholds.changedFiles,
    ),
    changedLines: normalizeThreshold(
      userConfig.thresholds?.changedLines,
      defaultThresholds.changedLines,
    ),
    changedSymbols: normalizeThreshold(
      userConfig.thresholds?.changedSymbols,
      defaultThresholds.changedSymbols,
    ),
    callerCount: normalizeThreshold(
      userConfig.thresholds?.callerCount,
      defaultThresholds.callerCount,
    ),
    impactedSymbols: normalizeThreshold(
      userConfig.thresholds?.impactedSymbols,
      defaultThresholds.impactedSymbols,
    ),
    impactedFiles: normalizeThreshold(
      userConfig.thresholds?.impactedFiles,
      defaultThresholds.impactedFiles,
    ),
    reviewScore: userConfig.thresholds?.reviewScore ?? defaultThresholds.reviewScore,
  };

  return {
    thresholds,
    limits: {
      ...DEFAULT_CONFIG.limits,
      ...(userConfig.limits ?? {}),
    },
    ignore: unique([...DEFAULT_CONFIG.ignore, ...(userConfig.ignore ?? [])]),
    core: (userConfig.core ?? DEFAULT_CONFIG.core).map(normalizeCoreRule),
    baseRef: userConfig.baseRef ?? "HEAD",
  };
}

export async function loadConfig(repoRoot, configPath = undefined) {
  const explicit = configPath ?? process.env.BETTER_HARNESS_BLAST_RADIUS_CONFIG;
  const candidates = explicit
    ? [path.isAbsolute(explicit) ? explicit : path.join(repoRoot, explicit)]
    : [path.join(repoRoot, CONFIG_PATH)];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const raw = await readFile(candidate, "utf8");
    return normalizeConfig(JSON.parse(raw));
  }

  return normalizeConfig();
}

export function languageFor(filePath) {
  return LANGUAGE_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
}

export function isSupportedSource(filePath) {
  return Boolean(languageFor(filePath));
}

export function isIgnored(filePath, config) {
  const normalized = toPosix(filePath);
  return matchesAnyPattern(normalized, config.ignore);
}
