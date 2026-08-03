import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseArgs, parseBooleanFlag } from "../../session-analysis/index.mjs";
import { applyCheckupPlan } from "./apply.mjs";
import { buildCheckupPlan } from "./plan.mjs";
import { runCheckupScan } from "./scan.mjs";

const CHECKUP_HELP = `Usage: better-harness harness checkup [scan|plan|apply] [options]

Scan agent customizations and produce a read-only cleanup plan.

Options:
  --phase <scan|plan|apply> Select the checkup phase
  --workspace <path>        Analyze this workspace
  --provider <name>         Select an agent provider
  --plan <path>             Read a plan for the apply phase
  --json                    Emit JSON output
  -h, --help                Print help
`;

function optionsFromArgs(options) {
  return {
    provider: options.provider,
    locale: options.locale,
    workspace: options.workspace,
    workspaceLabel: options["workspace-label"],
    since: options.since,
    until: options.until,
    now: options.now,
    windowDays: options["window-days"],
    sessionLimit: options.limit,
    selection: options.selection,
    minimumSessions: options["minimum-sessions"],
    newInstallGraceDays: options["new-install-grace-days"],
    includeGlobalCapabilities: parseBooleanFlag(options["include-global-capabilities"] ?? false),
    qoderHome: options["qoder-home"],
    qoderSharedClientCacheRoot: options["qoder-shared-client-cache-root"] ?? options["shared-client-cache-root"],
    codexHome: options["codex-home"],
    claudeHome: options["claude-home"],
    claudeStatePath: options["claude-state"],
    cursorHome: options["cursor-home"],
    friction: options.friction,
    frictionStrength: options["friction-strength"],
    frictionObservationCount: options["friction-observations"],
    frictionSource: options["friction-source"],
    skillOwnerSelected: parseBooleanFlag(options["skill-owner-selected"] ?? false),
  };
}

function statusCounts(findings) {
  const counts = {};
  for (const finding of findings ?? []) {
    counts[finding.status] = (counts[finding.status] ?? 0) + 1;
  }
  return counts;
}

function capabilityLabel(kind) {
  return kind === "skill" ? "Skills" : kind === "mcp" ? "MCP servers" : "Plugins";
}

export function formatMarkdown(result) {
  const lines = ["# Harness Customization Checkup", ""];
  lines.push(`Phase: ${result.phase}`);
  lines.push(`Provider: ${result.provider}`);
  lines.push(`Workspace: ${result.workspace}`);
  if (result.phase === "apply") {
    lines.push(`Plan digest: ${result.planDigest}`);
    lines.push(`Applied: ${result.summary.applied}; failed: ${result.summary.failed}; manual review: ${result.summary.manualReviewRequired}`);
    lines.push("", "## Results", "");
    for (const row of result.results) lines.push(`- ${row.actionId}: ${row.status}`);
    lines.push("", result.verificationBoundary);
    return `${lines.join("\n")}\n`;
  }
  const selectionLabel = result.observationWindow.selection === "all-eligible"
    ? "all-eligible; complete eligible population"
    : `max ${result.observationWindow.sessionLimit} sessions, ${result.observationWindow.selection}`;
  lines.push(
    `Window: ${result.observationWindow.since} to ${result.observationWindow.until} (${selectionLabel})`,
  );
  lines.push(
    `Coverage: ${result.coverage.analyzedSessions}/${result.coverage.eligibleSessions} sessions analyzed; ` +
      `${result.coverage.sufficient ? "diagnostically sufficient" : "not sufficient"}; ` +
      `${result.coverage.cleanupEligible ? "cleanup census complete" : `cleanup blocked (${result.coverage.cleanupReason})`}`,
  );
  lines.push("");
  lines.push("## Status");
  lines.push("");
  const counts = statusCounts(result.findings);
  for (const status of ["observed", "configured-only", "unobserved", "candidate", "healthy", "unavailable"]) {
    lines.push(`- ${status}: ${counts[status] ?? 0}`);
  }
  const capabilityUse = result.summary?.capabilityUse ?? [];
  if (capabilityUse.length > 0) {
    lines.push("", "## Capability Use And Cleanup Eligibility", "");
    for (const row of capabilityUse) {
      const notObserved = Number(row.unobserved ?? 0) + Number(row.configuredOnly ?? 0) + Number(row.unavailable ?? 0);
      const blockers = Object.entries(row.blockers ?? {})
        .map(([reason, count]) => `${reason}=${count}`)
        .join(", ");
      lines.push(
        `- ${capabilityLabel(row.kind)}: configured ${row.configured}; observed ${row.observed}; ` +
          `not observed ${notObserved}; cleanup candidates ${row.candidate}` +
          `${blockers ? `; blockers: ${blockers}` : ""}`,
      );
    }
    if (!result.coverage.cleanupEligible) {
      lines.push("- Cleanup actions are withheld. Re-run with --selection all-eligible to complete the selected-window census.");
    }
  }
  const attention = result.summary?.attention ?? [];
  if (attention.length > 0) {
    lines.push("", "## Attention (Diagnostic, No Automatic Action)", "");
    for (const finding of attention) {
      lines.push(`- ${finding.title} (${finding.scope}; ${finding.evidenceCodes.join(", ")})`);
    }
  }
  const candidates = result.findings.filter((finding) => finding.status === "candidate");
  if (candidates.length > 0) {
    lines.push("", "## Review Candidates", "");
    for (const finding of candidates) {
      lines.push(`- ${finding.title} (${finding.scope})`);
    }
  }
  if (result.phase === "plan") {
    lines.push("", "## Read-only Plan", "");
    lines.push(`Plan digest: ${result.planDigest}`);
    lines.push(`Actions: ${result.actions.length}`);
    lines.push("No configuration was changed. Apply requires this digest and explicit action ids.");
  } else {
    lines.push("", "No configuration was changed. Run with --phase plan to produce reviewable disable-first actions.");
  }
  return `${lines.join("\n")}\n`;
}

function selectedActionIds(options) {
  return String(options["action-ids"] ?? options["action-id"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function readPlan(filePath) {
  if (!filePath) throw new Error("--phase apply requires --plan <plan.json>");
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    process.stdout.write(CHECKUP_HELP);
    return;
  }
  const { command, options } = parseArgs(argv);
  const phase = options.phase ?? command ?? "scan";
  if (!new Set(["scan", "plan", "apply"]).has(phase)) {
    throw new Error(`Unsupported checkup phase: ${phase}. Supported phases: scan, plan, apply.`);
  }
  let result;
  if (phase === "apply") {
    const plan = await readPlan(options.plan);
    const baseOptions = optionsFromArgs(options);
    if (options["confirm-plan-digest"] !== plan.planDigest) {
      throw new Error("--confirm-plan-digest must exactly match the supplied plan before current evidence is read");
    }
    const currentPlan = dependencies.currentPlan ?? buildCheckupPlan(await runCheckupScan({
      ...baseOptions,
      since: plan.observationWindow?.since,
      until: plan.observationWindow?.until,
      sessionLimit: plan.observationWindow?.sessionLimit,
      selection: plan.observationWindow?.selection,
      minimumSessions: plan.observationWindow?.minimumSessions,
      newInstallGraceDays: plan.observationWindow?.newInstallGraceDays,
      includeGlobalCapabilities: plan.observationWindow?.includeGlobalCapabilities,
      friction: baseOptions.friction ?? plan.repeatedFrictionTriage?.reasonCodes?.join(","),
      frictionStrength: baseOptions.frictionStrength ?? plan.repeatedFrictionTriage?.observationBoundary?.strength,
      frictionObservationCount:
        baseOptions.frictionObservationCount ?? plan.repeatedFrictionTriage?.observationBoundary?.observationCount,
      frictionSource: baseOptions.frictionSource ?? plan.repeatedFrictionTriage?.observationBoundary?.source,
      skillOwnerSelected: baseOptions.skillOwnerSelected ?? plan.repeatedFrictionTriage?.skillDiscovery?.selected,
    }, dependencies));
    result = await applyCheckupPlan(plan, {
      ...baseOptions,
      now: options.now,
      confirmationDigest: options["confirm-plan-digest"],
      selectedActionIds: selectedActionIds(options),
      currentPlan,
    }, dependencies);
  } else {
    const scan = await runCheckupScan(optionsFromArgs(options), dependencies);
    result = phase === "plan" ? buildCheckupPlan(scan) : scan;
  }
  if (parseBooleanFlag(options.json ?? false)) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatMarkdown(result));
  }
  return result;
}
