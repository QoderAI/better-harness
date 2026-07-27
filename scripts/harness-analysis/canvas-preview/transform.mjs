import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANVAS_IMPORT_SOURCE =
  "(?:qoder|aicoding|cursor)\\/canvas(?:\\/(?:tokens|palettes|core-primitives|hooks|format-viewer|chart-primitives|patterns|report-primitives|code-view))?";

function importRe(mod) {
  return new RegExp(`^[ \\t]*import[ \\t]+[\\s\\S]*?from[ \\t]+["']${mod}["'];?[ \\t]*\\r?\\n`, "gm");
}

export function loadEsbuildWasm(runtime = {}) {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire("esbuild-wasm");
  } catch (localError) {
    const bundledPackageRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/esbuild-wasm",
    );
    if (existsSync(path.join(bundledPackageRoot, "package.json"))) {
      return localRequire(bundledPackageRoot);
    }

    if (!runtime.sdkRoot) {
      throw localError;
    }

    const packageJson = path.join(runtime.sdkRoot, "package.json");
    if (!existsSync(packageJson)) {
      throw localError;
    }

    const sdkRequire = createRequire(pathToFileURL(packageJson));
    try {
      return sdkRequire("esbuild-wasm");
    } catch {
      throw localError;
    }
  }
}

export function stripCanvasRuntimeImports(source) {
  return String(source)
    .replace(importRe(CANVAS_IMPORT_SOURCE), "")
    .replace(importRe("react"), "")
    .replace(importRe("react\\/jsx-runtime"), "")
    .replace(importRe("react\\/jsx-dev-runtime"), "");
}

function inlineLocalJsonImports(source, { sourcePath } = {}) {
  if (!sourcePath) return String(source);
  const sourceDir = path.dirname(path.resolve(sourcePath));
  return String(source).replace(
    /^[ \t]*import[ \t]+([A-Za-z_$][\w$]*)[ \t]+from[ \t]+["'](\.\/[^"']+\.json)["'](?:[ \t]+(?:assert|with)[ \t]+\{[^}]*\})?;?[ \t]*\r?\n/gm,
    (_match, binding, specifier) => {
      const jsonPath = path.resolve(sourceDir, specifier);
      const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
      return `const ${binding} = ${JSON.stringify(parsed)};\n`;
    },
  );
}

export function transformCanvasSource(source, { sourcefile = "insights.canvas.tsx", sourcePath, runtime = {} } = {}) {
  const { transformSync } = loadEsbuildWasm(runtime);
  return transformSync(stripCanvasRuntimeImports(inlineLocalJsonImports(source, { sourcePath })), {
    loader: "tsx",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    format: "esm",
    target: "es2022",
    sourcefile,
    sourcemap: "external",
    logLevel: "silent",
  });
}
