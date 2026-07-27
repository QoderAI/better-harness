import { createServer } from "node:http";
import { readFileSync, statSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertReadableFile, resolveCanvasRuntime } from "./runtime.mjs";
import { transformCanvasSource } from "./transform.mjs";
import {
  formatServerUrl,
  openBrowser,
} from "./platform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../..");

function send(res, status, type, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": type,
  });
  res.end(body);
}

const LIGHT_PREVIEW_THEME_REPLACEMENTS = Object.freeze([
  ['"#E4E4E499"', '"#6B6B6B"'],
  ['"#E4E4E466"', '"#1F1F1F66"'],
  ['"#E4E4E433"', '"#1F1F1F33"'],
  ['"#E4E4E411"', '"#1F1F1F11"'],
  ['"#E4E4E4"', '"#1F1F1F"'],
  ['"#181818"', '"#FFFFFF"'],
  ['"#333333"', '"#D8D8D8"'],
  ['"#2D2D2D"', '"#F3F3F3"'],
  ['"#3D3D3D"', '"#E8E8E8"'],
]);

const PREVIEW_VSCODE_THEME_VARS = Object.freeze({
  dark: Object.freeze({
    "--vscode-editor-background": "#181818",
    "--vscode-foreground": "#E4E4E4",
    "--vscode-descriptionForeground": "#E4E4E499",
    "--vscode-button-background": "#2A3A6E",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-button-hoverBackground": "#3A4A8E",
    "--vscode-button-secondaryBackground": "#2D2D2D",
    "--vscode-button-secondaryForeground": "#E4E4E4",
    "--vscode-button-secondaryHoverBackground": "#3D3D3D",
    "--vscode-focusBorder": "#2A3A6E",
    "--vscode-panel-border": "#333333",
    "--vscode-panel-background": "#181818",
    "--vscode-sideBar-background": "#181818",
    "--vscode-input-background": "#181818",
    "--vscode-input-border": "#333333",
    "--vscode-input-foreground": "#E4E4E4",
    "--vscode-list-hoverBackground": "#2A3A6E33",
    "--vscode-list-activeSelectionBackground": "#2A3A6E66",
    "--vscode-errorForeground": "#FC6B83",
    "--vscode-warningForeground": "#FFA500",
    "--vscode-infoForeground": "#2A3A6E",
    "--vscode-diffEditor-insertedLineBackground": "#0F3921",
    "--vscode-diffEditor-removedLineBackground": "#3E1419",
    "--vscode-diffEditor-insertedTextBackground": "#3FA26633",
    "--vscode-diffEditor-removedTextBackground": "#FC6B8333",
    "--vscode-disabledForeground": "#E4E4E466",
    "--vscode-symbolIcon-colorForeground": "#E4E4E433",
    "--vscode-textLink-foreground": "#7997FF",
    "--vscode-toolbar-hoverBackground": "#E4E4E411",
    "--vscode-widget-border": "#333333",
    "--vscode-panelSection-border": "#2D2D2D",
    "--vscode-testing-iconPassed": "#3FA266",
  }),
  light: Object.freeze({
    "--vscode-editor-background": "#F7F7F5",
    "--vscode-foreground": "#202124",
    "--vscode-descriptionForeground": "#666A73",
    "--vscode-button-background": "#5167D8",
    "--vscode-button-foreground": "#FFFFFF",
    "--vscode-button-hoverBackground": "#4055C5",
    "--vscode-button-secondaryBackground": "#ECEDEA",
    "--vscode-button-secondaryForeground": "#202124",
    "--vscode-button-secondaryHoverBackground": "#E2E3DF",
    "--vscode-focusBorder": "#5167D8",
    "--vscode-panel-border": "#DEDFDB",
    "--vscode-panel-background": "#F7F7F5",
    "--vscode-sideBar-background": "#F7F7F5",
    "--vscode-input-background": "#FFFFFF",
    "--vscode-input-border": "#D7D8D4",
    "--vscode-input-foreground": "#202124",
    "--vscode-list-hoverBackground": "#5167D812",
    "--vscode-list-activeSelectionBackground": "#5167D824",
    "--vscode-errorForeground": "#C23B4A",
    "--vscode-warningForeground": "#A76500",
    "--vscode-infoForeground": "#5167D8",
    "--vscode-diffEditor-insertedLineBackground": "#E7F4EA",
    "--vscode-diffEditor-removedLineBackground": "#FBE9EB",
    "--vscode-diffEditor-insertedTextBackground": "#2E8B5730",
    "--vscode-diffEditor-removedTextBackground": "#C23B4A26",
    "--vscode-disabledForeground": "#20212466",
    "--vscode-symbolIcon-colorForeground": "#20212433",
    "--vscode-textLink-foreground": "#4055C5",
    "--vscode-toolbar-hoverBackground": "#2021240A",
    "--vscode-widget-border": "#DEDFDB",
    "--vscode-panelSection-border": "#E7E8E4",
    "--vscode-testing-iconPassed": "#2E8B57",
  }),
});

function applyPreviewTheme(html, themeKind) {
  if (themeKind !== "light") return html;
  return LIGHT_PREVIEW_THEME_REPLACEMENTS.reduce(
    (source, [from, to]) => source.replaceAll(from, to),
    html,
  );
}

function renderHtml(htmlTemplatePath, themeKind = "dark") {
  const light = themeKind === "light";
  const html = readFileSync(htmlTemplatePath, "utf8")
    .replace(/__CANVAS_BG__/g, light ? "#FFFFFF" : "#181818")
    .replace(/__CANVAS_FG__/g, light ? "#1F1F1F" : "#E4E4E4")
    .replace(/__CANVAS_THEME_KIND__/g, light ? "light" : "dark")
    .replace(/__CANVAS_VSCODE_VARS__/g, JSON.stringify(PREVIEW_VSCODE_THEME_VARS[light ? "light" : "dark"]))
    .replace("data: new Map(),", "data: new Map(),");
  return applyPreviewTheme(html, themeKind);
}

export async function createCanvasPreviewServer({
  canvasPath,
  host = "127.0.0.1",
  port = 58575,
  watch: watchMode = false,
  open = false,
  sdkRoot,
  sdkMedia,
  env = process.env,
  repoRoot = defaultRepoRoot,
  candidateMediaDirs,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (!canvasPath) throw new Error("Canvas file is required; pass a .canvas.tsx path or use the CLI default preview fixture");
  const resolvedCanvasPath = path.resolve(resolvedRepoRoot, canvasPath);
  assertReadableFile(resolvedCanvasPath, "Canvas file");

  const runtime = resolveCanvasRuntime({
    repoRoot: resolvedRepoRoot,
    sdkRoot,
    sdkMedia,
    env,
    candidateMediaDirs,
  });

  let cachedModule = null;
  let cachedModuleSignature = "";
  let watcher = null;
  let closed = false;

  function buildCanvasModule() {
    const source = readFileSync(resolvedCanvasPath, "utf8");
    return transformCanvasSource(source, {
      runtime,
      sourcefile: path.relative(resolvedRepoRoot, resolvedCanvasPath),
      sourcePath: resolvedCanvasPath,
    });
  }

  function getCanvasModule() {
    const stat = statSync(resolvedCanvasPath);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (!cachedModule || cachedModuleSignature !== signature) {
      cachedModule = buildCanvasModule();
      cachedModuleSignature = signature;
    }
    return cachedModule;
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const themeKind = url.searchParams.get("theme") === "light" ? "light" : "dark";
        return send(res, 200, "text/html; charset=utf-8", renderHtml(runtime.htmlTemplatePath, themeKind));
      }
      if (url.pathname === "/canvas-sdk.js") {
        return send(res, 200, "application/javascript; charset=utf-8", readFileSync(runtime.sdkPath));
      }
      if (url.pathname === "/canvas-sdk.js.map" && runtime.sdkMapPath) {
        return send(res, 200, "application/json; charset=utf-8", readFileSync(runtime.sdkMapPath));
      }
      if (url.pathname === "/canvas-module.js") {
        return send(res, 200, "application/javascript; charset=utf-8", getCanvasModule().code);
      }
      if (url.pathname === "/canvas-module.js.map") {
        return send(res, 200, "application/json; charset=utf-8", getCanvasModule().map);
      }
      if (url.pathname === "/health") {
        return send(res, 200, "text/plain; charset=utf-8", "ok");
      }
      if (url.pathname === "/favicon.ico") {
        return send(res, 204, "image/x-icon", "");
      }
      return send(res, 404, "text/plain; charset=utf-8", `Not found: ${url.pathname}`);
    } catch (error) {
      console.error("[canvas-preview] error:", error);
      return send(res, 500, "text/plain; charset=utf-8", String(error?.stack ?? error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  if (watchMode) {
    watcher = watch(resolvedCanvasPath, () => {
      cachedModule = null;
      cachedModuleSignature = "";
      console.log(`[canvas-preview] Rebuilt ${path.relative(resolvedRepoRoot, resolvedCanvasPath)}`);
    });
  }

  const url = formatServerUrl(server.address(), host);
  if (open) {
    openBrowser(url);
  }

  return {
    server,
    url,
    canvasPath: resolvedCanvasPath,
    runtime,
    close: async () => {
      if (closed) return;
      closed = true;
      watcher?.close();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error?.code === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
