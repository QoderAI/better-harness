export const USER_INPUT_TRACE_KIND = "UserInputTraceV1" as const;

export type UserInputActivity = "read" | "edit-targeted";

export interface UserInputFileLink {
  path: string;
  activity: UserInputActivity;
  callIds: string[];
  callCount: number;
}

export interface UserInputRecord {
  id: string;
  provider: string;
  sessionId: string;
  turnIndex: number;
  text: string;
  observedAt: string | null;
  links: UserInputFileLink[];
}

export interface UserInputTraceSummary {
  inputCount: number;
  linkedInputCount: number;
  unlinkedInputCount: number;
  readCount: number;
  editTargetCount: number;
  fileCount: number;
  truncatedSessionCount: number;
}

export interface UserInputTraceV1 {
  kind: typeof USER_INPUT_TRACE_KIND;
  schemaVersion: 1;
  workspace: { label: string };
  inputs: UserInputRecord[];
  summary: UserInputTraceSummary;
}

export interface UserInputFileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  inputCount: number;
  readCount: number;
  editTargetCount: number;
  children: UserInputFileTreeNode[];
}

const MAX_INPUTS = 6_000;
const MAX_FILE_LINKS = 48_000;

export function projectUserInputTrace(report: unknown): UserInputTraceV1 {
  const source = record(report, "Inspector report");
  if (source.kind !== "HarnessInspectorReportV1") throw new Error("Input trace requires HarnessInspectorReportV1 evidence.");
  const workspace = optionalRecord(source.workspace);
  const workspaceLabel = boundedText(workspace?.name, "Project workspace", 240);
  const sessions = array(source.sessions, "Inspector report sessions");
  const inputs: UserInputRecord[] = [];
  let totalLinks = 0;
  let truncatedSessionCount = 0;

  for (const [sessionOffset, sessionValue] of sessions.entries()) {
    const session = record(sessionValue, `Inspector Session ${sessionOffset + 1}`);
    const sessionId = boundedText(session.sessionId, `session-${sessionOffset + 1}`, 240);
    const provider = boundedText(session.platform, "Local agent", 120);
    const dialogue = optionalRecord(session.dialogue);
    if (dialogue === undefined) continue;
    if (dialogue.truncated === true) truncatedSessionCount += 1;
    const turns = array(dialogue.turns, `Dialogue turns for ${sessionId}`);

    for (const [turnOffset, turnValue] of turns.entries()) {
      if (inputs.length >= MAX_INPUTS) throw new Error(`Input trace exceeds the ${MAX_INPUTS} retained input limit.`);
      const turn = record(turnValue, `Turn ${turnOffset + 1} in ${sessionId}`);
      const turnIndex = positiveInteger(turn.index, turnOffset + 1);
      const prompt = optionalRecord(turn.prompt);
      const text = boundedText(prompt?.text, "Input unavailable after privacy filtering", 1_500);
      const observedAt = optionalTimestamp(prompt?.timestamp);
      const links = projectTurnLinks(turn.steps, sessionId, turnIndex);
      totalLinks += links.length;
      if (totalLinks > MAX_FILE_LINKS) throw new Error(`Input trace exceeds the ${MAX_FILE_LINKS} file-link limit.`);
      inputs.push({
        id: `${provider}/${sessionId}#turn-${turnIndex}`,
        provider,
        sessionId,
        turnIndex,
        text,
        observedAt,
        links,
      });
    }
  }

  inputs.sort(compareInputs);
  const paths = new Set(inputs.flatMap((input) => input.links.map((link) => link.path)));
  const linkedInputCount = inputs.filter((input) => input.links.length > 0).length;
  return {
    kind: USER_INPUT_TRACE_KIND,
    schemaVersion: 1,
    workspace: { label: workspaceLabel },
    inputs,
    summary: {
      inputCount: inputs.length,
      linkedInputCount,
      unlinkedInputCount: inputs.length - linkedInputCount,
      readCount: sumActivity(inputs, "read"),
      editTargetCount: sumActivity(inputs, "edit-targeted"),
      fileCount: paths.size,
      truncatedSessionCount,
    },
  };
}

function projectTurnLinks(value: unknown, sessionId: string, turnIndex: number): UserInputFileLink[] {
  const aggregated = new Map<string, { path: string; activity: UserInputActivity; callIds: Set<string>; callCount: number }>();
  const steps = value === undefined ? [] : array(value, `Turn ${turnIndex} steps in ${sessionId}`);
  for (const [stepOffset, stepValue] of steps.entries()) {
    const step = record(stepValue, `Turn ${turnIndex} step ${stepOffset + 1}`);
    if (step.kind !== "tool") continue;
    const activity = step.operation === "read-files" ? "read" : step.operation === "edit-files" ? "edit-targeted" : undefined;
    if (activity === undefined) continue;
    const callId = boundedText(step.callId, `${sessionId}-turn-${turnIndex}-step-${stepOffset + 1}`, 240);
    const filePaths = [
      ...(Array.isArray(step.filePaths) ? step.filePaths : []),
      ...(typeof step.filePath === "string" ? [step.filePath] : []),
    ];
    const uniquePaths = new Set(filePaths.map(strictPortablePath));
    for (const path of uniquePaths) {
      const key = `${activity}\u0000${path}`;
      const current = aggregated.get(key) ?? { path, activity, callIds: new Set<string>(), callCount: 0 };
      current.callIds.add(callId);
      current.callCount += 1;
      aggregated.set(key, current);
    }
  }
  return [...aggregated.values()]
    .map((link) => ({ ...link, callIds: [...link.callIds].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.activity.localeCompare(right.activity));
}

export function buildUserInputFileTree(inputs: readonly UserInputRecord[]): UserInputFileTreeNode[] {
  interface MutableNode extends UserInputFileTreeNode { inputIds: Set<string>; childrenMap: Map<string, MutableNode> }
  const roots = new Map<string, MutableNode>();
  for (const input of inputs) {
    for (const link of input.links) {
      const segments = link.path.split("/");
      let children = roots;
      let currentPath = "";
      for (const [index, name] of segments.entries()) {
        currentPath = currentPath === "" ? name : `${currentPath}/${name}`;
        const kind = index === segments.length - 1 ? "file" : "directory";
        const node = children.get(name) ?? {
          id: `${kind}:${currentPath}`,
          name,
          path: currentPath,
          kind,
          inputCount: 0,
          readCount: 0,
          editTargetCount: 0,
          children: [],
          inputIds: new Set<string>(),
          childrenMap: new Map<string, MutableNode>(),
        };
        node.inputIds.add(input.id);
        if (link.activity === "read") node.readCount += link.callCount;
        else node.editTargetCount += link.callCount;
        children.set(name, node);
        children = node.childrenMap;
      }
    }
  }
  const freeze = (nodes: Map<string, MutableNode>): UserInputFileTreeNode[] => [...nodes.values()]
    .sort((left, right) => Number(left.kind === "file") - Number(right.kind === "file") || left.name.localeCompare(right.name))
    .map((node) => ({
      id: node.id,
      name: node.name,
      path: node.path,
      kind: node.kind,
      inputCount: node.inputIds.size,
      readCount: node.readCount,
      editTargetCount: node.editTargetCount,
      children: freeze(node.childrenMap),
    }));
  return freeze(roots);
}

export function isUserInputTrace(value: unknown): value is UserInputTraceV1 {
  if (value === null || typeof value !== "object") return false;
  const trace = value as Partial<UserInputTraceV1>;
  return trace.kind === USER_INPUT_TRACE_KIND
    && trace.schemaVersion === 1
    && Array.isArray(trace.inputs)
    && trace.inputs.every((input) => typeof input?.id === "string"
      && typeof input.text === "string"
      && Array.isArray(input.links)
      && input.links.every((link) => (link.activity === "read" || link.activity === "edit-targeted") && safePortablePath(link.path)))
    && trace.summary !== null
    && typeof trace.summary === "object";
}

function sumActivity(inputs: readonly UserInputRecord[], activity: UserInputActivity): number {
  return inputs.reduce((total, input) => total + input.links
    .filter((link) => link.activity === activity)
    .reduce((subtotal, link) => subtotal + link.callCount, 0), 0);
}

function compareInputs(left: UserInputRecord, right: UserInputRecord): number {
  if (left.observedAt !== right.observedAt) {
    if (left.observedAt === null) return 1;
    if (right.observedAt === null) return -1;
    const timestampOrder = right.observedAt.localeCompare(left.observedAt);
    if (timestampOrder !== 0) return timestampOrder;
  }
  return left.provider.localeCompare(right.provider)
    || left.sessionId.localeCompare(right.sessionId)
    || right.turnIndex - left.turnIndex;
}

function strictPortablePath(value: unknown): string {
  if (typeof value !== "string" || !safePortablePath(value)) {
    throw new Error("Input trace file links must use bounded repository-relative paths.");
  }
  return value;
}

function safePortablePath(value: string): boolean {
  return value.length > 0
    && value.length <= 500
    && !value.startsWith("/")
    && !/^[A-Za-z]:[\\/]/u.test(value)
    && !value.includes("\\")
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value === undefined || value === null ? undefined : record(value, "Optional input trace value");
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function boundedText(value: unknown, fallback: string, maximum: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.normalize("NFKC").trim();
  return normalized === "" ? fallback : normalized.slice(0, maximum);
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}
