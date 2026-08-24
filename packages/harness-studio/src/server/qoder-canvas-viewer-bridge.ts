/**
 * Bridge to operator-provisioned Qoder Canvas viewers.
 *
 * Everything crossing this boundary is revision-scoped artifact data. Qoder
 * Canvas is one renderer provider behind the plugin registry; it is not the
 * Artifact View runtime.
 */
import { createReadStream, statSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import type { ServerResponse } from "node:http";
import { compileTrustedRendererModule, type CompiledTrustedRendererModule } from "./trusted-renderer-compiler.js";
import type { ArtifactEntry } from "./artifact-catalog.js";
import type { CanvasViewer } from "./artifact-viewers.js";

const MAX_VIEWER_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_VIEWER_DATA_BYTES = 128 * 1024 * 1024;

export interface QoderCanvasRuntime {
  sdkPath: string;
  sdkMapPath?: string;
  htmlTemplatePath: string;
}

export function resolveQoderCanvasRuntime(options: { sdkRoot?: string; sdkMedia?: string; cwd?: string } = {}): QoderCanvasRuntime | undefined {
  const cwd = options.cwd ?? process.cwd();
  const mediaCandidates = [
    options.sdkMedia,
    process.env.CANVAS_SDK_MEDIA_DIR,
  ].filter((value): value is string => value !== undefined);
  for (const media of mediaCandidates) {
    const found = runtimeFromMedia(resolve(cwd, media));
    if (found !== undefined) return found;
  }
  const rootCandidates = [
    options.sdkRoot,
    process.env.CANVAS_SDK_ROOT,
    resolve(cwd, "../canvas-sdk"),
    resolve(cwd, "../../canvas-sdk"),
    resolve(cwd, "../../../canvas-sdk"),
  ].filter((value): value is string => value !== undefined);
  for (const root of rootCandidates) {
    const found = runtimeFromRoot(resolve(cwd, root));
    if (found !== undefined) return found;
  }
  return undefined;
}

function runtimeFromMedia(media: string): QoderCanvasRuntime | undefined {
  const sdkPath = join(media, "canvas-sdk.js");
  const htmlTemplatePath = join(media, "index-canvas.html");
  try {
    if (!requireFile(sdkPath) || !requireFile(htmlTemplatePath)) return undefined;
    const sdkMapPath = requireFile(join(media, "canvas-sdk.js.map")) ? join(media, "canvas-sdk.js.map") : undefined;
    return { sdkPath, htmlTemplatePath, ...(sdkMapPath === undefined ? {} : { sdkMapPath }) };
  } catch {
    return undefined;
  }
}

function runtimeFromRoot(root: string): QoderCanvasRuntime | undefined {
  const sdkPath = join(root, "out", "canvas-sdk.js");
  const htmlTemplatePath = join(root, "media", "index-canvas.html");
  if (!requireFile(sdkPath) || !requireFile(htmlTemplatePath)) return undefined;
  const sdkMap = join(root, "out", "canvas-sdk.js.map");
  return { sdkPath, htmlTemplatePath, ...(requireFile(sdkMap) ? { sdkMapPath: sdkMap } : {}) };
}

function requireFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function prepareQoderCanvasViewer(
  entry: ArtifactEntry,
  viewer: CanvasViewer,
  runtime: QoderCanvasRuntime,
  moduleUrl: string,
): Promise<{ html: string; module: CompiledTrustedRendererModule }> {
  const payload = await adaptQoderCanvasViewerData(entry, viewer);
  const template = await readFile(runtime.htmlTemplatePath, "utf8");
  const safePayload = JSON.stringify(payload).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  const safeTarget = JSON.stringify(entry.label).replaceAll("<", "\\u003c");
  const bootstrap = `data: new Map(Object.entries(${safePayload})),\n        targetFilePath: ${safeTarget},`;
  const html = template
    .replaceAll("__CANVAS_BG__", "#ffffff")
    .replaceAll("__CANVAS_FG__", "#1f2328")
    .replaceAll("__CANVAS_THEME_KIND__", "light")
    .replaceAll("__CANVAS_VSCODE_VARS__", "undefined")
    .replace("data: new Map(),", bootstrap)
    .replace("</head>", "<script>globalThis.__aicodingCanvasBridge = { dispatchCanvasAction() {} };</script></head>")
    .replaceAll('mountCanvas("/canvas-module.js?v=1")', `mountCanvas(${JSON.stringify(moduleUrl)})`);
  return { html, module: await compileTrustedRendererModule(viewer.modulePath) };
}

export async function adaptQoderCanvasViewerData(entry: ArtifactEntry, viewer: CanvasViewer): Promise<Record<string, unknown>> {
  if (viewer.scriptPath === undefined || viewer.dataKey === undefined) {
    throw new Error("Canvas viewer has no target-file data adapter.");
  }
  const work = await mkdtemp(join(tmpdir(), "harness-studio-viewer-"));
  const target = join(work, `artifact${extname(entry.label)}`);
  const dataPath = join(work, "index.canvas.data.json");
  try {
    // Copying into the request directory prevents viewer scripts from reusing
    // a sibling index.canvas.data.json cache that belongs to another run.
    if ((await stat(entry.path)).size > MAX_VIEWER_INPUT_BYTES) throw new Error("Artifact exceeds the Canvas viewer input limit.");
    await copyFile(entry.path, target);
    await runSidecar(viewer.scriptPath, target, dataPath, work);
    if ((await stat(dataPath)).size > MAX_VIEWER_DATA_BYTES) throw new Error("Canvas viewer data exceeds the response limit.");
    const payload = JSON.parse(await readFile(dataPath, "utf8")) as Record<string, unknown>;
    const data = payload[viewer.dataKey];
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`Canvas viewer did not produce '${viewer.dataKey}'.`);
    }
    const record = data as Record<string, unknown>;
    const diagnosticError = Array.isArray(record.diagnostics)
      && record.diagnostics.some((item) => item !== null && typeof item === "object" && (item as { level?: unknown }).level === "error");
    if ((typeof record.error === "string" && record.error !== "") || diagnosticError) {
      throw new Error(typeof record.error === "string" && record.error !== "" ? record.error : "Canvas viewer reported an error diagnostic.");
    }
    if (typeof record.sourcePath === "string" && resolve(record.sourcePath) !== resolve(target)) {
      throw new Error("Canvas viewer data does not describe the requested artifact.");
    }
    // The viewer compares this with the host target to decide whether it needs
    // to rerun its sidecar. Use the catalog label on both sides and remove the
    // request-scoped sidecar path before serialising data into the browser.
    record.sourcePath = entry.label;
    delete record.canvasDataPath;
    return scrubRequestPaths(payload, work, entry.label) as Record<string, unknown>;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function scrubRequestPaths(value: unknown, requestRoot: string, label: string): unknown {
  if (typeof value === "string") return value.startsWith(requestRoot) ? label : value;
  if (Array.isArray(value)) return value.map((entry) => scrubRequestPaths(entry, requestRoot, label));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubRequestPaths(entry, requestRoot, label)]));
  }
  return value;
}

async function runSidecar(script: string, target: string, dataPath: string, cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...allowlistedSidecarEnvironment(process.env),
        AICODING_CANVAS_DATA: dataPath,
        QODER_CANVAS_DATA: dataPath,
        AICODING_CANVAS_SCRIPT_ARGS: JSON.stringify({ targetFilePath: target }),
        QODER_CANVAS_SCRIPT_ARGS: JSON.stringify({ targetFilePath: target }),
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString("utf8"); });
    child.stdout.resume();
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else {
        const diagnostic = stderr.trim()
          .replaceAll(script, "<provider-script>")
          .replaceAll(target, "<artifact>")
          .replaceAll(dataPath, "<provider-data>")
          .replaceAll(cwd, "<provider-work>");
        reject(new Error(`Canvas viewer data adapter failed (${signal ?? code ?? "unknown"}).${diagnostic === "" ? "" : ` ${diagnostic}`}`));
      }
    });
  });
}

function allowlistedSidecarEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC", "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL"];
  return Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])) as NodeJS.ProcessEnv;
}

export async function serveQoderCanvasRuntimeFile(response: ServerResponse, path: string, contentType: string): Promise<void> {
  const size = (await stat(path)).size;
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
  createReadStream(path).pipe(response);
}
