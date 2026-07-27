#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./test-mapping/core.mjs";

export * from "./test-mapping/core.mjs";

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`mapping-gate hook failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
