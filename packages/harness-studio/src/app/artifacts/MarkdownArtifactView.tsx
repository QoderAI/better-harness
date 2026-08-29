import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  type ArtifactDataSnapshot,
  type ArtifactDescriptor,
  type ArtifactStructureNode,
  type MarkdownBlock,
  type MarkdownInline,
} from "../../contracts/artifact.js";
import { ArtifactDiagnostics } from "./ArtifactDiagnostics.js";
import { useArtifactSnapshot } from "./useArtifactSnapshot.js";
import { HighlightedCode } from "../code/HighlightedCode.js";

/**
 * Fence info strings name a language; the highlighter resolves a file
 * extension. Mapping the two is a Markdown concern, so it lives with the
 * Markdown renderer rather than widening the shared code model.
 */
const FENCE_LANGUAGE_HINTS: Record<string, string> = {
  "c#": "cs", "c++": "cpp", bash: "sh", console: "sh", csharp: "cs", golang: "go",
  javascript: "js", kotlin: "kt", markdown: "md", plaintext: "txt", python: "py",
  ruby: "rb", rust: "rs", shell: "sh", text: "txt", typescript: "ts", yml: "yaml", zsh: "sh",
};

export function MarkdownArtifactView({ artifact }: { artifact: ArtifactDescriptor }): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  const { snapshot, failure } = useArtifactSnapshot(artifact, "markdown/v1", "Markdown");
  const documentRef = useRef<HTMLDivElement>(null);

  if (failure !== undefined) return <p className="artifact-status" role="alert">{failure}</p>;
  if (snapshot === undefined) {
    return <p className="artifact-status" role="status">{t("markdown.adapting")}</p>;
  }
  const payload = snapshot.payload;
  const context: RenderContext = {
    resources: snapshot.resources,
    // Selecting an outline entry scrolls the document rather than writing a
    // fragment: Studio routes on the hash, so an anchor navigation would leave
    // the Artifacts workspace entirely.
    goTo: (slug) => {
      documentRef.current
        ?.querySelector(`[data-md-heading="${slug}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
  };

  return <div className="markdown-artifact-viewer">
    {snapshot.structure.length > 0 && <nav className="markdown-outline-rail" aria-label={t("markdown.outlineAria", { label: artifact.label })}>
      <h3>{t("markdown.outline")}</h3>
      <MarkdownOutline nodes={snapshot.structure} onSelect={context.goTo} />
    </nav>}
    <section className="markdown-document-region" aria-label={t("markdown.documentAria", { label: artifact.label })}>
      <div className="markdown-document-scroll" ref={documentRef} tabIndex={0}>
        <article className="markdown-document">
          {payload.blocks.map((block, index) => <MarkdownBlockView key={index} block={block} context={context} />)}
        </article>
      </div>
      <footer className="markdown-document-footer">
        <span>{snapshot.adapter.id}@{snapshot.adapter.version}</span>
        <ArtifactDiagnostics diagnostics={snapshot.diagnostics} />
      </footer>
    </section>
  </div>;
}

interface RenderContext {
  resources: ArtifactDataSnapshot["resources"];
  goTo: (slug: string) => void;
}

function MarkdownOutline(props: {
  nodes: readonly ArtifactStructureNode[];
  onSelect: (slug: string) => void;
}): React.JSX.Element {
  return <ul>
    {props.nodes.map((node) => <li key={node.address}>
      <button type="button" className={`markdown-outline-${node.kind}`} onClick={() => props.onSelect(node.id)}>{node.label}</button>
      {node.children !== undefined && node.children.length > 0 && <MarkdownOutline nodes={node.children} onSelect={props.onSelect} />}
    </li>)}
  </ul>;
}

function MarkdownBlockView({ block, context }: { block: MarkdownBlock; context: RenderContext }): React.JSX.Element {
  if (block.kind === "heading") {
    const Heading = `h${block.level}` as "h1";
    return <Heading data-md-heading={block.id}>
      <MarkdownInlineView nodes={block.children} context={context} />
    </Heading>;
  }
  if (block.kind === "paragraph") {
    return <p><MarkdownInlineView nodes={block.children} context={context} /></p>;
  }
  if (block.kind === "code") {
    return <div className="markdown-code-block" data-md-language={block.language ?? "plain"}>
      <HighlightedCode code={block.text} sourceHint={fenceHint(block.language)} />
    </div>;
  }
  if (block.kind === "quote") {
    return <blockquote>{block.blocks.map((child, index) => <MarkdownBlockView key={index} block={child} context={context} />)}</blockquote>;
  }
  if (block.kind === "list") return <MarkdownListView block={block} context={context} />;
  if (block.kind === "table") {
    return <div className="markdown-table-scroll">
      <table>
        <thead><tr>{block.head.map((cell, index) => <th key={index} style={{ textAlign: block.alignments[index] ?? "left" }}>
          <MarkdownInlineView nodes={cell} context={context} />
        </th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index} style={{ textAlign: block.alignments[index] ?? "left" }}>
          <MarkdownInlineView nodes={cell} context={context} />
        </td>)}</tr>)}</tbody>
      </table>
    </div>;
  }
  if (block.kind === "thematicBreak") return <hr />;
  // Source Studio declined to interpret. It is text, never markup.
  return <pre className="markdown-raw-html" data-md-raw-html="true">{block.text}</pre>;
}

function MarkdownListView({
  block,
  context,
}: { block: Extract<MarkdownBlock, { kind: "list" }>; context: RenderContext }): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  const items = block.items.map((item, index) => <li key={index} className={item.checked === undefined ? undefined : "markdown-task-item"}>
    {item.checked !== undefined && <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? t("markdown.completedTask") : t("markdown.openTask")} readOnly />}
    <MarkdownItemBody blocks={item.blocks} tight={block.tight} context={context} />
  </li>);
  const className = `markdown-list${block.tight ? " tight" : ""}`;
  return block.ordered
    ? <ol className={className} start={block.start}>{items}</ol>
    : <ul className={className}>{items}</ul>;
}

/** A tight item's single paragraph renders inline, so it stays on the marker's line. */
function MarkdownItemBody(props: {
  blocks: readonly MarkdownBlock[];
  tight: boolean;
  context: RenderContext;
}): React.JSX.Element {
  const [first, ...rest] = props.blocks;
  if (props.tight && first?.kind === "paragraph") {
    return <>
      <MarkdownInlineView nodes={first.children} context={props.context} />
      {rest.map((block, index) => <MarkdownBlockView key={index} block={block} context={props.context} />)}
    </>;
  }
  return <>{props.blocks.map((block, index) => <MarkdownBlockView key={index} block={block} context={props.context} />)}</>;
}

function MarkdownInlineView({
  nodes,
  context,
}: { nodes: readonly MarkdownInline[]; context: RenderContext }): React.JSX.Element {
  return <>{nodes.map((node, index) => <MarkdownInlineNode key={index} node={node} context={context} />)}</>;
}

function MarkdownInlineNode({ node, context }: { node: MarkdownInline; context: RenderContext }): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  if (node.kind === "text") return <>{node.text}</>;
  if (node.kind === "code") return <code className="markdown-inline-code">{node.text}</code>;
  if (node.kind === "break") return <br />;
  if (node.kind === "emphasis") return <em><MarkdownInlineView nodes={node.children} context={context} /></em>;
  if (node.kind === "strong") return <strong><MarkdownInlineView nodes={node.children} context={context} /></strong>;
  if (node.kind === "strike") return <s><MarkdownInlineView nodes={node.children} context={context} /></s>;
  if (node.kind === "link") {
    if (node.href.startsWith("#")) {
      return <button type="button" className="markdown-anchor-link" title={node.title} onClick={() => context.goTo(node.href.slice(1))}>
        <MarkdownInlineView nodes={node.children} context={context} />
      </button>;
    }
    // The adapter already limited the scheme; the referrer and opener are
    // withheld here so an external target learns nothing about Studio.
    return <a href={node.href} title={node.title} target="_blank" rel="noreferrer noopener">
      <MarkdownInlineView nodes={node.children} context={context} />
    </a>;
  }
  if (node.kind === "image") {
    const resource = node.resourceId === undefined
      ? undefined
      : context.resources.find((candidate) => candidate.id === node.resourceId);
    // An image Studio declined to serve keeps its alt text, so the sentence
    // around it still reads.
    if (resource === undefined) {
      return <span className="markdown-image-unresolved" title={node.title}>{node.alt === "" ? t("markdown.imageNotShown") : node.alt}</span>;
    }
    return <img className="markdown-image" src={resource.uri} alt={node.alt} title={node.title} loading="lazy" />;
  }
  return <MarkdownInlineView nodes={node.children} context={context} />;
}

function fenceHint(language: string | undefined): string {
  if (language === undefined || language.trim() === "") return "block.txt";
  const normalized = language.trim().toLowerCase();
  return FENCE_LANGUAGE_HINTS[normalized] ?? normalized;
}
