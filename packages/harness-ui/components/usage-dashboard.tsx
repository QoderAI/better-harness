"use client";

import {
  Activity,
  Blocks,
  Bot,
  Clock3,
  Code2,
  FileCheck2,
  Gauge,
  MessagesSquare,
  PlugZap,
  Sparkles,
  UploadCloud,
  Webhook,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type { DashboardInput } from "@/lib/contracts";
import { buildDashboardModel } from "@/lib/dashboard-model";

type ActivityMetric = "activeMinutes" | "sessionStarts";
type ModelMetric = "responseCount" | "usageFieldObservedCount";
type RangeDays = 7 | 30;

const numberFormat = new Intl.NumberFormat("en-US");

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

export function UsageDashboard({ input }: { input: DashboardInput }) {
  const model = useMemo(() => buildDashboardModel(input), [input]);
  const [metric, setMetric] = useState<ActivityMetric>("activeMinutes");
  const [modelMetric, setModelMetric] = useState<ModelMetric>("responseCount");
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [skillRangeDays, setSkillRangeDays] = useState<RangeDays>(30);
  const [tokenRangeDays, setTokenRangeDays] = useState<RangeDays>(30);
  const [selectedSkillName, setSelectedSkillName] = useState(model.skills[0]?.name ?? "");
  const chartRows = model.activity.slice(-rangeDays);
  const metricLabel = metric === "activeMinutes" ? "Estimated active minutes" : "Session starts";
  const metricFormatter = metric === "activeMinutes"
    ? (value: number) => `${numberFormat.format(value)} min`
    : (value: number) => `${numberFormat.format(value)} sessions`;
  const selectedSkill = model.skills.find((skill) => skill.name === selectedSkillName) ?? model.skills[0];
  const skillRows = model.activity.slice(-skillRangeDays).map((row, index, rows) => {
    const sourceIndex = model.activity.length - rows.length + index;
    return { date: row.date, invocations: selectedSkill?.daily[sourceIndex] ?? 0 };
  });
  const selectedSkillTotal = skillRows.reduce((total, row) => total + row.invocations, 0);
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
  const hasTokenActivity = model.tokenActivity !== null && tokenRows.length > 0;
  const modelRows = model.models.slice(0, 8);
  const modelMetricLabel = modelMetric === "responseCount" ? "Responses" : "Usage observed";

  const headlineAssets = [
    { label: "Skills", value: model.assets.totals.skills, icon: <Sparkles /> },
    { label: "MCPs", value: model.assets.totals.mcps, icon: <PlugZap /> },
    { label: "Hooks", value: model.assets.totals.hooks, icon: <Webhook /> },
  ];
  const primaryAssets = headlineAssets.filter((asset) => asset.value > 0);
  const secondaryAssets = [
    ...headlineAssets.filter((asset) => asset.value === 0),
    { label: "Commands", value: model.assets.totals.commands, icon: <Code2 /> },
    { label: "Rules", value: model.assets.totals.rules, icon: <FileCheck2 /> },
    { label: "Agents", value: model.assets.totals.agents, icon: <Bot /> },
    { label: "Plugins", value: model.assets.totals.plugins, icon: <Blocks /> },
  ];

  return (
    <div className="site-shell">
      <main className="dashboard">
        <section className="card asset-overview" aria-labelledby="asset-title">
          <div className="card-header asset-header">
            <div>
              <p className="eyebrow">Inventory</p>
              <h1 id="asset-title">Harness assets</h1>
              <p className="muted">
                {model.assets.inventoryReports} host {model.assets.inventoryReports === 1 ? "inventory" : "inventories"}
                {model.assets.providers.length > 0 ? ` · ${model.assets.providers.join(", ")}` : ""}
              </p>
            </div>
            <div className="inventory-meta">
              <time dateTime={model.generatedAt}>Scanned {formatTimestamp(model.generatedAt)}</time>
              <div className="finding-summary" aria-label="Asset inventory findings">
                <span className={model.assets.findings.errors > 0 ? "danger" : "success"}>{model.assets.findings.errors} errors</span>
                <span>{model.assets.findings.warnings} lint warnings</span>
                <span>{model.assets.findings.advisories} advisories</span>
              </div>
            </div>
          </div>
          <div className="asset-primary-grid">
            {primaryAssets.map((asset) => (
              <article className="asset-primary" key={asset.label} title={`${asset.value} configured ${asset.label} instances`}>
                <div className="asset-icon" aria-hidden="true">{asset.icon}</div>
                <div>
                  <p>{asset.label}</p>
                  <strong>{numberFormat.format(asset.value)}</strong>
                </div>
              </article>
            ))}
          </div>
          <div className="asset-secondary-row">
            {secondaryAssets.map((asset) => (
              <div className="asset-secondary" key={asset.label}>
                <span aria-hidden="true">{asset.icon}</span>
                <p>{asset.label}</p>
                <strong>{numberFormat.format(asset.value)}</strong>
              </div>
            ))}
          </div>
        </section>

        {hasUsage ? <section className="stat-grid" aria-label="Observed usage summary">
          <StatCard
            icon={<Activity />}
            label="Analyzed sessions"
            value={`${model.overview.analyzedSessions}/${model.overview.eligibleSessions}`}
            note="all-eligible selection"
          />
          <StatCard
            icon={<Clock3 />}
            label="Active time"
            value={`${numberFormat.format(model.overview.activeMinutes)} min`}
            note="capped event-gap estimate"
          />
          <StatCard
            icon={<MessagesSquare />}
            label="Model responses"
            value={numberFormat.format(model.overview.modelResponses)}
            note="deduplicated responses"
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
            <p>Run session analysis for a supported host in this workspace, then reload this page.</p>
          </section>
        )}

        {hasActivity ? <section className="content-grid">
          <article className="card chart-card">
            <div className="card-header chart-header">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>Usage activity</h2>
                <p className="muted metric-caption">{metricLabel} · {model.sources.sessionProviders.join(", ")}</p>
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
                    type="natural"
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
              <p className="eyebrow">Skills</p>
              <h2 id="skill-activity-title">Skill activity</h2>
              <p className="muted metric-caption">{numberFormat.format(selectedSkillTotal)} invocations in the selected range</p>
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
                <ChartTooltip formatter={(value) => `${numberFormat.format(value)} invocations`} />
                <Bar dataKey="invocations" fill="var(--chart)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </div>
        </section> : null}

        {hasTokenActivity ? <section className="token-section" aria-labelledby="token-usage-title">
          <div className="section-header">
            <div>
              <p className="eyebrow">Usage</p>
              <h2 id="token-usage-title">Token usage</h2>
              <p className="muted metric-caption">Observed from {model.sources.tokenProviders.join(", ")} · {numberFormat.format(model.tokenActivity?.observedResponseCount ?? 0)} responses</p>
            </div>
            <label className="range-select">
              <span className="sr-only">Token date range</span>
              <select value={tokenRangeDays} onChange={(event) => setTokenRangeDays(Number(event.target.value) as RangeDays)}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
          </div>
          <div className="token-chart-grid">
            {tokenLanes.map((lane) => {
              const rangeTotal = tokenRows.reduce((total, row) => total + row[lane.key], 0);
              const gradientId = `token-${lane.key}`;
              return <article className="card token-chart-card" key={lane.key}>
                <div className="token-chart-summary">
                  <span>{lane.label}</span>
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
                <p className="eyebrow">Context</p>
                <h2>Context window</h2>
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
                <p className="eyebrow">Models</p>
                <h2>Model activity</h2>
                <p className="muted metric-caption">{modelMetricLabel}{model.models.length > modelRows.length ? ` · top ${modelRows.length} by responses` : ""}</p>
              </div>
              <div className="segmented" aria-label="Model metric">
                <button type="button" className={modelMetric === "responseCount" ? "active" : ""} onClick={() => setModelMetric("responseCount")}>Responses</button>
                <button type="button" className={modelMetric === "usageFieldObservedCount" ? "active" : ""} onClick={() => setModelMetric("usageFieldObservedCount")}>Usage observed</button>
              </div>
            </div>
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

        {model.evidencePackets.length > 0 ? <section className="card packet-card" aria-labelledby="packet-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Upload</p>
              <h2 id="packet-title">Accepted task evidence</h2>
            </div>
            <span className="upload-count"><UploadCloud size={14} /> {model.evidencePackets.length} accepted</span>
          </div>
          <div className="packet-list">
            {model.evidencePackets.map((packet) => (
              <article className="packet-row" key={packet.id}>
                <div className="packet-main">
                  <span className="packet-id">{packet.id}</span>
                  <strong>{packet.title}</strong>
                  <p>{packet.workspace} · {new Date(packet.generatedAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="packet-facts">
                  <span><b>{packet.acceptance.passed}</b>/{packet.acceptance.total} acceptance passed</span>
                  <span><b>{packet.assets.succeeded}</b>/{packet.assets.total} assets succeeded</span>
                  <span><b>{packet.observations.unobserved}</b> observations unobserved</span>
                  <span><b>{packet.redactions}</b> redactions</span>
                </div>
              </article>
            ))}
          </div>
        </section> : null}

        {model.sources.errors.length > 0 ? (
          <section className="card source-errors" aria-labelledby="source-errors-title">
            <div className="card-header">
              <div>
                <p className="eyebrow">Collection</p>
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
