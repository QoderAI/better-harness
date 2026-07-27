import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function optionalFile(filePath) {
  return existsSync(filePath) ? filePath : null;
}

function asAbsolutePath(input, baseDir) {
  if (!input) {
    return null;
  }
  return path.resolve(baseDir, input);
}

function asMediaDir(input, baseDir) {
  const resolved = asAbsolutePath(input, baseDir);
  if (!resolved) {
    return null;
  }

  if (path.basename(resolved) === "canvas-sdk.js") {
    return path.dirname(resolved);
  }

  return resolved;
}

function runtimeFromMedia(input, baseDir, source) {
  const mediaDir = asMediaDir(input, baseDir);
  if (!mediaDir) {
    return null;
  }

  const sdkPath = path.join(mediaDir, "canvas-sdk.js");
  const htmlTemplatePath = path.join(mediaDir, "index-canvas.html");
  if (!existsSync(sdkPath) || !existsSync(htmlTemplatePath)) {
    return null;
  }

  return {
    kind: "media",
    source,
    mediaDir,
    sdkPath,
    sdkMapPath: optionalFile(path.join(mediaDir, "canvas-sdk.js.map")),
    htmlTemplatePath,
  };
}

function requireRuntimeFromMedia(input, baseDir, source, label) {
  const runtime = runtimeFromMedia(input, baseDir, source);
  if (!runtime) {
    throw new Error(`${label} must point to a directory containing canvas-sdk.js and index-canvas.html`);
  }
  return runtime;
}

function runtimeFromSdkRoot(input, baseDir, source) {
  const sdkRoot = asAbsolutePath(input, baseDir);
  if (!sdkRoot) {
    return null;
  }

  const sdkPath = path.join(sdkRoot, "out", "canvas-sdk.js");
  const htmlTemplatePath = path.join(sdkRoot, "media", "index-canvas.html");
  if (!existsSync(sdkPath) || !existsSync(htmlTemplatePath)) {
    return null;
  }

  return {
    kind: "sdk-root",
    source,
    sdkRoot,
    sdkPath,
    sdkMapPath: optionalFile(path.join(sdkRoot, "out", "canvas-sdk.js.map")),
    htmlTemplatePath,
  };
}

function requireRuntimeFromSdkRoot(input, baseDir, source, label) {
  const runtime = runtimeFromSdkRoot(input, baseDir, source);
  if (!runtime) {
    throw new Error(`${label} must point to a Canvas SDK checkout with out/canvas-sdk.js and media/index-canvas.html`);
  }
  return runtime;
}

export function qoderApplicationRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "darwin") {
    return [
      "/Applications/Qoder.app/Contents/Resources/app",
      path.join(home, "Applications", "Qoder.app", "Contents", "Resources", "app"),
    ];
  }

  if (platform === "win32") {
    return [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]]
      .filter(Boolean)
      .map((root) => path.join(root, "Qoder", "resources", "app"));
  }

  return ["/opt/Qoder/resources/app", "/usr/share/qoder/resources/app"];
}

export function canvasMediaCandidatesForApplication(appRoot) {
  const outDir = path.join(appRoot, "out");
  try {
    return readdirSync(outDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => path.join(outDir, entry.name, "node", "canvasPreview", "media"));
  } catch {
    return [];
  }
}

export function defaultCanvasMediaCandidates(options = {}) {
  const applicationRoots = options.applicationRoots ?? qoderApplicationRoots(options);
  return applicationRoots.flatMap((appRoot) => canvasMediaCandidatesForApplication(appRoot));
}

export function resolveCanvasRuntime({
  repoRoot,
  sdkRoot,
  sdkMedia,
  env = process.env,
  candidateMediaDirs = defaultCanvasMediaCandidates({ env }),
} = {}) {
  const baseDir = repoRoot ? path.resolve(repoRoot) : process.cwd();
  if (sdkMedia) {
    return requireRuntimeFromMedia(sdkMedia, baseDir, "sdk-media", "--sdk-media");
  }
  if (env.CANVAS_SDK_MEDIA_DIR) {
    return requireRuntimeFromMedia(
      env.CANVAS_SDK_MEDIA_DIR,
      baseDir,
      "CANVAS_SDK_MEDIA_DIR",
      "CANVAS_SDK_MEDIA_DIR",
    );
  }
  if (sdkRoot) {
    return requireRuntimeFromSdkRoot(sdkRoot, baseDir, "sdk-root", "--sdk-root");
  }
  if (env.CANVAS_SDK_ROOT) {
    return requireRuntimeFromSdkRoot(env.CANVAS_SDK_ROOT, baseDir, "CANVAS_SDK_ROOT", "CANVAS_SDK_ROOT");
  }

  const attempts = [
    () => runtimeFromSdkRoot(path.resolve(baseDir, "../canvas-sdk"), baseDir, "default-sdk-root"),
    ...candidateMediaDirs.map((candidate) => () => runtimeFromMedia(candidate, baseDir, "candidate-media")),
  ];

  for (const attempt of attempts) {
    const runtime = attempt();
    if (runtime) {
      return runtime;
    }
  }

  throw new Error("Missing Canvas SDK runtime. Provide --sdk-media, CANVAS_SDK_MEDIA_DIR, --sdk-root, or CANVAS_SDK_ROOT.");
}

export function assertReadableFile(filePath, label) {
  try {
    if (!statSync(filePath).isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}
