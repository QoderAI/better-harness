#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runHarnessComparison } from "./runner.js";

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help());
    return 0;
  }
  const [command, manifestPath, ...rest] = argv;
  if (command !== "run" || !manifestPath) {
    process.stderr.write("Expected: harness-compare run <experiment.json> --out <directory>\n");
    return 2;
  }
  let outputDirectory: string | undefined;
  let trialCount: number | undefined;
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--out") outputDirectory = rest[++index];
    else if (flag === "--trials") trialCount = Number(rest[++index]);
    else if (flag === "--json") json = true;
    else {
      process.stderr.write(`Unknown option: ${flag}\n`);
      return 2;
    }
  }
  if (!outputDirectory) {
    process.stderr.write("--out is required so evidence has an explicit owner.\n");
    return 2;
  }
  try {
    const verdict = await runHarnessComparison({
      manifestPath,
      outputDirectory,
      ...(trialCount !== undefined ? { trialCount } : {}),
    });
    if (json) process.stdout.write(`${JSON.stringify(verdict)}\n`);
    else {
      process.stdout.write(
        `${verdict.status}: ${verdict.reason}\n` +
        `H0 ${verdict.baseline.passedTrials}/${verdict.baseline.completedTrials}, score ${verdict.baseline.meanScore}\n` +
        `H1 ${verdict.candidate.passedTrials}/${verdict.candidate.completedTrials}, score ${verdict.candidate.meanScore}\n` +
        `Evidence: ${resolve(outputDirectory)}\n`,
      );
    }
    return verdict.status === "reject" || verdict.status === "infrastructure_error" ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function help(): string {
  return `Harness comparison\n\n` +
    `Usage:\n  harness-compare run <experiment.json> --out <directory> [--trials <n>] [--json]\n\n` +
    `The command creates an isolated repository per harness/trial, invokes Qoder through\n` +
    `the official SDK, grades the resulting files, and writes immutable comparison evidence.\n`;
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await main(process.argv.slice(2));
}
