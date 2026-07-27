#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QoderSessionAnalyzer } from "./platforms/qoder.mjs";
import { sanitizePrivateReviewText } from "./privacy-safe-text.mjs";
import { isSessionAnalysisRef, sessionAnalysisRef } from "./session-ref.mjs";

export const USAGE_REVIEW_PACKET_SCHEMA_VERSION = 1;

export async function buildUsageReviewPacket({ source, workspace, home, limit = 8, sessionRefs = [] } = {}) {
  const usage = source?.insights?.keySignals?.usageEfficiency;
  if (!usage) throw new Error("source is missing insights.keySignals.usageEfficiency");
  const requestedRefs = sessionRefs.map((value) => String(value ?? "").trim()).filter(Boolean);
  const duplicateRefs = requestedRefs.filter((value, index) => requestedRefs.indexOf(value) !== index);
  if (duplicateRefs.length > 0) throw new Error(`duplicate --session-ref: ${duplicateRefs[0]}`);
  const invalidRef = requestedRefs.find((value) => !isSessionAnalysisRef(value));
  if (invalidRef) throw new Error(`invalid --session-ref: ${invalidRef}`);
  const analyzer = new QoderSessionAnalyzer();
  const analyzeOptions = { workspace, home, command: "sessions" };
  const inventory = await analyzer.analyze(analyzeOptions);
  const scope = await analyzer.resolveScope(analyzeOptions);
  const sessionsById = new Map(inventory.sessions.map((session) => [session.sessionId, session]));
  const sourceCandidates = usage.candidates.map((candidate, index) => ({
    candidate: {
      ...candidate,
      sessionRef: candidate.sessionRef ?? sessionAnalysisRef({
        sessionId: candidate.id,
        platform: "qoder",
        workspace,
      }),
    },
    index,
  }));
  const candidatesByRef = new Map(sourceCandidates.map((entry) => [entry.candidate.sessionRef, entry]));
  const selectedCandidates = requestedRefs.length > 0
    ? requestedRefs.map((sessionRef) => {
        const entry = candidatesByRef.get(sessionRef);
        if (!entry) throw new Error(`unknown --session-ref for supplied source: ${sessionRef}`);
        return entry;
      })
    : sourceCandidates.slice(0, Number(limit));
  if (selectedCandidates.length > Number(limit)) {
    throw new Error(`requested session refs exceed limit ${Number(limit)}`);
  }
  const candidates = [];

  for (const { candidate, index } of selectedCandidates) {
    const session = sessionsById.get(candidate.id);
    if (!session) {
      candidates.push({
        alias: `S${index + 1}`,
        sessionRef: candidate.sessionRef,
        status: "unavailable",
        role: candidate.role,
        candidateReasons: candidate.candidateReasons ?? [],
        reason: "session-not-found-in-current-inventory",
      });
      continue;
    }
    const events = await analyzer.readSession(session, scope, {
      includeContent: true,
      includeUserText: true,
      includeCommandText: false,
    });
    candidates.push(reviewCandidate(candidate, events, index));
  }

  return {
    schemaVersion: USAGE_REVIEW_PACKET_SCHEMA_VERSION,
    scope: {
      platform: "qoder",
      workspace: path.basename(workspace),
      selection: source.selection?.strategy ?? source.insights?.manifest?.selection?.strategy ?? "unknown",
    },
    accountingMode: usage.accountingMode,
    candidateCount: candidates.length,
    candidates,
    semanticReviewContract: {
      outcomes: ["fully-achieved", "mostly-achieved", "partially-achieved", "not-achieved", "unclear"],
      rawEvidenceBoundary: "private-review-packet-only",
      finalAliasesOnly: true,
      comparableModelOutcomeEvidence: usage.outcomeReview?.comparableModelOutcomeEvidence === true,
    },
  };
}

function reviewCandidate(candidate, events, index) {
  const userTexts = events
    .filter((event) => event.type === "user" || event.type === "last-prompt")
    .map((event) => event.userText ?? event.content)
    .filter(Boolean);
  const assistantTexts = events
    .filter((event) => event.type === "assistant" || event.type === "message")
    .map((event) => event.content)
    .filter(Boolean);
  const toolNames = countNames(events.map((event) => event.toolName).filter(Boolean));
  const eventTypes = countNames(events.map((event) => event.type).filter(Boolean));
  const failures = events.filter((event) => event.success === false || event.hasError || event.level === "error");
  return {
    alias: `S${index + 1}`,
    sessionRef: candidate.sessionRef,
    status: "reviewable",
    role: candidate.role,
    roleConfidence: candidate.roleConfidence,
    candidateReasons: candidate.candidateReasons ?? [],
    activeMinutes: minutes(candidate.activeMs),
    wallMinutes: minutes(candidate.wallMs),
    resumeCount: candidate.resumeCount,
    responseCount: candidate.responseCount,
    failureCount: candidate.failureCount,
    usageStatus: candidate.usageStatus,
    tokenTotals: candidate.tokenTotals,
    actualCost: candidate.actualCost,
    modelUsage: candidate.modelUsage,
    firstUserEvidence: sanitizePrivateReviewText(userTexts[0]),
    lastUserEvidence: sanitizePrivateReviewText(userTexts.at(-1)),
    finalAssistantEvidence: sanitizePrivateReviewText(assistantTexts.at(-1)),
    topTools: toolNames.slice(0, 8),
    topEventTypes: eventTypes.slice(0, 8),
    observedFailureTypes: countNames(failures.map((event) => event.type)).slice(0, 5),
  };
}

function countNames(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function minutes(value) {
  return Number((Number(value ?? 0) / 60_000).toFixed(1));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (key === "session-ref") {
      options["session-refs"] ??= [];
      options["session-refs"].push(argv[index + 1]);
    } else {
      options[key] = argv[index + 1];
    }
    index += 1;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.source || !options.workspace || !options.output) {
    throw new Error("usage: usage-review-packet.mjs --source <insights.json> --workspace <target> --output <review-packet.json> [--limit 8] [--session-ref <qsr1-...>]...");
  }
  const source = JSON.parse(await readFile(path.resolve(options.source), "utf8"));
  const packet = await buildUsageReviewPacket({
    source,
    workspace: path.resolve(options.workspace),
    home: options.home ? path.resolve(options.home) : undefined,
    limit: Number(options.limit ?? 8),
    sessionRefs: options["session-refs"] ?? [],
  });
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, candidateCount: packet.candidateCount })}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
