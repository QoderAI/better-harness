import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import {
  countFiles,
  countFilesSummary,
  languageRowsFromSummary,
  mergeCountSummaries,
} from "./count-file.mjs";
import { listInputFiles } from "./file-list.mjs";

export const CLOC_SCHEMA_VERSION = 1;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultWorkerCount() {
  const available = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(available || 1, 4));
}

function chooseWorkerCount(value, fileCount) {
  if (value !== undefined && value !== null && value !== "") {
    return positiveInt(value, 1);
  }
  if (fileCount < 512) {
    return 1;
  }
  return defaultWorkerCount();
}

function chunkFiles(files, workerCount) {
  const chunks = Array.from({ length: workerCount }, () => []);
  for (let index = 0; index < files.length; index += 1) {
    chunks[index % workerCount].push(files[index]);
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

function runWorker(repoRoot, files, options, { summary = false } = {}) {
  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.mjs");
  return new Promise((resolve, reject) => {
    let workerResult;
    const worker = new Worker(workerPath, {
      workerData: { repoRoot, files, options, summary },
    });
    worker.once("message", (result) => {
      workerResult = result;
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`cloc worker exited with code ${code}`));
        return;
      }
      resolve(workerResult);
    });
  });
}

async function countWithWorkers(repoRoot, files, options, workerCount) {
  if (workerCount <= 1 || files.length <= 1) {
    return countFiles(repoRoot, files, options);
  }

  const chunks = chunkFiles(files, Math.min(workerCount, files.length));
  const results = await Promise.all(chunks.map((chunk) => runWorker(repoRoot, chunk, options)));
  return results.flat();
}

async function countSummaryWithWorkers(repoRoot, files, options, workerCount) {
  if (workerCount <= 1 || files.length <= 1) {
    return countFilesSummary(repoRoot, files, options);
  }

  const chunks = chunkFiles(files, Math.min(workerCount, files.length));
  const summaries = await Promise.all(chunks.map((chunk) => runWorker(repoRoot, chunk, options, { summary: true })));
  return mergeCountSummaries(summaries);
}

function emptyTotals() {
  return {
    files: 0,
    lines: 0,
    blank: 0,
    comment: 0,
    code: 0,
    bytes: 0,
  };
}

function addCounts(target, source) {
  target.lines += source.lines;
  target.blank += source.blank;
  target.comment += source.comment;
  target.code += source.code;
}

function aggregateResults(results, { includeFiles = true } = {}) {
  const totals = emptyTotals();
  const languageStats = new Map();
  const files = [];
  const skippedFiles = [];

  for (const result of results) {
    if (result.skipped) {
      if (skippedFiles.length < 50) {
        skippedFiles.push({ path: result.path, reason: result.reason });
      }
      continue;
    }

    totals.files += 1;
    totals.bytes += result.bytes ?? 0;
    const languages = [];

    for (const record of result.records) {
      addCounts(totals, record);
      languages.push(record.language);
      const stats = languageStats.get(record.languageId) ?? {
        languageId: record.languageId,
        language: record.language,
        files: new Set(),
        lines: 0,
        blank: 0,
        comment: 0,
        code: 0,
        bytes: 0,
      };
      stats.files.add(result.path);
      addCounts(stats, record);
      stats.bytes += record.bytes ?? 0;
      languageStats.set(record.languageId, stats);
    }

    if (includeFiles) {
      files.push({
        path: result.path,
        bytes: result.bytes ?? 0,
        languages: [...new Set(languages)].sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  const languages = [...languageStats.values()]
    .map((item) => ({
      language: item.language,
      files: item.files.size,
      lines: item.lines,
      blank: item.blank,
      comment: item.comment,
      code: item.code,
      bytes: item.bytes,
    }))
    .sort((a, b) => b.code - a.code || b.comment - a.comment || a.language.localeCompare(b.language));

  return {
    totals,
    languages,
    files: includeFiles ? files.sort((a, b) => a.path.localeCompare(b.path)) : undefined,
    skippedFiles,
  };
}

export async function analyzeCloc(options = {}) {
  const started = process.hrtime.bigint();
  const paths = Array.isArray(options.paths) ? options.paths : [];
  const fileList = listInputFiles({
    cwd: options.cwd ?? process.cwd(),
    paths,
    useGit: options.useGit !== false,
    trackedOnly: Boolean(options.trackedOnly),
  });
  const workerCount = chooseWorkerCount(options.workers, fileList.files.length);
  const countOptions = {
    markdownCode: Boolean(options.markdownCode),
    maxFileBytes: options.maxFileBytes,
  };
  const includeFiles = options.includeFiles !== false;
  if (!includeFiles) {
    const summary = await countSummaryWithWorkers(fileList.root, fileList.files, countOptions, workerCount);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      schemaVersion: CLOC_SCHEMA_VERSION,
      kind: "cloc",
      status: "ok",
      root: fileList.root,
      fileList: {
        strategy: fileList.strategy,
        candidates: fileList.files.length,
        counted: summary.totals.files,
        skipped: summary.skipped,
      },
      workers: Math.min(workerCount, Math.max(1, fileList.files.length)),
      elapsedMs: Math.round(elapsedMs * 1000) / 1000,
      totals: summary.totals,
      languages: languageRowsFromSummary(summary),
      skippedFiles: summary.skippedFiles,
    };
  }

  const results = await countWithWorkers(fileList.root, fileList.files, countOptions, workerCount);
  const aggregate = aggregateResults(results, { includeFiles });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    schemaVersion: CLOC_SCHEMA_VERSION,
    kind: "cloc",
    status: "ok",
    root: fileList.root,
    fileList: {
      strategy: fileList.strategy,
      candidates: fileList.files.length,
      counted: aggregate.totals.files,
      skipped: results.length - aggregate.totals.files,
    },
    workers: Math.min(workerCount, Math.max(1, fileList.files.length)),
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
    totals: aggregate.totals,
    languages: aggregate.languages,
    skippedFiles: aggregate.skippedFiles,
    ...(aggregate.files ? { files: aggregate.files } : {}),
  };
}
