import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
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

  const duplicate = (existing) => ({
    state: "duplicate",
    receipt: createUploadReceipt({
      plan,
      receiptId: existing.receipt.receiptId,
      state: "duplicate",
      now: existing.receipt.acceptedAt,
    }),
    path: target,
  });

  // A valid existing record is the first acceptance. An unreadable record is not
  // overwritten silently: the collector must keep reporting it as unavailable.
  const existing = await readRecordFile(target).catch(() => null);
  if (existing) return duplicate(existing);

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
    // Publish the fully written temporary file without replacing an existing
    // digest. A hard link is atomic on the same filesystem, so concurrent
    // applies produce exactly one acceptance and one duplicate response.
    await link(temporaryPath, target);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    if (error?.code === "EEXIST") {
      return duplicate(await readRecordFile(target));
    }
    throw error;
  }
  await unlink(temporaryPath).catch(() => {});
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
  const bounded = records.slice(0, Math.max(0, limit));
  return { records: bounded, total: records.length, truncated: bounded.length < records.length, errors };
}

/** @param {{ directory: string, limit?: number }} options */
export async function readUploadPackets(options) {
  const { records, total, truncated, errors } = await readUploadRecords(options);
  return { packets: records.map((record) => record.plan.packet), total, truncated, errors };
}

/**
 * Project stored records as deliveries: the packet plus the acceptance facts a
 * packet cannot carry on its own. Organization, acceptance time, receipt state,
 * and digest live on the record, so a consumer that reads only the packet
 * cannot group evidence by organization or tell an accepted packet from a
 * duplicate.
 *
 * @param {{ directory: string, limit?: number }} options
 */
export async function readUploadDeliveries(options) {
  const { records, total, truncated, errors } = await readUploadRecords(options);
  return {
    deliveries: records.map((record) => ({
      organization: record.plan.destination.organization,
      endpoint: record.plan.destination.endpoint,
      acceptedAt: record.receipt.acceptedAt,
      receiptState: record.receipt.state,
      packetDigest: record.plan.packetDigest,
      packetBytes: record.plan.packetBytes,
      packet: record.plan.packet,
    })),
    total,
    truncated,
    errors,
  };
}
