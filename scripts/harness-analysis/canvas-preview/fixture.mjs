import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_WORK_LOOP_DIMENSIONS,
  AGENT_WORK_LOOP_MODEL_ID,
  AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
} from "../fluency-dimensions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(__dirname, "../../..");
const DEFAULT_CANVAS_TEMPLATE = "templates/canvas/better-harness-insights.canvas.tsx";
const LEARNING_CAPTURE_DESCRIPTOR = AGENT_WORK_LOOP_DIMENSIONS.find((dimension) => dimension.id === "learning-capture");

const DEFAULT_PREVIEW_REPORT = Object.freeze({
  summary: {
    projectName: "Better Harness preview fixture",
    locale: "en",
    modelId: AGENT_WORK_LOOP_MODEL_ID,
    reportContractVersion: AGENT_WORK_LOOP_REPORT_CONTRACT_VERSION,
    strengths: ["The preview fixture exercises the current Canvas report contract."],
    dimensions: [
      { id: "task-understanding", label: "Task Understanding", score: 82, summary: "Goals, context, and scope are visible.", findingRefs: [] },
      { id: "controlled-execution", label: "Controlled Execution", score: 76, summary: "Project operation stays within instructions and permissions.", findingRefs: [] },
      { id: "change-validation", label: "Change Validation", score: 70, summary: "Focused validation is available.", findingRefs: [] },
      { id: "reliable-delivery", label: "Reliable Delivery", score: 71, summary: "Acceptance evidence, approval, and recovery are represented.", findingRefs: [] },
      { id: "learning-capture", label: LEARNING_CAPTURE_DESCRIPTOR.label, score: 64, summary: "Recurring release guidance is reusable and maintainable; validation in a later similar task is still pending.", findingRefs: ["learning-capture-preview"] },
    ],
    aiAgentPractice: {
      inspectedSurfaces: ["Rules", "Skills", "Custom Agents", "Hooks", "MCP"],
      coverageRows: [{
        surface: "Rules",
        count: 1,
        scopes: ["Project"],
        paths: ["AGENTS.md"],
      }, {
        surface: "Skills",
        count: 3,
        scopes: ["Project"],
        paths: ["skills/better-harness/SKILL.md"],
      }, {
        surface: "Custom Agents",
        count: 2,
        scopes: ["Project"],
      }, {
        surface: "Hooks",
        count: 11,
        scopes: ["Project"],
        paths: [".qoder/settings.json"],
      }, {
        surface: "MCP",
        count: 2,
        scopes: ["Project"],
        paths: [".qoder/mcp.json"],
      }],
    },
    atAGlance: {
      coverage: { episodeCount: 2, editedEpisodeCount: 1, closedEpisodeCount: 1, recoveredEpisodeCount: 0 },
      priorityMoves: [],
    },
  },
  findings: [{
    id: "learning-capture-preview",
    title: "Preview a learning-capture finding",
    severity: "Low",
    reason: "This fixture verifies that the compact practice-source and learning-and-knowledge paths render together.",
    expectedOutput: ["Update the test in `templates/canvas/better-harness-insights.canvas.tsx` so the preview exposes the current finding-detail contract before release."],
    expectedArtifact: "Test",
    dimensionRefs: ["learning-capture"],
    aiFixPrompt: "Review the preview fixture only; do not modify project files.",
  }],
});

const DEFAULT_PREVIEW_CANVAS_DATA = Object.freeze({
  schemaVersion: 1,
  summary: {},
  dimensions: [{
    id: "learning-capture",
    level: "Exercised",
    subdimensions: LEARNING_CAPTURE_DESCRIPTOR.subdimensions.map((descriptor, index) => ({
      id: descriptor.id,
      label: descriptor.label,
      state: index < 2 ? "Exercised" : "Wired",
      level: index < 2 ? "Exercised" : "Wired",
    })),
  }],
  findings: [],
});

export async function createDefaultCanvasPreviewFixture({ repoRoot = defaultRepoRoot } = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "better-harness-canvas-preview-"));
  const canvasPath = path.join(fixtureRoot, "insights.canvas.tsx");
  const findingsPath = path.join(fixtureRoot, "findings.json");
  const canvasDataPath = path.join(fixtureRoot, "canvas.json");
  const sourceTemplate = path.resolve(repoRoot, DEFAULT_CANVAS_TEMPLATE);
  try {
    await copyFile(sourceTemplate, canvasPath);
    await writeFile(findingsPath, `${JSON.stringify(DEFAULT_PREVIEW_REPORT, null, 2)}\n`, "utf8");
    await writeFile(canvasDataPath, `${JSON.stringify(DEFAULT_PREVIEW_CANVAS_DATA, null, 2)}\n`, "utf8");
  } catch (error) {
    await rm(fixtureRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    root: fixtureRoot,
    canvasPath,
    close: () => rm(fixtureRoot, { recursive: true, force: true }),
  };
}
