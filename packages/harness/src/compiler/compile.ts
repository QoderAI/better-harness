import { URI, type LangiumDocument } from "langium";
import {
  IR_VERSION,
  STANDARD_TOOL_CONTRACTS,
  type CapabilityKind,
  type DeploymentIr,
  type HarnessIrBundle,
  type HarnessSpecIr,
  type McpIr,
  type RuntimeIr,
  type SkillIr,
  type ToolIr,
  type WorkflowIr,
} from "../ir/index.js";
import { createHarnessServices } from "../language/harness-module.js";
import {
  type AgentDeclaration,
  type CapabilityUse,
  type DeploymentDeclaration,
  type HarnessDeclaration,
  type HarnessDocument,
  type McpDeclaration,
  type RuntimeDeclaration,
  type SkillDeclaration,
  type ToolDeclaration,
  type WorkflowDeclaration,
  isDeploymentDeclaration,
  isEnvEndpoint,
  isEventStatement,
  isHarnessDeclaration,
  isMcpDeclaration,
  isRuntimeDeclaration,
  isSkillDeclaration,
  isStopStatement,
  isToolDeclaration,
  isWorkflowDeclaration,
} from "../language/generated/ast.js";

export interface CompileDiagnostic {
  severity: "error" | "warning";
  message: string;
  source: string;
  line?: number;
}

export interface CompileResult {
  bundle?: HarnessIrBundle;
  diagnostics: CompileDiagnostic[];
}

export interface HarnessSource {
  uri?: string;
  text: string;
}

const VERB_KIND: Record<string, CapabilityKind> = {
  use: "skill",
  require: "tool",
  connect: "mcp",
};

export async function compileHarness(input: string | HarnessSource[]): Promise<CompileResult> {
  const sources = typeof input === "string" ? [{ text: input }] : input;
  const { shared } = createHarnessServices();
  const documents: LangiumDocument[] = sources.map((source, index) =>
    shared.workspace.LangiumDocumentFactory.fromString(
      source.text,
      URI.parse(source.uri ?? `memory://harness/${index}.harness`),
    ),
  );
  for (const document of documents) {
    shared.workspace.LangiumDocuments.addDocument(document);
  }
  await shared.workspace.DocumentBuilder.build(documents, { validation: true });

  const diagnostics: CompileDiagnostic[] = [];
  for (const document of documents) {
    for (const diagnostic of document.diagnostics ?? []) {
      diagnostics.push({
        severity: diagnostic.severity === 1 ? "error" : "warning",
        message: typeof diagnostic.message === "string" ? diagnostic.message : String(diagnostic.message),
        source: document.uri.toString(),
        line: diagnostic.range.start.line + 1,
      });
    }
  }

  const index = indexDeclarations(documents);
  diagnostics.push(...collectBundleDiagnostics(documents, index));
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }
  return { bundle: lowerBundle(index), diagnostics };
}

interface DeclarationIndex {
  skills: SkillDeclaration[];
  tools: ToolDeclaration[];
  mcps: McpDeclaration[];
  workflows: WorkflowDeclaration[];
  runtimes: RuntimeDeclaration[];
  harnesses: HarnessDeclaration[];
  deployments: DeploymentDeclaration[];
  capabilityKinds: Map<string, CapabilityKind>;
  implicitTools: Set<string>;
}

function indexDeclarations(documents: LangiumDocument[]): DeclarationIndex {
  const index: DeclarationIndex = {
    skills: [],
    tools: [],
    mcps: [],
    workflows: [],
    runtimes: [],
    harnesses: [],
    deployments: [],
    capabilityKinds: new Map(),
    implicitTools: new Set(),
  };
  for (const document of documents) {
    const root = document.parseResult.value as HarnessDocument;
    for (const element of root.elements) {
      if (isSkillDeclaration(element)) {
        index.skills.push(element);
        index.capabilityKinds.set(element.name, "skill");
      } else if (isToolDeclaration(element)) {
        index.tools.push(element);
        index.capabilityKinds.set(element.name, "tool");
      } else if (isMcpDeclaration(element)) {
        index.mcps.push(element);
        index.capabilityKinds.set(element.name, "mcp");
      } else if (isWorkflowDeclaration(element)) {
        index.workflows.push(element);
      } else if (isRuntimeDeclaration(element)) {
        index.runtimes.push(element);
      } else if (isHarnessDeclaration(element)) {
        index.harnesses.push(element);
      } else if (isDeploymentDeclaration(element)) {
        index.deployments.push(element);
      }
    }
  }
  for (const harness of index.harnesses) {
    for (const agent of harness.agents) {
      for (const requirement of agent.requirements) {
        if (
          requirement.verb === "require" &&
          !index.capabilityKinds.has(requirement.capability) &&
          STANDARD_TOOL_CONTRACTS[requirement.capability] !== undefined
        ) {
          index.implicitTools.add(requirement.capability);
        }
      }
    }
  }
  return index;
}

function collectBundleDiagnostics(
  documents: LangiumDocument[],
  index: DeclarationIndex,
): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];
  const capabilities = new Map<string, string>();
  const workflows = new Map<string, string>();
  const runtimes = new Map<string, string>();
  const harnesses = new Map<string, string>();
  const deployments = new Map<string, string>();
  const deploymentPairs = new Map<string, string>();

  for (const document of documents) {
    const source = document.uri.toString();
    const root = document.parseResult.value as HarnessDocument;
    for (const element of root.elements) {
      const line = element.$cstNode?.range.start.line;
      if (isSkillDeclaration(element)) {
        recordUnique(capabilities, element.name, "capability", source, line, diagnostics);
        if (element.source === undefined && element.description === undefined) {
          diagnostics.push(semanticDiagnostic(
            `Skill '${element.name}' declares neither 'source' nor 'description'.`,
            source,
            line,
          ));
        }
      } else if (isToolDeclaration(element)) {
        recordUnique(capabilities, element.name, "capability", source, line, diagnostics);
        if (element.contract.length === 0) {
          diagnostics.push(semanticDiagnostic(
            `Tool '${element.name}' needs a non-empty contract id.`,
            source,
            line,
          ));
        }
        const standard = STANDARD_TOOL_CONTRACTS[element.name];
        if (standard !== undefined && element.contract !== standard) {
          diagnostics.push(semanticDiagnostic(
            `Standard tool '${element.name}' must use contract '${standard}', not '${element.contract}'.`,
            source,
            line,
          ));
        }
      } else if (isMcpDeclaration(element)) {
        recordUnique(capabilities, element.name, "capability", source, line, diagnostics);
        if (element.transport === "stdio" && element.command === undefined) {
          diagnostics.push(semanticDiagnostic(
            `MCP '${element.name}' uses 'stdio' transport but declares no 'command'.`,
            source,
            line,
          ));
        }
        if (element.transport !== "stdio" && element.url === undefined) {
          diagnostics.push(semanticDiagnostic(
            `MCP '${element.name}' uses '${element.transport}' transport but declares no 'url'.`,
            source,
            line,
          ));
        }
      } else if (isWorkflowDeclaration(element)) {
        recordUnique(workflows, element.name, "workflow", source, line, diagnostics);
        diagnoseWorkflow(element, source, line, diagnostics);
      } else if (isRuntimeDeclaration(element)) {
        recordUnique(runtimes, element.name, "runtime", source, line, diagnostics);
        if (element.adapter.length === 0) {
          diagnostics.push(semanticDiagnostic(
            `Runtime '${element.name}' needs a non-empty adapter package id.`,
            source,
            line,
          ));
        }
      } else if (isHarnessDeclaration(element)) {
        recordUnique(harnesses, element.name, "harness", source, line, diagnostics);
        diagnoseHarnessMembers(element, index, source, line, diagnostics);
      } else if (isDeploymentDeclaration(element)) {
        recordUnique(deployments, element.name, "deployment", source, line, diagnostics);
        const harness = element.harness?.$refText;
        const runtime = element.runtime?.$refText;
        if (harness !== undefined && runtime !== undefined) {
          recordUnique(
            deploymentPairs,
            `${harness}::${runtime}`,
            "harness/runtime deployment",
            source,
            line,
            diagnostics,
          );
        }
      }
    }
  }

  for (const document of documents) {
    const source = document.uri.toString();
    const root = document.parseResult.value as HarnessDocument;
    for (const element of root.elements) {
      if (!isHarnessDeclaration(element)) continue;
      const workflow = element.workflow?.ref;
      if (workflow !== undefined) {
        diagnoseHarnessWorkflow(element, workflow, source, diagnostics);
      }
    }
  }
  return diagnostics;
}

function diagnoseWorkflow(
  workflow: WorkflowDeclaration,
  source: string,
  line: number | undefined,
  diagnostics: CompileDiagnostic[],
): void {
  const forms = Number(workflow.session !== undefined) + Number(workflow.program !== undefined) +
    Number(workflow.stateMachine);
  if (forms !== 1) {
    diagnostics.push(semanticDiagnostic(
      `Workflow '${workflow.name}' must declare exactly one of 'session', 'program', or 'state-machine'.`,
      source,
      line,
    ));
    return;
  }
  if (workflow.session !== undefined) {
    if (workflow.entry !== undefined || workflow.statements.length > 0) {
      diagnostics.push(semanticDiagnostic(
        `Session workflow '${workflow.name}' cannot declare state-machine entry, events, or stops.`,
        source,
        line,
      ));
    }
    return;
  }
  if (workflow.program !== undefined) {
    if (workflow.entry !== undefined || workflow.statements.length > 0) {
      diagnostics.push(semanticDiagnostic(
        `Programmatic workflow '${workflow.name}' cannot declare state-machine entry, events, or stops.`,
        source,
        line,
      ));
    }
    return;
  }
  if (workflow.entry === undefined) {
    diagnostics.push(semanticDiagnostic(
      `State-machine workflow '${workflow.name}' declares no entry agent.`,
      source,
      line,
    ));
  }
  if (!workflow.statements.some(isStopStatement)) {
    diagnostics.push(semanticDiagnostic(
      `State-machine workflow '${workflow.name}' declares no stop condition.`,
      source,
      line,
    ));
  }
}

function diagnoseHarnessMembers(
  harness: HarnessDeclaration,
  index: DeclarationIndex,
  source: string,
  line: number | undefined,
  diagnostics: CompileDiagnostic[],
): void {
  if (harness.agents.length === 0) {
    diagnostics.push(semanticDiagnostic(
      `Harness '${harness.name}' must declare at least one agent.`,
      source,
      line,
    ));
  }
  recordRepeatedValues(harness.agents.map((agent) => agent.name), "agent", source, line, diagnostics);
  for (const agent of harness.agents) {
    const agentLine = agent.$cstNode?.range.start.line ?? line;
    recordRepeatedValues(agent.outcomes, `agent '${agent.name}' outcome`, source, agentLine, diagnostics);
    recordRepeatedValues(
      agent.requirements.map((requirement) => requirement.capability),
      `agent '${agent.name}' requirement`,
      source,
      agentLine,
      diagnostics,
    );
    for (const requirement of agent.requirements) {
      diagnoseRequirement(requirement, index, source, agentLine, diagnostics);
    }
  }
}

function diagnoseRequirement(
  requirement: CapabilityUse,
  index: DeclarationIndex,
  source: string,
  line: number | undefined,
  diagnostics: CompileDiagnostic[],
): void {
  const expected = VERB_KIND[requirement.verb];
  const declared = index.capabilityKinds.get(requirement.capability);
  if (declared !== undefined && declared !== expected) {
    diagnostics.push(semanticDiagnostic(
      `'${requirement.verb}' expects a ${expected}, but '${requirement.capability}' is declared as a ${declared}.`,
      source,
      line,
    ));
    return;
  }
  if (declared !== undefined) return;
  if (expected === "tool" && STANDARD_TOOL_CONTRACTS[requirement.capability] !== undefined) return;
  diagnostics.push(semanticDiagnostic(
    expected === "tool"
      ? `Unknown tool '${requirement.capability}'; declare it with a contract id or use a standard tool id.`
      : `Agent requirement references unknown ${expected} '${requirement.capability}'; declare it first.`,
    source,
    line,
  ));
}

function diagnoseHarnessWorkflow(
  harness: HarnessDeclaration,
  workflow: WorkflowDeclaration,
  source: string,
  diagnostics: CompileDiagnostic[],
): void {
  const line = harness.$cstNode?.range.start.line;
  const roles = new Map(harness.agents.map((agent) => [agent.name, agent]));
  if (workflow.session !== undefined) {
    if (harness.agents.length !== 1 || !roles.has(workflow.session.agent)) {
      diagnostics.push(semanticDiagnostic(
        `Session workflow '${workflow.name}' names agent '${workflow.session.agent}', so harness ` +
          `'${harness.name}' must declare exactly that one agent.`,
        source,
        line,
      ));
    }
    return;
  }
  if (!workflow.stateMachine) return;

  if (workflow.entry !== undefined && !roles.has(workflow.entry)) {
    diagnostics.push(semanticDiagnostic(
      `State-machine workflow '${workflow.name}' entry agent '${workflow.entry}' is not declared by harness '${harness.name}'.`,
      source,
      line,
    ));
  }
  for (const statement of workflow.statements) {
    const emitter = roles.get(statement.agent);
    if (emitter === undefined) {
      diagnostics.push(semanticDiagnostic(
        `Workflow '${workflow.name}' references undeclared agent '${statement.agent}' in harness '${harness.name}'.`,
        source,
        line,
      ));
    } else if (!emitter.outcomes.includes(statement.outcome)) {
      diagnostics.push(semanticDiagnostic(
        `Workflow '${workflow.name}' routes undeclared outcome '${statement.agent}.${statement.outcome}'.`,
        source,
        line,
      ));
    }
    if (isEventStatement(statement) && !roles.has(statement.to)) {
      diagnostics.push(semanticDiagnostic(
        `Workflow '${workflow.name}' routes to undeclared agent '${statement.to}' in harness '${harness.name}'.`,
        source,
        line,
      ));
    }
  }

  if (workflow.entry === undefined || !roles.has(workflow.entry)) return;
  const reachable = new Set<string>([workflow.entry]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const statement of workflow.statements) {
      if (isEventStatement(statement) && reachable.has(statement.agent) && !reachable.has(statement.to)) {
        reachable.add(statement.to);
        changed = true;
      }
    }
  }
  for (const role of roles.keys()) {
    if (!reachable.has(role)) {
      diagnostics.push(semanticDiagnostic(
        `Harness '${harness.name}' agent '${role}' is unreachable from workflow '${workflow.name}' entry '${workflow.entry}'.`,
        source,
        line,
      ));
    }
  }
}

function lowerBundle(index: DeclarationIndex): HarnessIrBundle {
  return {
    irVersion: IR_VERSION,
    kind: "harness-ir-bundle",
    skills: index.skills.map(lowerSkill),
    tools: [
      ...index.tools.map(lowerTool),
      ...[...index.implicitTools].sort().map(implicitTool),
    ],
    mcps: index.mcps.map(lowerMcp),
    workflows: index.workflows.map(lowerWorkflow),
    runtimes: index.runtimes.map(lowerRuntime),
    harnesses: index.harnesses.map(lowerHarness),
    deployments: index.deployments.map(lowerDeployment),
  };
}

function lowerSkill(skill: SkillDeclaration): SkillIr {
  return {
    irVersion: IR_VERSION,
    kind: "skill",
    id: skill.name,
    ...(skill.source !== undefined ? { source: skill.source } : {}),
    ...(skill.description !== undefined ? { description: skill.description } : {}),
  };
}

function lowerTool(tool: ToolDeclaration): ToolIr {
  return {
    irVersion: IR_VERSION,
    kind: "tool",
    id: tool.name,
    contract: tool.contract,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    implicit: false,
  };
}

function implicitTool(id: string): ToolIr {
  return {
    irVersion: IR_VERSION,
    kind: "tool",
    id,
    contract: STANDARD_TOOL_CONTRACTS[id],
    implicit: true,
  };
}

function lowerMcp(mcp: McpDeclaration): McpIr {
  return {
    irVersion: IR_VERSION,
    kind: "mcp",
    id: mcp.name,
    transport: mcp.transport,
    ...(mcp.url !== undefined
      ? {
          url: isEnvEndpoint(mcp.url)
            ? { type: "env" as const, variable: mcp.url.variable }
            : { type: "literal" as const, value: mcp.url.value },
        }
      : {}),
    ...(mcp.command !== undefined ? { command: mcp.command } : {}),
  };
}

function lowerWorkflow(workflow: WorkflowDeclaration): WorkflowIr {
  const events: WorkflowIr["events"] = [];
  const stops: WorkflowIr["stops"] = [];
  for (const statement of workflow.statements) {
    if (isEventStatement(statement)) {
      events.push({ agent: statement.agent, outcome: statement.outcome, to: statement.to });
    } else if (isStopStatement(statement)) {
      stops.push({ agent: statement.agent, outcome: statement.outcome });
    }
  }
  const mode: WorkflowIr["mode"] = workflow.session !== undefined
    ? "session"
    : workflow.program !== undefined
      ? "programmatic"
      : "state-machine";
  return {
    irVersion: IR_VERSION,
    kind: "workflow",
    id: workflow.name,
    mode,
    ...(workflow.session !== undefined ? { entry: workflow.session.agent } : {}),
    ...(workflow.stateMachine && workflow.entry !== undefined ? { entry: workflow.entry } : {}),
    events,
    stops,
    ...(workflow.program !== undefined
      ? { program: { language: workflow.program.language, entry: workflow.program.entry } }
      : {}),
  };
}

function lowerRuntime(runtime: RuntimeDeclaration): RuntimeIr {
  return {
    irVersion: IR_VERSION,
    kind: "runtime",
    id: runtime.name,
    adapter: runtime.adapter,
  };
}

function lowerHarness(harness: HarnessDeclaration): HarnessSpecIr {
  return {
    irVersion: IR_VERSION,
    kind: "harness-spec",
    id: harness.name,
    workflow: harness.workflow.$refText,
    agents: harness.agents.map(lowerAgent),
  };
}

function lowerAgent(agent: AgentDeclaration): HarnessSpecIr["agents"][number] {
  return {
    id: agent.name,
    outcomes: [...agent.outcomes],
    requirements: agent.requirements.map((requirement) => ({
      capabilityId: requirement.capability,
      capabilityKind: VERB_KIND[requirement.verb],
    })),
  };
}

function lowerDeployment(deployment: DeploymentDeclaration): DeploymentIr {
  return {
    irVersion: IR_VERSION,
    kind: "deployment",
    id: deployment.name,
    harness: deployment.harness.$refText,
    runtime: deployment.runtime.$refText,
  };
}

function recordRepeatedValues(
  values: string[],
  label: string,
  source: string,
  line: number | undefined,
  diagnostics: CompileDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.push(semanticDiagnostic(`Duplicate ${label} '${value}'.`, source, line));
    }
    seen.add(value);
  }
}

function recordUnique(
  seen: Map<string, string>,
  key: string,
  label: string,
  source: string,
  line: number | undefined,
  diagnostics: CompileDiagnostic[],
): void {
  const firstSource = seen.get(key);
  if (firstSource !== undefined) {
    diagnostics.push(semanticDiagnostic(
      `Duplicate ${label} '${key}' (first declared in ${firstSource}).`,
      source,
      line,
    ));
  } else {
    seen.set(key, source);
  }
}

function semanticDiagnostic(
  message: string,
  source: string,
  line: number | undefined,
): CompileDiagnostic {
  return {
    severity: "error",
    message,
    source,
    ...(line !== undefined ? { line: line + 1 } : {}),
  };
}
