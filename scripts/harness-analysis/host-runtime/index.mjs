import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectEvidenceBundle } from "../evidence-bundle/index.mjs";
import {
  createRunPlan,
  HOST_RUNTIME_KIND,
  HOST_RUNTIME_SCHEMA_VERSION,
  SPECIALIST_LANES,
  validateRunPlan,
  verifyRunResults,
} from "./contract.mjs";

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SUPPORTED_PROVIDERS = new Set(["pi", "workbuddy"]);

function check(name, status, detail, extra = {}) {
  return { name, status, detail, ...extra };
}

function nodeVersionCheck() {
  const match = process.versions.node.match(/^(\d+)\.(\d+)\.(\d+)/u);
  const version = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const supported = (version[0] > 22 || (version[0] === 22 && version[1] >= 20)) && version[0] < 26;
  return check("node", supported ? "pass" : "fail", `Node ${process.versions.node}; supported range is >=22.20.0 <26.0.0`, { version: process.versions.node });
}

function resourceCheck(provider) {
  const required = [
    "scripts/better-harness.mjs",
    "models/agent-work-loop.md",
    "templates/reporting",
  ];
  if (provider === "pi") required.push("extensions/pi/better-harness.ts", "skills/better-harness/SKILL.md");
  if (provider === "workbuddy") required.push(
    ".codebuddy-plugin/plugin.json",
    ".codebuddy-plugin/marketplace.json",
    "settings.json",
    "agents/better-harness-review-director.md",
    "agents/session-evidence-reviewer.md",
    "agents/project-harness-reviewer.md",
    "agents/agent-customize-reviewer.md",
  );
  const missing = required.filter((entry) => {
    return !existsSync(path.join(RUNTIME_ROOT, entry));
  });
  return check("runtime-resources", missing.length === 0 ? "pass" : "fail", missing.length === 0 ? "canonical runtime resources are present" : `missing: ${missing.join(", ")}`, { missing });
}

function modelCheck(provider, options) {
  if (options.modelStatus === "unavailable" || options.modelAvailable === false) {
    return check("model", "fail", `${provider} model is unavailable`);
  }
  if (options.model) return check("model", "pass", `${provider} model identity is bound`);
  return check("model", "warn", provider === "workbuddy"
    ? "WorkBuddy model identity is host-managed and was not supplied"
    : `${provider} model identity was not supplied by the host`);
}

function providerCheck(provider) {
  const normalized = String(provider ?? "").toLowerCase();
  return check("provider", SUPPORTED_PROVIDERS.has(normalized) ? "pass" : "fail", SUPPORTED_PROVIDERS.has(normalized) ? normalized : `unsupported provider: ${normalized}`, { provider: normalized });
}

function sessionIdentityCheck(provider, options) {
  if (provider === "workbuddy") {
    const codebuddy = options.codebuddySessionId ?? options["codebuddy-session-id"] ?? process.env.CODEBUDDY_SESSION_ID;
    const legacy = options.workbuddySessionId ?? options["workbuddy-session-id"] ?? process.env.WORKBUDDY_SESSION_ID;
    if (codebuddy && legacy && codebuddy !== legacy) {
      return check("current-session", "fail", "CODEBUDDY_SESSION_ID and WORKBUDDY_SESSION_ID conflict");
    }
    return check("current-session", codebuddy || legacy ? "pass" : "warn", codebuddy || legacy ? "current session exclusion is bound" : "current session identity was not supplied");
  }
  const identity = options.excludeSessionId ?? options["exclude-session-id"] ?? process.env.PI_SESSION_ID;
  return check("current-session", identity ? "pass" : "warn", identity ? "current session exclusion is bound" : "current session identity was not supplied");
}

async function outputCheck(provider, workspace) {
  const outputRoot = path.resolve(workspace, `.${provider}`, "better-harness");
  try {
    const outputParent = path.dirname(outputRoot);
    const candidate = existsSync(outputParent) ? outputParent : workspace;
    await access(candidate, 2);
    return check("output-root", "pass", `output route is writable; renderer may create .${provider}/better-harness`, { outputRoot });
  } catch (error) {
    return check("output-root", "fail", `output parent is not accessible: ${error.code ?? error.message}`, { outputRoot });
  }
}

export async function hostDoctor(options = {}) {
  const provider = String(options.platform ?? options.provider ?? "").toLowerCase();
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const checks = [nodeVersionCheck(), providerCheck(provider), resourceCheck(provider), sessionIdentityCheck(provider, options), modelCheck(provider, options)];
  try {
    const workspaceStat = await stat(workspace);
    checks.push(check("workspace", workspaceStat.isDirectory() ? "pass" : "fail", workspaceStat.isDirectory() ? workspace : "workspace is not a directory"));
  } catch (error) {
    checks.push(check("workspace", "fail", `workspace is unavailable: ${error.code ?? error.message}`));
  }
  checks.push(await outputCheck(provider || "unknown", workspace));
  const status = checks.some((entry) => entry.status === "fail") ? "fail" : checks.some((entry) => entry.status === "warn") ? "warn" : "pass";
  return {
    kind: `${HOST_RUNTIME_KIND}.doctor`,
    schemaVersion: HOST_RUNTIME_SCHEMA_VERSION,
    status,
    provider,
    workspace,
    checks,
  };
}

export async function prepareHostRun(options = {}, dependencies = {}) {
  const collect = dependencies.collectEvidenceBundle ?? collectEvidenceBundle;
  const bundle = await collect({
    ...options,
    provider: options.provider ?? options.platform,
    platform: options.platform ?? options.provider,
    "exclude-session-id": options["exclude-session-id"] ?? options.excludeSessionId ?? process.env.PI_SESSION_ID ?? process.env.CODEBUDDY_SESSION_ID ?? process.env.WORKBUDDY_SESSION_ID,
  }, dependencies);
  const plan = createRunPlan(bundle, options);
  return {
    kind: HOST_RUNTIME_KIND,
    schemaVersion: HOST_RUNTIME_SCHEMA_VERSION,
    status: bundle.status,
    plan,
  };
}

export async function writeRunPlan(planEnvelope, outputPath) {
  const plan = validateRunPlan(planEnvelope.plan ?? planEnvelope);
  const destination = path.resolve(outputPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify({ ...planEnvelope, plan }, null, 2)}\n`, { flag: "wx" });
  return destination;
}

export async function readRunPlan(inputPath) {
  const value = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  return validateRunPlan(value.plan ?? value);
}

export async function verifyHostRun(planInput, resultsInput) {
  return verifyRunResults(planInput, resultsInput);
}

export function specialistPrompt(plan, laneName) {
  const lane = plan.lanes?.[laneName];
  if (!lane || !SPECIALIST_LANES.includes(laneName)) throw new Error(`unknown specialist lane: ${laneName}`);
  return {
    lane: laneName,
    inputHash: lane.inputHash,
    prompt: [
      `You are the read-only Better Harness specialist for ${lane.label}.`,
      "Do not inspect the repository, user home, raw sessions, or another lane.",
      "Return one JSON object with status completed|partial|unavailable and a bounded output object.",
      `Input hash: ${lane.inputHash}`,
      "Evidence envelope:",
      JSON.stringify(lane.input),
    ].join("\n"),
  };
}

export { HOST_RUNTIME_KIND, HOST_RUNTIME_SCHEMA_VERSION, SPECIALIST_LANES } from "./contract.mjs";
