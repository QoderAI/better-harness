import {
  BarChart,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Swatch,
  Table,
  Text,
  UsageBar,
  usageColorSequence,
  useCanvasAction,
  useHostTheme,
} from "cursor/canvas";

const report = /*__BETTER_HARNESS_REPORT__*/ null as any;

function list(value: any): any[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function copy(english: string, chinese: string): string {
  return report?.summary?.locale === "zh-CN" ? chinese : english;
}

function number(value: any): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: any): string {
  return new Intl.NumberFormat(report?.summary?.locale === "zh-CN" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  }).format(number(value));
}

function formatTokens(value: any): string {
  const tokens = number(value);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return formatNumber(tokens);
}

function findingFilePath(finding: any): string | null {
  const target = finding?.target;
  for (const candidate of [target?.path, target?.file, target?.workspaceRelativePath]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function OpenFileButton({ path, label }: { path?: string | null; label?: string }) {
  const dispatch = useCanvasAction();
  if (!path) return null;
  return (
    <Button variant="ghost" onClick={() => dispatch({ type: "openFile", path })}>
      {label ?? copy("Open file", "打开文件")}
    </Button>
  );
}

function NewChatButton({ prompt, label, primary = false }: { prompt?: string | null; label: string; primary?: boolean }) {
  const dispatch = useCanvasAction();
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      disabled={!prompt}
      onClick={() => prompt && dispatch({ type: "newComposerChat", userPrompt: prompt })}
    >
      {label}
    </Button>
  );
}

function OpenAgentButton({ agentId }: { agentId?: string | null }) {
  const dispatch = useCanvasAction();
  if (!agentId) return null;
  return (
    <Button variant="secondary" onClick={() => dispatch({ type: "openAgent", agentId })}>
      {copy("Open source conversation", "打开来源会话")}
    </Button>
  );
}

function ReportHeader() {
  const contextUsage = report?.summary?.contextUsage;
  return (
    <Stack gap={12}>
      <Text size="small" tone="tertiary" weight="semibold">BETTER HARNESS · AGENT WORK LOOP</Text>
      <H1>{report?.summary?.projectName ?? copy("Better Harness report", "Better Harness 报告")}</H1>
      <Text tone="secondary" style={{ maxWidth: 900, lineHeight: 1.55 }}>
        {report?.summary?.overview ?? copy("Evidence-bounded engineering readiness report.", "基于证据边界的工程就绪度报告。")}
      </Text>
      <Row gap={8} align="center" wrap>
        <Pill active size="sm">{report?.summary?.evidenceMode ?? "unobserved"}</Pill>
        <Pill size="sm">{copy("No aggregate score", "不计算总分")}</Pill>
        <OpenAgentButton agentId={contextUsage?.actions?.openAgentId} />
        <NewChatButton
          primary
          label={copy("Review this report", "复核这份报告")}
          prompt={copy(
            "Review this Better Harness canvas. Explain the highest-priority finding, its evidence boundary, and the safest next action before changing files.",
            "复核这份 Better Harness Canvas。先说明最高优先级问题、证据边界和最安全的下一步，再决定是否修改文件。",
          )}
        />
      </Row>
    </Stack>
  );
}

function Strengths() {
  const strengths = list(report?.summary?.strengths);
  if (strengths.length === 0) return null;
  return (
    <Stack gap={10}>
      <H2>{copy("What is already working", "已有的有效基础")}</H2>
      <Grid columns="repeat(auto-fit, minmax(240px, 1fr))" gap={10}>
        {strengths.slice(0, 4).map((strength: string, index: number) => (
          <Callout key={`${index}-${strength}`} tone="success">{strength}</Callout>
        ))}
      </Grid>
    </Stack>
  );
}

function FluencyDimensions() {
  const dimensions = list(report?.summary?.dimensions);
  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <H2>{copy("Fluency", "Fluency")}</H2>
        <Text tone="secondary">
          {copy(
            "Five evidence-bounded dimensions. Scores stay separate so one strong area cannot hide another area's gap.",
            "五个有证据边界的维度分别呈现，避免某个强项掩盖其他环节的缺口。",
          )}
        </Text>
      </Stack>
      <BarChart
        categories={dimensions.map((dimension: any) => dimension.label ?? dimension.id)}
        series={[{ name: copy("Score", "分数"), data: dimensions.map((dimension: any) => number(dimension.score)) }]}
        horizontal
        height={Math.max(240, dimensions.length * 54)}
        yMin={0}
        yMax={100}
        valueSuffix=" / 100"
        showValues
      />
      <Grid columns="repeat(auto-fit, minmax(260px, 1fr))" gap={10}>
        {dimensions.map((dimension: any) => (
          <Card key={dimension.id}>
            <CardHeader trailing={<Pill size="sm" active={number(dimension.score) >= 70}>{formatNumber(dimension.score)}</Pill>}>
              {dimension.label ?? dimension.id}
            </CardHeader>
            <CardBody>
              <Text size="small" tone="secondary" style={{ lineHeight: 1.5 }}>{dimension.summary ?? dimension.scoreReason ?? "—"}</Text>
            </CardBody>
          </Card>
        ))}
      </Grid>
    </Stack>
  );
}

function ProjectUsage() {
  const activity = report?.summary?.usageActivity;
  const efficiency = report?.summary?.usageEfficiency;
  if (!activity && !efficiency) {
    return (
      <Stack gap={8}>
        <H2>{copy("Project usage", "项目使用情况")}</H2>
        <Callout tone="neutral">{copy("Session usage was not observed for this report window.", "本次报告窗口没有观察到会话使用数据。")}</Callout>
      </Stack>
    );
  }
  const dates = list(activity?.dates).slice(-30);
  const activeMinutes = list(activity?.sessions?.activeMinutes).slice(-dates.length).map(number);
  const selection = efficiency?.selection ?? {};
  return (
    <Stack gap={12}>
      <H2>{copy("Project usage", "项目使用情况")}</H2>
      <Grid columns="repeat(auto-fit, minmax(150px, 1fr))" gap={12}>
        <Stat value={formatNumber(activity?.sessions?.total ?? selection.analyzedSessionCount)} label={copy("Eligible sessions", "符合条件的会话")} />
        <Stat value={formatNumber(activeMinutes.reduce((sum: number, value: number) => sum + value, 0))} label={copy("Active minutes · 30d", "活跃分钟 · 30 天")} />
        <Stat value={formatNumber(efficiency?.longSessions?.activeCount)} label={copy("Active-long sessions", "活跃长会话")} tone={number(efficiency?.longSessions?.activeCount) > 0 ? "warning" : undefined} />
        <Stat value={selection.complete === true ? copy("Complete", "完整") : copy("Partial", "部分")} label={copy("Usage census", "使用普查")} tone={selection.complete === true ? "success" : "warning"} />
      </Grid>
      {dates.length > 0 ? (
        <BarChart
          categories={dates}
          series={[{ name: copy("Active minutes", "活跃分钟"), data: activeMinutes }]}
          height={260}
          valueSuffix={copy(" min", " 分钟")}
          showValues={false}
        />
      ) : null}
    </Stack>
  );
}

function AgentPractice() {
  const practice = report?.summary?.aiAgentPractice ?? {};
  const rows = list(practice.coverageRows);
  return (
    <Stack gap={10}>
      <H2>{copy("AI Agent Practice", "AI Agent Practice")}</H2>
      <Text tone="secondary">
        {copy("Configured assets and representative safe sources observed by this scan.", "本次扫描观察到的 Agent 配置资产及代表性安全来源。")}
      </Text>
      <Table
        headers={[copy("Asset", "资产"), copy("Coverage", "覆盖"), copy("Representative source", "代表性来源")]}
        rows={rows.map((entry: any) => {
          const paths = list(entry.paths).filter((value: any) => typeof value === "string");
          return [
            entry.surface ?? "—",
            `${formatNumber(entry.count)} · ${list(entry.scopes).join(", ") || "—"}`,
            paths[0] ? <OpenFileButton path={paths[0]} label={paths[0]} /> : "—",
          ];
        })}
        emptyMessage={copy("No configured asset inventory was retained.", "未保留配置资产清单。")}
        striped
      />
    </Stack>
  );
}

function ContextWindow() {
  const usage = report?.summary?.contextUsage;
  if (!usage || usage.status !== "observed") {
    return (
      <Stack gap={8}>
        <H2>{copy("Context Window", "Context Window")}</H2>
        <Callout tone="neutral" title={copy("Native snapshot unobserved", "未观察到原生快照")}>
          {copy(
            "Cursor did not expose a workspace Context Usage canvas for this report window. No token total or category share is inferred.",
            "Cursor 在本次报告窗口中没有提供工作区 Context Usage Canvas，因此不会推断 token 总量或分类占比。",
          )}
        </Callout>
      </Stack>
    );
  }
  const categories = list(usage.categories);
  const items = list(usage.items);
  return (
    <Stack gap={12}>
      <Row justify="space-between" align="end" gap={12} wrap>
        <Stack gap={4}>
          <H2>{copy("Context Window", "Context Window")}</H2>
          <Text tone="secondary">
            {copy("Latest workspace-scoped native Cursor snapshot; raw item text is omitted.", "最新的工作区级 Cursor 原生快照；原始条目文本已省略。")}
          </Text>
        </Stack>
        <NewChatButton
          label={copy("Reduce context usage", "减少上下文占用")}
          prompt={copy(
            "Review the Context Window section in this Better Harness canvas. Identify the largest reducible categories and propose evidence-safe changes without removing required rules or validation context.",
            "复核这份 Better Harness Canvas 的 Context Window 板块。识别最值得削减的类别，并在不删除必要规则或验证上下文的前提下提出有证据边界的调整。",
          )}
        />
      </Row>
      <UsageBar
        total={number(usage.contextWindowSize)}
        topLeftLabel={`${formatNumber(usage.percentFull)}% ${copy("Full", "已用")}`}
        topRightLabel={`${formatTokens(usage.totalTokensUsed)} / ${formatTokens(usage.contextWindowSize)} Tokens`}
        segments={categories.map((category: any, index: number) => ({
          id: category.id,
          value: number(category.estimatedTokens),
          color: usageColorSequence[index % usageColorSequence.length],
        }))}
      />
      <Stack gap={4}>
        {categories.map((category: any, index: number) => {
          const categoryItems = items
            .filter((item: any) => item.categoryId === category.id)
            .sort((left: any, right: any) => number(right.estimatedTokens) - number(left.estimatedTokens));
          return (
            <CollapsibleSection
              key={category.id}
              title={category.label ?? category.id}
              count={categoryItems.length}
              leading={<Swatch color={usageColorSequence[index % usageColorSequence.length]} />}
              trailing={<Text size="small" tone="tertiary">{formatTokens(category.estimatedTokens)} tokens</Text>}
            >
              <Stack gap={6}>
                {categoryItems.slice(0, 20).map((item: any) => (
                  <Row key={item.id} justify="space-between" align="center" gap={10} wrap>
                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                      <Text size="small" truncate>{item.label}</Text>
                      <Text size="small" tone="tertiary">
                        {formatTokens(item.estimatedTokens)} tokens · {formatNumber(item.characterCount)} chars
                      </Text>
                    </Stack>
                    <OpenFileButton path={item.source?.path} />
                  </Row>
                ))}
                {categoryItems.length > 20 ? (
                  <Text size="small" tone="tertiary">{copy("Additional bounded items omitted from the default view.", "其余有界条目已从默认视图中省略。")}</Text>
                ) : null}
              </Stack>
            </CollapsibleSection>
          );
        })}
      </Stack>
    </Stack>
  );
}

function Findings() {
  const findings = list(report?.findings);
  return (
    <Stack gap={12}>
      <Row justify="space-between" align="end" wrap gap={10}>
        <Stack gap={4}>
          <H2>{copy("Prioritized improvements", "优先改进项")}</H2>
          <Text tone="secondary">{copy(`${findings.length} evidence-backed findings`, `${findings.length} 项有证据支持的发现`)}</Text>
        </Stack>
      </Row>
      <Grid columns="repeat(auto-fit, minmax(290px, 1fr))" gap={10} align="stretch">
        {findings.map((finding: any) => {
          const outputs = list(finding.expectedOutput);
          const filePath = findingFilePath(finding);
          return (
            <Card key={finding.id} style={{ height: "100%" }}>
              <CardHeader trailing={<Pill size="sm" active={finding.severity === "High"}>{finding.severity ?? "—"}</Pill>}>
                {finding.title ?? finding.id}
              </CardHeader>
              <CardBody style={{ height: "100%" }}>
                <Stack gap={10} style={{ height: "100%" }}>
                  <Text size="small" tone="secondary" style={{ lineHeight: 1.55 }}>{finding.reason ?? "—"}</Text>
                  {outputs.length > 0 ? (
                    <CollapsibleSection title={copy("Expected output", "预期产出")} count={outputs.length}>
                      <Stack gap={5}>
                        {outputs.map((output: string, index: number) => (
                          <Text key={`${finding.id}-output-${index}`} size="small" tone="secondary">{index + 1}. {output}</Text>
                        ))}
                      </Stack>
                    </CollapsibleSection>
                  ) : null}
                  <Divider />
                  <Row gap={8} align="center" wrap style={{ marginTop: "auto" }}>
                    <NewChatButton prompt={finding.aiFixPrompt} label={copy("Plan AI Fix", "规划 AI 修复")} />
                    <OpenFileButton path={filePath} />
                  </Row>
                </Stack>
              </CardBody>
            </Card>
          );
        })}
      </Grid>
    </Stack>
  );
}

function Suggestions() {
  const suggestions = list(report?.summary?.suggestions);
  if (suggestions.length === 0) return null;
  return (
    <Stack gap={10}>
      <H2>{copy("Next opportunities", "后续机会")}</H2>
      {suggestions.map((suggestion: any) => (
        <CollapsibleSection
          key={suggestion.id}
          title={suggestion.title ?? suggestion.id}
          trailing={<Text size="small" tone="tertiary">{suggestion.confidence ?? "—"}</Text>}
        >
          <Stack gap={8}>
            <Text size="small" tone="secondary">{suggestion.reason ?? "—"}</Text>
            <Text size="small"><Text as="span" weight="semibold">{copy("Next step: ", "下一步：")}</Text>{suggestion.nextStep ?? "—"}</Text>
            <NewChatButton
              label={copy("Discuss opportunity", "讨论这个机会")}
              prompt={copy(
                `Review the Better Harness opportunity “${suggestion.title ?? suggestion.id}”. Check its prerequisites, evidence boundary, owner, and validation before proposing changes.`,
                `复核 Better Harness 机会“${suggestion.title ?? suggestion.id}”。先检查前置条件、证据边界、负责人和验证方式，再提出改动。`,
              )}
            />
          </Stack>
        </CollapsibleSection>
      ))}
    </Stack>
  );
}

function EvidenceAndMethodology() {
  const boundary = report?.summary?.evidenceBoundary ?? {};
  const manifest = boundary.manifest ?? {};
  const selection = manifest.selection ?? {};
  const facets = list(report?.summary?.semanticFacets?.entries);
  const sourceGaps = list(boundary.sourceGaps);
  return (
    <Stack gap={12}>
      <H2>{copy("Evidence and methodology", "证据与方法")}</H2>
      <Callout tone={sourceGaps.length > 0 ? "warning" : "info"} title={copy("Decision boundary", "决策边界")}>
        {copy(
          `Analyzed ${formatNumber(selection.analyzedCount)} of ${formatNumber(selection.eligibleCount)} eligible sessions with ${selection.confidence ?? "unknown"} sampling confidence.`,
          `共分析 ${formatNumber(selection.analyzedCount)} / ${formatNumber(selection.eligibleCount)} 个符合条件的会话，抽样可信度为 ${selection.confidence ?? "未知"}。`,
        )}
      </Callout>
      <Grid columns="repeat(auto-fit, minmax(180px, 1fr))" gap={10}>
        <Stat value={selection.strategy ?? "—"} label={copy("Selection", "抽样方式")} />
        <Stat value={formatNumber(boundary.episodeCoverage?.episodeCount)} label={copy("Task episodes", "任务片段")} />
        <Stat value={sourceGaps.length} label={copy("Source gaps", "来源缺口")} tone={sourceGaps.length > 0 ? "warning" : "success"} />
      </Grid>
      {facets.length > 0 ? (
        <Stack gap={8}>
          <H3>{copy("Session observations", "会话观察")}</H3>
          <Grid columns="repeat(auto-fit, minmax(260px, 1fr))" gap={10}>
            {facets.slice(0, 6).map((facet: any, index: number) => (
              <Card key={facet.id ?? index}>
                <CardHeader>{facet.title ?? facet.label ?? copy("Observation", "观察")}</CardHeader>
                <CardBody><Text size="small" tone="secondary">{facet.summary ?? facet.body ?? "—"}</Text></CardBody>
              </Card>
            ))}
          </Grid>
        </Stack>
      ) : null}
      <CollapsibleSection title={copy("Measurement and source gaps", "测量信息和来源缺口")} count={sourceGaps.length}>
        <Stack gap={5}>
          {sourceGaps.length > 0
            ? sourceGaps.map((gap: string) => <Text key={gap} size="small" tone="secondary">{gap}</Text>)
            : <Text size="small" tone="secondary">{copy("No declared source gaps.", "没有声明的来源缺口。")}</Text>}
        </Stack>
      </CollapsibleSection>
    </Stack>
  );
}

export default function BetterHarnessCursorReport() {
  const theme = useHostTheme();
  return (
    <Stack
      gap={30}
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: 24,
        color: theme.text.primary,
        boxSizing: "border-box",
      }}
    >
      <ReportHeader />
      <Divider />
      <Strengths />
      <FluencyDimensions />
      <ProjectUsage />
      <AgentPractice />
      <ContextWindow />
      <Findings />
      <Suggestions />
      <EvidenceAndMethodology />
    </Stack>
  );
}
