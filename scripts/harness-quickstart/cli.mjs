#!/usr/bin/env node

// Quickstart bridge: gather static evidence with sibling capability CLIs, then
// hand off to the Better Harness skill, which owns report synthesis. This
// command never writes a report itself; it only prepares evidence and points at
// the skill, keeping product judgment in the skill and not in code.

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENT_WORK_LOOP_MODEL_ID } from "../harness-analysis/fluency-dimensions.mjs";

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MORE_EVIDENCE = [
  "better-harness core-change-watch evidence-pack --json",
  "better-harness dependency-governance --json",
  "better-harness coding-agent-practices inventory qoder",
];

const HELP = `Usage: better-harness report [options]

Quickstart for a five-minute readiness report. Gathers static evidence, then
hands off to the Better Harness skill, which synthesizes the report.

Options:
  --cwd <dir>     Repository to inspect (default: current directory)
  --qoder-home <dir>  Qoder data root for the session-source probe (default: ~/.qoder)
  --no-sessions   Skip session probing and use the static Software Fluency route
  --json          Emit machine-readable evidence and handoff as JSON
  -h, --help      Print this help
`;

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      options[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[body] = next;
      index += 1;
    } else {
      options[body] = true;
    }
  }
  return options;
}

function runEvidence(relScript, cwd) {
  const result = spawnSync(process.execPath, [path.join(scriptsRoot, relScript), "--json"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    return { available: false, hint: `node scripts/${relScript} --json` };
  }
  try {
    return { available: true, data: JSON.parse(result.stdout) };
  } catch {
    return { available: false, hint: `node scripts/${relScript} --json produced unparseable JSON` };
  }
}

function runSessionProbe(cwd, qoderHome) {
  const args = [
    path.join(scriptsRoot, "session-analysis.mjs"),
    "sessions",
    "--platform",
    "qoder",
    "--workspace",
    cwd,
    "--limit",
    "1",
  ];
  if (qoderHome) args.push("--qoder-home", path.resolve(String(qoderHome)));
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !result.stdout) {
    return { available: false, usableSessionCount: 0, modelId: "software-fluency", route: "static-fallback" };
  }
  try {
    const data = JSON.parse(result.stdout);
    const usableSessionCount = Array.isArray(data.sessions) ? data.sessions.length : 0;
    const sessionInformed = usableSessionCount > 0;
    return {
      available: true,
      usableSessionCount,
      modelId: sessionInformed ? AGENT_WORK_LOOP_MODEL_ID : "software-fluency",
      route: sessionInformed ? "bavi" : "static-fallback",
    };
  } catch {
    return { available: false, usableSessionCount: 0, modelId: "software-fluency", route: "static-fallback" };
  }
}

function staticSessionRoute() {
  return { available: false, usableSessionCount: 0, modelId: "software-fluency", route: "static-fallback" };
}

function cwdValidationError(cwd) {
  try {
    const stat = statSync(cwd);
    if (!stat.isDirectory()) {
      return {
        code: "INVALID_CWD",
        message: `Repository cwd is not a directory: ${cwd}`,
        hint: "Pass --cwd with an existing repository directory.",
      };
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        code: "INVALID_CWD",
        message: `Repository cwd does not exist: ${cwd}`,
        hint: "Pass --cwd with an existing repository directory.",
      };
    }
    return {
      code: "INVALID_CWD",
      message: `Repository cwd is unavailable: ${cwd}`,
      hint: "Pass --cwd with an existing repository directory.",
    };
  }
  return null;
}

function explicitCwdValidationError(options) {
  if (!Object.prototype.hasOwnProperty.call(options, "cwd")) {
    return null;
  }
  if (typeof options.cwd === "string" && options.cwd.trim()) {
    return null;
  }
  return {
    code: "INVALID_CWD",
    message: "Repository cwd requires a non-empty directory value.",
    hint: "Pass --cwd with an existing repository directory.",
  };
}

function errorPayload(error) {
  return {
    ok: false,
    format_version: "1.0",
    error,
  };
}

function renderError(error, machine) {
  if (machine) {
    process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  } else {
    process.stderr.write(`${error.message}\n\n${error.hint}\n`);
  }
}

function summarizeProject(evidence) {
  if (!evidence.available) {
    return { available: false, hint: evidence.hint };
  }
  const info = evidence.data.projectInfo ?? {};
  const agents = evidence.data.agentInstructions ?? {};
  return {
    available: true,
    name: info.name ?? null,
    language: info.primaryLanguages?.[0]?.language ?? "unknown",
    sourceFiles: info.sourceFiles ?? null,
    testFiles: info.testFiles ?? null,
    agentInstructions: { count: agents.count ?? 0, status: agents.status ?? "unknown" },
  };
}

function summarizeDependencies(evidence) {
  if (!evidence.available) {
    return { available: false, hint: evidence.hint };
  }
  const summary = evidence.data.summary ?? {};
  return {
    available: true,
    ecosystems: summary.ecosystems ?? [],
    updateAutomation: summary.updateAutomation?.count ?? 0,
    riskLevel: summary.riskLevel ?? "unknown",
  };
}

function summarizeWorktree(evidence) {
  if (!evidence.available) {
    return { available: false, hint: evidence.hint };
  }
  const summary = evidence.data.summary ?? {};
  return {
    available: true,
    changedFiles: summary.changedFiles ?? 0,
    findingCount: summary.findingCount ?? 0,
  };
}

function buildResult(cwd, options = {}) {
  const sessions = options["no-sessions"] ? staticSessionRoute() : runSessionProbe(cwd, options["qoder-home"]);
  return {
    schemaVersion: 1,
    kind: "quickstart",
    status: "ok",
    evidence: {
      project: summarizeProject(runEvidence("core-change-watch/project-profile.mjs", cwd)),
      dependencies: summarizeDependencies(runEvidence("dependency-governance/cli.mjs", cwd)),
      worktree: summarizeWorktree(runEvidence("core-change-watch/change-drift.mjs", cwd)),
      sessions,
    },
    nextStep: {
      skill: "/better-harness",
      modelId: sessions.modelId,
      route: sessions.route,
      outputDir: ".qoder/better-harness/<yyyy-mm-dd>/<hhmmss>-<target>/",
      outputFile: "report.canvas.tsx",
      outputFiles: ["findings.json", "canvas.json", "report.canvas.tsx"],
    },
    moreEvidence: MORE_EVIDENCE,
  };
}

function renderHuman(result) {
  const { project, dependencies, worktree, sessions } = result.evidence;
  const lines = [
    "Better Harness Quickstart",
    "",
    "A readiness report takes two steps: this command probes repository and session evidence,",
    "then the Better Harness skill turns the selected model route into a report.",
    "",
    "Step 1 - Evidence and model route (gathered now)",
  ];
  if (project.available) {
    const scale = [
      project.sourceFiles != null ? `${project.sourceFiles} source` : null,
      project.testFiles != null ? `${project.testFiles} test` : null,
    ].filter(Boolean).join(" / ");
    lines.push(`  Project    ${[project.name, project.language, scale].filter(Boolean).join(" · ")}`);
    lines.push(
      `  Agents     ${project.agentInstructions.count > 0 ? `AGENTS.md present (${project.agentInstructions.status})` : "no AGENTS.md found"}`,
    );
  } else {
    lines.push(`  Project    unavailable · ${project.hint}`);
  }
  if (dependencies.available) {
    lines.push(
      `  Deps       ${dependencies.ecosystems.join(", ") || "none"} · update-automation: ${dependencies.updateAutomation > 0 ? "present" : "missing"} · risk: ${dependencies.riskLevel}`,
    );
  }
  if (worktree.available) {
    lines.push(`  Worktree   ${worktree.changedFiles} changed file(s)`);
  }
  lines.push(
    sessions.route === "bavi"
      ? `  Sessions   ${sessions.usableSessionCount} usable session(s) · Bavi / Agent Work Loop`
      : `  Sessions   no usable sessions · Software Fluency static fallback`,
  );
  lines.push(
    "",
    "Step 2 - Generate the report",
    "  In Qoder (or any agent in this repo), run:",
    "",
    "      /better-harness",
    "",
    "  The skill reads the evidence above and writes findings-backed Canvas report artifacts to:",
    ...result.nextStep.outputFiles.map((file) => `      ${result.nextStep.outputDir}${file}`),
    "",
    "More evidence on demand:",
    ...result.moreEvidence.map((command) => `  ${command}`),
    "",
    "Docs: README.md (Quickstart) · docs/concepts.md",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  const options = parseArgs(argv);
  const optionError = explicitCwdValidationError(options);
  if (optionError) {
    renderError(optionError, Boolean(options.json));
    return 1;
  }
  const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
  const validationError = cwdValidationError(cwd);
  if (validationError) {
    renderError(validationError, Boolean(options.json));
    return 1;
  }
  const result = buildResult(cwd, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(renderHuman(result));
  return 0;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  process.exitCode = main();
}
