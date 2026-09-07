import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  CustomizationAnalysisResponseV1,
  CustomizationDefinitionV1,
  CustomizationHostId,
  PluginInstallationV1,
} from "@qoder-ai/harness/customization";
import { studioApiError } from "./studio-api.js";
import { DataTable } from "./shell/DataTable.js";

/** One catalog row: a definition already resolved against its Host exposures. */
interface DefinitionRow {
  definition: CustomizationDefinitionV1;
  hosts: string;
}

/** One catalog row: an installation already resolved against its package. */
interface InstallationRow {
  installation: PluginInstallationV1;
  packageName: string;
  declaredVersion: string | undefined;
}

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

  // Rows resolve their cross-references once here rather than inside a cell:
  // sorting compares the value a reader sees, so the Hosts column has to sort by
  // its rendered Host list and not by the definition id behind it.
  const definitionRows = useMemo<DefinitionRow[]>(() => catalog.definitions.map((definition) => {
    const hosts = props.hostsByDefinition.get(definition.id) ?? [];
    return { definition, hosts: hosts.length > 0 ? hosts.map(hostLabel).join(", ") : t("results.unexposed") };
  }), [catalog.definitions, props.hostsByDefinition, t]);

  const installationRows = useMemo<InstallationRow[]>(() => {
    const packagesById = new Map(catalog.packages.map((packageValue) => [packageValue.id, packageValue]));
    return catalog.installations.map((installation) => {
      const packageValue = packagesById.get(installation.packageId);
      return {
        installation,
        packageName: packageValue?.manifest.displayName ?? packageValue?.manifest.name ?? t("results.unknownPackage"),
        declaredVersion: packageValue?.manifest.declaredVersion,
      };
    });
  }, [catalog.installations, catalog.packages, t]);

  const definitionColumns = useMemo<ColumnDef<DefinitionRow, never>[]>(() => [
    {
      id: "name",
      header: t("results.cols.name"),
      accessorFn: (row) => row.definition.name,
      meta: { width: "32%" },
      cell: ({ row }) => <NameCell
        name={row.original.definition.name}
        detail={row.original.definition.description}
      />,
    },
    {
      id: "kind",
      header: t("results.cols.kind"),
      accessorFn: (row) => t(`results.kinds.${row.definition.kind}`),
      meta: { width: "16%" },
    },
    {
      id: "hosts",
      header: t("results.cols.hosts"),
      accessorFn: (row) => row.hosts,
      meta: { width: "16%" },
    },
    {
      id: "source",
      header: t("results.cols.source"),
      accessorFn: (row) => row.definition.source.logicalPath ?? t("results.opaqueSource"),
      meta: { width: "22%" },
      cell: ({ getValue }) => <SourceCell value={String(getValue())} />,
    },
    {
      id: "evidence",
      header: t("results.cols.evidence"),
      accessorFn: (row) => row.definition.validation.status,
      meta: { width: "14%" },
    },
  ], [t]);

  const installationColumns = useMemo<ColumnDef<InstallationRow, never>[]>(() => [
    {
      id: "package",
      header: t("results.installCols.package"),
      accessorFn: (row) => row.packageName,
      meta: { width: "21%" },
      cell: ({ row }) => <NameCell name={row.original.packageName} detail={row.original.declaredVersion} />,
    },
    {
      id: "host",
      header: t("results.installCols.host"),
      accessorFn: (row) => hostLabel(row.installation.hostId),
      meta: { width: "9%" },
    },
    {
      id: "scope",
      header: t("results.installCols.scope"),
      accessorFn: (row) => row.installation.scope,
      meta: { width: "9%" },
    },
    {
      id: "installSource",
      header: t("results.installCols.installSource"),
      accessorFn: (row) => row.installation.installSource,
      meta: { width: "15%" },
    },
    {
      id: "enablement",
      header: t("results.installCols.enablement"),
      accessorFn: (row) => row.installation.enablement,
      meta: { width: "14%" },
    },
    {
      id: "applicability",
      header: t("results.installCols.applicability"),
      accessorFn: (row) => row.installation.applicability,
      meta: { width: "14%" },
    },
    {
      id: "source",
      header: t("results.installCols.source"),
      accessorFn: (row) => row.installation.source.logicalPath ?? t("results.opaqueSource"),
      meta: { width: "18%" },
      cell: ({ getValue }) => <SourceCell value={String(getValue())} />,
    },
  ], [t]);

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
          ? <DataTable
            key="definitions"
            role="tabpanel"
            label={t("results.tabs.definitions")}
            columns={definitionColumns}
            rows={definitionRows}
            rowId={(row) => row.definition.id}
            minWidth="760px"
            initialSorting={[{ id: "name", desc: false }]}
          />
          : <DataTable
            key="installations"
            role="tabpanel"
            label={t("results.tabs.installations")}
            columns={installationColumns}
            rows={installationRows}
            rowId={(row) => row.installation.id}
            minWidth="860px"
            initialSorting={[{ id: "package", desc: false }]}
          />}
      </section>
    </div>
  </div>;
}

function SummaryFact(props: { label: string; value: number }): React.JSX.Element {
  return <div><dt>{props.label}</dt><dd>{props.value}</dd></div>;
}

/** A named row leads with its label and keeps the detail on a bounded second line. */
function NameCell(props: { name: string; detail: string | undefined }): React.JSX.Element {
  return <span className="customization-name-cell">
    <strong>{props.name}</strong>
    {props.detail !== undefined && props.detail !== "" && <small title={props.detail}>{props.detail}</small>}
  </span>;
}

/**
 * A logical path truncates from the left: the distinguishing part of
 * `Workspace/.codex/plugins/review-plugin/.codex-plugin/plugin.json` is its tail.
 * The full value stays available on hover rather than as a tab stop, because a
 * catalog of hundreds of rows must not add hundreds of keyboard stops.
 */
function SourceCell(props: { value: string }): React.JSX.Element {
  return <code className="customization-source-cell" title={props.value}>{props.value}</code>;
}

function hostLabel(host: CustomizationHostId): string {
  return host === "codex" ? "Codex" : host === "claude" ? "Claude" : host === "qoder" ? "Qoder" : host;
}

function hostRank(host: CustomizationHostId): number {
  return host === "codex" ? 0 : host === "claude" ? 1 : host === "qoder" ? 2 : 3;
}
