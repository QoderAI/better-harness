import type { DebuggerDiff } from "./session-debugger-model.js";

export type StudioCodeLanguage =
  | "batch"
  | "c"
  | "cpp"
  | "csharp"
  | "css"
  | "dockerfile"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "jsx"
  | "json"
  | "jsonc"
  | "kotlin"
  | "make"
  | "markdown"
  | "mermaid"
  | "mdx"
  | "php"
  | "powershell"
  | "python"
  | "ruby"
  | "rust"
  | "scss"
  | "shellscript"
  | "sql"
  | "svelte"
  | "swift"
  | "toml"
  | "tsx"
  | "typescript"
  | "vue"
  | "xml"
  | "yaml";

/** Infer only the bounded language set the Studio can load on demand. */
export function studioCodeLanguage(sourceHint: string): StudioCodeLanguage | undefined {
  const normalized = sourceHint.trim().toLowerCase();
  const name = normalized.split(/[\\/]/).at(-1) ?? normalized;
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  if (name === "makefile" || name === "gnumakefile") return "make";
  const extension = name.split(".").at(-1) ?? "";
  return ({
    bash: "shellscript",
    bat: "batch",
    c: "c",
    cc: "cpp",
    cmd: "batch",
    cjs: "javascript",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    cxx: "cpp",
    go: "go",
    h: "c",
    hpp: "cpp",
    hxx: "cpp",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    json5: "jsonc",
    jsonc: "jsonc",
    jsonl: "json",
    jsx: "jsx",
    kt: "kotlin",
    kts: "kotlin",
    md: "markdown",
    markdown: "markdown",
    mdx: "mdx",
    mermaid: "mermaid",
    mmd: "mermaid",
    mjs: "javascript",
    php: "php",
    ps1: "powershell",
    psm1: "powershell",
    py: "python",
    pyw: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "shellscript",
    sql: "sql",
    svelte: "svelte",
    svg: "xml",
    swift: "swift",
    toml: "toml",
    ts: "typescript",
    tsx: "tsx",
    vue: "vue",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "shellscript",
  } as const)[extension];
}

/** Build one exact, bounded Git patch for the dedicated Diff renderer. */
export function buildDebuggerPatch(diff: DebuggerDiff): string {
  const path = normalizePatchPath(diff.path);
  const oldCount = diff.before.length;
  const newCount = diff.after.length;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${diff.beforeStart},${oldCount} +${diff.afterStart},${newCount} @@`,
    ...diff.before.map((line) => `-${line}`),
    ...diff.after.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export function normalizePatchPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}
