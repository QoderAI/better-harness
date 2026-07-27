#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAnalyzer } from "../session-analysis.mjs";
import { parseArgs } from "./cli.mjs";
import {
  buildSessionSelectionProfile,
  buildSessionSelectionSnapshot,
  collectSessionSelectionEntries,
} from "./selection-plan.mjs";

const HELP = `Usage: node scripts/session-analysis/selection-profile.mjs --workspace <target> [options]

Build a privacy-safe full-population fact profile that an AI can use to author
a declarative session selection plan. Raw prompts, commands, paths, and session
identifiers never enter the profile.

Options:
  --platform <qoder|codex|claude|cursor>
                            Session platform (default: qoder)
  --workspace <path>        Target workspace (required)
  --since <ISO timestamp>   Exclude earlier sessions
  --until <ISO timestamp>   Exclude later sessions
  --limit <n>               Intended semantic sample limit (default: 40)
  --concurrency <n>         Fact-read concurrency from 1 to 16 (default: 4)
  --output <path>           Write JSON profile and emit a compact result envelope
  --snapshot <path>         Write the private numeric-fact snapshot for source reuse
  --help                    Show this help
`;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function createSelectionProfileBundle(options = {}) {
  const platform = options.platform ?? "qoder";
  const snapshotUntil = options.until ?? new Date().toISOString();
  const analyzer = await createAnalyzer(platform);
  const analyzerOptions = {
    platform,
    workspace: options.workspace,
    since: options.since,
    until: snapshotUntil,
    qoderHome: options.qoderHome ?? options["qoder-home"],
    codexHome: options.codexHome ?? options["codex-home"],
    cursorHome: options.cursorHome ?? options["cursor-home"],
  };
  const discovery = await analyzer.analyze({ ...analyzerOptions, command: "sources" });
  const scope = await analyzer.resolveScope(analyzerOptions);
  const entries = await collectSessionSelectionEntries({
    analyzer,
    sessions: discovery.sessions,
    scope,
    concurrency: positiveInteger(options.concurrency, 4),
  });
  const profile = buildSessionSelectionProfile(entries, {
    platform,
    limit: positiveInteger(options.limit, 40),
    since: discovery.scope?.since ?? options.since ?? null,
    until: discovery.scope?.until ?? snapshotUntil,
  });
  return {
    profile,
    snapshot: buildSessionSelectionSnapshot(entries, profile),
  };
}

export async function createSelectionProfile(options = {}) {
  return (await createSelectionProfileBundle(options)).profile;
}

async function main(argv = process.argv.slice(2)) {
  const { options } = parseArgs(argv);
  if (options.help || options.h) {
    process.stdout.write(HELP);
    return;
  }
  if (!options.workspace) throw new Error("--workspace is required");
  const { profile, snapshot } = await createSelectionProfileBundle(options);
  const output = `${JSON.stringify(profile, null, 2)}\n`;
  const snapshotPath = typeof options.snapshot === "string" && options.snapshot.trim()
    ? path.resolve(options.snapshot)
    : null;
  if (snapshotPath) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  if (typeof options.output === "string" && options.output.trim()) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      output: outputPath,
      eligibleCount: profile.eligibleCount,
      sampleRequired: profile.sampleRequired,
      profileDigest: profile.profileDigest,
      ...(snapshotPath ? { snapshot: snapshotPath, snapshotDigest: snapshot.snapshotDigest } : {}),
      until: profile.scope.until,
    })}\n`);
    return;
  }
  process.stdout.write(output);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`session selection profile failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
