import { redactTranscriptText } from "./redaction.mjs";

const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__)\/|(?:\.test\.|\.spec\.|_test\.)/u;
const DOC_PATH_RE = /(?:^|\/)docs?\/|\.(?:md|mdx|rst|adoc|txt)$/iu;

const CONFIDENCE_LABELS = Object.freeze({
  explicit: "Explicit trailer",
  high: "High · files + time",
  medium: "Medium · cwd + time",
  low: "Low · time only",
});

const CATEGORY_COLORS = Object.freeze({
  code: "#3b82f6",
  tests: "#8b5cf6",
  docs: "#f59e0b",
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function classifyChangePath(filePath) {
  if (TEST_PATH_RE.test(filePath)) return "tests";
  if (DOC_PATH_RE.test(filePath)) return "docs";
  return "code";
}

export function changeBreakdown(files = []) {
  const categories = {
    code: { added: 0, removed: 0, files: 0 },
    tests: { added: 0, removed: 0, files: 0 },
    docs: { added: 0, removed: 0, files: 0 },
  };
  for (const file of files) {
    const bucket = categories[classifyChangePath(file.path)];
    bucket.files += 1;
    bucket.added += Number.isFinite(file.added) ? file.added : 0;
    bucket.removed += Number.isFinite(file.removed) ? file.removed : 0;
  }
  return categories;
}

function formatTokens(count) {
  if (!Number.isFinite(count)) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  const minutes = Math.round(durationMs / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes >= 1) return `${minutes}m`;
  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
}

function changesBar(categories) {
  const total = Object.values(categories).reduce((sum, bucket) => sum + bucket.added + bucket.removed, 0);
  if (total === 0) return "";
  const segments = Object.entries(categories)
    .filter(([, bucket]) => bucket.added + bucket.removed > 0)
    .map(([name, bucket]) => {
      const width = Math.max(3, Math.round(((bucket.added + bucket.removed) / total) * 100));
      return `<span class="bar-segment" style="width:${width}%;background:${CATEGORY_COLORS[name]}" title="${name}"></span>`;
    })
    .join("");
  return `<div class="bar">${segments}</div>`;
}

function changeRows(categories) {
  return Object.entries(categories)
    .filter(([, bucket]) => bucket.files > 0)
    .map(([name, bucket]) => {
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      const removed = bucket.removed > 0 ? ` <span class="removed">-${bucket.removed}</span>` : "";
      return `<div class="stat-row"><span><i class="dot" style="background:${CATEGORY_COLORS[name]}"></i>${label}</span><span><span class="added">+${bucket.added}</span>${removed}</span></div>`;
    })
    .join("\n");
}

function promptTimeline(session) {
  if (!Array.isArray(session?.prompts) || session.prompts.length === 0) {
    return '<p class="muted">No privacy-safe prompt summaries available.</p>';
  }
  const items = session.prompts
    .map((prompt) => `<li><div class="prompt-card">${escapeHtml(prompt.text)}</div></li>`)
    .join("\n");
  const omitted = Math.max(0, (session.promptCount ?? 0) - session.prompts.length);
  const note = omitted > 0 ? `<p class="muted">${omitted} more prompt${omitted === 1 ? "" : "s"} not shown.</p>` : "";
  return `<ol class="timeline">${items}</ol>${note}`;
}

function overlapDetails(match) {
  const files = match.evidence.overlappingFiles ?? [];
  if (files.length === 0) return "";
  const rows = files.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("");
  return `<details><summary>${files.length} overlapping file${files.length === 1 ? "" : "s"}</summary><ul class="file-list">${rows}</ul></details>`;
}

function sessionCard(match, session) {
  const meta = [
    session?.models?.length ? escapeHtml(session.models.join(", ")) : null,
    formatDuration(session?.durationMs),
    Number.isFinite(session?.toolCallCount) ? `${session.toolCallCount} calls` : null,
  ].filter(Boolean).join(" · ");
  return `<section class="session-card">
  <header>
    <span class="badge platform">${escapeHtml(match.platform ?? "unknown")}</span>
    <span class="badge confidence ${escapeHtml(match.confidence)}">${escapeHtml(CONFIDENCE_LABELS[match.confidence] ?? match.confidence)}</span>
    <span class="meta">${meta}</span>
  </header>
  <p class="session-id"><code>${escapeHtml(match.sessionId)}</code></p>
  ${match.evidence?.checkpointId ? `<p class="checkpoint-id">Checkpoint <code>${escapeHtml(match.evidence.checkpointId)}</code> resolved to this session.</p>` : ""}
  ${promptTimeline(session)}
  ${overlapDetails(match)}
</section>`;
}

function tokensSection(sessions) {
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
  let observed = false;
  for (const session of sessions) {
    if (!session?.tokenUsage) continue;
    observed = true;
    totals.inputTokens += session.tokenUsage.inputTokens;
    totals.outputTokens += session.tokenUsage.outputTokens;
    totals.cacheReadInputTokens += session.tokenUsage.cacheReadInputTokens;
  }
  if (!observed) return "";
  return `<h2>Tokens</h2>
<div class="stat-row"><span>Input</span><span>${formatTokens(totals.inputTokens)}</span></div>
<div class="stat-row"><span>Output</span><span>${formatTokens(totals.outputTokens)}</span></div>
<div class="stat-row"><span>Cache read</span><span>${formatTokens(totals.cacheReadInputTokens)}</span></div>
<div class="stat-row total"><span>Total</span><span>${formatTokens(totals.inputTokens + totals.outputTokens)}</span></div>`;
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fafafa; color: #18181b; font: 15px/1.6 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 26px; margin: 0 0 8px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #52525b; margin: 24px 0 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  .commit-meta { color: #52525b; margin-bottom: 24px; }
  .commit-meta .badge { margin-right: 8px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 32px; }
  @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; background: #e4e4e7; }
  .badge.platform { background: #fee2e2; color: #b91c1c; font-family: ui-monospace, monospace; }
  .badge.confidence.explicit { background: #dcfce7; color: #15803d; }
  .badge.confidence.high { background: #dbeafe; color: #1d4ed8; }
  .badge.confidence.medium { background: #fef3c7; color: #b45309; }
  .badge.confidence.low { background: #e4e4e7; color: #52525b; }
  .session-card { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
  .session-card header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .session-card .meta { color: #71717a; font-size: 13px; margin-left: auto; }
  .session-id { margin: 8px 0; color: #71717a; overflow-wrap: anywhere; }
  .checkpoint-id { margin: 8px 0; color: #15803d; font-size: 13px; overflow-wrap: anywhere; }
  .timeline { list-style: none; margin: 12px 0; padding: 0 0 0 18px; border-left: 2px solid #e4e4e7; }
  .timeline li { position: relative; margin-bottom: 12px; }
  .timeline li::before { content: ""; position: absolute; left: -24px; top: 12px; width: 9px; height: 9px; border-radius: 50%; background: #a1a1aa; }
  .prompt-card { background: #fafafa; border: 1px solid #f4f4f5; border-radius: 8px; padding: 10px 14px; overflow-wrap: anywhere; }
  .file-list { margin: 8px 0 0; padding-left: 18px; }
  .stat-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .stat-row.total { border-top: 1px solid #e4e4e7; margin-top: 4px; padding-top: 8px; font-weight: 600; }
  .added { color: #15803d; } .removed { color: #b91c1c; }
  .bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 8px 0; background: #e4e4e7; }
  .bar-segment { display: block; height: 100%; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .muted { color: #a1a1aa; font-size: 13px; }
  details summary { cursor: pointer; color: #52525b; font-size: 13px; }
`;

export function renderCommitSessionHtml({ commit, sessions = [], graceMinutes = null } = {}) {
  if (!commit) throw new Error("renderCommitSessionHtml requires a correlated commit");
  const safeSubject = redactTranscriptText(commit.subject, { limit: 500 }) ?? "untitled commit";
  const safeAuthorName = redactTranscriptText(commit.authorName, { limit: 200 });
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
  const matches = commit.matches ?? [];
  const matchedSessions = matches
    .map((match) => sessionById.get(match.sessionId))
    .filter(Boolean);
  const categories = changeBreakdown(commit.files ?? []);
  const linesAdded = Object.values(categories).reduce((sum, bucket) => sum + bucket.added, 0);
  const linesRemoved = Object.values(categories).reduce((sum, bucket) => sum + bucket.removed, 0);
  const promptTotal = matchedSessions.reduce((sum, session) => sum + (session.promptCount ?? 0), 0);
  const toolCallTotal = matchedSessions.reduce((sum, session) => sum + (session.toolCallCount ?? 0), 0);

  const sessionSections = matches.length > 0
    ? matches.map((match) => sessionCard(match, sessionById.get(match.sessionId))).join("\n")
    : `<p class="muted">No sessions correlated with this commit${graceMinutes === null ? "" : ` within the ${graceMinutes}-minute grace window`}.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Commit ${escapeHtml(commit.shortHash)} · session links</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>${escapeHtml(safeSubject)}</h1>
  <p class="commit-meta">
    <span class="badge"><code>${escapeHtml(commit.shortHash)}</code></span>
    ${safeAuthorName ? `<span>${escapeHtml(safeAuthorName)}</span> · ` : ""}<span>${escapeHtml(commit.authoredAt ?? "")}</span>
  </p>
  <div class="layout">
    <div>
      <h2>Sessions</h2>
      ${sessionSections}
    </div>
    <aside>
      <h2>Activity</h2>
      <div class="stat-row"><span>Sessions</span><span>${matches.length}</span></div>
      <div class="stat-row"><span>Prompts</span><span>${promptTotal}</span></div>
      <div class="stat-row"><span>Tool calls</span><span>${toolCallTotal}</span></div>
      <h2>Changes <span class="muted">${(commit.files ?? []).length} files</span></h2>
      ${changesBar(categories)}
      ${changeRows(categories)}
      <div class="stat-row total"><span>Lines</span><span><span class="added">+${linesAdded}</span> <span class="removed">-${linesRemoved}</span></span></div>
      ${tokensSection(matchedSessions)}
    </aside>
  </div>
</main>
</body>
</html>
`;
}
