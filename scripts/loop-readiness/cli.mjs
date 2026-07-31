#!/usr/bin/env node

// LC-01 readiness gate CLI. Exit codes: 0 allowed, 2 prevented (documented
// non-success envelope), 1 for every input the assessment contract rejects.
// The gate reads only the assessment file passed to it: no session stores,
// provider homes, network, or workspace scanning.

import { readFileSync } from "node:fs";
import { READINESS_CONTRACT_VERSION, READINESS_LEVELS } from "./contract.mjs";
import { evaluateReadiness, ReadinessInputError } from "./evaluate.mjs";

const EXIT_ALLOWED = 0;
const EXIT_INVALID_INPUT = 1;
const EXIT_PREVENTED = 2;

function helpText() {
  const lines = [
    "Usage: better-harness loop readiness --level <id> --assessment <file> [--json]",
    "",
    "Decide whether a caller-declared capability assessment allows a readiness",
    `level (readiness contract v${READINESS_CONTRACT_VERSION}). The gate reads only the assessment file,`,
    "never probes hosts or providers, and fails closed on anything missing or",
    "invalid. An allowed decision is necessary, never sufficient, authority for",
    "a run; observation truthfulness stays with the caller.",
    "",
    "Levels:",
    ...READINESS_LEVELS.map((level) => `  ${level}`),
    "",
    "Options:",
    "  --level <id>         Readiness level to evaluate",
    "  --assessment <file>  JSON capability assessment declared by the caller",
    "  --json               Parser-safe JSON decision or error envelope on stdout",
    "  -h, --help           Print this help",
    "",
    "Exit codes:",
    "  0  allowed decision",
    "  2  prevented decision (documented non-success envelope)",
    "  1  invalid usage, unreadable or malformed assessment, unknown level,",
    "     unknown capability id or state, duplicate observation, empty evidence,",
    "     or unsupported contract version",
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
    } else if (value === "--json") {
      options.json = true;
    } else if (value === "--level") {
      options.level = argv[(index += 1)];
    } else if (value.startsWith("--level=")) {
      options.level = value.slice("--level=".length);
    } else if (value === "--assessment") {
      options.assessment = argv[(index += 1)];
    } else if (value.startsWith("--assessment=")) {
      options.assessment = value.slice("--assessment=".length);
    } else {
      throw new ReadinessInputError("INVALID_USAGE", `Unknown argument: ${value}`);
    }
  }
  return options;
}

function emitError(error, json) {
  if (json) {
    const envelope = {
      kind: "loop-readiness-error",
      code: error.code ?? "INVALID_INPUT",
      message: error.message,
    };
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } else {
    process.stderr.write(`loop readiness: ${error.message}\n`);
  }
  return EXIT_INVALID_INPUT;
}

function emitDecision(decision, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } else {
    const lines = [
      `Decision: ${decision.status}`,
      `Level: ${decision.level}`,
      `Readiness contract: v${decision.readinessContractVersion}`,
      `Consumed observations: ${decision.observations.length}`,
    ];
    if (decision.blockingCapabilities.length > 0) {
      lines.push("Blocking capabilities:");
      for (const capability of decision.blockingCapabilities) {
        lines.push(`  - ${capability.id}: ${capability.state}`);
      }
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  return decision.status === "allowed" ? EXIT_ALLOWED : EXIT_PREVENTED;
}

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof ReadinessInputError) {
      return emitError(error, argv.includes("--json"));
    }
    throw error;
  }

  if (options.help || argv.length === 0) {
    process.stdout.write(helpText());
    return 0;
  }

  try {
    if (!options.level) {
      throw new ReadinessInputError("INVALID_USAGE", "Missing required option: --level <id>.");
    }
    if (!options.assessment) {
      throw new ReadinessInputError("INVALID_USAGE", "Missing required option: --assessment <file>.");
    }

    let raw;
    try {
      raw = readFileSync(options.assessment, "utf8");
    } catch (error) {
      throw new ReadinessInputError(
        "UNREADABLE_ASSESSMENT",
        `Cannot read assessment file ${options.assessment}: ${error.message}`,
      );
    }

    let assessment;
    try {
      assessment = JSON.parse(raw);
    } catch (error) {
      throw new ReadinessInputError(
        "MALFORMED_ASSESSMENT",
        `Assessment file ${options.assessment} is not valid JSON: ${error.message}`,
      );
    }

    const decision = evaluateReadiness({ level: options.level, assessment });
    return emitDecision(decision, options.json);
  } catch (error) {
    if (error instanceof ReadinessInputError) {
      return emitError(error, options.json);
    }
    throw error;
  }
}

process.exitCode = main();
