#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./hook.mjs";

export { DEFAULT_CONFIG, loadConfig } from "./config.mjs";
export { parseUnifiedDiff, parseUnifiedDiffDetails } from "./git.mjs";
export { buildCodeGraph, mapChangedSymbols } from "./graph.mjs";
export { extractSymbolsFromSource } from "./parser.mjs";
export { analyzeRepository } from "./analysis.mjs";
export { formatReviewMessage, main, runHook } from "./hook.mjs";

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`blast-radius hook failed: ${error.stack ?? error.message}
`);
    process.exitCode = 1;
  });
}
