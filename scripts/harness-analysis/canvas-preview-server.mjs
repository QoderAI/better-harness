#!/usr/bin/env node

import {
  createCanvasPreviewServer,
  createDefaultCanvasPreviewFixture,
  isDirectModule,
  runCanvasPreviewCli,
} from "./canvas-preview/index.mjs";

export { createCanvasPreviewServer, createDefaultCanvasPreviewFixture };

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  return runCanvasPreviewCli(argv, dependencies);
}

if (isDirectModule(import.meta.url)) {
  main().catch((error) => {
    console.error("[canvas-preview] error:", error);
    process.exit(1);
  });
}
