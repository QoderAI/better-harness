import { escapeHtml } from "./render-html.mjs";
import { buildSessionViewerReport } from "./session-report-model.mjs";

function renderInline(text) {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gu, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/`([^`\n]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>");
}

function tableCells(line) {
  return line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;

// Bounded Markdown subset for assistant responses: fenced code blocks,
// headings, bullet and numbered lists, bold, and inline code. Input is
// escaped first, so raw transcript HTML never reaches the DOM.
export function miniMarkdownToHtml(text) {
  const lines = escapeHtml(text).split("\n");
  const html = [];
  let codeLines = null;
  let list = null;
  const flushList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      if (codeLines) {
        html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = null;
      } else {
        flushList();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    if (line.includes("|") && TABLE_SEPARATOR_RE.test(lines[index + 1] ?? "")) {
      flushList();
      const headers = tableCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim().length > 0) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/u);
    if (heading) {
      flushList();
      const level = Math.min(4, heading[1].length + 1);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/u);
    if (bullet) {
      if (list !== "ul") {
        flushList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/u);
    if (numbered) {
      if (list !== "ol") {
        flushList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${renderInline(numbered[1])}</li>`);
      continue;
    }
    if (line.trim().length === 0) {
      flushList();
      continue;
    }
    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  if (codeLines && codeLines.length > 0) html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  flushList();
  return html.join("\n");
}

function formatTokens(count) {
  if (!Number.isFinite(count)) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs >= 3_600_000) return `${Math.round(durationMs / 3_600_000 * 10) / 10}hr`;
  if (durationMs >= 60_000) return `${Math.round(durationMs / 60_000)}m`;
  return `${Math.max(1, Math.round(durationMs / 1_000) * 10 / 10)}s`;
}

function formatClock(timestamp) {
  const time = new Date(timestamp ?? "");
  if (Number.isNaN(time.getTime())) return null;
  return time.toISOString().replace("T", " ").slice(0, 16);
}

function metaRow(parts) {
  return parts.filter(Boolean).join(" · ");
}

function stepChip(step) {
  if (step.kind === "note") {
    return `<div class="step-note">${miniMarkdownToHtml(step.text)}</div>`;
  }
  const detail = step.detail ? ` <span class="chip-detail">${escapeHtml(step.detail)}</span>` : "";
  return `<div class="tool-chip"><span class="chip-name">${escapeHtml(step.toolName)}</span>${detail}</div>`;
}

function commitChip(commit) {
  const anchorId = `commit-${commit.hash ?? commit.shortHash}`;
  const trailers = commit.body ? "" : (commit.sessionTrailers ?? [])
    .map((trailer) => `<div class="commit-trailer"><code>${escapeHtml(trailer)}</code></div>`)
    .join("");
  const message = commit.body ? `<div class="commit-message">${miniMarkdownToHtml(commit.body)}</div>` : "";
  const files = (commit.files ?? []).map((file) => {
    const added = Number.isFinite(file.added) ? `+${file.added}` : "-";
    const removed = Number.isFinite(file.removed) ? `-${file.removed}` : "-";
    return `<li><code>${escapeHtml(file.path)}</code><span><b class="added">${added}</b> <b class="removed">${removed}</b></span></li>`;
  }).join("");
  const fileDetails = files
    ? `<details class="commit-files"><summary>${commit.files.length} changed file${commit.files.length === 1 ? "" : "s"}</summary><ul>${files}</ul></details>`
    : "";
  const evidence = commit.confidence
    ? `<span class="evidence ${escapeHtml(commit.confidence)}">${escapeHtml(commit.confidence)} link</span>`
    : "";
  return `<details class="commit-chip" id="${escapeHtml(anchorId)}">
  <summary><span class="commit-icon">⎇</span> <code>${escapeHtml(commit.shortHash)}</code> ${escapeHtml(commit.subject)} <span class="commit-stat added">+${commit.linesAdded ?? 0}</span><span class="commit-stat removed">-${commit.linesRemoved ?? 0}</span></summary>
  <div class="commit-body"><div>${metaRow([formatClock(commit.committedAt ?? commit.authoredAt), commit.authorName])} ${evidence}</div>${message}${trailers}${fileDetails}</div>
</details>`;
}

function turnBlock(turn) {
  const promptMeta = metaRow([
    formatClock(turn.prompt.timestamp),
    formatDuration(turn.durationMs),
    turn.toolCallCount > 0 ? `${turn.toolCallCount} call${turn.toolCallCount === 1 ? "" : "s"}` : null,
  ]);
  const expander = turn.messageCount > 0
    ? `<details class="steps">
  <summary>${turn.messageCount} message${turn.messageCount === 1 ? "" : "s"}, ${turn.toolCallCount} tool call${turn.toolCallCount === 1 ? "" : "s"}</summary>
  <div class="steps-body">
${turn.steps.map(stepChip).join("\n")}
  </div>
</details>`
    : "";
  const response = turn.response
    ? `<div class="row assistant timeline-response">
  <a class="avatar agent" href="#${escapeHtml(turn.anchorId)}" title="Link to this turn">✳</a>
  <div class="response markdown">${miniMarkdownToHtml(turn.response)}</div>
</div>`
    : "";
  const commits = turn.commits.map(commitChip).join("\n");
  return `<section class="turn" id="${escapeHtml(turn.anchorId)}">
<div class="row user timeline-prompt">
  <a class="avatar user" href="#${escapeHtml(turn.anchorId)}" title="Link to this turn">U</a>
  <div class="prompt-wrap">
    <div class="prompt-card">${miniMarkdownToHtml(turn.prompt.text ?? "")}</div>
    <div class="meta">${promptMeta}</div>
  </div>
</div>
${expander}
${response}
${commits}
</section>`;
}

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fafafa; color: #18181b; font: 15px/1.65 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", sans-serif; }
  .page-shell { width: min(1180px, 100%); margin: 0 auto; padding: 36px 24px 80px; display: grid; grid-template-columns: minmax(0, 820px) 240px; gap: 54px; align-items: start; }
  main { min-width: 0; }
  .viewer-name { margin: 0 0 7px; color: #6366f1; font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 0 0 10px; letter-spacing: -0.01em; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: #f4f4f5; border-radius: 4px; padding: 1px 5px; }
  pre { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px 16px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  .session-meta { color: #52525b; font-size: 13.5px; margin-bottom: 36px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .session-meta .sep { color: #d4d4d8; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 12px; background: #fee2e2; color: #b91c1c; font-family: ui-monospace, monospace; }
  .added { color: #15803d; } .removed { color: #b91c1c; }
  .turn { margin-bottom: 28px; }
  .row { display: flex; gap: 14px; margin-bottom: 14px; }
  .avatar { flex: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; text-decoration: none; margin-top: 2px; }
  .avatar.user { background: #e0e7ff; color: #4338ca; font-weight: 600; }
  .avatar.agent { background: #ffedd5; color: #c2410c; }
  .prompt-wrap { flex: 1; min-width: 0; }
  .prompt-card { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 12px 18px; overflow-wrap: anywhere; }
  .prompt-card p { margin: 4px 0; }
  .meta { color: #a1a1aa; font-size: 12.5px; margin: 6px 4px 0; }
  details.steps { margin: 0 0 14px 44px; }
  details.steps summary { cursor: pointer; list-style: none; background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 10px; padding: 9px 16px; color: #52525b; font-size: 13.5px; }
  details.steps summary::before { content: "▸ "; color: #a1a1aa; }
  details.steps[open] summary::before { content: "▾ "; }
  .steps-body { padding: 12px 4px 4px; display: flex; flex-direction: column; gap: 8px; }
  .tool-chip { font-size: 13px; background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 6px 12px; overflow-wrap: anywhere; }
  .chip-name { font-family: ui-monospace, monospace; font-weight: 600; color: #1d4ed8; }
  .chip-detail { font-family: ui-monospace, monospace; color: #52525b; }
  .step-note { font-size: 13.5px; color: #3f3f46; border-left: 2px solid #e4e4e7; padding: 2px 12px; overflow-wrap: anywhere; }
  .step-note p { margin: 4px 0; }
  .response { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .markdown h2 { font-size: 18px; margin: 18px 0 8px; }
  .markdown h3, .markdown h4 { font-size: 15.5px; margin: 14px 0 6px; }
  .markdown p { margin: 8px 0; }
  .markdown ul, .markdown ol { margin: 8px 0; padding-left: 24px; }
  .markdown li { margin: 3px 0; }
  .markdown a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
  .table-wrap { overflow-x: auto; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #e4e4e7; padding: 7px 9px; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; }
  details.commit-chip { margin: 0 0 10px 44px; }
  details.commit-chip summary { cursor: pointer; list-style: none; display: inline-block; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 8px 16px; font-size: 13.5px; color: #166534; overflow-wrap: anywhere; }
  details.commit-chip summary code { background: #dcfce7; }
  .commit-stat { margin-left: 6px; font-family: ui-monospace, monospace; font-size: 12px; }
  .commit-icon { font-weight: 700; }
  .commit-body { padding: 8px 16px; color: #52525b; font-size: 13px; }
  .commit-message { margin: 8px 0; color: #3f3f46; }
  .commit-message p { margin: 4px 0; }
  .commit-trailer { margin-top: 4px; }
  .commit-files { margin-top: 8px; }
  .commit-files ul { list-style: none; margin: 6px 0 0; padding: 0; }
  .commit-files li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
  .evidence { display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .evidence.explicit { background: #dcfce7; color: #15803d; }
  .evidence.high { background: #dbeafe; color: #1d4ed8; }
  .evidence.medium { background: #fef3c7; color: #b45309; }
  .evidence.low { background: #e4e4e7; color: #52525b; }
  .activity-rail { position: sticky; top: 24px; border-left: 1px solid #e4e4e7; padding-left: 22px; color: #3f3f46; }
  .activity-rail h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #71717a; }
  .activity-rail h2:not(:first-child) { margin-top: 26px; }
  .rail-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .rail-metric { border: 1px solid #e4e4e7; border-radius: 9px; background: #fff; padding: 9px 10px; }
  .rail-metric strong { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
  .rail-metric span { display: block; color: #71717a; font-size: 11.5px; }
  .rail-evidence { margin: 12px 0 0; color: #71717a; font-size: 12px; }
  .tool-mix { display: flex; flex-direction: column; gap: 9px; }
  .tool-mix-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; }
  .tool-mix-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-mix-count { color: #71717a; font-variant-numeric: tabular-nums; }
  .tool-mix-bar { grid-column: 1 / -1; height: 5px; overflow: hidden; border-radius: 999px; background: #e4e4e7; }
  .tool-mix-bar i { display: block; height: 100%; border-radius: inherit; background: #818cf8; }
  .tool-trace { margin: 0 0 34px 44px; border: 1px solid #e4e4e7; border-radius: 12px; background: #fff; overflow: hidden; }
  .tool-trace > summary { cursor: pointer; display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 11px 15px; color: #3f3f46; font-size: 13px; font-weight: 600; }
  .tool-trace > summary small { color: #a1a1aa; font-weight: 400; }
  .tool-trace-body { border-top: 1px solid #e4e4e7; padding: 12px; }
  .tool-trace-scroll { max-width: 100%; overflow-x: auto; padding-bottom: 5px; }
  .tool-trace-svg { display: block; max-width: none; color: #52525b; overflow: visible; }
  .tool-trace-row-alt { fill: currentColor; opacity: .035; }
  .tool-trace-lane-line { stroke: currentColor; stroke-dasharray: 3 5; opacity: .18; }
  .tool-trace-grid-line { stroke: currentColor; opacity: .10; }
  .tool-trace-axis-line { stroke: currentColor; opacity: .22; }
  .tool-trace-lane-label, .tool-trace-tick, .tool-trace-axis-label { fill: currentColor; font-size: 11px; opacity: .7; }
  .tool-trace-point { fill: #818cf8; stroke: #fff; stroke-width: 1; }
  .tool-trace-point.failed { fill: #f97316; }
  .tool-trace-point:focus { outline: none; stroke: #1d4ed8; stroke-width: 3; }
  .tool-trace-note { margin: 7px 2px 0; color: #71717a; font-size: 11.5px; }
  .warning { margin: -18px 0 28px 44px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
  @media (max-width: 940px) { .page-shell { grid-template-columns: 1fr; gap: 26px; } .activity-rail { position: static; order: -1; border-left: 0; border-bottom: 1px solid #e4e4e7; padding: 0 0 18px; } .rail-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @media (max-width: 680px) { .page-shell { padding: 24px 16px 56px; } .rail-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .warning, .tool-trace, details.steps, details.commit-chip { margin-left: 0; } }
  .truncated { color: #a1a1aa; text-align: center; font-size: 13.5px; margin-top: 24px; }
`;

function toolTraceTickEvery(totalCalls) {
  const target = Math.max(1, totalCalls / 8);
  return [1, 2, 5, 10, 20, 25, 50, 100].find((step) => step >= target)
    ?? Math.ceil(target / 100) * 100;
}

function formatToolDuration(durationMs) {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 100) / 10} s`;
  return `${Math.round(durationMs / 6_000) / 10} min`;
}

function renderToolTrace(report) {
  const trace = report.session.toolTrace ?? {};
  const calls = (trace.calls ?? [])
    .filter((call) => Number.isFinite(call?.step) && call.step > 0 && String(call?.toolName ?? "").trim())
    .slice()
    .sort((left, right) => left.step - right.step);
  if (calls.length === 0) return "";
  const lanes = [...new Set(calls.map((call) => String(call.toolName)))];
  const laneIndex = new Map(lanes.map((name, index) => [name, index]));
  const totalCalls = Math.max(Number(trace.totalCalls) || 0, ...calls.map((call) => call.step), 1);
  const rowHeight = 30;
  const topPadding = 10;
  const labelWidth = Math.max(96, Math.min(180, lanes.reduce((max, name) => Math.max(max, [...name].slice(0, 22).length * 6.4 + 24), 84)));
  const width = Math.max(720, totalCalls * 12 + 220);
  const plotLeft = labelWidth + 18;
  const plotRight = width - 18;
  const plotWidth = Math.max(40, plotRight - plotLeft);
  const laneHeight = topPadding + lanes.length * rowHeight + 6;
  const height = laneHeight + 34;
  const observed = calls.filter((call) => call.durationStatus === "observed" && Number.isFinite(call.durationMs));
  const durations = observed.map((call) => call.durationMs);
  const minDuration = durations.length ? Math.min(...durations) : 0;
  const maxDuration = durations.length ? Math.max(...durations) : 0;
  const xFor = (step) => plotLeft + ((Math.max(1, Math.min(totalCalls, step)) - 1) / Math.max(1, totalCalls - 1)) * plotWidth;
  const radiusFor = (call) => {
    if (call.durationStatus !== "observed" || !Number.isFinite(call.durationMs)) return 4;
    if (maxDuration - minDuration < 0.001) return 7;
    const progress = (Math.sqrt(call.durationMs) - Math.sqrt(minDuration)) / (Math.sqrt(maxDuration) - Math.sqrt(minDuration));
    return 4 + progress * 6;
  };
  const laneMarkup = lanes.map((name, index) => {
    const top = topPadding + index * rowHeight;
    const center = top + rowHeight / 2;
    const label = [...name].length > 22 ? `${[...name].slice(0, 21).join("")}…` : name;
    return `<g data-tool-lane="${escapeHtml(name)}">${index % 2 ? `<rect class="tool-trace-row-alt" x="${labelWidth}" y="${top}" width="${width - labelWidth}" height="${rowHeight}"></rect>` : ""}<line class="tool-trace-lane-line" x1="${plotLeft - 9}" x2="${plotRight + 9}" y1="${center}" y2="${center}"></line><text class="tool-trace-lane-label" x="${labelWidth - 12}" y="${center + 4}" text-anchor="end">${escapeHtml(label)}</text></g>`;
  }).join("");
  const interval = toolTraceTickEvery(totalCalls);
  const ticks = [];
  for (let value = interval; value <= totalCalls && ticks.length < 1_000; value += interval) ticks.push(value);
  if (ticks.length === 0) ticks.push(1);
  const grid = ticks.map((tick) => `<line class="tool-trace-grid-line" x1="${xFor(tick)}" x2="${xFor(tick)}" y1="${topPadding}" y2="${laneHeight}"></line>`).join("");
  const points = calls.map((call) => {
    const center = topPadding + (laneIndex.get(String(call.toolName)) ?? 0) * rowHeight + rowHeight / 2;
    const timing = call.durationStatus === "observed" && Number.isFinite(call.durationMs)
      ? `observed latency ${formatToolDuration(call.durationMs)}`
      : "latency unavailable";
    const label = `${call.toolName} · call ${call.step} · ${call.status === "failed" ? "failed" : "observed"} · ${timing}`;
    return `<circle class="tool-trace-point${call.status === "failed" ? " failed" : ""}" cx="${xFor(call.step)}" cy="${center}" r="${radiusFor(call)}" tabindex="0" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title></circle>`;
  }).join("");
  const tickLabels = ticks.map((tick) => `<text class="tool-trace-tick" x="${xFor(tick)}" y="${laneHeight + 20}" text-anchor="middle">${tick}</text>`).join("");
  const aria = `${totalCalls} tool calls by tool, sequence, status, and observed latency`;
  return `<details class="tool-trace"><summary><span>Tool-call trace</span><small>${calls.length}${trace.truncated ? ` of ${totalCalls}` : ""} calls · ${observed.length} timed</small></summary><div class="tool-trace-body"><div class="tool-trace-scroll" tabindex="0"><svg class="tool-trace-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(aria)}"><title>${escapeHtml(aria)}</title><desc>Bubble area represents observed latency; orange bubbles are failed calls.</desc>${laneMarkup}${grid}${points}<line class="tool-trace-axis-line" x1="${labelWidth}" x2="${plotRight + 9}" y1="${laneHeight}" y2="${laneHeight}"></line><text class="tool-trace-axis-label" x="${labelWidth - 12}" y="${laneHeight + 20}" text-anchor="end">Call</text>${tickLabels}</svg></div><p class="tool-trace-note">Bubble area scales with observed latency; equal small bubbles have no timing evidence.</p></div></details>`;
}

function activityRail(report) {
  const metricRows = [
    [report.counts.prompts, "Prompts"],
    [report.counts.responses, "Responses"],
    [report.counts.toolCalls, "Tool calls"],
    [report.counts.filesTouched, "Files"],
  ].map(([value, label]) => `<div class="rail-metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const maxToolCount = Math.max(1, ...report.tools.map((tool) => tool.count));
  const tools = report.tools.slice(0, 8).map(({ name, count }) => `<div class="tool-mix-row"><span class="tool-mix-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="tool-mix-count">${count}</span><span class="tool-mix-bar"><i style="width:${Math.max(3, Math.round(count / maxToolCount * 100))}%"></i></span></div>`).join("");
  const evidence = report.counts.commits > 0
    ? `${report.counts.commits} linked commit${report.counts.commits === 1 ? "" : "s"} · +${report.counts.linesAdded}/-${report.counts.linesRemoved}`
    : "No linked commits in the scanned window";
  return `<aside class="activity-rail" aria-label="Session activity"><h2>Session activity</h2><div class="rail-metrics">${metricRows}</div><p class="rail-evidence">${evidence}</p>${tools ? `<h2>Tool mix</h2><div class="tool-mix">${tools}</div>` : ""}</aside>`;
}

export function renderSessionViewerHtml({
  session,
  turns = [],
  truncated = false,
  commitCount = 0,
  unresolvedCheckpoints = [],
} = {}) {
  if (!session) throw new Error("renderSessionViewerHtml requires a session summary");
  const report = buildSessionViewerReport({ session, turns, commitCount, unresolvedCheckpoints });
  const rawTitle = turns[0]?.prompt?.text?.split("\n")[0] ?? session.sessionId;
  const titleText = rawTitle
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/和\s+差距/gu, "和差距")
    .replace(/\s+([,，。？！?])/gu, "$1")
    .trim();
  const title = [...titleText].length > 90 ? `${[...titleText].slice(0, 89).join("")}…` : titleText || session.sessionId;
  const tokenSum = session.tokenUsage
    ? session.tokenUsage.inputTokens + session.tokenUsage.outputTokens
    : 0;
  const tokenTotal = tokenSum > 0 ? formatTokens(tokenSum) : null;
  const { linesAdded, linesRemoved } = report.counts;
  const metaParts = [
    `<span class="badge">${escapeHtml(session.platform ?? "unknown")}</span>`,
    session.models?.length ? escapeHtml(session.models.join(", ")) : null,
    formatClock(session.firstSeen),
    formatDuration(session.durationMs),
    report.counts.commits > 0 ? `${report.counts.commits} commit${report.counts.commits === 1 ? "" : "s"}` : null,
    session.files?.length ? `${session.files.length} file${session.files.length === 1 ? "" : "s"} touched` : null,
    linesAdded || linesRemoved ? `<span class="added">+${linesAdded}</span>/<span class="removed">-${linesRemoved}</span>` : null,
    tokenTotal ? `${tokenTotal} tokens` : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Viewer · ${escapeHtml(session.sessionId)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page-shell">
<main>
  <p class="viewer-name">Session Viewer</p>
  <h1>${escapeHtml(title)}</h1>
  <div class="session-meta">${metaParts.join('<span class="sep">·</span>')}</div>
  ${unresolvedCheckpoints.length > 0 ? `<p class="warning">${unresolvedCheckpoints.length} explicit commit link${unresolvedCheckpoints.length === 1 ? "" : "s"} could not be resolved locally; those commits use heuristic evidence only.</p>` : ""}
  ${renderToolTrace(report)}
  ${turns.map(turnBlock).join("\n")}
  ${truncated ? '<p class="truncated">Timeline truncated; open the raw session data for the full history.</p>' : ""}
</main>
${activityRail(report)}
</div>
</body>
</html>
`;
}
