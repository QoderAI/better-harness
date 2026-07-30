import { collectAssetBaseline } from "../../coding-agent-practices/asset-baseline.mjs";
import { availableLane, unavailableLane } from "./contract.mjs";

const ASSET_PROVIDERS = new Set(["qoder", "codex", "claude", "cursor", "qwen", "copilot", "pi", "workbuddy"]);

export async function collectAgentCustomize(context, options = {}, dependencies = {}) {
  if (!ASSET_PROVIDERS.has(context.provider)) {
    return unavailableLane("agent-customize", { code: "UNSUPPORTED_AGENT_CUSTOMIZE_PROVIDER" });
  }
  const collect = dependencies.collectAssetBaseline ?? collectAssetBaseline;
  const data = await collect({
    provider: context.provider,
    workspace: context.workspace,
    language: context.language,
    topology: context.topology,
    analysisScope: context.analysisScope,
    "include-user-home": context.authority.includeUserHome,
    "include-memories": context.authority.includeMemories,
    ...(options[`${context.provider}-home`] ? { [`${context.provider}-home`]: options[`${context.provider}-home`] } : {}),
    ...(context.provider === "claude" && options["claude-state"] ? { "claude-state": options["claude-state"] } : {}),
  });
  if (data?.kind !== "agent-asset-baseline") {
    throw Object.assign(new Error("agent asset evidence returned an invalid contract"), {
      code: "INVALID_AGENT_CUSTOMIZE_EVIDENCE",
    });
  }
  if (data.status === "failed") {
    return {
      ...unavailableLane("agent-customize", { code: "AGENT_CUSTOMIZE_BASELINE_FAILED" }),
      data,
    };
  }
  return availableLane(data, data.status === "partial" ? "partial" : "available");
}
