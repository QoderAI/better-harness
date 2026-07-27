#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyReportSourceReview } from "./report-source/apply-review.mjs";

export { applyReportSourceReview } from "./report-source/apply-review.mjs";

export const APPLY_SOURCE_REVIEW_HELP = `Usage: better-harness harness apply-review --source <report.source.json> --review <review.json> --packet <review.packet.json> [--json]

Merge a bounded AI review input into a code-generated Harness report source.
The command binds every review ref to the current source packet, validates the
complete reviewed source, and only then replaces it.
`;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") options.help = true;
    else if (value === "--json") options.json = true;
    else if (value.startsWith("--")) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value`);
      options[value.slice(2)] = next;
      index += 1;
    }
  }
  return options;
}

export async function runApplySourceReviewCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return process.stdout.write(APPLY_SOURCE_REVIEW_HELP);
  if (!options.source || !options.review || !options.packet) throw new Error("--source, --review, and --packet are required");
  const sourcePath = path.resolve(options.source);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const review = JSON.parse(await readFile(path.resolve(options.review), "utf8"));
  const packet = JSON.parse(await readFile(path.resolve(options.packet), "utf8"));
  const reviewed = applyReportSourceReview(source, review, { packet });
  await writeFile(sourcePath, `${JSON.stringify(reviewed, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: "reviewed", source: sourcePath })}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  runApplySourceReviewCli().catch((error) => {
    process.stderr.write(`source review failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
