import { readFileSync } from "node:fs";

import { buildPromptCacheGapCue } from "./cache-gap-cue.mjs";
import {
  PROMPT_CACHE_POLICY_NOTICE,
  PROMPT_CACHE_PROFILES,
  resolvePromptCacheProfile,
} from "./prompt-cache-profiles.mjs";
import { buildCompressedTimelineScale } from "./timeline-scale.mjs";

const UI_ASSET_ROOT = new URL("./ui/", import.meta.url);
const HTML_TEMPLATE = readFileSync(new URL("workbench.html", UI_ASSET_ROOT), "utf8");
const STYLES = readFileSync(new URL("workbench.css", UI_ASSET_ROOT), "utf8");
const SCRIPT = readFileSync(new URL("workbench.js", UI_ASSET_ROOT), "utf8");
const CLIENT_SCRIPT = `const PROMPT_CACHE_POLICY_NOTICE = ${JSON.stringify(PROMPT_CACHE_POLICY_NOTICE)};\nconst PROMPT_CACHE_PROFILES = Object.freeze(${JSON.stringify(PROMPT_CACHE_PROFILES)});\nconst resolvePromptCacheProfile = ${resolvePromptCacheProfile.toString()};\nconst buildCompressedTimelineScale = ${buildCompressedTimelineScale.toString()};\nconst buildPromptCacheGapCue = ${buildPromptCacheGapCue.toString()};\n${SCRIPT}`;
const TEMPLATE_TOKEN_PATTERN = /\{\{BH_[A-Z_]+\}\}/gu;

function fillHtmlTemplate(replacements) {
  const used = new Set();
  const html = HTML_TEMPLATE.replace(TEMPLATE_TOKEN_PATTERN, (token) => {
    const tokenName = token.slice("{{BH_".length, -2);
    if (!Object.hasOwn(replacements, tokenName)) {
      throw new Error(`Harness Inspector HTML template has unresolved token ${token}`);
    }
    used.add(tokenName);
    return String(replacements[tokenName]);
  });
  for (const tokenName of Object.keys(replacements)) {
    if (!used.has(tokenName)) {
      throw new Error(`Harness Inspector HTML template is missing {{BH_${tokenName}}}`);
    }
  }
  return html;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function featurePicker(tree) {
  if (tree.nodes.length === 0) return '<p class="picker-empty">No Feature Tree yet. Date mode still exposes observed repository activity.</p>';
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const renderNode = (node) => {
    const hasChildren = node.children.length > 0;
    const meta = hasChildren
      ? `${node.children.length} item${node.children.length === 1 ? "" : "s"}`
      : (node.stage ?? "capability");
    const status = node.status === "complete" ? "complete" : node.status === "todo" ? "todo" : "neutral";
    const statusLabel = status === "complete" ? "Complete" : status === "todo" ? "Todo" : "Status not declared";
    const toggle = hasChildren
      ? `<button class="tree-branch-toggle" type="button" data-tree-toggle aria-expanded="true" aria-label="Collapse ${escapeHtml(node.title)}"><span aria-hidden="true">⌄</span></button>`
      : '<span class="tree-branch-spacer" aria-hidden="true"></span>';
    const children = node.children.map((id) => byId.get(id)).filter(Boolean);
    const group = children.length > 0
      ? `<ul class="tree-children" role="group">${children.map(renderNode).join("")}</ul>`
      : "";
    const badge = node.evidence === "declared" ? "" : `<span class="evidence ${escapeHtml(node.evidence)}">${escapeHtml(node.evidence)}</span>`;
    return `<li class="tree-item ${node.type}" role="treeitem" data-tree-item data-tree-node-id="${escapeHtml(node.id)}"${hasChildren ? ' aria-expanded="true"' : ""}><div class="tree-line">${toggle}<button class="tree-row ${node.type}" type="button" data-feature-id="${escapeHtml(node.id)}"><span class="tree-check ${status}" role="img" aria-label="${statusLabel}"><span aria-hidden="true">${status === "complete" ? "✓" : ""}</span></span><span class="tree-copy"><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(meta)}</small></span>${badge}</button></div>${group}</li>`;
  };
  const roots = tree.roots.map((id) => byId.get(id)).filter(Boolean);
  return `<ul class="capability-tree" role="tree" aria-label="Capability tree">${roots.map(renderNode).join("")}</ul>`;
}

function datePicker(days) {
  if (days.length === 0) return '<p class="picker-empty">No timestamped sessions or commits in this window.</p>';
  const byDate = new Map(days.map((day) => [day.date, day]));
  const months = [...new Set(days.map((day) => day.date.slice(0, 7)))].sort();
  const latestMonth = months.at(-1);
  const monthLabel = (month) => new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00.000Z`));
  const monthGrid = (month) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(Date.UTC(year, monthNumber - 1, 1));
    const last = new Date(Date.UTC(year, monthNumber, 0));
    const gridStart = new Date(first);
    gridStart.setUTCDate(gridStart.getUTCDate() - ((gridStart.getUTCDay() + 6) % 7));
    const gridEnd = new Date(last);
    gridEnd.setUTCDate(gridEnd.getUTCDate() + ((7 - gridEnd.getUTCDay()) % 7));
    const cells = [];
    for (const cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      const inMonth = cursor.getUTCFullYear() === year && cursor.getUTCMonth() === monthNumber - 1;
      const day = inMonth ? byDate.get(date) : undefined;
      const number = cursor.getUTCDate();
      if (!day) {
        cells.push(`<span class="date-cell empty${inMonth ? "" : " outside"}" aria-hidden="true"><time datetime="${date}">${number}</time></span>`);
        continue;
      }
      const sessions = day.sessionIds.length;
      const commits = day.commitHashes.length;
      const label = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(cursor)
        + `, ${sessions} session${sessions === 1 ? "" : "s"}, ${commits} commit${commits === 1 ? "" : "s"}`;
      cells.push(`<button class="date-cell" type="button" data-date="${date}" data-session-count="${sessions}" data-commit-count="${commits}" aria-label="${escapeHtml(label)}"><time datetime="${date}">${number}</time><span class="date-activity" aria-hidden="true"></span></button>`);
    }
    const label = monthLabel(month);
    return `<div class="date-grid" role="group" aria-label="${escapeHtml(label)} evidence calendar" data-calendar-month="${month}" data-calendar-label="${escapeHtml(label)}"${month === latestMonth ? "" : " hidden"}>${cells.join("")}</div>`;
  };
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => `<span>${day}</span>`).join("");
  return `<div class="date-calendar"><header><div class="date-calendar-nav"><button type="button" data-calendar-step="-1" aria-label="Previous month"${months.length === 1 ? " disabled" : ""}><span aria-hidden="true">‹</span></button><strong data-calendar-label>${escapeHtml(monthLabel(latestMonth))}</strong><button type="button" data-calendar-step="1" aria-label="Next month" disabled><span aria-hidden="true">›</span></button></div><span class="date-calendar-zone">UTC</span></header><div class="date-weekdays" aria-hidden="true">${weekdays}</div>${months.map(monthGrid).join("")}<div class="date-selection-summary" aria-live="polite"><strong data-date-summary-label>Select a date</strong><span data-date-summary-meta></span></div><div class="date-context-summary" data-date-context-summary hidden><strong data-date-context-total></strong><span data-date-context-meta></span></div></div><nav class="date-session-navigator" aria-label="Sessions on selected date"><div class="date-session-heading"><strong>Sessions</strong><span data-date-session-count>0</span></div><div class="date-session-list" data-date-session-list><p class="picker-empty">Select a date to browse its Sessions.</p></div></nav>`;
}

// Badge names the providers that contributed sessions; the requested filter
// text is only a fallback when no provider produced evidence.
function platformBadge(report) {
  const contributing = (report.providers ?? []).filter((provider) => provider.sessionCount > 0);
  if (contributing.length === 0) return report.filters.platform;
  if (contributing.length <= 3) return contributing.map((provider) => provider.platform).join(" · ");
  return `${contributing.length} providers`;
}

export function renderHarnessInspectorHtml(report, {
  contextLabel = null,
  robots = null,
  sample = false,
} = {}) {
  if (report?.kind !== "HarnessInspectorReportV1") throw new Error("renderHarnessInspectorHtml requires HarnessInspectorReportV1");
  if (robots !== null && robots !== "noindex, follow" && robots !== "noindex, nofollow") {
    throw new Error("Harness Inspector robots must be noindex, follow or noindex, nofollow");
  }
  const hasFeatureEvidence = report.stories.some((story) => story.sessionLinks.length > 0 || story.commitHashes.length > 0);
  const initialMode = report.featureTree.nodes.length > 0 && hasFeatureEvidence ? "feature" : "date";
  const workspaceName = escapeHtml(report.workspace.name);
  // A local render needs no tagline: the workspace name alone is the context.
  // A label is reserved for reports whose provenance is not the reader's own
  // repository, such as the published sample.
  const workspaceContext = contextLabel ? `${workspaceName} · ${escapeHtml(contextLabel)}` : workspaceName;
  return fillHtmlTemplate({
    PAGE_TITLE: `Harness Inspector · ${workspaceName}`,
    ROBOTS_META: robots ? `<meta name="robots" content="${robots}">` : "",
    STYLES,
    BODY_ATTRIBUTES: sample ? ' data-report-context="sample"' : "",
    WORKSPACE_NAME: workspaceName,
    WORKSPACE_CONTEXT: workspaceContext,
    FEATURE_TAB_CLASS: initialMode === "feature" ? "active" : "",
    FEATURE_TAB_SELECTED: initialMode === "feature" ? "true" : "false",
    DATE_TAB_CLASS: initialMode === "date" ? "active" : "",
    DATE_TAB_SELECTED: initialMode === "date" ? "true" : "false",
    FEATURE_PANEL_CLASS: initialMode === "feature" ? "active" : "",
    FEATURE_NODE_COUNT: report.featureTree.nodes.length,
    FEATURE_PICKER: featurePicker(report.featureTree),
    DATE_PANEL_CLASS: initialMode === "date" ? "active" : "",
    DATE_PICKER: datePicker(report.days),
    PLATFORM: escapeHtml(platformBadge(report)),
    SESSION_COUNT: report.sessions.length,
    REPORT_JSON: safeJson(report),
    SCRIPT: CLIENT_SCRIPT,
  });
}
