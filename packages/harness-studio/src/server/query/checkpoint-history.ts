import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type {
  CheckpointHistoryItemPreview,
  CheckpointHistoryPreview,
  CheckpointSourcePreview,
} from "../../experiment-setup.js";
import { loadCheckpointSourcePreview } from "./checkpoint-source.js";

const CATALOG_VERSION = "checkpoint-history.v1";
const MAX_HISTORY_ITEMS = 100;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ITEM_ID = /^[A-Za-z0-9_-]+$/;

export interface ObservedHistoryIdentity {
  harnessId?: string;
  revisionId?: string;
  profile?: "qoder-default-v1" | "qoder-minimal-v1";
  model?: string;
  environmentReceipt?: string;
}

export interface ResolvedCheckpointHistory {
  item: CheckpointHistoryItemPreview;
  checkpointRef: { planPath: string; digest: string };
  checkpointSource: CheckpointSourcePreview;
  request: {
    promptPath: string;
    prompt: string;
    promptHash: string;
    verified: boolean;
  };
  observed: {
    trajectoryPath: string;
    startCheckpointVerified: boolean;
    identity?: ObservedHistoryIdentity;
  };
}

/** Server-only adapter boundary. Provider paths never cross this interface. */
export interface CheckpointHistoryAdapter {
  readonly descriptor: { id: string; label: string };
  list(): Promise<CheckpointHistoryPreview>;
  resolve(id: string, materializationCount: number): Promise<ResolvedCheckpointHistory>;
}

interface CatalogItem {
  id: string;
  title: string;
  occurredAt?: string;
  checkpointRef: { plan: string; digest: string };
  request: { prompt: string; verified: boolean };
  observed: {
    trajectory: string;
    startCheckpointVerified: boolean;
    identity?: ObservedHistoryIdentity;
  };
}

interface LoadedCatalog {
  directory: string;
  adapter: { id: string; label: string };
  items: CatalogItem[];
}

export function createCheckpointHistoryCatalogAdapter(catalogPath: string): CheckpointHistoryAdapter {
  let descriptor = { id: "checkpoint-history-v1", label: "Checkpoint history catalog" };
  return {
    get descriptor() {
      return descriptor;
    },
    async list() {
      const catalog = await loadCatalog(catalogPath);
      descriptor = catalog.adapter;
      const items = await Promise.all(catalog.items.map((item) => projectItem(catalog, item)));
      return { adapter: catalog.adapter, items };
    },
    async resolve(id, materializationCount) {
      const catalog = await loadCatalog(catalogPath);
      descriptor = catalog.adapter;
      const item = catalog.items.find((candidate) => candidate.id === id);
      if (item === undefined) throw new Error(`Checkpoint history item '${id}' was not found.`);
      const [preview, planPath, promptPath, trajectoryPath] = await Promise.all([
        projectItem(catalog, item),
        resolveCatalogPath(catalog.directory, item.checkpointRef.plan, `items.${item.id}.checkpointRef.plan`),
        resolveCatalogPath(catalog.directory, item.request.prompt, `items.${item.id}.request.prompt`),
        resolveCatalogPath(catalog.directory, item.observed.trajectory, `items.${item.id}.observed.trajectory`),
      ]);
      const [promptBytes, checkpointSource] = await Promise.all([
        readFile(promptPath),
        loadCheckpointSourcePreview({
          planPath,
          expectedDigest: item.checkpointRef.digest,
          materializationCount,
        }),
      ]);
      await assertRegularFile(trajectoryPath, `items.${item.id}.observed.trajectory`);
      const prompt = promptBytes.toString("utf8");
      if (prompt.trim() === "") throw new Error(`items.${item.id}.request.prompt is empty.`);
      return {
        item: preview,
        checkpointRef: { planPath, digest: item.checkpointRef.digest },
        checkpointSource,
        request: {
          promptPath,
          prompt,
          promptHash: `sha256:${createHash("sha256").update(promptBytes).digest("hex")}`,
          verified: item.request.verified,
        },
        observed: {
          trajectoryPath,
          startCheckpointVerified: item.observed.startCheckpointVerified,
          ...(item.observed.identity === undefined ? {} : { identity: item.observed.identity }),
        },
      };
    },
  };
}

async function projectItem(catalog: LoadedCatalog, item: CatalogItem): Promise<CheckpointHistoryItemPreview> {
  const promptPath = await resolveCatalogPath(catalog.directory, item.request.prompt, `items.${item.id}.request.prompt`);
  const prompt = await readFile(promptPath, "utf8");
  return {
    id: item.id,
    title: item.title,
    requestPreview: compact(prompt),
    ...(item.occurredAt === undefined ? {} : { occurredAt: item.occurredAt }),
    adapter: catalog.adapter,
    provenance: item.request.verified ? "verified-history" : "unverified-history",
    checkpointVerified: item.observed.startCheckpointVerified,
  };
}

async function loadCatalog(path: string): Promise<LoadedCatalog> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Cannot read checkpoint history catalog '${path}': ${errorMessage(error)}`);
  }
  const root = record(value, "catalog");
  if (root.schemaVersion !== CATALOG_VERSION) {
    throw new Error(`Unsupported checkpoint history catalog '${String(root.schemaVersion)}'.`);
  }
  const adapter = record(root.adapter, "adapter");
  const descriptor = {
    id: requiredString(adapter.id, "adapter.id"),
    label: requiredString(adapter.label, "adapter.label"),
  };
  if (!Array.isArray(root.items) || root.items.length === 0 || root.items.length > MAX_HISTORY_ITEMS) {
    throw new Error(`items must contain between 1 and ${MAX_HISTORY_ITEMS} history records.`);
  }
  const ids = new Set<string>();
  const items = root.items.map((candidate, index) => parseItem(candidate, index, ids));
  return { directory: dirname(resolve(path)), adapter: descriptor, items };
}

function parseItem(value: unknown, index: number, ids: Set<string>): CatalogItem {
  const item = record(value, `items[${index}]`);
  const id = requiredString(item.id, `items[${index}].id`);
  if (!ITEM_ID.test(id)) throw new Error(`items[${index}].id must match ${ITEM_ID}.`);
  if (ids.has(id)) throw new Error(`Duplicate checkpoint history id '${id}'.`);
  ids.add(id);
  const checkpointRef = record(item.checkpointRef, `items.${id}.checkpointRef`);
  const request = record(item.request, `items.${id}.request`);
  const observed = record(item.observed, `items.${id}.observed`);
  const digest = requiredString(checkpointRef.digest, `items.${id}.checkpointRef.digest`);
  if (!SHA256.test(digest)) throw new Error(`items.${id}.checkpointRef.digest must be a lowercase SHA-256 digest.`);
  const occurredAt = item.occurredAt === undefined ? undefined : requiredString(item.occurredAt, `items.${id}.occurredAt`);
  if (occurredAt !== undefined && Number.isNaN(Date.parse(occurredAt))) {
    throw new Error(`items.${id}.occurredAt must be an ISO timestamp.`);
  }
  const identity = observed.identity === undefined ? undefined : parseIdentity(observed.identity, id);
  return {
    id,
    title: requiredString(item.title, `items.${id}.title`),
    ...(occurredAt === undefined ? {} : { occurredAt }),
    checkpointRef: {
      plan: relativePath(checkpointRef.plan, `items.${id}.checkpointRef.plan`),
      digest,
    },
    request: {
      prompt: relativePath(request.prompt, `items.${id}.request.prompt`),
      verified: requiredBoolean(request.verified, `items.${id}.request.verified`),
    },
    observed: {
      trajectory: relativePath(observed.trajectory, `items.${id}.observed.trajectory`),
      startCheckpointVerified: requiredBoolean(
        observed.startCheckpointVerified,
        `items.${id}.observed.startCheckpointVerified`,
      ),
      ...(identity === undefined ? {} : { identity }),
    },
  };
}

function parseIdentity(value: unknown, itemId: string): ObservedHistoryIdentity {
  const identity = record(value, `items.${itemId}.observed.identity`);
  const result: ObservedHistoryIdentity = {};
  for (const key of ["harnessId", "revisionId", "model", "environmentReceipt"] as const) {
    if (identity[key] !== undefined) result[key] = requiredString(identity[key], `items.${itemId}.observed.identity.${key}`);
  }
  if (identity.profile !== undefined) {
    const profile = requiredString(identity.profile, `items.${itemId}.observed.identity.profile`);
    if (profile !== "qoder-default-v1" && profile !== "qoder-minimal-v1") {
      throw new Error(`items.${itemId}.observed.identity.profile is unsupported.`);
    }
    result.profile = profile;
  }
  return result;
}

async function resolveCatalogPath(root: string, value: string, label: string): Promise<string> {
  const relative = relativePath(value, label);
  const lexicalRoot = resolve(root);
  const lexical = resolve(lexicalRoot, relative);
  const prefix = lexicalRoot.endsWith(sep) ? lexicalRoot : `${lexicalRoot}${sep}`;
  if (!lexical.startsWith(prefix)) throw new Error(`${label} escapes the catalog directory.`);
  const [realRoot, realTarget] = await Promise.all([realpath(lexicalRoot), realpath(lexical)]).catch((error) => {
    throw new Error(`${label} is not readable: ${errorMessage(error)}`);
  });
  const realPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (!realTarget.startsWith(realPrefix)) throw new Error(`${label} resolves outside the catalog directory.`);
  await assertRegularFile(realTarget, label);
  return realTarget;
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  if (!(await stat(path)).isFile()) throw new Error(`${label} is not a regular file.`);
}

function relativePath(value: unknown, label: string): string {
  const path = requiredString(value, label);
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`${label} must be a portable catalog-owned relative path.`);
  }
  return path;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
