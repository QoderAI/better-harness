"use client";

import {
  Activity,
  ChevronDown,
  Clock3,
  GitCommitHorizontal,
  Gauge,
  Layers,
  MessagesSquare,
  PlugZap,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  Webhook,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { DashboardInput, DashboardProject, DashboardProjectSnapshot } from "@/lib/contracts";
import { buildDashboardModel, type DashboardModel } from "@/lib/dashboard-model";

type ActivityMetric = "activeMinutes" | "sessionStarts";
type ModelMetric = "responseCount" | "usageFieldObservedCount";
type RangeDays = 7 | 30;

const numberFormat = new Intl.NumberFormat("en-US");
const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CACHE_MODE_LABELS: Record<string, string> = {
  "included-in-input": "cache read included in input",
  "separate-input-lane": "cache read in a separate lane",
  "relationship-unknown": "cache relationship unknown",
};

function cacheModeLabel(mode: string) {
  return CACHE_MODE_LABELS[mode] ?? mode;
}

const POST_EDIT_LABELS: Record<string, string> = {
  "validated-after-edit": "Observed",
  "edit-without-validation": "Not observed",
  "no-edit-observed": "No edits",
};

function StatCard({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return (
    <article className="stat-card">
      <div className="stat-icon" aria-hidden="true">{icon}</div>
      <div>
        <p className="eyebrow">{label}</p>
        <p className="stat-value">{value}</p>
        <p className="stat-note">{note}</p>
      </div>
    </article>
  );
}

function NamedCountList({ label, rows, unit }: { label: string; rows: Array<{ name: string; count: number }>; unit: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="signal-list">
      <p className="eyebrow">{label}</p>
      <ul>
        {rows.slice(0, 5).map((row) => (
          <li key={row.name}>
            <span title={row.name}>{row.name}</span>
            <b>{numberFormat.format(row.count)}<i>{unit}</i></b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskEvidencePane({ evidence }: { evidence: DashboardModel["evidenceDeliveries"] }) {
  const [selectedDigest, setSelectedDigest] = useState(evidence.items[0]?.digest ?? "");
  const selected = evidence.items.find((packet) => packet.digest === selectedDigest) ?? evidence.items[0];
  if (!selected) return null;

  return (
    <section className="task-evidence-pane" aria-labelledby="task-evidence-title">
      <div className="pane-heading">
        <div>
          <h2 id="task-evidence-title">Task evidence</h2>
          <p className="muted metric-caption">{evidence.organizations.join(", ")}</p>
        </div>
        <span className="upload-count"><UploadCloud size={14} />{evidence.total} received</span>
      </div>
      <div className={`task-evidence-layout${evidence.items.length === 1 ? " single-task" : ""}`}>
        {evidence.items.length > 1 ? <div className="task-list" role="listbox" aria-label="Received task evidence">
          {evidence.items.map((packet) => (
            <button
              type="button"
              role="option"
              aria-selected={packet.digest === selected.digest}
              className={packet.digest === selected.digest ? "selected" : ""}
              key={packet.digest}
              onClick={() => setSelectedDigest(packet.digest)}
            >
              <span className="packet-id">{packet.id}</span>
              <strong>{packet.title}</strong>
              <span>{formatTimestamp(packet.acceptedAt)}</span>
            </button>
          ))}
        </div> : null}
        <div className="task-evidence-detail">
          <div className="task-detail-heading">
            <div>
              <span className="packet-id">{selected.id}</span>
              <h3>{selected.title}</h3>
              <p className="task-meta">{selected.workspace} · received {formatTimestamp(selected.acceptedAt)}</p>
            </div>
            <span className="receipt-state">Packet {selected.receiptState}</span>
          </div>
          <ol className="evidence-spine" aria-label="Task evidence chain">
            {selected.stages.map((stage) => (
              <li key={stage.id} data-state={stage.state}>
                <span className="stage-marker" aria-hidden="true" />
                <span className="stage-label">{stage.label}</span>
                <strong>{stage.value}</strong>
              </li>
            ))}
          </ol>
          <details className="task-detail-disclosure">
            <summary>Show packet detail</summary>
            <div className="task-detail-grid">
              <div>
                <h4>Acceptance</h4>
                <ul>
                  {selected.acceptanceItems.map((item) => (
                    <li key={item.id}><span>{item.id}</span><strong data-state={item.status}>{item.status}</strong></li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Harness assets</h4>
                {selected.assetItems.length > 0 ? <ul>
                  {selected.assetItems.map((item) => (
                    <li key={`${item.kind}:${item.id}`}><span>{item.id}</span><strong data-state={item.outcome}>{item.outcome}</strong></li>
                  ))}
                </ul> : <p>Unobserved</p>}
              </div>
              <div>
                <h4>Links</h4>
                <dl>
                  <div><dt>Sessions</dt><dd>{selected.links.sessionRefs.length}</dd></div>
                  <div><dt>Commits</dt><dd>{selected.links.commitRefs.length}</dd></div>
                  <div><dt>Artifacts</dt><dd>{selected.links.artifactRefs.length}</dd></div>
                </dl>
              </div>
              <div>
                <h4>Packet</h4>
                <dl>
                  <div><dt>Workspace</dt><dd>{selected.workspace}</dd></div>
                  <div><dt>Redactions</dt><dd>{selected.redactions}</dd></div>
                  <div><dt>Digest</dt><dd className="packet-digest">{selected.digest}</dd></div>
                </dl>
              </div>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

export function dashboardProjectOptions(inputs: DashboardInput[]) {
  return inputs.map((candidate, index) => ({
    id: candidate.workspace?.id ?? `project:${index}`,
    label: candidate.workspace?.label ?? `Project ${index + 1}`,
    input: candidate,
  }));
}

export function selectDashboardProject(
  projects: ReturnType<typeof dashboardProjectOptions>,
  selectedId: string,
) {
  return projects.find((project) => project.id === selectedId) ?? projects[0];
}

function ProjectState({
  projects,
  selectedProjectId,
  status,
  onProjectChange,
  onRetry,
}: {
  projects: DashboardProject[];
  selectedProjectId: string;
  status: "loading" | "failed";
  onProjectChange: (id: string) => void;
  onRetry: () => void;
}) {
  const selected = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  return (
    <div className="site-shell">
      <main className="dashboard">
        <header className="page-header">
          <h1>{selected.label}</h1>
          {projects.length > 1 ? (
            <select
              aria-label="Project"
              className="project-select"
              value={selected.id}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}
            </select>
          ) : null}
        </header>
        <section className="card project-state" aria-live="polite">
          {status === "loading" ? (
            <>
              <h2>Collecting project evidence</h2>
              <p>Loading this project without blocking the other configured projects.</p>
            </>
          ) : (
            <>
              <h2>Project evidence unavailable</h2>
              <p>Collection failed for this project. Other configured projects remain available.</p>
              <button type="button" onClick={onRetry}>Retry project</button>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export function UsageDashboard({
  projects,
  initialSnapshot,
}: {
  projects: DashboardProject[];
  initialSnapshot: DashboardProjectSnapshot;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(initialSnapshot.project.id);
  const [snapshots, setSnapshots] = useState<Record<string, DashboardProjectSnapshot>>({
    [initialSnapshot.project.id]: initialSnapshot,
  });
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  async function loadProject(id: string, { retry = false } = {}) {
    setSelectedProjectId(id);
    if (!retry && snapshots[id]?.status === "ready") return;
    setLoadingProjectId(id);
    try {
      const response = await fetch(`/api/project?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("Project request failed");
      const snapshot = await response.json() as DashboardProjectSnapshot;
      setSnapshots((current) => ({ ...current, [id]: snapshot }));
    } catch {
      const project = projects.find((candidate) => candidate.id === id)!;
      setSnapshots((current) => ({
        ...current,
        [id]: { project, status: "failed", message: "Project collection failed." },
      }));
    } finally {
      setLoadingProjectId((current) => current === id ? null : current);
    }
  }

  const snapshot = snapshots[selectedProjectId];
  if (loadingProjectId === selectedProjectId || !snapshot) {
    return <ProjectState projects={projects} selectedProjectId={selectedProjectId} status="loading" onProjectChange={loadProject} onRetry={() => loadProject(selectedProjectId, { retry: true })} />;
  }
  if (snapshot.status === "failed") {
    return <ProjectState projects={projects} selectedProjectId={selectedProjectId} status="failed" onProjectChange={loadProject} onRetry={() => loadProject(selectedProjectId, { retry: true })} />;
  }
  return (
    <DashboardView
      key={selectedProjectId}
      input={snapshot.input}
      projects={projects}
      selectedProjectId={selectedProjectId}
      onProjectChange={loadProject}
    />
  );
}

function DashboardView({
  input,
  projects,
  selectedProjectId,
  onProjectChange,
}: {
  input: DashboardInput;
  projects: DashboardProject[];
  selectedProjectId: string;
  onProjectChange: (id: string) => void;
}) {
  const model = useMemo(() => buildDashboardModel(input), [input]);
  const [metric, setMetric] = useState<ActivityMetric>("activeMinutes");
  const [modelMetric, setModelMetric] = useState<ModelMetric>("responseCount");
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [skillRangeDays, setSkillRangeDays] = useState<RangeDays>(30);
  const [mcpRangeDays, setMcpRangeDays] = useState<RangeDays>(30);
  const [tokenRangeDays, setTokenRangeDays] = useState<RangeDays>(30);
  const [selectedSkillName, setSelectedSkillName] = useState(model.skills[0]?.name ?? "");
  const [selectedMcpName, setSelectedMcpName] = useState(model.mcps[0]?.name ?? "");
  const chartRows = model.activity.slice(-rangeDays);
  const metricLabel = metric === "activeMinutes" ? "Estimated active minutes" : "Session starts";
  const metricFormatter = metric === "activeMinutes"
    ? (value: number) => `${numberFormat.format(value)} min`
    : (value: number) => `${numberFormat.format(value)} sessions`;
  const selectedSkill = model.skills.find((skill) => skill.name === selectedSkillName) ?? model.skills[0];
  const skillRows = model.activity.slice(-skillRangeDays).map((row, index, rows) => {
    const sourceIndex = model.activity.length - rows.length + index;
    const total = selectedSkill?.daily[sourceIndex] ?? 0;
    const failed = selectedSkill?.dailyFailed?.[sourceIndex] ?? 0;
    return { date: row.date, succeeded: total - failed, failed };
  });
  const selectedSkillTotal = skillRows.reduce((sum, row) => sum + row.succeeded + row.failed, 0);
  const selectedSkillFailed = skillRows.reduce((sum, row) => sum + row.failed, 0);
  const selectedMcp = model.mcps.find((mcp) => mcp.name === selectedMcpName) ?? model.mcps[0];
  const mcpRows = model.activity.slice(-mcpRangeDays).map((row, index, rows) => {
    const sourceIndex = model.activity.length - rows.length + index;
    const total = selectedMcp?.daily[sourceIndex] ?? 0;
    const failed = selectedMcp?.dailyFailed?.[sourceIndex] ?? 0;
    return { date: row.date, succeeded: total - failed, failed };
  });
  const selectedMcpTotal = mcpRows.reduce((sum, row) => sum + row.succeeded + row.failed, 0);
  const selectedMcpFailed = mcpRows.reduce((sum, row) => sum + row.failed, 0);
  const tokenRows = model.tokenActivity?.rows.slice(-tokenRangeDays) ?? [];
  const tokenLanes = [
    { key: "inputTokens", label: "Input" },
    { key: "outputTokens", label: "Output" },
    { key: "cacheReadInputTokens", label: "Cache read" },
    { key: "cacheCreationInputTokens", label: "Cache creation" },
  ] as const;
  const hasUsage = model.sources.sessionProviders.length > 0;
  const hasActivity = hasUsage && model.activity.length > 0;
  const hasContext = model.contextUsage?.status === "observed";
  const hasModels = model.models.length > 0;
  const hasSkills = model.skills.length > 0;
  const hasMcps = model.mcps.length > 0;
  const hasTokenActivity = model.tokenActivity !== null && tokenRows.length > 0;
  const hasBreakdown = model.providerBreakdown.length > 1;
  const delivery = model.delivery;
  const commits = model.commitAttribution;
  const topology = model.topology;
  const modelRows = model.models.slice(0, 8);
  const modelMetricLabel = modelMetric === "responseCount" ? "Responses" : "Usage observed";
  const activeAgentSourceCount = model.providerBreakdown.length > 0
    ? model.providerBreakdown.length
    : model.sources.sessionProviders.length;
  const windowLabel = model.window?.firstDate && model.window.lastDate
    ? `${formatDate(model.window.firstDate)} – ${formatDate(model.window.lastDate)}`
    : null;

  const assetCards = [
    { key: "skills", label: "Skills", icon: <Sparkles /> },
    { key: "mcps", label: "MCPs", icon: <PlugZap /> },
    { key: "hooks", label: "Hooks", icon: <Webhook /> },
  ] as const;
  const headlineAssets = assetCards.map((asset) => ({
    ...asset,
    value: model.assets.totals[asset.key],
    instances: model.assets.configuredInstances[asset.key],
  }));
  const assetFindingCount = model.assets.findings.errors + model.assets.findings.warnings;

  return (
    <div className="site-shell">
      <main className="dashboard">
        <header className="page-header">
          <h1>{model.workspaceLabel ?? "Workspace"}</h1>
          <div className="page-header-controls">
            {projects.length > 1 ? (
              <select
                aria-label="Project"
                className="project-select"
                value={selectedProjectId}
                onChange={(event) => onProjectChange(event.target.value)}
              >
                {projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}
              </select>
            ) : null}
            {windowLabel ? (
              <span
                className="page-window"
                title={`${model.window?.dayCount ?? 0} analyzed days · collected ${formatTimestamp(model.generatedAt)}`}
              >
                {windowLabel}{model.window?.truncated ? " (truncated)" : ""}
              </span>
            ) : null}
          </div>
        </header>

        {model.evidenceDeliveries.items.length > 0 ? (
          <TaskEvidencePane evidence={model.evidenceDeliveries} />
        ) : null}

        {hasUsage ? <section className="stat-grid" aria-label="Observed usage summary">
          <StatCard
            icon={<Activity />}
            label="Analyzed sessions"
            value={`${model.overview.analyzedSessions}/${model.overview.eligibleSessions}`}
            note={model.overview.selectionNote}
          />
          <StatCard
            icon={<Clock3 />}
            label="Active time"
            value={`${numberFormat.format(model.overview.activeMinutes)} min`}
            note={`capped event-gap estimate · ${model.window?.dayCount ?? model.activity.length} days`}
          />
          <StatCard
            icon={<MessagesSquare />}
            label="Model responses"
            value={numberFormat.format(model.overview.modelResponses)}
            note={`${percentFormat.format(model.modelCoverage.attributionRate)} attributed to a model`}
          />
          <StatCard
            icon={<Wrench />}
            label="Skill invocations"
            value={numberFormat.format(model.overview.skillInvocations)}
            note="invocations and loads"
          />
        </section> : (
          <section className="card empty-state">
            <h2>No local session data observed</h2>
            <p>Run session analysis for a supported agent source in this workspace, then reload this page.</p>
          </section>
        )}


        {model.assets.observed ? <section className="asset-section" aria-labelledby="asset-title">
          <div className="section-header asset-section-header">
            <div>
              <h2 id="asset-title">Harness footprint</h2>
            </div>
            <p className="muted metric-caption">
              {model.assets.distinctComplete ? "Distinct assets" : "Configured instances"}
              {model.assets.declaredRevisions.length > 0
                ? ` · ${model.assets.declaredRevisions.length} with a declared revision`
                : ""}
              {assetFindingCount > 0
                ? ` · ${model.assets.findings.errors} errors · ${model.assets.findings.warnings} warnings`
                : ""}
            </p>
          </div>
          <div className="asset-primary-grid">
            {headlineAssets.map((asset) => (
              <article className="card asset-primary" key={asset.label}>
                <div className="asset-icon" aria-hidden="true">{asset.icon}</div>
                <div>
                  <p>{asset.label}</p>
                  <strong>{numberFormat.format(asset.value)}</strong>
                  {asset.instances > 0 ? (
                    <span className="asset-sub">{numberFormat.format(asset.instances)} configured instances</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section> : <section className="card empty-state asset-empty-state">
          <h2>No local asset inventory observed</h2>
          <p>Run agent asset analysis for a supported agent source in this workspace, then reload this page.</p>
        </section>}

        {hasActivity ? <section className="content-grid">
          <article className="card chart-card">
            <div className="card-header chart-header">
              <div>
                <h2>Usage activity</h2>
                <p className="muted metric-caption">
                  {metricLabel} · {activeAgentSourceCount} Agent {activeAgentSourceCount === 1 ? "source" : "sources"}
                </p>
              </div>
              <div className="chart-controls">
                <div className="segmented" aria-label="Activity metric">
                  <button type="button" className={metric === "activeMinutes" ? "active" : ""} onClick={() => setMetric("activeMinutes")}>Minutes</button>
                  <button type="button" className={metric === "sessionStarts" ? "active" : ""} onClick={() => setMetric("sessionStarts")}>Sessions</button>
                </div>
                <label className="range-select">
                  <span className="sr-only">Date range</span>
                  <select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value) as RangeDays)}>
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="chart-body">
              <ChartContainer>
                <AreaChart data={chartRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                  <defs>
                    <linearGradient id="usage-area-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart)" stopOpacity={0.34} />
                      <stop offset="95%" stopColor="var(--chart)" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={12} minTickGap={28} tickFormatter={formatDate} />
                  <YAxis tickLine={false} axisLine={false} width={38} tickFormatter={compactNumber} />
                  <ChartTooltip formatter={metricFormatter} />
                  <Area
                    type="monotone"
                    dataKey={metric}
                    stroke="var(--chart)"
                    fill="url(#usage-area-fill)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </article>

        </section> : null}

        {hasSkills ? <section className="card skill-chart-card" aria-labelledby="skill-activity-title">
          <div className="card-header chart-header">
            <div>
              <h2 id="skill-activity-title">Skill activity</h2>
              <p className="muted metric-caption">
                {numberFormat.format(selectedSkillTotal)} invocations{selectedSkillFailed > 0 ? ` · ${numberFormat.format(selectedSkillFailed)} failed` : ""} in the selected range
              </p>
            </div>
            <div className="chart-controls">
              <label className="range-select skill-select">
                <span className="sr-only">Skill</span>
                <select value={selectedSkill?.name ?? ""} onChange={(event) => setSelectedSkillName(event.target.value)}>
                  {model.skills.map((skill) => <option value={skill.name} key={skill.name}>{skill.name}</option>)}
                </select>
              </label>
              <label className="range-select">
                <span className="sr-only">Skill date range</span>
                <select value={skillRangeDays} onChange={(event) => setSkillRangeDays(Number(event.target.value) as RangeDays)}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </label>
            </div>
          </div>
          <div className="chart-body">
            <ChartContainer>
              <BarChart data={skillRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={12} minTickGap={28} tickFormatter={formatDate} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} tickFormatter={compactNumber} />
                <ChartTooltip formatter={(value: number) => numberFormat.format(value)} />
                <Bar
                  dataKey="succeeded"
                  stackId="outcome"
                  fill="var(--chart)"
                  radius={selectedSkillFailed > 0 ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                {selectedSkillFailed > 0 && (
                  <Bar
                    dataKey="failed"
                    stackId="outcome"
                    fill="var(--destructive)"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                )}
              </BarChart>
            </ChartContainer>
          </div>
        </section> : null}

        {hasMcps ? <section className="card mcp-chart-card" aria-labelledby="mcp-activity-title">
          <div className="card-header chart-header">
            <div>
              <h2 id="mcp-activity-title">MCP activity</h2>
              <p className="muted metric-caption">
                {numberFormat.format(selectedMcpTotal)} tool calls{selectedMcpFailed > 0 ? ` · ${numberFormat.format(selectedMcpFailed)} failed` : ""} in the selected range
              </p>
            </div>
            <div className="chart-controls">
              <label className="range-select skill-select">
                <span className="sr-only">MCP server</span>
                <select value={selectedMcp?.name ?? ""} onChange={(event) => setSelectedMcpName(event.target.value)}>
                  {model.mcps.map((mcp) => <option value={mcp.name} key={mcp.name}>{mcp.name}</option>)}
                </select>
              </label>
              <label className="range-select">
                <span className="sr-only">MCP date range</span>
                <select value={mcpRangeDays} onChange={(event) => setMcpRangeDays(Number(event.target.value) as RangeDays)}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </label>
            </div>
          </div>
          <div className="chart-body">
            <ChartContainer>
              <BarChart data={mcpRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={12} minTickGap={28} tickFormatter={formatDate} />
                <YAxis allowDecimals={false} domain={[0, "auto"]} tickLine={false} axisLine={false} width={38} tickFormatter={compactNumber} />
                <ChartTooltip formatter={(value: number) => numberFormat.format(value)} />
                <Bar
                  dataKey="succeeded"
                  stackId="outcome"
                  fill="var(--chart)"
                  radius={selectedMcpFailed > 0 ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                {selectedMcpFailed > 0 && (
                  <Bar
                    dataKey="failed"
                    stackId="outcome"
                    fill="var(--destructive)"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                )}
              </BarChart>
            </ChartContainer>
          </div>
        </section> : null}

        {hasTokenActivity ? <section className="token-section" aria-labelledby="token-usage-title">
          <div className="section-header">
            <div>
              <h2 id="token-usage-title">Token usage</h2>
              <p className="muted metric-caption">
                {model.tokenUsage.accountingMode} accounting · observed from {model.sources.tokenProviders.join(", ")} · {numberFormat.format(model.tokenActivity?.observedResponseCount ?? 0)} responses
              </p>
            </div>
            <label className="range-select">
              <span className="sr-only">Token date range</span>
              <select value={tokenRangeDays} onChange={(event) => setTokenRangeDays(Number(event.target.value) as RangeDays)}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
          </div>
          {model.tokenUsage.cacheAccountingModes.length > 0 ? (
            <p className={model.tokenUsage.cacheLanesComparable ? "lane-note" : "lane-note warn"}>
              {model.tokenUsage.cacheLanesComparable
                ? `All observed agent sources report ${cacheModeLabel(model.tokenUsage.cacheAccountingModes[0])}.`
                : `Agent sources disagree on cache accounting (${model.tokenUsage.cacheAccountingModes.map(cacheModeLabel).join("; ")}), so the Input and Cache read lanes overlap by an unknown amount and are not comparable across sources.`}
            </p>
          ) : null}
          <div className="token-chart-grid">
            {tokenLanes.map((lane) => {
              const rangeTotal = tokenRows.reduce((total, row) => total + row[lane.key], 0);
              const gradientId = `token-${lane.key}`;
              const overlaps = model.tokenUsage.cacheLanesOverlap
                && (lane.key === "inputTokens" || lane.key === "cacheReadInputTokens");
              return <article className="card token-chart-card" key={lane.key}>
                <div className="token-chart-summary">
                  <span>{lane.label}{overlaps ? " (overlapping)" : ""}</span>
                  <strong>{compactNumber(rangeTotal)}</strong>
                </div>
                <div className="token-chart-body">
                  <ChartContainer>
                    <AreaChart data={tokenRows} margin={{ left: 0, right: 2, top: 8, bottom: 0 }} accessibilityLayer>
                      <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart)" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="var(--chart)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={34} tickFormatter={formatDate} />
                      <ChartTooltip formatter={(value) => `${numberFormat.format(value)} tokens`} />
                      <Area type="monotone" dataKey={lane.key} stroke="var(--chart)" fill={`url(#${gradientId})`} strokeWidth={1.8} isAnimationActive={false} />
                    </AreaChart>
                  </ChartContainer>
                </div>
              </article>;
            })}
          </div>
        </section> : null}

        {hasContext ? <section className="content-grid single-column" aria-label="Context totals">
          <article className="card context-card">
            <div className="card-header">
              <div>
                <h2>Context window</h2>
                {model.contextUsage?.capturedAt ? (
                  <p className="muted metric-caption">
                    Captured {formatTimestamp(model.contextUsage.capturedAt)} · {numberFormat.format(model.contextUsage.itemCount)} items
                    {model.contextUsage.truncated ? " (truncated)" : ""}
                  </p>
                ) : null}
              </div>
              <Gauge className="header-icon" aria-hidden="true" />
            </div>
            <div className="context-body">
              <div className="context-total">
                <div><strong>{compactNumber(model.contextUsage?.totalTokensUsed ?? 0)}</strong><span> / {compactNumber(model.contextUsage?.contextWindowSize ?? 0)}</span></div>
                <b>{model.contextUsage?.percentFull ?? 0}%</b>
              </div>
              <div className="context-track" aria-label={`${model.contextUsage?.percentFull ?? 0}% of context window used`}>
                <span style={{ width: `${model.contextUsage?.percentFull ?? 0}%` }} />
              </div>
              <div className="context-categories">
                {model.contextUsage?.categories.map((category) => (
                  <div key={category.id}>
                    <span><i />{category.label}</span>
                    <strong>{compactNumber(category.estimatedTokens)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section> : null}

        {hasModels ? <section className="content-grid single-column">
          <article className="card model-chart-card">
            <div className="card-header chart-header">
              <div>
                <h2>Model activity</h2>
                <p className="muted metric-caption">
                  {modelMetricLabel} · {numberFormat.format(model.modelCoverage.attributed)} of {numberFormat.format(model.modelCoverage.total)} responses carry a model
                  {model.models.length > modelRows.length ? ` · top ${modelRows.length} by responses` : ""}
                </p>
              </div>
              <div className="segmented" aria-label="Model metric">
                <button type="button" className={modelMetric === "responseCount" ? "active" : ""} onClick={() => setModelMetric("responseCount")}>Responses</button>
                <button type="button" className={modelMetric === "usageFieldObservedCount" ? "active" : ""} onClick={() => setModelMetric("usageFieldObservedCount")}>Usage observed</button>
              </div>
            </div>
            {model.modelCoverage.unattributed > 0 ? (
              <p className="lane-note warn">
                {numberFormat.format(model.modelCoverage.unattributed)} responses carry no model attribution and are absent from this chart.
              </p>
            ) : null}
            <div className="model-chart-body">
              <ChartContainer>
                <BarChart data={modelRows} layout="vertical" margin={{ left: 4, right: 28, top: 8, bottom: 8 }} accessibilityLayer>
                  <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                  <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={compactNumber} />
                  <YAxis type="category" dataKey="model" tickLine={false} axisLine={false} width={116} tickMargin={8} />
                  <ChartTooltip
                    labelFormatter={(label) => label}
                    formatter={(value) => `${numberFormat.format(value)} ${modelMetric === "responseCount" ? "responses" : "observed"}`}
                  />
                  <Bar dataKey={modelMetric} fill="var(--chart)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            </div>
          </article>
        </section> : null}

        {delivery ? <section className="card delivery-card" aria-labelledby="delivery-title">
          <div className="card-header">
            <div>
              <h2 id="delivery-title">Validation and closure</h2>
              <p className="muted metric-caption">Observed in analyzed sessions, not configured policy</p>
            </div>
            <ShieldAlert className="header-icon" aria-hidden="true" />
          </div>
          <div className="delivery-grid">
            <div className="delivery-fact">
              <p className="eyebrow">Post-edit validation</p>
              <strong data-status={delivery.validationAfterEdit.status}>
                {POST_EDIT_LABELS[delivery.validationAfterEdit.status] ?? delivery.validationAfterEdit.status}
              </strong>
              <span>
                {numberFormat.format(delivery.validationAfterEdit.editCount)} edits ·{" "}
                {numberFormat.format(delivery.validationAfterEdit.validationAfterEditCount)} later validations
              </span>
            </div>
            <div className="delivery-fact">
              <p className="eyebrow">Task episodes</p>
              <strong>{numberFormat.format(delivery.episodes.episodeCount)}</strong>
              <span>
                {numberFormat.format(delivery.episodes.closedEpisodeCount)}/{numberFormat.format(delivery.episodes.eligibleEpisodeCount)} eligible closed ·{" "}
                {percentFormat.format(delivery.episodeClosureRate)}
              </span>
            </div>
            <div className="delivery-fact">
              <p className="eyebrow">Execution friction</p>
              <strong>{numberFormat.format(delivery.friction.reduce((total, row) => total + row.count, 0))}</strong>
              <span>{delivery.friction.length > 0 ? delivery.friction.map((row) => row.name).join(", ") : "no friction category observed"}</span>
            </div>
          </div>
          <div className="signal-grid">
            <NamedCountList label="Validation commands" rows={delivery.validationCommands} unit=" runs" />
            <NamedCountList label="Top tools" rows={delivery.topTools} unit=" calls" />
            {delivery.observedHooks.length > 0
              ? <NamedCountList label="Observed hooks" rows={delivery.observedHooks} unit=" fires" />
              : <div className="signal-list">
                <p className="eyebrow">Observed hooks</p>
                <p className="muted signal-empty">
                  {model.assets.totals.hooks > 0
                    ? `${model.assets.totals.hooks} configured, none observed firing`
                    : "none configured, none observed"}
                </p>
              </div>}
          </div>
        </section> : null}

        {commits || topology || hasBreakdown ? (
          <section className="operational-evidence" aria-labelledby="operational-evidence-title">
            <details className="card operational-disclosure">
              <summary>
                <div>
                  <h2 id="operational-evidence-title">Repository and Agent sources</h2>
                </div>
                <span className="disclosure-action">
                  <span className="detail-show">Show detail</span>
                  <span className="detail-hide">Hide detail</span>
                  <ChevronDown aria-hidden="true" />
                </span>
              </summary>
              <div className="operational-content">
                {commits || topology ? <section className="card repo-card" aria-labelledby="repo-title">
                  <div className="card-header">
                    <div>
                      <h2 id="repo-title">Delivered change</h2>
                      {commits ? <p className="muted metric-caption">
                        Last {numberFormat.format(commits.commitCount)} commits correlated with {numberFormat.format(commits.correlatedSessionCount)} sessions · {commits.graceMinutes} min grace
                        {Array.isArray((commits as any).attributedCommitRefs) && (commits as any).attributedCommitRefs.length > 0
                          ? ` · ${numberFormat.format((commits as any).attributedCommitRefs.length)} commit-session references`
                          : ""}
                      </p> : null}
                    </div>
                    <GitCommitHorizontal className="header-icon" aria-hidden="true" />
                  </div>
                  <div className="delivery-grid">
                    {commits ? <>
                      <div className="delivery-fact">
                        <p className="eyebrow">Session-attributed commits</p>
                        <strong>{numberFormat.format(commits.attributedCommits)}<i>/{numberFormat.format(commits.commitCount)}</i></strong>
                        <span>{percentFormat.format(commits.attributionRate)} · high {commits.byConfidence.high} · medium {commits.byConfidence.medium}</span>
                      </div>
                      <div className="delivery-fact">
                        <p className="eyebrow">Attributed lines added</p>
                        <strong>{compactNumber(commits.attributedLinesAdded)}<i>/{compactNumber(commits.linesAdded)}</i></strong>
                        <span>{percentFormat.format(commits.lineAttributionRate)} of added lines</span>
                      </div>
                    </> : null}
                    {topology ? <div className="delivery-fact">
                      <p className="eyebrow">Workspace members</p>
                      <strong>{numberFormat.format(topology.memberCount)}</strong>
                      <span>
                        {numberFormat.format(topology.trackedFiles)} tracked files · {topology.instructionScopes.effective} effective instruction scopes
                      </span>
                    </div> : null}
                  </div>
                  {commits && commits.byPlatform.length > 0 ? (
                    <div className="signal-grid">
                      <NamedCountList
                        label="Commits by Agent source"
                        rows={commits.byPlatform.map((row) => ({ name: row.platform, count: row.commitCount }))}
                        unit=" commits"
                      />
                      {topology && topology.members.length > 0 ? (
                        <div className="signal-list">
                          <p className="eyebrow">Members</p>
                          <ul>
                            {topology.members.slice(0, 5).map((member) => (
                              <li key={member.route}><span title={member.route}>{member.route}</span><b>{member.kind}</b></li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section> : null}

                {hasBreakdown ? <section className="card breakdown-card" aria-labelledby="breakdown-title">
                  <div className="card-header">
                    <div>
                      <h2 id="breakdown-title">Agent source activity</h2>
                      <p className="muted metric-caption">
                        Each row is that Agent source&apos;s own summary, not a share of the total
                        {model.providersWithoutSessions.length > 0
                          ? ` · scanned with no sessions: ${model.providersWithoutSessions.join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <Layers className="header-icon" aria-hidden="true" />
                  </div>
                  <div className="table-scroll">
                    <table className="breakdown-table">
                      <thead>
                        <tr>
                          <th scope="col">Agent source</th>
                          <th scope="col">Sessions</th>
                          <th scope="col">Active min</th>
                          <th scope="col">Responses</th>
                          <th scope="col">Model attributed</th>
                          <th scope="col">Edits</th>
                          <th scope="col">Episodes</th>
                          <th scope="col">Cache accounting</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.providerBreakdown.map((row) => (
                          <tr key={row.provider}>
                            <th scope="row">{row.provider}</th>
                            <td>{numberFormat.format(row.analyzedSessions)}</td>
                            <td>{numberFormat.format(row.activeMinutes)}</td>
                            <td>{numberFormat.format(row.responseCount)}</td>
                            <td>{numberFormat.format(row.modelAttributedResponseCount)}</td>
                            <td>{numberFormat.format(row.editCount)}</td>
                            <td>{numberFormat.format(row.episodeCount)}</td>
                            <td className="mode-cell">{row.cacheAccountingModes.map(cacheModeLabel).join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section> : null}
              </div>
            </details>
          </section>
        ) : null}

        {model.sources.errors.length > 0 ? (
          <section className="card source-errors" aria-labelledby="source-errors-title">
            <div className="card-header">
              <div>
                <h2 id="source-errors-title">Unavailable sources</h2>
              </div>
            </div>
            <ul>{model.sources.errors.map((error) => <li key={error.source}><strong>{error.source}</strong><span>{error.message}</span></li>)}</ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
