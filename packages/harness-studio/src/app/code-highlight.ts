import { createHighlighterCore, type HighlighterCore, type LanguageInput, type ThemeRegistrationRaw } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { studioCodeLanguage, type StudioCodeLanguage } from "./code-rendering-model.js";
import type { StudioTheme } from "./studio-theme.js";

export interface StudioCodeToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

const languageLoaders: Record<StudioCodeLanguage, () => Promise<{ default: LanguageInput }>> = {
  batch: () => import("@shikijs/langs/batch"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  make: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  mermaid: () => import("@shikijs/langs/mermaid"),
  mdx: () => import("@shikijs/langs/mdx"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

const studioLightTheme: ThemeRegistrationRaw = {
  name: "harness-studio-light",
  type: "light",
  settings: [],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#27334a",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#718096", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: "#0b7a55" } },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#8b5b13" } },
    { scope: ["keyword", "storage", "storage.type"], settings: { foreground: "#7541b2" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#125fb4" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#9a4a18" } },
    { scope: ["variable", "meta.object-literal.key", "support.variable.property"], settings: { foreground: "#27334a" } },
  ],
};

const studioDarkTheme: ThemeRegistrationRaw = {
  name: "harness-studio-dark",
  type: "dark",
  settings: [],
  colors: {
    "editor.background": "#101319",
    "editor.foreground": "#e8ecf3",
  },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#8c97a9", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: "#46d3a3" } },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#f0b667" } },
    { scope: ["keyword", "storage", "storage.type"], settings: { foreground: "#b99cff" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#7fb4ff" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#e6a85e" } },
    { scope: ["variable", "meta.object-literal.key", "support.variable.property"], settings: { foreground: "#e8ecf3" } },
  ],
};

let highlighterPromise: Promise<HighlighterCore> | undefined;
const languagePromises = new Map<StudioCodeLanguage, Promise<void>>();

/** Highlight code lazily; unknown or failed languages preserve a plain-text fallback. */
export async function highlightStudioCode(
  code: string,
  sourceHint: string,
  theme: StudioTheme = "light",
): Promise<readonly (readonly StudioCodeToken[])[] | undefined> {
  const language = studioCodeLanguage(sourceHint);
  if (language === undefined || code.length === 0) return undefined;
  try {
    const highlighter = await getHighlighter();
    await ensureLanguage(highlighter, language);
    return highlighter.codeToTokensBase(code, {
      lang: language,
      theme: theme === "dark" ? studioDarkTheme.name : studioLightTheme.name,
    })
      .map((line) => compactTokens(line));
  } catch {
    return undefined;
  }
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [studioLightTheme, studioDarkTheme],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

function ensureLanguage(highlighter: HighlighterCore, language: StudioCodeLanguage): Promise<void> {
  let pending = languagePromises.get(language);
  if (pending === undefined) {
    pending = languageLoaders[language]().then((module) => highlighter.loadLanguage(module.default));
    languagePromises.set(language, pending);
  }
  return pending;
}

function compactTokens(tokens: readonly StudioCodeToken[]): readonly StudioCodeToken[] {
  const compacted: StudioCodeToken[] = [];
  for (const token of tokens) {
    const previous = compacted.at(-1);
    if (previous !== undefined && previous.color === token.color && previous.fontStyle === token.fontStyle) {
      compacted[compacted.length - 1] = { ...previous, content: previous.content + token.content };
    } else {
      compacted.push({ content: token.content, color: token.color, fontStyle: token.fontStyle });
    }
  }
  return compacted;
}
