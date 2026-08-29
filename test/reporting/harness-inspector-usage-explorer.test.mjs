import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import { expect, test } from "vitest";

import { buildHarnessInspectorDemoReport } from "../../scripts/harness-inspector/demo-report.mjs";
import { renderHarnessInspectorHtml } from "../../scripts/harness-inspector/render-html.mjs";

function progressionPoint(position) {
  const index = position + 1;
  const cyclePosition = position % 20;
  const contextTokens = 30_000 + cyclePosition * 1_000;
  return {
    id: `response-${index}`,
    index,
    timestamp: new Date(Date.UTC(2026, 7, 12, 8, 0, position)).toISOString(),
    model: "fixture-model",
    contextTokens,
    contextDeltaTokens: cyclePosition === 0 && position > 0 ? -19_000 : position === 0 ? undefined : 1_000,
    ...(position < 10 ? { processedTokens: 2_000 + position } : {}),
    outputTokens: 100 + position,
    cacheReuse: {
      status: "observed",
      accountingMode: "included-in-input",
      cacheReadTokens: 990,
      uncachedInputTokens: 10,
      promptInputTokens: 1_000,
      reusePercent: 99,
    },
    turnIndex: Math.floor(position / 5) + 1,
    promptBoundary: position % 5 === 0,
    boundary: position === 0 ? "baseline" : cyclePosition === 0 ? "shrink" : "growth",
  };
}

test("linked Usage explorer keeps its window, chart, rows, and details in one selection model", async () => {
  const report = buildHarnessInspectorDemoReport();
  const session = report.sessions[0];
  const progression = Array.from({ length: 75 }, (_value, position) => progressionPoint(position));
  session.usageReport = {
    ...session.usageReport,
    actualModelCalls: progression.length,
    currentContextTokens: progression.at(-1).contextTokens,
    progressionTotalCount: progression.length,
    progressionTruncated: false,
    progression,
  };
  const directory = await mkdtemp(path.join(tmpdir(), "harness-inspector-usage-explorer-"));
  const reportPath = path.join(directory, "report.html");
  await writeFile(reportPath, renderHarnessInspectorHtml(report), "utf8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const url = new URL(pathToFileURL(reportPath));
    const sessionDate = report.days.find((day) => day.sessionIds.includes(session.sessionId))?.date;
    url.searchParams.set("mode", "date");
    if (sessionDate) url.searchParams.set("date", sessionDate);
    url.searchParams.set("view", "session");
    url.searchParams.set("session", session.sessionId);
    url.searchParams.set("session-mode", "usage");
    await page.goto(url.href, { waitUntil: "load" });
    const explorer = page.locator(`[data-usage-explorer="${session.sessionId}"]`);
    await expect.poll(() => explorer.isVisible()).toBe(true);

    await expect.poll(() => explorer.locator(".usage-response-row").count()).toBe(15);
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 61–75\s+15 of 75/u);
    await expect.poll(() => explorer.locator(".usage-overview-handle").count()).toBe(2);
    await expect.poll(() => explorer.locator(".usage-overview-turn").count()).toBe(15);
    await expect.poll(() => explorer.locator("[data-usage-overview-turn-marker]").count()).toBe(15);
    await expect.poll(() => explorer.locator("[data-usage-overview-turn-marker] title").first().textContent()).toContain(session.dialogue.turns[0].prompt.text);
    await expect.poll(() => explorer.locator(".usage-overview-prompt-tooltip").count()).toBe(15);
    await expect.poll(() => explorer.locator(".usage-overview-prompt-tooltip div").first().innerText()).toContain(session.dialogue.turns[0].prompt.text);
    await expect.poll(() => explorer.locator(".usage-overview-turn-label").count()).toBe(15);
    await expect.poll(() => explorer.locator(".usage-overview-turn-chip").count()).toBe(15);
    await expect.poll(() => explorer.locator("[data-usage-prompt-marker]").count()).toBe(0);
    await expect.poll(() => explorer.locator(".usage-overview-turn-label").evaluateAll((labels) => labels.filter((label) => getComputedStyle(label).opacity !== "0").map((label) => label.textContent))).toEqual(["T15"]);
    await expect.poll(() => explorer.locator("[data-usage-overview-turn-marker][tabindex]").count()).toBe(0);
    const overviewChart = explorer.locator("[data-usage-overview-chart]");
    await expect.poll(() => overviewChart.getAttribute("tabindex")).toBe("0");
    await expect.poll(() => explorer.locator(".usage-overview .chart-toolbar").innerText()).toMatch(/75 responses · 15 linked prompts/iu);
    await explorer.locator("[data-usage-overview-turn-marker]").first().locator(".usage-overview-turn-hit").hover();
    await expect.poll(() => explorer.locator(".usage-overview-prompt-tooltip").first().evaluate((tooltip) => getComputedStyle(tooltip).opacity)).toBe("1");
    await overviewChart.focus();
    await overviewChart.press("Home");
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Response 1/u);
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 1–15\s+15 of 75/u);
    await expect.poll(() => explorer.locator(".usage-overview-turn-marker.selected .usage-overview-prompt-tooltip").evaluate((tooltip) => getComputedStyle(tooltip).opacity)).toBe("1");
    await overviewChart.press("End");
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Response 71/u);
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 61–75\s+15 of 75/u);
    await expect.poll(() => explorer.locator(".usage-response-head").innerText()).not.toMatch(/Processed/u);
    await expect.poll(() => explorer.locator(".usage-response-head").innerText()).not.toMatch(/Turn/u);
    await explorer.locator(".usage-response-row").last().click();
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Response 75/u);
    await expect.poll(() => explorer.locator(".usage-response-table").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect.poll(() => explorer.locator(".usage-response-table").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await explorer.locator(".usage-response-row").first().click();
    await expect.poll(() => explorer.locator(".usage-response-table").evaluate((element) => element.scrollTop)).toBe(0);
    const selected = explorer.locator(".usage-response-row[aria-selected=true]");
    await selected.press("ArrowDown");
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Response 62/u);

    await explorer.locator(".usage-overview").scrollIntoViewIfNeeded();
    const overviewSurface = await explorer.locator("[data-usage-overview-surface]").boundingBox();
    const startHandle = await explorer.locator('[data-usage-window-handle="start"]').boundingBox();
    await page.mouse.move(startHandle.x + startHandle.width / 2, startHandle.y + startHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(overviewSurface.x + overviewSurface.width * (5 / 74), startHandle.y + startHandle.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 6–75\s+70 of 75/u);

    const endHandle = await explorer.locator('[data-usage-window-handle="end"]').boundingBox();
    await page.mouse.move(endHandle.x + endHandle.width / 2, endHandle.y + endHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(overviewSurface.x + overviewSurface.width * (59 / 74), endHandle.y + endHandle.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 6–60\s+55 of 75/u);

    await explorer.locator('[data-usage-window-edge="start"]').fill("0");
    await explorer.locator('[data-usage-window-edge="start"]').dispatchEvent("change");
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 1–60\s+60 of 75/u);
    await expect.poll(() => explorer.locator(".usage-response-head").innerText()).toMatch(/Processed/u);

    await explorer.locator("[data-usage-focus-surface]").press("Escape");
    await expect.poll(() => explorer.locator(".usage-response-row[aria-selected=true]").count()).toBe(0);
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Select a chart point or response row/u);
    await explorer.locator("[data-usage-focus-surface]").press("Enter");
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Response 1/u);
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toContain("Linked user prompt");
    await expect.poll(() => explorer.locator(".usage-response-prompt").innerText()).toContain(session.dialogue.turns[0].prompt.text);
    const lastOverviewTurn = explorer.locator("[data-usage-overview-turn-marker]").last();
    await lastOverviewTurn.locator(".usage-overview-turn-hit").click();
    await expect.poll(() => explorer.locator(".usage-window-toolbar").innerText()).toMatch(/Responses 16–75\s+60 of 75/u);
    await expect.poll(() => explorer.locator(".usage-response-detail").innerText()).toMatch(/Response 71/u);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
