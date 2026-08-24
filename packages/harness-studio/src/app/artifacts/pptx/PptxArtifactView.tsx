import { useState } from "react";
import type {
  ArtifactDataSnapshot,
  PptxElement,
  PptxSlideSnapshot,
} from "../../../artifact-model.js";
import { ArtifactDiagnostics } from "../ArtifactDiagnostics.js";
import type { ArtifactSurfaceMountContext } from "../ArtifactSurface.js";
import { DocumentZoomControls } from "../DocumentZoomControls.js";
import { useArtifactSnapshot } from "../useArtifactSnapshot.js";

export function PptxArtifactView({ artifact }: ArtifactSurfaceMountContext): React.JSX.Element {
  const { snapshot, failure } = useArtifactSnapshot(artifact, "pptx/v1", "PPTX");
  const [navigation, setNavigation] = useState<{ revisionId: string; slideIndex: number }>();
  const [zoom, setZoom] = useState(100);
  const [selection, setSelection] = useState<{ revisionId: string; address: string }>();
  const slideIndex = navigation?.revisionId === artifact.revision.id ? navigation.slideIndex : 0;
  const selectedAddress = selection?.revisionId === artifact.revision.id ? selection.address : undefined;

  if (failure !== undefined) return <p className="artifact-status" role="alert">{failure}</p>;
  if (snapshot === undefined) return <p className="artifact-status" role="status">Adapting PPTX revision…</p>;

  const payload = snapshot.payload;
  const active = payload.slides[Math.min(slideIndex, payload.slides.length - 1)];
  if (active === undefined) return <p className="artifact-status" role="alert">The PPTX snapshot has no slides.</p>;
  const outline = snapshot.structure.length === payload.slides.length ? snapshot.structure : [];
  const activeOutline = outline[Math.min(slideIndex, outline.length - 1)];
  const selectAddress = (address: string): void => setSelection((current) => (
    current?.revisionId === artifact.revision.id && current.address === address
      ? undefined
      : { revisionId: artifact.revision.id, address }
  ));

  return <div className="pptx-artifact-viewer">
    <nav className="pptx-slide-rail" aria-label="Slides">
      {payload.slides.map((slide, index) => <button
        key={slide.id}
        type="button"
        className={index === slideIndex ? "selected" : undefined}
        aria-current={index === slideIndex}
        onClick={() => {
          setNavigation({ revisionId: artifact.revision.id, slideIndex: index });
          setSelection(undefined);
        }}
      ><span className="pptx-slide-thumb" aria-hidden="true">{index + 1}</span><small>{slide.label}</small></button>)}
    </nav>
    <section className="pptx-stage-region" aria-label={`${active.label} preview`}>
      <div className="pptx-view-toolbar">
        <span>{active.label}{active.notesPresent ? " · Notes" : ""}</span>
        <DocumentZoomControls label="Slide zoom" value={zoom} onChange={setZoom} />
      </div>
      <div className="pptx-stage-scroll">
        <PptxSlide
          slide={active}
          width={payload.width}
          height={payload.height}
          zoom={zoom}
          resources={snapshot.resources}
          selectedAddress={selectedAddress}
        />
      </div>
      <footer className="pptx-diagnostics">
        <span>{snapshot.adapter.id}@{snapshot.adapter.version}</span>
        <ArtifactDiagnostics diagnostics={snapshot.diagnostics} />
      </footer>
    </section>
    {activeOutline !== undefined && (activeOutline.children ?? []).length > 0 && <aside className="pptx-outline-pane" aria-label={`${active.label} outline`}>
      <h3>Outline</h3>
      <ul>
        {(activeOutline.children ?? []).map((node) => <li key={node.id}>
          <button
            type="button"
            className={node.address === selectedAddress ? "selected" : undefined}
            aria-pressed={node.address === selectedAddress}
            onClick={() => selectAddress(node.address)}
          ><strong>{node.label}</strong><small>{node.kind}</small></button>
        </li>)}
      </ul>
    </aside>}
  </div>;
}

function PptxSlide(props: {
  slide: PptxSlideSnapshot;
  width: number;
  height: number;
  zoom: number;
  resources: ArtifactDataSnapshot["resources"];
  selectedAddress?: string;
}): React.JSX.Element {
  return <div className="pptx-slide" style={{ aspectRatio: `${props.width} / ${props.height}`, width: `${props.zoom}%`, backgroundColor: props.slide.background ?? "var(--color-document-paper)" }}>
    {props.slide.elements.map((element) => <PptxSlideElement
      key={element.id}
      element={element}
      slideWidth={props.width}
      slideHeight={props.height}
      resources={props.resources}
      selected={element.address === props.selectedAddress}
    />)}
  </div>;
}

function PptxSlideElement(props: {
  element: PptxElement;
  slideWidth: number;
  slideHeight: number;
  resources: ArtifactDataSnapshot["resources"];
  selected: boolean;
}): React.JSX.Element {
  const element = props.element;
  const style = {
    left: `${element.x / props.slideWidth * 100}%`,
    top: `${element.y / props.slideHeight * 100}%`,
    width: `${element.width / props.slideWidth * 100}%`,
    height: `${element.height / props.slideHeight * 100}%`,
    ...(element.rotation === undefined ? {} : { transform: `rotate(${element.rotation}deg)` }),
  };
  const selection = props.selected ? " selected" : "";
  if (element.kind === "image") {
    const resource = props.resources.find((candidate) => candidate.id === element.resourceId);
    return <img className={`pptx-slide-element pptx-slide-image${selection}`} data-artifact-address={element.address} style={style} src={resource?.uri} alt={element.alt ?? element.name} />;
  }
  return <div className={`pptx-slide-element pptx-slide-shape${selection}`} data-artifact-address={element.address} style={{ ...style, backgroundColor: element.fill ?? "transparent", borderColor: element.line ?? "transparent" }}>
    {element.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex} style={{ textAlign: paragraph.alignment }}>
      {paragraph.runs.map((run, runIndex) => <span key={runIndex} style={{
        ...(run.fontFamily === undefined ? {} : { fontFamily: `${JSON.stringify(run.fontFamily)}, system-ui, sans-serif` }),
        ...(run.fontSizePoints === undefined ? {} : { fontSize: `${run.fontSizePoints / (props.slideWidth / 12_700) * 100}cqw` }),
        ...(run.color === undefined ? {} : { color: run.color }),
        ...(run.bold === true ? { fontWeight: 700 } : {}),
        ...(run.italic === true ? { fontStyle: "italic" } : {}),
      }}>{run.text}</span>)}
    </p>)}
  </div>;
}
