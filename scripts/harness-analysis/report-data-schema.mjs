import { readFileSync } from "node:fs";
import path from "node:path";

import { evaluateFindingsJson } from "./validate-canvas.mjs";
import {
  FINDING_TARGET_REPORT_CONTRACT_VERSION,
  isAgentWorkLoopReport,
} from "./fluency-dimensions.mjs";
import {
  isFullTaskLoopFindings,
  splitTaskLoopFindings,
  validateCompactTaskLoopFindings,
  validateTaskLoopFindings,
} from "./task-loop-report.mjs";
import { findingTargetErrors } from "../workspace-topology/index.mjs";

const ALLOWED_MODES = new Set(["qoder-canvas", "markdown", "html"]);
const ALLOWED_LANGUAGES = new Set(["en", "zh-CN"]);
const FINDING_OUTPUT_FIELDS = [
  "id",
  "title",
  "severity",
  "reason",
  "aiFixPrompt",
  "dimensionRefs",
  "target",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(`Cannot read JSON data ${filePath}: ${error.message}`), {
      code: "INVALID_JSON",
    });
  }
}

export function findingsJsonFromReportData(reportData) {
  if (isAgentWorkLoopReport(reportData)) {
    return {
      summary: reportData.summary,
      findings: reportData.findings,
    };
  }
  return {
    summary: reportData.summary,
    findings: reportData.findings.map((finding) => Object.fromEntries(
      FINDING_OUTPUT_FIELDS
        .filter((field) => finding[field] !== undefined)
        .map((field) => [field, finding[field]]),
    )),
  };
}

export function canvasArtifactsFromReportData(reportData) {
  const findings = findingsJsonFromReportData(reportData);
  if (isAgentWorkLoopReport(reportData)) {
    return splitTaskLoopFindings(findings);
  }
  return {
    findings,
    canvas: {
      schemaVersion: 1,
      summary: {},
      dimensions: [],
      findings: [],
    },
  };
}

function findingsDataShapeErrors(data) {
  const errors = [];
  if (!isObject(data)) {
    return ["report data must be a JSON object"];
  }
  if (!isObject(data.summary)) {
    errors.push("report data must include summary object");
  }
  if (!Array.isArray(data.findings)) {
    errors.push("report data must include findings array");
  }
  return errors;
}

function requiresPackageFindingTarget(rawData, topology) {
  return topology?.target?.kind === "workspace-member"
    && Number.isInteger(rawData?.summary?.reportContractVersion)
    && rawData.summary.reportContractVersion >= FINDING_TARGET_REPORT_CONTRACT_VERSION;
}

export function normalizeReportData(rawData, {
  mode = "qoder-canvas",
  language,
  target,
  dataPath,
  topology,
} = {}) {
  const errors = [];
  if (!ALLOWED_MODES.has(mode)) {
    errors.push(`unsupported mode: ${mode}`);
  }
  const inputLocale = rawData?.summary?.locale;
  const resolvedLanguage = language ?? (ALLOWED_LANGUAGES.has(inputLocale) ? inputLocale : "en");
  if (!ALLOWED_LANGUAGES.has(resolvedLanguage)) {
    errors.push(`unsupported language: ${resolvedLanguage}`);
  }
  errors.push(...findingsDataShapeErrors(rawData));

  if (errors.length === 0) {
    if (isAgentWorkLoopReport(rawData) && isFullTaskLoopFindings(rawData)) {
      errors.push(...validateTaskLoopFindings(rawData));
    } else if (isAgentWorkLoopReport(rawData)) {
      errors.push(...validateCompactTaskLoopFindings(rawData));
    } else {
      const findingsCheck = evaluateFindingsJson(JSON.stringify(rawData), null);
      errors.push(...findingsCheck.errors);
    }
  }
  if (Array.isArray(rawData?.findings) && topology) {
    const requireFindingTarget = requiresPackageFindingTarget(rawData, topology);
    for (const [index, finding] of rawData.findings.entries()) {
      errors.push(...findingTargetErrors(finding?.target, {
        topology,
        required: requireFindingTarget,
        requireOwnerRoute: finding?.target?.kind === "workspace-member",
        prefix: `findings[${index}].target`,
      }));
    }
  }

  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join("; ")), {
      code: "INVALID_FINDINGS",
      errors,
    });
  }

  const resolvedTarget = target
    ? path.resolve(target)
    : path.resolve(rawData.summary?.project?.path ?? ".");
  const summary = isAgentWorkLoopReport(rawData)
    ? { ...rawData.summary, locale: resolvedLanguage }
    : rawData.summary;

  return {
    mode,
    language: resolvedLanguage,
    dataPath: dataPath ? path.resolve(dataPath) : null,
    target: {
      name: rawData.summary?.project?.name ?? path.basename(resolvedTarget),
      path: resolvedTarget,
    },
    summary,
    findings: rawData.findings,
  };
}
