import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canvasMediaCandidatesForApplication,
  qoderApplicationRoots,
  resolveCanvasRuntime,
} from "../scripts/harness-analysis/preview-support/canvas-runtime.mjs";
import { browserOpenCommand, parsePreviewPort } from "../scripts/harness-analysis/preview-support/platform.mjs";
import {
  createCanvasPreviewServer,
  createDefaultCanvasPreviewFixture,
} from "../scripts/harness-analysis/canvas-preview-server.mjs";
import { createHtmlPreviewServer } from "../dev/html-preview.mjs";

async function writeFixture(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function withTempDir(name, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.text();
}

test("HTML preview serves a report with preview-only reload injection", async () => {
  await withTempDir("better-harness-html-preview-", async (root) => {
    const reportPath = path.join(root, "report.html");
    const original = "<!doctype html><html><body><h1>Portable Report</h1></body></html>\n";
    await writeFile(reportPath, original);

    const preview = await createHtmlPreviewServer({
      reportPath,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      open: false,
    });

    try {
      assert.equal(await fetchText(`${preview.url}/health`), "ok");
      assert.match(await fetchText(`${preview.url}/__preview_version`), /^\d+$/);

      const served = await fetchText(`${preview.url}/`);
      assert.match(served, /Portable Report/);
      assert.match(served, /__betterHarnessPreview/);
      assert.equal(await readFile(reportPath, "utf8"), original);
    } finally {
      await preview.close();
    }
  });
});

test("Canvas preview serves health and a transformed module from media runtime files", async () => {
  await withTempDir("better-harness-canvas-preview-", async (root) => {
    const canvasPath = path.join(root, "insights.canvas.tsx");
    const mediaDir = path.join(root, "media");

    await writeFixture(
      canvasPath,
      [
        "import { Stack } from 'qoder/canvas';",
        "import reportData from './findings.json';",
        "export default function Report() {",
        "  return <Stack>{reportData.summary.projectName}</Stack>;",
        "}",
        "",
      ].join("\n"),
    );
    await writeFixture(path.join(root, "findings.json"), JSON.stringify({
      summary: { projectName: "Canvas Report" },
      findings: [],
    }));
    await writeFixture(path.join(mediaDir, "canvas-sdk.js"), "export function mountCanvas() {}\n");
    await writeFixture(
      path.join(mediaDir, "index-canvas.html"),
      '<html data-theme="__CANVAS_THEME_KIND__"><body style="background:__CANVAS_BG__;color:__CANVAS_FG__"><div id="root"></div><script>const vscodeVars = __CANVAS_VSCODE_VARS__;</script></body></html>\n',
    );

    const preview = await createCanvasPreviewServer({
      canvasPath,
      sdkMedia: mediaDir,
      host: "127.0.0.1",
      port: 0,
      watch: false,
      open: false,
    });

    try {
      assert.equal(await fetchText(`${preview.url}/health`), "ok");
      const darkHtml = await fetchText(`${preview.url}/`);
      const lightHtml = await fetchText(`${preview.url}/?theme=light`);
      assert.match(darkHtml, /data-theme="dark"/);
      assert.match(darkHtml, /"--vscode-editor-background":"#181818"/);
      assert.match(lightHtml, /data-theme="light"/);
      assert.match(lightHtml, /background:#FFFFFF;color:#1F1F1F/);
      assert.match(lightHtml, /"--vscode-editor-background":"#F7F7F5"/);
      assert.doesNotMatch(`${darkHtml}${lightHtml}`, /__CANVAS_[A-Z_]+__/u);
      const moduleCode = await fetchText(`${preview.url}/canvas-module.js`);
      assert.match(moduleCode, /Canvas Report/);
      assert.doesNotMatch(moduleCode, /from ['"]\.\/findings\.json['"]/);
      assert.match(moduleCode, /React\.createElement/);
    } finally {
      await preview.close();
      await preview.close();
    }
  });
});

test("default Canvas preview fixture exercises the canonical v23 Learning Capture template", async () => {
  const fixture = await createDefaultCanvasPreviewFixture();
  const preview = await createCanvasPreviewServer({
    canvasPath: fixture.canvasPath,
    host: "127.0.0.1",
    port: 0,
    watch: false,
    open: false,
  });

  try {
    const canvasData = JSON.parse(await readFile(path.join(fixture.root, "canvas.json"), "utf8"));
    assert.equal(canvasData.schemaVersion, 1);
    assert.equal(canvasData.dimensions[0]?.id, "learning-capture");
    assert.deepEqual(canvasData.dimensions[0]?.subdimensions.map((row) => row.id), [
      "lifecycle-repeat-detection",
      "loop-engineering",
      "later-validation",
    ]);
    assert.equal(await fetchText(`${preview.url}/health`), "ok");
    const moduleCode = await fetchText(`${preview.url}/canvas-module.js`);
    assert.match(moduleCode, /Learning Capture/);
    assert.doesNotMatch(moduleCode, /Longitudinal boundary|Longitudinal state|Completed stage/);
    assert.match(moduleCode, /Loop Engineering/);
    assert.match(moduleCode, /Specialized agent profiles available for delegated work/);
    assert.match(moduleCode, /\.qoder\/settings\.json/);
    assert.match(moduleCode, /function PracticeSourceCard/);
    assert.match(moduleCode, /Sources/);
    assert.doesNotMatch(moduleCode, /score 86|recommended limit of 10|Score unavailable/);
  } finally {
    await preview.close();
    await fixture.close();
  }
});

test("Canvas runtime resolver supports checkout and installed media layouts", async () => {
  await withTempDir("better-harness-canvas-runtime-", async (root) => {
    const checkout = path.join(root, "canvas-sdk");
    const mediaDir = path.join(root, "qoder-media");

    await writeFixture(path.join(checkout, "out", "canvas-sdk.js"), "checkout sdk\n");
    await writeFixture(path.join(checkout, "out", "canvas-sdk.js.map"), "{}\n");
    await writeFixture(path.join(checkout, "media", "index-canvas.html"), "checkout html\n");
    await writeFixture(path.join(mediaDir, "canvas-sdk.js"), "media sdk\n");
    await writeFixture(path.join(mediaDir, "index-canvas.html"), "media html\n");

    const mediaRuntime = resolveCanvasRuntime({
      repoRoot: root,
      sdkMedia: mediaDir,
      sdkRoot: checkout,
      env: {},
      candidateMediaDirs: [],
    });

    assert.equal(mediaRuntime.kind, "media");
    assert.equal(mediaRuntime.sdkPath, path.join(mediaDir, "canvas-sdk.js"));
    assert.equal(mediaRuntime.sdkMapPath, null);
    assert.equal(mediaRuntime.htmlTemplatePath, path.join(mediaDir, "index-canvas.html"));

    const checkoutRuntime = resolveCanvasRuntime({
      repoRoot: root,
      sdkRoot: checkout,
      env: {},
      candidateMediaDirs: [],
    });

    assert.equal(checkoutRuntime.kind, "sdk-root");
    assert.equal(checkoutRuntime.sdkPath, path.join(checkout, "out", "canvas-sdk.js"));
    assert.equal(checkoutRuntime.sdkMapPath, path.join(checkout, "out", "canvas-sdk.js.map"));
    assert.equal(checkoutRuntime.htmlTemplatePath, path.join(checkout, "media", "index-canvas.html"));
  });
});

test("Canvas runtime discovery is independent of the installed module directory name", async () => {
  await withTempDir("better-harness-qoder-app-", async (root) => {
    const appRoot = path.join(root, "Qoder", "resources", "app");
    const firstMedia = path.join(appRoot, "out", "client", "node", "canvasPreview", "media");
    const secondMedia = path.join(appRoot, "out", "workbench", "node", "canvasPreview", "media");

    await mkdir(firstMedia, { recursive: true });
    await mkdir(secondMedia, { recursive: true });

    assert.deepEqual(canvasMediaCandidatesForApplication(appRoot), [firstMedia, secondMedia]);
    assert.deepEqual(qoderApplicationRoots({ platform: "darwin", home: "/Users/example" }), [
      "/Applications/Qoder.app/Contents/Resources/app",
      path.join("/Users/example", "Applications", "Qoder.app", "Contents", "Resources", "app"),
    ]);
    assert.deepEqual(
      qoderApplicationRoots({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local" },
      }),
      [path.join("C:\\Users\\example\\AppData\\Local", "Qoder", "resources", "app")],
    );
    assert.deepEqual(qoderApplicationRoots({ platform: "linux" }), [
      "/opt/Qoder/resources/app",
      "/usr/share/qoder/resources/app",
    ]);
  });
});

test("Canvas runtime resolver fails fast when explicit media path is invalid", async () => {
  await withTempDir("better-harness-canvas-runtime-invalid-", async (root) => {
    const projectRoot = path.join(root, "workspace", "better-harness");
    const defaultCheckout = path.join(root, "workspace", "canvas-sdk");

    await mkdir(projectRoot, { recursive: true });
    await writeFixture(path.join(defaultCheckout, "out", "canvas-sdk.js"), "checkout sdk\n");
    await writeFixture(path.join(defaultCheckout, "media", "index-canvas.html"), "checkout html\n");

    assert.throws(
      () =>
        resolveCanvasRuntime({
          repoRoot: projectRoot,
          sdkMedia: path.join(root, "missing-media"),
          env: {},
          candidateMediaDirs: [],
        }),
      /--sdk-media/,
    );
  });
});

test("preview platform helpers keep ports and browser commands cross-platform", () => {
  assert.equal(parsePreviewPort("0", 58575), 0);
  assert.equal(parsePreviewPort(undefined, 58575), 58575);
  assert.throws(() => parsePreviewPort("bad", 58575), /Invalid port/);

  assert.deepEqual(browserOpenCommand("http://localhost:1234", "darwin"), {
    command: "open",
    args: ["http://localhost:1234"],
  });
  assert.deepEqual(browserOpenCommand("http://localhost:1234", "win32"), {
    command: "cmd",
    args: ["/c", "start", "", "http://localhost:1234"],
  });
  assert.deepEqual(browserOpenCommand("http://localhost:1234", "linux"), {
    command: "xdg-open",
    args: ["http://localhost:1234"],
  });
});

test("package scripts expose only packaged Canvas preview entrypoints", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.scripts.preview, "node scripts/harness-analysis/canvas-preview-server.mjs");
  assert.equal(packageJson.scripts["preview:canvas"], "node scripts/harness-analysis/canvas-preview-server.mjs");
  assert.equal(packageJson.scripts["preview:html"], undefined);
  assert.equal(Object.values(packageJson.scripts).some((command) => /node dev\//u.test(command)), false);
});
