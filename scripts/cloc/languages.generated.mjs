import path from "node:path";

export const SYNTAX = Object.freeze({
  C_STYLE: "c-style",
  C_NESTED: "c-nested",
  HASH: "hash",
  HTML: "html",
  NO_COMMENT: "no-comment",
});

export const LANGUAGES = Object.freeze([
  {
    id: "javascript",
    name: "JavaScript",
    syntax: SYNTAX.C_STYLE,
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    aliases: ["js", "javascript", "jsx", "node"],
  },
  {
    id: "typescript",
    name: "TypeScript",
    syntax: SYNTAX.C_STYLE,
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    aliases: ["ts", "typescript", "tsx"],
  },
  {
    id: "java",
    name: "Java",
    syntax: SYNTAX.C_STYLE,
    extensions: [".java"],
    aliases: ["java"],
  },
  {
    id: "c",
    name: "C",
    syntax: SYNTAX.C_STYLE,
    extensions: [".c", ".h"],
    aliases: ["c"],
  },
  {
    id: "cpp",
    name: "C++",
    syntax: SYNTAX.C_STYLE,
    extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"],
    aliases: ["cpp", "c++", "cc", "cxx"],
  },
  {
    id: "csharp",
    name: "C#",
    syntax: SYNTAX.C_STYLE,
    extensions: [".cs"],
    aliases: ["cs", "csharp", "c#"],
  },
  {
    id: "go",
    name: "Go",
    syntax: SYNTAX.C_STYLE,
    extensions: [".go"],
    aliases: ["go", "golang"],
  },
  {
    id: "kotlin",
    name: "Kotlin",
    syntax: SYNTAX.C_STYLE,
    extensions: [".kt", ".kts"],
    aliases: ["kt", "kotlin", "kts"],
  },
  {
    id: "php",
    name: "PHP",
    syntax: SYNTAX.C_STYLE,
    extensions: [".php"],
    aliases: ["php"],
  },
  {
    id: "css",
    name: "CSS",
    syntax: SYNTAX.C_STYLE,
    extensions: [".css", ".scss", ".sass", ".less"],
    aliases: ["css", "scss", "sass", "less"],
  },
  {
    id: "rust",
    name: "Rust",
    syntax: SYNTAX.C_NESTED,
    extensions: [".rs"],
    aliases: ["rs", "rust"],
  },
  {
    id: "swift",
    name: "Swift",
    syntax: SYNTAX.C_NESTED,
    extensions: [".swift"],
    aliases: ["swift"],
  },
  {
    id: "python",
    name: "Python",
    syntax: SYNTAX.HASH,
    extensions: [".py", ".pyw"],
    aliases: ["py", "python", "python3"],
  },
  {
    id: "ruby",
    name: "Ruby",
    syntax: SYNTAX.HASH,
    extensions: [".rb", ".rake"],
    aliases: ["rb", "ruby"],
  },
  {
    id: "shell",
    name: "Shell",
    syntax: SYNTAX.HASH,
    extensions: [".sh", ".bash", ".zsh", ".fish", ".ksh"],
    filenames: ["Dockerfile"],
    aliases: ["sh", "bash", "zsh", "shell"],
  },
  {
    id: "yaml",
    name: "YAML",
    syntax: SYNTAX.HASH,
    extensions: [".yml", ".yaml"],
    aliases: ["yaml", "yml"],
  },
  {
    id: "toml",
    name: "TOML",
    syntax: SYNTAX.HASH,
    extensions: [".toml"],
    aliases: ["toml"],
  },
  {
    id: "html",
    name: "HTML",
    syntax: SYNTAX.HTML,
    extensions: [".html", ".htm"],
    aliases: ["html", "htm"],
  },
  {
    id: "xml",
    name: "XML",
    syntax: SYNTAX.HTML,
    extensions: [".xml", ".xhtml"],
    aliases: ["xml", "xhtml"],
  },
  {
    id: "svg",
    name: "SVG",
    syntax: SYNTAX.HTML,
    extensions: [".svg"],
    aliases: ["svg"],
  },
  {
    id: "vue-template",
    name: "Vue Template",
    syntax: SYNTAX.HTML,
    extensions: [],
    aliases: ["vue-template"],
  },
  {
    id: "svelte-template",
    name: "Svelte Template",
    syntax: SYNTAX.HTML,
    extensions: [],
    aliases: ["svelte-template"],
  },
  {
    id: "astro-template",
    name: "Astro Template",
    syntax: SYNTAX.HTML,
    extensions: [],
    aliases: ["astro-template"],
  },
  {
    id: "json",
    name: "JSON",
    syntax: SYNTAX.NO_COMMENT,
    extensions: [".json", ".jsonl", ".webmanifest"],
    aliases: ["json", "jsonl"],
  },
  {
    id: "markdown",
    name: "Markdown",
    syntax: SYNTAX.NO_COMMENT,
    extensions: [".md", ".mdx", ".markdown"],
    aliases: ["md", "mdx", "markdown"],
  },
  {
    id: "text",
    name: "Text",
    syntax: SYNTAX.NO_COMMENT,
    extensions: [".txt"],
    aliases: ["txt", "text", "plain"],
  },
  {
    id: "jupyter-code",
    name: "Jupyter Code",
    syntax: SYNTAX.NO_COMMENT,
    extensions: [],
    aliases: ["jupyter-code"],
  },
]);

export const LANGUAGE_BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));
export const EXTENSION_TO_LANGUAGE_ID = new Map();
export const FILENAME_TO_LANGUAGE_ID = new Map();
export const ALIAS_TO_LANGUAGE_ID = new Map();

for (const language of LANGUAGES) {
  for (const extension of language.extensions ?? []) {
    EXTENSION_TO_LANGUAGE_ID.set(extension, language.id);
  }
  for (const fileName of language.filenames ?? []) {
    FILENAME_TO_LANGUAGE_ID.set(fileName.toLowerCase(), language.id);
  }
  for (const alias of language.aliases ?? []) {
    ALIAS_TO_LANGUAGE_ID.set(alias.toLowerCase(), language.id);
  }
  ALIAS_TO_LANGUAGE_ID.set(language.name.toLowerCase(), language.id);
  ALIAS_TO_LANGUAGE_ID.set(language.id.toLowerCase(), language.id);
}

export function toPosix(filePath) {
  return String(filePath ?? "").replaceAll("\\", "/").replaceAll(path.sep, "/");
}

export function languageForPath(filePath) {
  const normalized = toPosix(filePath);
  const base = path.posix.basename(normalized).toLowerCase();
  const extension = path.posix.extname(normalized).toLowerCase();
  return FILENAME_TO_LANGUAGE_ID.get(base) ?? EXTENSION_TO_LANGUAGE_ID.get(extension) ?? null;
}

export function languageForFence(info = "") {
  const token = String(info)
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^\{?\.?/, "")
    .replace(/\}?$/, "")
    .toLowerCase();
  return token ? ALIAS_TO_LANGUAGE_ID.get(token) ?? null : null;
}

export function languageForNameOrId(nameOrId) {
  const normalized = String(nameOrId ?? "").trim().toLowerCase();
  return ALIAS_TO_LANGUAGE_ID.get(normalized) ?? null;
}

export function languageName(languageId) {
  return LANGUAGE_BY_ID.get(languageId)?.name ?? languageId;
}

export function syntaxForLanguage(languageId) {
  return LANGUAGE_BY_ID.get(languageId)?.syntax ?? null;
}

export function componentTemplateLanguageId(filePath) {
  const extension = path.posix.extname(toPosix(filePath)).toLowerCase();
  if (extension === ".svelte") {
    return "svelte-template";
  }
  if (extension === ".astro") {
    return "astro-template";
  }
  return "vue-template";
}

export function isComponentFile(filePath) {
  const extension = path.posix.extname(toPosix(filePath)).toLowerCase();
  return extension === ".vue" || extension === ".svelte" || extension === ".astro";
}

export function isNotebookFile(filePath) {
  return path.posix.extname(toPosix(filePath)).toLowerCase() === ".ipynb";
}

export function isMarkdownFile(filePath) {
  const extension = path.posix.extname(toPosix(filePath)).toLowerCase();
  return extension === ".md" || extension === ".mdx" || extension === ".markdown";
}
