import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("customize");
  const tRef = useRef(t);
  tRef.current = t;
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
        if (!cancelled) setFailure(error instanceof Error ? error.message : tRef.current("errors.catalogUnavailable"));
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
      setFailure(error instanceof Error ? error.message : t("errors.analysisFailed"));
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
    {busy ? t("analyzing") : analysis === undefined ? t("analyze") : t("analyzeAgain")}
  </button>;

  return <section className="customization-workbench" aria-label={t("workbenchAria")}>
    <header className="customization-toolbar">
      <div><strong>{t("catalogTitle")}</strong><span>{t("catalogDetail")}</span></div>
      {action}
    </header>
    {busy && <p className="customization-progress" role="status" aria-live="polite">{t("collecting")}</p>}
    {failure !== undefined && <p className="customization-failure" role="alert">{failure}</p>}
    {loading
      ? <p className="customization-progress" role="status">{t("loadingCatalog")}</p>
      : analysis === undefined
        ? <CustomizationEmpty />
        : <CustomizationResults analysis={analysis} hostsByDefinition={hostsByDefinition} />}
  </section>;
}

function CustomizationEmpty(): React.JSX.Element {
  const { t } = useTranslation("customize");
  return <div className="customization-empty">
    <section><h2>{t("emptyState.h2")}</h2><p>{t("emptyState.detail")}</p></section>
    <dl>
      <div><dt>{t("emptyState.collectedTitle")}</dt><dd>{t("emptyState.collectedDetail")}</dd></div>
      <div><dt>{t("emptyState.notCollectedTitle")}</dt><dd>{t("emptyState.notCollectedDetail")}</dd></div>
      <div><dt>{t("emptyState.boundaryTitle")}</dt><dd>{t("emptyState.boundaryDetail")}</dd></div>
    </dl>
  </div>;
}

function CustomizationResults(props: {
  analysis: CustomizationAnalysisResponseV1;
  hostsByDefinition: Map<string, CustomizationHostId[]>;
}): React.JSX.Element {
  const { t } = useTranslation("customize");
  const { catalog, summary } = props.analysis;
  const [detailView, setDetailView] = useState<"definitions" | "installations">("definitions");
  const packagesById = useMemo(
    () => new Map(catalog.packages.map((packageValue) => [packageValue.id, packageValue])),
    [catalog.packages],
  );
  return <div className="customization-results">
    <dl className="customization-summary" aria-label={t("results.summaryAria")}>
      <SummaryFact label={t("results.definitions")} value={summary.definitionCount} />
      <SummaryFact label={t("results.packages")} value={summary.packageCount} />
      <SummaryFact label={t("results.installations")} value={summary.installationCount} />
      <SummaryFact label={t("results.mcpRegistrations")} value={summary.registrationCount} />
    </dl>
    <div className="customization-panes">
      <aside className="customization-hosts">
        <header><h2>{t("hosts.title")}</h2><span>{summary.hosts.length}</span></header>
        <ul>{summary.hosts.map((host) => <li key={host.id}>
          <span className={`availability-dot availability-${host.status === "ok" ? "ready" : host.status === "partial" ? "partial" : "foundation"}`} aria-hidden="true" />
          <div><strong>{host.label}</strong><small>{host.status === "ok" ? t("hosts.collected") : t(`hosts.status.${host.status}`)}</small></div>
          <dl><div><dt>{t("hosts.definitions")}</dt><dd>{host.definitions}</dd></div><div><dt>{t("hosts.packages")}</dt><dd>{host.packages}</dd></div><div><dt>{t("hosts.mcp")}</dt><dd>{host.registrations}</dd></div></dl>
        </li>)}</ul>
        <footer aria-live="polite">{catalog.runtimeObservations.map((item) => item.kind === "host-collection" && item.status === "error"
          ? <p key={item.id} role="alert">{item.message}</p>
          : null)}</footer>
      </aside>
      <section className="customization-definitions">
        <header className="customization-detail-header">
          <div className="customization-detail-tabs" data-active={detailView} role="tablist" aria-label={t("results.detailTabsAria")}>
            <button type="button" role="tab" aria-selected={detailView === "definitions"} onClick={() => setDetailView("definitions")}>{t("results.tabs.definitions")}</button>
            <button type="button" role="tab" aria-selected={detailView === "installations"} onClick={() => setDetailView("installations")}>{t("results.tabs.installations")}</button>
          </div>
          <span>{detailView === "definitions"
            ? t("results.exposureSummary", { exposures: summary.exposureCount, registrations: summary.registrationCount })
            : t("results.installationsSummary", { count: summary.installationCount })}</span>
        </header>
        {detailView === "definitions"
          ? <div className="customization-table-scroll" role="tabpanel"><table>
              <thead><tr><th>{t("results.cols.name")}</th><th>{t("results.cols.kind")}</th><th>{t("results.cols.hosts")}</th><th>{t("results.cols.source")}</th><th>{t("results.cols.evidence")}</th></tr></thead>
              <tbody>{catalog.definitions.map((definition) => <DefinitionRow key={definition.id} definition={definition} hosts={props.hostsByDefinition.get(definition.id) ?? []} />)}</tbody>
            </table></div>
          : <div className="customization-table-scroll" role="tabpanel"><table>
              <thead><tr><th>{t("results.installCols.package")}</th><th>{t("results.installCols.host")}</th><th>{t("results.installCols.scope")}</th><th>{t("results.installCols.installSource")}</th><th>{t("results.installCols.enablement")}</th><th>{t("results.installCols.applicability")}</th><th>{t("results.installCols.source")}</th></tr></thead>
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
  const { t } = useTranslation("customize");
  return <tr>
    <td><strong>{props.definition.name}</strong>{props.definition.description && <small>{props.definition.description}</small>}</td>
    <td>{t(`results.kinds.${props.definition.kind}`)}</td>
    <td>{props.hosts.length > 0 ? props.hosts.map(hostLabel).join(", ") : t("results.unexposed")}</td>
    <td><code>{props.definition.source.logicalPath ?? t("results.opaqueSource")}</code></td>
    <td>{props.definition.validation.status}</td>
  </tr>;
}

function InstallationRow(props: { installation: PluginInstallationV1; packageValue: PluginPackageV1 | undefined }): React.JSX.Element {
  const { t } = useTranslation("customize");
  const packageName = props.packageValue?.manifest.displayName ?? props.packageValue?.manifest.name ?? t("results.unknownPackage");
  return <tr>
    <td><strong>{packageName}</strong>{props.packageValue?.manifest.declaredVersion && <small>{props.packageValue.manifest.declaredVersion}</small>}</td>
    <td>{hostLabel(props.installation.hostId)}</td>
    <td>{props.installation.scope}</td>
    <td>{props.installation.installSource}</td>
    <td>{props.installation.enablement}</td>
    <td>{props.installation.applicability}</td>
    <td><code>{props.installation.source.logicalPath ?? t("results.opaqueSource")}</code></td>
  </tr>;
}

function hostLabel(host: CustomizationHostId): string {
  return host === "codex" ? "Codex" : host === "claude" ? "Claude" : host === "qoder" ? "Qoder" : host;
}

function hostRank(host: CustomizationHostId): number {
  return host === "codex" ? 0 : host === "claude" ? 1 : host === "qoder" ? 2 : 3;
}
