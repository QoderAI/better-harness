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
  const { renderHarnessInspectorDemoHtml } = await import("./demo-report.mjs");
  const directory = await mkdtemp(join(tmpdir(), "harness-inspector-visual-"));
  const path = join(directory, "report.html");
  await writeFile(path, renderHarnessInspectorDemoHtml(), "utf8");
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
        await page.locator("[data-session-mode-panel=usage]").waitFor({ state: "visible" });
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
        }
        const replay = page.locator(".session-mode-tabs button", { hasText: "Replay" }).first();
        if ((await replay.count()) === 0) return "skip";
        await replay.click();
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
