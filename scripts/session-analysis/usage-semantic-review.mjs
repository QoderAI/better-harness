#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const USAGE_SEMANTIC_REVIEW_SCHEMA_VERSION = 1;

const TASK_FAMILIES = new Set(["implementation", "debugging", "architecture", "report-analysis", "review", "setup-runtime", "other"]);
const OUTCOMES = new Map([
  ["fully-achieved", 4],
  ["mostly-achieved", 3],
  ["partially-achieved", 2],
  ["not-achieved", 1],
  ["unclear", 0],
]);
const FRICTIONS = new Set(["wrong-direction", "repeated-tool-failure", "validation-gap", "requirement-ambiguity", "user-interruption", "context-resume-bloat", "none-observed"]);
const CONFIDENCE = new Set(["High", "Medium", "Low"]);

export function validateUsageSemanticReview({ packet, review }) {
  const errors = [];
  if (review?.schemaVersion !== USAGE_SEMANTIC_REVIEW_SCHEMA_VERSION) errors.push(`review schemaVersion must be ${USAGE_SEMANTIC_REVIEW_SCHEMA_VERSION}`);
  if (!Array.isArray(review?.reviews) || review.reviews.length === 0) return [...errors, "review must contain at least one reviewed candidate"];
  const candidates = new Map((packet?.candidates ?? []).map((candidate) => [candidate.alias, candidate]));
  const seen = new Set();
  for (const [index, row] of review.reviews.entries()) {
    const at = `reviews[${index}]`;
    if (!candidates.has(row?.alias)) errors.push(`${at}.alias is not present in the review packet`);
    if (seen.has(row?.alias)) errors.push(`${at}.alias is duplicated`);
    seen.add(row?.alias);
    if (!TASK_FAMILIES.has(row?.taskFamily)) errors.push(`${at}.taskFamily is unsupported`);
    if (!OUTCOMES.has(row?.outcome)) errors.push(`${at}.outcome is unsupported`);
    if (!FRICTIONS.has(row?.friction)) errors.push(`${at}.friction is unsupported`);
    if (!CONFIDENCE.has(row?.confidence)) errors.push(`${at}.confidence is unsupported`);
    if (typeof row?.evidenceReason !== "string" || row.evidenceReason.trim().length < 12 || row.evidenceReason.length > 240) {
      errors.push(`${at}.evidenceReason must contain 12 to 240 characters`);
    }
  }
  return errors;
}

export function summarizeModelFit({ packet, review }) {
  const errors = validateUsageSemanticReview({ packet, review });
  if (errors.length > 0) return { status: "invalid", errors };
  const candidates = new Map(packet.candidates.map((candidate) => [candidate.alias, candidate]));
  const reviewedRows = review.reviews.map((row) => ({ row, candidate: candidates.get(row.alias) }));
  const reviewedSessionRefs = uniqueStrings(reviewedRows.map(({ candidate }) => candidate?.sessionRef));
  const reviewedActiveLongSessionRefs = uniqueStrings(reviewedRows
    .filter(({ candidate }) => candidate?.candidateReasons?.includes("active-long"))
    .map(({ candidate }) => candidate?.sessionRef));
  const reviewedActiveLongCount = reviewedRows.filter(({ candidate }) =>
    candidate?.candidateReasons?.includes("active-long")
  ).length;
  const comparable = review.reviews
    .map((row) => ({ ...row, candidate: candidates.get(row.alias) }))
    .filter((row) => row.outcome !== "unclear" && row.confidence !== "Low" && row.candidate?.modelUsage?.length === 1)
    .map((row) => ({
      taskFamily: row.taskFamily,
      model: row.candidate.modelUsage[0].model,
      outcomeScore: OUTCOMES.get(row.outcome),
      activeMinutes: Number(row.candidate.activeMinutes ?? 0),
      responseCount: Number(row.candidate.responseCount ?? 0),
      actualCost: row.candidate.actualCost?.available ? Number(row.candidate.actualCost.amount) : null,
    }));
  const byFamily = groupBy(comparable, (row) => row.taskFamily);
  const comparisons = [];
  for (const [taskFamily, rows] of byFamily) {
    const byModel = groupBy(rows, (row) => row.model);
    const models = [...byModel.entries()]
      .map(([model, samples]) => summarizeModel(model, samples))
      .filter((model) => model.sampleCount >= 2);
    if (models.length < 2) continue;
    models.sort((left, right) => right.averageOutcome - left.averageOutcome
      || left.averageActiveMinutes - right.averageActiveMinutes
      || nullableAscending(left.averageActualCost, right.averageActualCost)
      || left.model.localeCompare(right.model));
    comparisons.push({ taskFamily, models, candidateModel: models[0].model });
  }
  if (comparisons.length === 0) {
    return {
      status: "controlled-a-b-required",
      comparableModelOutcomeEvidence: false,
      reviewedCandidateCount: review.reviews.length,
      reviewedActiveLongCount,
      reviewedSessionRefs,
      reviewedActiveLongSessionRefs,
      reason: "need-two-reviewed-samples-per-model-in-the-same-task-family",
    };
  }
  return {
    status: "candidate-model-fit",
    comparableModelOutcomeEvidence: true,
    reviewedCandidateCount: review.reviews.length,
    reviewedActiveLongCount,
    reviewedSessionRefs,
    reviewedActiveLongSessionRefs,
    comparisons,
  };
}

export function applyUsageSemanticReview({ source, packet, review }) {
  const summary = summarizeModelFit({ packet, review });
  if (summary.status === "invalid") return { source: null, errors: summary.errors };
  const output = structuredClone(source);
  const usage = output?.insights?.keySignals?.usageEfficiency;
  if (!usage) return { source: null, errors: ["source is missing insights.keySignals.usageEfficiency"] };
  const previous = usage.outcomeReview ?? {};
  const reviewedSessionRefs = uniqueStrings([
    ...(previous.reviewedSessionRefs ?? []),
    ...(summary.reviewedSessionRefs ?? []),
  ]);
  const reviewedActiveLongSessionRefs = uniqueStrings([
    ...(previous.reviewedActiveLongSessionRefs ?? []),
    ...(summary.reviewedActiveLongSessionRefs ?? []),
  ]);
  usage.outcomeReview = {
    ...summary,
    reviewedSessionRefs,
    reviewedActiveLongSessionRefs,
    reviewedCandidateCount: Math.max(
      Number(previous.reviewedCandidateCount ?? 0),
      Number(summary.reviewedCandidateCount ?? 0),
      reviewedSessionRefs.length,
    ),
    reviewedActiveLongCount: Math.max(
      Number(previous.reviewedActiveLongCount ?? 0),
      Number(summary.reviewedActiveLongCount ?? 0),
      reviewedActiveLongSessionRefs.length,
    ),
  };
  return { source: output, errors: [] };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function summarizeModel(model, samples) {
  const costs = samples.map((row) => row.actualCost).filter((value) => value !== null);
  return {
    model,
    sampleCount: samples.length,
    averageOutcome: average(samples.map((row) => row.outcomeScore)),
    averageActiveMinutes: average(samples.map((row) => row.activeMinutes)),
    averageResponseCount: average(samples.map((row) => row.responseCount)),
    averageActualCost: costs.length === samples.length ? average(costs) : null,
  };
}

function average(values) {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function nullableAscending(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function groupBy(values, keyFn) {
  const result = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const rows = result.get(key) ?? [];
    rows.push(value);
    result.set(key, rows);
  }
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    options[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.source || !options.packet || !options.review || !options.output) {
    throw new Error("usage: usage-semantic-review.mjs --source <insights.json> --packet <review-packet.json> --review <review.json> --output <reviewed-insights.json>");
  }
  const [source, packet, review] = await Promise.all([options.source, options.packet, options.review].map(async (file) => JSON.parse(await readFile(path.resolve(file), "utf8"))));
  const result = applyUsageSemanticReview({ source, packet, review });
  if (result.errors.length > 0) throw new Error(result.errors.join("\n"));
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.source, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath })}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
