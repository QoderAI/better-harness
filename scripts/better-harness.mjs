#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./better-harness-cli/cli.mjs";

const currentFile = fileURLToPath(import.meta.url);

export { main, resolveDispatch } from "./better-harness-cli/cli.mjs";

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
  process.exitCode = main();
}
