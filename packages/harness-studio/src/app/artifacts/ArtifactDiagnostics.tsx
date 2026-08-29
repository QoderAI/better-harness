import { useTranslation } from "react-i18next";
import type { ArtifactDataSnapshot } from "../../contracts/artifact.js";

export function ArtifactDiagnostics({ diagnostics }: {
  diagnostics: ArtifactDataSnapshot["diagnostics"];
}): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  if (diagnostics.length === 0) return <span>{t("diagnostics.none")}</span>;
  const worst = diagnostics.some((item) => item.level === "error")
    ? "error"
    : diagnostics.some((item) => item.level === "warning") ? "warning" : "info";
  return <details className={`artifact-diagnostics level-${worst}`}>
    <summary>{t("diagnostics.count", { count: diagnostics.length })}</summary>
    <ul>
      {diagnostics.map((item, index) => <li key={`${item.code}:${index}`} className={`level-${item.level}`}>
        <strong>{item.code}</strong><span>{item.message}</span>{item.address !== undefined && <code>{item.address}</code>}
      </li>)}
    </ul>
  </details>;
}
