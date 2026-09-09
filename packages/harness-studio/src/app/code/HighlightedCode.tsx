import { useEffect, useRef, useState } from "react";
import type { StudioCodeToken } from "./code-highlight.js";
import { useStudioTheme } from "../studio-theme.js";

export function HighlightedCode({
  code,
  sourceHint,
  className = "",
  label,
  startLine,
  highlightLine,
}: {
  code: string;
  sourceHint: string;
  className?: string;
  label?: string;
  startLine?: number;
  highlightLine?: number;
}): React.JSX.Element {
  const targetRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (highlightLine !== undefined) targetRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [code, highlightLine]);
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

  if (tokens === undefined && startLine === undefined) {
    return <pre className={`highlighted-code ${className}`.trim()} data-highlight-state={state} aria-label={label}><code>{code}</code></pre>;
  }
  const lines = tokens ?? code.split('\n').map(line => [{ content: line }]);
  return <pre className={`highlighted-code ${className}`.trim()} data-highlight-state={state} aria-label={label} tabIndex={startLine === undefined ? undefined : 0}><code>{lines.map((line, lineIndex) => {
    const number = (startLine ?? 1) + lineIndex;
    const active = number === highlightLine;
    return <span className="highlighted-code-line" key={lineIndex} ref={active ? targetRef : undefined} data-line={startLine === undefined ? undefined : number} data-active={active || undefined} aria-current={active ? 'location' : undefined}>{startLine !== undefined && <span className="code-line-number" aria-hidden="true">{number}</span>}{line.map((token, tokenIndex) => <span key={tokenIndex} style={tokenStyle(token)}>{token.content}</span>)}{startLine === undefined && lineIndex < lines.length - 1 ? "\n" : ""}</span>;
  })}</code></pre>;
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
