import path from "node:path";
import { pathToFileURL } from "node:url";

import { openBrowser } from "../harness-analysis/preview-support/platform.mjs";

// A browser needs an absolute file URL: a bare Windows path is not a URL and a
// relative path would resolve against the browser rather than the shell.
export function reportFileUrl(outputPath) {
  return pathToFileURL(path.resolve(outputPath)).href;
}

// Opening is best effort. A missing handler must not fail a report that was
// already written, so the caller only learns whether the viewer was launched.
export function openRenderedReport(outputPath, { open = openBrowser } = {}) {
  return open(reportFileUrl(outputPath)) === true;
}
