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
  /** Whether this Agent can also run inside a microVM. */
  boxAvailable?: boolean;
  boxDetail?: string;
}

/**
 * Where a live run's Agent process executes.
 *
 * `host` is this machine, as every run has been until now. `box` is a microVM
 * that installs the Agent itself, so the set of Agents differs between the two:
 * a locally installed Agent may have no portable distribution, and a boxable
 * one need not be installed here at all.
 */
export type LiveRunPlacement = "host" | "box";

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
      ...(agent.boxAvailable === undefined ? {} : { boxAvailable: agent.boxAvailable }),
      ...(agent.boxDetail === undefined || agent.boxDetail === "" ? {} : { boxDetail: agent.boxDetail }),
    });
  }
  return choices;
}

/**
 * Whether a choice can start under this placement.
 *
 * A box run is ACP-only: the local Qoder harness is a different transport that
 * has no guest to run in.
 */
export function choiceRunnable(choice: LiveAgentChoice, placement: LiveRunPlacement): boolean {
  if (placement === "host") return choice.available;
  // `available` is deliberately not consulted: it answers "is this Agent on
  // this machine", which a box makes irrelevant by installing it in the guest.
  return isAcpChoice(choice) && choice.boxAvailable === true;
}

/** Whether any Agent can run in a box, which is what makes the control useful. */
export function placementAvailable(choices: readonly LiveAgentChoice[]): boolean {
  return choices.some((choice) => choiceRunnable(choice, "box"));
}

/**
 * Resolve the reader's request, falling back to the first Agent that can run.
 *
 * The fallback is placement-aware: switching to a box while the host default is
 * selected must land on an Agent the box can actually start, not fail at the
 * server with the host's choice.
 */
export function resolveLiveAgentChoice(
  choices: readonly LiveAgentChoice[],
  requested: string,
  placement: LiveRunPlacement = "host",
): LiveAgentChoice | undefined {
  const chosen = choices.find((choice) => choice.value === requested);
  if (chosen !== undefined && choiceRunnable(chosen, placement)) return chosen;
  return choices.find((choice) => choiceRunnable(choice, placement) && isAcpChoice(choice))
    ?? choices.find((choice) => choiceRunnable(choice, placement));
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
  placement: LiveRunPlacement = "host",
): string | undefined {
  if (!isAcpChoice(choice)) return endpoints.run;
  if (endpoints.acp === undefined) return undefined;
  const agentId = choice.value.slice(ACP_CHOICE_PREFIX.length);
  const query = [
    ...(agentId === "" ? [] : [`agent=${encodeURIComponent(agentId)}`]),
    // Absent means host, so an older server ignores it rather than misreading it.
    ...(placement === "box" ? ["placement=box"] : []),
  ];
  return query.length === 0 ? endpoints.acp : `${endpoints.acp}?${query.join("&")}`;
}
