// GitHub Pages serves /inspector from inspector.html and /inspector/ from
// inspector/index.html, with no redirect between them. Docusaurus
// trailingSlash: false only emits inspector.html, so copy the same HTML into
// the directory index as a static alias. Canonical URLs stay slash-less.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function aliasInspectorTrailingSlash(buildRoot) {
  const sources = collectInspectorPages(buildRoot);
  if (sources.length === 0) {
    throw new Error(`No inspector.html found under ${buildRoot}`);
  }

  const written = [];
  for (const source of sources) {
    const target = join(dirname(source), "inspector", "index.html");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    written.push(target);
  }
  return written;
}

function collectInspectorPages(buildRoot) {
  const sources = [];
  const rootPage = join(buildRoot, "inspector.html");
  if (existsSync(rootPage)) {
    sources.push(rootPage);
  }

  for (const entry of readdirSync(buildRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "inspector") {
      continue;
    }
    const localePage = join(buildRoot, entry.name, "inspector.html");
    if (existsSync(localePage)) {
      sources.push(localePage);
    }
  }
  return sources;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const buildRoot = resolve(
    process.argv[2] ?? join(dirname(currentFile), "..", "build"),
  );
  const written = aliasInspectorTrailingSlash(buildRoot);
  console.log(`Aliased ${written.length} Inspector trailing-slash page(s).`);
}
