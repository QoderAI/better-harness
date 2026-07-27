#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  SCHEMA_VERSION,
  isCli,
  option,
  parseArgs,
  writeJsonResult,
} from "./common.mjs";

const ALLOWED_VERDICTS = new Set(["consistent", "mostly_consistent", "mixed", "inconsistent", "blocked"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

export function verdictForScore(score) {
  if (score >= 85) {
    return "consistent";
  }
  if (score >= 65) {
    return "mostly_consistent";
  }
  if (score >= 40) {
    return "mixed";
  }
  return "inconsistent";
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractJsonPayload(text) {
  const trimmed = String(text ?? "").trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed) {
      return parsed;
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const parsed = tryParseJson(trimmed.slice(firstBrace, lastBrace + 1));
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

export function normalizeQoderConsistencyResult(value) {
  const errors = [];
  const warnings = [];
  const result = value && typeof value === "object" ? value : {};
  const verdict = String(result.verdict ?? "");
  const score = Number(result.score);
  const confidence = String(result.confidence ?? "medium");

  if (!ALLOWED_VERDICTS.has(verdict)) {
    errors.push(`verdict must be one of ${[...ALLOWED_VERDICTS].join(", ")}`);
  }
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    errors.push("score must be a number from 0 to 100");
  }
  if (!ALLOWED_CONFIDENCE.has(confidence)) {
    warnings.push("confidence should be high, medium, or low; defaulting to medium");
  }

  const scoreVerdict = Number.isFinite(score) ? verdictForScore(score) : "inconsistent";
  if (ALLOWED_VERDICTS.has(verdict) && verdict !== "blocked" && scoreVerdict !== verdict) {
    warnings.push(`score ${score} maps to ${scoreVerdict}, but AI returned ${verdict}`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "qoder-consistency-result",
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs-review" : "ok",
    result: {
      verdict: ALLOWED_VERDICTS.has(verdict) ? verdict : "blocked",
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
      confidence: ALLOWED_CONFIDENCE.has(confidence) ? confidence : "medium",
      scoreVerdict,
      mismatches: normalizeStringList(result.mismatches),
      strengths: normalizeStringList(result.strengths),
      notes: result.notes ? String(result.notes) : "",
    },
    warnings,
    errors,
  };
}

export function parseAndNormalizeQoderOutput(text) {
  const payload = extractJsonPayload(text);
  if (!payload) {
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: "qoder-consistency-result",
      status: "invalid",
      result: {
        verdict: "blocked",
        score: 0,
        confidence: "low",
        scoreVerdict: "inconsistent",
        mismatches: [],
        strengths: [],
        notes: "",
      },
      warnings: [],
      errors: ["no JSON object found in Qoder output"],
    };
  }
  return normalizeQoderConsistencyResult(payload);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inputPath = option(args, "input");
  const text = inputPath && inputPath !== true
    ? readFileSync(String(inputPath), "utf8")
    : readFileSync(0, "utf8");
  await writeJsonResult(parseAndNormalizeQoderOutput(text), args);
}

if (isCli(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`qoder-consistency-schema failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
