import type { ArtifactDescriptor } from "../../artifact-model.js";
import { ArtifactPreviewHost } from "../ArtifactPreviewHost.js";
import { MarkdownArtifactView } from "../MarkdownArtifactView.js";
import { DocxArtifactView } from "./docx/DocxArtifactView.js";
import { ExternalHostedArtifactView } from "./ExternalHostedArtifactView.js";
import { ImageArtifactView } from "./ImageArtifactView.js";
import { PptxArtifactView } from "./pptx/PptxArtifactView.js";
import { PdfArtifactView } from "./pdf/PdfArtifactView.js";
import { TextArtifactView } from "./TextArtifactView.js";
import { XlsxArtifactView } from "./xlsx/XlsxArtifactView.js";
import type { ArtifactSurfaceKind, ArtifactSurfaceMount } from "./ArtifactSurface.js";

/** Normalize V2 compatibility aliases once at the protocol edge. */
export function normalizeArtifactSurfaceKind(artifact: ArtifactDescriptor): ArtifactSurfaceKind {
  if (artifact.renderer.status !== "ready" || artifact.renderer.type === "unavailable") return "unavailable";
  // Provider-defined renderer types are intentionally open-ended. The server
  // has already selected the external-hosted surface and validated `viewUri`
  // as a same-origin Artifact route, so the client follows that binding rather
  // than maintaining a second allowlist of provider renderer names.
  if (artifact.renderer.viewUri !== undefined) return "external-hosted";
  if (artifact.renderer.type === "native") return "native";
  if (artifact.renderer.type === "sandboxed-web") return "studio-sandbox";
  if (artifact.renderer.type === "qoder-canvas") return "external-hosted";
  return "unavailable";
}

const TEXT_RENDERER_IDS = new Set(["studio.code", "studio.diff", "studio.json", "studio.text"]);

export const ARTIFACT_SURFACE_MOUNTS: readonly ArtifactSurfaceMount[] = Object.freeze([
  {
    id: "studio.sandboxed-preview",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "studio-sandbox" && artifact.backing === "code",
    Component: ArtifactPreviewHost,
  },
  {
    id: "external-hosted",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "external-hosted" && artifact.renderer.viewUri !== undefined,
    Component: ExternalHostedArtifactView,
  },
  {
    id: "studio.markdown",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && artifact.renderer.id === "studio.markdown",
    Component: MarkdownArtifactView,
  },
  {
    id: "studio.docx-dom",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && artifact.renderer.id === "studio.docx-dom",
    Component: DocxArtifactView,
  },
  {
    id: "studio.pdf-canvas",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && artifact.renderer.id === "studio.pdf-canvas",
    Component: PdfArtifactView,
  },
  {
    id: "studio.pptx-dom",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && artifact.renderer.id === "studio.pptx-dom",
    Component: PptxArtifactView,
  },
  {
    id: "studio.xlsx-grid",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && artifact.renderer.id === "studio.xlsx-grid",
    Component: XlsxArtifactView,
  },
  {
    id: "studio.image",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && artifact.renderer.id === "studio.image",
    Component: ImageArtifactView,
  },
  {
    id: "studio.text-family",
    matches: (artifact) => normalizeArtifactSurfaceKind(artifact) === "native" && TEXT_RENDERER_IDS.has(artifact.renderer.id),
    Component: TextArtifactView,
  },
]);

export function resolveArtifactSurfaceMount(
  artifact: ArtifactDescriptor,
  mounts: readonly ArtifactSurfaceMount[] = ARTIFACT_SURFACE_MOUNTS,
): ArtifactSurfaceMount | undefined {
  return mounts.find((mount) => mount.matches(artifact));
}
