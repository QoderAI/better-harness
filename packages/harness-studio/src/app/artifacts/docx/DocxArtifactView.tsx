import { createElement, useRef, useState, type MouseEvent } from "react";
import type {
  ArtifactDataSnapshot,
  DocxBlock,
  DocxImageInline,
  DocxParagraph,
  DocxTextRun,
} from "../../../artifact-model.js";
import { ArtifactDiagnostics } from "../ArtifactDiagnostics.js";
import type { ArtifactSurfaceMountContext } from "../ArtifactSurface.js";
import { DocumentZoomControls } from "../DocumentZoomControls.js";
import { useArtifactSnapshot } from "../useArtifactSnapshot.js";

export function DocxArtifactView({ artifact }: ArtifactSurfaceMountContext): React.JSX.Element {
  const { snapshot, failure } = useArtifactSnapshot(artifact, "docx/v1", "DOCX");
  const [zoom, setZoom] = useState(100);
  const [selection, setSelection] = useState<{ revisionId: string; address: string }>();
  const documentRef = useRef<HTMLElement>(null);
  const selectedAddress = selection?.revisionId === artifact.revision.id ? selection.address : undefined;
  const setSelectedAddress = (address: string | undefined): void => {
    setSelection(address === undefined ? undefined : { revisionId: artifact.revision.id, address });
  };

  if (failure !== undefined) return <p className="artifact-status" role="alert">{failure}</p>;
  if (snapshot === undefined) return <p className="artifact-status" role="status">Adapting DOCX revision…</p>;

  const payload = snapshot.payload;
  const headings = payload.blocks.filter((block): block is DocxParagraph => block.kind === "paragraph" && block.headingLevel !== undefined);
  const selectAddress = (address: string): void => {
    setSelectedAddress(address);
    requestAnimationFrame(() => {
      const target = [...(documentRef.current?.querySelectorAll<HTMLElement>("[data-artifact-address]") ?? [])]
        .find((element) => element.dataset.artifactAddress === address);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return <div className="docx-artifact-viewer">
    <section className="docx-stage-region" aria-label={`${artifact.label} preview`}>
      <div className="docx-view-toolbar">
        <span>{artifact.label} · Read-only</span>
        <DocumentZoomControls label="Document zoom" value={zoom} onChange={setZoom} />
      </div>
      <div className="docx-document-scroll">
        <article
          ref={documentRef}
          className="docx-document-page"
          aria-label="Word document content"
          style={{ width: "min(8.5in, 100%)", minHeight: "11in", zoom: zoom / 100 }}
        >
          {payload.blocks.map((block) => <DocxBlockView
            key={block.id}
            block={block}
            resources={snapshot.resources}
            selectedAddress={selectedAddress}
            onSelect={setSelectedAddress}
          />)}
        </article>
      </div>
      <footer className="docx-diagnostics">
        <span>{snapshot.adapter.id}@{snapshot.adapter.version}</span>
        <ArtifactDiagnostics diagnostics={snapshot.diagnostics} />
      </footer>
    </section>
    {headings.length > 0 && <aside className="docx-outline-pane" aria-label="Document outline">
      <h3>Outline</h3>
      <ul>{headings.map((heading) => <li key={heading.id}><button
        type="button"
        className={heading.address === selectedAddress ? "selected" : undefined}
        aria-pressed={heading.address === selectedAddress}
        onClick={() => selectAddress(heading.address)}
        style={{ paddingInlineStart: `calc(var(--space-xs) + ${(heading.headingLevel ?? 1) - 1} * var(--space-sm))` }}
      ><strong>{heading.label}</strong><small>Heading {heading.headingLevel}</small></button></li>)}</ul>
    </aside>}
  </div>;
}

function DocxBlockView(props: {
  block: DocxBlock;
  resources: ArtifactDataSnapshot["resources"];
  selectedAddress?: string;
  onSelect: (address: string) => void;
}): React.JSX.Element {
  if (props.block.kind === "paragraph") {
    return <DocxParagraphView
      paragraph={props.block}
      resources={props.resources}
      selected={props.selectedAddress === props.block.address}
      onSelect={props.onSelect}
    />;
  }
  return <div
    className={`docx-table-scroll${props.selectedAddress === props.block.address ? " selected" : ""}`}
    data-artifact-address={props.block.address}
    onClick={() => props.onSelect(props.block.address)}
  >
    <table><tbody>{props.block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.cells.map((cell, cellIndex) => <td key={cellIndex}>{cell.paragraphs.map((paragraph) => <DocxParagraphView
      key={paragraph.id}
      paragraph={paragraph}
      resources={props.resources}
      selected={props.selectedAddress === paragraph.address}
      onSelect={props.onSelect}
    />)}</td>)}</tr>)}</tbody></table>
  </div>;
}

function DocxParagraphView(props: {
  paragraph: DocxParagraph;
  resources: ArtifactDataSnapshot["resources"];
  selected: boolean;
  onSelect: (address: string) => void;
}): React.JSX.Element {
  const paragraph = props.paragraph;
  const tag = paragraph.headingLevel === undefined ? "p" : `h${paragraph.headingLevel}`;
  const content = <>{paragraph.numbering !== undefined && <span className="docx-list-marker" aria-hidden="true">•</span>}{paragraph.inlines.map((inline, index) => inline.kind === "text"
    ? <DocxTextInline key={index} run={inline} />
    : <DocxImage key={index} inline={inline} resources={props.resources} />)}</>;
  return createElement(tag, {
    className: `docx-paragraph${props.selected ? " selected" : ""}`,
    "data-artifact-address": paragraph.address,
    style: { textAlign: paragraph.alignment ?? "left" },
    onClick: (event: MouseEvent) => {
      event.stopPropagation();
      props.onSelect(paragraph.address);
    },
  }, content);
}

function DocxTextInline({ run }: { run: DocxTextRun }): React.JSX.Element {
  return <span style={{
    ...(run.fontFamily === undefined ? {} : { fontFamily: `${JSON.stringify(run.fontFamily)}, system-ui, sans-serif` }),
    ...(run.fontSizePoints === undefined ? {} : { fontSize: `${run.fontSizePoints}pt` }),
    ...(run.color === undefined ? {} : { color: run.color }),
    ...(run.bold === true ? { fontWeight: 700 } : {}),
    ...(run.italic === true ? { fontStyle: "italic" } : {}),
    ...(run.underline === true || run.strike === true ? { textDecoration: `${run.underline === true ? "underline" : ""} ${run.strike === true ? "line-through" : ""}`.trim() } : {}),
  }}>{run.text}</span>;
}

function DocxImage(props: {
  inline: DocxImageInline;
  resources: ArtifactDataSnapshot["resources"];
}): React.JSX.Element {
  const resource = props.resources.find((candidate) => candidate.id === props.inline.resourceId);
  return <img
    className="docx-inline-image"
    src={resource?.uri}
    alt={props.inline.alt ?? resource?.label ?? "Document image"}
    style={{
      ...(props.inline.widthEmu === undefined ? {} : { width: `${props.inline.widthEmu / 9_525}px` }),
      ...(props.inline.heightEmu === undefined ? {} : { height: `${props.inline.heightEmu / 9_525}px` }),
    }}
  />;
}
