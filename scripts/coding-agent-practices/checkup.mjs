#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./checkup/cli.mjs";

export { buildCheckupPlan } from "./checkup/plan.mjs";
export {
  applyCheckupPlan,
  applySourcePatch,
  createQoderCliExecutor,
  createQoderCliVerificationExecutor,
} from "./checkup/apply.mjs";
export { buildCheckupScan, runCheckupScan } from "./checkup/scan.mjs";

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`harness checkup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
