import {
  type BundledTheme,
  type HighlighterGeneric,
  type ThemedToken,
  createHighlighter,
} from "shiki";
import { harnessTextMateGrammar } from "./harness-grammar.js";

export { harnessTextMateGrammar };

export type HarnessHighlighter = HighlighterGeneric<"harness", BundledTheme>;

let highlighterPromise: Promise<HarnessHighlighter> | undefined;

const DEFAULT_THEME: BundledTheme = "github-dark";

/**
 * Lazily create (and cache) a Shiki highlighter with the Harness grammar
 * registered as the `harness` language.
 */
export function getHarnessHighlighter(): Promise<HarnessHighlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [DEFAULT_THEME],
    langs: [harnessTextMateGrammar],
  }) as unknown as Promise<HarnessHighlighter>;
  return highlighterPromise;
}

/** Render Harness DSL source to themed HTML. */
export async function highlightHarness(
  code: string,
  theme: BundledTheme = DEFAULT_THEME,
): Promise<string> {
  const highlighter = await getHarnessHighlighter();
  if (!highlighter.getLoadedThemes().includes(theme)) {
    await highlighter.loadTheme(theme);
  }
  return highlighter.codeToHtml(code, { lang: "harness", theme });
}

/** Tokenize Harness DSL source; used to test grammar behaviour, not markup text. */
export async function tokenizeHarness(code: string): Promise<ThemedToken[][]> {
  const highlighter = await getHarnessHighlighter();
  return highlighter.codeToTokensBase(code, { lang: "harness", theme: DEFAULT_THEME });
}
