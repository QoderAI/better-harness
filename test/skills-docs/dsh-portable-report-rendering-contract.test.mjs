import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { HOST_CAPABILITIES, hostIdsFor } from "../../scripts/host-support/index.mjs";

const ROOT = process.cwd();
const CLI_PATH = path.join(ROOT, "scripts", "better-harness.mjs");

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function markdownTable(markdown, expectedHeaders) {
  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith("|")) return false;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    return cells.length === expectedHeaders.length
      && cells.every((cell, index) => cell === expectedHeaders[index]);
  });
  assert.notEqual(headerIndex, -1, `missing Markdown table: ${expectedHeaders.join(" | ")}`);
  const rows = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, expectedHeaders.length, `invalid Markdown row: ${line}`);
    rows.push(Object.fromEntries(expectedHeaders.map((header, index) => [header, cells[index]])));
  }
  return rows;
}

function selectDeclaredReportRoute(rows, { host, output }) {
  const byRoute = new Map(rows.map((row) => [row.Route, row]));
  if (output === "inline" || output === "no-files") return byRoute.get("Inline only") ?? null;
  if (host === "Qoder") return byRoute.get("Qoder Canvas report") ?? null;
  if (host === "Cursor") return byRoute.get("Cursor Canvas report") ?? null;
  const portable = byRoute.get("Portable HTML report") ?? null;
  return portable?.["Use when"].includes(host) ? portable : null;
}

test("parsed report routing selects portable HTML for durable DSH and inline for explicit no-files", () => {
  const rows = markdownTable(read("templates/reporting/routing.md"), [
    "Route",
    "Use when",
    "Artifacts",
    "Runtime owner",
  ]);
  const byRoute = new Map(rows.map((row) => [row.Route, row]));

  assert.equal(byRoute.get("Qoder Canvas report")?.["Use when"], "Active host is Qoder");
  assert.equal(byRoute.get("Cursor Canvas report")?.["Use when"], "Active host is Cursor");
  const portable = selectDeclaredReportRoute(rows, {
    host: "DeepSeek Harness",
    output: "durable",
  });
  assert.ok(portable);
  assert.equal(portable.Route, "Portable HTML report");
  assert.equal(portable["Use when"].includes("DeepSeek Harness"), true);
  assert.equal(
    portable.Artifacts,
    "renderer-owned `findings.json`, `report.md`, `report.html`",
  );
  assert.equal(portable["Runtime owner"], "`html-visual.md`");

  const inline = selectDeclaredReportRoute(rows, {
    host: "DeepSeek Harness",
    output: "no-files",
  });
  assert.deepEqual(inline, {
    Route: "Inline only",
    "Use when": "Inline or no-files output is explicitly requested",
    Artifacts: "none; inline analysis writes nothing",
    "Runtime owner": "none",
  });
  assert.notEqual(inline.Route, portable.Route);
  assert.equal(inline["Runtime owner"], "none");
});

test("canonical public matrices advertise bounded DSH portable output without Canvas or Checkup", () => {
  const sourceRows = markdownTable(read("docs/adapters/README.md"), [
    "Host",
    "Positioning",
    "Shell",
    "Configured Assets",
    "Session Evidence",
    "Default Output",
    "Rules / Prompts",
    "Smoke",
  ]);
  const publicRows = markdownTable(read("docs/docs/hosts/adapter-matrix.md"), [
    "Host",
    "Public entry",
    "Positioning",
    "Shell",
    "Session Evidence",
    "Default Output",
  ]);
  const sourceDsh = sourceRows.find((row) => row.Host === "DeepSeek Harness (DSH)");
  const publicDsh = publicRows.find((row) => row.Host === "DeepSeek Harness (DSH)");

  assert.ok(sourceDsh);
  assert.ok(publicDsh);
  assert.equal(sourceDsh["Default Output"], "self-contained HTML + Markdown");
  assert.equal(publicDsh["Default Output"], "Self-contained HTML + Markdown");
  for (const row of [sourceDsh, publicDsh]) {
    const text = Object.values(row).join(" ");
    assert.equal(text.includes("Canvas"), false);
    assert.equal(text.toLowerCase().includes("full dsh support"), false);
  }
  assert.equal(hostIdsFor(HOST_CAPABILITIES.CHECKUP).includes("dsh"), false);
});

test("public DSH docs identify the Better Harness-owned report root", () => {
  const source = read("docs/adapters/README.md");
  const publicMatrix = read("docs/docs/hosts/adapter-matrix.md");
  for (const document of [source, publicMatrix]) {
    assert.equal(document.includes("<target>/.dsh/better-harness"), true);
    assert.equal(document.includes("Better Harness-owned"), true);
  }
});

test("executed DSH no-files evidence path creates no report state", () => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "better-harness-dsh-no-files-"));
  try {
    const target = path.join(scratch, "target with 空格");
    const dshHome = path.join(scratch, "dsh home");
    mkdirSync(target, { recursive: true });
    mkdirSync(dshHome, { recursive: true });
    const command = [
      CLI_PATH,
      "harness",
      "evidence-bundle",
      "--platform", "dsh",
      "--workspace", target,
      "--cwd", target,
      "--dsh-home", dshHome,
      "--language", "en",
      "--depth", "quick",
      "--since", "2026-08-18T00:00:00.000Z",
      "--until", "2026-08-25T00:00:00.000Z",
      "--format", "json",
    ];
    const result = spawnSync(process.execPath, command, {
      cwd: ROOT,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).kind, "better-harness.evidence-bundle");
    const reportRoot = path.join(target, ".dsh", "better-harness");
    assert.equal(existsSync(reportRoot), false);
    assert.equal(existsSync(path.join(target, ".dsh")), false);
    for (const artifact of ["findings.json", "report.md", "report.html"]) {
      assert.equal(existsSync(path.join(reportRoot, artifact)), false);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
