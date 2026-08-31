// Visual contract check for the Harness Inspector workbench.
//
// DESIGN.md owns the typography floor, bounded-density, and layout-mode rules
// for interactive Better Harness reports. Those rules are only observable after
// the cascade resolves, so this check measures a real rendered report instead of
// reading the stylesheet: it reports computed font sizes below the `metadata`
// floor, text clipped with no ellipsis and no scroll affordance, document-level
// horizontal overflow, and console/page errors, at each documented layout mode.
//
// Usage:
//   node scripts/harness-inspector/visual-contract-check.mjs [--report <path>] [--out <dir>]
//
// With no --report it renders the bundled demo report, so the check needs no
// workspace evidence and stays safe to run anywhere.

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// DESIGN.md: `metadata` is the smallest role allowed for meaningful text.
const MIN_MEANINGFUL_FONT_PX = 12;

// DESIGN.md layout modes: wide, compact, and narrow.
const LAYOUT_MODES = Object.freeze([
  { name: "wide", width: 1440, height: 900 },
  { name: "compact", width: 1024, height: 768 },
  { name: "narrow", width: 390, height: 844 },
]);

function parseArgs(argv) {
  const options = { report: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") options.report = argv[index + 1] ?? null;
    if (argv[index] === "--out") options.out = argv[index + 1] ?? null;
  }
  return options;
}

async function resolveReportPath(requested) {
  if (requested) return requested;
  const { buildHarnessInspectorDemoReport } = await import("./demo-report.mjs");
  const { renderHarnessInspectorHtml } = await import("./render-html.mjs");
  const directory = await mkdtemp(join(tmpdir(), "harness-inspector-visual-"));
  const path = join(directory, "report.html");
  const report = buildHarnessInspectorDemoReport();
  // The public demo stays compact. This browser-only fixture adds a realistic
  // large, deeply nested commit so the pane boundary and File Tree interaction
  // are exercised on every visual gate run.
  const stressCommit = report.commits.find(commit => commit.files.length > 0);
  if (stressCommit) {
    stressCommit.files.push(...Array.from({ length: 36 }, (_, index) => ({
      path: `packages/checkout/src/generated/flows/flow-${String(index + 1).padStart(2,"0")}.ts`,
      added: 12 + index,
      removed: index % 5,
    })));
    stressCommit.fileCount = stressCommit.files.length;
    stressCommit.linesAdded = stressCommit.files.reduce((sum,file) => sum + (Number.isFinite(file.added) ? file.added : 0),0);
    stressCommit.linesRemoved = stressCommit.files.reduce((sum,file) => sum + (Number.isFinite(file.removed) ? file.removed : 0),0);
  }
  await writeFile(path, renderHarnessInspectorHtml(report, {
    contextLabel: "Visual contract fixture · no live workspace access",
    robots: "noindex, follow",
  }), "utf8");
  return path;
}

// Runs inside the page. Returns measurements, never assertions, so the decision
// stays in one place on the Node side.
function measureContract(minFontPx) {
  const tooSmall = [];
  const seen = new Set();
  const describe = element =>
    element.tagName.toLowerCase() +
    (element.className ? "." + String(element.className).trim().split(/\s+/)[0] : "");

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.trim();
    if (!text) continue;
    const element = node.parentElement;
    if (!element || seen.has(element)) continue;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const fontSize = Number.parseFloat(style.fontSize);
    if (fontSize < minFontPx) {
      tooSmall.push({ fontSize, selector: describe(element), text: text.slice(0, 48) });
    }
  }

  // Ellipsis truncation and scrollable regions are allowed affordances. Content
  // clipped with neither is simply unreachable, which AC-4 forbids. Screen
  // reader-only text is deliberately clipped to a 1px box, so it is excluded:
  // flagging it would train contributors to drop accessible names.
  const clipped = [];
  for (const element of document.querySelectorAll("body *")) {
    if (element.closest('[aria-hidden="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.overflowX !== "hidden") continue;
    if (style.textOverflow === "ellipsis") continue;
    if (style.clipPath !== "none" && element.clientWidth <= 4) continue;
    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) continue;
    const text = element.textContent?.trim();
    if (!text) continue;
    clipped.push({ overflow, selector: describe(element), text: text.slice(0, 48) });
  }

  const root = document.documentElement;
  const outline = document.querySelector(".session-mode-panel:not([hidden]) .session-sidebar");
  const outlineRect = outline?.getBoundingClientRect();
  const outlineOverflow = outline && outlineRect && outlineRect.width > 0
    ? outline.scrollWidth - outline.clientWidth
    : 0;
  const usageSummary = outline?.querySelector(".session-usage-summary");
  const usageSummaryRect = usageSummary?.getBoundingClientRect();
  const outlineUsageOffset = outlineRect && usageSummaryRect && usageSummaryRect.height > 0
    ? usageSummaryRect.top - outlineRect.top
    : null;
  const outlineTargetHeights = outline
    ? [...outline.querySelectorAll(".session-outline-controls select, .session-filter-disclosure > summary")]
      .map(element => element.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => rect.height)
    : [];
  const primary = document.querySelector(".session-mode-panel:not([hidden]) .session-notebook-main");
  const primaryRect = primary?.getBoundingClientRect();
  const primaryWidthRatio = primaryRect && primaryRect.width > 0
    ? primaryRect.width / window.innerWidth
    : null;
  return {
    tooSmall,
    clipped,
    documentOverflow: root.scrollWidth - root.clientWidth,
    outlineOverflow,
    outlineUsageOffset,
    outlineTargetMinHeight: outlineTargetHeights.length ? Math.min(...outlineTargetHeights) : null,
    primaryWidthRatio,
  };
}

async function surfacesFor(page) {
  return [
    { label: "capability", enter: null },
    {
      label: "date",
      enter: async () => {
        await page.click("#mode-date");
        await page.waitForTimeout(300);
        const dailyContext = page.locator("[data-date-context-summary]:visible");
        if ((await dailyContext.count()) > 0) {
          if (!(await dailyContext.innerText()).includes("observed context snapshots")) {
            throw new Error("Selected-date Context summary must name observed snapshots without implying provider usage.");
          }
          const rows = page.locator(".date-session-token-summary");
          if ((await rows.count()) === 0) throw new Error("Date Session rows must expose their retained Context-token summary.");
          if ((await page.locator(".workbench-token-summary").count()) === 0) throw new Error("Date workbench headers must expose their matching Session Context-token summary.");
        }
      },
    },
    {
      label: "commit-files",
      enter: async () => {
        await page.click("#mode-feature");
        await page.waitForTimeout(300);
        let cards = page.locator(".commit-card");
        // A real workspace can retain date-scoped Git evidence that is not
        // declared by the currently selected Feature Tree branch.
        if ((await cards.count()) === 0) {
          await page.click("#mode-date");
          await page.waitForTimeout(300);
          cards = page.locator(".commit-card");
        }
        if ((await cards.count()) === 0) return "skip";
        const cardIndex = await cards.evaluateAll(elements => {
          const counts = elements.map(element => element.querySelectorAll('[data-file-view-panel="list"] .file-row').length);
          return counts.indexOf(Math.max(...counts));
        });
        const card = cards.nth(cardIndex);
        if (!(await card.evaluate(element => element.open))) await card.locator(":scope > summary").click();
        const lane = card.locator("xpath=ancestor::section[contains(@class,'delivery-lane')]");
        const fileRows = card.locator('[data-file-view-panel="list"] .file-row');
        if ((await fileRows.count()) === 0) throw new Error("Commit file List view must render changed paths.");
        if ((await fileRows.locator(".evidence").count()) !== 0) {
          throw new Error("File rows must not repeat commit/session evidence labels.");
        }
        const firstRow = fileRows.first();
        if ((await firstRow.locator(".diff-add").count()) !== 1 || (await firstRow.locator(".diff-remove").count()) !== 1) {
          throw new Error("Each text-file row must expose separate addition and removal diff stats.");
        }
        const [addColor,removeColor] = await Promise.all([
          firstRow.locator(".diff-add").evaluate(element => getComputedStyle(element).color),
          firstRow.locator(".diff-remove").evaluate(element => getComputedStyle(element).color),
        ]);
        if (addColor === removeColor) throw new Error("Addition and removal stats must use distinct semantic colors.");

        const deliveryContent = lane.locator(".delivery-content");
        const boundary = await deliveryContent.evaluate(element => ({ clientHeight:element.clientHeight, scrollHeight:element.scrollHeight }));
        if ((await fileRows.count()) > 20 && boundary.scrollHeight <= boundary.clientHeight) {
          throw new Error("A large commit must scroll inside the Commits / files pane.");
        }

        const treeButton = lane.locator('[data-commit-file-view="tree"]');
        await treeButton.focus();
        await page.keyboard.press("Enter");
        if ((await treeButton.getAttribute("aria-pressed")) !== "true" || !(await card.locator('[data-file-view-panel="tree"]').isVisible())) {
          throw new Error("Tree control must select and reveal the directory view from the keyboard.");
        }
        const nestedDirectory = card.locator(".file-tree-node .file-tree-node").first();
        if ((await nestedDirectory.count()) === 0) throw new Error("Tree view must retain nested directory levels.");
        await nestedDirectory.locator(":scope > summary").click();
        if (await nestedDirectory.locator(":scope > .file-tree-children").isVisible()) {
          throw new Error("Directory branches must collapse independently.");
        }
        const listButton = lane.locator('[data-commit-file-view="list"]');
        await listButton.click();
        if ((await listButton.getAttribute("aria-pressed")) !== "true") throw new Error("List control must restore the flat path view.");
        return undefined;
      },
    },
    {
      label: "activity-focus",
      enter: async () => {
        let candidates = page.locator("[data-activity-session]");
        if ((await candidates.count()) === 0) {
          await page.click("#mode-feature");
          await page.waitForTimeout(300);
          candidates = page.locator("[data-activity-session]");
        }
        if ((await candidates.count()) === 0) return "skip";
        const candidateIndex = await candidates.evaluateAll((elements) => {
          const counts = elements.map((element) => Number.parseInt(element.querySelector("summary")?.textContent?.match(/\d+/u)?.[0] ?? "0", 10));
          return counts.indexOf(Math.max(...counts));
        });
        const details = candidates.nth(candidateIndex);
        if (!(await details.evaluate((element) => element.open))) await details.locator("summary").click();
        const activityAction = details.locator(".activity-disclosure-actions [data-open-session-for]");
        const focusLabel = details.locator("summary small");
        const [activityActionBox, focusLabelBox] = await Promise.all([
          activityAction.boundingBox(),
          focusLabel.boundingBox(),
        ]);
        if (!activityActionBox || !focusLabelBox
          || Math.abs((activityActionBox.y + activityActionBox.height / 2) - (focusLabelBox.y + focusLabelBox.height / 2)) > 2) {
          throw new Error("Open session and focus view must share one activity disclosure row.");
        }
        const chart = details.locator(".chart-card:not(.chart-compact)");
        await chart.waitFor({ state: "visible" });
        if ((await chart.locator(".chart-basis").innerText()).trim() !== "TIME AXIS") {
          throw new Error("The activity toolbar must not expose idle-axis compression as Session state.");
        }
        const brokenGaps = chart.locator(".chart-gap.compressed");
        if ((await brokenGaps.count()) === 0) throw new Error("The activity fixture must exercise a long idle scale break.");
        const brokenGapLabels = await brokenGaps.locator(".chart-gap-label").allTextContents();
        if (brokenGapLabels.some((label) => /compressed/iu.test(label))) {
          throw new Error("Long idle labels must show duration without internal compression terminology.");
        }
        const gapTooltip = await brokenGaps.first().locator("title").textContent();
        if (!gapTooltip?.includes("visual scale break") || /visually compressed/iu.test(gapTooltip)) {
          throw new Error("Long idle tooltips must explain the axis break without implying Context compression.");
        }
        const compactionMarkers = chart.locator(".chart-context-compaction-marker");
        if ((await compactionMarkers.count()) < 1) {
          throw new Error("Explicit Context compaction boundaries must render on the activity timeline.");
        }
        if (!(await chart.locator(".chart-status-legends").innerText()).includes("context compressed")) {
          throw new Error("The activity legend must name explicit Context compression evidence.");
        }
        await compactionMarkers.first().focus();
        if (!((await chart.locator("[data-chart-inspector]").innerText()).includes("Context compressed"))) {
          throw new Error("A focused Context compaction marker must expose its timestamped evidence detail.");
        }
        if (await chart.locator("[data-chart-locate]").isEnabled()) {
          throw new Error("A Context compaction marker without a retained call id must not enable call location.");
        }
        const policy = chart.locator("[data-cache-policy-panel]");
        if ((await policy.count()) !== 1) throw new Error("Expanded activity must render one docked prompt-cache policy pane.");
        if ((await policy.getByText("Models and pricing change. Use the latest official documentation.", { exact: true }).count()) !== 1) {
          throw new Error("Prompt-cache policy must tell readers to use the latest official documentation.");
        }
        if ((await policy.locator('.cache-policy-row a[href^="https://"]').count()) !== 7) {
          throw new Error("Every prompt-cache model profile must retain its official documentation link.");
        }
        const defaultVisibleRows = await policy.locator(".cache-policy-row:visible").count();
        if (defaultVisibleRows !== 3) {
          throw new Error(`Prompt-cache policy must show three model rows by default; observed ${defaultVisibleRows}.`);
        }
        const toggle = policy.locator("[data-cache-policy-toggle]");
        await toggle.click();
        if ((await policy.locator(".cache-policy-row:visible").count()) !== 7) {
          throw new Error("View all model profiles must disclose every configured row.");
        }
        await toggle.click();
        const select = policy.locator("[data-cache-profile-select]");
        const initialProfile = await select.inputValue();
        await select.selectOption("anthropic-claude");
        await page.waitForTimeout(100);
        if ((await details.locator('[data-cache-profile-select]').inputValue()) !== "anthropic-claude"
          || (await details.locator('.cache-policy-row.selected').innerText()).includes("Anthropic") === false) {
          throw new Error("Selecting another prompt-cache reference must update the policy row and chart model together.");
        }
        await details.locator("[data-cache-profile-select]").selectOption(initialProfile);
        await page.waitForTimeout(100);
        const statusbar = details.locator(".chart-statusbar");
        if ((await statusbar.count()) !== 1) throw new Error("Expanded activity must render one compact status row.");
        if ((await statusbar.locator("[data-chart-inspector]").textContent())?.trim()) {
          throw new Error("The idle activity status row must not reserve space for instructional placeholder copy.");
        }
        const statusHeight = await statusbar.evaluate((element) => element.getBoundingClientRect().height);
        if (statusHeight > 45) throw new Error("Activity status detail and legends must stay within one compact row.");
        const mark = details.locator(".chart-mark, .chart-ribbon-block, [data-chart-bin]").first();
        if ((await mark.count()) > 0) {
          await mark.evaluate((element) => element.focus());
          if (!(await statusbar.locator("[data-chart-locate]").isEnabled())) {
            throw new Error("Inspecting a chart event must enable the Session View locate action.");
          }
        }
        return undefined;
      },
    },
    {
      label: "session-trace",
      enter: async () => {
        await page.click("#mode-feature");
        await page.waitForTimeout(200);
        let opener = page.locator("[data-open-session]").first();
        // A real workspace may have valid date-scoped Sessions without any
        // Feature correlation. The visual gate must still exercise Session
        // Trace/Usage/Replay instead of silently passing only the picker.
        if ((await opener.count()) === 0) {
          await page.click("#mode-date");
          const date = await page.locator("[data-date]").evaluateAll((items) => (
            items.find((item) => Number(item.dataset.sessionCount) > 0)?.dataset.date ?? null
          ));
          if (date) {
            await page.click(`[data-date="${date}"]`);
            await page.waitForTimeout(300);
            opener = page.locator("[data-open-session]").first();
          }
        }
        if ((await opener.count()) === 0) return "skip";
        await opener.click();
        await page.waitForTimeout(400);
        const usageSummary = page.locator(".session-usage-summary");
        if ((await usageSummary.count()) > 0) {
          const freshness = await usageSummary.locator(".usage-summary-freshness").innerText();
          if (!/^Static snapshot · (?:observed through|generated) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$|^Static snapshot · freshness unavailable$/u.test(freshness)) {
            throw new Error("Session usage summary must disclose static-snapshot freshness.");
          }
          const metrics = await usageSummary.locator(".usage-summary-metrics").innerText();
          if (/Current (?:context|occupancy)/u.test(metrics)) throw new Error("Session usage summary must label context as latest observed evidence.");
        }
        const outline = page.locator(".session-sidebar");
        if ((await outline.locator(".session-bulk, .session-facts-disclosure").count()) !== 0) {
          throw new Error("Session outline must remove bulk Process actions and the legacy facts disclosure.");
        }
        if ((await outline.innerText()).includes("Read-only")) {
          throw new Error("Session outline must not repeat the read-only status.");
        }
        if ((await outline.locator(".session-outline-controls > .jump-select").count()) !== 1) {
          throw new Error("Session outline must retain one Cell jump control before Usage and context.");
        }
        const filters = outline.locator("details.session-filter-disclosure");
        if ((await filters.count()) !== 1 || await filters.evaluate((element) => element.open)) {
          throw new Error("Evidence filters must use the original disclosure and remain collapsed by default.");
        }
        const filterLabels = await filters.locator(".session-filter span").allTextContents();
        const requiredFilters = ["Prompts", "Results", "Intermediate", "Model usage", "Commits", "Tool calls", "File paths"];
        if (requiredFilters.some((label) => !filterLabels.includes(label)) || filterLabels.length < requiredFilters.length) {
          throw new Error("Evidence filters must restore the complete historical evidence controls.");
        }
        if (!/^\d+ calls$/u.test((await filters.locator(":scope > summary em").innerText()).trim())) {
          throw new Error("Evidence filters must retain the original total-call summary.");
        }
        if ((await filters.locator(".session-filter-list em").count()) !== filterLabels.length) {
          throw new Error("Evidence filters must retain per-option counts.");
        }
        if ((await filters.locator(".session-filter.subtype").count()) === 0) {
          throw new Error("Evidence filters must retain tool-name subtype controls and File paths.");
        }
        await filters.locator("summary").click();
        const legacyUsageCards = page.locator(".session-process-stream .session-event.usage dl, .session-process-stream .session-event.usage > header");
        if ((await legacyUsageCards.count()) !== 0) {
          throw new Error("Process trace Model responses must use compact one-line summaries.");
        }
        const combinedUsage = page.locator(".session-process-stream .session-process-combined.with-usage");
        if ((await combinedUsage.count()) > 0) {
          const firstHeight = await combinedUsage.first().locator(":scope > summary").evaluate((element) => element.getBoundingClientRect().height);
          if ((page.viewportSize()?.width ?? 0) > 1080 && firstHeight > 40) {
            throw new Error("Combined tool and Model response summary must stay on one wide row.");
          }
        }
        if (!(await filters.evaluate((element) => element.open)) || !(await filters.locator(".session-filter-list").isVisible())) {
          throw new Error("Evidence filters summary must reveal the retained filters.");
        }
        await filters.locator("summary").click();
        const factLabels = await outline.locator(".session-facts-compact dt").allTextContents();
        if (factLabels.join("|") !== "Runtime|Model|Duration") {
          throw new Error("Session facts must retain exactly Runtime, Model, and Duration.");
        }
        return undefined;
      },
    },
    {
      label: "session-usage",
      enter: async () => {
        const usage = page.locator("[data-open-usage-report]").first();
        if ((await usage.count()) === 0) return "skip";
        await usage.click();
        await page.waitForFunction(() => new URLSearchParams(location.search).get("session-mode") === "usage");
        const panel = page.locator("[data-session-mode-panel=usage]");
        await panel.waitFor({ state: "visible" });
        const kpis = panel.locator(".usage-report-summary > .usage-report-occupancy, .usage-report-summary > .usage-report-lead-facts > div");
        if ((await kpis.count()) !== 6) throw new Error("Usage report summary must render one context decision and five stable supporting facts.");
        const leadText = await panel.locator(".usage-report-lead").innerText();
        if (!/^Usage report\b/u.test(leadText) || leadText.includes("READ-ONLY EVIDENCE") || leadText.includes("Usage and Context Report") || leadText.includes("Unique model responses, absolute context progression")) {
          throw new Error("Usage report lead must visibly identify the report without legacy eyebrow or duplicate explanatory copy.");
        }
        const primaryFreshness = await panel.locator(".usage-report-occupancy .usage-report-freshness").innerText();
        if (!/^Static snapshot · (?:observed through|generated) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$|^Static snapshot · freshness unavailable$/u.test(primaryFreshness)) {
          throw new Error("Usage report must place complete static-snapshot freshness beside the latest context decision.");
        }
        const evidence = panel.locator(":scope > .usage-report-evidence");
        if ((await evidence.count()) !== 1) throw new Error("Usage report must place one Evidence & methodology disclosure after the lead.");
        if ((await evidence.locator("summary").count()) !== 1) throw new Error("Evidence & methodology must use one disclosure control.");
        if (await evidence.locator(".usage-evidence-groups").isVisible()) throw new Error("Evidence & methodology must be collapsed by default.");
        await evidence.locator("summary").click();
        if (!(await evidence.locator(".usage-evidence-groups").isVisible())) throw new Error("Evidence & methodology groups must open on request.");
        if ((await evidence.locator(".usage-evidence-group").count()) !== 4) throw new Error("Evidence details must group facts into four diagnostic categories.");
        if (!/Coverage\s+(observed|partial|unobserved)/u.test(await evidence.innerText())) throw new Error("Coverage must remain an Observability fact rather than a KPI tile.");
        if (!/Snapshot\s+(?:(?:observed through|generated) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC|freshness unavailable)/u.test(await evidence.innerText())) throw new Error("Evidence details must disclose static-snapshot freshness.");
        if ((await panel.locator(".usage-reuse-section").count()) !== 0) throw new Error("Input reuse must be integrated into the KPI dashboard, not repeated as a full-width section.");
        if ((await panel.getByRole("heading", { name: "Current context composition" }).count()) !== 0) throw new Error("Current context composition must be integrated into the Current context tile.");
        const occupancy = panel.locator(".usage-report-occupancy");
        if ((await occupancy.locator(".usage-context-bar, .usage-occupancy-bar").count()) > 1) throw new Error("Current context must render at most one integrated occupancy/composition bar.");
        const compactionHistory = occupancy.locator(".usage-context-history");
        if ((await compactionHistory.count()) > 0) {
          if ((await compactionHistory.count()) !== 1 || !(await occupancy.innerText()).includes("Current + historical compaction snapshots")) {
            throw new Error("The primary Context tile must expose retained tokens as one bounded compaction-snapshot group.");
          }
          const [currentSize, historySize, supportingSize] = await Promise.all([
            occupancy.locator(".usage-context-current").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
            compactionHistory.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
            panel.locator(".usage-report-lead-facts dd").first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
          ]);
          if (!(currentSize > historySize && historySize > supportingSize)) {
            throw new Error("Current Context, compaction snapshots, and supporting facts must retain a descending visual hierarchy.");
          }
        }
        const reuse = panel.locator(".usage-report-reuse-tile");
        if ((await reuse.count()) !== 1) throw new Error("Usage report must render one integrated Input reuse KPI tile.");
        const structure = panel.locator(".usage-structure-section");
        const structureText = await structure.innerText();
        if (!structureText.includes("token sizes unavailable") && !structureText.includes("Context-layer counts were not observed")) throw new Error("Context structure must disclose unavailable layer-token evidence.");
        const structureList = structure.locator(".usage-structure-list");
        if ((await structureList.count()) > 0 && (await structureList.innerText()).includes("%")) throw new Error("Context structure must not imply token shares from item-count evidence.");
        if ((await structure.locator(".usage-structure-bar").count()) !== 0) throw new Error("Context structure item counts must not render as a proportional composition bar.");
        if ((await structure.locator(".usage-structure-list, .usage-report-unavailable").count()) !== 1) throw new Error("Context structure must render a count inventory or an unavailable state.");
        const explorer = panel.locator("[data-usage-explorer]");
        if (await explorer.evaluate((element) => element.classList.contains("short-session"))) {
          if ((await panel.locator(".usage-overview, .usage-window-toolbar").count()) !== 0) throw new Error("Short Sessions must omit duplicate Overview and window controls.");
        } else {
          if ((await panel.locator(".usage-overview, .usage-window-toolbar").count()) !== 2) throw new Error("Long Sessions must retain Overview and window controls.");
          const startRange = panel.locator('[data-usage-window-edge="start"]');
          const beforeStart = Number(await startRange.inputValue());
          const minStart = Number(await startRange.getAttribute("min"));
          const selectedBefore = await panel.locator("[data-usage-inspect-strip]").getAttribute("data-usage-inspect-position");
          await startRange.focus();
          await page.keyboard.press(beforeStart > minStart ? "ArrowLeft" : "ArrowRight");
          await page.waitForTimeout(100);
          const afterStart = Number(await panel.locator('[data-usage-window-edge="start"]').inputValue());
          const selectedAfter = await panel.locator("[data-usage-inspect-strip]").getAttribute("data-usage-inspect-position");
          if (afterStart === beforeStart) throw new Error("Start range must preserve native Arrow-key adjustment.");
          if (selectedAfter !== selectedBefore) throw new Error("Range Arrow keys must not change the selected Response.");
        }
        const overviewTurns = panel.locator("[data-usage-overview-turn-marker]");
        const overviewTurnCount = await overviewTurns.count();
        if (overviewTurnCount > 0) {
          if ((await overviewTurns.locator("title").count()) !== overviewTurnCount) {
            throw new Error("Every Overview prompt marker must expose its retained prompt preview.");
          }
          if ((await overviewTurns.locator(".usage-overview-prompt-tooltip").count()) !== overviewTurnCount) {
            throw new Error("Every Overview prompt marker must render a prompt-first tooltip.");
          }
          if ((await overviewTurns.locator("[tabindex]").count()) !== 0) throw new Error("Prompt markers must not add per-marker tab stops.");
          if ((await overviewTurns.locator(".usage-overview-turn-label").count()) !== overviewTurnCount) throw new Error("Every Overview prompt marker must retain its compact Tn anchor.");
          if ((await panel.locator("[data-usage-prompt-marker]").count()) !== 0) throw new Error("The duplicate Focus prompt lane must remain absent.");
          const overviewChart = panel.locator("[data-usage-overview-chart]");
          if ((await overviewChart.getAttribute("tabindex")) !== "0") throw new Error("Overview must expose one composite keyboard stop for linked prompts.");
          const firstPromptMarker = overviewTurns.first();
          const responsePosition = await firstPromptMarker.getAttribute("data-usage-response-position");
          if ((page.viewportSize()?.width ?? 0) <= 520) {
            const promptActions = panel.locator(".usage-overview-prompt-actions button");
            if ((await promptActions.count()) !== overviewTurnCount) throw new Error("Narrow Overview must expose one touch action per linked prompt.");
            if ((await panel.locator('.usage-overview-prompt-actions button[tabindex="0"]').count()) !== 0) throw new Error("Narrow prompt actions must not duplicate the Overview keyboard stop.");
            if ((await panel.locator('.usage-overview-prompt-actions button[aria-pressed="true"]').count()) !== 1) throw new Error("Narrow prompt actions must expose the linked turn's selected state.");
            const undersized = await promptActions.evaluateAll((buttons) => buttons.filter((button) => {
              const rect = button.getBoundingClientRect();
              return rect.width < 44 || rect.height < 44;
            }).length);
            if (undersized > 0) throw new Error("Narrow linked-prompt actions must be at least 44px in both dimensions.");
            await promptActions.first().click();
            if ((await panel.locator(".usage-overview-prompt-actions button").first().getAttribute("aria-pressed")) !== "true") {
              throw new Error("Narrow prompt actions must update the selected turn after activation.");
            }
          } else {
            await firstPromptMarker.locator(".usage-overview-turn-hit").hover();
            await page.waitForTimeout(150);
            if ((await firstPromptMarker.locator(".usage-overview-prompt-tooltip").evaluate((tooltip) => getComputedStyle(tooltip).opacity)) !== "1") {
              throw new Error("Overview prompt tooltip must be visible on hover.");
            }
            await firstPromptMarker.locator(".usage-overview-turn-hit").click();
          }
          if (responsePosition !== await panel.locator("[data-usage-inspect-strip]").getAttribute("data-usage-inspect-position")) {
            throw new Error("Overview prompt markers must select their linked response.");
          }
        }
        if ((await panel.locator(".usage-response-table, .usage-response-head, .usage-response-row").count()) !== 0) {
          throw new Error("Context progression must not repeat chart responses in a table.");
        }
        const inspectStrip = panel.locator("[data-usage-inspect-strip]");
        const focusPoints = panel.locator("[data-usage-focus-point]");
        if ((await inspectStrip.count()) !== 1 || (await focusPoints.count()) === 0) {
          throw new Error("Context progression must expose one Inspect strip and one hover target per visible response.");
        }
        const lockedPosition = await inspectStrip.getAttribute("data-usage-inspect-position");
        const lockedDetail = await panel.locator(".usage-response-detail header strong").innerText();
        const target = lockedPosition === await focusPoints.first().getAttribute("data-usage-response-position") && (await focusPoints.count()) > 1
          ? focusPoints.nth(1)
          : focusPoints.first();
        const targetPosition = await target.getAttribute("data-usage-response-position");
        await target.locator(".usage-focus-point-hit").hover();
        await page.waitForTimeout(100);
        if ((await inspectStrip.getAttribute("data-usage-inspect-mode")) !== "hover"
          || (await inspectStrip.getAttribute("data-usage-inspect-position")) !== targetPosition) {
          throw new Error("Hovering a context response must update the docked Inspect strip.");
        }
        if ((await panel.locator(".usage-response-detail header strong").innerText()) !== lockedDetail) {
          throw new Error("Hover must not replace the locked Response details selection.");
        }
        if ((await target.locator(".usage-hover-point").evaluate((point) => getComputedStyle(point).opacity)) !== "1") {
          throw new Error("The hovered response must expose its point and guide without covering the chart.");
        }
        await panel.locator(".usage-context-chart .chart-toolbar").hover();
        await page.waitForTimeout(50);
        if ((await inspectStrip.getAttribute("data-usage-inspect-mode")) !== "selected"
          || (await inspectStrip.getAttribute("data-usage-inspect-position")) !== lockedPosition) {
          throw new Error("Leaving a hovered response must restore the locked Inspect strip values.");
        }
        await target.locator(".usage-focus-point-hit").click();
        if ((await panel.locator("[data-usage-inspect-strip]").getAttribute("data-usage-inspect-position")) !== targetPosition) {
          throw new Error("Clicking a hovered response must lock the same response in the Inspect strip and detail pane.");
        }
        await page.waitForTimeout(300);
        return undefined;
      },
    },
    {
      label: "session-replay",
      enter: async () => {
        const back = page.locator(".usage-report-return");
        if ((await back.count()) > 0 && await back.isVisible()) {
          await back.click();
          await page.waitForFunction(() => !new URLSearchParams(location.search).has("session-mode"));
          await page.waitForFunction(() => document.querySelector('[data-session-mode-panel="trace"]') === document.activeElement);
        }
        const replay = page.locator(".session-mode-tabs button", { hasText: "Replay" }).first();
        if ((await replay.count()) === 0) return "skip";
        const trace = page.locator(".session-mode-tabs button", { hasText: "Trace" }).first();
        await trace.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => new URLSearchParams(location.search).get("session-mode") === "replay");
        await page.waitForTimeout(500);
        return undefined;
      },
    },
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Playwright is not installed. Install it before running the visual contract check.");
    process.exit(2);
  }

  const reportPath = await resolveReportPath(options.report);
  const outDir = options.out;
  if (outDir) await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const failures = [];

  for (const mode of LAYOUT_MODES) {
    const page = await browser.newPage({ viewport: { width: mode.width, height: mode.height } });
    const pageProblems = [];
    page.on("console", message => {
      if (message.type() === "error") pageProblems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", error => pageProblems.push(`pageerror: ${error.message}`));

    await page.goto(pathToFileURL(reportPath).href, { waitUntil: "load" });
    await page.waitForTimeout(400);

    for (const surface of await surfacesFor(page)) {
      if (surface.enter && (await surface.enter()) === "skip") continue;

      const measured = await page.evaluate(measureContract, MIN_MEANINGFUL_FONT_PX);
      const problems = [];
      if (measured.tooSmall.length > 0) {
        problems.push(`${measured.tooSmall.length} element(s) below ${MIN_MEANINGFUL_FONT_PX}px`);
      }
      if (measured.clipped.length > 0) {
        problems.push(`${measured.clipped.length} element(s) clip text with no ellipsis or scroll`);
      }
      if (measured.documentOverflow > 1) {
        problems.push(`document overflows horizontally by ${measured.documentOverflow}px`);
      }
      if (measured.outlineOverflow > 1) {
        problems.push(`Session outline overflows horizontally by ${measured.outlineOverflow}px`);
      }
      if (mode.name === "wide" && measured.primaryWidthRatio !== null && measured.primaryWidthRatio < 0.5) {
        problems.push(`primary Session evidence uses only ${Math.round(measured.primaryWidthRatio * 100)}% of the viewport`);
      }
      if (mode.name === "wide" && surface.label === "session-trace" && measured.outlineUsageOffset !== null && measured.outlineUsageOffset > 230) {
        problems.push(`Usage decision begins ${Math.round(measured.outlineUsageOffset)}px below the Session outline top`);
      }
      if (mode.name === "narrow" && surface.label === "session-trace" && measured.outlineTargetMinHeight !== null && measured.outlineTargetMinHeight < 44) {
        problems.push(`Session outline target height falls to ${Math.round(measured.outlineTargetMinHeight)}px`);
      }
      if (pageProblems.length > 0) problems.push(`${pageProblems.length} page/console error(s)`);

      const id = `${mode.name} ${mode.width}x${mode.height} [${surface.label}]`;
      console.log(
        `${problems.length === 0 ? "PASS" : "FAIL"} ${id} ` +
          `overflow=${measured.documentOverflow}px belowFloor=${measured.tooSmall.length} ` +
          `outlineOverflow=${measured.outlineOverflow}px clipped=${measured.clipped.length} errors=${pageProblems.length}`,
      );
      for (const entry of measured.tooSmall.slice(0, 8)) {
        console.log(`       ${entry.fontSize}px ${entry.selector} :: ${entry.text}`);
      }
      for (const entry of measured.clipped.slice(0, 8)) {
        console.log(`       clipped ${entry.overflow}px ${entry.selector} :: ${entry.text}`);
      }
      for (const problem of pageProblems.slice(0, 5)) console.log(`       ${problem}`);

      if (problems.length > 0) failures.push(`${id}: ${problems.join("; ")}`);
      if (outDir) {
        await page.screenshot({ path: join(outDir, `${mode.name}-${surface.label}.png`) });
      }
    }
    await page.close();
  }

  await browser.close();

  if (failures.length === 0) {
    console.log(`\nVisual contract holds across ${LAYOUT_MODES.length} layout modes.`);
    return;
  }
  console.error(`\n${failures.length} visual contract failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
}

await main();
