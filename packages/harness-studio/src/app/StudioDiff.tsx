import { useMemo, useRef, useState } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import type { DebuggerDiff } from "./session-debugger-model.js";
import { buildDebuggerPatch } from "./code-rendering-model.js";
import { useStudioTheme } from "./studio-theme.js";

export default function StudioDiff(props: { diff?: DebuggerDiff; patch?: string }): React.JSX.Element {
  const theme = useStudioTheme();
  const patch = props.patch ?? (props.diff === undefined ? "" : buildDebuggerPatch(props.diff));
  const patchKey = useMemo(() => studioPatchCacheKey(patch), [patch]);
  const fileDiffs = useMemo(() => parseStudioPatchFiles(patch, patchKey), [patch, patchKey]);
  const progress = useRef<{ key: string; files: Set<number> }>({ key: patchKey, files: new Set() });
  const [readyKey, setReadyKey] = useState<string>();
  if (progress.current.key !== patchKey) progress.current = { key: patchKey, files: new Set() };
  if (fileDiffs.length === 0) {
    return <pre className="studio-diff-fallback">{patch}</pre>;
  }
  const markRendered = (index: number): void => {
    if (progress.current.key !== patchKey) return;
    progress.current.files.add(index);
    if (progress.current.files.size === fileDiffs.length) setReadyKey(patchKey);
  };
  return <div
    className="studio-diff-renderer"
    data-code-diff="pierre"
    data-file-count={fileDiffs.length}
    data-render-state={readyKey === patchKey ? "ready" : "loading"}
  >
    {fileDiffs.map((fileDiff, index) => <section className="studio-diff-file" key={`${patchKey}:${index}:${fileDiff.name}`}>
      <FileDiff
        fileDiff={fileDiff}
        disableWorkerPool
        options={{
          diffStyle: "split",
          disableFileHeader: fileDiffs.length === 1,
          hunkSeparators: "line-info-basic",
          lineDiffType: "word",
          overflow: "scroll",
          stickyHeader: false,
          theme: { dark: "github-dark", light: "github-light" },
          themeType: theme,
          unsafeCSS: pierreStudioCss,
          onPostRender: (_node, _instance, phase) => { if (phase !== "unmount") markRendered(index); },
        }}
      />
    </section>)}
  </div>;
}

export function parseStudioPatchFiles(patch: string, cacheKey = studioPatchCacheKey(patch)): FileDiffMetadata[] {
  try {
    return parsePatchFiles(patch, cacheKey)
      .flatMap((parsed) => parsed.files);
  } catch {
    return [];
  }
}

export function studioPatchCacheKey(patch: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < patch.length; index += 1) {
    hash ^= patch.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `artifact:${patch.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const pierreStudioCss = `
:host {
  --diffs-font-family: var(--font-code);
  --diffs-header-font-family: var(--font-ui);
  --diffs-font-size: var(--type-code-size);
  --diffs-bg: var(--color-surface);
  --diffs-light-bg: var(--color-surface);
  --diffs-bg-context: var(--color-surface);
  --diffs-bg-context-number: var(--color-surface-subtle);
  --diffs-bg-addition: var(--color-success-surface);
  --diffs-bg-addition-number: color-mix(in srgb, var(--color-success-surface), var(--color-success) 10%);
  --diffs-bg-deletion: var(--color-danger-surface);
  --diffs-bg-deletion-number: color-mix(in srgb, var(--color-danger-surface), var(--color-danger) 10%);
  --diffs-token-light-bg: transparent;
  font-size: var(--diffs-font-size);
}
[data-line-number-content], [data-column-number] {
  font-family: var(--diffs-header-font-family) !important;
  font-variant-numeric: tabular-nums;
}
`;
