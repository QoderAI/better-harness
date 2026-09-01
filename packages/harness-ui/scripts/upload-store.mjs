import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createUploadReceipt,
  packetStorageKey,
  validateUploadPlan,
  validateUploadReceipt,
} from "../../../scripts/task-evidence-upload/index.mjs";

export const RECORD_KIND = "better-harness.task-evidence-upload-record";
export const RECORD_SCHEMA_VERSION = 1;
export const DEFAULT_UPLOADS_SEGMENTS = Object.freeze([".better-harness", "uploads"]);

const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const DEFAULT_RECORD_LIMIT = 20;

/**
 * @param {{ workspace?: string, uploadsDirectory?: string, env?: Record<string, string | undefined> }} [options]
 */
export function resolveUploadsDirectory({ workspace = process.cwd(), uploadsDirectory, env = process.env } = {}) {
  const explicit = uploadsDirectory ?? env.BETTER_HARNESS_UPLOADS;
  if (explicit) return path.resolve(explicit);
  return path.join(path.resolve(workspace), ...DEFAULT_UPLOADS_SEGMENTS);
}

function recordPath(directory, packetDigest) {
  return path.join(directory, `${packetStorageKey(packetDigest)}.json`);
}

export function validateUploadRecord(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("An upload record must be an object.");
  }
  if (record.kind !== RECORD_KIND) {
    throw new Error(`An upload record must use kind ${RECORD_KIND}.`);
  }
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    throw new Error(`An upload record must use schemaVersion ${RECORD_SCHEMA_VERSION}.`);
  }
  validateUploadPlan(record.plan);
  validateUploadReceipt(record.receipt, { plan: record.plan });
  return record;
}

async function readRecordFile(filePath) {
  const stats = await stat(filePath);
  if (stats.size > MAX_RECORD_BYTES) {
    throw new Error(`The upload record exceeds ${MAX_RECORD_BYTES} bytes.`);
  }
  return validateUploadRecord(JSON.parse(await readFile(filePath, "utf8")));
}

/**
 * Store one applied plan under its content-addressed packet digest. A repeated
 * apply of the same packet keeps the first acceptance time and reports the
 * duplicate rather than creating a second record.
 *
 * @param {unknown} plan A validated better-harness.task-evidence-upload-plan/v1.
 * @param {{ directory: string, now?: Date | string, createId?: () => string }} options
 */
export async function storeUploadPlan(plan, {
  directory,
  now = new Date(),
  createId = randomUUID,
} = {}) {
  validateUploadPlan(plan);
  const absoluteDirectory = path.resolve(directory);
  const target = recordPath(absoluteDirectory, plan.packetDigest);

  // A missing file means a first apply; an unreadable or invalid one is replaced
  // by this apply rather than blocking it, because the packet digest is the name.
  const existing = await readRecordFile(target).catch(() => null);
  if (existing) {
    return {
      state: "duplicate",
      receipt: createUploadReceipt({
        plan,
        receiptId: existing.receipt.receiptId,
        state: "duplicate",
        now: existing.receipt.acceptedAt,
      }),
      path: target,
    };
  }

  const receipt = createUploadReceipt({
    plan,
    receiptId: packetStorageKey(plan.packetDigest),
    state: "accepted",
    now,
  });
  const record = {
    kind: RECORD_KIND,
    schemaVersion: RECORD_SCHEMA_VERSION,
    receipt,
    plan,
  };
  const temporaryPath = path.join(absoluteDirectory, `.${createId()}.tmp`);
  await mkdir(absoluteDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    // Two applies of the same packet race to the same content-addressed name.
    // Renaming last-writer-wins keeps one record whose plan is byte-identical.
    await rename(temporaryPath, target);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return { state: "accepted", receipt, path: target };
}

/**
 * Read stored upload records newest first. A record that cannot be parsed or
 * validated is reported instead of being silently dropped, so the Dashboard can
 * show that a source exists but is unreadable.
 *
 * @param {{ directory: string, limit?: number }} options
 */
export async function readUploadRecords({ directory, limit = DEFAULT_RECORD_LIMIT }) {
  const absoluteDirectory = path.resolve(directory);
  const errors = [];
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], errors };
    return {
      records: [],
      errors: [{ source: "uploads", message: `The upload directory could not be read: ${error.message}` }],
    };
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => path.join(absoluteDirectory, entry.name));

  const records = [];
  for (const candidate of candidates) {
    try {
      records.push(await readRecordFile(candidate));
    } catch (error) {
      errors.push({
        source: `uploads:${path.basename(candidate)}`,
        message: error?.message ?? String(error),
      });
    }
  }

  records.sort((left, right) => right.receipt.acceptedAt.localeCompare(left.receipt.acceptedAt));
  return { records: records.slice(0, Math.max(0, limit)), errors };
}

/** @param {{ directory: string, limit?: number }} options */
export async function readUploadPackets(options) {
  const { records, errors } = await readUploadRecords(options);
  return { packets: records.map((record) => record.plan.packet), errors };
}
