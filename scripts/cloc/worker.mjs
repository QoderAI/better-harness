import { parentPort, workerData } from "node:worker_threads";

import { countFiles, countFilesSummary } from "./count-file.mjs";

const results = workerData.summary
  ? countFilesSummary(workerData.repoRoot, workerData.files, workerData.options)
  : countFiles(workerData.repoRoot, workerData.files, workerData.options);
parentPort.postMessage(results);
