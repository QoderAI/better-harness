import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import type {
  CustomizationAnalysisResponseV1,
  CustomizationDefinitionV1,
  CustomizationHostId,
  PluginInstallationV1,
  PluginPackageV1,
} from "@qoder-ai/harness/customization";
import { studioApiError } from "./studio-api.js";

export interface CustomizationViewProps {
  analyzed: boolean;
  onAnalyzed: (definitionCount: number) => void;
}

export function CustomizationView(props: CustomizationViewProps): React.JSX.Element {
  const [analysis, setAnalysis] = useState<CustomizationAnalysisResponseV1>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(props.analyzed);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (!props.analyzed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("api/customizations");
        if (!response.ok) throw new Error(await studioApiError(response));
        const value = await response.json() as CustomizationAnalysisResponseV1;
        if (!cancelled) setAnalysis(value);
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : "Customization catalog is unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [props.analyzed]);

  async function analyze(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      const response = await fetch("api/customizations/analyze", { method: "POST" });
      if (!response.ok) throw new Error(await studioApiError(response));
      const value = await response.json() as CustomizationAnalysisResponseV1;
      setAnalysis(value);
      props.onAnalyzed(value.summary.definitionCount);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Customization analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  const hostsByDefinition = useMemo(() => {
    const result = new Map<string, CustomizationHostId[]>();
    for (const item of [...(analysis?.catalog.exposures ?? []), ...(analysis?.catalog.registrations ?? [])]) {
      const hosts = result.get(item.definitionId) ?? [];
      if (!hosts.includes(item.hostId)) hosts.push(item.hostId);
      result.set(item.definitionId, hosts);
    }
    for (const hosts of result.values()) hosts.sort((left, right) => hostRank(left) - hostRank(right) || left.localeCompare(right));
    return result;
  }, [analysis]);

  const action = <button className={analysis === undefined ? "primary" : undefined} type="button" disabled={busy || loading} onClick={() => void analyze()}>
    {analysis === undefined ? <MagnifyingGlass aria-hidden="true" size={15} /> : <ArrowClockwise aria-hidden="true" size={15} />}
    {busy ? "Analyzing…" : analysis === undefined ? "Analyze customizations" : "Analyze again"}
  </button>;

  return <section className="customization-workbench" aria-label="Local customization analysis">
    <header className="customization-toolbar">
      <div><strong>Local customization catalog</strong><span>Definitions, installations, Host exposures, and MCP registrations</span></div>
      {action}
    </header>
    {busy && <p className="customization-progress" role="status" aria-live="polite">Collecting Codex, Claude, and Qoder independently…</p>}
    {failure !== undefined && <p className="customization-failure" role="alert">{failure}</p>}
    {loading
      ? <p className="customization-progress" role="status">Loading the current Project catalog…</p>
      : analysis === undefined
        ? <CustomizationEmpty />
        : <CustomizationResults analysis={analysis} hostsByDefinition={hostsByDefinition} />}
  </section>;
}

function CustomizationEmpty(): React.JSX.Element {
  return <div className="customization-empty">
    <section><h2>Analysis starts only when requested</h2><p>Studio has not read local customization metadata for this Project. Analyze collects recognized definitions from Codex, Claude, and Qoder while keeping native paths and private values on the server.</p></section>
    <dl>
      <div><dt>Collected</dt><dd>Plugin manifests, Skills, instructions, Prompt Commands, Agent definitions, Hooks, and MCP registrations</dd></div>
      <div><dt>Not collected</dt><dd>Memory bodies, environment values, authorization headers, raw Hook commands, and MCP call results</dd></div>
      <div><dt>Runtime boundary</dt><dd>Configured does not mean connected; cached MCP descriptors remain runtime observations with unknown freshness</dd></div>
    </dl>
  </div>;
}

function CustomizationResults(props: {
  analysis: CustomizationAnalysisResponseV1;
  hostsByDefinition: Map<string, CustomizationHostId[]>;
}): React.JSX.Element {
  const { catalog, summary } = props.analysis;
  const [detailView, setDetailView] = useState<"definitions" | "installations">("definitions");
  const packagesById = useMemo(
    () => new Map(catalog.packages.map((packageValue) => [packageValue.id, packageValue])),
    [catalog.packages],
  );
  return <div className="customization-results">
    <dl className="customization-summary" aria-label="Customization summary">
      <SummaryFact label="Definitions" value={summary.definitionCount} />
      <SummaryFact label="Packages" value={summary.packageCount} />
      <SummaryFact label="Installations" value={summary.installationCount} />
      <SummaryFact label="MCP registrations" value={summary.registrationCount} />
    </dl>
    <div className="customization-panes">
      <aside className="customization-hosts">
        <header><h2>Hosts</h2><span>{summary.hosts.length}</span></header>
        <ul>{summary.hosts.map((host) => <li key={host.id}>
          <span className={`availability-dot availability-${host.status === "ok" ? "ready" : host.status === "partial" ? "partial" : "foundation"}`} aria-hidden="true" />
          <div><strong>{host.label}</strong><small>{host.status === "ok" ? "Collected" : host.status}</small></div>
          <dl><div><dt>Definitions</dt><dd>{host.definitions}</dd></div><div><dt>Packages</dt><dd>{host.packages}</dd></div><div><dt>MCP</dt><dd>{host.registrations}</dd></div></dl>
        </li>)}</ul>
        <footer aria-live="polite">{catalog.runtimeObservations.map((item) => item.kind === "host-collection" && item.status === "error"
          ? <p key={item.id} role="alert">{item.message}</p>
          : null)}</footer>
      </aside>
      <section className="customization-definitions">
        <header className="customization-detail-header">
          <div className="customization-detail-tabs" data-active={detailView} role="tablist" aria-label="Customization detail view">
            <button type="button" role="tab" aria-selected={detailView === "definitions"} onClick={() => setDetailView("definitions")}>Definitions</button>
            <button type="button" role="tab" aria-selected={detailView === "installations"} onClick={() => setDetailView("installations")}>Installations</button>
          </div>
          <span>{detailView === "definitions"
            ? `${summary.exposureCount} exposures · ${summary.registrationCount} registrations`
            : `${summary.installationCount} installations`}</span>
        </header>
        {detailView === "definitions"
          ? <div className="customization-table-scroll" role="tabpanel"><table>
              <thead><tr><th>Name</th><th>Kind</th><th>Hosts</th><th>Source</th><th>Evidence</th></tr></thead>
              <tbody>{catalog.definitions.map((definition) => <DefinitionRow key={definition.id} definition={definition} hosts={props.hostsByDefinition.get(definition.id) ?? []} />)}</tbody>
            </table></div>
          : <div className="customization-table-scroll" role="tabpanel"><table>
              <thead><tr><th>Package</th><th>Host</th><th>Scope</th><th>Install source</th><th>Enablement</th><th>Applicability</th><th>Source</th></tr></thead>
              <tbody>{catalog.installations.map((installation) => <InstallationRow key={installation.id} installation={installation} packageValue={packagesById.get(installation.packageId)} />)}</tbody>
            </table></div>}
      </section>
    </div>
  </div>;
}

function SummaryFact(props: { label: string; value: number }): React.JSX.Element {
  return <div><dt>{props.label}</dt><dd>{props.value}</dd></div>;
}

function DefinitionRow(props: { definition: CustomizationDefinitionV1; hosts: CustomizationHostId[] }): React.JSX.Element {
  return <tr>
    <td><strong>{props.definition.name}</strong>{props.definition.description && <small>{props.definition.description}</small>}</td>
    <td>{kindLabel(props.definition.kind)}</td>
    <td>{props.hosts.length > 0 ? props.hosts.map(hostLabel).join(", ") : "Unexposed"}</td>
    <td><code>{props.definition.source.logicalPath ?? "Opaque source"}</code></td>
    <td>{props.definition.validation.status}</td>
  </tr>;
}

function InstallationRow(props: { installation: PluginInstallationV1; packageValue: PluginPackageV1 | undefined }): React.JSX.Element {
  const packageName = props.packageValue?.manifest.displayName ?? props.packageValue?.manifest.name ?? "Unknown package";
  return <tr>
    <td><strong>{packageName}</strong>{props.packageValue?.manifest.declaredVersion && <small>{props.packageValue.manifest.declaredVersion}</small>}</td>
    <td>{hostLabel(props.installation.hostId)}</td>
    <td>{props.installation.scope}</td>
    <td>{props.installation.installSource}</td>
    <td>{props.installation.enablement}</td>
    <td>{props.installation.applicability}</td>
    <td><code>{props.installation.source.logicalPath ?? "Opaque source"}</code></td>
  </tr>;
}

function kindLabel(kind: CustomizationDefinitionV1["kind"]): string {
  return {
    "agent-skill": "Agent Skill",
    "agent-definition": "Agent Definition",
    "mcp-server-definition": "MCP Server",
    "prompt-command": "Prompt Command",
    hook: "Hook",
    instruction: "Instruction",
  }[kind];
}

function hostLabel(host: CustomizationHostId): string {
  return host === "codex" ? "Codex" : host === "claude" ? "Claude" : host === "qoder" ? "Qoder" : host;
}

function hostRank(host: CustomizationHostId): number {
  return host === "codex" ? 0 : host === "claude" ? 1 : host === "qoder" ? 2 : 3;
}
