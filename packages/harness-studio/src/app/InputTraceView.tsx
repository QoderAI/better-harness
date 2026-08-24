import { useEffect, useMemo, useState } from "react";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { File } from "@phosphor-icons/react/File";
import { Folder } from "@phosphor-icons/react/Folder";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { X } from "@phosphor-icons/react/X";
import { Tree, type NodeRendererProps, type RowRendererProps } from "react-arborist";
import {
  buildUserInputFileTree,
  isUserInputTrace,
  type UserInputActivity,
  type UserInputFileTreeNode,
  type UserInputRecord,
  type UserInputTraceV1,
} from "../input-trace-model.js";
import {
  isIntentCorrelationAnalysis,
  type IntentCorrelationAnalysisV1,
  type IntentProposal,
} from "../intent-correlation-model.js";

type ActivityFilter = "all" | UserInputActivity | "unlinked";

export function InputTraceView(props: { intentAnalysisEnabled: boolean }): React.JSX.Element {
  const [trace, setTrace] = useState<UserInputTraceV1>();
  const [failure, setFailure] = useState<string>();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [activity, setActivity] = useState<ActivityFilter>("all");
  const [selectedInputId, setSelectedInputId] = useState<string>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [narrowSurface, setNarrowSurface] = useState<"files" | "inputs">("inputs");
  const [analysis, setAnalysis] = useState<IntentCorrelationAnalysisV1>();
  const [analysisState, setAnalysisState] = useState<"idle" | "running">("idle");
  const [analysisFailure, setAnalysisFailure] = useState<string>();
  const [fileTreeElement, setFileTreeElement] = useState<HTMLDivElement | null>(null);
  const [fileTreeMetrics, setFileTreeMetrics] = useState({ height: 1, rowHeight: 30, indent: 12, padding: 4 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/inputs");
        if (!response.ok) throw new Error(await apiError(response));
        const payload: unknown = await response.json();
        if (!isUserInputTrace(payload)) throw new Error("Studio returned an unsupported input trace.");
        if (!cancelled) {
          setTrace(payload);
          setSelectedInputId(payload.inputs[0]?.id);
        }
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : "Input trace failed to load.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (fileTreeElement === null) return;
    const measure = (): void => {
      const styles = getComputedStyle(fileTreeElement);
      const next = {
        height: Math.max(fileTreeElement.clientHeight, 1),
        rowHeight: cssPixelValue(styles, "--row-height", 30),
        indent: cssPixelValue(styles, "--space-md", 12),
        padding: cssPixelValue(styles, "--space-xs", 4),
      };
      setFileTreeMetrics((current) => current.height === next.height
        && current.rowHeight === next.rowHeight
        && current.indent === next.indent
        && current.padding === next.padding ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(fileTreeElement);
    return () => observer.disconnect();
  }, [fileTreeElement]);

  const providers = useMemo(() => trace === undefined ? [] : [...new Set(trace.inputs.map((input) => input.provider))].sort(), [trace]);
  const filteredInputs = useMemo(() => {
    if (trace === undefined) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return trace.inputs.filter((input) => {
      if (provider !== "all" && input.provider !== provider) return false;
      if (activity === "unlinked" && input.links.length > 0) return false;
      if ((activity === "read" || activity === "edit-targeted") && !input.links.some((link) => link.activity === activity)) return false;
      return normalizedQuery === ""
        || input.text.toLocaleLowerCase().includes(normalizedQuery)
        || input.links.some((link) => link.path.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [activity, provider, query, trace]);
  const visibleInputs = useMemo(() => selectedPath === undefined
    ? filteredInputs
    : filteredInputs.filter((input) => input.links.some((link) => link.path === selectedPath)), [filteredInputs, selectedPath]);
  const tree = useMemo(() => buildUserInputFileTree(filteredInputs), [filteredInputs]);
  const highlightedPaths = useMemo(() => new Set(trace?.inputs.find((input) => input.id === selectedInputId)?.links.map((link) => link.path) ?? []), [selectedInputId, trace]);

  async function analyzeRelationships(): Promise<void> {
    setAnalysisState("running");
    setAnalysisFailure(undefined);
    try {
      const response = await fetch("api/intent-analysis", { method: "POST" });
      if (!response.ok) throw new Error(await apiError(response));
      const payload: unknown = await response.json();
      if (!isIntentCorrelationAnalysis(payload)) throw new Error("Studio returned an unsupported Intent analysis.");
      setAnalysis(payload);
    } catch (error) {
      setAnalysisFailure(error instanceof Error ? error.message : "Intent analysis failed.");
    } finally {
      setAnalysisState("idle");
    }
  }

  if (failure !== undefined) return <main className="input-trace-empty" role="alert"><strong>Input trace unavailable</strong><p>{failure}</p></main>;
  if (trace === undefined) return <p className="artifact-status" role="status">Indexing retained user inputs…</p>;

  return <main className="input-trace-workbench" data-narrow-surface={narrowSurface}>
    <header className="input-trace-toolbar">
      <label className="input-trace-search"><MagnifyingGlass aria-hidden="true" size={15} /><span className="visually-hidden">Search user inputs or file paths</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inputs or paths" /></label>
      <label><span>Provider</span><select aria-label="Filter by provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option>{providers.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>Activity</span><select aria-label="Filter by file activity" value={activity} onChange={(event) => setActivity(event.target.value as ActivityFilter)}><option value="all">All activity</option><option value="read">Read</option><option value="edit-targeted">Edit targeted</option><option value="unlinked">Unlinked</option></select></label>
      <button className="input-intent-trigger" type="button" disabled={!props.intentAnalysisEnabled || analysisState === "running"} title={props.intentAnalysisEnabled ? "Build reviewable proposed Intent relationships" : "This Studio launcher has no online Intent analyzer"} onClick={() => void analyzeRelationships()}>{analysisState === "running" ? "Analyzing…" : analysis === undefined ? "Analyze relationships" : "Analyze again"}</button>
      <span className="input-trace-summary">{visibleInputs.length}/{trace.summary.inputCount} inputs · {trace.summary.fileCount} files</span>
    </header>
    <nav className="input-trace-narrow-tabs" aria-label="Input trace panes">
      <button type="button" aria-current={narrowSurface === "files" ? "page" : undefined} onClick={() => setNarrowSurface("files")}>Files</button>
      <button type="button" aria-current={narrowSurface === "inputs" ? "page" : undefined} onClick={() => setNarrowSurface("inputs")}>Inputs</button>
    </nav>
    <aside className="input-file-pane" aria-label="Files linked to user inputs">
      <header><strong>Files</strong><span>{treeFileCount(tree)}</span></header>
      {tree.length === 0
        ? <p>No exact file links in this filter.</p>
        : <div className="input-file-tree" ref={setFileTreeElement}>
          <Tree<UserInputFileTreeNode>
            aria-label="Workspace files linked to user inputs"
            childrenAccessor={(node) => node.kind === "directory" ? node.children : null}
            data={tree}
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
            disableSelect={(node) => node.kind === "directory"}
            height={fileTreeMetrics.height}
            indent={fileTreeMetrics.indent}
            openByDefault
            paddingBottom={fileTreeMetrics.padding}
            paddingTop={fileTreeMetrics.padding}
            rowClassName="input-file-tree-row"
            rowHeight={fileTreeMetrics.rowHeight}
            selection={selectedPath === undefined ? undefined : `file:${selectedPath}`}
            width="100%"
            renderRow={FileTreeRow}
            onActivate={(node) => {
              if (!node.isLeaf) return;
              setSelectedPath((current) => current === node.data.path ? undefined : node.data.path);
              setNarrowSurface("inputs");
            }}
          >
            {(nodeProps) => <FileTreeNode {...nodeProps} highlighted={highlightedPaths.has(nodeProps.node.data.path)} />}
          </Tree>
        </div>}
    </aside>
    <section className={`input-list-pane${trace.summary.truncatedSessionCount > 0 ? " has-boundary" : ""}${analysis !== undefined || analysisFailure !== undefined ? " has-analysis" : ""}`} aria-label="Retained user inputs">
      <header><div><strong>{trace.workspace.label}</strong><span>Retained inputs and exact observed file operations</span></div>{selectedPath !== undefined && <button type="button" onClick={() => setSelectedPath(undefined)}><X aria-hidden="true" size={13} />{selectedPath}</button>}</header>
      {trace.summary.truncatedSessionCount > 0 && <p className="input-trace-boundary">{trace.summary.truncatedSessionCount} Session{trace.summary.truncatedSessionCount === 1 ? " was" : "s were"} truncated by retained dialogue limits.</p>}
      {(analysis !== undefined || analysisFailure !== undefined) && <IntentAnalysisPane analysis={analysis} failure={analysisFailure} onClose={() => { setAnalysis(undefined); setAnalysisFailure(undefined); }} />}
      {visibleInputs.length === 0
        ? <div className="input-trace-empty"><strong>No matching inputs</strong><p>Clear the file selection or adjust the filters.</p></div>
        : <ol className="input-trace-rows">{visibleInputs.map((input) => <InputRow key={input.id} input={input} selected={input.id === selectedInputId} onSelect={() => setSelectedInputId(input.id)} />)}</ol>}
    </section>
  </main>;
}

function IntentAnalysisPane(props: { analysis?: IntentCorrelationAnalysisV1; failure?: string; onClose: () => void }): React.JSX.Element {
  return <section className="input-intent-pane" aria-label="Proposed Intent relationships">
    <header><div><strong>Proposed Intent</strong><span>AI claims · locally validated · not confirmed</span></div><button type="button" aria-label="Close proposed Intent relationships" onClick={props.onClose}><X aria-hidden="true" size={13} /></button></header>
    {props.failure !== undefined
      ? <p role="alert">{props.failure}</p>
      : <div className="input-intent-proposals">{props.analysis?.intentProposals.map((proposal) => <IntentProposalRow key={proposal.id} proposal={proposal} analysis={props.analysis!} />)}{props.analysis?.intentProposals.length === 0 && <p>No Intent proposal met the evidence contract.</p>}</div>}
  </section>;
}

function IntentProposalRow(props: { proposal: IntentProposal; analysis: IntentCorrelationAnalysisV1 }): React.JSX.Element {
  const claims = props.analysis.claims.filter((claim) => claim.objectRef === props.proposal.id);
  return <article><header><span>Proposed</span><strong>{props.proposal.title}</strong><small>{claims.length} claim{claims.length === 1 ? "" : "s"}</small></header><p>{props.proposal.summary}</p>{claims.length > 0 && <ul>{claims.map((claim) => <li key={claim.id}><code>{claim.predicate}</code><span>{claim.reason}</span><small title={claim.limitations.join("\n")}>{claim.evidenceStrength} · {claim.evidenceRefs.length} evidence ref{claim.evidenceRefs.length === 1 ? "" : "s"}</small></li>)}</ul>}</article>;
}

function FileTreeRow(props: RowRendererProps<UserInputFileTreeNode>): React.JSX.Element {
  return <div
    {...props.attrs}
    ref={props.innerRef}
    aria-label={props.node.data.path}
    className={`${props.attrs.className ?? ""}${props.node.data.kind === "directory" ? " directory" : " file"}`}
    onClick={props.node.handleClick}
    onFocus={(event) => event.stopPropagation()}
  >{props.children}</div>;
}

function FileTreeNode(props: NodeRendererProps<UserInputFileTreeNode> & { highlighted: boolean }): React.JSX.Element {
  const { node } = props;
  const activity = node.data.readCount > 0 || node.data.editTargetCount > 0
    ? `${node.data.readCount > 0 ? `R${node.data.readCount}` : ""}${node.data.readCount > 0 && node.data.editTargetCount > 0 ? " " : ""}${node.data.editTargetCount > 0 ? `T${node.data.editTargetCount}` : ""}`
    : "";
  return <div
    className={`input-tree-node${node.isInternal ? " directory" : " file"}${props.highlighted && node.isLeaf ? " linked" : ""}`}
    style={props.style}
    title={node.data.path}
  >
    {node.isInternal
      ? <button type="button" tabIndex={-1} aria-label={`${node.isOpen ? "Collapse" : "Expand"} ${node.data.path}`} aria-expanded={node.isOpen} onClick={(event) => { event.stopPropagation(); node.toggle(); }}><CaretRight aria-hidden="true" size={13} /></button>
      : <span className="input-tree-spacer" aria-hidden="true" />}
    {node.isInternal ? <Folder aria-hidden="true" size={14} weight="fill" /> : <File aria-hidden="true" size={14} />}
    <span>{node.data.name}</span>
    {node.isLeaf && <small>{activity}</small>}
  </div>;
}

function InputRow(props: { input: UserInputRecord; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const reads = props.input.links.filter((link) => link.activity === "read").reduce((total, link) => total + link.callCount, 0);
  const editTargets = props.input.links.filter((link) => link.activity === "edit-targeted").reduce((total, link) => total + link.callCount, 0);
  const files = [...new Set(props.input.links.map((link) => link.path))];
  return <li><button type="button" aria-selected={props.selected} onClick={props.onSelect}>
    <span className="input-row-meta"><strong>{props.input.provider}</strong><time dateTime={props.input.observedAt ?? undefined}>{formatTime(props.input.observedAt)}</time><code>Turn {props.input.turnIndex}</code></span>
    <span className="input-row-prompt">{props.input.text}</span>
    <span className="input-row-evidence">{reads > 0 && <em data-activity="read">{reads} read</em>}{editTargets > 0 && <em data-activity="edit-targeted">{editTargets} edit targeted</em>}{files.length === 0 ? <small>No observed file operation</small> : <small title={files.join("\n")}>{files.length} file{files.length === 1 ? "" : "s"}</small>}</span>
  </button></li>;
}

function cssPixelValue(styles: CSSStyleDeclaration, property: string, fallback: number): number {
  const parsed = Number.parseFloat(styles.getPropertyValue(property));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function treeFileCount(nodes: readonly UserInputFileTreeNode[]): number {
  return nodes.reduce((count, node) => count + (node.kind === "file" ? 1 : treeFileCount(node.children)), 0);
}

function formatTime(value: string | null): string {
  if (value === null) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function apiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error ?? `Input trace failed (${response.status}).`;
  } catch {
    return `Input trace failed (${response.status}).`;
  }
}
