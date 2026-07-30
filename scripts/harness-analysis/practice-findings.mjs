import { ASSET_INTEGRITY_PROFILE } from "../coding-agent-practices/asset-integrity.mjs";
import { findingTargetFromTopology } from "../workspace-topology/index.mjs";

const PROFILE_RULES = "agents-md-review";
const PROFILE_ASSETS = "agent-assets-review";

const SURFACE_CONFIG = Object.freeze({
  Rules: {
    dimensionRefs: ["task-understanding"],
    subdimensionRefs: ["relevant-context"],
    expectedArtifact: "Rule",
  },
  Skills: {
    dimensionRefs: ["controlled-execution"],
    subdimensionRefs: ["supported-operation"],
    expectedArtifact: "Skill",
  },
  Hooks: {
    dimensionRefs: ["reliable-delivery"],
    subdimensionRefs: ["high-risk-approval"],
    expectedArtifact: "Hook",
  },
  MCP: {
    dimensionRefs: ["controlled-execution"],
    subdimensionRefs: ["supported-operation", "permission-boundary"],
    expectedArtifact: "MCP",
  },
  Commands: {
    dimensionRefs: ["controlled-execution"],
    subdimensionRefs: ["supported-operation"],
    expectedArtifact: "Config",
  },
  "Custom Agents": {
    dimensionRefs: ["task-understanding"],
    subdimensionRefs: ["relevant-context"],
    expectedArtifact: "Config",
  },
  Plugins: {
    dimensionRefs: ["controlled-execution"],
    subdimensionRefs: ["supported-operation", "permission-boundary"],
    expectedArtifact: "Config",
  },
  Memories: {
    dimensionRefs: ["task-understanding"],
    subdimensionRefs: ["relevant-context"],
    expectedArtifact: "Memory",
  },
});

const SURFACE_ORDER = Object.freeze(["Rules", "Skills", "Hooks", "MCP", "Commands", "Custom Agents", "Plugins", "Memories"]);
const NON_PROBLEM_FINDING_IDS = new Set(["root-length-acceptable"]);

function rows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function localized(value, locale) {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return "";
  return text(value[locale]) || text(value[locale === "zh-CN" ? "zh" : "en"]);
}

function safeId(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 72);
}

function surfaceFor(finding, profile) {
  const kind = text(finding?.assetKind).toLowerCase();
  if (kind === "skill") return "Skills";
  if (kind === "hook") return "Hooks";
  if (kind === "mcp") return "MCP";
  if (kind === "command") return "Commands";
  if (kind === "agent" || kind === "subagent") return "Custom Agents";
  if (kind === "plugin") return "Plugins";
  if (kind === "memory") return "Memories";
  if (kind === "rule" || profile === PROFILE_RULES) return "Rules";
  return null;
}

function severityFor(findings) {
  if (findings.some((finding) => finding.severity === "error" || finding.severity === "warning")) return "Medium";
  return "Low";
}

function evidenceRef(profile, finding, index) {
  const asset = safeId(finding?.assetName) || safeId(finding?.file) || String(index + 1);
  return {
    kind: profile === ASSET_INTEGRITY_PROFILE ? "asset-integrity" : "agent-lint",
    id: `${safeId(profile) || "practice-review"}:${safeId(finding?.id) || "finding"}:${asset}`,
    status: text(finding?.severity) || "advisory",
  };
}

function assetNames(findings) {
  return [...new Set(findings.map((finding) => text(finding?.assetName)).filter(Boolean))];
}

function findingDetail(finding, locale) {
  const asset = text(finding?.assetName) || text(finding?.file) || text(finding?.id) || "asset";
  if (locale === "zh-CN") {
    if (finding?.id === "skill-missing-description") return `${asset} 缺少 frontmatter description，Agent 无法稳定判断触发时机`;
    if (finding?.id === "skill-description-too-short") return `${asset} 的 frontmatter description 过短，难以稳定判断触发时机`;
    if (finding?.id === "skill-name-mismatch") return `${asset} 的声明名称与目录暴露名称不一致`;
    if (finding?.id === "skill-long-without-progressive-references") return `${asset} 过长且没有一跳式引用，使用时会加载过多无关上下文`;
    if (finding?.id === "skill-length-hard-cap") return `${asset} 超过 Skill 长度硬上限`;
    if (finding?.id === "root-length-hard-cap") return "根 AGENTS.md 超过 review 硬上限，关键规则容易被背景细节淹没";
    if (finding?.id === "mcp-missing-command-or-url") return `${asset} 没有可用的 command 或 url`;
    if (finding?.id === "mcp-remote-without-tls") return `${asset} 使用未加密的远程地址`;
    if (finding?.id === "mcp-direct-secret-env-value") return `${asset} 直接保存了敏感环境变量值`;
    if (finding?.id === "mcp-unpinned-package-runner") return `${asset} 通过未锁定版本的包运行器启动`;
    if (finding?.id === "mcp-without-workflow-owner") return "项目 MCP 配置没有对应的 Skill 或命令说明工作流归属";
    if (["custom-agent-missing-frontmatter", "custom-agent-malformed-frontmatter"].includes(finding?.id)) return `${asset} 的 profile frontmatter 无法用于稳定发现`;
    if (["custom-agent-missing-name", "custom-agent-invalid-name", "custom-agent-name-mismatch"].includes(finding?.id)) return `${asset} 缺少稳定一致的可调用名称`;
    if (["custom-agent-missing-description", "custom-agent-description-too-short"].includes(finding?.id)) return `${asset} 的路由描述不足以支持可靠委派`;
    if (["custom-agent-empty-prompt", "custom-agent-prompt-too-short", "custom-agent-prompt-too-large"].includes(finding?.id)) return `${asset} 的 system prompt 缺少清楚、可移植的任务边界`;
    if (finding?.id === "custom-agent-unbounded-tools") return `${asset} 没有显式的最小权限工具边界`;
    if (finding?.id === "custom-agent-tool-role-conflict") return `${asset} 声明只读职责却授予了写入工具`;
    if (finding?.id === "custom-agent-missing-local-reference") return `${asset} 包含失效的本地引用`;
    if (finding?.id === "hook-unsafe-input-handling") return `${asset} 直接执行或拼接了未安全处理的 Hook 输入`;
    if (finding?.id === "hook-blocking-contract-mismatch") return `${asset} 的阻断结果与事件或 async 语义不兼容`;
    if (finding?.id === "hook-broad-high-frequency-matcher") return `${asset} 在高频事件上同步匹配全部工具调用`;
    if (finding?.id === "hook-sync-side-effect") return `${asset} 同步执行了通知、日志或遥测类副作用`;
    if (finding?.id === "hook-portability-or-missing-dependency") return `${asset} 依赖未保护的平台命令、shell 或外部解析器`;
    const detail = localized(finding?.why, locale) || text(finding?.evidence) || text(finding?.remediation) || asset;
    return detail.replace(/\bagent\b/giu, "Agent");
  }
  return localized(finding?.why, locale) || text(finding?.evidence) || text(finding?.remediation) || asset;
}

function sentencePart(value) {
  return text(value).replace(/[。.!?！？；;]+$/gu, "");
}

function groupedReason(surface, findings, locale) {
  const details = findings.slice(0, 3).map((finding) => sentencePart(findingDetail(finding, locale))).filter(Boolean);
  const remaining = Math.max(0, findings.length - details.length);
  const issueCount = findings.length;
  if (surface === "Memories") {
    if (locale === "zh-CN") {
      return `项目 Memory 标题中发现了 ${issueCount} 个元数据重叠候选：${details.join("；")}${remaining ? `；另有 ${remaining} 项同类候选` : ""}。这些候选可能影响标题区分，但不证明正文重复或当前任务受到影响。`;
    }
    return `The project Memories have ${issueCount} title-metadata overlap ${issueCount === 1 ? "candidate" : "candidates"}. ${details.join(". ")}${remaining ? `. ${remaining} more related ${remaining === 1 ? "candidate remains" : "candidates remain"}` : ""}. These candidates may affect title distinction, but they do not prove duplicate content or current task impact.`;
  }
  if (locale === "zh-CN") {
    const scope = ({ Rules: "项目 Agent 指引中", Skills: "项目 Skill 中", Hooks: "项目 Hook 中", Commands: "项目命令中", "Custom Agents": "项目自定义 Agent 中", Plugins: "已启用 Plugin 中", Memories: "项目 Memory 标题中" })[surface] ?? `项目 ${surface} 中`;
    return `${scope}发现了 ${issueCount} 个相关问题：${details.join("；")}${remaining ? `；另有 ${remaining} 项同类问题` : ""}。这些问题会让 Agent 难以稳定发现、加载或遵循对应能力。`;
  }
  const label = ({ Rules: "agent guidance", Skills: "Skills", Hooks: "Hooks", Commands: "commands", "Custom Agents": "custom Agents" })[surface] ?? surface;
  return `The project ${label} has ${issueCount} related ${issueCount === 1 ? "gap" : "gaps"}. ${details.join(". ")}${remaining ? `. ${remaining} more related ${remaining === 1 ? "gap remains" : "gaps remain"}` : ""}. Together, they make the capability harder for an agent to discover, load, or follow reliably.`;
}

function titleFor(surface, findings, locale) {
  const ids = new Set(findings.map((finding) => finding?.id));
  if (surface === "Rules" && ids.has("long-root-without-progressive-references") && [...ids].some((id) => String(id).startsWith("root-length-"))) {
    return locale === "zh-CN" ? "根 Agent 指引过长，关键规则难以按需加载" : "The root agent guide is too long to load selectively";
  }
  if (surface === "Rules" && findings.length === 1) {
    return localized(findings[0]?.title, locale)
      || (locale === "zh-CN" ? "项目 Rule 难以突出关键任务边界" : "Project Rules hide important task boundaries");
  }
  const labels = {
    Rules: ["Project guidance makes task routing hard to follow", "项目指引让任务路由难以快速判断"],
    Skills: ["Project Skills are hard for agents to find and load selectively", "Agent 难以找到项目 Skill 并按需加载"],
    Hooks: ["Project Hooks do not define a reliable lifecycle boundary", "项目 Hook 没有清楚可靠的生命周期边界"],
    MCP: ["Project MCP access lacks a reliable workflow boundary", "项目 MCP 访问缺少可靠的工作流边界"],
    Commands: ["Project commands are difficult to discover", "项目命令入口不容易找到"],
    "Custom Agents": ["Custom Agents lack clear routing or ownership", "自定义 Agent 的路由或归属不清楚"],
    Plugins: ["Project Plugins blur their capability boundaries", "项目 Plugin 的能力边界不清楚"],
    Memories: ["Memory titles contain possible overlap that needs owner review", "Memory 标题存在需要所有者确认的重叠候选"],
  }[surface] ?? ["Coding-agent practice needs repair", "编码 Agent 实践存在需要修复的问题"];
  return locale === "zh-CN" ? labels[1] : labels[0];
}

function expectedOutcomeFor(surface, locale) {
  const outcomes = {
    Rules: [
      "Newcomers reach the task boundary, relevant context, and next check without loading avoidable background.",
      "新人和 Agent 能直接找到任务边界、相关上下文和下一步检查，不被无关背景淹没。",
    ],
    Skills: [
      "Agents consistently discover the right project Skill and load only the workflow needed for the current task.",
      "Agent 能稳定发现正确的项目 Skill，并只加载当前任务需要的工作流。",
    ],
    Hooks: [
      "Lifecycle Hooks expose a valid, testable decision boundary at the intended agent event.",
      "生命周期 Hook 会在目标 Agent 事件上提供有效、可测试的决策边界。",
    ],
    MCP: [
      "External access has a discoverable workflow owner, permission boundary, and validation path.",
      "外部访问具备可发现的工作流归属、权限边界和验证路径。",
    ],
    "Custom Agents": [
      "Each specialist Agent has a stable routing description, focused prompt, least-privilege tools, and a verifiable handoff to the main task.",
      "每个专用 Agent 都具备稳定的路由描述、聚焦 Prompt、最小权限工具和可验证的主任务交接。",
    ],
    Plugins: [
      "Each enabled Plugin has one clear capability owner, source, and intentional variant boundary.",
      "每个已启用 Plugin 都具备清楚的能力所有者、来源和有意保留的变体边界。",
    ],
    Memories: [
      "Memory titles remain distinct and searchable, with merge candidates reviewed before any content change.",
      "Memory 标题保持清楚可检索，任何内容变更前都先人工确认合并候选。",
    ],
  }[surface] ?? [
    "The project capability has a discoverable owner, bounded workflow, and focused validation path.",
    "项目能力具备可发现的归属、边界清楚的工作流和聚焦验证路径。",
  ];
  return locale === "zh-CN" ? outcomes[1] : outcomes[0];
}

function expectedOutputFor(surface, artifact, locale) {
  const labels = {
    Rules: [
      "Update the project Rule so agents can find the task boundary, relevant context, and next validation step without loading avoidable background.",
      "更新项目规则，使 Agent 无需加载无关背景即可找到任务边界、相关上下文和下一步验证。",
    ],
    Skills: [
      "Update the project Skill so its trigger, bounded workflow, references, and focused validation are discoverable and load selectively.",
      "更新项目 Skill，使其触发条件、有界工作流、引用和聚焦验证可被发现并按需加载。",
    ],
    Hooks: [
      "Update the project Hook so its lifecycle event, decision boundary, input handling, and focused validation are explicit and testable.",
      "更新项目 Hook，使其生命周期事件、决策边界、输入处理和聚焦验证清楚且可测试。",
    ],
    MCP: [
      "Update the project MCP connection so its workflow owner, permission boundary, transport, and validation path are explicit.",
      "更新项目 MCP 连接，使其工作流归属、权限边界、传输方式和验证路径清楚明确。",
    ],
    Commands: [
      "Update the project command Config so the supported operation, invocation, owner, and validation path are discoverable.",
      "更新项目命令配置，使受支持操作、调用方式、归属和验证路径可被发现。",
    ],
    "Custom Agents": [
      "Update the custom-Agent Config so routing, prompt scope, least-privilege tools, and handoff validation are explicit.",
      "更新自定义 Agent 配置，使路由、Prompt 范围、最小权限工具和交接验证清楚明确。",
    ],
    Plugins: [
      "Update the Plugin Config so each enabled capability has one intentional owner, source, variant boundary, and validation path.",
      "更新 Plugin 配置，使每个已启用能力都有明确的归属、来源、变体边界和验证路径。",
    ],
    Memories: [
      "Update the governed Memory so a confirmed overlap is resolved while distinct searchable titles and provenance stay intact.",
      "更新受治理的 Memory，使确认的重叠得到解决，同时保留清楚可检索的标题和来源。",
    ],
  }[surface] ?? [
    `Update the owning ${artifact} so it exposes a bounded workflow and focused validation path.`,
    `更新归属${artifact}，使其提供有界工作流和聚焦验证路径。`,
  ];
  return locale === "zh-CN" ? labels[1] : labels[0];
}

function aiFixPrompt(surface, findings, profile, provider, locale) {
  const files = [...new Set(findings.map((finding) => text(finding?.file)).filter(Boolean))].slice(0, 6);
  const target = files.length > 0 ? files.join(", ") : surface;
  const integrityReview = profile === ASSET_INTEGRITY_PROFILE;
  const qoderProvider = text(provider).toLowerCase() === "qoder";
  const validation = integrityReview
    ? `better-harness coding-agent-practices asset-integrity ${provider} --workspace . --language ${locale} --json`
    : `better-harness agent-lint --workspace . --profile ${profile} --provider ${provider} --json`;
  if (integrityReview && surface === "Memories" && qoderProvider && locale === "zh-CN") {
    return `/better-harness 修复这个问题\n\n先核对标题候选是同一知识、冲突知识还是有意并存；只有当前项目证据确认存在错误、冲突、缺失或需要补充时才修改，不能仅凭标题相似度删除或合并 Memory。\n\n在 Qoder 中按真实所有者选择系统提示词提供的路径，不要查找同名 Skill 或扫描命令目录：\n\n- 如果重复项属于 Qoder Memory，先用 \`SearchMemory\` 取得候选的精确 Memory ID 和当前内容，选定一条规范记录；再用 \`update_memory\` 的 update 操作合并仍然有效的内容。只有规范记录更新成功且本次修复已授权移除冗余项时，才用同一工具的 delete 操作处理另一个精确 ID。不要直接修改 Memory 文件或数据库。\n- 如果错误或缺失属于项目 Wiki 或知识卡，返回一条以 \`/knowledge\` 开头的可执行交接提示，写明目标知识、当前证据、预期 CRUD 操作和验证要求；该请求只使用实际追加的 Wiki/知识卡工具，并遵循 list/read、CRUD、重新读取验证的顺序。\n\n除非当前证据证明两个资产都拥有同一事实，否则不要同时更新 Memory 与 Wiki/知识卡；不要用 \`/knowledge\` 代替 Memory 治理，也不要用 \`update_memory\` 改项目文档。\n\n## Validation\n\n- 运行 \`${validation}\`，确认已处理的标题候选消失且有意并存项仍被保留\n- 重新检索更新后的 Memory；如果更新了 Wiki 或知识卡，也重新读取对应目标，并与当前项目事实核对`;
  }
  if (integrityReview && surface === "Memories" && qoderProvider) {
    return `/better-harness fix this issue\n\nDetermine whether each title candidate represents the same knowledge, conflicting knowledge, or an intentional variant. Change it only when current project evidence confirms an error, conflict, omission, or needed addition; never delete or merge Memory from title similarity alone.\n\nIn Qoder, choose the system-prompt-provided route by the real owner; do not search for a same-named Skill or scan command directories:\n\n- For duplicate Qoder Memory, use \`SearchMemory\` to obtain the exact Memory IDs and current contents, then choose one canonical record. Use \`update_memory\` with update to merge still-valid content. Only after the canonical update succeeds, and when this repair is authorized to remove the redundant record, use the same tool with delete on the other exact ID. Never edit Memory files or databases directly.\n- For incorrect or missing project Wiki or Knowledge Card content, return a ready-to-run handoff beginning with \`/knowledge\` that names the target knowledge, current evidence, intended CRUD operation, and validation. Use only the Wiki or Knowledge Card tools actually injected for that request, in list/read, CRUD, then re-read order.\n\nDo not update both stores unless current evidence proves that both assets own the same fact. Do not use \`/knowledge\` as a substitute for Memory governance or \`update_memory\` to edit project documentation.\n\n## Validation\n\n- Run \`${validation}\` and confirm the resolved title candidate is gone while intentional variants remain\n- Retrieve the updated Memory again; if Wiki or Knowledge Cards changed, re-read that target too and compare both with current project facts`;
  }
  if (integrityReview && locale === "zh-CN") {
    return `/better-harness 修复这个问题\n\n先人工确认 ${surface} 候选是否确实重复或冲突，再修改其真实所有者。不要仅凭标题相似度删除 Memory，不要直接编辑 Plugin cache，也不要仅因 Hook 总数超过建议值就移除生命周期守卫。保留有意的 E2E/P7/P8 变体和不同命令的 Hook fan-out。\n\n## Validation\n\n- 运行 \`${validation}\`，确认已处理候选消失且其余有意变体仍被保留\n- 对变更后的能力运行一个代表性任务；涉及 Hook 时还要运行所属 Hook 的聚焦测试`;
  }
  if (integrityReview) {
    return `/better-harness fix this issue\n\nConfirm each ${surface} candidate is a real duplicate or conflict before changing its owning source. Never delete Memory from title similarity alone, edit a Plugin cache directly, or remove a lifecycle guard only because Hook count exceeds the recommendation. Preserve intentional E2E/P7/P8 variants and Hook fan-out with distinct commands.\n\n## Validation\n\n- Run \`${validation}\` and confirm the repaired candidate is gone while intentional variants remain\n- Exercise one representative task; for Hook changes, also run the owner Hook's focused tests`;
  }
  if (locale === "zh-CN") {
    return `/better-harness 修复这个问题\n\n只修复 ${target} 中已确认的 ${surface} 资产质量问题。保留现有能力和触发语义；不要新增无关 Skill、Hook、MCP 或规则。对于长文档，保留始终需要的入口，把条件性步骤移到一跳可达的引用。\n\n## Validation\n\n- 运行 \`${validation}\`，确认本 finding 对应的 warning/advisory 已消失\n- 用一个代表性任务检查修改后的能力仍能被发现，并且只加载任务相关上下文`;
  }
  return `/better-harness fix this issue\n\nRepair only the confirmed ${surface} asset-quality problems in ${target}. Preserve the existing capability and trigger semantics; do not add unrelated Skills, Hooks, MCPs, or Rules. For long documents, keep always-needed routing in the entrypoint and move conditional detail behind one-hop references.\n\n## Validation\n\n- Run \`${validation}\` and confirm the warning/advisory represented by this finding is gone\n- Use one representative task to confirm the repaired capability is still discoverable and loads only task-relevant context`;
}

function reviewSummary(profile, payload) {
  const findings = rows(payload?.findings);
  return {
    profile,
    status: "reviewed",
    summary: `${findings.length} bounded practice finding(s) from ${profile}`,
    evidenceRefs: findings.length > 0
      ? findings.map((finding, index) => evidenceRef(profile, finding, index))
      : [{ kind: profile === ASSET_INTEGRITY_PROFILE ? "asset-integrity" : "agent-lint", id: `${safeId(profile)}:clean`, status: "clean" }],
  };
}

export function projectAgentLintPracticeEvidence({
  instructionReview = {},
  assetReview = {},
  integrityReview,
  locale = "en",
  provider = "qoder",
  topology,
} = {}) {
  const normalizedLocale = locale === "zh-CN" ? "zh-CN" : "en";
  const grouped = new Map();
  const reviewInputs = [[PROFILE_RULES, instructionReview], [PROFILE_ASSETS, assetReview]];
  if (integrityReview) reviewInputs.push([ASSET_INTEGRITY_PROFILE, integrityReview]);
  for (const [profile, payload] of reviewInputs) {
    for (const [index, finding] of rows(payload?.findings).entries()) {
      if (NON_PROBLEM_FINDING_IDS.has(text(finding?.id))) continue;
      const surface = surfaceFor(finding, profile);
      if (!surface || !SURFACE_CONFIG[surface]) continue;
      const ownerRoute = text(finding?.ownerRoute) || text(finding?.packageRoute) || undefined;
      const packageRoute = text(finding?.packageRoute) || ownerRoute;
      const key = `${profile}:${text(finding?.id)}:${text(finding?.file)}:${text(finding?.assetName)}`;
      const groupKey = `${surface}\u0000${ownerRoute ?? ""}`;
      const current = grouped.get(groupKey) ?? {
        surface,
        ownerRoute,
        packageRoute,
        findings: [],
        seen: new Set(),
        profiles: new Set(),
      };
      if (!current.seen.has(key)) {
        current.seen.add(key);
        current.profiles.add(profile);
        current.findings.push({ ...finding, _profile: profile, _index: index });
      }
      grouped.set(groupKey, current);
    }
  }

  const findings = SURFACE_ORDER.flatMap((surface) => {
    const surfaceGroups = [...grouped.values()]
      .filter((group) => group.surface === surface && group.findings.length > 0)
      .sort((left, right) => (left.ownerRoute ?? "").localeCompare(right.ownerRoute ?? ""));
    return surfaceGroups.map((group, index) => {
      const config = SURFACE_CONFIG[surface];
      const profile = group.profiles.has(PROFILE_ASSETS)
        ? PROFILE_ASSETS
        : group.profiles.has(ASSET_INTEGRITY_PROFILE)
          ? ASSET_INTEGRITY_PROFILE
          : PROFILE_RULES;
      const baseId = `practice-${safeId(surface) || "surface"}-quality`;
      const ownerId = group.ownerRoute === "." ? "root" : safeId(group.ownerRoute);
      const id = index === 0 ? baseId : `${baseId}-${ownerId || index + 1}`;
      return {
        id,
        kind: "evidence-gap",
        severity: severityFor(group.findings),
        title: titleFor(surface, group.findings, normalizedLocale),
        reason: groupedReason(surface, group.findings, normalizedLocale),
        expectedOutcome: expectedOutcomeFor(surface, normalizedLocale),
        expectedArtifact: config.expectedArtifact,
        expectedOutput: [expectedOutputFor(surface, config.expectedArtifact, normalizedLocale)],
        aiFixPrompt: aiFixPrompt(surface, group.findings, profile, provider, normalizedLocale),
        dimensionRefs: [...config.dimensionRefs],
        subdimensionRefs: [...config.subdimensionRefs],
        staticEvidence: group.findings.map((finding) => evidenceRef(finding._profile, finding, finding._index)),
        practiceSurface: surface,
        practiceAssetNames: assetNames(group.findings),
        ...(group.ownerRoute ? {
          ownerRoute: group.ownerRoute,
          packageRoute: group.packageRoute,
          ...(topology ? {
            target: findingTargetFromTopology(topology, { ownerRoute: group.ownerRoute }),
          } : {}),
        } : {}),
      };
    });
  });

  return {
    findings,
    reviews: [
      reviewSummary(PROFILE_RULES, instructionReview),
      reviewSummary(PROFILE_ASSETS, assetReview),
      ...(integrityReview ? [reviewSummary(ASSET_INTEGRITY_PROFILE, integrityReview)] : []),
    ],
  };
}
