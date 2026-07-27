#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./blast-radius/core.mjs";

export * from "./blast-radius/core.mjs";

const currentFile = fileURLToPath(import.meta.url);

function isCurrentEntrypoint(argvPath) {
  if (!argvPath) {
    return false;
  }
  try {
    return realpathSync(argvPath) === realpathSync(currentFile);
  } catch {
    return path.resolve(argvPath) === currentFile;
  }
}

if (isCurrentEntrypoint(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`blast-radius hook failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
