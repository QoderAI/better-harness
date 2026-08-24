import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

import { SessionAnalyzer } from "../analyzer.mjs";
import { parseArgs, parseBooleanFlag } from "../cli.mjs";
import {
  bindSessionWorkspaceCwds,
  emitProviderResult,
  markSessionReadCoverage,
  runProviderAnalysis,
  runProviderCommand,
  workspaceMatchScopeFromOptions,
} from "../provider-runner.mjs";
import { privacySafeUserInputText, sanitizePrivateReviewText } from "../privacy-safe-text.mjs";
import { normalizeCliDate, withinTimeRange } from "../time.mjs";
import { WORKSPACE_CWD_MATCH, classifyWorkspaceCwd } from "../workspace-match.mjs";

export const DSH_ADAPTER_VERSION = "dsh-v1";
export const DSH_SESSION_FORMAT_VERSION = 0;

const ZSTD_MAGIC = 0xFD2FB528;
const PACKED_TYPES = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);
const NORMALIZATION_ALLOWLIST = new Set([
  "user/message", "assistant/message", "tool/call", "tool/result",
  "turn/start", "turn/end",
]);
const VALIDATED_TYPES = new Set([...NORMALIZATION_ALLOWLIST, "assistant/chunk", "step/start", "step/end"]);
const VALIDATED_KNOWN_UNSUPPORTED_TYPES = new Set([
  "agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided",
  "approval/policy", "command/done", "command/run", "compaction/end", "compaction/prune",
  "compaction/start", "compaction/summary", "feedback/record", "goal/change", "hook/invoked",
  "hook/result", "llm/retry", "llm/retry-started", "permission/preset", "plan/mode",
  "request/context", "request/header", "sandbox/mode", "session/end-seed", "session/title",
  "session/title-llm-request", "subagent/descriptor", "todo/write", "tool-workflow/agent-end",
  "team/member", "team/message/delivered", "team/message/queued", "team/task",
  "tool-workflow/agent-start", "tool-workflow/run-end", "tool-workflow/run-start",
  "tool/code-dispatch", "tool/code-dispatch-start", "schedule/change", "web/deepseek-search-llm-request",
]);
const CONTROL_TYPES = new Set(["step/start", "step/end"]);
const KNOWN_EVENT_TYPES = new Set([
  "agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided",
  "approval/policy", "assistant/chunk", "assistant/message", "command/done", "command/run",
  "compaction/end", "compaction/prune", "compaction/start", "compaction/summary",
  "feedback/record", "goal/change", "hook/invoked", "hook/result", "llm/retry",
  "llm/retry-started", "permission/preset", "plan/mode", "request/context", "request/header",
  "sandbox/mode", "schedule/change", "session/end-seed", "session/title",
  "session/title-llm-request", "step/end", "step/start", "subagent/descriptor", "todo/write",
  "team/member", "team/message/delivered", "team/message/queued", "team/task",
  "tool-workflow/agent-end", "tool-workflow/agent-start", "tool-workflow/run-end",
  "tool-workflow/run-start", "tool/call", "tool/code-dispatch", "tool/code-dispatch-start",
  "tool/result", "turn/end", "turn/start", "user/message", "web/deepseek-search-llm-request",
]);
const HEADER_KEYS = new Set([
  "type", "version", "id", "cwd", "createdAt", "parentSession", "seedLength", "origin",
  "delegationDepth", "agentPreset",
]);
const EVENT_KEYS = new Set(["type", "seq", "time", "data", "ignorable", "sourceEventSeqs", "surfaceOp"]);
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function fail(code, message = code) {
  throw Object.assign(new Error(message), { code });
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!plain(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function safeNonnegative(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function safePositive(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function validDshEpochMillis(value) {
  return safeNonnegative(value) && Number.isFinite(new Date(value).getTime());
}

export function normalizeDshEpochMillis(value) {
  if (!validDshEpochMillis(value)) fail("DSH_INVALID_EPOCH_MILLIS");
  return new Date(value).toISOString();
}

function absoluteFlavor(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  if (WINDOWS_ABSOLUTE.test(value)) return "win32";
  if (path.posix.isAbsolute(value)) return "posix";
  return null;
}

function expandExplicitHome(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("DSH_INVALID_HOME", "DSH home must be a non-empty absolute path");
  }
  let expanded = value;
  if (value === "~") expanded = os.homedir();
  else if (value.startsWith("~/") || value.startsWith("~\\")) expanded = path.join(os.homedir(), value.slice(2));
  if (!path.isAbsolute(expanded)) fail("DSH_INVALID_HOME", "DSH home must resolve to an absolute path");
  return path.resolve(expanded);
}

function explicitHome(options) {
  for (const key of ["home", "dshHome", "dsh-home"]) {
    if (Object.hasOwn(options, key)) return options[key];
  }
  return undefined;
}

export function encodeDshSessionId(raw) {
  if (typeof raw !== "string" || raw.length === 0) fail("DSH_INVALID_SESSION_ID");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let encoded = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const char = String.fromCharCode(code);
    encoded += char !== "~" && /^[A-Za-z0-9._-]$/u.test(char)
      ? char
      : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return encoded;
}

export function dshProjectKey(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.includes("\0")) fail("DSH_INVALID_CWD");
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const char = String.fromCharCode(code);
    if (char === "/" || char === "\\" || char === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (char !== "~" && /^[A-Za-z0-9._-]$/u.test(char)) {
      readable += char;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/u, "") || "root").slice(0, 251)}--`;
}

function readU24(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function scanDshZstdFrames(input) {
  const buffer = Buffer.from(input);
  if (buffer.length === 0) fail("DSH_ZSTD_EMPTY");
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (offset + 4 > buffer.length) return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_HEADER" };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) fail("DSH_ZSTD_BAD_MAGIC");
    offset += 4;
    if (offset === buffer.length) return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_HEADER" };
    const descriptor = buffer[offset++];
    if ((descriptor & 0x18) !== 0) fail("DSH_ZSTD_RESERVED_DESCRIPTOR");
    if ((descriptor & 0x04) === 0) fail("DSH_ZSTD_CHECKSUM_REQUIRED");
    const singleSegment = (descriptor & 0x20) !== 0;
    if (!singleSegment) {
      if (offset + 1 > buffer.length) return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_HEADER" };
      offset += 1;
    }
    const dictionarySize = [0, 1, 2, 4][descriptor & 0x03];
    const fcsFlag = descriptor >>> 6;
    const contentSizeLength = fcsFlag === 0 ? (singleSegment ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
    if (offset + dictionarySize + contentSizeLength > buffer.length) {
      return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_HEADER" };
    }
    offset += dictionarySize + contentSizeLength;
    let lastBlock = false;
    while (!lastBlock) {
      if (offset + 3 > buffer.length) return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_BLOCK" };
      const blockHeader = readU24(buffer, offset);
      offset += 3;
      lastBlock = (blockHeader & 1) === 1;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) fail("DSH_ZSTD_RESERVED_BLOCK");
      const payloadSize = blockType === 1 ? 1 : blockSize;
      if (offset + payloadSize > buffer.length) return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_BLOCK" };
      offset += payloadSize;
    }
    if (offset + 4 > buffer.length) return { frames, torn: true, tornCode: "DSH_ZSTD_TRUNCATED_CHECKSUM" };
    offset += 4;
    frames.push(Buffer.from(buffer.subarray(start, offset)));
  }
  return { frames, torn: false };
}

/** Split complete standard checksummed Zstd frames, discarding only a torn final frame. */
export function splitDshZstdFrames(input) {
  const scan = scanDshZstdFrames(input);
  if (scan.frames.length === 0 && scan.torn) fail(scan.tornCode);
  return scan.frames;
}

export function decodeDshZstdArtifact(input, { decompressor = zlib.zstdDecompressSync } = {}) {
  if (typeof decompressor !== "function") fail("DSH_ZSTD_UNAVAILABLE", "DSH compressed evidence is unavailable");
  const scan = scanDshZstdFrames(input);
  if (scan.frames.length === 0) fail(scan.torn ? scan.tornCode : "DSH_ZSTD_EMPTY");
  const { frames } = scan;
  const decoded = [];
  for (const [index, frame] of frames.entries()) {
    try {
      const bytes = Buffer.from(decompressor(Buffer.from(frame)));
      if (bytes.length === 0 || bytes.at(-1) !== 0x0A) fail("DSH_ZSTD_FRAME_NOT_JSONL_BATCH");
      if (index === 0 && bytes.subarray(0, -1).includes(0x0A)) fail("DSH_ZSTD_FIRST_FRAME_NOT_HEADER_ONLY");
      decoded.push(bytes);
    } catch (error) {
      if (["DSH_ZSTD_FRAME_NOT_JSONL_BATCH", "DSH_ZSTD_FIRST_FRAME_NOT_HEADER_ONLY"].includes(error?.code)) {
        throw error;
      }
      fail("DSH_ZSTD_DECOMPRESSION_FAILED");
    }
  }
  return { frames, bytes: Buffer.concat(decoded), torn: scan.torn };
}

function packedRow(record) {
  if (!PACKED_TYPES.has(record?.type)) return null;
  if (!exactKeys(record, ["type", "seq0", "time0", "data"])
    || !safeNonnegative(record.seq0) || !Number.isSafeInteger(record.time0)) fail("DSH_MALFORMED_PACKED_ROW");
  const data = record.data;
  const tool = record.type === "tool-call-chunks";
  const required = tool ? ["turn", "step", "index", "id", "dt", "args"] : ["turn", "step", "index", "dt", "texts"];
  const optional = tool ? ["name"] : [];
  if (!exactKeys(data, required, optional) || typeof data.turn !== "number" || typeof data.step !== "number"
    || typeof data.index !== "number" || (tool && typeof data.id !== "string")
    || (tool && Object.hasOwn(data, "name") && typeof data.name !== "string")) {
    fail("DSH_MALFORMED_PACKED_ROW");
  }
  const members = tool ? data.args : data.texts;
  if (!Array.isArray(members) || members.length === 0 || members.some((value) => typeof value !== "string")
    || !Array.isArray(data.dt) || data.dt.length !== members.length - 1
    || data.dt.some((value) => !Number.isSafeInteger(value)) || !safeNonnegative(record.seq0 + members.length - 1)) {
    fail("DSH_MALFORMED_PACKED_ROW");
  }
  const events = [];
  let time = record.time0;
  for (let index = 0; index < members.length; index += 1) {
    if (index > 0) time += data.dt[index - 1];
    if (!Number.isSafeInteger(time)) fail("DSH_MALFORMED_PACKED_ROW");
    const chunk = record.type === "text-chunks"
      ? { type: "text-delta", index: data.index, text: members[index] }
      : record.type === "reasoning-chunks"
        ? { type: "reasoning-delta", index: data.index, text: members[index] }
        : { type: "tool-call-delta", index: data.index, id: data.id,
            ...(Object.hasOwn(data, "name") ? { name: data.name } : {}), argumentsDelta: members[index] };
    events.push({ type: "assistant/chunk", seq: record.seq0 + index, time,
      data: { turn: data.turn, step: data.step, chunk } });
  }
  return events;
}

function validateHeader(header) {
  if (!plain(header) || Object.keys(header).some((key) => !HEADER_KEYS.has(key))) fail("DSH_INVALID_HEADER");
  for (const key of ["type", "version", "id", "cwd", "createdAt", "delegationDepth"]) {
    if (!Object.hasOwn(header, key)) fail("DSH_INVALID_HEADER");
  }
  if (header.type !== "session") fail("DSH_INVALID_HEADER");
  if (header.version !== DSH_SESSION_FORMAT_VERSION) fail("DSH_UNSUPPORTED_SESSION_FORMAT");
  if (typeof header.id !== "string") fail("DSH_INVALID_HEADER");
  if (!absoluteFlavor(header.cwd) || !validDshEpochMillis(header.createdAt) || !safeNonnegative(header.delegationDepth)) {
    fail("DSH_INVALID_HEADER");
  }
  for (const key of ["parentSession", "origin", "agentPreset"]) {
    if (Object.hasOwn(header, key) && typeof header[key] !== "string") fail("DSH_INVALID_HEADER");
  }
  if (Object.hasOwn(header, "seedLength") && !safeNonnegative(header.seedLength)) fail("DSH_INVALID_HEADER");
  if (Object.hasOwn(header, "origin") && header.origin !== "subagent") fail("DSH_INVALID_HEADER");
  return header;
}

function validateSurface(event) {
  const eligible = new Set(["user/message", "assistant/message", "tool/result"]);
  if ((Object.hasOwn(event, "sourceEventSeqs") || Object.hasOwn(event, "surfaceOp")) && !eligible.has(event.type)) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (eligible.has(event.type) && !Object.hasOwn(event, "surfaceOp")) fail("DSH_EVENT_SHAPE_DRIFT");
  if (Object.hasOwn(event, "sourceEventSeqs")
    && (!Array.isArray(event.sourceEventSeqs)
      || new Set(event.sourceEventSeqs).size !== event.sourceEventSeqs.length
      || event.sourceEventSeqs.some((seq) => !safeNonnegative(seq) || seq >= event.seq)
      || (event.sourceEventSeqs.length === 0 && event.type !== "assistant/message"))) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (Object.hasOwn(event, "surfaceOp")) {
    const op = event.surfaceOp;
    if (op !== "append" && !(exactKeys(op, ["op", "start", "end"]) && op.op === "replace"
      && safeNonnegative(op.start) && safeNonnegative(op.end))) fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function isDshJsonValueInner(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.every((item) => isDshJsonValueInner(item, seen));
  else {
    const prototype = Object.getPrototypeOf(value);
    result = (prototype === Object.prototype || prototype === null)
      && Object.values(value).every((item) => isDshJsonValueInner(item, seen));
  }
  seen.delete(value);
  return result;
}

export function isDshJsonValue(value) {
  return isDshJsonValueInner(value, new Set());
}

function validateTokenUsage(usage) {
  if (!exactKeys(usage, ["inputTokens", "outputTokens"],
    ["cacheReadTokens", "cacheWriteTokens", "reasoningTokens"])
    || Object.values(usage).some((value) => typeof value !== "number")) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateLlmFailure(error) {
  if (!exactKeys(error, ["message", "code"], ["status", "providerRetryAfterMs", "requestId"])
    || !nonemptyString(error.message) || !nonemptyString(error.code)
    || (Object.hasOwn(error, "status")
      && (!Number.isInteger(error.status) || error.status < 100 || error.status > 599))
    || (Object.hasOwn(error, "providerRetryAfterMs")
      && (!Number.isFinite(error.providerRetryAfterMs) || error.providerRetryAfterMs <= 0))
    || (Object.hasOwn(error, "requestId") && !nonemptyString(error.requestId))) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateContentBlock(block) {
  if (!plain(block)) fail("DSH_EVENT_SHAPE_DRIFT");
  switch (block.type) {
    case "text":
    case "reasoning":
      if (!exactKeys(block, ["type", "text"]) || typeof block.text !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "image": {
      if (!exactKeys(block, ["type", "attachment"]) || !exactKeys(block.attachment,
        ["attachmentId", "mediaType", "bytes", "width", "height"], ["name"])) fail("DSH_EVENT_SHAPE_DRIFT");
      const attachment = block.attachment;
      if (typeof attachment.attachmentId !== "string"
        || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(attachment.mediaType)
        || [attachment.bytes, attachment.width, attachment.height].some((value) => typeof value !== "number")
        || (Object.hasOwn(attachment, "name") && typeof attachment.name !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    }
    case "tool-call":
      if (!exactKeys(block, ["type", "id", "name", "arguments"])
        || [block.id, block.name, block.arguments].some((value) => typeof value !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "tool-result":
      if (!exactKeys(block, ["type", "toolCallId", "content"], ["isError"])
        || typeof block.toolCallId !== "string" || !Array.isArray(block.content)
        || (Object.hasOwn(block, "isError") && typeof block.isError !== "boolean")) fail("DSH_EVENT_SHAPE_DRIFT");
      for (const nested of block.content) validateContentBlock(nested);
      break;
    default:
      fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

const TEAM_CORE_CONTENT_BLOCK_TYPES = new Set(["text", "reasoning", "image", "tool-call", "tool-result"]);

function validateTeamContentBlock(block) {
  if (!plain(block) || !nonemptyString(block.type)) fail("DSH_EVENT_SHAPE_DRIFT");
  switch (block.type) {
    case "text":
    case "reasoning":
      if (!exactKeys(block, ["type", "text"]) || typeof block.text !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "image": {
      if (!exactKeys(block, ["type", "attachment"]) || !exactKeys(block.attachment,
        ["attachmentId", "mediaType", "bytes", "width", "height"], ["name"])) fail("DSH_EVENT_SHAPE_DRIFT");
      const attachment = block.attachment;
      if (!nonemptyString(attachment.attachmentId)
        || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(attachment.mediaType)
        || !safeNonnegative(attachment.bytes) || !safePositive(attachment.width) || !safePositive(attachment.height)
        || (Object.hasOwn(attachment, "name") && typeof attachment.name !== "string")) {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
      break;
    }
    case "tool-call":
      if (!exactKeys(block, ["type", "id", "name", "arguments"]) || !nonemptyString(block.id)
        || typeof block.name !== "string" || typeof block.arguments !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "tool-result":
      if (!exactKeys(block, ["type", "toolCallId", "content"], ["isError"])
        || !nonemptyString(block.toolCallId) || !Array.isArray(block.content)
        || (Object.hasOwn(block, "isError") && typeof block.isError !== "boolean")) fail("DSH_EVENT_SHAPE_DRIFT");
      for (const nested of block.content) validateTeamContentBlock(nested);
      break;
    default:
      if (TEAM_CORE_CONTENT_BLOCK_TYPES.has(block.type) || !isDshJsonValue(block)) fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validTeamTaskId(value) {
  if (!nonemptyString(value)) return false;
  const match = /^task-(\d+)$/u.exec(value);
  return match === null || Number.isSafeInteger(Number(match[1]));
}

function validateTeamEvent(event) {
  const data = event.data;
  if (!plain(data) || !safeNonnegative(data.version) || !nonemptyString(data.teamId)) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (data.version !== 1) return;
  if (event.type === "team/member") {
    if (!exactKeys(data, ["version", "teamId", "member"]) || !exactKeys(data.member,
      ["id", "name", "description", "provider", "context", "phase"], ["error"])) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    const member = data.member;
    if (!nonemptyString(member.id) || [member.name, member.description, member.provider]
      .some((value) => typeof value !== "string") || !["fresh", "fork"].includes(member.context)
      || !["provisioning", "active", "failed"].includes(member.phase)
      || (Object.hasOwn(member, "error") && typeof member.error !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (event.type === "team/task") {
    if (!exactKeys(data, ["version", "teamId", "task"]) || !exactKeys(data.task,
      ["id", "revision", "subject", "description", "status", "blockedBy", "writeScopes"], ["ownerId"])) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    const task = data.task;
    if (!validTeamTaskId(task.id) || !safePositive(task.revision)
      || typeof task.subject !== "string" || typeof task.description !== "string"
      || !["pending", "in_progress", "completed", "deleted"].includes(task.status)
      || (Object.hasOwn(task, "ownerId") && !nonemptyString(task.ownerId))
      || !Array.isArray(task.blockedBy) || task.blockedBy.some((id) => !validTeamTaskId(id))
      || !Array.isArray(task.writeScopes) || task.writeScopes.some((scope) => typeof scope !== "string")) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (event.type === "team/message/queued") {
    if (!exactKeys(data, ["version", "teamId", "message"]) || !exactKeys(data.message,
      ["id", "senderId", "senderName", "targetId", "delivery", "content"])) fail("DSH_EVENT_SHAPE_DRIFT");
    const message = data.message;
    if (![message.id, message.senderId, message.targetId].every(nonemptyString)
      || typeof message.senderName !== "string" || !["quiet", "wakeup"].includes(message.delivery)
      || !Array.isArray(message.content)) fail("DSH_EVENT_SHAPE_DRIFT");
    for (const block of message.content) validateTeamContentBlock(block);
    return;
  }
  if (!exactKeys(data, ["version", "teamId", "messageId", "targetId"])
    || !nonemptyString(data.messageId) || !nonemptyString(data.targetId)) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateMessage(message, role) {
  if (!exactKeys(message, ["id", "role", "content", "source"])
    || message.role !== role || typeof message.id !== "string"
    || !Array.isArray(message.content) || !plain(message.source)) fail("DSH_EVENT_SHAPE_DRIFT");
  for (const part of message.content) validateContentBlock(part);
}

function validateUserSource(source) {
  if (source.kind === "user") {
    if (!exactKeys(source, ["kind"], ["rpcId", "clientTimeZone"])
      || (Object.hasOwn(source, "rpcId") && typeof source.rpcId !== "string")
      || (Object.hasOwn(source, "clientTimeZone") && typeof source.clientTimeZone !== "string")
      || (Object.hasOwn(source, "clientTimeZone") && !Object.hasOwn(source, "rpcId"))) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (source.kind === "plugin") {
    if (typeof source.plugin !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
    if (source.plugin === "compact") {
      if (!exactKeys(source, ["kind", "plugin", "compactionId"], ["sourceCommandId"])
        || !nonemptyString(source.compactionId)
        || (Object.hasOwn(source, "sourceCommandId") && !nonemptyString(source.sourceCommandId))) {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
      return;
    }
    if (!Object.hasOwn(source, "form")) {
      if (!exactKeys(source, ["kind", "plugin"])) fail("DSH_EVENT_SHAPE_DRIFT");
    } else if (["instructions", "catalog", "relay", "recall"].includes(source.form)) {
      if (!exactKeys(source, ["kind", "plugin", "form"])) fail("DSH_EVENT_SHAPE_DRIFT");
    } else if (source.form === "notice") {
      if (!exactKeys(source, ["kind", "plugin", "form", "summary"]) || typeof source.summary !== "string") {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
    } else if (source.form === "snapshot") {
      if (!exactKeys(source, ["kind", "plugin", "form", "sections"]) || !Array.isArray(source.sections)
        || source.sections.some((section) => !exactKeys(section, ["name", "text"])
          || typeof section.name !== "string" || typeof section.text !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
    } else fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (source.kind === "goal") {
    if (!exactKeys(source, ["kind", "goalId", "revision", "round"])
      || !nonemptyString(source.goalId) || !safePositive(source.revision) || !safePositive(source.round)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (source.kind === "agent-instructions") {
    if (!exactKeys(source, ["kind", "form", "changes"], ["baseline", "baselineIdentity"])
      || source.form !== "instructions" || !Array.isArray(source.changes)
      || (Object.hasOwn(source, "baseline") && source.baseline !== true)
      || (Object.hasOwn(source, "baselineIdentity") && typeof source.baselineIdentity !== "string")) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    for (const change of source.changes) {
      if (!exactKeys(change, ["action", "scope", "path"], ["digest"])
        || !["set", "replace", "remove"].includes(change.action)
        || typeof change.scope !== "string" || typeof change.path !== "string"
        || (Object.hasOwn(change, "digest") && typeof change.digest !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (source.kind === "session-reference") {
    if (!exactKeys(source, ["kind", "form", "version", "references"])
      || source.form !== "recall" || source.version !== 1 || !Array.isArray(source.references)) fail("DSH_EVENT_SHAPE_DRIFT");
    for (const ref of source.references) {
      if (!exactKeys(ref, ["sessionId", "label", "capturedThroughSeq", "compacted", "originalMessages",
        "retainedMessages", "omittedMessages", "omittedBytes", "truncated", "inputIndex"])
        || typeof ref.sessionId !== "string" || typeof ref.label !== "string"
        || !(ref.capturedThroughSeq === null || safeNonnegative(ref.capturedThroughSeq))
        || typeof ref.compacted !== "boolean" || typeof ref.truncated !== "boolean"
        || [ref.originalMessages, ref.retainedMessages, ref.omittedMessages, ref.omittedBytes, ref.inputIndex]
          .some((value) => !safeNonnegative(value))) fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (["coordinator", "subagent-report"].includes(source.kind)) {
    if (!exactKeys(source, ["kind", "form", "senderSessionId"]) || source.form !== "relay"
      || typeof source.senderSessionId !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (source.kind === "subagent-settled") {
    if (!exactKeys(source, ["kind", "form", "summary", "senderSessionId"]) || source.form !== "notice"
      || typeof source.summary !== "string" || typeof source.senderSessionId !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (source.kind === "skill-catalog") {
    if (!exactKeys(source, ["kind", "form", "entries"], ["update"]) || source.form !== "catalog"
      || (Object.hasOwn(source, "update") && source.update !== true) || !Array.isArray(source.entries)
      || source.entries.some((entry) => !exactKeys(entry, ["name", "description"])
        || typeof entry.name !== "string" || typeof entry.description !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (source.kind === "skill-invocation") {
    if (!exactKeys(source, ["kind", "name", "form"]) || source.form !== "instructions"
      || typeof source.name !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateAssistantSource(source) {
  if (!exactKeys(source, ["kind", "provider", "model"], ["replayState"]) || source.kind !== "model"
    || typeof source.provider !== "string" || typeof source.model !== "string"
    || (Object.hasOwn(source, "replayState") && !isDshJsonValue(source.replayState))) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateToolResultMessage(message, eventData) {
  validateMessage(message, "user");
  if (!exactKeys(message.source, ["kind", "callId"]) || message.source.kind !== "tool"
    || typeof message.source.callId !== "string" || message.content.length !== 1) fail("DSH_EVENT_SHAPE_DRIFT");
  const result = message.content[0];
  if (!exactKeys(result, ["type", "toolCallId", "content"], ["isError"])
    || result.type !== "tool-result" || result.toolCallId !== message.source.callId
    || !Array.isArray(result.content)
    || (Object.hasOwn(result, "isError") && typeof result.isError !== "boolean")) fail("DSH_EVENT_SHAPE_DRIFT");
  if (Object.hasOwn(eventData, "error") && (!exactKeys(eventData.error, ["name", "code"])
    || typeof eventData.error.name !== "string" || typeof eventData.error.code !== "string")) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateReplayEnvelope(value) {
  if (!exactKeys(value, ["response"], ["blocks"]) || !isDshJsonValue(value.response)
    || (Object.hasOwn(value, "blocks") && (!Array.isArray(value.blocks) || !isDshJsonValue(value.blocks)))) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateStreamChunk(chunk) {
  if (!plain(chunk)) fail("DSH_EVENT_SHAPE_DRIFT");
  switch (chunk.type) {
    case "block-start":
      if (!exactKeys(chunk, ["type", "index", "blockType"]) || typeof chunk.index !== "number"
        || !["text", "reasoning", "image", "tool-call", "tool-result"].includes(chunk.blockType)) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "text-delta":
    case "reasoning-delta":
      if (!exactKeys(chunk, ["type", "index", "text"]) || typeof chunk.index !== "number"
        || typeof chunk.text !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "tool-call-delta":
      if (!exactKeys(chunk, ["type", "index", "id", "argumentsDelta"], ["name"])
        || typeof chunk.index !== "number" || typeof chunk.id !== "string"
        || typeof chunk.argumentsDelta !== "string"
        || (Object.hasOwn(chunk, "name") && typeof chunk.name !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "block-end":
      if (!exactKeys(chunk, ["type", "index", "block"]) || typeof chunk.index !== "number") fail("DSH_EVENT_SHAPE_DRIFT");
      validateContentBlock(chunk.block);
      break;
    case "usage":
      if (!exactKeys(chunk, ["type", "usage"])) fail("DSH_EVENT_SHAPE_DRIFT");
      validateTokenUsage(chunk.usage);
      break;
    case "finish": {
      if (!exactKeys(chunk, ["type", "reason"], ["replayState"]) || !plain(chunk.reason)) fail("DSH_EVENT_SHAPE_DRIFT");
      if (["stop", "tool-calls", "max-tokens"].includes(chunk.reason.kind)) {
        if (!exactKeys(chunk.reason, ["kind"])) fail("DSH_EVENT_SHAPE_DRIFT");
      } else if (["aborted", "error"].includes(chunk.reason.kind)) {
        if (!exactKeys(chunk.reason, ["kind", "failure"])) fail("DSH_EVENT_SHAPE_DRIFT");
        validateLlmFailure(chunk.reason.failure);
      } else fail("DSH_EVENT_SHAPE_DRIFT");
      if (Object.hasOwn(chunk, "replayState")) validateReplayEnvelope(chunk.replayState);
      break;
    }
    default:
      fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateSupportedEvent(event) {
  const data = event.data;
  switch (event.type) {
    case "turn/start":
      if (!exactKeys(data, ["turn"]) || !safePositive(data.turn)) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "step/start":
    case "step/end":
      if (!exactKeys(data, ["turn", "step"]) || !safePositive(data.turn) || !safePositive(data.step)) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "turn/end": {
      if (!exactKeys(data, ["turn", "reason"]) || !safePositive(data.turn) || !plain(data.reason)) fail("DSH_EVENT_SHAPE_DRIFT");
      const kind = data.reason.kind;
      if (!["completed", "aborted", "blocked", "error", "max-tokens", "interrupted"].includes(kind)) fail("DSH_EVENT_SHAPE_DRIFT");
      if (kind === "aborted") {
        if (!exactKeys(data.reason, ["kind", "reason"]) || !plain(data.reason.reason)) fail("DSH_EVENT_SHAPE_DRIFT");
        const abort = data.reason.reason;
        if (abort.kind === "hook") {
          if (!exactKeys(abort, ["kind", "reason"]) || typeof abort.reason !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
        } else if (!["user", "parent", "disposed", "legacy"].includes(abort.kind)
          || !exactKeys(abort, ["kind"])) fail("DSH_EVENT_SHAPE_DRIFT");
      } else if (kind === "error") {
        if (!exactKeys(data.reason, ["kind", "error"])) fail("DSH_EVENT_SHAPE_DRIFT");
        validateLlmFailure(data.reason.error);
      } else if (!exactKeys(data.reason, ["kind"])) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    }
    case "user/message":
      validateMessage(data, "user");
      validateUserSource(data.source);
      break;
    case "assistant/message":
      if (!exactKeys(data, ["turn", "step", "message"], ["usage", "interrupted"]) || !safePositive(data.turn)
        || !safePositive(data.step)) fail("DSH_EVENT_SHAPE_DRIFT");
      validateMessage(data.message, "assistant");
      validateAssistantSource(data.message.source);
      if (Object.hasOwn(data, "usage")) validateTokenUsage(data.usage);
      if (Object.hasOwn(data, "interrupted") && data.interrupted !== true) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "assistant/chunk":
      if (!exactKeys(data, ["turn", "step", "chunk"]) || !safePositive(data.turn)
        || !safePositive(data.step) || !plain(data.chunk)) fail("DSH_EVENT_SHAPE_DRIFT");
      validateStreamChunk(data.chunk);
      break;
    case "tool/call":
      if (!exactKeys(data, ["turn", "step", "callId", "name", "arguments"])
        || !safePositive(data.turn) || !safePositive(data.step)
        || [data.callId, data.name, data.arguments].some((value) => typeof value !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "tool/result":
      if (!exactKeys(data, ["turn", "step", "message"], ["error", "meta"]) || !safePositive(data.turn)
        || !safePositive(data.step)) fail("DSH_EVENT_SHAPE_DRIFT");
      validateToolResultMessage(data.message, data);
      if (Object.hasOwn(data, "meta") && !isDshJsonValue(data.meta)) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    default:
      break;
  }
}

// Pinned core payloads that are required for replay but intentionally omitted from BH normalization.
function validateKnownUnsupportedEvent(event) {
  const data = event.data;
  switch (event.type) {
    case "permission/preset":
      if (!exactKeys(data, ["preset"], ["origin"]) || typeof data.preset !== "string"
        || (Object.hasOwn(data, "origin")
          && !["default", "selection", "inferred"].includes(data.origin))) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "sandbox/mode":
      if (!exactKeys(data, ["mode"], ["source"])
        || !["read-only", "workspace-write", "danger-full-access"].includes(data.mode)
        || (Object.hasOwn(data, "source") && data.source !== "delegation")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "approval/policy":
      if (!exactKeys(data, ["policy"], ["source"]) || !["ask", "never"].includes(data.policy)
        || (Object.hasOwn(data, "source") && data.source !== "delegation")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "agent/inbox/spliced":
      validateInboxSplice(data);
      break;
    case "session/title":
      validateSessionTitle(data);
      break;
    case "session/title-llm-request":
      validateSessionTitleRequest(data);
      break;
    case "subagent/descriptor":
      validateSubagentDescriptor(data);
      break;
    case "agent-preset/selected":
      if (!exactKeys(data, ["agentPreset"]) || typeof data.agentPreset !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "approval/asked":
      if (!exactKeys(data, ["id", "toolName"], ["callId", "reason"])
        || typeof data.id !== "string" || !nonemptyString(data.toolName)
        || (Object.hasOwn(data, "callId") && typeof data.callId !== "string")
        || (Object.hasOwn(data, "reason") && typeof data.reason !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "approval/decided":
      if (!exactKeys(data, ["id", "outcome"]) || typeof data.id !== "string"
        || !["allowed-once", "rejected", "cancelled", "unavailable"].includes(data.outcome)) {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
      break;
    case "command/run":
      validateCommandRun(data);
      break;
    case "command/done":
      validateCommandDone(data);
      break;
    case "compaction/start":
    case "compaction/end":
    case "compaction/prune":
    case "compaction/summary":
      validateCompactionEvent(event.type, data);
      break;
    case "feedback/record":
      if (!exactKeys(data, ["text"]) || typeof data.text !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "goal/change":
      validateGoalChange(data);
      break;
    case "hook/invoked":
    case "hook/result":
      validateHookEvent(event.type, data);
      break;
    case "llm/retry":
    case "llm/retry-started":
      validateRetryEvent(event.type, data);
      break;
    case "plan/mode":
      if (!exactKeys(data, ["active"]) || typeof data.active !== "boolean") fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "tool-workflow/run-start":
    case "tool-workflow/agent-start":
    case "tool-workflow/agent-end":
    case "tool-workflow/run-end":
      validateWorkflowEvent(event.type, data);
      break;
    case "tool/code-dispatch-start":
    case "tool/code-dispatch":
      validateCodeDispatchEvent(event.type, data);
      break;
    case "schedule/change":
      validateScheduleChange(data);
      break;
    case "web/deepseek-search-llm-request":
      validateDeepSeekSearchRequest(data);
      break;
    case "todo/write":
      if (!exactKeys(data, ["todos"]) || !Array.isArray(data.todos)
        || data.todos.some((todo) => !exactKeys(todo, ["content", "status"])
          || !nonemptyString(todo.content) || todo.content.trim() !== todo.content
          || !["pending", "in_progress", "completed"].includes(todo.status))) {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
      if (new Set(data.todos.map((todo) => todo.content)).size !== data.todos.length) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    case "request/context":
      if (!exactKeys(data, ["provider", "model"], ["contextWindow"])
        || !nonemptyString(data.provider) || !nonemptyString(data.model)
        || (Object.hasOwn(data, "contextWindow")
          && !safePositive(data.contextWindow))) {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
      break;
    case "request/header":
      validateRequestHeader(data);
      break;
    case "team/member":
    case "team/task":
    case "team/message/queued":
    case "team/message/delivered":
      validateTeamEvent(event);
      break;
    case "session/end-seed":
      if (!exactKeys(data, [])) fail("DSH_EVENT_SHAPE_DRIFT");
      break;
    default:
      fail("DSH_KNOWN_EVENT_UNVALIDATED");
  }
}

function validateLlmCallConfig(config) {
  if (!exactKeys(config, ["provider", "model"],
    ["reasoningEffort", "temperature", "maxTokens", "stop"])
    || !nonemptyString(config.provider) || !nonemptyString(config.model)
    || (Object.hasOwn(config, "reasoningEffort") && !nonemptyString(config.reasoningEffort))
    || (Object.hasOwn(config, "temperature") && !Number.isFinite(config.temperature))
    || (Object.hasOwn(config, "maxTokens") && !Number.isFinite(config.maxTokens))
    || (Object.hasOwn(config, "stop")
      && (!Array.isArray(config.stop) || config.stop.some((value) => typeof value !== "string")))) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateAdapterDefaults(defaults) {
  if (!exactKeys(defaults, [], ["reasoningEffort", "maxTokens"])
    || Object.values(defaults).some((value) => value !== true)) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateToolSchema(tool) {
  if (!exactKeys(tool, ["name", "description", "parameters"])
    || typeof tool.name !== "string" || typeof tool.description !== "string"
    || !plain(tool.parameters) || !isDshJsonValue(tool.parameters)) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateRequestHeader(data) {
  if (!exactKeys(data, ["header", "reason"])
    || !["initial", "resume", "change"].includes(data.reason)
    || !exactKeys(data.header, ["config"], ["adapterDefaults", "system", "tools"])) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  validateLlmCallConfig(data.header.config);
  if (Object.hasOwn(data.header, "adapterDefaults")) {
    validateAdapterDefaults(data.header.adapterDefaults);
    if (Object.hasOwn(data.header.adapterDefaults, "reasoningEffort")
      && !Object.hasOwn(data.header.config, "reasoningEffort")) fail("DSH_EVENT_SHAPE_DRIFT");
    if (Object.hasOwn(data.header.adapterDefaults, "maxTokens")
      && !Object.hasOwn(data.header.config, "maxTokens")) fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (Object.hasOwn(data.header, "system") && typeof data.header.system !== "string") {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (Object.hasOwn(data.header, "tools")) {
    if (!Array.isArray(data.header.tools)) fail("DSH_EVENT_SHAPE_DRIFT");
    for (const tool of data.header.tools) validateToolSchema(tool);
  }
}

function nonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validateUserMessageValue(message) {
  validateMessage(message, "user");
  validateUserSource(message.source);
}

function validateInboxSplice(data) {
  if (!exactKeys(data, ["target", "start", "inserted"], ["removedCount", "outcome"])
    || !["next-turn", "next-step"].includes(data.target) || !safeNonnegative(data.start)
    || !Array.isArray(data.inserted)
    || (Object.hasOwn(data, "removedCount") && !safeNonnegative(data.removedCount))
    || (Object.hasOwn(data, "outcome") && data.outcome !== "canceled")) fail("DSH_EVENT_SHAPE_DRIFT");
  for (const message of data.inserted) validateUserMessageValue(message);
}

function validateSessionTitle(data) {
  if (!exactKeys(data, ["title", "messageSeqs", "source"]) || !nonemptyString(data.title)
    || !Array.isArray(data.messageSeqs) || data.messageSeqs.some((seq) => !safeNonnegative(seq))
    || !strictlyIncreasing(data.messageSeqs) || !plain(data.source)) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (["fallback", "user"].includes(data.source.kind)) {
    if (!exactKeys(data.source, ["kind"])) fail("DSH_EVENT_SHAPE_DRIFT");
  } else if (data.source.kind === "provider") {
    if (!exactKeys(data.source, ["kind", "provider"], ["model"]) || !nonemptyString(data.source.provider)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    if (Object.hasOwn(data.source, "model") && (!exactKeys(data.source.model, ["provider", "model"])
      || !nonemptyString(data.source.model.provider) || !nonemptyString(data.source.model.model))) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
  } else fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateAnyMessage(message) {
  if (!plain(message)) fail("DSH_EVENT_SHAPE_DRIFT");
  if (message.role === "assistant") {
    validateMessage(message, "assistant");
    validateAssistantSource(message.source);
    return;
  }
  if (message.role !== "user") fail("DSH_EVENT_SHAPE_DRIFT");
  if (message.source?.kind === "tool") {
    validateToolResultMessage(message, {});
    return;
  }
  validateUserMessageValue(message);
}

function validateSessionTitleRequest(data) {
  if (!exactKeys(data, ["titleProvider", "messageSeqs", "route", "system", "messages", "maxTokens"])
    || !nonemptyString(data.titleProvider) || !Array.isArray(data.messageSeqs) || data.messageSeqs.length === 0
    || data.messageSeqs.some((seq) => !safeNonnegative(seq))
    || !strictlyIncreasing(data.messageSeqs)
    || !exactKeys(data.route, ["provider", "model"]) || !nonemptyString(data.route.provider)
    || !nonemptyString(data.route.model) || typeof data.system !== "string" || !Array.isArray(data.messages)
    || !safePositive(data.maxTokens)) fail("DSH_EVENT_SHAPE_DRIFT");
  for (const message of data.messages) validateAnyMessage(message);
}

function validateSubagentDescriptor(data) {
  if (!plain(data) || data.version !== 2 || !["one-shot", "continuable"].includes(data.mode)
    || typeof data.provider !== "string") fail("DSH_EVENT_SHAPE_DRIFT");
  const optionalStrings = ["label", "agentProvider", "agentModel", "persona"];
  if (optionalStrings.some((key) => Object.hasOwn(data, key) && typeof data[key] !== "string")) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  if (data.mode === "one-shot") {
    if (!exactKeys(data, ["version", "mode", "provider"], ["label"])) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (!exactKeys(data, ["version", "mode", "provider", "label"],
    ["agentProvider", "agentModel", "persona", "toolFilter"])) fail("DSH_EVENT_SHAPE_DRIFT");
  if (Object.hasOwn(data, "toolFilter")) {
    const filter = data.toolFilter;
    if (!exactKeys(filter, [], ["allow", "deny"])
      || (!Object.hasOwn(filter, "allow") && !Object.hasOwn(filter, "deny"))) fail("DSH_EVENT_SHAPE_DRIFT");
    for (const key of ["allow", "deny"]) {
      if (Object.hasOwn(filter, key)
        && (!Array.isArray(filter[key]) || filter[key].some((value) => typeof value !== "string"))) {
        fail("DSH_EVENT_SHAPE_DRIFT");
      }
    }
  }
}

function validateCommandRun(data) {
  if (!exactKeys(data, ["commandId", "name", "source"], ["args"])
    || !nonemptyString(data.commandId) || !nonemptyString(data.name)
    || !exactKeys(data.source, ["kind"]) || data.source.kind !== "user"
    || (Object.hasOwn(data, "args") && typeof data.args !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateCommandDone(data) {
  if (!exactKeys(data, ["commandId", "kind"], ["text", "sourceEventSeq"])
    || typeof data.commandId !== "string" || !["success", "error"].includes(data.kind)
    || (Object.hasOwn(data, "text") && typeof data.text !== "string")
    || (Object.hasOwn(data, "sourceEventSeq")
      && (data.kind !== "success" || !safeNonnegative(data.sourceEventSeq)))) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateSeqList(value) {
  return Array.isArray(value) && value.every(safeNonnegative) && new Set(value).size === value.length;
}

function strictlyIncreasing(values) {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function validateShadow(data) {
  return exactKeys(data.shadowedRange, ["start", "end"]) && safeNonnegative(data.shadowedRange.start)
    && safeNonnegative(data.shadowedRange.end) && validateSeqList(data.shadowedSeqs)
    && safeNonnegative(data.shadowedTokenCount);
}

function validateCompactionEvent(type, data) {
  if (type === "compaction/prune") {
    if (!exactKeys(data, ["shadowedRange", "shadowedSeqs", "shadowedTokenCount"]) || !validateShadow(data)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (["compaction/start", "compaction/end"].includes(type)) {
    const optional = type === "compaction/end" ? ["sourceCommandId", "error"] : ["sourceCommandId"];
    if (!exactKeys(data, ["compactionId", "turn"], optional) || !nonemptyString(data.compactionId)
      || !(data.turn === null || safePositive(data.turn))
      || (Object.hasOwn(data, "sourceCommandId") && !nonemptyString(data.sourceCommandId))
      || (Object.hasOwn(data, "error") && typeof data.error !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (!exactKeys(data, ["compactionId", "summary", "shadowedRange", "shadowedSeqs",
    "shadowedTokenCount", "provider", "model"],
  ["sourceCommandId", "maxTokens", "usage", "rawOutput", "llmStreamCall"]) || !nonemptyString(data.compactionId)
    || !Array.isArray(data.summary) || !validateShadow(data) || typeof data.provider !== "string"
    || typeof data.model !== "string"
    || (Object.hasOwn(data, "sourceCommandId") && !nonemptyString(data.sourceCommandId))) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  for (const block of data.summary) validateContentBlock(block);
  if (Object.hasOwn(data, "rawOutput")) {
    if (!Array.isArray(data.rawOutput)) fail("DSH_EVENT_SHAPE_DRIFT");
    for (const block of data.rawOutput) validateContentBlock(block);
  }
  if (Object.hasOwn(data, "llmStreamCall") && data.llmStreamCall !== true) fail("DSH_EVENT_SHAPE_DRIFT");
  if (data.llmStreamCall === true && !Object.hasOwn(data, "rawOutput")) fail("DSH_EVENT_SHAPE_DRIFT");
  if (Object.hasOwn(data, "maxTokens") && !Number.isFinite(data.maxTokens)) fail("DSH_EVENT_SHAPE_DRIFT");
  if (Object.hasOwn(data, "usage")) validateTokenUsage(data.usage);
}

function validateGoalRef(value) {
  return plain(value) && nonemptyString(value.id) && safePositive(value.revision);
}

function validateGoalChange(data) {
  if (!plain(data) || data.kind !== "goal/change" || data.version !== 1) fail("DSH_EVENT_SHAPE_DRIFT");
  if (data.operation === "clear") {
    if (!exactKeys(data, ["kind", "version", "operation", "cleared", "clearedAt"])
      || !exactKeys(data.cleared, ["id", "revision"]) || !validateGoalRef(data.cleared)
      || !safeNonnegative(data.clearedAt)) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (!["create", "edit", "pause", "resume", "complete", "block"].includes(data.operation)
    || !exactKeys(data, ["kind", "version", "operation", "goal", "roundsStarted", "createdAt", "updatedAt"])
    || !validateGoalRef(data.goal)
    || !exactKeys(data.goal, ["id", "revision", "objective", "phase", "maxGoalRounds"], ["blockedReason"])
    || !nonemptyString(data.goal.id) || !nonemptyString(data.goal.objective)
    || data.goal.objective.trim() !== data.goal.objective
    || !["active", "paused", "blocked", "complete"].includes(data.goal.phase)
    || !safePositive(data.goal.maxGoalRounds) || !safeNonnegative(data.roundsStarted)
    || !safeNonnegative(data.createdAt) || !safeNonnegative(data.updatedAt)
    || data.updatedAt < data.createdAt) fail("DSH_EVENT_SHAPE_DRIFT");
  const hasBlock = Object.hasOwn(data.goal, "blockedReason");
  if (hasBlock !== (data.goal.phase === "blocked")) fail("DSH_EVENT_SHAPE_DRIFT");
  if (hasBlock && (!exactKeys(data.goal.blockedReason, ["code", "message"])
    || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(data.goal.blockedReason.code)
    || !nonemptyString(data.goal.blockedReason.message)
    || data.goal.blockedReason.message.trim() !== data.goal.blockedReason.message)) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateHookEvent(type, data) {
  if (type === "hook/invoked") {
    if (!exactKeys(data, ["turn", "point", "dialect", "handlerId"], ["matcher"])
      || !safePositive(data.turn) || !nonemptyString(data.point)
      || !["claude-code", "codex"].includes(data.dialect) || !nonemptyString(data.handlerId)
      || (Object.hasOwn(data, "matcher") && typeof data.matcher !== "string")) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (!exactKeys(data, ["turn", "point", "handlerId", "decision", "durationMs"],
  ["exitCode", "stderrSummary"]) || !safePositive(data.turn) || !nonemptyString(data.point)
    || !nonemptyString(data.handlerId) || typeof data.decision !== "string"
    || !Number.isFinite(data.durationMs) || data.durationMs < 0
    || (Object.hasOwn(data, "exitCode") && !Number.isFinite(data.exitCode))
    || (Object.hasOwn(data, "stderrSummary") && typeof data.stderrSummary !== "string")) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function validateRetryEvent(type, data) {
  if (type === "llm/retry-started") {
    if (!exactKeys(data, ["retryId", "turn", "step", "retry"]) || !nonemptyString(data.retryId)
      || !safePositive(data.turn) || !safePositive(data.step) || !safePositive(data.retry)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  const required = ["retryId", "turn", "step", "provider", "mode", "policyKey", "retry", "delayMs", "failure"];
  const optional = data.mode === "normal" ? [] : [];
  if (data.mode === "normal") required.push("maxRetries");
  if (!exactKeys(data, required, optional) || !nonemptyString(data.retryId)
    || !safePositive(data.turn) || !safePositive(data.step) || !nonemptyString(data.provider)
    || !["normal", "always"].includes(data.mode) || !nonemptyString(data.policyKey)
    || !safePositive(data.retry) || !Number.isFinite(data.delayMs) || data.delayMs < 0
    || data.delayMs > MAX_TIMER_DELAY_MS
    || (data.mode === "normal" && (!safePositive(data.maxRetries) || data.retry > data.maxRetries))) {
    fail("DSH_EVENT_SHAPE_DRIFT");
  }
  validateLlmFailure(data.failure);
}

function validateWorkflowEvent(type, data) {
  if (type === "tool-workflow/run-start") {
    if (!exactKeys(data, ["runId", "name"]) || !nonemptyString(data.runId) || !nonemptyString(data.name)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (type === "tool-workflow/agent-start") {
    if (!exactKeys(data, ["runId", "seq", "label", "childId"], ["phase"])
      || !nonemptyString(data.runId) || !safePositive(data.seq) || typeof data.label !== "string"
      || !nonemptyString(data.childId) || (Object.hasOwn(data, "phase") && typeof data.phase !== "string")) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (type === "tool-workflow/agent-end") {
    if (!exactKeys(data, ["runId", "seq", "outcome"]) || !nonemptyString(data.runId)
      || !safePositive(data.seq) || !["completed", "failed", "cancelled"].includes(data.outcome)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (!exactKeys(data, ["runId", "stopReason"]) || !nonemptyString(data.runId)
    || !["completed", "cancelled", "error"].includes(data.stopReason)) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateCodeDispatchEvent(type, data) {
  const required = ["rootCallId", "parentCallId", "subCallId", "name", "arguments"];
  if (type === "tool/code-dispatch") required.push("isError", "content");
  if (!exactKeys(data, required) || [data.rootCallId, data.parentCallId, data.subCallId, data.name]
    .some((value) => !nonemptyString(value)) || !isDshJsonValue(data.arguments)) fail("DSH_EVENT_SHAPE_DRIFT");
  if (type === "tool/code-dispatch") {
    if (typeof data.isError !== "boolean" || !Array.isArray(data.content)) fail("DSH_EVENT_SHAPE_DRIFT");
    for (const block of data.content) validateContentBlock(block);
  }
}

function validateScheduleId(value) {
  return nonemptyString(value) && value.trim() === value;
}

function validateScheduleInstant(value) {
  return typeof value === "string" && /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function validateScheduleRecord(record) {
  const common = plain(record) && validateScheduleId(record.id) && typeof record.prompt === "string"
    && record.prompt.length > 0 && record.prompt.trim() === record.prompt && validateScheduleInstant(record.scheduledAt);
  if (!common) fail("DSH_EVENT_SHAPE_DRIFT");
  if (record.kind === "after") {
    if (!exactKeys(record, ["id", "kind", "prompt", "afterSeconds", "scheduledAt"])
      || !safePositive(record.afterSeconds)) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (record.kind === "at") {
    if (!exactKeys(record, ["id", "kind", "prompt", "scheduledAt"])) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  if (record.kind === "every") {
    if (!exactKeys(record, ["id", "kind", "prompt", "everySeconds", "scheduledAt"])
      || !safePositive(record.everySeconds) || record.everySeconds < 300
      || !Number.isSafeInteger(record.everySeconds * 1_000)) fail("DSH_EVENT_SHAPE_DRIFT");
    return;
  }
  fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateScheduleChange(data) {
  if (!plain(data) || data.version !== 1) fail("DSH_EVENT_SHAPE_DRIFT");
  if (data.operation === "create") {
    if (!exactKeys(data, ["version", "operation", "schedule"])) fail("DSH_EVENT_SHAPE_DRIFT");
    validateScheduleRecord(data.schedule);
    return;
  }
  if (data.operation === "delete") {
    if (!exactKeys(data, ["version", "operation", "id"]) || !validateScheduleId(data.id)) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  if (data.operation === "dispatch") {
    if (!exactKeys(data, ["version", "operation", "id"], ["acceptedAt"])
      || !validateScheduleId(data.id)
      || (Object.hasOwn(data, "acceptedAt") && !validateScheduleInstant(data.acceptedAt))) {
      fail("DSH_EVENT_SHAPE_DRIFT");
    }
    return;
  }
  fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateDeepSeekSearchRequest(data) {
  if (!exactKeys(data, ["endpoint", "apiVersion", "body"]) || !nonemptyString(data.endpoint)
    || !nonemptyString(data.apiVersion) || !exactKeys(data.body, ["model", "max_tokens", "messages", "tools"])
    || !nonemptyString(data.body.model) || !safePositive(data.body.max_tokens)
    || !Array.isArray(data.body.messages) || data.body.messages.length !== 1
    || !exactKeys(data.body.messages[0], ["role", "content"]) || data.body.messages[0].role !== "user"
    || !Array.isArray(data.body.messages[0].content) || data.body.messages[0].content.length !== 1
    || !exactKeys(data.body.messages[0].content[0], ["type", "text"])
    || data.body.messages[0].content[0].type !== "text"
    || typeof data.body.messages[0].content[0].text !== "string"
    || !Array.isArray(data.body.tools) || data.body.tools.length !== 1
    || !exactKeys(data.body.tools[0], ["type", "name", "max_uses"])
    || data.body.tools[0].type !== "web_search_20250305" || data.body.tools[0].name !== "web_search"
    || !safePositive(data.body.tools[0].max_uses)) fail("DSH_EVENT_SHAPE_DRIFT");
}

function validateEventEnvelope(event, expectedSeq) {
  const unknownIgnorable = plain(event) && typeof event.type === "string"
    && event.ignorable === true && !KNOWN_EVENT_TYPES.has(event.type);
  if (!plain(event) || Object.keys(event).some((key) => !EVENT_KEYS.has(key))
    || typeof event.type !== "string" || event.type.length === 0 || event.seq !== expectedSeq
    || !safeNonnegative(event.seq) || !validDshEpochMillis(event.time)
    || !(unknownIgnorable ? isDshJsonValue(event.data) : plain(event.data))
    || (Object.hasOwn(event, "ignorable") && event.ignorable !== true)) fail("DSH_INVALID_EVENT");
  validateSurface(event);
  if (!KNOWN_EVENT_TYPES.has(event.type)) {
    if (event.ignorable !== true) fail("DSH_UNKNOWN_REQUIRED_EVENT");
    return;
  }
  if (VALIDATED_TYPES.has(event.type)) {
    validateSupportedEvent(event);
    return;
  }
  if (VALIDATED_KNOWN_UNSUPPORTED_TYPES.has(event.type)) {
    validateKnownUnsupportedEvent(event);
    return;
  }
  // A known event remains part of the pinned replay contract even if a producer marks it ignorable.
  fail("DSH_KNOWN_EVENT_UNVALIDATED");
}

function deepJsonEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => deepJsonEqual(value, right[index]));
  }
  if (!plain(left) || !plain(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && deepJsonEqual(left[key], right[key]));
}

function validateToolResultRewrite(event, shadowedSeqs, events) {
  if (event.type !== "tool/result") return;
  if (shadowedSeqs.length !== 1) fail("DSH_SURFACE_TOOL_REWRITE_INVALID");
  const original = events[shadowedSeqs[0]];
  if (original?.type !== "tool/result") fail("DSH_SURFACE_TOOL_REWRITE_INVALID");
  const originalRest = structuredClone(original.data);
  const replacementRest = structuredClone(event.data);
  originalRest.message.content[0].content = null;
  replacementRest.message.content[0].content = null;
  if (!deepJsonEqual(originalRest, replacementRest)) fail("DSH_SURFACE_TOOL_REWRITE_INVALID");
}

function applySurfaceEvent(event, nodes, events) {
  if (!new Set(["user/message", "assistant/message", "tool/result"]).has(event.type)) return;
  if (event.surfaceOp === "append") {
    nodes.push(event.seq);
    return;
  }
  const startIndex = nodes.indexOf(event.surfaceOp.start);
  const endIndex = nodes.indexOf(event.surfaceOp.end);
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) fail("DSH_SURFACE_RANGE_INVALID");
  const shadowedSeqs = nodes.slice(startIndex, endIndex + 1);
  const sources = new Set(event.sourceEventSeqs ?? []);
  if (shadowedSeqs.some((seq) => !sources.has(seq))) fail("DSH_SURFACE_PROVENANCE_INCOMPLETE");
  validateToolResultRewrite(event, shadowedSeqs, events);
  nodes.splice(startIndex, endIndex - startIndex + 1, event.seq);
}

function applyInboxSplice(data, queues) {
  const queue = queues[data.target];
  const removedCount = data.removedCount ?? 0;
  if (data.start > queue.length || data.start + removedCount > queue.length
    || (data.outcome === "canceled" && removedCount === 0)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  const candidate = queue.toSpliced(data.start, removedCount, ...structuredClone(data.inserted));
  const ids = [...(data.target === "next-turn" ? candidate : queues["next-turn"]),
    ...(data.target === "next-step" ? candidate : queues["next-step"])].map((message) => message.id);
  if (new Set(ids).size !== ids.length) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  queues[data.target] = candidate;
}

function applyScheduleChange(data, state) {
  if (data.operation === "create") {
    if (state.seen.has(data.schedule.id)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    state.seen.add(data.schedule.id);
    state.active.set(data.schedule.id, structuredClone(data.schedule));
    return;
  }
  const current = state.active.get(data.id);
  if (current === undefined) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  if (data.operation === "delete") {
    state.active.delete(data.id);
    return;
  }
  const hasAcceptedAt = Object.hasOwn(data, "acceptedAt");
  if ((current.kind === "every") !== hasAcceptedAt) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  if (current.kind !== "every") {
    state.active.delete(data.id);
    return;
  }
  const accepted = Date.parse(data.acceptedAt);
  const target = Date.parse(current.scheduledAt);
  if (accepted < target) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  const interval = current.everySeconds * 1_000;
  const occurrence = target + Math.floor((accepted - target) / interval) * interval;
  const next = occurrence + interval;
  const nextDate = new Date(next);
  if (!Number.isSafeInteger(next) || !Number.isFinite(nextDate.getTime()) || nextDate.getUTCFullYear() > 9999) {
    state.active.delete(data.id);
  } else state.active.set(data.id, { ...current, scheduledAt: nextDate.toISOString() });
}

function validateTitleReferences(data, eventSeq, directHumanSeqs) {
  if (data.messageSeqs.some((seq) => seq >= eventSeq || !directHumanSeqs.includes(seq))) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
  if ((data.source.kind === "user") !== (data.messageSeqs.length === 0)) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
  if (data.source.kind === "fallback"
    && (data.messageSeqs.length !== 1 || data.messageSeqs[0] !== directHumanSeqs[0])) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
}

function validateTitleRequestReferences(data, eventSeq, directHumanSeqs) {
  if (data.messageSeqs.some((seq) => seq >= eventSeq || !directHumanSeqs.includes(seq))) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
}

function renderGoalRoundContent(goal, round) {
  return [{
    type: "text",
    text: "<goal_round>\n"
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + "Continue working toward the objective in this same session. Treat the current workspace, "
      + "tool results, and durable session state as authoritative; inspect them instead of assuming "
      + "earlier narration is still current. Make concrete progress and verify the result. Before "
      + "claiming completion, gather evidence that the whole objective is achieved, read the current "
      + "goal, and mark it complete. If work remains, leave the goal active for the next round. Follow "
      + "the configured goal-tool policy before reporting a blocker.\n"
      + "</goal_round>",
  }];
}

function sameGoalDefinition(left, right) {
  return left.objective === right.objective && left.maxGoalRounds === right.maxGoalRounds;
}

function applyGoalFold(state, event) {
  if (event.type === "user/message" && event.data.source.kind === "goal") {
    const source = event.data.source;
    const goal = state.goal;
    if (goal === null || goal.phase !== "active" || source.goalId !== goal.id
      || source.revision !== goal.revision || source.round !== state.roundsStarted + 1
      || source.round > goal.maxGoalRounds
      || !deepJsonEqual(event.data.content, renderGoalRoundContent(goal, source.round))) {
      fail("DSH_EVENT_RELATIONSHIP_INVALID");
    }
    state.roundsStarted = source.round;
    return;
  }
  if (event.type !== "goal/change") return;
  const change = event.data;
  if (change.operation === "clear") {
    if (state.goal === null || change.cleared.id !== state.goal.id
      || change.cleared.revision !== state.goal.revision + 1
      || change.clearedAt < state.updatedAt) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    state.goal = null;
    state.roundsStarted = 0;
    state.createdAt = null;
    state.updatedAt = null;
    return;
  }
  const next = change.goal;
  if (change.operation === "create") {
    if (next.revision !== 1 || next.phase !== "active" || change.roundsStarted !== 0
      || (state.goal !== null && state.goal.phase !== "complete") || state.seenIds.has(next.id)) {
      fail("DSH_EVENT_RELATIONSHIP_INVALID");
    }
    state.seenIds.add(next.id);
  } else {
    const current = state.goal;
    if (current === null || next.id !== current.id || next.revision !== current.revision + 1
      || change.createdAt !== state.createdAt || change.updatedAt < state.updatedAt
      || change.roundsStarted !== state.roundsStarted) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    if (change.operation === "edit") {
      if (next.phase !== current.phase || !deepJsonEqual(next.blockedReason, current.blockedReason)) {
        fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
    } else {
      if (!sameGoalDefinition(current, next)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      if (change.operation === "pause" && !(current.phase === "active" && next.phase === "paused")) {
        fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
      if (change.operation === "resume" && (!new Set(["active", "paused", "blocked"]).has(current.phase)
        || next.phase !== "active" || state.roundsStarted >= next.maxGoalRounds)) {
        fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
      if (change.operation === "complete" && (current.phase === "complete" || next.phase !== "complete")) {
        fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
      if (change.operation === "block" && !(current.phase === "active" && next.phase === "blocked")) {
        fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
    }
  }
  state.goal = structuredClone(next);
  state.roundsStarted = change.roundsStarted;
  state.createdAt = change.createdAt;
  state.updatedAt = change.updatedAt;
}

function compactionReplacementMatches(event, shadow) {
  if (shadow.kind === "prune" && event.type !== "tool/result") return false;
  if (shadow.kind === "summary" && (event.type !== "user/message"
    || event.data.source.kind !== "plugin" || event.data.source.plugin !== "compact"
    || event.data.source.compactionId !== shadow.compactionId
    || event.data.source.sourceCommandId !== shadow.sourceCommandId)) return false;
  return ["user/message", "assistant/message", "tool/result"].includes(event.type)
    && plain(event.surfaceOp) && event.surfaceOp.op === "replace"
    && event.surfaceOp.start === shadow.range.start && event.surfaceOp.end === shadow.range.end
    && deepJsonEqual(event.sourceEventSeqs, shadow.sourceEventSeqs);
}

function applyCompactionFold(state, event, openTurn, durableSuffixStart) {
  if (state.pendingShadow !== null) {
    if (!compactionReplacementMatches(event, state.pendingShadow)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    state.pendingShadow = null;
  }
  if ((event.type === "turn/start" || event.type === "turn/end") && state.open !== null
    && !state.open.inherited) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  if (event.type === "session/end-seed") {
    state.open = null;
    return;
  }
  if (event.type === "user/message" && event.data.source.kind === "plugin"
    && event.data.source.plugin === "compact") {
    const source = event.data.source;
    if (state.open === null || source.compactionId !== state.open.id
      || source.sourceCommandId !== state.open.sourceCommandId) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
  if (event.type === "compaction/prune") {
    if (event.data.shadowedSeqs.length === 0
      || event.data.shadowedSeqs[0] !== event.data.shadowedRange.start
      || event.data.shadowedSeqs.at(-1) !== event.data.shadowedRange.end) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    state.pendingShadow = {
      kind: "prune",
      range: event.data.shadowedRange,
      sourceEventSeqs: event.data.shadowedSeqs,
    };
    return;
  }
  if (event.type === "compaction/start") {
    if (state.open !== null || (event.data.turn === null ? openTurn !== null : event.data.turn !== openTurn)) {
      fail("DSH_EVENT_RELATIONSHIP_INVALID");
    }
    state.open = { id: event.data.compactionId, sourceCommandId: event.data.sourceCommandId,
      startSeq: event.seq, turn: event.data.turn, summarized: false, inherited: event.seq < durableSuffixStart };
    return;
  }
  if (event.type !== "compaction/summary" && event.type !== "compaction/end") return;
  const open = state.open;
  if (open === null || event.data.compactionId !== open.id
    || event.data.sourceCommandId !== open.sourceCommandId
    || (open.turn === null ? openTurn !== null : open.turn !== openTurn)) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
  if (event.type === "compaction/summary") {
    if (open.summarized || event.data.shadowedSeqs.length === 0
      || event.data.shadowedSeqs[0] !== event.data.shadowedRange.start
      || event.data.shadowedSeqs.at(-1) !== event.data.shadowedRange.end) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    open.summarized = true;
    state.pendingShadow = {
      kind: "summary",
      compactionId: open.id,
      sourceCommandId: open.sourceCommandId,
      range: event.data.shadowedRange,
      sourceEventSeqs: [open.startSeq, event.seq, ...event.data.shadowedSeqs],
    };
    return;
  }
  if (event.data.turn !== open.turn || (!Object.hasOwn(event.data, "error") && !open.summarized)) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
  state.open = null;
}

function validateTeamTaskGraph(current, candidate) {
  const tasks = new Map(current);
  tasks.set(candidate.id, candidate);
  for (const task of tasks.values()) {
    if (task.status === "deleted") continue;
    const seen = new Set();
    for (const blockerId of task.blockedBy) {
      if (blockerId === task.id || seen.has(blockerId)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      const blocker = tasks.get(blockerId);
      if (blocker === undefined || blocker.status === "deleted") fail("DSH_EVENT_RELATIONSHIP_INVALID");
      seen.add(blockerId);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    if (visited.has(id)) return;
    const task = tasks.get(id);
    if (task === undefined || task.status === "deleted") return;
    visiting.add(id);
    for (const blockerId of task.blockedBy) visit(blockerId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks.values()) visit(task.id);
}

function applyTeamFold(state, event) {
  if (!["team/member", "team/task", "team/message/queued", "team/message/delivered"].includes(event.type)) {
    return;
  }
  const data = event.data;
  if (data.version !== 1) {
    if (data.teamId === state.id) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    return;
  }
  if (data.teamId !== state.id) return;
  if (event.type === "team/member") {
    const member = data.member;
    const prior = state.members.get(member.id);
    const named = state.memberIdsByName.get(member.name);
    if (named !== undefined && named !== member.id) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    if (prior === undefined) {
      if (member.phase !== "provisioning") fail("DSH_EVENT_RELATIONSHIP_INVALID");
      state.memberIdsByName.set(member.name, member.id);
    } else if (prior.name !== member.name || prior.provider !== member.provider || prior.context !== member.context
      || prior.phase !== "provisioning" || member.phase === "provisioning") {
      fail("DSH_EVENT_RELATIONSHIP_INVALID");
    }
    state.members.set(member.id, member);
    return;
  }
  if (event.type === "team/task") {
    const task = data.task;
    const prior = state.tasks.get(task.id);
    if ((prior === undefined && task.revision !== 1)
      || (prior !== undefined && task.revision !== prior.revision + 1)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    validateTeamTaskGraph(state.tasks, task);
    state.tasks.set(task.id, task);
    return;
  }
  if (event.type === "team/message/queued") {
    const message = data.message;
    if (state.messages.has(message.id)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    state.messages.set(message.id, message);
    return;
  }
  const message = state.messages.get(data.messageId);
  if (message === undefined || message.targetId !== data.targetId || state.delivered.has(data.messageId)) {
    fail("DSH_EVENT_RELATIONSHIP_INVALID");
  }
  state.delivered.add(data.messageId);
}

function validateSequence(events, header) {
  let nextTurn = 1;
  let nextStep = 1;
  let openTurn = null;
  let openStep = null;
  const pendingCalls = new Set();
  const surfaceNodes = [];
  const directHumanSeqs = [];
  const queues = { "next-turn": [], "next-step": [] };
  const schedules = { active: new Map(), seen: new Set() };
  const approvals = new Set();
  const commandIds = new Set();
  const hooks = new Map();
  const workflows = new Map();
  const dispatchRoots = new Map();
  const retryChains = new Map();
  const retryOwners = new Map();
  const retryScheduled = new Map();
  const retryStarted = new Set();
  const goal = { goal: null, roundsStarted: 0, createdAt: null, updatedAt: null, seenIds: new Set() };
  const team = {
    id: header.id,
    members: new Map(),
    memberIdsByName: new Map(),
    tasks: new Map(),
    messages: new Map(),
    delivered: new Set(),
  };
  const compaction = { open: null, pendingShadow: null };
  let latestRequestHeader = null;
  let ownDescriptorSeen = false;
  let liveBoundarySeen = false;
  let lifecycleRequestSeen = false;
  let lifecycleFirstTurn = null;
  const durableSuffixStart = header.seedLength ?? 0;
  for (const [index, event] of events.entries()) {
    if (plain(event) && ["todo/write", "request/header", "request/context"].includes(event.type)
      && openTurn === null) fail("DSH_EVENT_ORDER_INVALID");
    validateEventEnvelope(event, index);
    applyCompactionFold(compaction, event, openTurn, durableSuffixStart);
    applySurfaceEvent(event, surfaceNodes, events);
    const data = event.data;
    if (event.type === "agent/inbox/spliced" && index >= durableSuffixStart) applyInboxSplice(data, queues);
    if (event.type === "schedule/change" && index >= durableSuffixStart) applyScheduleChange(data, schedules);
    applyGoalFold(goal, event);
    applyTeamFold(team, event);
    if (event.type === "user/message" && data.source?.kind === "user"
      && textFromContent(data.content).trim().length > 0) directHumanSeqs.push(event.seq);
    if (event.type === "approval/asked") {
      if (openTurn === null || approvals.has(data.id)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      approvals.add(data.id);
    } else if (event.type === "approval/decided") {
      if (openTurn === null || !approvals.delete(data.id)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    }
    if (event.type === "command/run") {
      if (commandIds.has(data.commandId)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      commandIds.add(data.commandId);
    } else if (event.type === "command/done") {
      if (!commandIds.has(data.commandId)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      if (Object.hasOwn(data, "sourceEventSeq")) {
        const source = events[data.sourceEventSeq];
        if (data.sourceEventSeq >= event.seq || source?.seq !== data.sourceEventSeq
          || ["command/run", "command/done"].includes(source.type)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
    }
    if (event.type === "hook/invoked" || event.type === "hook/result") {
      if (openTurn !== data.turn) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      const key = `${data.turn}\0${data.point}\0${data.handlerId}`;
      const pending = hooks.get(key) ?? 0;
      if (event.type === "hook/invoked") hooks.set(key, pending + 1);
      else if (pending === 0) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      else if (pending === 1) hooks.delete(key);
      else hooks.set(key, pending - 1);
    }
    if (["tool-workflow/run-start", "tool-workflow/agent-start", "tool-workflow/agent-end",
      "tool-workflow/run-end"].includes(event.type)) {
      const run = workflows.get(data.runId);
      if (event.type === "tool-workflow/run-start") {
        if (run !== undefined) fail("DSH_EVENT_RELATIONSHIP_INVALID");
        workflows.set(data.runId, { ended: false, members: new Map() });
      } else {
        if (run === undefined || run.ended) fail("DSH_EVENT_RELATIONSHIP_INVALID");
        if (event.type === "tool-workflow/agent-start") {
          if (run.members.has(data.seq)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
          run.members.set(data.seq, false);
        } else if (event.type === "tool-workflow/agent-end") {
          if (run.members.get(data.seq) !== false) fail("DSH_EVENT_RELATIONSHIP_INVALID");
          run.members.set(data.seq, true);
        } else {
          if ([...run.members.values()].some((ended) => !ended)) fail("DSH_EVENT_RELATIONSHIP_INVALID");
          run.ended = true;
          run.members.clear();
        }
      }
    }
    if (event.type === "tool/code-dispatch-start" || event.type === "tool/code-dispatch") {
      if (openTurn === null) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      const knownRoot = dispatchRoots.get(data.subCallId);
      if (knownRoot !== undefined && knownRoot !== data.rootCallId) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      if (data.parentCallId !== data.rootCallId
        && dispatchRoots.get(data.parentCallId) !== data.rootCallId) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      dispatchRoots.set(data.subCallId, data.rootCallId);
    }
    if (event.type === "request/header") {
      if (!lifecycleRequestSeen) {
        const expectedReason = latestRequestHeader === null ? "initial" : "resume";
        if (data.reason !== expectedReason) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      } else {
        if (data.reason !== "change" || deepJsonEqual(data.header, latestRequestHeader)) {
          fail("DSH_EVENT_RELATIONSHIP_INVALID");
        }
      }
      latestRequestHeader = structuredClone(data.header);
      lifecycleRequestSeen = true;
    }
    if (event.type === "request/context") {
      if (latestRequestHeader === null || data.provider !== latestRequestHeader.config.provider
        || data.model !== latestRequestHeader.config.model) fail("DSH_EVENT_RELATIONSHIP_INVALID");
    }
    if (event.type === "session/title") validateTitleReferences(data, event.seq, directHumanSeqs);
    if (event.type === "session/title-llm-request") {
      validateTitleRequestReferences(data, event.seq, directHumanSeqs);
    }
    if (event.type === "subagent/descriptor") {
      if (index >= durableSuffixStart) {
        if (ownDescriptorSeen || lifecycleRequestSeen) fail("DSH_EVENT_RELATIONSHIP_INVALID");
        if (data.mode === "one-shot") {
          if (openTurn === null || openTurn !== lifecycleFirstTurn || openStep !== null) {
            fail("DSH_EVENT_RELATIONSHIP_INVALID");
          }
        } else if (openTurn !== null
          || !(liveBoundarySeen || (header.seedLength === undefined && index === 0))) {
          fail("DSH_EVENT_RELATIONSHIP_INVALID");
        }
        ownDescriptorSeen = true;
      }
    }
    if (event.type === "session/end-seed") {
      lifecycleRequestSeen = false;
      lifecycleFirstTurn = openTurn;
      if (index >= durableSuffixStart) liveBoundarySeen = true;
    }
    if (event.type === "llm/retry") {
      if (openTurn !== data.turn || openStep !== data.step
        || latestRequestHeader?.config?.provider !== data.provider) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      const chainKey = `${data.turn}\0${data.step}\0${data.provider}\0${data.policyKey}`;
      const prior = retryChains.get(chainKey);
      if (data.retry !== (prior?.retry ?? 0) + 1 || (prior && prior.retryId !== data.retryId)) {
        fail("DSH_EVENT_RELATIONSHIP_INVALID");
      }
      const owner = retryOwners.get(data.retryId);
      if (owner !== undefined && owner !== chainKey) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      retryOwners.set(data.retryId, chainKey);
      retryChains.set(chainKey, { retry: data.retry, retryId: data.retryId });
      retryScheduled.set(`${data.retryId}\0${data.retry}`, { turn: data.turn, step: data.step });
    } else if (event.type === "llm/retry-started") {
      const key = `${data.retryId}\0${data.retry}`;
      const scheduled = retryScheduled.get(key);
      if (scheduled === undefined || retryStarted.has(key) || scheduled.turn !== data.turn
        || scheduled.step !== data.step) fail("DSH_EVENT_RELATIONSHIP_INVALID");
      retryStarted.add(key);
    }
    if (event.type === "turn/start") {
      if (openTurn !== null || data.turn !== nextTurn) fail("DSH_EVENT_ORDER_INVALID");
      openTurn = data.turn;
      if (lifecycleFirstTurn === null) lifecycleFirstTurn = data.turn;
      nextStep = 1;
    } else if (event.type === "step/start") {
      if (openTurn !== data.turn || openStep !== null || data.step !== nextStep) fail("DSH_EVENT_ORDER_INVALID");
      openStep = data.step;
    } else if (["assistant/message", "assistant/chunk", "tool/call"].includes(event.type)) {
      if (openTurn !== data.turn || openStep !== data.step) fail("DSH_EVENT_ORDER_INVALID");
      if (event.type === "tool/call") pendingCalls.add(data.callId);
    } else if (event.type === "tool/result") {
      const callId = data.message?.source?.callId;
      if (event.surfaceOp === "append") {
        if (typeof callId !== "string" || openTurn !== data.turn || openStep !== data.step) fail("DSH_EVENT_ORDER_INVALID");
        const syntheticNotStarted = data.message.content[0].isError === true && data.error?.code === "TOOL_NOT_STARTED";
        if (!pendingCalls.delete(callId) && !syntheticNotStarted) fail("DSH_EVENT_ORDER_INVALID");
      } else if (openTurn === null) fail("DSH_EVENT_ORDER_INVALID");
    } else if (event.type === "step/end") {
      if (openTurn !== data.turn || openStep !== data.step) fail("DSH_EVENT_ORDER_INVALID");
      pendingCalls.clear();
      openStep = null;
      nextStep += 1;
    } else if (event.type === "turn/end") {
      if (openTurn !== data.turn || openStep !== null || pendingCalls.size > 0) fail("DSH_EVENT_ORDER_INVALID");
      openTurn = null;
      nextTurn += 1;
    }
  }
  if (compaction.pendingShadow !== null) fail("DSH_EVENT_RELATIONSHIP_INVALID");
  const pendingInboxMessageCount = queues["next-turn"].length + queues["next-step"].length;
  if (openTurn === null && (openStep !== null || pendingCalls.size > 0)) fail("DSH_EVENT_ORDER_INVALID");
  if (openTurn === null && pendingInboxMessageCount === 0) {
    return { incomplete: false, incompleteReason: null, pendingToolCallCount: 0, pendingInboxMessageCount: 0 };
  }
  return {
    incomplete: true,
    incompleteReason: pendingCalls.size > 0 ? "pending-tool-result"
      : openStep !== null ? "open-step" : openTurn !== null ? "open-turn" : "pending-inbox",
    pendingToolCallCount: pendingCalls.size,
    pendingInboxMessageCount,
  };
}

function decodeDshUtf8Line(input) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    fail("DSH_INVALID_UTF8");
  }
}

function parseDshJsonlLine(input) {
  const line = decodeDshUtf8Line(input);
  if (line.length === 0) fail("DSH_BLANK_JSONL_LINE");
  try {
    const record = JSON.parse(line);
    if (!plain(record)) fail("DSH_MALFORMED_JSONL");
    return record;
  } catch {
    fail("DSH_MALFORMED_JSONL");
  }
}

function expandDshStorageRecord(record) {
  const expanded = packedRow(record);
  if (expanded) return expanded;
  if (typeof record.type === "string" && record.type.endsWith("-chunks")) fail("DSH_UNSUPPORTED_PACKED_ROW");
  return [record];
}

function scanDshJsonlPrefix(input, { requireComplete = false } = {}) {
  const buffer = Buffer.from(input);
  if (buffer.length === 0) fail("DSH_EMPTY_ARTIFACT");
  const headerEnd = buffer.indexOf(0x0A);
  if (headerEnd === -1) fail("DSH_INCOMPLETE_JSONL_LINE");
  const header = validateHeader(parseDshJsonlLine(buffer.subarray(0, headerEnd)));
  const events = [];
  let committedBytes = headerEnd + 1;
  let issue = null;
  let lineStart = committedBytes;
  for (let newline = buffer.indexOf(0x0A, lineStart); newline !== -1;
    newline = buffer.indexOf(0x0A, lineStart)) {
    let expanded;
    try {
      expanded = expandDshStorageRecord(parseDshJsonlLine(buffer.subarray(lineStart, newline)));
    } catch (error) {
      issue ??= error;
      lineStart = newline + 1;
      continue;
    }
    if (issue !== null) {
      if (expanded.some((event) => event?.type === "turn/end")) throw issue;
      lineStart = newline + 1;
      continue;
    }
    const rowStart = events.length;
    for (const event of expanded) {
      if (event?.seq !== events.length) {
        events.length = rowStart;
        issue = Object.assign(new Error("DSH_INVALID_EVENT"), { code: "DSH_INVALID_EVENT" });
        break;
      }
      events.push(event);
    }
    if (issue !== null && expanded.some((event) => event?.type === "turn/end")) throw issue;
    if (issue === null) committedBytes = newline + 1;
    lineStart = newline + 1;
  }
  const crashTail = issue !== null || committedBytes < buffer.length;
  if (requireComplete && crashTail) throw issue ?? Object.assign(
    new Error("DSH_INCOMPLETE_JSONL_LINE"), { code: "DSH_INCOMPLETE_JSONL_LINE" },
  );
  return { header, events, crashTail };
}

export function decodeDshJsonl(input, options = {}) {
  const { header, events, crashTail } = scanDshJsonlPrefix(input, options);
  const sequence = validateSequence(events, header);
  const incomplete = sequence.incomplete || crashTail;
  const incompleteReason = sequence.incompleteReason ?? (crashTail ? "crash-tail" : null);
  const knownUnsupportedTypes = [...new Set(events.filter((event) => KNOWN_EVENT_TYPES.has(event.type)
    && !NORMALIZATION_ALLOWLIST.has(event.type) && !CONTROL_TYPES.has(event.type)).map((event) => event.type))].sort();
  const unknownIgnorableTypes = [...new Set(events.filter((event) => !KNOWN_EVENT_TYPES.has(event.type)
    && event.ignorable === true).map((event) => unknownEventTypeToken(event.type)))].sort().slice(0, 16);
  return {
    header,
    events,
    incomplete,
    diagnostics: {
      knownUnsupportedCount: events.filter((event) => KNOWN_EVENT_TYPES.has(event.type)
        && !NORMALIZATION_ALLOWLIST.has(event.type) && !CONTROL_TYPES.has(event.type)).length,
      knownUnsupportedTypes,
      unknownIgnorableCount: events.filter((event) => !KNOWN_EVENT_TYPES.has(event.type)
        && event.ignorable === true).length,
      unknownIgnorableTypes,
      ...(incomplete ? { incompleteReason } : {}),
      ...(sequence.pendingToolCallCount > 0 ? { pendingToolCallCount: sequence.pendingToolCallCount } : {}),
      ...(sequence.pendingInboxMessageCount > 0 ? { pendingInboxMessageCount: sequence.pendingInboxMessageCount } : {}),
    },
  };
}

export function decodeDshArtifact(input, { compressed = false, decompressor = zlib.zstdDecompressSync } = {}) {
  if (!compressed) return decodeDshJsonl(Buffer.from(input));
  const decoded = decodeDshZstdArtifact(input, { decompressor });
  const result = decodeDshJsonl(decoded.bytes, { requireComplete: true });
  if (!decoded.torn) return result;
  return {
    ...result,
    incomplete: true,
    diagnostics: {
      ...result.diagnostics,
      incompleteReason: result.diagnostics.incompleteReason ?? "crash-tail",
    },
  };
}

function pathMatchesWorkspace(cwd, workspace) {
  const leftFlavor = absoluteFlavor(cwd);
  const rightFlavor = absoluteFlavor(workspace);
  if (!leftFlavor || leftFlavor !== rightFlavor) return false;
  const api = leftFlavor === "win32" ? path.win32 : path.posix;
  const left = api.normalize(cwd);
  const right = api.normalize(workspace);
  const comparableLeft = leftFlavor === "win32" ? left.toLowerCase() : left;
  const comparableRight = leftFlavor === "win32" ? right.toLowerCase() : right;
  const relative = api.relative(comparableRight, comparableLeft);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative));
}

function diagnostic(code, details = {}) {
  return { code, ...details };
}

function unknownEventTypeToken(type) {
  return `unknown:${createHash("sha256").update(type).digest("hex").slice(0, 12)}`;
}

function privacySafeProvenance(value) {
  if (value === "") return "";
  return sanitizePrivateReviewText(value, { limit: 160 }) ?? "<redacted>";
}

function dshProvenance(header) {
  return {
    delegationDepth: header.delegationDepth,
    ...(Object.hasOwn(header, "parentSession") ? { parentSession: privacySafeProvenance(header.parentSession) } : {}),
    ...(Object.hasOwn(header, "seedLength") ? { seedLength: header.seedLength } : {}),
    ...(Object.hasOwn(header, "origin") ? { origin: header.origin } : {}),
    ...(Object.hasOwn(header, "agentPreset") ? { agentPreset: privacySafeProvenance(header.agentPreset) } : {}),
  };
}

function validatedNormalizationSourceRef(sourceRef) {
  if (!plain(sourceRef)
    || sourceRef.kind !== "dsh-session-jsonl"
    || typeof sourceRef.sessionId !== "string" || sourceRef.sessionId.length === 0
    || typeof sourceRef.path !== "string" || sourceRef.path.length === 0 || sourceRef.path.includes("\0")
    || !absoluteFlavor(sourceRef.cwd)
    || !plain(sourceRef.dshProvenance)
    || !safeNonnegative(sourceRef.dshProvenance.delegationDepth)) {
    fail("DSH_NORMALIZATION_UNAVAILABLE", "DSH normalization requires validated session evidence");
  }
  const provenance = sourceRef.dshProvenance;
  if ((Object.hasOwn(provenance, "parentSession") && typeof provenance.parentSession !== "string")
    || (Object.hasOwn(provenance, "seedLength") && !safeNonnegative(provenance.seedLength))
    || (Object.hasOwn(provenance, "origin") && provenance.origin !== "subagent")
    || (Object.hasOwn(provenance, "agentPreset") && typeof provenance.agentPreset !== "string")) {
    fail("DSH_NORMALIZATION_UNAVAILABLE", "DSH normalization requires validated session evidence");
  }
  return {
    kind: "dsh-session-jsonl",
    role: "session-transcript",
    path: sourceRef.path,
    sessionId: sourceRef.sessionId,
    cwd: sourceRef.cwd,
    dshProvenance: {
      delegationDepth: provenance.delegationDepth,
      ...(Object.hasOwn(provenance, "parentSession")
        ? { parentSession: privacySafeProvenance(provenance.parentSession) } : {}),
      ...(Object.hasOwn(provenance, "seedLength") ? { seedLength: provenance.seedLength } : {}),
      ...(Object.hasOwn(provenance, "origin") ? { origin: provenance.origin } : {}),
      ...(Object.hasOwn(provenance, "agentPreset")
        ? { agentPreset: privacySafeProvenance(provenance.agentPreset) } : {}),
    },
  };
}

export function dedupeDshArtifactCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates) {
    const identity = process.platform === "win32" ? candidate.canonicalPath.toLowerCase() : candidate.canonicalPath;
    if (!unique.has(identity)) unique.set(identity, candidate);
  }
  return [...unique.values()];
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function isDirectoryEntry(entry) {
  return entry.isDirectory();
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".."
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sourceRef(candidate) {
  return { kind: "dsh-session-jsonl", role: "session-transcript", path: candidate.path,
    encoding: candidate.compressed ? "zstd" : "jsonl" };
}

export async function readDshSessionArtifact(candidate, options = {}) {
  const before = await stat(candidate.path);
  const bytes = await readFile(candidate.path);
  const decoded = decodeDshArtifact(bytes, { compressed: candidate.compressed, decompressor: options.decompressor });
  const after = await stat(candidate.path);
  const unchanged = before.size === after.size && before.mtimeMs === after.mtimeMs;
  if (!unchanged) fail("DSH_ARTIFACT_CHANGED_DURING_READ");
  return { ...decoded, bytesRead: bytes.length, unchanged };
}

function textFromContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function normalizedEvidenceRef(sourceRef, event, type) {
  return {
    kind: sourceRef.kind,
    path: sourceRef.path,
    seq: event.seq,
    type,
  };
}

function normalizedBase(event, sourceRef) {
  const provenance = sourceRef.dshProvenance;
  return {
    sessionId: sourceRef.sessionId,
    timestamp: normalizeDshEpochMillis(event.time),
    sourceKind: sourceRef.kind,
    planningScope: "workspace",
    cwd: sourceRef.cwd,
    nativeType: event.type,
    nativeSeq: event.seq,
    ...(Object.hasOwn(event.data, "turn") ? { turn: event.data.turn } : {}),
    ...(Object.hasOwn(event.data, "step") ? { step: event.data.step } : {}),
    isSubagent: provenance?.origin === "subagent",
    dshProvenance: provenance,
  };
}

function includeGate(options, camel, dashed) {
  const value = options[camel] ?? options[dashed];
  return value === undefined ? false : parseBooleanFlag(value);
}

function boundedPrivateText(value, limit) {
  return sanitizePrivateReviewText(value, { limit });
}

function safeLabel(value, fallback = null) {
  const result = boundedPrivateText(value, 160);
  return result || fallback;
}

function parsedToolArguments(value) {
  if (typeof value !== "string" || value.length > 64_000) return null;
  try {
    const parsed = JSON.parse(value);
    return plain(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function selectedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || value.includes("\0")) return null;
  const flavor = absoluteFlavor(value);
  const basename = flavor === "win32" ? path.win32.basename(value)
    : flavor === "posix" ? path.posix.basename(value) : null;
  const basenameLabel = basename ? sanitizePrivateReviewText(basename, { limit: 224 }) : null;
  const sanitized = flavor
    ? `<path>${basenameLabel && basenameLabel !== "<path>" ? `/${basenameLabel}` : ""}`
    : sanitizePrivateReviewText(value, { limit: 239 });
  if (!sanitized || ["<path>", "<redacted>"].includes(sanitized)) return null;
  return [...sanitized].slice(0, 240).join("");
}

function selectedPaths(parsed) {
  const values = [parsed.paths, parsed.targetPaths, parsed.affectedPaths]
    .filter(Array.isArray)
    .flat();
  const seen = new Set();
  const selected = [];
  for (const value of values) {
    const projected = selectedPath(value);
    if (!projected || seen.has(projected)) continue;
    seen.add(projected);
    selected.push(projected);
    if (selected.length === 8) break;
  }
  return selected;
}

function toolArgumentFacts(toolName, argumentsText, options) {
  const parsed = parsedToolArguments(argumentsText);
  if (!parsed) return {};
  const facts = {};
  if (/(?:read|edit|write|file|notebook|view|patch|create)/iu.test(toolName)) {
    const filePath = selectedPath(parsed.file_path ?? parsed.filePath ?? parsed.path);
    if (filePath) facts.filePath = filePath;
    const targetPaths = selectedPaths(parsed);
    if (targetPaths.length > 0) facts.targetPaths = targetPaths;
  }
  if (includeGate(options, "includeCommandText", "include-command-text")
    && /(?:bash|shell|exec|terminal|run|powershell|command)/iu.test(toolName)) {
    const command = parsed.command ?? parsed.cmd;
    const commandText = typeof command === "string" ? boundedPrivateText(command, 4_096) : null;
    if (commandText) facts.commandText = commandText;
  }
  return facts;
}

function normalizedUsage(usage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(Object.hasOwn(usage, "cacheReadTokens") ? { cacheReadInputTokens: usage.cacheReadTokens } : {}),
    ...(Object.hasOwn(usage, "cacheWriteTokens") ? { cacheCreationInputTokens: usage.cacheWriteTokens } : {}),
    ...(Object.hasOwn(usage, "reasoningTokens") ? { reasoningTokens: usage.reasoningTokens } : {}),
  };
}

function normalizeTurnEnd(event, sourceRef) {
  const reason = event.data.reason;
  const common = {
    ...normalizedBase(event, sourceRef),
    type: "turn.end",
    category: "lifecycle",
    lifecyclePhase: "result",
    outcome: reason.kind,
    evidenceRef: normalizedEvidenceRef(sourceRef, event, "turn.end"),
    summary: `turn ended: ${reason.kind}`,
  };
  switch (reason.kind) {
    case "completed": return { ...common, success: true, hasError: false };
    case "aborted": return { ...common, success: false, cancelled: true, hasError: false,
      cancelCause: reason.reason.kind };
    case "blocked": return { ...common, success: false, blocked: true, hasError: false };
    case "error": return { ...common, success: false, hasError: true,
      errorCode: safeLabel(reason.error.code, "UNKNOWN") };
    case "max-tokens": return { ...common, success: false, maxTokensReached: true, hasError: false };
    case "interrupted": return { ...common, success: null, incomplete: true, hasError: false };
    default: fail("DSH_EVENT_SHAPE_DRIFT");
  }
}

function normalizeDshEvents(event, sourceRef, options = {}) {
  const base = normalizedBase(event, sourceRef);
  if (event.type === "turn/start") {
    return [{ ...base, type: "turn.start", category: "lifecycle", lifecyclePhase: "request",
      evidenceRef: normalizedEvidenceRef(sourceRef, event, "turn.start"), summary: "turn started" }];
  }
  if (event.type === "turn/end") return [normalizeTurnEnd(event, sourceRef)];
  if (event.type === "user/message") {
    const direct = event.data.source.kind === "user";
    const rawText = textFromContent(event.data.content);
    const safeText = direct
      ? privacySafeUserInputText(rawText, { limit: 8_000 })
      : boundedPrivateText(rawText, 8_000);
    const normalized = {
      ...base,
      type: direct ? "user" : "context",
      category: direct ? "user" : "context",
      userPrompt: direct && rawText.length > 0,
      ...(direct ? { userSourceKind: "human" } : { contextSourceKind: event.data.source.kind }),
      ...(event.data.source.kind === "plugin"
        ? { contextForm: event.data.source.form ?? "opaque" }
        : {}),
      contentLength: rawText.length,
      evidenceRef: normalizedEvidenceRef(sourceRef, event, direct ? "user" : "message"),
      summary: direct ? "direct user message" : "injected user-role context",
    };
    if (direct && includeGate(options, "includeUserText", "include-user-text") && safeText) {
      normalized.userText = safeText;
    }
    if (includeGate(options, "includeContent", "include-content") && safeText) normalized.content = safeText;
    return [normalized];
  }
  if (event.type === "assistant/message") {
    const rawText = textFromContent(event.data.message.content);
    const safeText = boundedPrivateText(rawText, 8_000);
    const model = safeLabel(event.data.message.source.model);
    const provider = safeLabel(event.data.message.source.provider);
    const interrupted = event.data.interrupted === true;
    const assistant = {
      ...base,
      type: "assistant",
      category: "assistant",
      model,
      modelProvider: provider,
      ...(interrupted ? { interrupted: true, incomplete: true } : {}),
      contentLength: rawText.length,
      userVisibleAssistantMessage: rawText.length > 0,
      evidenceRef: normalizedEvidenceRef(sourceRef, event, "assistant"),
      summary: interrupted ? "interrupted assembled assistant message" : "assembled assistant message",
    };
    if (includeGate(options, "includeContent", "include-content") && safeText) assistant.content = safeText;
    const events = [assistant];
    if (event.data.usage) {
      events.push({
        ...base,
        type: "model.response.completed",
        category: "model",
        model,
        modelProvider: provider,
        modelUsage: normalizedUsage(event.data.usage),
        usageFieldsObserved: true,
        ...(interrupted ? { interrupted: true, incomplete: true } : {}),
        evidenceRef: normalizedEvidenceRef(sourceRef, event, "model.response.completed"),
        summary: interrupted
          ? "DeepSeek Harness interrupted model response usage"
          : "DeepSeek Harness model response completed",
      });
    }
    return events;
  }
  if (event.type === "tool/call") {
    const toolName = safeLabel(event.data.name, "unknown-tool");
    return [{
      ...base,
      type: "tool.call",
      category: "tool",
      lifecyclePhase: "request",
      toolInvocationId: event.data.callId,
      toolName,
      functionCallName: toolName,
      ...toolArgumentFacts(toolName, event.data.arguments, options),
      evidenceRef: normalizedEvidenceRef(sourceRef, event, "tool.call"),
      summary: `${toolName} request`,
    }];
  }
  if (event.type === "tool/result") {
    const block = event.data.message.content[0];
    const rawText = textFromContent(block.content);
    const safeText = boundedPrivateText(rawText, 8_000);
    const outcomeObserved = Object.hasOwn(block, "isError");
    const success = block.isError === false;
    const normalized = {
      ...base,
      type: "tool.result",
      category: "tool",
      lifecyclePhase: "result",
      toolInvocationId: event.data.message.source.callId,
      ...(outcomeObserved ? { success, hasError: !success } : {}),
      ...(event.data.error ? { internalError: true, internalErrorName: safeLabel(event.data.error.name),
        internalErrorCode: safeLabel(event.data.error.code) } : outcomeObserved ? { internalError: false } : {}),
      evidenceRef: normalizedEvidenceRef(sourceRef, event, "tool.result"),
      summary: block.isError === true ? "tool result failed" : "tool result",
    };
    if (includeGate(options, "includeContent", "include-content") && safeText) normalized.content = safeText;
    return [normalized];
  }
  return [];
}

function finalDshSurfaceSeqs(events) {
  const nodes = [];
  for (const event of events) {
    if (!["user/message", "assistant/message", "tool/result"].includes(event.type)) continue;
    if (event.surfaceOp === "append") {
      nodes.push(event.seq);
      continue;
    }
    const start = nodes.indexOf(event.surfaceOp.start);
    const end = nodes.indexOf(event.surfaceOp.end);
    nodes.splice(start, end - start + 1, event.seq);
  }
  return new Set(nodes);
}

function normalizedEventOrdinal(event) {
  return event.type === "model.response.completed" ? 1 : 0;
}

export class DshSessionAnalyzer extends SessionAnalyzer {
  constructor({ decompressor = zlib.zstdDecompressSync } = {}) {
    super();
    this.decompressor = decompressor;
    this.analysisWarnings = [];
  }

  async resolveScope(options = {}) {
    const direct = explicitHome(options);
    const envValue = options.env?.DSH_HOME ?? process.env.DSH_HOME;
    const inherited = typeof envValue === "string" && envValue.trim().length === 0 ? undefined : envValue;
    const home = expandExplicitHome(direct !== undefined ? direct : inherited !== undefined ? inherited : path.join(os.homedir(), ".dsh"));
    const workspace = options.workspace ?? process.cwd();
    if (!absoluteFlavor(workspace)) fail("DSH_INVALID_WORKSPACE", "workspace must be an absolute path");
    const since = normalizeCliDate(options.since);
    const until = normalizeCliDate(options.until, true);
    return {
      platform: "dsh", workspace, dshHome: home, sessionRoot: path.join(home, "sessions"),
      sessionId: options.sessionId ?? options["session-id"] ?? null,
      since: since.label, sinceTime: since.time, until: until.label, untilTime: until.time,
      _workspaceMatchScope: workspaceMatchScopeFromOptions(options),
    };
  }

  async discoverSourceRoots(scope) {
    let exists = false;
    try { exists = (await stat(scope.sessionRoot)).isDirectory(); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return [{ id: "dsh-sessions", kind: "dsh-session-jsonl", role: "session-transcript",
      path: scope.sessionRoot, exists, enabled: true, optional: false, workspaceScoped: false, coverage: "partial" }];
  }

  async discoverSessions(scope, roots) {
    this.analysisWarnings = [];
    const root = roots[0];
    if (!root?.exists) {
      if (root) root.warnings = [];
      return [];
    }
    let canonicalRoot;
    try { canonicalRoot = await realpath(root.path); } catch (error) {
      if (error?.code === "ENOENT") {
        root.warnings = [];
        return [];
      }
      throw error;
    }
    const candidates = [];
    for (const projectEntry of await directoryEntries(root.path)) {
      const projectPath = path.join(root.path, projectEntry.name);
      if (!isDirectoryEntry(projectEntry)) {
        if (projectEntry.name.startsWith("session.jsonl")) this.analysisWarnings.push(diagnostic("dsh-flat-artifact-rejected"));
        continue;
      }
      for (const sessionEntry of await directoryEntries(projectPath)) {
        const sessionPath = path.join(projectPath, sessionEntry.name);
        if (!isDirectoryEntry(sessionEntry)) {
          if (sessionEntry.name.startsWith("session.jsonl")) this.analysisWarnings.push(diagnostic("dsh-flat-artifact-rejected"));
          continue;
        }
        const entries = await directoryEntries(sessionPath);
        const artifacts = entries.filter((entry) => entry.isFile()
          && ["session.jsonl", "session.jsonl.zstd"].includes(entry.name));
        const nestedArtifacts = [];
        for (const entry of entries) {
          const childPath = path.join(sessionPath, entry.name);
          if (isDirectoryEntry(entry)) {
            nestedArtifacts.push(...(await directoryEntries(childPath)).filter((child) => child.name.startsWith("session.jsonl")));
          }
        }
        if (nestedArtifacts.length > 0) this.analysisWarnings.push(diagnostic("dsh-wrong-depth-rejected"));
        if (artifacts.length !== 1) {
          if (artifacts.length > 1) this.analysisWarnings.push(diagnostic("dsh-ambiguous-artifact-rejected"));
          continue;
        }
        const artifact = artifacts[0];
        const artifactPath = path.join(sessionPath, artifact.name);
        let canonicalPath;
        try { canonicalPath = await realpath(artifactPath); } catch { continue; }
        if (!isContainedPath(canonicalRoot, canonicalPath)) continue;
        candidates.push({ path: artifactPath, canonicalPath, projectSegment: projectEntry.name,
          sessionSegment: sessionEntry.name, compressed: artifact.name.endsWith(".zstd") });
      }
    }

    const decoded = [];
    for (const candidate of dedupeDshArtifactCandidates(candidates)) {
      try {
        const artifact = await readDshSessionArtifact(candidate, { decompressor: this.decompressor });
        if (candidate.sessionSegment !== encodeDshSessionId(artifact.header.id)) fail("DSH_SESSION_ID_PATH_MISMATCH");
        if (candidate.projectSegment !== dshProjectKey(artifact.header.cwd)) fail("DSH_PROJECT_KEY_MISMATCH");
        decoded.push({ candidate, artifact });
      } catch (error) {
        const code = error?.code === "DSH_ZSTD_UNAVAILABLE" ? "dsh-zstd-unavailable" : "dsh-artifact-rejected";
        this.analysisWarnings.push(diagnostic(code, { reason: error?.code ?? "DSH_READ_FAILED" }));
      }
    }

    const byId = new Map();
    for (const item of decoded) {
      const list = byId.get(item.artifact.header.id) ?? [];
      list.push(item);
      byId.set(item.artifact.header.id, list);
    }
    const sessions = [];
    for (const [sessionId, items] of byId) {
      if (items.length !== 1) {
        this.analysisWarnings.push(diagnostic("dsh-session-identity-conflict", { artifactCount: items.length }));
        continue;
      }
      const { candidate, artifact } = items[0];
      const header = artifact.header;
      const workspaceMatch = scope._workspaceMatchScope
        ? classifyWorkspaceCwd(header.cwd, scope._workspaceMatchScope)
        : pathMatchesWorkspace(header.cwd, scope.workspace) ? WORKSPACE_CWD_MATCH.DIRECT : WORKSPACE_CWD_MATCH.UNMATCHED;
      if (workspaceMatch !== WORKSPACE_CWD_MATCH.DIRECT) {
        this.analysisWarnings.push(diagnostic("dsh-foreign-workspace-rejected"));
        continue;
      }
      const times = artifact.events.map((event) => event.time);
      const first = times.length > 0 ? Math.min(header.createdAt, ...times) : header.createdAt;
      const last = times.length > 0 ? Math.max(header.createdAt, ...times) : header.createdAt;
      const session = {
        platform: "dsh", sessionId, cwd: header.cwd, workspaceMatch,
        firstSeen: normalizeDshEpochMillis(first), lastSeen: normalizeDshEpochMillis(last),
        sourceKinds: ["dsh-session-jsonl"], sourceRefs: [sourceRef(candidate)],
        incomplete: artifact.incomplete,
        diagnostics: artifact.diagnostics,
        dshProvenance: dshProvenance(header),
      };
      if (artifact.incomplete) this.analysisWarnings.push(diagnostic("dsh-incomplete-session", {
        reason: artifact.diagnostics.incompleteReason,
      }));
      sessions.push(bindSessionWorkspaceCwds(session, [header.cwd]));
    }
    root.warnings = [...this.analysisWarnings];
    return sessions.sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen)
      || left.sessionId.localeCompare(right.sessionId));
  }

  async analyze(options = {}) {
    return runProviderAnalysis(this, options, { platform: "dsh", adapterVersion: DSH_ADAPTER_VERSION });
  }

  currentSessionId() { return null; }

  normalizeEvent(raw, sourceRef, options = {}) {
    return this.normalizeEvents(raw, sourceRef, options)[0] ?? null;
  }

  normalizeEvents(raw, sourceRef, options = {}) {
    if (!plain(raw) || !KNOWN_EVENT_TYPES.has(raw.type)) {
      fail("DSH_NORMALIZATION_UNAVAILABLE", "DSH normalization requires validated session evidence");
    }
    validateEventEnvelope(raw, raw.seq);
    if (!NORMALIZATION_ALLOWLIST.has(raw.type)) return [];
    validateSupportedEvent(raw);
    return normalizeDshEvents(raw, validatedNormalizationSourceRef(sourceRef), options);
  }

  async readSession(session, scope, options = {}) {
    if (!session || !scope) fail("DSH_NORMALIZATION_UNAVAILABLE", "DSH normalization requires a discovered session");
    const normalized = [];
    for (const ref of session.sourceRefs ?? []) {
      if (ref.kind !== "dsh-session-jsonl" || !["jsonl", "zstd"].includes(ref.encoding)) continue;
      const candidate = {
        path: ref.path,
        compressed: ref.encoding === "zstd",
      };
      const artifact = await readDshSessionArtifact(candidate, { decompressor: this.decompressor });
      const sessionSegment = path.basename(path.dirname(ref.path));
      const projectSegment = path.basename(path.dirname(path.dirname(ref.path)));
      if (artifact.header.id !== session.sessionId
        || artifact.header.cwd !== session.cwd
        || sessionSegment !== encodeDshSessionId(artifact.header.id)
        || projectSegment !== dshProjectKey(artifact.header.cwd)
        || JSON.stringify(dshProvenance(artifact.header)) !== JSON.stringify(session.dshProvenance)) {
        fail("DSH_ARTIFACT_IDENTITY_DRIFT");
      }
      const finalSurfaceSeqs = finalDshSurfaceSeqs(artifact.events);
      const firstOwnedSeq = artifact.header.seedLength ?? 0;
      const normalizedSourceRef = {
        ...ref,
        sessionId: session.sessionId,
        cwd: artifact.header.cwd,
        dshProvenance: dshProvenance(artifact.header),
      };
      for (const event of artifact.events) {
        if (event.seq < firstOwnedSeq) continue;
        if (!withinTimeRange(normalizeDshEpochMillis(event.time), scope)) continue;
        if (!NORMALIZATION_ALLOWLIST.has(event.type)) continue;
        if (["user/message", "assistant/message", "tool/result"].includes(event.type)
          && !finalSurfaceSeqs.has(event.seq)) continue;
        normalized.push(...this.normalizeEvents(event, normalizedSourceRef, options));
      }
    }
    const seen = new Set();
    const events = normalized.filter((event) => {
      const key = `${event.sessionId}:${event.nativeSeq}:${event.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) =>
      left.nativeSeq - right.nativeSeq
      || normalizedEventOrdinal(left) - normalizedEventOrdinal(right)
      || left.type.localeCompare(right.type));
    return markSessionReadCoverage(events, { truncated: false });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command = "sessions", options } = parseArgs(argv);
  const analyzer = new DshSessionAnalyzer();
  const result = await runProviderCommand(analyzer, command, options);
  await emitProviderResult({ provider: "DeepSeek Harness", command, options, result });
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`dsh session-analysis failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
