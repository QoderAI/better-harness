import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { compileHarness } from "@qoder-ai/harness";
import { lockCapabilitySources } from "@qoder-ai/harness/lock";
import {
  isObservedLane,
  loadHarnessExperimentManifest,
  type HarnessExperimentManifest,
} from "@qoder-ai/harness/experiment";
import type { ExperimentLockReceipt } from "../experiment-setup.js";
import type { ResolvedCheckpointHistory } from "./query/checkpoint-history.js";

export interface LockedHistoryExperiment {
  manifestPath: string;
  receipt: ExperimentLockReceipt;
}

export async function lockHistoryExperiment(options: {
  templateManifestPath: string;
  history: ResolvedCheckpointHistory;
  outputRoot: string;
}): Promise<LockedHistoryExperiment> {
  if (options.history.checkpointSource.status !== "ready") {
    throw new Error(options.history.checkpointSource.limitation ?? "The checkpoint adapter did not validate this history item.");
  }
  const loaded = await loadHarnessExperimentManifest(options.templateManifestPath);
  const observed = loaded.value.lanes.filter(isObservedLane);
  if (observed.length !== 1) {
    throw new Error("Historical Replay lock requires exactly one observed reference lane in the template.");
  }
  const [templateBytes, harnessBytes] = await Promise.all([
    readFile(loaded.path),
    readFile(loaded.resolved.harness),
  ]);
  const lockId = `lock_${digest([
    options.history.item.adapter.id,
    options.history.item.id,
    options.history.checkpointRef.digest,
    options.history.request.promptHash,
    digest(templateBytes),
  ].join("\n")).slice(0, 20)}`;
  const outputRoot = resolve(options.outputRoot);
  const target = join(outputRoot, lockId);
  const targetManifest = join(target, "experiment.json");
  await mkdir(outputRoot, { recursive: true });
  if (await isFile(targetManifest)) {
    await loadHarnessExperimentManifest(targetManifest);
    return receiptFor(targetManifest, lockId, options.history);
  }

  const temporary = await mkdtemp(join(outputRoot, `.lock-${lockId}-`));
  try {
    await Promise.all([
      copyFile(options.history.checkpointRef.planPath, join(temporary, "checkpoint.json")),
      copyFile(options.history.request.promptPath, join(temporary, "prompt.md")),
      copyFile(options.history.observed.trajectoryPath, join(temporary, "history.jsonl")),
      copyFile(loaded.resolved.harness, join(temporary, "harness.harness")),
      copyFile(loaded.resolved.graderContract, join(temporary, "grader.json")),
    ]);
    await copyHarnessSources(harnessBytes.toString("utf8"), dirname(loaded.resolved.harness), temporary);
    const manifest = lockedManifest(loaded.value, options.history);
    await writeFile(join(temporary, "experiment.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await loadHarnessExperimentManifest(join(temporary, "experiment.json"));
    await writeFile(join(temporary, "lock-receipt.json"), `${JSON.stringify({
      schemaVersion: "harness-experiment-lock.v1",
      lockId,
      historyId: options.history.item.id,
      checkpointDigest: options.history.checkpointRef.digest,
      requestPromptHash: options.history.request.promptHash,
      requestVerified: options.history.request.verified,
      startCheckpointVerified: options.history.observed.startCheckpointVerified,
    }, null, 2)}\n`, "utf8");
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await rm(temporary, { recursive: true, force: true });
    }
    await loadHarnessExperimentManifest(targetManifest);
    return receiptFor(targetManifest, lockId, options.history);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function lockedManifest(
  template: HarnessExperimentManifest,
  history: ResolvedCheckpointHistory,
): HarnessExperimentManifest {
  const lanes = template.lanes.map((lane) => {
    if (!isObservedLane(lane)) return lane;
    const identity = {
      ...history.observed.identity,
      ...(history.request.verified ? { promptHash: history.request.promptHash } : {}),
    };
    return {
      ...lane,
      trajectory: "./history.jsonl",
      ...(history.observed.startCheckpointVerified
        ? { startCheckpointDigest: history.checkpointRef.digest }
        : { startCheckpointDigest: undefined }),
      ...(Object.keys(identity).length === 0 ? { identity: undefined } : { identity }),
    };
  });
  return {
    ...template,
    harness: "./harness.harness",
    checkpointRef: { plan: "./checkpoint.json", digest: history.checkpointRef.digest },
    task: {
      ...template.task,
      prompt: "./prompt.md",
      grader: { ...template.task.grader, contract: "./grader.json" },
    },
    lanes,
  };
}

async function copyHarnessSources(source: string, sourceRoot: string, destinationRoot: string): Promise<void> {
  const compiled = await compileHarness([{ uri: pathToFileURL(join(sourceRoot, "harness.harness")).href, text: source }]);
  if (!compiled.bundle) {
    throw new Error(`Cannot lock the template harness: ${compiled.diagnostics.map((item) => item.message).join("; ")}`);
  }
  await lockCapabilitySources(compiled.bundle, { root: sourceRoot });
  for (const skill of compiled.bundle.skills) {
    if (skill.source === undefined) continue;
    const relative = portableRelative(skill.source, `skill '${skill.id}' source`);
    const sourcePath = await resolveContainedExistingPath(sourceRoot, relative, `skill '${skill.id}' source`);
    const destination = resolve(destinationRoot, relative);
    const prefix = destinationRoot.endsWith(sep) ? destinationRoot : `${destinationRoot}${sep}`;
    if (!destination.startsWith(prefix)) throw new Error(`skill '${skill.id}' source escapes the lock directory.`);
    await mkdir(dirname(destination), { recursive: true });
    await cp(sourcePath, destination, { recursive: true, errorOnExist: true, force: false });
  }
}

async function resolveContainedExistingPath(root: string, relative: string, label: string): Promise<string> {
  const lexicalRoot = resolve(root);
  const lexical = resolve(lexicalRoot, relative);
  const prefix = lexicalRoot.endsWith(sep) ? lexicalRoot : `${lexicalRoot}${sep}`;
  if (!lexical.startsWith(prefix)) throw new Error(`${label} escapes the template root.`);
  const [realRoot, realTarget] = await Promise.all([realpath(lexicalRoot), realpath(lexical)]);
  const realPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (!realTarget.startsWith(realPrefix)) throw new Error(`${label} resolves outside the template root.`);
  return realTarget;
}

function portableRelative(value: string, label: string): string {
  if (isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`${label} must be a portable template-owned relative path.`);
  }
  return value;
}

async function receiptFor(
  manifestPath: string,
  lockId: string,
  history: ResolvedCheckpointHistory,
): Promise<LockedHistoryExperiment> {
  return {
    manifestPath,
    receipt: {
      lockId,
      historyId: history.item.id,
      manifestDigest: `sha256:${digest(await readFile(manifestPath))}`,
      checkpointDigest: history.checkpointRef.digest,
      manifestName: "experiment.json",
    },
  };
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isFile(), () => false);
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isAlreadyExists(error: unknown): boolean {
  return error !== null && typeof error === "object" && (error as { code?: unknown }).code === "EEXIST";
}
