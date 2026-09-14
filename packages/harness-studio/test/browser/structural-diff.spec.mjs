import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { startHarnessStudioServer } from "../../dist/server/server.js";

/**
 * The structural reading at every layout the workbench has to survive.
 *
 * The provider is a stub: this spec owns layout, keyboard reach, overflow and
 * console health. That the engine narrows the change correctly is asserted
 * against the real host in test/structural-diff.native.ts.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The surface Studio actually paints, so a theme assertion names a real colour
 * rather than a class name. Sampled from the shell because `body` is allowed to
 * stay transparent behind it.
 */
async function themeSurface(page) {
  return page.evaluate(() => {
    const target = document.querySelector(".studio-shell") ?? document.body;
    return getComputedStyle(target).backgroundColor;
  });
}

const OLD_LINE = "  return <div data-id={props.id} />;";
const NEW_LINE = "  return <div data-id={props.id} data-label={props.label} />;";

/** Mirrors what the engine returns for this fixture: only the added attribute is novel. */
const structuralDiff = {
  kind: "StructuralDiffV1",
  language: "TypeScript TSX",
  status: "changed",
  lines: [
    {
      lhs: { lineNumber: 1, segments: [{ text: "export function Row(props: { id: string }) {", novel: false, highlight: "normal" }] },
      rhs: { lineNumber: 1, segments: [
        { text: "export function Row(props: { id: string", novel: false, highlight: "normal" },
        { text: "; label", novel: true, highlight: "normal" },
        { text: ": ", novel: false, highlight: "normal" },
        { text: "string", novel: true, highlight: "type" },
        { text: " }) {", novel: false, highlight: "delimiter" },
      ] },
    },
    {
      lhs: { lineNumber: 2, segments: [{ text: OLD_LINE, novel: false, highlight: "normal" }] },
      rhs: { lineNumber: 2, segments: [
        { text: "  return <div data-id={props.id}", novel: false, highlight: "normal" },
        { text: " data-label={props.label}", novel: true, highlight: "normal" },
        { text: " />;", novel: false, highlight: "normal" },
      ] },
    },
    {
      lhs: { lineNumber: 3, segments: [{ text: "}", novel: false, highlight: "normal" }] },
      rhs: { lineNumber: 3, segments: [{ text: "}", novel: false, highlight: "normal" }] },
    },
  ],
};

let studio;
let workspace;

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "studio-structural-browser-"));
  const git = (...args) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.name", "Studio Browser");
  git("config", "user.email", "browser@example.com");
  await writeFile(join(workspace, "view.tsx"), [
    "export function Row(props: { id: string }) {",
    OLD_LINE,
    "}",
    "",
  ].join("\n"), "utf8");
  git("add", "view.tsx");
  git("commit", "-m", "feat: add row");
  await writeFile(join(workspace, "view.tsx"), [
    "export function Row(props: { id: string; label: string }) {",
    NEW_LINE,
    "}",
    "",
  ].join("\n"), "utf8");
  git("add", "view.tsx");
  git("commit", "-m", "feat: label the row");

  studio = await startHarnessStudioServer({
    appDir: join(packageRoot, "dist", "app"),
    port: 0,
    // Records the request so the spec can prove the client asked for text, not offsets.
    structuralDiffProvider: {
      structuralDiff: async (params) => {
        recorded = params;
        return structuralDiff;
      },
    },
    workspaceDirectoryPicker: async () => workspace,
    workspaceSessionProvider: { discover: async () => ({ label: "structural-fixture", sessions: [] }) },
  });
  const opened = await fetch(`${studio.url}/api/workspace/open`, { method: "POST" });
  if (!opened.ok) throw new Error(`Could not open Git fixture: ${await opened.text()}`);
});

let recorded;

test.afterAll(async () => {
  await studio?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function openCommitView(page, { narrow }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  // Studio follows the host appearance, so the theme flow needs a known start.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${studio.url}/#/commits`);
  // Below the stacking breakpoint the panes sit behind their own tabs, and the
  // commit list is not the one that opens first.
  if (narrow) await page.locator(".git-narrow-tabs").getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("row", { name: /feat: label the row/ }).click();
  await page.getByRole("button", { name: /view\.tsx/ }).click();
  await expect(page.locator(".artifact-code-view")).toBeVisible();
  return errors;
}

const widths = [
  { name: "wide", width: 1440, height: 960 },
  { name: "compact", width: 1080, height: 900 },
  { name: "narrow", width: 390, height: 844 },
];

for (const { name, width, height } of widths) {
  test(`shows the structural reading at ${name} width in light and dark`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // The workbench stacks behind tabs and then stacks its two sides at or
    // below 760px, matching the stylesheet.
    const narrow = width <= 760;
    const errors = await openCommitView(page, { narrow });

    // Textual is the default reading.
    const textual = page.getByRole("button", { name: "Textual", exact: true });
    const structural = page.getByRole("button", { name: "Structural", exact: true });
    await expect(structural).toBeVisible();
    await expect(textual).toHaveAttribute("aria-pressed", "true");
    await expect(structural).toHaveAttribute("aria-pressed", "false");

    // Keyboard reach: the switch is a real control, not a decoration.
    await textual.focus();
    await page.keyboard.press("Tab");
    await expect(structural).toBeFocused();
    await page.keyboard.press("Enter");

    const view = page.locator(".structural-diff");
    await expect(view).toHaveAttribute("data-structural-diff", "ready");
    await expect(structural).toHaveAttribute("aria-pressed", "true");
    await expect(view.locator(".structural-diff-summary")).toContainText("TypeScript TSX");

    // Only the added text is marked, and only ever on the newer side. Syntax
    // highlighting can split one flagged run across token boundaries, so the
    // assertion is on the concatenated novel text, not on the span count.
    await expect(view.locator('.structural-diff-side[data-side="lhs"] [data-novel="true"]')).toHaveCount(0);
    const addedText = async (line, revision) => (await view
      .locator(`.structural-diff-row[data-line="${line}"] .structural-diff-side[data-side="${revision}"] [data-novel="true"]`)
      .allInnerTexts()).join("");
    // Line 1 gained a property; the rest of the signature is untouched.
    expect(await addedText(0, "rhs")).toBe("; labelstring");
    // Line 2 gained one attribute, so the whole line is not reported as rewritten.
    expect(await addedText(1, "rhs")).toBe(" data-label={props.label}");
    // Line 3 is untouched on both sides.
    await expect(view.locator('.structural-diff-row[data-line="2"] [data-novel="true"]')).toHaveCount(0);

    // Each side still renders its own full line: the segmentation is additive.
    const rhsLine = view.locator('.structural-diff-row[data-line="1"] .structural-diff-side[data-side="rhs"] .structural-diff-code');
    await expect(rhsLine).toHaveText(NEW_LINE);
    const lhsLine = view.locator('.structural-diff-row[data-line="1"] .structural-diff-side[data-side="lhs"] .structural-diff-code');
    await expect(lhsLine).toHaveText(OLD_LINE);

    // The code is highlighted like every other Studio code surface: the
    // unchanged text around the change carries syntax colour, not just the
    // flagged runs. Before this it was plain text with only polarity colour.
    await expect(view).toHaveAttribute("data-highlight-state", "highlighted");
    const paletteSize = await view.locator(".structural-diff-code span[style*='color']").evaluateAll(
      (spans) => new Set(spans.map((span) => span.style.color)).size,
    );
    expect(paletteSize).toBeGreaterThan(1);
    // A flagged run keeps its polarity: the added attribute still reads as added
    // even though its tokens now carry the theme's foreground.
    const novelRun = view.locator('.structural-diff-row[data-line="1"] .structural-diff-side[data-side="rhs"] .structural-diff-run').first();
    const runBackground = await novelRun.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(runBackground).not.toBe("rgba(0, 0, 0, 0)");

    // The change navigator moves by region, not by row, and wraps at both ends.
    // The two changed lines are contiguous, so they are one region, not two.
    const position = view.locator(".structural-diff-nav > span");
    const next = view.getByRole("button", { name: "Next change" });
    const previous = view.getByRole("button", { name: "Previous change" });
    await expect(position).toHaveText("1 changed regions");
    await next.click();
    await expect(position).toHaveText("Change 1 of 1");
    // A single region wraps onto itself rather than becoming unreachable.
    await next.click();
    await expect(position).toHaveText("Change 1 of 1");
    await previous.click();
    await expect(position).toHaveText("Change 1 of 1");
    // The position is a live region, so the move is announced, not silent.
    await expect(position).toHaveAttribute("aria-live", "polite");
    // The marker column names the change kind on the changed rows.
    await expect(view.locator('.structural-diff-marker[data-change="added"]')).toHaveCount(2);

    // The client asked for text; the engine is never handed a path to open.
    expect(recorded).toMatchObject({ path: "view.tsx" });
    expect(recorded.before).toContain(OLD_LINE);
    expect(recorded.after).toContain(NEW_LINE);

    // A long line stays inside the pane: the diff scrolls itself rather than
    // widening the document, which is what keeps the layout bounded.
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    if (narrow) {
      // Stacked, each row still shows both revisions with their own line number,
      // so the correspondence survives even without two columns.
      const row = view.locator('.structural-diff-row[data-line="1"]');
      await expect(row.locator('.structural-diff-side[data-side="lhs"] .structural-diff-number')).toHaveText("2");
      await expect(row.locator('.structural-diff-side[data-side="rhs"] .structural-diff-number')).toHaveText("2");
    } else {
      // Both revisions are on screen at once; a split view that pushes the newer
      // side off the pane would make the reader scroll to find it.
      const columns = await view.locator('.structural-diff-row[data-line="1"] .structural-diff-side').evaluateAll((sides) => {
        const pane = document.querySelector(".git-file-diff").getBoundingClientRect();
        return sides.map((side) => {
          const box = side.getBoundingClientRect();
          return { left: box.left, width: box.width, visible: box.left < pane.right };
        });
      });
      expect(columns).toHaveLength(2);
      expect(columns.every((column) => column.visible)).toBe(true);
      // Equal halves: neither side is squeezed by the other's content.
      expect(Math.abs(columns[0].width - columns[1].width)).toBeLessThanOrEqual(1);

      // Nothing wrapped: every cell is exactly one line tall, so the two
      // revisions stay on the same visual line.
      const lineHeights = await view.locator(".structural-diff-code").evaluateAll((codes) => codes.map((code) => {
        const line = Number.parseFloat(getComputedStyle(code).lineHeight);
        return code.getBoundingClientRect().height / line;
      }));
      expect(lineHeights.every((height) => Math.abs(height - 1) < 0.15)).toBe(true);
    }

    // Studio follows the host appearance. Driving it through the emulated host
    // keeps the sidebar pop-up out of the capture, which at narrow widths would
    // otherwise overlay the surface under review.
    await page.screenshot({ path: test.info().outputPath(`structural-diff-${name}-dark.png`), fullPage: true });
    const darkSurface = await themeSurface(page);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(async () => themeSurface(page)).not.toBe(darkSurface);
    await page.screenshot({ path: test.info().outputPath(`structural-diff-${name}-light.png`), fullPage: true });

    expect(errors).toEqual([]);
  });
}
