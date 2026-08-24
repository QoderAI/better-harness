import { spawnSync } from "node:child_process";

const LEGACY_CHECKPOINT_RE = /^[0-9a-f]{12}$/iu;
const ULID_CHECKPOINT_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const MAX_CHECKPOINTS = 200;
const MAX_SESSIONS_PER_CHECKPOINT = 100;

export function isEntireCheckpointId(value) {
  return LEGACY_CHECKPOINT_RE.test(String(value ?? "")) || ULID_CHECKPOINT_RE.test(String(value ?? ""));
}

function readGitObject(repoRoot, objectPath, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync("git", ["show", objectPath], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function readJsonObject(repoRoot, ref, filePath) {
  const content = readGitObject(repoRoot, `${ref}:${filePath}`);
  if (content === null) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionIdFromMetadata(metadata) {
  const sessionId = metadata?.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 512) return null;
  return sessionId;
}

function safeGitTreePath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.includes("\\")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return normalized;
}

// Entire's SessionFilePaths are authoritative. New refs use root-relative
// paths while the legacy branch can store full checkpoint-tree paths.
function resolveSessionFilePath(rootPath, declaredPath, fallbackRelativePath) {
  const declared = safeGitTreePath(declaredPath);
  if (declared) {
    if (!rootPath || declared === rootPath || declared.startsWith(`${rootPath}/`)) return declared;
    return `${rootPath}/${declared}`;
  }
  return rootPath ? `${rootPath}/${fallbackRelativePath}` : fallbackRelativePath;
}

function readCheckpointAt({ repoRoot, checkpointId, ref, rootPath, backend }) {
  const summaryPath = rootPath ? `${rootPath}/metadata.json` : "metadata.json";
  const summary = readJsonObject(repoRoot, ref, summaryPath);
  if (!summary || summary.checkpoint_id !== checkpointId || !Array.isArray(summary.sessions)) return null;
  const sessionCount = Math.min(summary.sessions.length, MAX_SESSIONS_PER_CHECKPOINT);
  const sessionIds = [];
  const sessions = [];
  for (let index = 0; index < sessionCount; index += 1) {
    const paths = summary.sessions[index] && typeof summary.sessions[index] === "object"
      ? summary.sessions[index]
      : {};
    const metadataPath = resolveSessionFilePath(rootPath, paths.metadata, `${index}/metadata.json`);
    const transcriptPath = resolveSessionFilePath(rootPath, paths.transcript, `${index}/full.jsonl`);
    const metadata = readJsonObject(repoRoot, ref, metadataPath);
    const sessionId = sessionIdFromMetadata(metadata);
    if (sessionId && !sessionIds.includes(sessionId)) {
      sessionIds.push(sessionId);
      sessions.push({
        sessionId,
        index,
        agent: typeof metadata.agent === "string" ? metadata.agent : null,
        model: typeof metadata.model === "string" ? metadata.model : null,
        createdAt: typeof metadata.created_at === "string" ? metadata.created_at : null,
        metadataPath,
        transcriptPath,
        compactTranscriptPath: paths.compact_transcript
          ? resolveSessionFilePath(rootPath, paths.compact_transcript, `${index}/transcript.jsonl`)
          : null,
        checkpointCount: Number.isFinite(metadata.checkpoints_count) ? metadata.checkpoints_count : null,
        saveStepCount: Number.isFinite(metadata.save_step_count) ? metadata.save_step_count : null,
        filesTouched: Array.isArray(metadata.files_touched)
          ? metadata.files_touched.filter((value) => typeof value === "string").slice(0, 400)
          : [],
        tokenUsage: metadata.token_usage && typeof metadata.token_usage === "object" ? metadata.token_usage : null,
        sessionMetrics: metadata.session_metrics && typeof metadata.session_metrics === "object" ? metadata.session_metrics : null,
        turnId: typeof metadata.turn_id === "string" ? metadata.turn_id : null,
        summary: metadata.summary && typeof metadata.summary === "object" ? metadata.summary : null,
      });
    }
  }
  if (sessionIds.length === 0) return null;
  return {
    checkpointId,
    backend,
    ref,
    rootPath,
    sessionIds,
    sessions,
    checkpointCount: Number.isFinite(summary.checkpoints_count) ? summary.checkpoints_count : null,
    strategy: typeof summary.strategy === "string" ? summary.strategy : null,
    branch: typeof summary.branch === "string" ? summary.branch : null,
    tokenUsage: summary.token_usage && typeof summary.token_usage === "object" ? summary.token_usage : null,
    filesTouched: Array.isArray(summary.files_touched)
      ? summary.files_touched.filter((value) => typeof value === "string").slice(0, 400)
      : [],
  };
}

export function readEntireCheckpointSession(repoRoot, checkpointFact, sessionId) {
  const session = checkpointFact?.sessions?.find((candidate) => candidate.sessionId === sessionId);
  if (!session) return null;
  const transcript = readGitObject(repoRoot, `${checkpointFact.ref}:${session.transcriptPath}`, 64 * 1024 * 1024);
  if (transcript === null) return null;
  return { checkpoint: checkpointFact, session, transcript };
}

export function resolveEntireCheckpoint(repoRoot, checkpointId) {
  if (!isEntireCheckpointId(checkpointId)) return null;
  const refShard = checkpointId.slice(-2);
  const refFact = readCheckpointAt({
    repoRoot,
    checkpointId,
    ref: `refs/entire/checkpoints/${refShard}/${checkpointId}`,
    rootPath: "",
    backend: "git-refs",
  });
  if (refFact) return refFact;

  // Upstream routes current ULIDs to per-checkpoint refs. The v1 branch is the
  // compatibility fallback for legacy 12-hex IDs only.
  if (!LEGACY_CHECKPOINT_RE.test(checkpointId)) return null;
  const rootPath = `${checkpointId.slice(0, 2)}/${checkpointId.slice(2)}`;
  for (const ref of [
    "refs/heads/entire/checkpoints/v1",
    "refs/remotes/origin/entire/checkpoints/v1",
  ]) {
    const branchFact = readCheckpointAt({
      repoRoot,
      checkpointId,
      ref,
      rootPath,
      backend: "git-branch",
    });
    if (branchFact) return branchFact;
  }
  return null;
}

export function collectEntireCheckpointFacts({ repoRoot, commits = [] } = {}) {
  const checkpointIds = [];
  for (const commit of commits) {
    for (const link of commit.sessionLinks ?? []) {
      if (link.type !== "entire-checkpoint" || !isEntireCheckpointId(link.value)) continue;
      if (!checkpointIds.includes(link.value) && checkpointIds.length < MAX_CHECKPOINTS) checkpointIds.push(link.value);
    }
  }

  const checkpoints = [];
  const unresolved = [];
  for (const checkpointId of checkpointIds) {
    const fact = resolveEntireCheckpoint(repoRoot, checkpointId);
    if (fact) checkpoints.push(fact);
    else unresolved.push(checkpointId);
  }
  return { checkpoints, unresolved };
}

export function attachCheckpointFactsToSessions(sessions = [], checkpointFacts = []) {
  return sessions.map((session) => {
    const matchingFacts = checkpointFacts.filter((checkpoint) => checkpoint.sessionIds.includes(session.sessionId));
    return {
      ...session,
      checkpointIds: matchingFacts.map((checkpoint) => checkpoint.checkpointId),
      checkpointFacts: matchingFacts.map((checkpoint) => {
        const sessionFact = checkpoint.sessions.find((candidate) => candidate.sessionId === session.sessionId);
        return {
          checkpointId: checkpoint.checkpointId,
          backend: checkpoint.backend,
          createdAt: sessionFact?.createdAt ?? null,
          agent: sessionFact?.agent ?? null,
          model: sessionFact?.model ?? null,
          checkpointCount: sessionFact?.checkpointCount ?? checkpoint.checkpointCount,
          filesTouched: sessionFact?.filesTouched?.length ? sessionFact.filesTouched : checkpoint.filesTouched,
          tokenUsage: sessionFact?.tokenUsage ?? checkpoint.tokenUsage,
          turnId: sessionFact?.turnId ?? null,
          summary: sessionFact?.summary ?? null,
        };
      }),
    };
  });
}
