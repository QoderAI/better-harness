#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgentLint } from "./index.mjs";

function parseArgs(argv) {
  const options = { workspace: "." };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.format = "json";
      continue;
    }
    if (arg === "--scan-children") {
      options.scanChildren = true;
      continue;
    }
    if (arg === "--include-user-home") {
      options.includeUserHome = true;
      continue;
    }
    if (arg === "--format") {
      options.format = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
      continue;
    }
    if (arg === "--workspace") {
      options.workspace = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      options.workspace = arg.slice("--workspace=".length);
      continue;
    }
    if (arg === "--workspace-root") {
      options.workspaceRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--workspace-root=")) {
      options.workspaceRoot = arg.slice("--workspace-root=".length);
      continue;
    }
    if (arg === "--profile") {
      options.profile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      options.profile = arg.slice("--profile=".length);
      continue;
    }
    if (arg === "--provider") {
      options.provider = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length);
      continue;
    }
    if (arg === "--skill") {
      options.skills = [...(options.skills ?? []), argv[index + 1]];
      index += 1;
      continue;
    }
    if (arg.startsWith("--skill=")) {
      options.skills = [...(options.skills ?? []), arg.slice("--skill=".length)];
      continue;
    }
    if (arg === "--qoder-home") {
      options.qoderHome = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--qoder-home=")) {
      options.qoderHome = arg.slice("--qoder-home=".length);
      continue;
    }
    if (arg === "--qoder-shared-client-cache-root") {
      options.qoderSharedClientCacheRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--qoder-shared-client-cache-root=")) {
      options.qoderSharedClientCacheRoot = arg.slice("--qoder-shared-client-cache-root=".length);
      continue;
    }
    if (arg === "--codex-home") {
      options.codexHome = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--claude-home") {
      options.claudeHome = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--claude-home=")) {
      options.claudeHome = arg.slice("--claude-home=".length);
      continue;
    }
    if (arg === "--claude-state") {
      options.claudeStatePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--claude-state=")) {
      options.claudeStatePath = arg.slice("--claude-state=".length);
      continue;
    }
    if (arg.startsWith("--codex-home=")) {
      options.codexHome = arg.slice("--codex-home=".length);
      continue;
    }
    if (arg === "--cursor-home") {
      options.cursorHome = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--cursor-home=")) {
      options.cursorHome = arg.slice("--cursor-home=".length);
      continue;
    }
    if (arg === "--max-reference-depth") {
      options.maxReferenceDepth = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-reference-depth=")) {
      options.maxReferenceDepth = arg.slice("--max-reference-depth=".length);
      continue;
    }
    if (arg === "--max-skill-reference-depth") {
      options.maxSkillReferenceDepth = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-skill-reference-depth=")) {
      options.maxSkillReferenceDepth = arg.slice("--max-skill-reference-depth=".length);
      continue;
    }
    if (arg === "--max-entrypoint-depth") {
      options.maxEntrypointDepth = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-entrypoint-depth=")) {
      options.maxEntrypointDepth = arg.slice("--max-entrypoint-depth=".length);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage: better-harness agent-lint [--workspace <path>] [--profile agents-md-review|agent-assets-review] [--json|--format markdown]",
    "       better-harness agent-lint --workspace-root <dir> --scan-children --profile agents-md-review",
    "       better-harness agent-lint --profile agent-assets-review --provider <qoder|codex|claude|cursor> [--skill <path>]",
    "",
    "Parse agent instruction entrypoints and bounded local Markdown references into review evidence.",
    "",
  ].join("\n");
}

function markdownReport(payload) {
  const lines = [
    "# Agent Lint Parse",
    "",
    payload.projects ? `- Workspace root: ${payload.workspaceRoot}` : `- Workspace: ${payload.graph.workspace}`,
    payload.projects ? `- Projects: ${payload.summary.projects}` : `- Entrypoints: ${payload.summary.entrypoints}`,
    payload.projects ? `- Findings: ${payload.summary.findings}` : `- Documents: ${payload.summary.documents}`,
    payload.projects ? `- Errors: ${payload.summary.errors}` : `- References: ${payload.summary.references}`,
    payload.projects ? `- Warnings: ${payload.summary.warnings}` : `- Missing references: ${payload.summary.missingReferences}`,
    "",
  ];

  if (payload.projects) {
    for (const project of payload.projects) {
      lines.push(`## ${project.name}`, "");
      lines.push(`- Entrypoints: ${project.summary.entrypoints}`);
      lines.push(`- Documents: ${project.summary.documents}`);
      lines.push(`- Findings: ${project.summary.findings}`);
      lines.push(`- Missing references: ${project.summary.missingReferences}`);
      lines.push("");
    }
    return `${lines.join("\n")}\n`;
  }

  for (const document of payload.graph?.documents ?? []) {
    lines.push(`## ${document.relativePath}`, "");
    lines.push(`- Lines: ${document.lineCount}`);
    lines.push(`- Bytes: ${document.byteCount}`);
    lines.push(`- Links: ${document.links.length}`);
    lines.push(`- References: ${document.references.length}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function reviewMarkdownReport(payload) {
  const lines = ["# Agent Lint Review", ""];
  if (payload.projects) {
    lines.push(
      `- Workspace root: ${payload.workspaceRoot}`,
      `- Projects: ${payload.summary.projects}`,
      `- Findings: ${payload.summary.findings}`,
      `- Errors: ${payload.summary.errors}`,
      `- Warnings: ${payload.summary.warnings}`,
      `- Advisories: ${payload.summary.advisories}`,
      "",
    );
    for (const project of payload.projects) {
      lines.push(`## ${project.name}`, "");
      if (project.findings.length === 0) {
        lines.push("- No findings.", "");
        continue;
      }
      for (const finding of project.findings) {
        const location = finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : "";
        lines.push(`- [${finding.severity}] ${finding.id}${location}: ${finding.evidence}`);
      }
      lines.push("");
    }
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    `- Workspace: ${payload.graph.workspace}`,
    `- Findings: ${payload.summary.findings}`,
    `- Errors: ${payload.summary.errors}`,
    `- Warnings: ${payload.summary.warnings}`,
    `- Advisories: ${payload.summary.advisories}`,
    "",
  );
  for (const finding of payload.findings) {
    const location = finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : "";
    lines.push(`- [${finding.severity}] ${finding.id}${location}: ${finding.evidence}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  const format = options.format ?? "json";
  if (!["json", "markdown", "review-markdown"].includes(format)) {
    process.stderr.write(`Unsupported format: ${format}\n`);
    return 1;
  }

  const payload = await runAgentLint(options);

  if (format === "review-markdown") {
    process.stdout.write(reviewMarkdownReport(payload));
  } else if (format === "markdown") {
    process.stdout.write(markdownReport(payload));
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main();
}
