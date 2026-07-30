import { buildEvidencePack } from "../../core-change-watch/evidence-pack.mjs";
import { availableLane } from "./contract.mjs";

export async function collectProjectHarness(context, options = {}, dependencies = {}) {
  const collect = dependencies.buildEvidencePack ?? buildEvidencePack;
  const data = await collect({
    cwd: context.topology?.gitRoot ?? context.workspace,
    analysisScope: context.analysisScope,
    topology: context.topology,
    baseRef: options["base-ref"] ?? options.baseRef ?? "HEAD",
    ...(context.analysisScope?.kind === "path"
      ? { packageRelPath: context.analysisScope.route }
      : {}),
  });
  if (data?.kind !== "core-change-watch-evidence-pack") {
    throw Object.assign(new Error("project evidence returned an invalid contract"), {
      code: "INVALID_PROJECT_HARNESS_EVIDENCE",
    });
  }
  if (data.status !== "ok") {
    return availableLane(data, "partial");
  }
  return availableLane(data);
}
