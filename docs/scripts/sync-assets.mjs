// Sync published assets from the repository root into docs/static/.
// assets/ stays the single source of truth; synced targets are gitignored.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHarnessInspectorDemoHtml } from "../../scripts/harness-inspector/demo-report.mjs";

export function syncAssets({ repoRoot, siteRoot }) {
  const generatedDemoRoot = join(siteRoot, "static", "demo");

  // The whole target is generated from repository-owned assets. Recreate it so
  // renamed routes cannot leave stale files in local production previews.
  rmSync(generatedDemoRoot, { recursive: true, force: true });

  const copies = [
    {
      from: join(repoRoot, "assets", "demo", "better-harness-report.html"),
      to: join(generatedDemoRoot, "better-harness-report", "index.html"),
    },
    {
      from: join(repoRoot, "assets", "demo", "better-harness-findings-report.png"),
      to: join(generatedDemoRoot, "better-harness-findings-report.png"),
    },
    {
      from: join(repoRoot, "assets", "demo", "twenty-history.png"),
      to: join(generatedDemoRoot, "twenty-history.png"),
    },
    {
      from: join(repoRoot, "assets", "agent-work-loop-en.svg"),
      to: join(siteRoot, "static", "img", "agent-work-loop-en.svg"),
    },
    {
      from: join(repoRoot, "assets", "better-harness-architecture-en.svg"),
      to: join(siteRoot, "static", "img", "better-harness-architecture-en.svg"),
    },
    {
      from: join(repoRoot, "assets", "install", "codex-add-marketplace.jpg"),
      to: join(siteRoot, "static", "img", "codex-add-marketplace.jpg"),
    },
    {
      from: join(
        repoRoot,
        "docs",
        "assets",
        "harness-inspector",
        "session-view.png",
      ),
      to: join(generatedDemoRoot, "harness-inspector", "session-view.png"),
    },
  ];

  for (const { from, to } of copies) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  const inspectorDemo = join(generatedDemoRoot, "harness-inspector", "index.html");
  mkdirSync(dirname(inspectorDemo), { recursive: true });
  writeFileSync(inspectorDemo, renderHarnessInspectorDemoHtml(), "utf8");

  return copies.length + 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const siteRoot = resolve(dirname(currentFile), "..");
  const repoRoot = resolve(siteRoot, "..");
  const copyCount = syncAssets({ repoRoot, siteRoot });
  console.log(`Synced ${copyCount} asset target(s) into docs/static/.`);
}
