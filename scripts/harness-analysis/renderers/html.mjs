import path from "node:path";

import { isAgentWorkLoopReport } from "../fluency-dimensions.mjs";
import { renderHtmlInteractionScript } from "./html-interactions.mjs";
import { renderMarkdown } from "./markdown.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const CJK_PHRASE = /^\p{Script=Han}{2,8}$/u;

function renderVisibleText(value, language) {
  const text = String(value ?? "");
  if (language !== "zh-CN" || typeof Intl.Segmenter !== "function") return escapeHtml(text);
  try {
    const segments = new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(text);
    return [...segments].map(({ segment, isWordLike }) => {
      const escaped = escapeHtml(segment);
      return isWordLike && CJK_PHRASE.test(segment)
        ? `<span class="cjk-phrase">${escaped}</span>`
        : escaped;
    }).join("");
  } catch {
    return escapeHtml(text);
  }
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, number(value)));
}

function formatNumber(value, locale) {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  }).format(number(value));
}

function copy(language, en, zh) {
  return language === "zh-CN" ? zh : en;
}

function textLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  const line = String(value ?? "").trim();
  return line ? [line] : [];
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function hasAiFixPrompt(finding) {
  return typeof finding?.aiFixPrompt === "string" && finding.aiFixPrompt.trim().length > 0;
}

export function buildHtmlInteractionData(reportData) {
  return {
    findings: list(reportData?.findings)
      .flatMap((finding, index) => (hasAiFixPrompt(finding)
        ? [{ id: String(finding?.id ?? index), aiFixPrompt: finding.aiFixPrompt }]
        : [])),
  };
}

function finalReportRoute(workspacePath, findingsPath) {
  if (!path.isAbsolute(workspacePath) || !path.isAbsolute(findingsPath)) return null;
  const reportPath = path.join(path.dirname(findingsPath), "report.html");
  const relative = path.relative(workspacePath, reportPath);
  if (!relative || path.isAbsolute(relative)) return null;
  const segments = relative.split(/[\\/]/u);
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

export function buildHtmlReportActions(reportData, { findingsPath } = {}) {
  const workspacePath = String(reportData?.target?.path ?? "");
  const resolvedFindingsPath = String(findingsPath ?? "");
  const reportRoute = finalReportRoute(workspacePath, resolvedFindingsPath);
  if (!reportRoute) return { reportRoute: null, findings: [] };
  return {
    reportRoute,
    findings: list(reportData?.findings)
      .flatMap((finding, index) => (hasAiFixPrompt(finding)
        ? [{
            id: String(finding?.id ?? index),
            expectedRevision: Number.isInteger(finding?.actualOutputRevision)
              ? finding.actualOutputRevision
              : 0,
          }]
        : [])),
  };
}

function findingPromptParts(prompt, language) {
  const lines = String(prompt ?? "").split(/\r?\n/u).map((line) => line.trim());
  const validationIndex = lines.findIndex((line) => /^##\s+Validation$/iu.test(line));
  const body = lines.slice(0, validationIndex >= 0 ? validationIndex : lines.length)
    .filter((line) => line && !line.startsWith("/") && !line.startsWith("#"));
  const checks = (validationIndex >= 0 ? lines.slice(validationIndex + 1) : [])
    .filter((line) => /^[-*]\s+/u.test(line))
    .map((line) => line.replace(/^[-*]\s+/u, ""));
  return {
    summary: body[0] ?? copy(language, "Use the report command to address this reviewed finding.", "使用报告命令处理这条已复核 finding。"),
    checks,
  };
}

function severityTone(severity) {
  const value = String(severity ?? "Low").toLowerCase();
  if (["critical", "high"].includes(value)) return "danger";
  if (value === "medium") return "warning";
  return "neutral";
}

function suggestionKindLabel(kind, language) {
  const labels = {
    "try-existing": ["Try existing", "试用已有能力"],
    "working-pattern": ["Working pattern", "有效模式"],
    "loop-candidate": ["Loop candidate", "循环候选"],
    horizon: ["Horizon", "中长期"],
  }[kind] ?? [String(kind ?? "Suggestion"), String(kind ?? "建议")];
  return copy(language, labels[0], labels[1]);
}

function stateTone(state) {
  const value = String(state ?? "").toLowerCase();
  if (["exercised", "rehearsed"].includes(value)) return "good";
  if (["wired", "present"].includes(value)) return "accent";
  return "muted";
}

function metric(label, value, note = "", language = "en") {
  return `<div class="metric">
    <span>${renderVisibleText(label, language)}</span>
    <strong>${renderVisibleText(value, language)}</strong>
    ${note ? `<small>${renderVisibleText(note, language)}</small>` : ""}
  </div>`;
}

function loopEffectiveness(dimensions) {
  const scores = list(dimensions).map((row) => number(row?.score, NaN)).filter(Number.isFinite);
  return scores.length === 0 ? 0 : Math.round(scores.reduce((sum, score) => sum + clamp(score), 0) / scores.length);
}

function repairProgress(findings) {
  const rows = list(findings);
  const verified = rows.filter((finding) => finding?.postFixRepairReview?.status === "verified").length;
  const partial = rows.filter((finding) => finding?.postFixRepairReview?.status === "partial").length;
  const reviewed = rows.filter((finding) => ["verified", "partial", "blocked"].includes(finding?.postFixRepairReview?.status)).length;
  return {
    score: rows.length === 0 ? 100 : Math.round((verified / rows.length) * 100),
    verified,
    partial,
    pending: Math.max(0, rows.length - reviewed),
  };
}

function evidenceScoreLabel(summary, language) {
  const platform = String(summary?.evidenceBoundary?.manifest?.platform ?? "").toLowerCase();
  if (platform === "qoder") return copy(language, "Qoder Evidence Score (Loop Effectiveness)", "Qoder 证据分（循环有效性）");
  if (platform === "codex") return copy(language, "Codex Evidence Score (Loop Effectiveness)", "Codex 证据分（循环有效性）");
  return copy(language, "Loop Effectiveness", "循环有效性");
}

function section(id, eyebrow, title, body, note = "", language = "en") {
  return `<section class="section" data-section="${escapeHtml(id)}" aria-labelledby="section-${escapeHtml(id)}">
    <div class="section-heading">
      <div><span class="eyebrow">${renderVisibleText(eyebrow, language)}</span><h2 id="section-${escapeHtml(id)}">${renderVisibleText(title, language)}</h2></div>
      ${note ? `<p>${renderVisibleText(note, language)}</p>` : ""}
    </div>
    ${body}
  </section>`;
}

function renderDimensionGrid(summary, language) {
  const dimensions = list(summary?.dimensions);
  if (dimensions.length === 0) {
    return `<p class="empty">${renderVisibleText(copy(language, "No reviewed dimension scores are available.", "暂无已复核的维度分数。"), language)}</p>`;
  }
  return `<div class="dimension-grid">
    ${dimensions.map((row, index) => {
      const score = clamp(row.score);
      const roundedScore = Math.round(score);
      const label = row.label ?? row.id ?? `Dimension ${index + 1}`;
      const state = row.state ?? copy(language, "Reviewed", "已复核");
      return `<article class="dimension-card" data-dimension-id="${escapeHtml(row.id ?? index)}">
        <div class="dimension-top"><span>${renderVisibleText(label, language)}</span><span class="pill ${stateTone(state)}">${renderVisibleText(state, language)}</span></div>
        <div class="score-line"><strong>${roundedScore}</strong><span>/ 100</span></div>
        <div class="track" role="progressbar" aria-label="${escapeHtml(label)} ${roundedScore} of 100" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${roundedScore}"><i style="width:${score}%"></i></div>
        <p>${renderVisibleText(row.summary ?? row.scoreReason ?? "", language)}</p>
      </article>`;
    }).join("\n")}
  </div>`;
}

function heatLevel(value, max) {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((value / max) * 4)));
}

function activityTickIndexes(dayCount) {
  if (dayCount <= 4) return Array.from({ length: dayCount }, (_, index) => index);

  const lastIndex = dayCount - 1;
  const indexes = [0];
  for (let index = 7; index < lastIndex; index += 7) {
    if (lastIndex - index > 3) indexes.push(index);
  }
  indexes.push(lastIndex);
  return indexes;
}

function renderActivity(summary, language) {
  const activity = summary?.usageActivity;
  const usage = summary?.usageEfficiency;
  const dates = list(activity?.dates);
  const activeMinutes = list(activity?.sessions?.activeMinutes);
  const starts = list(activity?.sessions?.starts);
  const values = dates.map((_, index) => number(activeMinutes[index] ?? starts[index]));
  const max = Math.max(0, ...values);
  const cells = dates.map((date, index) => {
    const active = number(activeMinutes[index]);
    const sessions = number(starts[index]);
    const label = activeMinutes.length > 0
      ? copy(language, `${date}: ${formatNumber(active, language)} active minutes`, `${date}：${formatNumber(active, language)} 活跃分钟`)
      : copy(language, `${date}: ${formatNumber(sessions, language)} sessions`, `${date}：${formatNumber(sessions, language)} 个会话`);
    return `<span class="heat-cell l${heatLevel(values[index], max)}" data-date="${escapeHtml(date)}" style="grid-column:${index + 1}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`;
  }).join("");
  const ticks = activityTickIndexes(dates.length).map((index) => {
    const position = dates.length > 4
      ? index === 0 ? " first" : index === dates.length - 1 ? " last" : ""
      : "";
    return `<span class="heat-tick${position}" data-date="${escapeHtml(dates[index])}" style="grid-column:${index + 1}">${escapeHtml(dates[index])}</span>`;
  }).join("");
  const heatWidth = Math.max(13, (dates.length * 17) - 4);
  const coverage = summary?.atAGlance?.coverage ?? {};
  const selection = usage?.selection ?? coverage?.selection ?? {};
  const analyzed = selection.analyzedSessionCount ?? selection.analyzedCount ?? 0;
  const eligible = selection.eligibleSessionCount ?? selection.eligibleCount ?? activity?.sessions?.total ?? 0;
  const longCount = usage?.longSessions?.activeCount ?? 0;
  const longest = usage?.longSessions?.longestActiveMinutes ?? 0;

  return `<div class="activity-layout">
    <div class="activity-panel">
      ${dates.length > 0 ? `<div class="heat-scroll" style="--heat-days:${dates.length};--heat-min-width:${heatWidth}px">
        <div class="heatmap" role="img" aria-label="${copy(language, "Session activity heatmap", "会话活跃度热力图")}">${cells}</div>
        <div class="heat-axis" aria-hidden="true">${ticks}</div>
      </div>` : `<div class="heatmap-empty" role="img" aria-label="${copy(language, "Session activity heatmap", "会话活跃度热力图")}"><span class="empty">${renderVisibleText(copy(language, "No dated activity was retained.", "没有保留按日期聚合的活动数据。"), language)}</span></div>`}
    </div>
    <div class="stacked-metrics">
      ${metric(copy(language, "Sessions reviewed", "已分析会话"), `${formatNumber(analyzed, language)} / ${formatNumber(eligible, language)}`, copy(language, "all-eligible usage census", "全量合格用量普查"), language)}
      ${metric(copy(language, "Long-session leads", "长会话线索"), formatNumber(longCount, language), copy(language, `longest ${formatNumber(longest, language)} min`, `最长 ${formatNumber(longest, language)} 分钟`), language)}
    </div>
  </div>`;
}

function toolTraceTickEvery(totalCalls) {
  const target = Math.max(1, number(totalCalls) / 8);
  return [1, 2, 5, 10, 20, 25, 50, 100].find((step) => step >= target)
    ?? Math.ceil(target / 100) * 100;
}

function toolTraceTicks(min, max, interval) {
  if (min === max) return [min];
  const ticks = [];
  const first = Math.ceil(min / interval) * interval;
  for (let value = first, index = 0; value <= max && index < 1_000; value += interval, index += 1) {
    ticks.push(value);
  }
  return ticks.length > 0 ? ticks : [min, max];
}

function observedToolDuration(call) {
  const duration = number(call?.durationMs, NaN);
  return call?.durationStatus === "observed" && Number.isFinite(duration) && duration >= 0
    ? duration
    : null;
}

function formatToolDuration(value, language) {
  const duration = Math.max(0, number(value));
  if (duration < 1_000) return `${Math.round(duration)} ms`;
  if (duration < 60_000) return `${formatNumber(duration / 1_000, language)} s`;
  return `${formatNumber(duration / 60_000, language)} min`;
}

function longSessionRoleLabel(role, language) {
  if (role === "user-thread-candidate") return copy(language, "Main-thread candidate", "主线程候选");
  if (role === "child-agent-candidate") return copy(language, "Child-Agent candidate", "子 Agent 候选");
  return copy(language, "Unknown candidate", "未知候选");
}

function renderToolTraceSvg(sample, language) {
  const trace = sample?.toolTrace ?? {};
  const calls = list(trace.calls)
    .filter((call) => Number.isFinite(number(call?.step, NaN)) && number(call?.step) > 0 && String(call?.toolName ?? "").trim())
    .slice()
    .sort((left, right) => number(left.step) - number(right.step));
  if (calls.length === 0) {
    return `<p class="empty tool-trace-empty">${renderVisibleText(copy(language, "No tool calls were retained for this session.", "该会话没有保留工具调用。"), language)}</p>`;
  }

  const laneLabels = [...new Set(calls.map((call) => String(call.toolName)))];
  const laneIndex = new Map(laneLabels.map((label, index) => [label, index]));
  const totalCalls = Math.max(number(trace.totalCalls), ...calls.map((call) => number(call.step)), 1);
  const rowHeight = 30;
  const topPadding = 10;
  const labelWidth = Math.max(96, Math.min(180, laneLabels.reduce((maximum, label) =>
    Math.max(maximum, [...label].slice(0, 22).length * 6.4 + 24), 84)));
  const viewWidth = Math.max(720, totalCalls * 12 + 220);
  const plotLeft = labelWidth + 18;
  const plotRight = viewWidth - 18;
  const plotWidth = Math.max(40, plotRight - plotLeft);
  const laneAreaHeight = topPadding + laneLabels.length * rowHeight + 6;
  const chartHeight = laneAreaHeight + 34;
  const observed = calls.map(observedToolDuration).filter((value) => value !== null);
  const observedMin = observed.length > 0 ? Math.min(...observed) : 0;
  const observedMax = observed.length > 0 ? Math.max(...observed) : 0;
  const xForStep = (step) => plotLeft + ((Math.max(1, Math.min(totalCalls, number(step))) - 1) / Math.max(1, totalCalls - 1)) * plotWidth;
  const radiusFor = (duration) => {
    if (duration === null) return 4;
    if (observedMax - observedMin < 0.001) return 7;
    const progress = (Math.sqrt(duration) - Math.sqrt(observedMin))
      / (Math.sqrt(observedMax) - Math.sqrt(observedMin));
    return 4 + progress * 6;
  };
  const tickEvery = toolTraceTickEvery(totalCalls);
  const ticks = toolTraceTicks(1, totalCalls, tickEvery);
  const alias = String(sample?.alias ?? "Session");
  const ariaLabel = copy(
    language,
    `${alias} tool calls by tool, sequence, and observed latency`,
    `${alias} 按工具、调用序号和观测延迟展示的工具调用`,
  );

  const laneMarkup = laneLabels.map((label, index) => {
    const top = topPadding + index * rowHeight;
    const center = top + rowHeight / 2;
    const visibleLabel = [...label].length > 22 ? `${[...label].slice(0, 21).join("")}…` : label;
    return `<g data-tool-lane="${escapeHtml(label)}">
      ${index % 2 === 1 ? `<rect class="tool-trace-row-alt" x="${labelWidth}" y="${top}" width="${viewWidth - labelWidth}" height="${rowHeight}"></rect>` : ""}
      <line class="tool-trace-lane-line" x1="${plotLeft - 9}" x2="${plotRight + 9}" y1="${center}" y2="${center}"></line>
      <text class="tool-trace-lane-label" x="${labelWidth - 12}" y="${center + 4}" text-anchor="end">${renderVisibleText(visibleLabel, language)}</text>
    </g>`;
  }).join("");
  const gridMarkup = ticks.map((tick) => `<line class="tool-trace-grid-line" x1="${xForStep(tick)}" x2="${xForStep(tick)}" y1="${topPadding}" y2="${laneAreaHeight}"></line>`).join("");
  const pointMarkup = calls.map((call) => {
    const duration = observedToolDuration(call);
    const lane = laneIndex.get(String(call.toolName)) ?? 0;
    const center = topPadding + lane * rowHeight + rowHeight / 2;
    const status = call.status === "failed"
      ? copy(language, "failed", "失败")
      : copy(language, "observed", "已观察");
    const timing = duration === null
      ? copy(language, "observed latency unavailable", "未观察到调用延迟")
      : copy(language, `observed latency ${formatToolDuration(duration, language)}`, `观测延迟 ${formatToolDuration(duration, language)}`);
    const pointLabel = `${call.toolName} · ${copy(language, "tool-call step", "工具调用序号")} ${formatNumber(call.step, language)} · ${status} · ${timing}`;
    return `<circle class="tool-trace-point${call.status === "failed" ? " failed" : ""}" data-trace-call-id="${escapeHtml(call.id)}" cx="${xForStep(call.step)}" cy="${center}" r="${radiusFor(duration)}" tabindex="0" aria-label="${escapeHtml(pointLabel)}"><title>${renderVisibleText(pointLabel, language)}</title></circle>`;
  }).join("");
  const tickMarkup = ticks.map((tick) => `<text class="tool-trace-tick" x="${xForStep(tick)}" y="${laneAreaHeight + 20}" text-anchor="middle">${formatNumber(tick, language)}</text>`).join("");

  return `<svg class="tool-trace-svg" data-tool-trace-chart="${escapeHtml(alias)}" width="${viewWidth}" height="${chartHeight}" viewBox="0 0 ${viewWidth} ${chartHeight}" role="img" aria-label="${escapeHtml(ariaLabel)}">
    <title>${renderVisibleText(ariaLabel, language)}</title>
    <desc>${renderVisibleText(copy(language, "Bubble area represents observed latency; equal small bubbles have no observed duration.", "气泡面积表示观测延迟；相同的小气泡表示未观察到时长。"), language)}</desc>
    ${laneMarkup}${gridMarkup}${pointMarkup}
    <line class="tool-trace-axis-line" x1="${labelWidth}" x2="${plotRight + 9}" y1="${laneAreaHeight}" y2="${laneAreaHeight}"></line>
    <text class="tool-trace-axis-label" x="${labelWidth - 12}" y="${laneAreaHeight + 20}" text-anchor="end">${renderVisibleText(copy(language, "Tool-call step", "工具调用序号"), language)}</text>
    ${tickMarkup}
  </svg>`;
}

function renderLongSessionTraces(summary, language) {
  const usage = summary?.usageEfficiency ?? {};
  const longSessions = usage?.longSessions ?? {};
  const samples = list(longSessions.samples);
  if (samples.length === 0) return "";
  const estimate = longSessions.estimate ?? {};
  const analyzed = usage?.selection?.analyzedSessionCount ?? 0;
  const threshold = estimate.activeThresholdMinutes ?? 45;

  return `<div class="long-session-review" data-long-session-review>
    <div class="long-session-heading">
      <div><span class="label">${renderVisibleText(copy(language, "Long-session review", "长会话复核"), language)}</span><h3>${renderVisibleText(copy(language, `${samples.length} long sessions need review`, `${samples.length} 个长会话待复核`), language)}</h3></div>
      <p>${renderVisibleText(copy(language, `${samples.length} of ${formatNumber(analyzed, language)} analyzed sessions crossed the ${formatNumber(threshold, language)}-minute estimate threshold.`, `${formatNumber(analyzed, language)} 个已分析会话中有 ${samples.length} 个超过 ${formatNumber(threshold, language)} 分钟估算阈值。`), language)}</p>
    </div>
    <div class="long-session-list">${samples.map((sample, index) => {
      const alias = String(sample?.alias ?? `S${index + 1}`);
      const calls = list(sample?.toolTrace?.calls);
      const totalCalls = Math.max(number(sample?.toolTrace?.totalCalls), ...calls.map((call) => number(call?.step)), 0);
      const observedCount = calls.filter((call) => observedToolDuration(call) !== null).length;
      const failures = Math.max(0, number(sample?.failureCount));
      const sessionId = String(sample?.sessionId ?? "").trim();
      const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sessionId) ? sessionId : "";
      const request = String(sample?.userRequest ?? "").trim()
        || copy(language, "Unavailable after privacy filtering", "经隐私过滤后不可用");
      return `<article class="long-session-card" data-long-session-alias="${escapeHtml(alias)}">
        <div class="long-session-meta">
          <div class="long-session-tags"><strong>${renderVisibleText(alias, language)}</strong><span class="pill neutral">${renderVisibleText(longSessionRoleLabel(sample?.role, language), language)}</span><span>${renderVisibleText(copy(language, `${formatNumber(sample?.activeMinutes, language)} active min`, `${formatNumber(sample?.activeMinutes, language)} 活跃分钟`), language)}</span><span class="pill ${failures > 0 ? "warning" : "neutral"}">${renderVisibleText(copy(language, `${formatNumber(failures, language)} failures`, `${formatNumber(failures, language)} 个失败事件`), language)}</span></div>
          <span>${renderVisibleText(copy(language, `Showing ${formatNumber(calls.length, language)} of ${formatNumber(totalCalls, language)} tool calls`, `显示 ${formatNumber(calls.length, language)} / ${formatNumber(totalCalls, language)} 个工具调用`), language)}</span>
        </div>
        <p class="long-session-request"><span>${renderVisibleText(copy(language, "Request", "用户请求"), language)}</span>${renderVisibleText(request, language)}</p>
        ${safeSessionId ? `<p class="long-session-locator"><span>${renderVisibleText(copy(language, "Session", "会话"), language)}</span><code data-session-locator="${escapeHtml(safeSessionId)}">${escapeHtml(safeSessionId)}</code></p>` : ""}
        <details class="tool-trace-details">
          <summary><span>${renderVisibleText(copy(language, "Tool-call chart", "工具调用图表"), language)}</span><small>${renderVisibleText(copy(language, `${formatNumber(observedCount, language)} of ${formatNumber(calls.length, language)} calls have observed latency`, `${formatNumber(observedCount, language)} / ${formatNumber(calls.length, language)} 个调用有观测延迟`), language)}</small></summary>
          <div class="tool-trace-body">
            <div class="tool-trace-scroll" tabindex="0" aria-label="${escapeHtml(copy(language, `${alias} horizontally scrollable tool-call chart`, `${alias} 可横向滚动的工具调用图表`))}">${renderToolTraceSvg(sample, language)}</div>
            <p>${renderVisibleText(copy(language, `Observed latency for ${formatNumber(observedCount, language)} of ${formatNumber(calls.length, language)} shown calls; bubble area scales with observed latency.`, `已观察到 ${formatNumber(observedCount, language)} / ${formatNumber(calls.length, language)} 个调用的延迟；气泡面积随观测延迟变化。`), language)}</p>
          </div>
        </details>
      </article>`;
    }).join("")}</div>
    ${Number.isFinite(number(estimate.gapCapMinutes, NaN)) && Number.isFinite(number(estimate.idleGapMinutes, NaN)) ? `<p class="long-session-boundary">${renderVisibleText(copy(language, `Estimate boundary: event gaps are capped at ${formatNumber(estimate.gapCapMinutes, language)} minutes and gaps over ${formatNumber(estimate.idleGapMinutes, language)} minutes are treated as idle.`, `估算边界：事件间隔最多计 ${formatNumber(estimate.gapCapMinutes, language)} 分钟，超过 ${formatNumber(estimate.idleGapMinutes, language)} 分钟按空闲处理。`), language)}</p>` : ""}
  </div>`;
}

function renderUsageLists(summary, language) {
  const activity = summary?.usageActivity ?? {};
  const usage = summary?.usageEfficiency ?? {};
  const modelRows = list(usage?.modelUsage).length ? list(usage.modelUsage) : list(activity.models);
  const skillRows = list(activity.skills);
  const renderRows = (rows, labelKey) => {
    const top = rows.slice().sort((a, b) => number(b.total ?? b.responseCount) - number(a.total ?? a.responseCount)).slice(0, 6);
    const max = Math.max(1, ...top.map((row) => number(row.total ?? row.responseCount)));
    if (top.length === 0) return `<p class="empty">${renderVisibleText(copy(language, "No attributed rows were retained.", "没有保留已归属数据。"), language)}</p>`;
    return `<div class="usage-list">${top.map((row) => {
      const value = number(row.total ?? row.responseCount);
      return `<div class="usage-row"><span>${renderVisibleText(row[labelKey] ?? row.name ?? "Unknown", language)}</span><i><b style="width:${clamp((value / max) * 100)}%"></b></i><strong>${formatNumber(value, language)}</strong></div>`;
    }).join("")}</div>`;
  };
  return `<div class="two-column">
    <article class="subpanel"><h3>${renderVisibleText(copy(language, "Model usage", "模型使用"), language)}</h3>${renderRows(modelRows, "model")}</article>
    <article class="subpanel"><h3>${renderVisibleText(copy(language, "Skill usage", "Skill 使用"), language)}</h3>${renderRows(skillRows, "name")}</article>
  </div>`;
}

function renderFindings(reportData, language) {
  const dimensions = new Map(list(reportData.summary?.dimensions).map((row) => [row.id, row.label ?? row.id]));
  const findings = list(reportData.findings);
  if (findings.length === 0) return `<p class="empty">${renderVisibleText(copy(language, "No reviewed findings were retained.", "没有保留已复核 finding。"), language)}</p>`;
  return `<div class="finding-list">${findings.map((row, index) => {
    const actionable = hasAiFixPrompt(row);
    const prompt = findingPromptParts(row.aiFixPrompt, language);
    const expected = textLines(row.expectedOutput ?? row.expectedOutcome);
    const refs = list(row.dimensionRefs).map((ref) => dimensions.get(ref) ?? ref);
    const findingId = String(row.id ?? index);
    const title = row.title ?? row.id ?? copy(language, "Finding", "Finding");
    const dialogId = `finding-dialog-${index + 1}`;
    const dialogTitleId = `${dialogId}-title`;
    const copyLabel = copy(language, "Copy AI Fix", "复制 AI 修复");
    const detailsLabel = copy(language, "View details", "查看详情");
    const closeLabel = copy(language, "Close", "关闭");
    return `<article class="finding-card" data-finding-id="${escapeHtml(findingId)}">
      <div class="finding-card-main">
        <div class="finding-meta">
          <span class="pill ${severityTone(row.severity)}">${renderVisibleText(row.severity ?? "Low", language)}</span>
          ${refs[0] ? `<span class="pill neutral">${renderVisibleText(refs[0], language)}</span>` : ""}
        </div>
        <h3>${renderVisibleText(title, language)}</h3>
        <p class="finding-preview">${renderVisibleText(row.reason ?? "", language)}</p>
      </div>
      <div class="finding-actions">
        ${actionable ? `<button type="button" class="action-button secondary" data-copy-finding="${escapeHtml(findingId)}" aria-label="${escapeHtml(`${copyLabel}: ${title}`)}">${renderVisibleText(copyLabel, language)}</button>` : ""}
        <button type="button" class="action-button ghost" data-view-finding-dialog="${dialogId}" aria-label="${escapeHtml(`${detailsLabel}: ${title}`)}">${renderVisibleText(detailsLabel, language)}</button>
      </div>
      <dialog class="finding-dialog" id="${dialogId}" data-finding-dialog-id="${escapeHtml(findingId)}" aria-labelledby="${dialogTitleId}">
        <div class="dialog-heading">
          <div><span class="label">${renderVisibleText(copy(language, "Finding details", "Finding 详情"), language)}</span><h3 id="${dialogTitleId}">${renderVisibleText(title, language)}</h3></div>
          <span class="pill ${severityTone(row.severity)}">${renderVisibleText(row.severity ?? "Low", language)}</span>
        </div>
        <div class="dialog-section"><span class="label">${renderVisibleText(copy(language, "Cause", "原因"), language)}</span><p>${renderVisibleText(row.reason ?? "", language)}</p></div>
        ${expected.length ? `<div class="dialog-section"><span class="label">${renderVisibleText(copy(language, "Expected Output", "预期结果"), language)}</span><ol>${expected.map((item) => `<li>${renderVisibleText(item, language)}</li>`).join("")}</ol></div>` : ""}
        ${prompt.checks.length ? `<div class="dialog-section"><span class="label">${renderVisibleText(copy(language, "Acceptance Checks", "验收检查"), language)}</span><ul>${prompt.checks.map((item) => `<li>${renderVisibleText(item, language)}</li>`).join("")}</ul></div>` : ""}
        <div class="dialog-actions">
          ${actionable ? `<button type="button" class="action-button secondary" data-copy-finding="${escapeHtml(findingId)}" aria-label="${escapeHtml(`${copyLabel}: ${title}`)}">${renderVisibleText(copyLabel, language)}</button>` : ""}
          <button type="button" class="action-button ghost" data-close-finding-dialog="${dialogId}">${renderVisibleText(closeLabel, language)}</button>
        </div>
      </dialog>
    </article>`;
  }).join("\n")}</div>`;
}

function renderSuggestions(summary, language) {
  const suggestions = list(summary?.suggestions);
  if (suggestions.length === 0) return "";
  return `<div class="suggestion-block">
    <div class="suggestion-heading"><div><span class="label">${renderVisibleText(copy(language, "Suggestions", "建议"), language)}</span><h3>${renderVisibleText(copy(language, "Useful next experiments", "值得尝试的下一步"), language)}</h3></div><p>${renderVisibleText(copy(language, "Advisory only · no AI Fix action", "仅供参考 · 不包含 AI 修复动作"), language)}</p></div>
    <div class="suggestion-list">${suggestions.map((row, index) => {
      const prerequisites = textLines(row.prerequisites);
      const blockedBy = textLines(row.blockedBy);
      return `<article class="suggestion" data-suggestion-id="${escapeHtml(row.id ?? index)}">
        <div class="suggestion-top"><span class="pill accent">${renderVisibleText(suggestionKindLabel(row.kind, language), language)}</span><span class="pill neutral">${renderVisibleText(row.confidence, language)}</span></div>
        <h3>${renderVisibleText(row.title ?? row.id ?? copy(language, "Suggestion", "建议"), language)}</h3>
        <p>${renderVisibleText(row.reason, language)}</p>
        <dl>
          <div><dt>${renderVisibleText(copy(language, "Owner", "负责人"), language)}</dt><dd>${renderVisibleText(row.owner, language)}</dd></div>
          <div><dt>${renderVisibleText(copy(language, "Next step", "下一步"), language)}</dt><dd>${renderVisibleText(row.nextStep, language)}</dd></div>
          <div><dt>${renderVisibleText(copy(language, "Validation", "验证"), language)}</dt><dd>${renderVisibleText(row.validation, language)}</dd></div>
          ${prerequisites.length ? `<div><dt>${renderVisibleText(copy(language, "Prerequisites", "前置条件"), language)}</dt><dd>${prerequisites.map((item) => renderVisibleText(item, language)).join(" · ")}</dd></div>` : ""}
          ${blockedBy.length ? `<div><dt>${renderVisibleText(copy(language, "Blocked by", "阻塞项"), language)}</dt><dd>${blockedBy.map((item) => renderVisibleText(item, language)).join(" · ")}</dd></div>` : ""}
        </dl>
      </article>`;
    }).join("\n")}</div>
  </div>`;
}

function renderCustomize(summary, language) {
  const practice = summary?.aiAgentPractice ?? {};
  const inspected = new Set(list(practice.inspectedSurfaces));
  const rows = list(practice.coverageRows);
  const bySurface = new Map(rows.map((row) => [row.surface, row]));
  const surfaces = [...new Set([...inspected, ...rows.map((row) => row.surface).filter(Boolean)])];
  if (surfaces.length === 0) return `<p class="empty">${renderVisibleText(copy(language, "No project customization inventory was retained.", "没有保留项目自定义能力清单。"), language)}</p>`;
  return `<div class="custom-grid">${surfaces.map((surface) => {
    const row = bySurface.get(surface) ?? {};
    const scopes = list(row.scopes);
    const count = row.count;
    return `<article><span class="custom-mark">${renderVisibleText(String(surface).slice(0, 1).toUpperCase(), language)}</span><div><h3>${renderVisibleText(surface, language)}</h3><p>${scopes.length ? renderVisibleText(scopes.join(" · "), language) : renderVisibleText(copy(language, "Inspected", "已检查"), language)}${count !== undefined ? ` · ${formatNumber(count, language)}` : ""}</p></div></article>`;
  }).join("")}</div>`;
}

function renderEvidence(summary, language) {
  const boundary = summary?.evidenceBoundary ?? {};
  const coverage = boundary?.episodeCoverage ?? summary?.atAGlance?.coverage ?? {};
  const selection = boundary?.manifest?.selection ?? coverage?.selection ?? {};
  const learning = summary?.learningCapture ?? {};
  const facts = [
    [copy(language, "Evidence mode", "证据模式"), summary?.evidenceMode ?? "—"],
    [copy(language, "Task episodes", "任务 Episode"), coverage.episodeCount ?? 0],
    [copy(language, "Edited episodes", "含编辑 Episode"), coverage.editedEpisodeCount ?? 0],
    [copy(language, "Sampling", "抽样"), `${selection.analyzedCount ?? 0} / ${selection.eligibleCount ?? 0}`],
    [copy(language, "Confidence", "可信度"), selection.confidence ?? "—"],
    [copy(language, "Learning state", "学习状态"), learning.state ?? "—"],
  ];
  const gaps = textLines(boundary.sourceGaps);
  return `<div class="evidence-grid">${facts.map(([label, value]) => `<div><span>${renderVisibleText(label, language)}</span><strong>${renderVisibleText(value, language)}</strong></div>`).join("")}</div>
    ${gaps.length ? `<div class="evidence-note"><strong>${renderVisibleText(copy(language, "Source gaps", "来源缺口"), language)}</strong><ul>${gaps.map((gap) => `<li>${renderVisibleText(gap, language)}</li>`).join("")}</ul></div>` : ""}
    <p class="method-note">${renderVisibleText(copy(language,
      "Activity totals describe volume, not quality or savings. Fluency conclusions come from the reviewed task sample and remain bounded by the retained evidence.",
      "活动总量只描述用量，不直接代表质量、效率或节省。流畅度结论来自已复核任务样本，并受已保留证据边界约束。"), language)}</p>`;
}

function renderHtmlBody(reportData) {
  const language = reportData.language;
  const summary = reportData.summary ?? {};
  const projectName = summary.projectName ?? reportData.target?.name ?? copy(language, "Project", "项目");
  const dimensions = list(summary.dimensions);
  const findings = list(reportData.findings);
  const taskLoopReport = isAgentWorkLoopReport(reportData);
  const suggestions = taskLoopReport ? list(summary.suggestions) : [];
  const high = findings.filter((row) => ["Critical", "High"].includes(row.severity)).length;
  const medium = findings.filter((row) => row.severity === "Medium").length;
  const overview = summary.overview ?? summary.strengths?.[0] ?? copy(language, "Reviewed Harness evidence is ready for inspection.", "已复核的 Harness 证据可供检查。" );
  const coverage = summary.atAGlance?.coverage ?? {};
  const selection = summary.usageEfficiency?.selection ?? coverage.selection ?? {};
  const analyzed = selection.analyzedSessionCount ?? selection.analyzedCount ?? 0;
  const eligible = selection.eligibleSessionCount ?? selection.eligibleCount ?? summary.usageActivity?.sessions?.total ?? 0;
  const hasUsage = summary.usageActivity !== undefined || summary.usageEfficiency !== undefined;
  const effectiveness = loopEffectiveness(dimensions);
  const progress = repairProgress(findings);

  return `<header class="hero" data-section="overview">
    <div class="hero-copy">
      <span class="eyebrow">${renderVisibleText(copy(language, "Harness Insights · Portable HTML", "Harness 洞察 · 便携式 HTML"), language)}</span>
      <h1>${renderVisibleText(projectName, language)}</h1>
      <p>${renderVisibleText(overview, language)}</p>
      <div class="hero-tags"><span class="pill accent">${renderVisibleText(summary.modelId ?? "Harness", language)}</span><span class="pill muted">${renderVisibleText(copy(language, "Evidence-bound", "证据有界"), language)}</span></div>
    </div>
    <div class="score-orbit"><strong>${dimensions.length}</strong><span>${renderVisibleText(copy(language, "reviewed dimensions", "独立复核维度"), language)}</span></div>
  </header>
  <div class="metrics">
    ${metric(evidenceScoreLabel(summary, language), `${effectiveness} / 100`, copy(language, "Changes after later task outcomes", "等待后续任务结果后更新"), language)}
    ${metric(copy(language, "Asset Health / Repair Progress", "资产健康 / 修复进度"), `${progress.score} / 100`, copy(language, `${progress.verified} verified · ${progress.partial} partial · ${progress.pending} pending`, `${progress.verified} 项已验证 · ${progress.partial} 项部分完成 · ${progress.pending} 项待处理`), language)}
    ${metric(copy(language, "Sessions analyzed", "会话样本"), `${formatNumber(analyzed, language)} / ${formatNumber(eligible, language)}`, selection.confidence ?? "", language)}
    ${metric(copy(language, "Findings", "待处理 Finding"), findings.length, `${high} High · ${medium} Medium`, language)}
  </div>
  ${section("fluency", copy(language, "01 · Readiness", "01 · 就绪度"), copy(language, "Five-dimension fluency", "五维流畅度"), renderDimensionGrid(summary, language), copy(language, "Scores and states come from the reviewed source.", "分数与状态来自已复核 source。"), language)}
  ${hasUsage ? section("activity", copy(language, "02 · Signals", "02 · 信号"), copy(language, "Project usage", "项目用量"), `${renderActivity(summary, language)}${renderLongSessionTraces(summary, language)}${renderUsageLists(summary, language)}`, copy(language, "Volume is context, not an outcome claim.", "用量是背景，不是结果结论。"), language) : ""}
  ${section("findings", copy(language, "03 · Action", "03 · 行动"), copy(language, "Findings and recommendations", "Finding 与建议"), `${renderFindings(reportData, language)}${suggestions.length ? renderSuggestions(summary, language) : ""}`, taskLoopReport ? copy(language, `${findings.length} findings · ${suggestions.length} suggestions`, `${findings.length} 条 finding · ${suggestions.length} 条建议`) : copy(language, `${findings.length} reviewed items`, `${findings.length} 条已复核项`), language)}
  ${section("customize", copy(language, "04 · Capability", "04 · 能力"), copy(language, "Agent Customize", "Agent 自定义"), renderCustomize(summary, language), copy(language, "Inspected project and authorized host surfaces.", "已检查的项目与授权宿主能力面。"), language)}
  ${section("methodology", copy(language, "05 · Boundary", "05 · 边界"), copy(language, "Evidence and methodology", "证据与方法"), renderEvidence(summary, language), copy(language, "Reader-safe evidence only.", "仅使用读者安全证据。"), language)}`;
}

export function renderHtml(reportData, actionContext) {
  const language = reportData.language === "zh-CN" ? "zh-CN" : "en";
  const title = copy(reportData.language, "Harness Insights", "Harness 洞察");
  const reportActions = buildHtmlReportActions(reportData, actionContext);
  const interactionData = buildHtmlInteractionData(reportData);
  return `<!doctype html>
<html lang="${language}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="better-harness codex-html">
  <title>${escapeHtml(title)} · ${escapeHtml(reportData.target?.name ?? "Project")}</title>
  <style>
    :root { color-scheme: dark; --bg:#111315; --panel:#1a1d20; --panel-2:#21252a; --line:#31363d; --text:#f5f7fa; --muted:#9aa3ad; --blue:#6cb8ff; --blue-2:#1b6ca8; --orange:#ff9a5a; --green:#53d69b; --red:#ff6b6b; }
    * { box-sizing:border-box; }
    html { background:var(--bg); scroll-behavior:smooth; }
    .cjk-phrase { white-space:nowrap; }
    body { margin:0; min-width:320px; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--text); background:radial-gradient(circle at 12% -10%,#22364a 0,transparent 34rem),var(--bg); line-height:1.55; }
    .sr-only { position:absolute!important; width:1px!important; height:1px!important; padding:0!important; margin:-1px!important; overflow:hidden!important; clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.22; background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px); background-size:28px 28px; }
    main { position:relative; width:min(1180px,calc(100% - 40px)); margin:0 auto; padding:52px 0 88px; }
    h1,h2,h3,p { margin-top:0; }
    .eyebrow,.label { color:var(--blue); font-size:12px; font-weight:700; letter-spacing:.11em; text-transform:uppercase; }
    .hero { display:grid; grid-template-columns:minmax(0,1fr) 190px; gap:36px; align-items:end; min-height:270px; padding:42px; border:1px solid var(--line); border-radius:28px; background:linear-gradient(135deg,rgba(36,43,51,.96),rgba(21,24,27,.94)); box-shadow:0 28px 70px rgba(0,0,0,.28); }
    .hero h1 { margin:12px 0 10px; font-size:clamp(42px,7vw,82px); line-height:.96; letter-spacing:-.055em; }
    .hero p { max-width:760px; margin-bottom:22px; color:#c9d0d8; font-size:18px; }
    .hero-tags { display:flex; flex-wrap:wrap; gap:8px; }
    .score-orbit { width:174px; aspect-ratio:1; display:grid; place-content:center; text-align:center; border:14px solid #343a41; border-top-color:var(--blue); border-right-color:var(--blue-2); border-radius:50%; background:#1a2026; box-shadow:inset 0 0 0 1px var(--line); }
    .score-orbit strong { font-size:44px; line-height:1; }
    .score-orbit > span { width:110px; margin-top:7px; color:var(--muted); font-size:12px; }
    .pill { display:inline-flex; align-items:center; min-height:26px; padding:3px 10px; border-radius:999px; color:#d4dae0; background:#30353b; font-size:12px; font-weight:700; }
    .pill.accent { color:#c9e8ff; background:#164e75; }.pill.good { color:#c9f9e5; background:#165c43; }.pill.warning { color:#ffe1c8; background:#754322; }.pill.danger { color:#ffd4d4; background:#762e31; }.pill.muted,.pill.neutral { color:#c8cdd3; background:#34383d; }
    .metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin:18px 0 54px; }
    .metric { min-height:126px; padding:22px 24px; border:1px solid var(--line); border-radius:20px; background:rgba(30,34,38,.9); }
    .metric > span,.metric > small { display:block; color:var(--muted); }.metric > strong { display:block; margin:5px 0 2px; font-size:34px; line-height:1.1; }.metric > small { font-size:12px; }
    .section { margin-top:64px; scroll-margin-top:24px; }.section-heading { display:flex; justify-content:space-between; gap:30px; align-items:end; margin-bottom:20px; }.section-heading h2 { margin:5px 0 0; font-size:30px; letter-spacing:-.025em; }.section-heading > p { max-width:420px; margin:0; color:var(--muted); text-align:right; font-size:14px; }
    .dimension-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }.dimension-card { min-height:230px; padding:19px; border:1px solid var(--line); border-radius:19px; background:linear-gradient(180deg,var(--panel-2),var(--panel)); }.dimension-top { display:flex; min-height:52px; justify-content:space-between; gap:8px; align-items:flex-start; font-weight:700; }.score-line { display:flex; align-items:baseline; gap:4px; margin-top:14px; }.score-line strong { font-size:34px; }.score-line span { color:var(--muted); font-size:12px; }.track { height:8px; margin:8px 0 16px; overflow:hidden; border-radius:999px; background:#30353a; }.track i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,var(--blue-2),var(--blue)); }.dimension-card p { margin:0; color:var(--muted); font-size:13px; }
    .activity-layout { display:grid; grid-template-columns:minmax(0,1.8fr) minmax(230px,.7fr); gap:14px; }.activity-panel,.subpanel,.finding,.custom-grid article,.evidence-grid,.evidence-note { border:1px solid var(--line); border-radius:19px; background:var(--panel); }.activity-panel { display:flex; min-width:0; flex-direction:column; justify-content:center; padding:22px; overflow:hidden; }.heat-scroll { width:100%; min-width:0; overflow-x:auto; padding-bottom:8px; }.heatmap,.heat-axis { display:grid; grid-template-columns:repeat(var(--heat-days),minmax(13px,1fr)); column-gap:4px; min-width:var(--heat-min-width); }.heatmap { align-items:center; }.heat-cell { width:13px; height:13px; justify-self:center; border-radius:3px; background:#2b3035; }.heat-cell.l1{background:#174d70}.heat-cell.l2{background:#206f9e}.heat-cell.l3{background:#319bd1}.heat-cell.l4{background:#70c9ff}.heat-axis { margin-top:10px; color:var(--muted); font-size:10px; }.heat-tick { justify-self:center; white-space:nowrap; }.heat-tick.first { justify-self:start; }.heat-tick.last { justify-self:end; }.heatmap-empty { color:var(--muted); }.stacked-metrics { display:grid; gap:14px; }.stacked-metrics .metric { min-height:0; }
    .long-session-review { margin-top:14px; padding:22px; border:1px solid var(--line); border-radius:19px; background:linear-gradient(180deg,#201f1d,var(--panel)); }.long-session-heading { display:flex; justify-content:space-between; gap:24px; align-items:end; }.long-session-heading h3 { margin:4px 0 0; font-size:20px; }.long-session-heading > p { max-width:520px; margin:0; color:var(--muted); text-align:right; font-size:12px; }.long-session-list { display:grid; gap:12px; margin-top:18px; }.long-session-card { min-width:0; padding:17px; overflow:hidden; border:1px solid var(--line); border-radius:16px; background:#181b1e; }.long-session-meta { display:flex; justify-content:space-between; gap:16px; align-items:center; color:var(--muted); font-size:12px; }.long-session-tags { min-width:0; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }.long-session-tags strong { color:var(--text); font-size:15px; }.long-session-request,.long-session-locator { display:grid; grid-template-columns:72px minmax(0,1fr); gap:10px; margin:12px 0 0; color:#d2d8df; overflow-wrap:anywhere; font-size:13px; }.long-session-request > span,.long-session-locator > span { color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }.long-session-locator code { min-width:0; overflow:hidden; color:#bfe3ff; text-overflow:ellipsis; white-space:nowrap; }.tool-trace-details { margin-top:14px; border-top:1px solid var(--line); }.tool-trace-details summary { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:13px 2px 0; color:#dce5ed; cursor:pointer; font-size:13px; font-weight:700; }.tool-trace-details summary small { color:var(--muted); font-weight:400; text-align:right; }.tool-trace-details summary:focus-visible,.tool-trace-scroll:focus-visible { outline:2px solid var(--blue); outline-offset:3px; }.tool-trace-body { padding-top:12px; }.tool-trace-scroll { width:100%; max-width:100%; overflow-x:auto; padding-bottom:8px; overscroll-behavior-inline:contain; }.tool-trace-svg { display:block; max-width:none; color:#d6dde5; overflow:visible; }.tool-trace-row-alt { fill:currentColor; opacity:.035; }.tool-trace-lane-line { stroke:currentColor; stroke-dasharray:3 5; opacity:.22; }.tool-trace-grid-line { stroke:currentColor; opacity:.12; }.tool-trace-axis-line { stroke:currentColor; opacity:.25; }.tool-trace-lane-label,.tool-trace-tick,.tool-trace-axis-label { fill:currentColor; font-size:11px; opacity:.68; }.tool-trace-axis-label { font-weight:700; }.tool-trace-point { fill:#64748b; stroke:currentColor; stroke-width:1; }.tool-trace-point.failed { fill:var(--orange); }.tool-trace-point:focus { outline:none; stroke:var(--blue); stroke-width:3; }.tool-trace-body > p,.long-session-boundary { margin:4px 0 0; color:var(--muted); font-size:12px; }.tool-trace-empty { min-width:680px; margin:0; padding:24px; border:1px dashed var(--line); border-radius:12px; }.long-session-boundary { margin-top:14px; }
    .two-column { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px; }.subpanel { padding:22px; }.subpanel h3 { font-size:15px; }.usage-list { display:grid; gap:12px; }.usage-row { display:grid; grid-template-columns:minmax(100px,.75fr) 1fr 52px; gap:12px; align-items:center; font-size:12px; }.usage-row > span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.usage-row i { height:7px; overflow:hidden; border-radius:999px; background:#30353a; }.usage-row b { display:block; height:100%; background:linear-gradient(90deg,var(--blue-2),var(--blue)); }.usage-row strong { text-align:right; }
    .finding-list { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }.finding-card { min-width:0; min-height:220px; display:flex; flex-direction:column; padding:18px; border:1px solid var(--line); border-radius:19px; background:linear-gradient(180deg,#1c2329,var(--panel)); }.finding-card-main { display:grid; gap:10px; }.finding-meta { display:flex; flex-wrap:wrap; gap:7px; }.finding-card h3 { min-height:2.8em; margin:0; display:-webkit-box; overflow:hidden; font-size:17px; line-height:1.4; -webkit-box-orient:vertical; -webkit-line-clamp:2; }.finding-preview { margin:0; color:#c7ced6; display:-webkit-box; overflow:hidden; font-size:13px; line-height:1.55; -webkit-box-orient:vertical; -webkit-line-clamp:2; }.finding-actions,.dialog-actions { display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px; margin-top:auto; padding-top:16px; }.action-button { min-height:38px; padding:8px 13px; border:1px solid transparent; border-radius:10px; color:var(--text); background:#30363d; font:inherit; font-size:13px; font-weight:700; cursor:pointer; }.action-button:hover { filter:brightness(1.12); }.action-button:focus-visible { outline:2px solid var(--blue); outline-offset:2px; }.action-button.secondary { color:#cceaff; border-color:#286d9b; background:#164e75; }.action-button.ghost { color:#d4dae0; border-color:var(--line); background:transparent; }.finding-dialog,.manual-copy-dialog { width:min(880px,calc(100vw - 32px)); max-height:calc(100vh - 32px); overflow:auto; padding:24px; border:1px solid var(--line); border-radius:20px; color:var(--text); background:var(--panel); box-shadow:0 30px 90px rgba(0,0,0,.55); }.finding-dialog::backdrop,.manual-copy-dialog::backdrop { background:rgba(4,8,12,.72); }.dialog-heading { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; }.dialog-heading h3 { margin:6px 0 0; font-size:24px; }.dialog-section { margin-top:18px; }.dialog-section p { margin:7px 0 0; color:#d1d7de; }.dialog-section ol,.dialog-section ul { margin:8px 0 0; padding-left:22px; color:#d1d7de; }.manual-copy-dialog textarea { width:100%; min-height:260px; margin-top:14px; padding:14px; resize:vertical; border:1px solid var(--line); border-radius:12px; color:var(--text); background:#11161b; font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }.no-js .finding-actions,.no-js .manual-copy-dialog { display:none!important; }.no-js .finding-dialog:not([open]) { display:block; position:static; width:auto; max-height:none; margin-top:16px; box-shadow:none; }
    .suggestion-block { margin-top:28px; padding-top:24px; border-top:1px solid var(--line); }.suggestion-heading { display:flex; justify-content:space-between; gap:20px; align-items:end; margin-bottom:14px; }.suggestion-heading h3 { margin:4px 0 0; font-size:20px; }.suggestion-heading p { margin:0; color:var(--muted); font-size:12px; }.suggestion-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; }.suggestion { padding:18px; border:1px solid var(--line); border-radius:17px; background:linear-gradient(180deg,#1b252d,var(--panel)); }.suggestion-top { display:flex; justify-content:space-between; gap:8px; }.suggestion h3 { margin:13px 0 7px; font-size:16px; }.suggestion > p { color:#c7ced6; font-size:13px; }.suggestion dl { display:grid; gap:9px; margin:14px 0 0; }.suggestion dl div { display:grid; gap:2px; }.suggestion dt { color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }.suggestion dd { margin:0; color:#d7dde4; font-size:12px; }
    .custom-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }.custom-grid article { display:flex; gap:14px; align-items:center; padding:18px; }.custom-grid h3 { margin:0; font-size:15px; }.custom-grid p { margin:3px 0 0; color:var(--muted); font-size:12px; }.custom-mark { display:grid; flex:0 0 38px; aspect-ratio:1; place-content:center; border-radius:12px; color:#d9efff; background:#164e75; font-weight:800; }
    .evidence-grid { display:grid; grid-template-columns:repeat(3,1fr); overflow:hidden; }.evidence-grid div { padding:20px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }.evidence-grid > div > span,.evidence-grid > div > strong { display:block; }.evidence-grid > div > span { color:var(--muted); font-size:12px; }.evidence-grid > div > strong { margin-top:4px; }.evidence-note { margin-top:14px; padding:20px; }.method-note,.empty { color:var(--muted); }.method-note { max-width:800px; margin:18px 0 0; font-size:13px; }
    footer { margin-top:64px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    @media (max-width:1000px) { .finding-list{grid-template-columns:repeat(2,minmax(0,1fr))} }
    @media (max-width:900px) { .metrics,.dimension-grid{grid-template-columns:repeat(2,1fr)}.activity-layout,.two-column{grid-template-columns:1fr}.evidence-grid{grid-template-columns:repeat(2,1fr)} }
    @media (max-width:680px) { .finding-list{grid-template-columns:1fr}.finding-card{min-height:0} }
    @media (max-width:620px) { main{width:min(100% - 24px,1180px);padding-top:18px}.hero{grid-template-columns:1fr;min-height:0;padding:25px;border-radius:22px}.hero h1{font-size:44px}.hero p{font-size:15px}.score-orbit{width:126px}.score-orbit strong{font-size:34px}.metrics{grid-template-columns:1fr;margin-bottom:42px}.metric{min-height:0}.section{margin-top:46px}.section-heading,.suggestion-heading,.long-session-heading{display:block}.section-heading > p,.suggestion-heading > p,.long-session-heading > p{text-align:left;margin-top:8px}.dimension-grid{grid-template-columns:1fr}.dimension-card{min-height:0}.evidence-grid{grid-template-columns:1fr}.usage-row{grid-template-columns:minmax(92px,.7fr) 1fr 44px}.long-session-review{padding:15px}.long-session-meta,.tool-trace-details summary{align-items:flex-start;flex-direction:column}.long-session-request,.long-session-locator{grid-template-columns:1fr;gap:3px}.finding-dialog{padding:18px}.dialog-heading{display:grid} }
    @media print { :root{color-scheme:light;--bg:#fff;--panel:#fff;--panel-2:#f6f8fa;--line:#d8dee4;--text:#111;--muted:#59636e}body{background:#fff}body::before{display:none}.hero{box-shadow:none}.section{break-inside:avoid}.finding-list{display:block}.finding-card,.long-session-card{margin-bottom:16px;break-inside:avoid}.finding-actions,.dialog-actions,.manual-copy-dialog{display:none!important}.finding-dialog:not([open]),details.tool-trace-details:not([open]) > :not(summary){display:block!important;position:static;width:auto;max-height:none;margin-top:16px;box-shadow:none}.tool-trace-scroll{overflow:visible}.tool-trace-svg{width:100%;height:auto} }
  </style>
</head>
<body>
<div id="copy-status" class="sr-only" role="status" aria-live="polite"></div>
<main id="harness-report" data-report-mode="codex-html">
${renderHtmlBody(reportData)}
<footer>${renderVisibleText(copy(reportData.language, "Generated from one reviewed Harness source · self-contained portable HTML", "由同一份已复核 Harness source 生成 · 自包含便携式 HTML"), language)}</footer>
</main>
<dialog id="manual-copy-dialog" class="manual-copy-dialog" aria-labelledby="manual-copy-title" aria-describedby="manual-copy-description">
  <div class="dialog-heading">
    <div>
      <span class="label">${renderVisibleText(copy(reportData.language, "Manual fallback", "手动复制"), language)}</span>
      <h3 id="manual-copy-title">${renderVisibleText(copy(reportData.language, "Copy the AI Fix prompt", "复制 AI 修复提示词"), language)}</h3>
    </div>
  </div>
  <p id="manual-copy-description">${renderVisibleText(copy(reportData.language, "Automatic copy was blocked. The exact prompt is selected below.", "自动复制被阻止，下面已选中完整提示词。"), language)}</p>
  <textarea id="manual-copy-text" readonly aria-label="${copy(reportData.language, "AI Fix prompt", "AI 修复提示词")}"></textarea>
  <div class="dialog-actions">
    <button type="button" class="action-button ghost" data-close-finding-dialog="manual-copy-dialog">${renderVisibleText(copy(reportData.language, "Close", "关闭"), language)}</button>
  </div>
</dialog>
<script id="harness-report-data" type="application/json">${serializeForScript(interactionData)}</script>
<script id="harness-report-actions" type="application/json">${serializeForScript(reportActions)}</script>
${renderHtmlInteractionScript(reportData.language)}
</body>
</html>
`;
}

export function evaluateHtmlReport(htmlText, reportData, actionContext) {
  const text = String(htmlText ?? "");
  const errors = [];
  const warnings = [];
  const longSessionSamples = list(reportData?.summary?.usageEfficiency?.longSessions?.samples);
  const required = [
    ["doctype", /<!doctype html>/iu],
    ["viewport", /<meta\s+name="viewport"/iu],
    ["report landmark", /<main\s+id="harness-report"/iu],
    ["embedded report data", /<script\s+id="harness-report-data"\s+type="application\/json">/iu],
    ["embedded report actions", /<script\s+id="harness-report-actions"\s+type="application\/json">/iu],
    ["interaction controller", /<script\s+id="harness-report-interactions">/iu],
    ["copy status", /id="copy-status"[^>]+role="status"[^>]+aria-live="polite"/iu],
    ["manual copy fallback", /<dialog\s+id="manual-copy-dialog"/iu],
    ["manual copy text", /<textarea\s+id="manual-copy-text"/iu],
    ["overview", /data-section="overview"/u],
    ["fluency", /data-section="fluency"/u],
    ["findings", /data-section="findings"/u],
    ["customization", /data-section="customize"/u],
    ["methodology", /data-section="methodology"/u],
  ];
  if (reportData?.summary?.usageActivity !== undefined || reportData?.summary?.usageEfficiency !== undefined) {
    required.push(["activity", /data-section="activity"/u]);
  }
  if (longSessionSamples.length > 0) {
    required.push(
      ["long-session review", /data-long-session-review/u],
      ["long-session disclosure", /<details class="tool-trace-details">/u],
      ["long-session request", /class="long-session-request"/u],
      ["scrollable tool trace", /class="tool-trace-scroll" tabindex="0"/u],
    );
  }
  for (const [label, pattern] of required) {
    if (!pattern.test(text)) errors.push(`report.html is missing ${label}`);
  }
  const forbidden = [
    ["remote script", /<script[^>]+src=/iu],
    ["external stylesheet", /<link[^>]+(?:rel="stylesheet"|href=)/iu],
    ["remote asset URL", /(?:src|href)="https?:\/\//iu],
    ["network fetch", /\bfetch\s*\(/u],
    ["Canvas package import", /(?:from\s+["']qoder\/canvas["']|import\s*\(["']qoder\/canvas["']\))/u],
    ["host deep link", /(?:codex|chatgpt):\/\//iu],
  ];
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) errors.push(`report.html contains forbidden ${label}`);
  }
  if (longSessionSamples.length > 0) {
    const expectedCallCount = longSessionSamples.reduce((total, sample) => total + list(sample?.toolTrace?.calls).length, 0);
    const expectedChartCount = longSessionSamples.filter((sample) => list(sample?.toolTrace?.calls).length > 0).length;
    const expectedFailedCount = longSessionSamples.reduce((total, sample) =>
      total + list(sample?.toolTrace?.calls).filter((call) => call?.status === "failed").length, 0);
    const expectedLocatorCount = longSessionSamples.filter((sample) =>
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(String(sample?.sessionId ?? "").trim())).length;
    const actualCardCount = (text.match(/data-long-session-alias=/gu) ?? []).length;
    const actualDisclosureCount = (text.match(/<details class="tool-trace-details">/gu) ?? []).length;
    const actualScrollCount = (text.match(/class="tool-trace-scroll" tabindex="0"/gu) ?? []).length;
    const actualChartCount = (text.match(/data-tool-trace-chart=/gu) ?? []).length;
    const actualCallCount = (text.match(/data-trace-call-id=/gu) ?? []).length;
    const actualFailedCount = (text.match(/class="tool-trace-point failed"/gu) ?? []).length;
    const actualLocatorCount = (text.match(/data-session-locator=/gu) ?? []).length;
    const exactCounts = [
      ["long-session card", actualCardCount, longSessionSamples.length],
      ["long-session disclosure", actualDisclosureCount, longSessionSamples.length],
      ["long-session scroll surface", actualScrollCount, longSessionSamples.length],
      ["tool-trace chart", actualChartCount, expectedChartCount],
      ["tool-trace point", actualCallCount, expectedCallCount],
      ["failed tool-trace point", actualFailedCount, expectedFailedCount],
      ["session locator", actualLocatorCount, expectedLocatorCount],
    ];
    for (const [label, actual, expected] of exactCounts) {
      if (actual !== expected) errors.push(`report.html ${label} count ${actual} does not match reviewed long-session evidence ${expected}`);
    }
    for (const [index, sample] of longSessionSamples.entries()) {
      const alias = escapeHtml(String(sample?.alias ?? `S${index + 1}`));
      if (text.split(`data-long-session-alias="${alias}"`).length - 1 !== 1) {
        errors.push(`report.html long-session alias ${alias} must bind exactly one review card`);
      }
      if (list(sample?.toolTrace?.calls).length > 0
        && text.split(`data-tool-trace-chart="${alias}"`).length - 1 !== 1) {
        errors.push(`report.html long-session alias ${alias} must bind exactly one accessible SVG chart`);
      }
    }
  }
  const actionPayloadText = text.match(
    /<script\s+id="harness-report-actions"\s+type="application\/json">([\s\S]*?)<\/script>/iu,
  )?.[1];
  if (actionPayloadText !== undefined) {
    try {
      const actualActions = JSON.parse(actionPayloadText);
      const expectedActions = buildHtmlReportActions(reportData, actionContext);
      if (JSON.stringify(actualActions) !== JSON.stringify(expectedActions)) {
        errors.push("report.html finding action payload does not match the exact relative binding metadata");
      }
    } catch (error) {
      errors.push(`report.html finding action payload is invalid: ${error.message}`);
    }
  }
  const interactionPayloadText = text.match(
    /<script\s+id="harness-report-data"\s+type="application\/json">([\s\S]*?)<\/script>/iu,
  )?.[1];
  if (interactionPayloadText !== undefined) {
    try {
      const actualData = JSON.parse(interactionPayloadText);
      const expectedData = buildHtmlInteractionData(reportData);
      if (JSON.stringify(actualData) !== JSON.stringify(expectedData)) {
        errors.push("report.html interaction data does not match the minimal reviewed prompt projection");
      }
    } catch (error) {
      errors.push(`report.html interaction data is invalid: ${error.message}`);
    }
  }
  const interactionController = text.match(
    /<script\s+id="harness-report-interactions">([\s\S]*?)<\/script>/iu,
  )?.[1] ?? "";
  const forbiddenControllerCapabilities = [
    ["host bridge", /\bwindow\.openai\b/u],
    ["host deep link", /(?:codex|chatgpt):\/\//iu],
    ["dynamic import", /\bimport\s*\(/u],
    ["network transport", /\b(?:XMLHttpRequest|WebSocket)\b/u],
  ];
  for (const [label, pattern] of forbiddenControllerCapabilities) {
    if (pattern.test(interactionController)) {
      errors.push(`report.html interaction controller contains forbidden ${label}`);
    }
  }
  const findingRows = (text.match(/data-finding-id=/gu) ?? []).length;
  if (findingRows !== list(reportData?.findings).length) {
    errors.push(`report.html finding row count ${findingRows} does not match reviewed findings ${list(reportData?.findings).length}`);
  }
  const findingDialogs = (text.match(/data-finding-dialog-id=/gu) ?? []).length;
  if (findingDialogs !== list(reportData?.findings).length) {
    errors.push(`report.html finding dialog count ${findingDialogs} does not match reviewed findings ${list(reportData?.findings).length}`);
  }
  const copyActions = (text.match(/data-copy-finding=/gu) ?? []).length;
  const actionableFindings = list(reportData?.findings).filter(hasAiFixPrompt);
  if (copyActions !== actionableFindings.length * 2) {
    errors.push(`report.html copy action count ${copyActions} does not match expected ${actionableFindings.length * 2}`);
  }
  const detailActions = (text.match(/data-view-finding-dialog=/gu) ?? []).length;
  if (detailActions !== list(reportData?.findings).length) {
    errors.push(`report.html detail action count ${detailActions} does not match reviewed findings ${list(reportData?.findings).length}`);
  }
  for (const [index, finding] of list(reportData?.findings).entries()) {
    const findingId = escapeHtml(String(finding?.id ?? index));
    const dialogId = `finding-dialog-${index + 1}`;
    const bindings = [
      ["card", `data-finding-id="${findingId}"`, 1],
      ["dialog", `data-finding-dialog-id="${findingId}"`, 1],
      ["copy action", `data-copy-finding="${findingId}"`, hasAiFixPrompt(finding) ? 2 : 0],
      ["detail action", `data-view-finding-dialog="${dialogId}"`, 1],
      ["close action", `data-close-finding-dialog="${dialogId}"`, 1],
    ];
    for (const [label, marker, expected] of bindings) {
      const actual = text.split(marker).length - 1;
      if (actual !== expected) {
        errors.push(`report.html finding ${findingId} ${label} binding count ${actual} does not match expected ${expected}`);
      }
    }
  }
  const suggestionRows = (text.match(/data-suggestion-id=/gu) ?? []).length;
  if (suggestionRows !== list(reportData?.summary?.suggestions).length) {
    errors.push(`report.html suggestion row count ${suggestionRows} does not match reviewed suggestions ${list(reportData?.summary?.suggestions).length}`);
  }
  const dimensionRows = (text.match(/data-dimension-id=/gu) ?? []).length;
  const dimensions = list(reportData?.summary?.dimensions);
  if (dimensionRows !== dimensions.length) {
    errors.push(`report.html dimension row count ${dimensionRows} does not match reviewed dimensions ${dimensions.length}`);
  }
  const dimensionTracks = text.match(/<div class="track"[^>]*>/gu) ?? [];
  if (dimensionTracks.length !== dimensions.length) {
    errors.push(`report.html dimension progressbar count ${dimensionTracks.length} does not match reviewed dimensions ${dimensions.length}`);
  }
  for (const [index, dimension] of dimensions.entries()) {
    const dimensionId = escapeHtml(dimension?.id ?? index);
    const dimensionMarker = `data-dimension-id="${dimensionId}"`;
    const markerCount = text.split(dimensionMarker).length - 1;
    if (markerCount !== 1) {
      errors.push(`report.html dimension ${dimensionId} card binding count ${markerCount} does not match expected 1`);
      continue;
    }
    const cardStart = text.indexOf(dimensionMarker);
    const cardEnd = text.indexOf("</article>", cardStart);
    const cardText = cardEnd < 0 ? "" : text.slice(cardStart, cardEnd);
    const cardTracks = cardText.match(/<div class="track"[^>]*>/gu) ?? [];
    if (cardTracks.length !== 1) {
      errors.push(`report.html dimension ${dimensionId} progressbar count ${cardTracks.length} does not match expected 1`);
      continue;
    }
    const attributes = Object.fromEntries(
      [...cardTracks[0].matchAll(/([\w-]+)="([^"]*)"/gu)].map((match) => [match[1], match[2]]),
    );
    const roundedScore = Math.round(clamp(dimension?.score));
    const label = dimension?.label ?? dimension?.id ?? `Dimension ${index + 1}`;
    const expectedAttributes = {
      role: "progressbar",
      "aria-label": `${escapeHtml(label)} ${roundedScore} of 100`,
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(roundedScore),
    };
    for (const [attribute, expected] of Object.entries(expectedAttributes)) {
      if (attributes[attribute] !== expected) {
        errors.push(`report.html dimension ${dimensionId} ${attribute} ${attributes[attribute] ?? "missing"} does not match expected ${expected}`);
      }
    }
  }
  if (text.length < 5000) warnings.push("report.html is unexpectedly small for the self-contained visual contract");
  return {
    id: "html-report",
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    errors,
    warnings,
    summary: {
      selfContained: errors.every((error) => !error.includes("forbidden")),
      findingCount: findingRows,
      findingDialogCount: findingDialogs,
      copyActionCount: copyActions,
      detailActionCount: detailActions,
      suggestionCount: suggestionRows,
      dimensionCount: dimensionRows,
      requiredSectionCount: required.length,
      sourceMarkdownLength: renderMarkdown(reportData).length,
    },
  };
}
