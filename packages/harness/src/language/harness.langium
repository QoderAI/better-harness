// Harness assembly language, v0.3 surface.
//
// The DSL states only requirements that resolution and execution can falsify:
// one harness workflow, logical agent roles, capability requirements, concrete
// runtimes, and named harness/runtime deployments. Adapter capabilities remain
// descriptor-owned facts; revisions and receipts remain resolver/executor output.
grammar Harness

entry HarnessDocument:
    'language' languageVersion=LANGUAGE_VERSION
    (elements+=Declaration)*;

Declaration:
    HarnessDeclaration | WorkflowDeclaration | CapabilityDeclaration
    | RuntimeDeclaration | DeploymentDeclaration;

// A complete assembly. The workflow says how the declared roles are actually
// driven; the deployment that selects a runtime is a separate source fact.
HarnessDeclaration:
    'harness' name=ID '{'
        'workflow' workflow=[WorkflowDeclaration:ID]
        (agents+=AgentDeclaration)*
    '}';

// A logical role. State-machine workflows may route only outcomes declared by
// the emitting role; session workflows need no outcomes.
AgentDeclaration:
    'agent' name=ID '{'
        ('outcomes' '{' (outcomes+=ID)* '}')?
        (requirements+=CapabilityUse)*
    '}';

// The verb is the satisfaction contract: skills must be delivered, tools must
// be exposed with the exact contract id, and MCP servers must be connected.
CapabilityUse:
    ( verb='use' 'skill' | verb='require' 'tool' | verb='connect' 'mcp' )
    capability=QualifiedName;

// A workflow declares exactly one form (validated semantically for actionable
// diagnostics):
// - `session <agent>`: the one portable session shipped adapters really run;
// - `program <language> <entry>`: an adapter-owned controller;
// - `state-machine` + entry/events/stops: accepted only by an orchestration
//   adapter that explicitly supports the mode.
WorkflowDeclaration:
    'workflow' name=ID '{'
        (session=SessionBody)?
        (program=ProgramBody)?
        (stateMachine?='state-machine')?
        ('entry' entry=ID)?
        (statements+=WorkflowStatement)*
    '}';

SessionBody:
    'session' agent=ID;

ProgramBody:
    'program' language=ID entry=STRING;

WorkflowStatement:
    EventStatement | StopStatement;

EventStatement:
    'on' agent=ID '.' outcome=ID '->' to=ID;

StopStatement:
    'stop' 'when' agent=ID '.' outcome=ID;

CapabilityDeclaration:
    SkillDeclaration | ToolDeclaration | McpDeclaration;

// Progressive knowledge per the Agent Skills standard: either a `source`
// directory, inline `description` guidance, or both.
SkillDeclaration:
    'skill' name=QualifiedName '{'
        ('source' source=STRING)?
        ('description' description=STRING)?
    '}';

// A custom atomic callable needs a stable contract identity. Standard builtin
// tool ids may remain undeclared and are synthesized by the compiler.
ToolDeclaration:
    'tool' name=QualifiedName '{'
        'contract' contract=STRING
        ('description' description=STRING)?
    '}';

// A capability connection, not a tool: what server is reached over. Which
// tools/resources/prompts it provides is discovered at runtime.
McpDeclaration:
    'mcp' name=QualifiedName '{'
        'transport' transport=Transport
        ('url' url=McpEndpoint)?
        ('command' command=STRING)?
    '}';

Transport returns string:
    'stdio' | 'http' | 'sse';

McpEndpoint:
    {infer EnvEndpoint} 'env' '.' variable=ID
  | {infer LiteralEndpoint} value=STRING;

// A concrete host and the adapter package selected for deployment. Execution
// support is descriptor-owned and cannot be claimed in source.
RuntimeDeclaration:
    'runtime' name=ID '{'
        'adapter' adapter=STRING
    '}';

// The composition rule is explicit and sparse: only named harness/runtime
// pairs are deployable.
DeploymentDeclaration:
    'deployment' name=ID '{'
        'harness' harness=[HarnessDeclaration:ID]
        'runtime' runtime=[RuntimeDeclaration:ID]
    '}';

// Dotted names are shared by every capability kind. Their segments accept
// non-structural keywords as soft keywords so `workspace.read` remains legal.
QualifiedName returns string:
    NameSegment ('.' NameSegment)*;

NameSegment returns string:
    ID | 'workspace' | 'process' | 'network' | 'model' | 'read' | 'write'
    | 'allow' | 'deny' | 'env' | 'url' | 'command' | 'source' | 'description'
    | 'transport' | 'adapter' | 'program' | 'runtime' | 'agent' | 'skill'
    | 'tool' | 'mcp' | 'workflow' | 'harness' | 'stdio' | 'http' | 'sse'
    | 'contract' | 'session' | 'entry' | 'outcomes' | 'deployment' | 'language'
    | 'state-machine' | 'on' | 'stop' | 'when' | 'use' | 'require' | 'connect';

terminal LANGUAGE_VERSION: /[0-9]+\.[0-9]+/;
terminal ID: /[_a-zA-Z][\w-]*/;
terminal STRING returns string: /"[^"]*"/;

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
