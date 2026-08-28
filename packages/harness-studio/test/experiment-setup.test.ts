import { describe, expect, it } from "vitest";
import {
  canLockCompare,
  countLaneMaterializations,
  deriveCompareScenario,
  deriveRequestProvenance,
  isExperimentRunnable,
  type ExperimentSetupPreview,
} from "../src/contracts/experiment-setup.js";

describe("checkpoint-backed compare setup", () => {
  it("derives historical replay only when observed history is present", () => {
    expect(deriveCompareScenario([{ origin: "execute", trials: 1 }])).toBe("new-request-compare");
    expect(deriveCompareScenario([
      { origin: "observed" },
      { origin: "execute", trials: 1 },
    ])).toBe("historical-replay");
  });

  it("counts one isolated materialization per fresh trial", () => {
    expect(countLaneMaterializations([
      { origin: "observed" },
      { origin: "execute", trials: 2 },
      { origin: "execute", trials: 3 },
    ])).toBe(5);
  });

  it("keeps an imported request unverified until its prompt hash matches history", () => {
    expect(deriveRequestProvenance([{ origin: "observed" }], "sha256:task")).toBe("unverified-history");
    expect(deriveRequestProvenance([
      { origin: "observed", identity: { promptHash: "sha256:task" } },
    ], "sha256:task")).toBe("verified-history");
  });

  it("locks a generic versioned-file adapter without requiring Git fields", () => {
    const setup: ExperimentSetupPreview = {
      scenario: "new-request-compare",
      checkpointSource: {
        status: "ready",
        adapter: { id: "pptx-history-v1", label: "Versioned presentation" },
        resource: { label: "Presentation", value: "launch-review.pptx" },
        revision: { label: "Version", value: "v42" },
        history: { label: "Edit history", value: "change-108" },
        materialization: {
          label: "Isolated document copy",
          value: "3 isolated copies",
          timing: "on-run",
          count: 3,
        },
        capabilities: {
          isolatedMaterialization: true,
          observedHistory: true,
          preserveResult: true,
        },
      },
      request: {
        label: "New request",
        prompt: "Compare three slide revisions.",
        promptHash: "sha256:task",
        provenance: "new",
      },
      historicalGaps: [],
    };

    expect(canLockCompare(setup)).toBe(true);
    expect(isExperimentRunnable(setup)).toBe(true);
    expect(isExperimentRunnable({
      ...setup,
      checkpointSource: { ...setup.checkpointSource, status: "unavailable", limitation: "Revision missing." },
    })).toBe(false);
  });
});
