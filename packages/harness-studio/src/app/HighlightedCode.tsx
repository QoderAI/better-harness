import { useEffect, useState } from "react";
import type { StudioCodeToken } from "./code-highlight.js";
import { useStudioTheme } from "./studio-theme.js";

export function HighlightedCode({
  code,
  sourceHint,
  className = "",
  label,
}: {
  code: string;
  sourceHint: string;
  className?: string;
  label?: string;
}): React.JSX.Element {
  const theme = useStudioTheme();
  const [tokens, setTokens] = useState<readonly (readonly StudioCodeToken[])[] | undefined>();
  const [state, setState] = useState<"plain" | "loading" | "highlighted">("plain");

  useEffect(() => {
    let cancelled = false;
    setTokens(undefined);
    setState("loading");
    void import("./code-highlight.js")
      .then(({ highlightStudioCode }) => highlightStudioCode(code, sourceHint, theme))
      .then((nextTokens) => {
        if (cancelled) return;
        setTokens(nextTokens);
        setState(nextTokens === undefined ? "plain" : "highlighted");
      })
      .catch(() => {
        if (!cancelled) setState("plain");
      });
    return () => { cancelled = true; };
  }, [code, sourceHint, theme]);

  return <pre className={`highlighted-code ${className}`.trim()} data-highlight-state={state} aria-label={label}><code>{tokens === undefined ? code : tokens.map((line, lineIndex) => <span className="highlighted-code-line" key={lineIndex}>{line.map((token, tokenIndex) => <span key={tokenIndex} style={tokenStyle(token)}>{token.content}</span>)}{lineIndex < tokens.length - 1 ? "\n" : ""}</span>)}</code></pre>;
}

function tokenStyle(token: StudioCodeToken): React.CSSProperties {
  return {
    ...(token.color === undefined ? {} : { color: token.color }),
    ...(token.fontStyle === undefined || token.fontStyle === 0 ? {} : {
      fontStyle: (token.fontStyle & 1) !== 0 ? "italic" : undefined,
      fontWeight: (token.fontStyle & 2) !== 0 ? 700 : undefined,
      textDecoration: (token.fontStyle & 4) !== 0 ? "underline" : undefined,
    }),
  };
}
