import { lazy, Suspense } from "react";
import type { DebuggerDiff } from "./session-debugger-model.js";
import { HighlightedCode } from "./HighlightedCode.js";

const StudioDiff = lazy(() => import("./StudioDiff.js"));

type ArtifactCodeViewProps = {
  className?: string;
  label: string;
} & ({
  mode: "source";
  content: string;
  sourceHint: string;
} | {
  mode: "diff";
  patch?: string;
  diff?: DebuggerDiff;
});

/** Canonical read-only code and patch surface owned by Artifact View. */
export function ArtifactCodeView(props: ArtifactCodeViewProps): React.JSX.Element {
  const className = `artifact-code-view artifact-code-view-${props.mode} ${props.className ?? ""}`.trim();
  if (props.mode === "source") {
    return <div className={className} data-artifact-code-view="source" aria-label={props.label}>
      <HighlightedCode code={props.content} sourceHint={props.sourceHint} />
    </div>;
  }
  const fallback = props.patch ?? debuggerFallback(props.diff);
  return <div className={className} data-artifact-code-view="diff" aria-label={props.label}>
    <Suspense fallback={<pre className="studio-diff-fallback" data-code-diff="loading">{fallback}</pre>}>
      <StudioDiff patch={props.patch} diff={props.diff} />
    </Suspense>
  </div>;
}

function debuggerFallback(diff: DebuggerDiff | undefined): string {
  if (diff === undefined) return "";
  return [...diff.before.map((line) => `-${line}`), ...diff.after.map((line) => `+${line}`)].join("\n");
}
