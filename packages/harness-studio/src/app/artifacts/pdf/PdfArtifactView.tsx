import { CaretLeft } from "@phosphor-icons/react/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_ARTIFACT_PREVIEW_LIMITS, type PdfPageSnapshot } from "../../../artifact-model.js";
import { ArtifactDiagnostics } from "../ArtifactDiagnostics.js";
import type { ArtifactSurfaceMountContext } from "../ArtifactSurface.js";
import { DocumentZoomControls } from "../DocumentZoomControls.js";
import { useArtifactSnapshot } from "../useArtifactSnapshot.js";

const PAGE_GAP = 24;

export function PdfArtifactView({ artifact }: ArtifactSurfaceMountContext): React.JSX.Element {
  const { snapshot, failure } = useArtifactSnapshot(artifact, "pdf/v1", "PDF");
  const [zoom, setZoom] = useState(100);
  const [navigation, setNavigation] = useState<{ revisionId: string; pageIndex: number }>();
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [documentFailure, setDocumentFailure] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activePageIndex = navigation?.revisionId === artifact.revision.id ? navigation.pageIndex : 0;
  const resource = snapshot?.resources.find((candidate) => candidate.id === snapshot.payload.resourceId);

  useEffect(() => {
    if (resource === undefined) return;
    const controller = new AbortController();
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let loaded: PDFDocumentProxy | undefined;
    setDocument(undefined);
    setDocumentFailure(undefined);
    GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.mjs";
    void fetch(resource.uri, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`PDF bytes request failed with ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      loadingTask = getDocument({
        data: bytes,
        disableAutoFetch: true,
        disableRange: true,
        disableStream: true,
        enableXfa: false,
      });
      loaded = await loadingTask.promise;
      if (active) setDocument(loaded);
    }).catch((error: unknown) => {
      if (active && !controller.signal.aborted) {
        setDocumentFailure(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      active = false;
      controller.abort();
      setDocument(undefined);
      void loadingTask?.destroy();
      loaded?.cleanup();
    };
  }, [artifact.revision.id, resource?.uri]);

  const pages = snapshot?.payload.pages ?? [];
  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => pageHeight(pages[index]!, zoom) + PAGE_GAP,
    overscan: 1,
  });

  useEffect(() => virtualizer.measure(), [virtualizer, zoom, pages]);

  if (failure !== undefined) return <p className="artifact-status" role="alert">{failure}</p>;
  if (snapshot === undefined) return <p className="artifact-status" role="status">Adapting PDF revision…</p>;
  if (resource === undefined) return <p className="artifact-status" role="alert">The PDF snapshot has no document resource.</p>;

  const navigate = (pageIndex: number): void => {
    const next = Math.max(0, Math.min(snapshot.payload.pageCount - 1, pageIndex));
    setNavigation({ revisionId: artifact.revision.id, pageIndex: next });
    virtualizer.scrollToIndex(next, { align: "start" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "PageDown" || event.key === "ArrowRight") {
      event.preventDefault();
      navigate(activePageIndex + 1);
    } else if (event.key === "PageUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(activePageIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      navigate(0);
    } else if (event.key === "End") {
      event.preventDefault();
      navigate(snapshot.payload.pageCount - 1);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((value) => Math.min(200, value + 10));
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom((value) => Math.max(40, value - 10));
    }
  };

  return <section className="pdf-artifact-viewer" aria-label={`${snapshot.summary.label} PDF preview`}>
    <header className="pdf-view-toolbar">
      <div className="pdf-page-navigation">
        <button type="button" aria-label="Previous PDF page" disabled={activePageIndex === 0} onClick={() => navigate(activePageIndex - 1)}><CaretLeft aria-hidden="true" /></button>
        <output aria-live="polite">{activePageIndex + 1} / {snapshot.payload.pageCount}</output>
        <button type="button" aria-label="Next PDF page" disabled={activePageIndex >= snapshot.payload.pageCount - 1} onClick={() => navigate(activePageIndex + 1)}><CaretRight aria-hidden="true" /></button>
      </div>
      <DocumentZoomControls label="PDF zoom" value={zoom} onChange={setZoom} />
    </header>
    <div
      ref={scrollRef}
      className="pdf-page-scroll"
      tabIndex={0}
      aria-label="PDF pages"
      onKeyDown={onKeyDown}
    >
      {documentFailure !== undefined && <p className="artifact-status" role="alert">{documentFailure}</p>}
      {document === undefined && documentFailure === undefined && <p className="artifact-status" role="status">Loading PDF pages…</p>}
      <div className="pdf-page-stack" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const page = pages[item.index]!;
          return <div
            key={page.index}
            className="pdf-page-slot"
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${item.start}px)`, minHeight: `${pageHeight(page, zoom)}px` }}
          >
            <PdfPageCanvas document={document} page={page} zoom={zoom} />
          </div>;
        })}
      </div>
    </div>
    <footer className="pdf-diagnostics">
      <span>{snapshot.adapter.id}@{snapshot.adapter.version} · Read-only</span>
      <ArtifactDiagnostics diagnostics={snapshot.diagnostics} />
    </footer>
  </section>;
}

function PdfPageCanvas(props: {
  document?: PDFDocumentProxy;
  page: PdfPageSnapshot;
  zoom: number;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState<string>();
  const dimensions = useMemo(() => pageDimensions(props.page, props.zoom), [props.page, props.zoom]);
  useEffect(() => {
    if (props.document === undefined || canvasRef.current === null) return;
    let active = true;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    setFailure(undefined);
    void props.document.getPage(props.page.index).then((page) => {
      if (!active || canvasRef.current === null) return;
      const scale = props.zoom / 100;
      const viewport = page.getViewport({ scale });
      const deviceRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
      const ratio = Math.min(
        deviceRatio,
        PDF_ARTIFACT_PREVIEW_LIMITS.canvasDimensionPixels / viewport.width,
        PDF_ARTIFACT_PREVIEW_LIMITS.canvasDimensionPixels / viewport.height,
        Math.sqrt(PDF_ARTIFACT_PREVIEW_LIMITS.canvasAreaPixels / (viewport.width * viewport.height)),
      );
      const canvas = canvasRef.current;
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d", { alpha: false });
      if (context === null) throw new Error("Canvas 2D is unavailable.");
      const task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      renderTask = task;
      return task.promise.finally(() => page.cleanup());
    }).catch((error: unknown) => {
      if (active && (error as { name?: string }).name !== "RenderingCancelledException") {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [props.document, props.page.index, props.zoom]);
  return <figure className="pdf-page-frame" style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }} aria-label={`Page ${props.page.index}`}>
    <canvas ref={canvasRef} />
    {failure !== undefined && <figcaption role="alert">Page {props.page.index}: {failure}</figcaption>}
  </figure>;
}

function pageHeight(page: PdfPageSnapshot, zoom: number): number {
  return pageDimensions(page, zoom).height;
}

function pageDimensions(page: PdfPageSnapshot, zoom: number): { width: number; height: number } {
  const rotated = page.rotation === 90 || page.rotation === 270;
  const scale = zoom / 100;
  return {
    width: (rotated ? page.height : page.width) * scale,
    height: (rotated ? page.width : page.height) * scale,
  };
}
