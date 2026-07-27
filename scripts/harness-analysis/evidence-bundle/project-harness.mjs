import { buildEvidencePack } from "../../core-change-watch/evidence-pack.mjs";
import { availableLane } from "./contract.mjs";

export async function collectProjectHarness(context, _options = {}, dependencies = {}) {
  const collect = dependencies.buildEvidencePack ?? buildEvidencePack;
  const data = await collect({ cwd: context.workspace });
  if (data?.kind !== "core-change-watch-evidence-pack") {
    throw Object.assign(new Error("project evidence returned an invalid contract"), {
      code: "INVALID_PROJECT_HARNESS_EVIDENCE",
    });
  }
  return availableLane(data);
}
