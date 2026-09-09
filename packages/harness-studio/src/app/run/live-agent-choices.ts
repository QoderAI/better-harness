import type { StudioAcpAgentOption } from "../studio-shell-model.js";

/**
 * One selectable Agent for a live Debugger run. `value` is the transport
 * decision, not a display string: `local` runs the loaded Qoder harness, and
 * `acp:<id>` runs the server-registered ACP Agent with that catalog id. An empty
 * id keeps the server's own default, which is what a host that predates the
 * catalog can still offer.
 */
export interface LiveAgentChoice {
  value: string;
  label: string;
  available: boolean;
  detail?: string;
}

export const LOCAL_AGENT_CHOICE = "local";
export const ACP_CHOICE_PREFIX = "acp:";

/**
 * Build the bounded launcher list. The browser never names a command or argv; it
 * only picks an entry the server already registered, so an unavailable Agent
 * stays visible with its reason instead of disappearing.
 */
export function liveAgentChoices(input: {
  localRunEnabled: boolean;
  acpEnabled: boolean;
  agents?: readonly StudioAcpAgentOption[];
  labels: { local: string; defaultAcp: string };
}): LiveAgentChoice[] {
  const choices: LiveAgentChoice[] = input.localRunEnabled
    ? [{ value: LOCAL_AGENT_CHOICE, label: input.labels.local, available: true }]
    : [];
  if (!input.acpEnabled) return choices;
  if (input.agents === undefined || input.agents.length === 0) {
    choices.push({ value: ACP_CHOICE_PREFIX, label: input.labels.defaultAcp, available: true });
    return choices;
  }
  for (const agent of input.agents) {
    choices.push({
      value: `${ACP_CHOICE_PREFIX}${agent.id}`,
      label: agent.label,
      available: agent.available,
      ...(agent.detail === "" ? {} : { detail: agent.detail }),
    });
  }
  return choices;
}

/** Resolve the reader's request, falling back to the first Agent that can run. */
export function resolveLiveAgentChoice(
  choices: readonly LiveAgentChoice[],
  requested: string,
): LiveAgentChoice | undefined {
  const chosen = choices.find((choice) => choice.value === requested);
  if (chosen?.available === true) return chosen;
  return choices.find((choice) => choice.available && isAcpChoice(choice))
    ?? choices.find((choice) => choice.available);
}

export function isAcpChoice(choice: LiveAgentChoice): boolean {
  return choice.value.startsWith(ACP_CHOICE_PREFIX);
}

/**
 * Map one choice to its POST target. The Agent id travels in the query string
 * because the run body is the shared `harness.run.request.v1` contract, which
 * carries no transport selector.
 */
export function liveRunEndpoint(
  choice: LiveAgentChoice,
  endpoints: { run: string; acp?: string },
): string | undefined {
  if (!isAcpChoice(choice)) return endpoints.run;
  if (endpoints.acp === undefined) return undefined;
  const agentId = choice.value.slice(ACP_CHOICE_PREFIX.length);
  return agentId === "" ? endpoints.acp : `${endpoints.acp}?agent=${encodeURIComponent(agentId)}`;
}
