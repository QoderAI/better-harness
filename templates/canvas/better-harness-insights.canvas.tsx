import {
  AreaChart,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Dialog,
  Divider,
  Fluency,
  Grid,
  H1,
  H2,
  MetricsGrid,
  Row,
  RiskHeatmap,
  SendToChatButton,
  Stack,
  Table,
  Tag,
  Text,
} from "qoder/canvas";
import hostReportData from "./findings.json";
import canvasData from "./canvas.json";

function mergeCanvasRows(hostRows, canvasRows) {
  const detailById = new Map(
    (Array.isArray(canvasRows) ? canvasRows : [])
      .filter((row) => row && typeof row === "object" && typeof row.id === "string")
      .map((row) => [row.id, row]),
  );
  return (Array.isArray(hostRows) ? hostRows : []).map((row) => ({ ...detailById.get(row?.id), ...row }));
}

function mergeCanvasObjects(host, detail) {
  if (!host || typeof host !== "object" || Array.isArray(host)) return detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return host;
  const merged = { ...host };
  for (const [key, value] of Object.entries(detail)) {
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeCanvasObjects(host[key], value)
      : value;
  }
  return merged;
}

function mergeCanvasReport(host, detail) {
  const summary = host?.summary ?? {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return host;
  return {
    summary: {
      ...(detail?.summary ?? {}),
      ...summary,
      atAGlance: mergeCanvasObjects(detail?.summary?.atAGlance, summary.atAGlance),
      dimensions: mergeCanvasRows(summary.dimensions, detail?.dimensions),
    },
    findings: mergeCanvasRows(host?.findings, detail?.findings),
  };
}

const report = mergeCanvasReport(hostReportData, canvasData);

const pageStyle = { maxWidth: 960, margin: "0 auto", padding: 16, boxSizing: "border-box" };
const taskLoopPageStyle = { ...pageStyle, padding: 20 };
const taskLoopReaderCopyStyle = { maxWidth: 940 };

const DIMENSION_SUMMARY_EXAMPLE = "Example: project guidance makes the main workflow clear, but ownership for cross-cutting changes is not documented.";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function projectName() {
  return report.summary?.projectName ?? "Better Harness Report";
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function openingStrengths() {
  const explicit = list(report.summary?.strengths).map(textValue).filter(Boolean);
  return explicit.length ? explicit.slice(0, 3) : ["Reviewed project signals are organized into dimensions and issue findings."];
}

function averageScore(dimensions) {
  if (dimensions.length === 0) return 0;
  return Math.round(dimensions.reduce((sum, row) => sum + clampScore(row.score), 0) / dimensions.length);
}

function scoreTone(score) {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

function stageStatus(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  if (score > 0) return "low";
  return "blocked";
}

function fluencyReason(row) {
  return textValue(row?.summary) || taskLoopCopy(
    "No reviewed score explanation is available for this dimension.",
    "这个维度暂时没有经过复核的评分说明。",
  );
}

function splitFluencyTooltipReason(value) {
  let remaining = textValue(value).replace(/\s+/g, " ");
  const chunks = [];
  const limits = /[\u3400-\u9fff]/.test(remaining) ? [20, 20, 20, 20] : [34, 30, 30, 30];
  for (const limit of limits) {
    if (!remaining) break;
    if (remaining.length <= limit) {
      chunks.push(remaining);
      remaining = "";
      break;
    }
    let cut = remaining.lastIndexOf(" ", limit);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining && chunks.length) {
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1].slice(0, 29)}…`;
  }
  return chunks;
}

function dimensionFluencyStages(dimensions) {
  return dimensions.map((row) => {
    const score = clampScore(row.score);
    const usesGenericBand = row.id !== "learning-capture";
    return {
      id: row.id,
      name: taskLoopDimensionLabel(row.id),
      score,
      ...(usesGenericBand ? { status: stageStatus(score), blocker: score <= 20 } : {}),
    };
  });
}

function dimensionFluencyTooltip(row) {
  const [title, ...rows] = splitFluencyTooltipReason(fluencyReason(row));
  return {
    title,
    rows: rows.map((value) => ({ value })),
  };
}

function severityTone(value) {
  if (value === "Critical" || value === "High") return "danger";
  if (value === "Medium") return "warning";
  if (value === "Low") return "success";
  return "neutral";
}

function severityRank(value) {
  if (value === "Critical") return 0;
  if (value === "High") return 1;
  if (value === "Medium") return 2;
  if (value === "Low") return 3;
  return 4;
}

function dimensionLabel(id, dimensions) {
  const match = dimensions.find((row) => row.id === id);
  return match?.label ?? id.replace(/-/g, " ");
}

function aiAgentPractice() {
  return report.summary?.aiAgentPractice ?? {};
}

function practiceRows() {
  const rows = aiAgentPractice().coverageRows;
  return Array.isArray(rows) ? rows : [];
}

function inspectedSurfaces() {
  const surfaces = aiAgentPractice().inspectedSurfaces;
  return Array.isArray(surfaces) ? surfaces : [];
}

function visiblePracticePaths(value) {
  return list(value).map(textValue).filter((candidate) => candidate
    && !candidate.includes("SharedClientCache/projects/")
    && !candidate.startsWith("/")
    && !/^[A-Za-z]:[\\/]/.test(candidate)
    && !candidate.split(/[\\/]/).includes(".."));
}

function practiceDescription(surface) {
  const descriptions = {
    Rules: ["Standing project guidance and task-routing instructions.", "项目常驻指引与任务路由说明。"],
    Skills: ["Reusable agent workflows available to the project.", "项目可用的可复用 Agent 工作流。"],
    "Custom Agents": ["Specialized agent profiles available for delegated work.", "可用于委派工作的专用 Agent 配置。"],
    Hooks: ["Lifecycle automation around agent and delivery events.", "围绕 Agent 与交付事件的生命周期自动化。"],
    MCP: ["External tools and resources exposed through MCP.", "通过 MCP 暴露的外部工具与资源。"],
    Commands: ["Named command entry points for repeatable agent work.", "可重复 Agent 工作的命令入口。"],
    Workflows: ["Reusable multi-step project workflows.", "可复用的多步骤项目工作流。"],
    Plugins: ["Installed packages that contribute agent capabilities.", "提供 Agent 能力的已安装插件。"],
    "Session Insights": ["Task-session evidence available for report analysis.", "可用于报告分析的任务会话证据。"],
    Memories: ["Representative project or global Memory note files.", "项目级或全局 Memory 的代表性笔记文件。"],
  };
  const copy = descriptions[surface] ?? ["Recorded agent capability sources.", "已记录的 Agent 能力来源。"];
  return taskLoopCopy(copy[0], copy[1]);
}

function TaskLoopPracticePaths({ paths }) {
  if (paths.length === 0) return null;
  const preview = paths.slice(0, 2);
  const remaining = paths.slice(2);
  return (
    <Stack gap={4}>
      {preview.map((path, index) => (
        <Text key={`${path}-${index}`} size="sm" tone="tertiary" truncate>{path}</Text>
      ))}
      {remaining.length ? (
        <CollapsibleSection
          size="sm"
          defaultOpen={false}
          title={(
            <Text size="sm" weight="semibold">
              {taskLoopCopy(`View ${remaining.length} more locations`, `查看其余 ${remaining.length} 个位置`)}
            </Text>
          )}
          bodyStyle={{ padding: "4px 0 0 16px" }}
          headerStyle={{ borderBottom: "none", minHeight: 24 }}
        >
          <Stack gap={4} style={{ maxHeight: 240, overflowY: "auto", paddingRight: 4 }}>
            {remaining.map((path, index) => (
              <Text key={`${path}-${index}`} size="sm" tone="tertiary" style={{ overflowWrap: "anywhere" }}>{path}</Text>
            ))}
          </Stack>
        </CollapsibleSection>
      ) : null}
    </Stack>
  );
}

function PracticeSourceCard({ row }) {
  const paths = visiblePracticePaths(row.paths);
  const scopes = list(row.scopes);
  return (
    <Card size="sm">
      <CardHeader
        title={(
          <Row gap={7} align="center" style={{ minWidth: 0 }}>
            <PracticeSurfaceIcon row={row} />
            <Text weight="semibold" truncate>{row.surface ?? taskLoopCopy("Surface", "能力面")}</Text>
          </Row>
        )}
        trailing={Number.isInteger(Number(row.count)) ? <Tag size="sm" tone="neutral">{row.count}</Tag> : undefined}
      />
      <CardBody style={{ height: "100%" }}>
        <Stack gap={10} style={{ height: "100%" }}>
          <Text size="sm" tone="secondary" style={{ lineHeight: 1.5 }}>{practiceDescription(row.surface)}</Text>
          {scopes.length || paths.length ? (
            <Stack gap={6} style={{ marginTop: "auto" }}>
              {scopes.length ? (
                <Row gap={5} wrap>
                  {scopes.map((scope) => <Tag key={scope} size="sm" tone="info">{scope}</Tag>)}
                </Row>
              ) : null}
              {paths.length ? (
                <Stack gap={4}>
                  <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Sources", "来源")}</Text>
                  <TaskLoopPracticePaths paths={paths} />
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </CardBody>
    </Card>
  );
}

function OpeningStrengths() {
  const strengths = openingStrengths();
  return (
    <Callout tone="success" title="What is working">
      <Stack gap={6}>
        {strengths.map((strength, index) => (
          <Text key={index} size="sm">{strength}</Text>
        ))}
      </Stack>
    </Callout>
  );
}

function DimensionSummary({ dimensions }) {
  return (
    <Stack gap={8}>
      {dimensions.map((row) => {
        const score = clampScore(row.score);
        return (
          <Card key={row.id} size="sm">
            <CardHeader
              title={<Text weight="semibold">{taskLoopDimensionLabel(row.id)}</Text>}
              trailing={<Tag tone={scoreTone(score)}>{score}%</Tag>}
            />
            <CardBody>
              <Stack gap={4}>
                <Text size="sm" tone="secondary">{textValue(row.summary) || DIMENSION_SUMMARY_EXAMPLE}</Text>
                {list(row.findingRefs).length ? (
                  <Text size="sm" tone="secondary">Linked findings: {row.findingRefs.join(", ")}</Text>
                ) : null}
              </Stack>
            </CardBody>
          </Card>
        );
      })}
    </Stack>
  );
}

function FindingItem({ row, dimensions }) {
  return (
    <Card size="sm">
      <CardHeader
        title={<Text weight="semibold">{row.title ?? row.id}</Text>}
        trailing={<Tag tone={severityTone(row.severity)}>{row.severity ?? "Unrated"}</Tag>}
      />
      <CardBody>
        <Stack gap={8}>
          <Row gap={8} align="center" wrap>
            {list(row.dimensionRefs).slice(0, 1).map((ref) => (
              <Tag key={ref} tone="neutral">{dimensionLabel(ref, dimensions)}</Tag>
            ))}
          </Row>
          <Row gap={12} align="center" justify="end" wrap>
            <SendToChatButton text={row.aiFixPrompt} options={{ submit: false }} disabled={!row.aiFixPrompt}>
              AI Fix
            </SendToChatButton>
          </Row>
        </Stack>
      </CardBody>
    </Card>
  );
}

function PracticeCoverage() {
  const rows = practiceRows();
  const surfaces = inspectedSurfaces();

  return (
    <Stack gap={8}>
      <Row justify="space-between" align="center" wrap gap={8}>
        <Text weight="semibold">AI Agent Practices</Text>
        {surfaces.length ? <Tag tone="neutral">{surfaces.length} surfaces</Tag> : null}
      </Row>
      {rows.length ? (
        <Grid columns={3} minColumnWidth={260} gap={10} align="stretch">
          {rows.map((row, index) => <PracticeSourceCard key={row.surface ?? index} row={row} />)}
        </Grid>
      ) : <Text tone="secondary">No AI Agent practice rows recorded.</Text>}
    </Stack>
  );
}

function usesChineseReaderCopy() {
  const locale = textValue(report.summary?.locale);
  if (locale) return locale.toLowerCase().startsWith("zh");
  const readerSample = [
    ...list(report.summary?.strengths),
    ...list(report.findings).slice(0, 3).flatMap((row) => [row?.title, row?.reason, row?.reader]),
  ].map(textValue).join(" ");
  return /[\u3400-\u9fff]/.test(readerSample);
}

function taskLoopCopy(english, chinese) {
  return usesChineseReaderCopy() ? chinese : english;
}

function taskLoopDimensionLabel(id) {
  if (!id) return taskLoopCopy("not observed", "未观察到");
  return dimensionLabel(id, list(report.summary?.dimensions));
}

function learningStateLabel(value) {
  const labels = {
    "N/A": ["Needs a comparison", "需要比较"],
    pending: ["Comparison planned", "已计划比较"],
    improving: ["Improving", "正在改善"],
    unchanged: ["No clear change", "没有明显变化"],
    regressing: ["Worse — stop or revert", "变差——停止或回退"],
    "outcome-supported": ["A later result supports it", "后续结果支持它"],
  }[value];
  return labels ? taskLoopCopy(labels[0], labels[1]) : taskLoopCopy("Not observed", "未观察到");
}

function taskLoopSummary() {
  return report.summary?.atAGlance ?? {};
}

function taskLoopUsageActivity() {
  const activity = report.summary?.usageActivity;
  return activity && list(activity.dates).length ? activity : null;
}

function taskLoopUsageEfficiency() {
  const usage = report.summary?.usageEfficiency;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  return usage.selection || usage.accounting || usage.longSessions || usage.modelUsage || usage.reviewLead
    ? usage
    : null;
}

function usageSeriesTotal(series) {
  return list(series).reduce((sum, row) => sum + Number(row?.total ?? 0), 0);
}

function usageActivityMatrix(activity) {
  const sourceDates = list(activity?.dates);
  if (!sourceDates.length) return null;
  const last = new Date(`${sourceDates.at(-1)}T00:00:00.000Z`);
  const windowStart = new Date(last.getTime() - (364 * 86_400_000));
  const start = new Date(windowStart);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const weekCount = 53;
  const columns = Array.from({ length: weekCount }, (_, index) => {
    const date = new Date(start.getTime() + (index * 7 * 86_400_000));
    const previous = index > 0 ? new Date(start.getTime() + ((index - 1) * 7 * 86_400_000)) : null;
    if (!previous || previous.getUTCMonth() === date.getUTCMonth()) return "";
    return usesChineseReaderCopy()
      ? `${date.getUTCMonth() + 1}月`
      : date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  });
  const values = Array.from({ length: 7 }, () => Array(weekCount).fill(null));
  for (let dayOffset = 0; dayOffset < 365; dayOffset += 1) {
    const date = new Date(windowStart.getTime() + (dayOffset * 86_400_000));
    const week = Math.floor((date.getTime() - start.getTime()) / (7 * 86_400_000));
    const dateKey = date.toISOString().slice(0, 10);
    values[date.getUTCDay()][week] = {
      id: dateKey,
      value: 0,
      ariaLabel: taskLoopCopy(`${dateKey}: no observed activity`, `${dateKey}：未观察到活动`),
    };
  }
  sourceDates.forEach((date, index) => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    const week = Math.floor((parsed.getTime() - start.getTime()) / (7 * 86_400_000));
    if (week < 0 || week >= weekCount) return;
    const active = Number(activity?.sessions?.activeMinutes?.[index] ?? 0);
    values[parsed.getUTCDay()][week] = {
      id: date,
      value: active,
      ariaLabel: taskLoopCopy(`${date}: ${formatActivityMinutes(active)}`, `${date}：${formatActivityMinutes(active)}`),
    };
  });
  return { columns, values, start: windowStart.toISOString().slice(0, 10), end: sourceDates.at(-1) };
}

function usageChartWindow(activity) {
  const dates = list(activity?.dates);
  const offset = Math.max(0, dates.length - 30);
  return { offset, categories: dates.slice(offset).map((date) => String(date).slice(5)) };
}

function visibleUsageSeries(series, offset, limit = 5) {
  const rows = list(series);
  const named = rows.filter((row) => row?.name !== "Other");
  const primary = named.slice(0, limit).map((row) => ({ name: usageSeriesLabel(row.name), data: list(row.daily).slice(offset), total: Number(row.total ?? 0) }));
  const remainder = [...named.slice(limit), ...rows.filter((row) => row?.name === "Other")];
  if (remainder.length > 0) {
    const length = primary[0]?.data.length ?? list(remainder[0]?.daily).slice(offset).length;
    primary.push({
      name: "Other",
      total: remainder.reduce((sum, row) => sum + Number(row?.total ?? 0), 0),
      data: Array.from({ length }, (_, index) => remainder.reduce((sum, row) => sum + Number(list(row?.daily).slice(offset)[index] ?? 0), 0)),
    });
  }
  return primary;
}

function formatUsageNumber(value) {
  return Math.round(Number(value ?? 0)).toLocaleString(usesChineseReaderCopy() ? "zh-CN" : "en-US");
}

function usageSeriesLabel(value) {
  if (value === "Unknown model") return taskLoopCopy("Unattributed model", "未归属模型");
  if (value === "Unknown Skill") return taskLoopCopy("Unattributed Skill", "未归属 Skill");
  return value;
}

function formatActivityMinutes(value) {
  const formatted = Number(value ?? 0).toLocaleString(usesChineseReaderCopy() ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  });
  return `${formatted} ${taskLoopCopy("min", "分钟")}`;
}

function taskLoopCoverage() {
  return taskLoopSummary().coverage ?? {};
}

function confidenceLabel(value) {
  const normalized = textValue(value).toLowerCase();
  const labels = {
    high: ["High confidence", "高可信度"],
    medium: ["Medium confidence", "中等可信度"],
    low: ["Low confidence", "低可信度"],
  }[normalized];
  return labels ? taskLoopCopy(labels[0], labels[1]) : taskLoopCopy("Confidence not recorded", "未记录可信度");
}

function confidenceTone(value) {
  const normalized = textValue(value).toLowerCase();
  if (normalized === "high") return "success";
  if (normalized === "medium") return "warning";
  return "neutral";
}

function taskLoopStateLabel(value) {
  const labels = {
    Wired: ["Wired", "机制已接入"],
    Present: ["Present", "已发现机制"],
    Unobserved: ["Unobserved", "未观察到"],
    observed: ["Observed", "已观察到"],
    "Not applicable": ["Not applicable", "暂不适用"],
    "N/A": ["Needs a comparison", "需要比较"],
  }[value];
  return labels ? taskLoopCopy(labels[0], labels[1]) : textValue(value) || "—";
}

function taskLoopSubdimensionLabel(id) {
  for (const dimension of list(report.summary?.dimensions)) {
    const match = list(dimension?.subdimensions).find((row) => row?.id === id);
    if (match) return match.label ?? id;
  }
  return id;
}

function evidenceReferenceLabel(item) {
  return textValue(item?.label) || textValue(item?.id) || taskLoopCopy("Unnamed evidence", "未命名证据");
}

function evidenceReferenceMeta(item) {
  return [
    textValue(item?.status),
    textValue(item?.type),
    Number.isFinite(Number(item?.line)) ? `${taskLoopCopy("line", "行")} ${item.line}` : "",
  ].filter(Boolean).join(" · ");
}

function EvidenceReferenceList({ items }) {
  return (
    <Stack gap={7} style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
      {items.map((item, index) => (
        <Stack key={`${item?.group ?? item?.kind}-${item?.id ?? index}`} gap={3}>
          <Row gap={6} align="center" wrap>
            {item?.group ? <Tag size="sm" tone="neutral">{item.group}</Tag> : null}
            {item?.kind ? <Tag size="sm" tone="info">{item.kind}</Tag> : null}
            <Text size="sm" tone="secondary" style={{ overflowWrap: "anywhere" }}>{evidenceReferenceLabel(item)}</Text>
          </Row>
          {evidenceReferenceMeta(item) ? <Text size="sm" tone="tertiary">{evidenceReferenceMeta(item)}</Text> : null}
        </Stack>
      ))}
    </Stack>
  );
}

function severityLabel(value) {
  const labels = {
    Critical: ["Critical", "紧急"],
    High: ["High", "高"],
    Medium: ["Medium", "中"],
    Low: ["Low", "低"],
  }[value];
  return labels ? taskLoopCopy(labels[0], labels[1]) : value ?? "—";
}

function practiceSurfaceGlyph(surface) {
  return ({ Rules: "R", Skills: "S", "Custom Agents": "A", Hooks: "H", MCP: "M" })[surface] ?? textValue(surface).slice(0, 1).toUpperCase() ?? "?";
}

function PracticeSurfaceIcon({ row }) {
  return <Tag size="sm" tone="neutral">{practiceSurfaceGlyph(row?.surface)}</Tag>;
}

function TaskLoopReportHeader({ findings }) {
  const sources = practiceRows().filter((row) => Number(row?.count) > 0);
  const overview = textValue(report.summary?.overview);
  return (
    <Stack gap={8}>
      <H1>{projectName()}</H1>
      {overview ? <Text tone="secondary" style={{ ...taskLoopReaderCopyStyle, lineHeight: 1.5 }}>{overview}</Text> : null}
      <Row gap={10} align="center" wrap>
        <Text size="sm" tone="secondary">
          {taskLoopCopy(`${findings.length} prioritized improvements`, `${findings.length} 项优先优化`)}
        </Text>
        {sources.length ? (
          <Text size="sm" tone="secondary">
            {taskLoopCopy(`${sources.length} practice source types`, `${sources.length} 类实践来源`)}
          </Text>
        ) : null}
      </Row>
    </Stack>
  );
}

function TaskLoopFluency({ dimensions }) {
  if (dimensions.length === 0) return null;
  return (
    <Stack gap={8}>
      <Row justify="space-between" align="center" wrap gap={8}>
        <H2>{taskLoopCopy("Agent Work Loop", "Agent 工作流")}</H2>
        <Text size="sm" tone="secondary">{dimensions.length} {taskLoopCopy("dimensions", "个维度")}</Text>
      </Row>
      <Stack style={{ maxHeight: 200, overflow: "hidden" }}>
        <Fluency
          projectName={projectName()}
          stages={dimensionFluencyStages(dimensions)}
          tooltip={(_stage, index) => dimensionFluencyTooltip(dimensions[index])}
          height={180}
          highThreshold={70}
          mediumThreshold={40}
          showStageLabels
        />
      </Stack>
    </Stack>
  );
}

function practiceCount(row) {
  const value = Number(row?.count);
  return Number.isInteger(value) ? value : "—";
}

function practiceScopeCell(row) {
  const scopes = list(row?.scopes).map(textValue).filter(Boolean);
  if (!scopes.length) return <Text size="sm" tone="tertiary">—</Text>;
  return (
    <Row gap={5} wrap>
      {scopes.map((scope) => <Tag key={scope} size="sm" tone="info">{scope}</Tag>)}
    </Row>
  );
}

function practiceSourceCell(row) {
  const [firstPath] = visiblePracticePaths(row?.paths);
  return firstPath
    ? <Text size="sm" tone="secondary" style={{ overflowWrap: "anywhere" }}>{firstPath}</Text>
    : <Text size="sm" tone="tertiary">{taskLoopCopy("No source location recorded", "未记录来源位置")}</Text>;
}

function practiceSourceDetail(row) {
  const remaining = visiblePracticePaths(row?.paths).slice(1);
  if (!remaining.length) return null;
  const pathListStyle = remaining.length > 8
    ? { maxHeight: 220, overflowY: "auto", paddingRight: 4 }
    : { paddingRight: 4 };
  return (
    <CollapsibleSection
      size="sm"
      defaultOpen={false}
      title={(
        <Text size="sm" weight="semibold">
          {taskLoopCopy(`View ${remaining.length} more locations`, `查看其余 ${remaining.length} 个位置`)}
        </Text>
      )}
      bodyStyle={{ padding: "6px 0 2px 16px" }}
      headerStyle={{ borderBottom: "none", minHeight: 24 }}
    >
      <Stack gap={4} style={pathListStyle}>
        {remaining.map((path, index) => (
          <Text key={`${path}-${index}`} size="sm" tone="tertiary" style={{ overflowWrap: "anywhere" }}>{path}</Text>
        ))}
      </Stack>
    </CollapsibleSection>
  );
}

function taskLoopPracticeColumns() {
  return [
    {
      key: "surface",
      title: taskLoopCopy("Asset", "资产"),
      minWidth: "300px",
      render: (row) => (
        <Stack gap={3}>
          <Row gap={7} align="center">
            <PracticeSurfaceIcon row={row} />
            <Text size="sm" weight="semibold">{row.surface ?? taskLoopCopy("Surface", "能力面")}</Text>
          </Row>
          <Text size="sm" tone="secondary">{practiceDescription(row.surface)}</Text>
        </Stack>
      ),
    },
    {
      key: "coverage",
      title: taskLoopCopy("Coverage", "覆盖范围"),
      width: "170px",
      minWidth: "150px",
      render: (row) => (
        <Stack gap={4}>
          <Text size="sm" weight="semibold">
            {taskLoopCopy(`${practiceCount(row)} sources`, `${practiceCount(row)} 个来源`)}
          </Text>
          {practiceScopeCell(row)}
        </Stack>
      ),
    },
    {
      key: "source",
      title: taskLoopCopy("Representative source", "代表来源"),
      minWidth: "260px",
      render: practiceSourceCell,
    },
  ];
}

function TaskLoopPracticeTable({ rows = practiceRows() }) {
  if (rows.length === 0) {
    return <Text tone="secondary">{taskLoopCopy("No Agent assets recorded.", "未记录 Agent 工程资产。")}</Text>;
  }
  return (
    <Table
      columns={taskLoopPracticeColumns()}
      rows={rows}
      rowKey={(row) => row.surface ?? "surface"}
      density="compact"
      renderDetail={practiceSourceDetail}
      emptyText={taskLoopCopy("No Agent asset coverage recorded", "未记录 Agent 工程资产覆盖")}
    />
  );
}

function TaskLoopActivityHeatmap({ activity }) {
  const matrix = usageActivityMatrix(activity);
  if (!matrix) return <Text tone="secondary">{taskLoopCopy("No dated session activity was observed.", "没有观察到带日期的会话活动。")}</Text>;
  return (
    <Stack gap={6}>
      <Row justify="space-between" align="center" wrap gap={8}>
        <Text size="sm" weight="semibold">{taskLoopCopy("Daily activity (active minutes)", "每日活动（活跃分钟）")}</Text>
        <Text size="sm" tone="tertiary">{matrix.start} — {matrix.end}</Text>
      </Row>
      <RiskHeatmap
        rows={taskLoopCopy(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], ["日", "一", "二", "三", "四", "五", "六"])}
        columns={matrix.columns}
        values={matrix.values}
        variant="swatch"
        showValues={false}
        showLegend={false}
        valueFormatter={(value) => formatActivityMinutes(value)}
        cellSize={16}
        columnWidth={16}
        rowLabelWidth={34}
        responsive
        minCellSize={8}
        minGap={2}
        initialScrollPosition="end"
        colorTemplate={{
          none: { background: "rgba(127, 127, 127, 0.1)", border: "transparent" },
          low: { background: "rgba(64, 166, 103, 0.22)", border: "transparent" },
          medium: { background: "rgba(54, 158, 94, 0.42)", border: "transparent" },
          high: { background: "rgba(38, 139, 78, 0.66)", border: "transparent" },
          critical: { background: "rgba(24, 115, 63, 0.9)", border: "transparent" },
        }}
        maxHeight={190}
        labels={{ ariaLabel: taskLoopCopy("Daily session activity", "每日会话活动") }}
      />
    </Stack>
  );
}

function UsageStatRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <Row justify="space-between" align="start" gap={12} style={{ minWidth: 0 }}>
      <Text size="sm" tone="secondary" style={{ flexShrink: 0 }}>{label}</Text>
      <Text size="sm" weight="semibold" style={{ minWidth: 0, overflowWrap: "anywhere", textAlign: "right" }}>{value}</Text>
    </Row>
  );
}

function UsageRankList({ series, limit = 5 }) {
  const rows = list(series).slice(0, limit);
  if (!rows.length) return <Text size="sm" tone="secondary">{taskLoopCopy("No usage observed.", "未观察到用量。")}</Text>;
  return (
    <Stack gap={7}>
      {rows.map((row, index) => (
        <Row key={`${row.name}-${index}`} justify="space-between" align="center" gap={12}>
          <Row gap={8} align="center" style={{ minWidth: 0 }}>
            <Text size="sm" tone="tertiary" style={{ width: 18 }}>{index + 1}</Text>
            <Text size="sm" truncate>{usageSeriesLabel(row.name)}</Text>
          </Row>
          <Text size="sm" tone="secondary">{formatUsageNumber(row.total)}</Text>
        </Row>
      ))}
    </Stack>
  );
}

function taskLoopModelUsageColumns() {
  return [
    {
      key: "model",
      title: taskLoopCopy("Model", "模型"),
      minWidth: "180px",
      render: (row) => <Text size="sm" weight="semibold">{usageSeriesLabel(row.model)}</Text>,
    },
    {
      key: "responseCount",
      title: taskLoopCopy("Responses", "响应数"),
      width: "110px",
      align: "right",
      render: (row) => <Text size="sm">{formatUsageNumber(row.responseCount)}</Text>,
    },
    {
      key: "usageFieldObservedCount",
      title: taskLoopCopy("Usage fields observed", "观察到用量字段"),
      minWidth: "160px",
      align: "right",
      render: (row) => <Text size="sm">{formatUsageNumber(row.usageFieldObservedCount)}</Text>,
    },
    {
      key: "nonZeroUsageCount",
      title: taskLoopCopy("Non-zero usage", "非零用量记录"),
      minWidth: "140px",
      align: "right",
      render: (row) => <Text size="sm">{formatUsageNumber(row.nonZeroUsageCount)}</Text>,
    },
  ];
}

function TaskLoopModelUsageTable({ rows }) {
  if (!rows.length) return null;
  return (
    <Stack gap={7}>
      <Row justify="space-between" align="center" wrap gap={8}>
        <Text weight="semibold">{taskLoopCopy("Model response accounting", "模型响应明细")}</Text>
        <Tag tone="neutral">{rows.length} {taskLoopCopy("models", "个模型")}</Tag>
      </Row>
      <Text size="sm" tone="tertiary">
        {taskLoopCopy(
          "These are response counts, not model-active session counts or a quality comparison.",
          "这里统计的是响应次数，不是模型活跃会话数，也不代表模型质量对比。",
        )}
      </Text>
      <Table
        columns={taskLoopModelUsageColumns()}
        rows={rows}
        rowKey={(row) => row.model}
        density="compact"
      />
    </Stack>
  );
}

function TaskLoopLongSessionReview({ usage }) {
  const lead = usage?.reviewLead;
  const samples = list(usage?.longSessions?.samples);
  if (!lead || !samples.length) return null;
  const estimate = usage.longSessions?.estimate;
  const coverage = lead.sampleCoverage;
  const pendingCount = coverage?.shown ?? samples.length;
  const analyzedCount = usage.selection?.analyzedSessionCount ?? 0;
  const longestActiveMinutes = usage.longSessions?.longestActiveMinutes ?? Math.max(...samples.map((sample) => Number(sample.activeMinutes ?? 0)));
  return (
    <Stack gap={14}>
      <Row justify="space-between" align="start" wrap gap={12}>
        <Stack gap={5} style={{ flex: "1 1 620px", minWidth: 0 }}>
          <Row gap={8} align="center" wrap>
            <H2 style={{ fontSize: 18, lineHeight: 1.35 }}>{taskLoopCopy(`${pendingCount} long sessions need review`, `${pendingCount} 个长会话待复核`)}</H2>
            <Tag size="sm" tone="warning">{pendingCount} {taskLoopCopy("pending", "待复核")}</Tag>
          </Row>
          <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
            {taskLoopCopy(
              `${pendingCount} of ${formatUsageNumber(analyzedCount)} analyzed sessions crossed the ${estimate?.activeThresholdMinutes ?? 45}-minute estimate threshold; the longest estimate is ${formatActivityMinutes(longestActiveMinutes)}. Treat them as investigation leads until reviewed.`,
              `${formatUsageNumber(analyzedCount)} 个已分析会话中有 ${pendingCount} 个超过 ${estimate?.activeThresholdMinutes ?? 45} 分钟估算阈值，最长估算为 ${formatActivityMinutes(longestActiveMinutes)}。在人工复核前，只将其视为调查线索。`,
            )}
          </Text>
        </Stack>
        <SendToChatButton text={lead.aiFixPrompt} options={{ submit: false }}>
          {taskLoopCopy(`Review ${pendingCount} sessions`, `复核 ${pendingCount} 个会话`)}
        </SendToChatButton>
      </Row>
      <Stack gap={0}>
        {samples.map((sample, index) => {
          const failureCount = Number(sample.failureCount ?? 0);
          const roleLabel = sample.role === "user-thread-candidate"
            ? taskLoopCopy("Main-thread candidate", "主线程候选")
            : sample.role === "child-agent-candidate"
              ? taskLoopCopy("Child-Agent candidate", "子 Agent 候选")
              : sample.role;
          return (
            <Stack key={sample.alias} gap={0}>
              <Row justify="space-between" align="center" wrap gap={14} style={{ padding: "13px 0" }}>
                <Row gap={12} align="start" style={{ flex: "1 1 540px", minWidth: 0 }}>
                  <Tag size="sm" tone="neutral">{sample.alias}</Tag>
                  <Stack gap={4} style={{ minWidth: 0 }}>
                    <Text weight="semibold" style={{ lineHeight: 1.45 }}>
                      {taskLoopCopy("Anonymized review candidate", "匿名复核候选")}
                    </Text>
                    <Text size="sm" tone="secondary">{taskLoopCopy("Role", "角色")}: {roleLabel}</Text>
                  </Stack>
                </Row>
                <Stack gap={3} style={{ flex: "0 1 190px" }}>
                  <Text size="sm" tone="tertiary">{taskLoopCopy("Estimated active time", "估算活跃时长")}</Text>
                  <Text size="sm" weight="semibold">{formatActivityMinutes(sample.activeMinutes)}</Text>
                </Stack>
                <Tag size="sm" tone="warning">
                  {formatUsageNumber(failureCount)} {taskLoopCopy("failures", "失败事件")}
                </Tag>
              </Row>
              {index < samples.length - 1 ? <Divider style={{ margin: "1px 0" }} /> : null}
            </Stack>
          );
        })}
      </Stack>
      {estimate ? (
        <Text size="sm" tone="tertiary" style={taskLoopReaderCopyStyle}>
          {taskLoopCopy(
            `Estimate boundary: event gaps are capped at ${estimate.gapCapMinutes} minutes and gaps over ${estimate.idleGapMinutes} minutes are treated as idle.`,
            `估算边界：事件间隔最多计 ${estimate.gapCapMinutes} 分钟，超过 ${estimate.idleGapMinutes} 分钟按空闲处理。`,
          )}
        </Text>
      ) : null}
    </Stack>
  );
}

function TaskLoopProjectUsage({ activity, usage }) {
  if (!activity && !usage) return null;
  const activeMinutes = list(activity?.sessions?.activeMinutes).reduce((sum, value) => sum + Number(value ?? 0), 0);
  const census = usage?.selection;
  const longSessions = usage?.longSessions;
  const skillUses = usageSeriesTotal(activity?.skills);
  const analyzedSessions = census
    ? `${formatUsageNumber(census.analyzedSessionCount)} / ${formatUsageNumber(census.eligibleSessionCount)}`
    : activity ? formatUsageNumber(activity.sessions?.total) : null;
  return (
    <Stack gap={12}>
      {activity ? <TaskLoopActivityHeatmap activity={activity} /> : null}
      {activity ? <Divider style={{ margin: "2px 0" }} /> : null}
      <Grid columns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))" gap={24} align="start">
        <Stack gap={9}>
          <Text weight="semibold">{taskLoopCopy("Activity insights", "使用概览")}</Text>
          <UsageStatRow label={taskLoopCopy("Sessions analyzed", "已分析会话")} value={analyzedSessions} />
          {activity ? <UsageStatRow label={taskLoopCopy("Estimated active minutes", "估算活跃分钟数")} value={formatUsageNumber(activeMinutes)} /> : null}
          {activity ? <UsageStatRow label={taskLoopCopy("Skills used", "Skill 使用")} value={formatUsageNumber(skillUses)} /> : null}
          {longSessions ? <UsageStatRow label={taskLoopCopy("Estimated active-long sessions", "估算活跃长会话")} value={formatUsageNumber(longSessions.activeCount)} /> : null}
        </Stack>
        <Stack gap={9}>
          <Text weight="semibold">{taskLoopCopy("Most used Skills", "最常使用的 Skills")}</Text>
          <UsageRankList series={activity?.skills} />
        </Stack>
      </Grid>
    </Stack>
  );
}

function TaskLoopUsageMethodology({ usage }) {
  if (!usage) return null;
  const census = usage.selection;
  const accounting = usage.accounting;
  const roles = usage.roles;
  const outcomeReview = usage.outcomeReview;
  const taskSelection = taskLoopCoverage().selection ?? {};
  const modelUsage = list(usage.modelUsage);
  const hasCoverage = census || Object.keys(taskSelection).length || roles || accounting;
  if (!hasCoverage && !modelUsage.length && !usage.reviewLead) return null;

  return (
    <Stack gap={12}>
      {census || Object.keys(taskSelection).length ? (
        <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
          {taskLoopMeasurementBoundaryText(taskSelection, census)}
        </Text>
      ) : null}
      {roles || accounting ? (
        <Grid columns="repeat(auto-fit, minmax(min(100%, 240px), 1fr))" gap={20} align="start">
          {roles ? (
            <Stack gap={7}>
              <Text size="sm" weight="semibold">{taskLoopCopy("Session composition", "会话构成")}</Text>
              <UsageStatRow label={taskLoopCopy("User-thread candidates", "用户任务候选")} value={formatUsageNumber(roles.userThreadCandidateCount)} />
              <UsageStatRow label={taskLoopCopy("Child-agent candidates", "子 Agent 候选")} value={formatUsageNumber(roles.childAgentCandidateCount)} />
            </Stack>
          ) : null}
          {accounting ? (
            <Stack gap={7}>
              <Text size="sm" weight="semibold">{taskLoopCopy("Measurement coverage", "计量覆盖")}</Text>
              <UsageStatRow label={taskLoopCopy("Responses", "响应数")} value={formatUsageNumber(accounting.responseCount)} />
              <UsageStatRow label={taskLoopCopy("Model-attributed responses", "已归属模型响应")} value={formatUsageNumber(accounting.modelAttributedResponseCount)} />
              <UsageStatRow label={taskLoopCopy("Usage fields observed", "观察到用量字段")} value={formatUsageNumber(accounting.usageFieldObservedCount)} />
              <UsageStatRow label={taskLoopCopy("Non-zero usage records", "非零用量记录")} value={formatUsageNumber(accounting.nonZeroUsageCount)} />
              <UsageStatRow label={taskLoopCopy("Exact credits available", "可精确计算 credit")} value={accounting.exactCreditsAvailable ? taskLoopCopy("Yes", "是") : taskLoopCopy("No", "否")} />
            </Stack>
          ) : null}
        </Grid>
      ) : null}
      {modelUsage.length ? <TaskLoopModelUsageTable rows={modelUsage} /> : null}
      <Text size="sm" tone="tertiary" style={taskLoopReaderCopyStyle}>
        {accounting?.mode === "effort-proxy"
          ? taskLoopCopy("Active time and model-session counts are effort proxies; exact token or credit savings are unavailable.", "活跃时间和模型会话数仅代表投入；目前无法精确计算 token 或 credit 节省。")
          : taskLoopCopy("Usage totals describe observed activity, not counterfactual savings.", "用量只描述已观察活动，不代表反事实节省。")}
        {outcomeReview && !outcomeReview.comparableModelOutcomeEvidence
          ? taskLoopCopy(" Model outcomes need a controlled A/B before comparison.", " 模型效果需要通过受控 A/B 后才能比较。")
          : ""}
      </Text>
    </Stack>
  );
}

function usageTrendLeader(series) {
  return series.reduce((leader, row) => Number(row.total ?? 0) > Number(leader?.total ?? -1) ? row : leader, null);
}

function usageTrendRange(categories) {
  if (!categories.length) return taskLoopCopy("Latest observations", "最近观测");
  if (categories.length === 1) return categories[0];
  return `${categories[0]} – ${categories[categories.length - 1]}`;
}

function TaskLoopUsageTrend({ title, totalLabel, leaderDescription, series, categories }) {
  if (!series.length) return null;
  const total = series.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const leader = usageTrendLeader(series);
  const range = usageTrendRange(categories);
  return (
    <Card size="sm">
      <CardBody>
        <Stack gap={14}>
          <Stack gap={3}>
            <Text weight="semibold" style={{ fontSize: 16, lineHeight: "24px" }}>{title}</Text>
            <Text tone="secondary" style={{ lineHeight: 1.5 }}>
              {taskLoopCopy(
                `${range} · ${formatUsageNumber(total)} ${totalLabel}`,
                `${range} · 共 ${formatUsageNumber(total)} ${totalLabel}`,
              )}
            </Text>
          </Stack>
          <AreaChart categories={categories} series={series} height={190} showYAxis legendPosition="bottom" />
          {leader ? (
            <Stack gap={2}>
              <Text weight="semibold">{usageSeriesLabel(leader.name)} · {formatUsageNumber(leader.total)} {totalLabel}</Text>
              <Text size="sm" tone="tertiary">{leaderDescription}</Text>
            </Stack>
          ) : null}
        </Stack>
      </CardBody>
    </Card>
  );
}

function TaskLoopUsageTrends({ activity }) {
  if (!activity) return null;
  const chartWindow = usageChartWindow(activity);
  const categories = chartWindow.categories;
  const modelSeries = visibleUsageSeries(activity.models, chartWindow.offset);
  const skillSeries = visibleUsageSeries(activity.skills, chartWindow.offset);
  if (!modelSeries.length && !skillSeries.length) return null;
  return (
    <Stack gap={12}>
      <H2>{taskLoopCopy("Usage trends", "用量趋势")}</H2>
      <Grid columns="repeat(auto-fit, minmax(min(100%, 360px), 1fr))" gap={12} align="start">
        <TaskLoopUsageTrend
          title={taskLoopCopy("Model session trend", "模型会话趋势")}
          totalLabel={taskLoopCopy("model-session observations", "个模型会话")}
          leaderDescription={taskLoopCopy("Most observed model in this window", "当前时间窗口内记录最多的模型")}
          series={modelSeries}
          categories={categories}
        />
        <TaskLoopUsageTrend
          title={taskLoopCopy("Skill use trend", "Skill 使用趋势")}
          totalLabel={taskLoopCopy("observations", "次记录")}
          leaderDescription={taskLoopCopy("Most observed Skill in this window", "当前时间窗口内记录次数最多的 Skill")}
          series={skillSeries}
          categories={categories}
        />
      </Grid>
    </Stack>
  );
}

function taskLoopSessionInsightTitle(id) {
  const labels = {
    "session-insight:source-coverage": ["Source coverage", "数据覆盖"],
    "session-insight:validation-behavior": ["Validation behavior", "验证行为"],
    "session-insight:post-edit-validation": ["Post-edit validation", "改动后验证"],
    "session-insight:execution-friction": ["Execution friction", "执行摩擦"],
    "session-insight:tool-mix": ["Tool mix", "工具使用"],
    "session-insight:observed-hooks": ["Observed hooks", "Hook 执行"],
    "session-insight:planning-workflow": ["Planning workflow", "规划工作流"],
    "session-insight:session-complexity": ["Session complexity", "会话复杂度"],
    "session-insight:session-usage-efficiency": ["Session effort", "会话投入"],
  }[id];
  return labels ? taskLoopCopy(labels[0], labels[1]) : id;
}

function taskLoopSessionInsightConfidence(row) {
  return list(row?.labels).map(textValue).find((value) => ["High", "Medium", "Low"].includes(value)) ?? "";
}

function taskLoopSessionInsightColumns() {
  return [
    {
      key: "id",
      title: taskLoopCopy("Observation", "观察主题"),
      minWidth: "150px",
      render: (row) => <Text size="sm" weight="semibold">{taskLoopSessionInsightTitle(row.id)}</Text>,
    },
    {
      key: "summary",
      title: taskLoopCopy("What was observed", "观察说明"),
      minWidth: "420px",
      render: (row) => <Text size="sm" tone="secondary">{row.summary ?? "—"}</Text>,
    },
    {
      key: "confidence",
      title: taskLoopCopy("Confidence", "可信度"),
      minWidth: "120px",
      render: (row) => {
        const confidence = taskLoopSessionInsightConfidence(row);
        return confidence ? <Tag size="sm" tone={confidenceTone(confidence)}>{confidenceLabel(confidence)}</Tag> : <Text size="sm" tone="tertiary">—</Text>;
      },
    },
    {
      key: "evidenceRefs",
      title: taskLoopCopy("Evidence", "证据"),
      width: "80px",
      align: "right",
      render: (row) => <Text size="sm" weight="semibold">{list(row.evidenceRefs).length}</Text>,
    },
  ];
}

function taskLoopSessionInsightDetail(row) {
  const evidenceRefs = list(row?.evidenceRefs);
  return (
    <CollapsibleSection
      size="sm"
      defaultOpen={false}
      title={<Text size="sm" weight="semibold">{taskLoopCopy("View raw observation metadata", "查看原始观察元数据")}</Text>}
      bodyStyle={{ padding: "6px 0 2px 16px" }}
      headerStyle={{ borderBottom: "none", minHeight: 24 }}
    >
      <Stack gap={7}>
        <Text size="sm" tone="tertiary">
          {taskLoopCopy("Insight ID", "洞察 ID")}: {row.id} · {taskLoopCopy("Status", "状态")}: {row.status ?? "—"} · {taskLoopCopy("Kind", "类型")}: {row.kind ?? "—"} · {taskLoopCopy("Model", "模型版本")}: {row.modelVersion ?? "—"}
        </Text>
        {list(row.labels).length ? (
          <Row gap={5} wrap>{row.labels.map((label) => <Tag key={label} size="sm" tone="neutral">{label}</Tag>)}</Row>
        ) : null}
        {evidenceRefs.length ? <EvidenceReferenceList items={evidenceRefs} /> : <Text size="sm" tone="tertiary">{taskLoopCopy("No raw evidence references recorded.", "未记录原始证据引用。")}</Text>}
      </Stack>
    </CollapsibleSection>
  );
}

function taskLoopRepresentativeSessionInsights(entries) {
  const preferredIds = [
    "session-insight:post-edit-validation",
    "session-insight:execution-friction",
    "session-insight:tool-mix",
  ];
  const preferred = preferredIds
    .map((id) => entries.find((entry) => entry?.id === id))
    .filter((entry) => entry && list(entry.evidenceRefs).length > 0);
  const remaining = entries
    .filter((entry) => list(entry?.evidenceRefs).length > 0 && !preferred.includes(entry))
    .sort((left, right) => list(right.evidenceRefs).length - list(left.evidenceRefs).length);
  return [...preferred, ...remaining].slice(0, 3);
}

function TaskLoopSessionInsightsDialog({ entries }) {
  return (
    <Dialog
      trigger={(
        <Button variant="ghost">
          {taskLoopCopy(`View all ${entries.length}`, `查看全部 ${entries.length} 条`)}
        </Button>
      )}
      title={taskLoopCopy("All session observations", "全部会话观察")}
      closeLabel={taskLoopCopy("Close", "关闭")}
      maxWidth={1040}
    >
      <Stack gap={10}>
        <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
          {taskLoopCopy(
            "These are candidate observations projected from session evidence. Read them as investigation leads, not confirmed user intent or outcome claims.",
            "这些是从会话证据投影出的候选观察，用于指引后续调查，不等同于已确认的用户意图或结果结论。",
          )}
        </Text>
        <Table
          columns={taskLoopSessionInsightColumns()}
          rows={entries}
          rowKey={(row) => row.id}
          density="compact"
          renderDetail={taskLoopSessionInsightDetail}
        />
      </Stack>
    </Dialog>
  );
}

function TaskLoopSessionInsights() {
  const entries = list(report.summary?.semanticFacets?.entries);
  if (!entries.length) return null;
  const representativeEntries = taskLoopRepresentativeSessionInsights(entries);
  const rowTones = ["success", "warning", "info"];
  return (
    <Stack gap={10}>
      <Row gap={8} align="center" wrap>
        <H2 style={{ fontSize: 18, lineHeight: 1.35 }}>{taskLoopCopy("Session observations", "会话观察")}</H2>
        <Tag size="sm" tone="neutral">{entries.length} {taskLoopCopy("observations", "条观察")}</Tag>
      </Row>
      <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
        {taskLoopCopy(
          "Representative evidence-bearing observations for follow-up investigation and priority judgment.",
          "按主题呈现的代表性观察，用于指引后续调查与优先级判断。",
        )}
      </Text>
      <Grid columns={3} minColumnWidth={220} gap={8} align="stretch">
        {representativeEntries.map((row, index) => {
          const confidence = taskLoopSessionInsightConfidence(row);
          const evidenceCount = list(row.evidenceRefs).length;
          return (
            <Card key={row.id} size="sm">
              <CardBody style={{ padding: 12, height: 142 }}>
                <Stack gap={8} style={{ height: "100%" }}>
                  <Row gap={7} align="center" style={{ minWidth: 0 }}>
                    <Tag size="sm" tone={rowTones[index]}>{index + 1}</Tag>
                    <Text size="sm" weight="semibold" truncate>{taskLoopSessionInsightTitle(row.id)}</Text>
                  </Row>
                  <Text
                    size="sm"
                    tone="secondary"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      lineHeight: 1.5,
                    }}
                  >
                    {row.summary ?? "—"}
                  </Text>
                  <Row justify="space-between" align="center" wrap gap={6} style={{ marginTop: "auto" }}>
                    {confidence ? <Tag size="sm" tone={confidenceTone(confidence)}>{confidenceLabel(confidence)}</Tag> : null}
                    <Text size="sm" tone="tertiary">
                      {evidenceCount} {taskLoopCopy(evidenceCount === 1 ? "evidence item" : "evidence items", "条证据")}
                    </Text>
                  </Row>
                </Stack>
              </CardBody>
            </Card>
          );
        })}
      </Grid>
      <Row justify="flex-end">
        <TaskLoopSessionInsightsDialog entries={entries} />
      </Row>
    </Stack>
  );
}

function TaskLoopFindingDialog({ row }) {
  const expectedOutput = list(row.expectedOutput).filter((item) => textValue(item));
  const dimensionRefs = list(row.dimensionRefs);
  return (
    <Dialog
      trigger={(
        <Button variant="ghost">{taskLoopCopy("View details", "查看详情")}</Button>
      )}
      title={row.title ?? row.id}
      closeLabel={taskLoopCopy("Close", "关闭")}
      maxWidth={880}
      footer={(
        <Row justify="space-between" align="center" wrap gap={10}>
          <SendToChatButton variant="secondary" text={row.aiFixPrompt} options={{ submit: false }} disabled={!row.aiFixPrompt}>
            {taskLoopCopy("Plan AI Fix", "规划 AI 修复")}
          </SendToChatButton>
        </Row>
      )}
    >
      <Stack gap={16}>
        <Row gap={6} align="center" wrap>
          <Tag size="sm" tone={severityTone(row.severity)}>{severityLabel(row.severity)}</Tag>
          {dimensionRefs.map((dimensionRef) => (
            <Tag key={dimensionRef} size="sm" tone="neutral">{taskLoopDimensionLabel(dimensionRef)}</Tag>
          ))}
        </Row>
        <Stack gap={6} style={taskLoopReaderCopyStyle}>
          <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Cause", "原因")}</Text>
          <Text size="sm" tone="secondary" style={{ lineHeight: 1.6 }}>
            {textValue(row.reason) || taskLoopCopy("No cause was recorded.", "未记录原因。")}
          </Text>
        </Stack>
        <Divider style={{ margin: "2px 0" }} />
        <Stack gap={8} style={taskLoopReaderCopyStyle}>
          <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Expected Output", "预期结果")}</Text>
          {expectedOutput.length ? expectedOutput.map((output, index) => (
            <Row key={`${row.id}-dialog-output-${index}`} gap={8} align="start">
              <Tag size="sm" tone="neutral">{index + 1}</Tag>
              <Text size="sm" tone="secondary" style={{ lineHeight: 1.6 }}>{output}</Text>
            </Row>
          )) : (
            <Text size="sm" tone="tertiary">{taskLoopCopy("No expected output was recorded.", "未记录预期结果。")}</Text>
          )}
        </Stack>
      </Stack>
    </Dialog>
  );
}

function TaskLoopFindingCard({ row }) {
  const [dimensionRef] = list(row.dimensionRefs);
  return (
    <Card size="sm">
      <CardBody style={{ padding: 14, height: 190 }}>
        <Stack gap={10} style={{ height: "100%" }}>
          <Stack gap={7} style={{ minWidth: 0 }}>
            <Row gap={6} align="center" wrap>
              <Tag size="sm" tone={severityTone(row.severity)}>{severityLabel(row.severity)}</Tag>
              {dimensionRef ? <Tag size="sm" tone="neutral">{taskLoopDimensionLabel(dimensionRef)}</Tag> : null}
            </Row>
            <Text
              weight="semibold"
              style={{
                fontSize: 15,
                lineHeight: "21px",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {row.title ?? row.id}
            </Text>
            {textValue(row.reason) ? (
              <Text
                size="sm"
                tone="secondary"
                style={{
                  ...taskLoopReaderCopyStyle,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  lineHeight: 1.5,
                }}
              >
                {row.reason}
              </Text>
            ) : null}
          </Stack>
          <Stack gap={10} style={{ marginTop: "auto" }}>
            <Divider style={{ margin: "2px 0" }} />
            <Row justify="space-between" align="center" wrap gap={10}>
              <SendToChatButton variant="secondary" text={row.aiFixPrompt} options={{ submit: false }} disabled={!row.aiFixPrompt}>
                {taskLoopCopy("Plan AI Fix", "规划 AI 修复")}
              </SendToChatButton>
              <TaskLoopFindingDialog row={row} />
            </Row>
          </Stack>
        </Stack>
      </CardBody>
    </Card>
  );
}

function TaskLoopFindingCards({ findings }) {
  return (
    <Grid columns={3} minColumnWidth={300} gap={8} align="stretch">
      {findings.map((row) => <TaskLoopFindingCard key={row.id} row={row} />)}
    </Grid>
  );
}

function taskLoopSuggestionKindLabel(kind) {
  const labels = {
    "try-existing": ["Try existing", "试用已有能力"],
    "working-pattern": ["Working pattern", "有效模式"],
    "loop-candidate": ["Loop candidate", "循环候选"],
    horizon: ["Horizon", "中长期"],
  }[kind] ?? ["Suggestion", "建议"];
  return taskLoopCopy(labels[0], labels[1]);
}

function TaskLoopSuggestionDialog({ row }) {
  const prerequisites = list(row.prerequisites).map(textValue).filter(Boolean);
  const blockedBy = list(row.blockedBy).map(textValue).filter(Boolean);
  return (
    <Dialog
      trigger={<Button variant="ghost">{taskLoopCopy("Review suggestion", "查看建议")}</Button>}
      title={row.title ?? row.id}
      closeLabel={taskLoopCopy("Close", "关闭")}
      maxWidth={760}
    >
      <Stack gap={16}>
        <Row gap={6} align="center" wrap>
          <Tag size="sm" tone="info">{taskLoopSuggestionKindLabel(row.kind)}</Tag>
          <Tag size="sm" tone={confidenceTone(row.confidence)}>{confidenceLabel(row.confidence)}</Tag>
        </Row>
        <Stack gap={6} style={taskLoopReaderCopyStyle}>
          <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Why this is worth trying", "为什么值得尝试")}</Text>
          <Text size="sm" tone="secondary" style={{ lineHeight: 1.6 }}>{row.reason}</Text>
        </Stack>
        <Divider style={{ margin: "2px 0" }} />
        <Grid columns={2} minColumnWidth={240} gap={12}>
          <Stack gap={5}>
            <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Owner", "负责人")}</Text>
            <Text size="sm" tone="secondary">{row.owner}</Text>
          </Stack>
          <Stack gap={5}>
            <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Validation", "验证")}</Text>
            <Text size="sm" tone="secondary">{row.validation}</Text>
          </Stack>
        </Grid>
        <Stack gap={5} style={taskLoopReaderCopyStyle}>
          <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Next step", "下一步")}</Text>
          <Text size="sm" tone="secondary" style={{ lineHeight: 1.6 }}>{row.nextStep}</Text>
        </Stack>
        {prerequisites.length ? (
          <Stack gap={6}>
            <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Prerequisites", "前置条件")}</Text>
            {prerequisites.map((item, index) => (
              <Row key={`${row.id}-prerequisite-${index}`} gap={8} align="start">
                <Tag size="sm" tone="neutral">{index + 1}</Tag>
                <Text size="sm" tone="secondary">{item}</Text>
              </Row>
            ))}
          </Stack>
        ) : null}
        {blockedBy.length ? (
          <Stack gap={6}>
            <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Blocked by", "阻塞项")}</Text>
            {blockedBy.map((item, index) => (
              <Row key={`${row.id}-blocker-${index}`} gap={8} align="start">
                <Tag size="sm" tone="warning">{index + 1}</Tag>
                <Text size="sm" tone="secondary">{item}</Text>
              </Row>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Dialog>
  );
}

function TaskLoopSuggestionCard({ row }) {
  return (
    <Card size="sm">
      <CardBody style={{ padding: 14, minHeight: 260, height: "100%" }}>
        <Stack gap={9} style={{ height: "100%" }}>
          <Row gap={6} align="center" wrap>
            <Tag size="sm" tone="info">{taskLoopSuggestionKindLabel(row.kind)}</Tag>
            <Tag size="sm" tone={confidenceTone(row.confidence)}>{confidenceLabel(row.confidence)}</Tag>
          </Row>
          <Text
            weight="semibold"
            style={{ fontSize: 15, lineHeight: "21px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {row.title ?? row.id}
          </Text>
          <Text
            size="sm"
            tone="secondary"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5 }}
          >
            {row.reason}
          </Text>
          <Stack gap={3} style={{ marginTop: "auto" }}>
            <Text size="sm" weight="semibold" tone="tertiary">{taskLoopCopy("Next step", "下一步")}</Text>
            <Text size="sm" tone="secondary" truncate>{row.nextStep}</Text>
          </Stack>
          <Divider style={{ margin: "2px 0" }} />
          <Row justify="space-between" align="center" wrap gap={8}>
            <Text size="sm" tone="tertiary" truncate>{row.owner}</Text>
            <TaskLoopSuggestionDialog row={row} />
          </Row>
        </Stack>
      </CardBody>
    </Card>
  );
}

function TaskLoopSuggestionCards({ suggestions }) {
  return (
    <Grid columns={3} minColumnWidth={280} gap={8} align="stretch">
      {suggestions.map((row) => <TaskLoopSuggestionCard key={row.id} row={row} />)}
    </Grid>
  );
}

function taskLoopDeliveryOutcomeLabel(boundary) {
  if (!boundary || !Object.hasOwn(boundary, "deliveryEvidenceLevels")) {
    return taskLoopCopy("Not supplied", "未提供");
  }
  const levels = list(boundary?.deliveryEvidenceLevels).map(textValue).filter(Boolean);
  if (!levels.length || levels.every((value) => ["none", "unobserved", "not-observed"].includes(value.toLowerCase()))) {
    return taskLoopCopy("Not observed", "未观察到");
  }
  return levels.join(", ");
}

function taskLoopCoverageFraction(value, analyzedField, eligibleField) {
  if (!value || !Object.hasOwn(value, analyzedField) || !Object.hasOwn(value, eligibleField)) return null;
  const analyzed = Number(value[analyzedField]);
  const eligible = Number(value[eligibleField]);
  return Number.isInteger(analyzed) && analyzed >= 0 && Number.isInteger(eligible) && eligible >= 0
    ? `${formatUsageNumber(analyzed)}/${formatUsageNumber(eligible)}`
    : null;
}

function taskLoopMeasurementBoundaryText(selection, usageSelection) {
  const sample = taskLoopCoverageFraction(selection, "analyzedCount", "eligibleCount");
  const activity = taskLoopCoverageFraction(usageSelection, "analyzedSessionCount", "eligibleSessionCount");
  if (sample && activity) {
    return taskLoopCopy(
      `Work-stage conclusions use ${sample} stratified sample sessions; activity accounting covers ${activity}. Use this evidence to locate review leads, not to prove efficiency or model quality.`,
      `工作环节结论来自 ${sample} 个分层抽样会话；活动统计覆盖 ${activity}。当前证据可用于定位线索，不足以证明效率或模型质量。`,
    );
  }
  if (sample) {
    return taskLoopCopy(
      `Work-stage conclusions use ${sample} stratified sample sessions. Activity and model accounting were not supplied, so no usage conclusion is available.`,
      `工作环节结论来自 ${sample} 个分层抽样会话。未提供活动与模型统计，因此无法形成用量结论。`,
    );
  }
  if (activity) {
    return taskLoopCopy(
      `Activity accounting covers ${activity}. Sampling provenance was not supplied, so usage is shown without a work-stage sampling conclusion.`,
      `活动统计覆盖 ${activity}。未提供抽样来源，因此这里只展示用量，不形成工作环节抽样结论。`,
    );
  }
  return taskLoopCopy(
    "Session measurement context was not supplied, so no sampling, usage, or model conclusion is available.",
    "未提供会话计量上下文，因此无法形成抽样、用量或模型结论。",
  );
}

function taskLoopMeasurementModelLabel(usage, modelUsage) {
  if (!usage) return taskLoopCopy("Usage unavailable", "用量不可用");
  return `${modelUsage.length} ${taskLoopCopy("models", "个模型")}`;
}

function taskLoopSelectionDetailText(selection) {
  const coverage = taskLoopCoverageFraction(selection, "analyzedCount", "eligibleCount");
  if (!coverage) return taskLoopCopy("Not supplied", "未提供");
  return taskLoopCopy(
    `${textValue(selection.strategy) || "unknown"}; ${coverage} eligible sessions analyzed.`,
    `${textValue(selection.strategy) || "未知"}；已分析 ${coverage} 个符合条件的会话。`,
  );
}

function taskLoopTaskEvidenceText(coverage) {
  const fields = ["episodeCount", "editedEpisodeCount", "closedEpisodeCount", "recoveredEpisodeCount"];
  if (!fields.every((field) => Object.hasOwn(coverage, field))) return taskLoopCopy("Not supplied", "未提供");
  const [episodes, edited, closed, recovered] = fields.map((field) => Number(coverage[field]));
  if (![episodes, edited, closed, recovered].every((value) => Number.isInteger(value) && value >= 0)) {
    return taskLoopCopy("Not supplied", "未提供");
  }
  return taskLoopCopy(
    `${episodes} episodes; ${edited} with changes; ${closed} closed; ${recovered} repaired and passed.`,
    `${episodes} 个任务片段；${edited} 个包含改动；${closed} 个已闭环；${recovered} 个修复并通过。`,
  );
}

function taskLoopLearningDetailText(learning) {
  if (!Object.hasOwn(learning, "state") && !Array.isArray(learning.interventions)) {
    return taskLoopCopy("Not supplied", "未提供");
  }
  return taskLoopCopy(
    `${learningStateLabel(learning.state)}; ${list(learning.interventions).length} declared intervention(s).`,
    `${learningStateLabel(learning.state)}；${list(learning.interventions).length} 项已声明的改进。`,
  );
}

function TaskLoopEvidenceFact({ label, value, tone = "neutral" }) {
  return (
    <Card size="sm">
      <CardBody style={{ padding: "10px 12px" }}>
        <Stack gap={6}>
          <Text size="sm" tone="tertiary">{label}</Text>
          <Row>
            <Tag size="sm" tone={tone}>{value}</Tag>
          </Row>
        </Stack>
      </CardBody>
    </Card>
  );
}

function TaskLoopEvidenceDetails({ usage, boundary, manifest, selection, learning, coverage }) {
  const hasDetailedBoundary = Object.keys(boundary).length > 0
    || Object.keys(coverage).length > 0
    || Object.keys(learning).length > 0;
  return (
    <Stack gap={14}>
      {hasDetailedBoundary ? (
        <Stack gap={7} style={taskLoopReaderCopyStyle}>
          <Text weight="semibold">{taskLoopCopy("Sampling and provenance", "抽样与来源")}</Text>
          <Text size="sm" tone="secondary">{taskLoopCopy("Session selection", "会话抽样")}: {taskLoopSelectionDetailText(selection)}</Text>
          <Text size="sm" tone="secondary">{taskLoopCopy("Task evidence", "任务证据")}: {taskLoopTaskEvidenceText(coverage)}</Text>
          <Text size="sm" tone="secondary">{taskLoopCopy("Delivery outcomes", "交付结果")}: {taskLoopDeliveryOutcomeLabel(boundary)}.</Text>
          <Text size="sm" tone="secondary">{taskLoopCopy("Learning comparison", "学习循环比较")}: {taskLoopLearningDetailText(learning)}</Text>
          {textValue(learning.summary) ? <Text size="sm" tone="secondary">{learning.summary}</Text> : null}
        </Stack>
      ) : (
        <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
          {taskLoopCopy(
            "This run did not supply task-episode or delivery-outcome evidence, so the report only shows repository signals it could verify.",
            "本次运行没有提供任务片段或交付结果证据，因此报告只展示能够验证的仓库信号。",
          )}
        </Text>
      )}
      <Grid columns={3} minColumnWidth={260} gap={12} align="start">
        <UsageStatRow label={taskLoopCopy("Evidence mode", "证据模式")} value={report.summary?.evidenceMode ?? "—"} />
        <UsageStatRow label={taskLoopCopy("Platform", "平台")} value={manifest.platform ?? "—"} />
        <UsageStatRow label={taskLoopCopy("Adapter version", "适配器版本")} value={manifest.adapterVersion ?? "—"} />
        <UsageStatRow label={taskLoopCopy("Manifest schema", "清单版本")} value={manifest.schemaVersion ?? "—"} />
        <UsageStatRow label={taskLoopCopy("Source fingerprint", "来源指纹")} value={manifest.sourceFingerprint ?? "—"} />
        <UsageStatRow label={taskLoopCopy("Source gaps", "来源缺口")} value={Array.isArray(boundary.sourceGaps) ? boundary.sourceGaps.length : "—"} />
      </Grid>
      {usage ? (
        <>
          <Divider style={{ margin: "2px 0" }} />
          <TaskLoopUsageMethodology usage={usage} />
        </>
      ) : null}
    </Stack>
  );
}

function TaskLoopEvidenceBoundary({ usage }) {
  const boundary = report.summary?.evidenceBoundary ?? {};
  const manifest = boundary.manifest ?? {};
  const selection = manifest.selection ?? {};
  const learning = report.summary?.learningCapture ?? {};
  const coverage = taskLoopCoverage();
  const modelUsage = list(usage?.modelUsage);
  const longSessionSamples = list(usage?.longSessions?.samples);
  const sessionInsights = list(report.summary?.semanticFacets?.entries);
  const activitySelection = usage?.selection ?? {};
  const samplingConfidence = textValue(selection.confidence)
    || taskLoopCopy("Not supplied", "未提供");
  const sourceGapValue = Array.isArray(boundary.sourceGaps) ? boundary.sourceGaps.length : "—";

  return (
    <Stack gap={12}>
      <H2 style={{ fontSize: 20, lineHeight: 1.35 }}>{taskLoopCopy("Evidence and methodology", "证据与方法")}</H2>
      <Callout
        tone="warning"
        style={{
          background: "rgba(245, 158, 11, 0.06)",
          border: "1px solid rgba(245, 158, 11, 0.28)",
          borderRadius: 8,
          padding: "10px 12px",
        }}
      >
        <Text size="sm" style={{ lineHeight: 1.5 }}>
          {taskLoopMeasurementBoundaryText(selection, activitySelection)}
        </Text>
      </Callout>
      <Grid columns={3} minColumnWidth={180} gap={8} align="stretch">
        <TaskLoopEvidenceFact label={taskLoopCopy("Sampling confidence", "抽样可信度")} value={samplingConfidence} tone={confidenceTone(selection.confidence)} />
        <TaskLoopEvidenceFact label={taskLoopCopy("Source gaps", "来源缺口")} value={sourceGapValue} tone={Array.isArray(boundary.sourceGaps) && boundary.sourceGaps.length ? "warning" : "neutral"} />
        <TaskLoopEvidenceFact label={taskLoopCopy("Delivery outcome", "交付结果")} value={taskLoopDeliveryOutcomeLabel(boundary)} />
      </Grid>
      {usage?.reviewLead && longSessionSamples.length ? (
        <>
          <Divider style={{ margin: "2px 0" }} />
          <TaskLoopLongSessionReview usage={usage} />
        </>
      ) : null}
      {sessionInsights.length ? (
        <>
          <Divider style={{ margin: "2px 0" }} />
          <TaskLoopSessionInsights />
        </>
      ) : null}
      <Divider style={{ margin: "2px 0" }} />
      <CollapsibleSection
        size="sm"
        defaultOpen={false}
        title={(
          <Row gap={12} align="center" wrap>
            <Text weight="semibold">{taskLoopCopy("View measurement and model details", "查看计量与模型明细")}</Text>
            <Text size="sm" tone="secondary">
              {taskLoopCopy("Response accounting, model detail, and sampling method", "响应计量、模型明细与抽样方法")}
            </Text>
          </Row>
        )}
        trailing={<Text size="sm" tone="secondary">{taskLoopMeasurementModelLabel(usage, modelUsage)}</Text>}
        bodyStyle={{ padding: "12px 0 2px 16px" }}
        headerStyle={{ minHeight: 44 }}
      >
        <TaskLoopEvidenceDetails
          usage={usage}
          boundary={boundary}
          manifest={manifest}
          selection={selection}
          learning={learning}
          coverage={coverage}
        />
      </CollapsibleSection>
    </Stack>
  );
}

function TaskLoopReport() {
  const dimensions = list(report.summary?.dimensions);
  const findings = list(report.findings).sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const suggestions = list(report.summary?.suggestions);
  const activity = taskLoopUsageActivity();
  const usage = taskLoopUsageEfficiency();
  const highFindings = findings.filter((row) => row.severity === "Critical" || row.severity === "High");
  const mediumFindings = findings.filter((row) => row.severity === "Medium");
  return (
    <Stack gap={24} style={taskLoopPageStyle}>
      <TaskLoopReportHeader findings={findings} />

      <TaskLoopFluency dimensions={dimensions} />

      {activity || usage ? (
        <Stack gap={8}>
          <H2>{taskLoopCopy("Project usage", "项目用量")}</H2>
          <TaskLoopProjectUsage activity={activity} usage={usage} />
        </Stack>
      ) : null}

      <Stack gap={8}>
        <Row justify="space-between" align="center" wrap gap={8}>
          <H2>{taskLoopCopy("Prioritized improvements", "优先优化项")}</H2>
          <Text size="sm" tone="secondary">
            {taskLoopCopy(
              `${findings.length} total · ${highFindings.length} high · ${mediumFindings.length} medium`,
              `共 ${findings.length} 项 · ${highFindings.length} 个高优先级 · ${mediumFindings.length} 个中优先级`,
            )}
          </Text>
        </Row>
        <TaskLoopFindingCards findings={findings} />
        {suggestions.length ? (
          <>
            <Divider style={{ margin: "8px 0 2px" }} />
            <Row justify="space-between" align="center" wrap gap={8}>
              <Stack gap={3}>
                <Text weight="semibold">{taskLoopCopy("Suggestions", "建议")}</Text>
                <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
                  {taskLoopCopy(
                    "Evidence-bound capabilities and patterns worth trying next. Suggestions are advisory and do not include an AI Fix action.",
                    "基于证据、值得下一步尝试的能力与模式。建议仅供参考，不包含 AI 修复动作。",
                  )}
                </Text>
              </Stack>
              <Tag size="sm" tone="neutral">{suggestions.length} {taskLoopCopy("suggestions", "条建议")}</Tag>
            </Row>
            <TaskLoopSuggestionCards suggestions={suggestions} />
          </>
        ) : null}
      </Stack>

      <Stack gap={8}>
        <H2>{taskLoopCopy("Agent Customize", "Agent 自定义")}</H2>
        <Text size="sm" tone="secondary" style={taskLoopReaderCopyStyle}>
          {taskLoopCopy(
            "Discovered sources, not a quality or maturity score.",
            "这里只展示已发现来源，不代表质量或成熟度评分。",
          )}
        </Text>
        <TaskLoopPracticeTable rows={practiceRows()} />
      </Stack>

      <TaskLoopUsageTrends activity={activity} />

      <TaskLoopEvidenceBoundary usage={usage} />
    </Stack>
  );
}

export default function QoderHarnessReport() {
  return <TaskLoopReport />;
}
