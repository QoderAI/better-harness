import type { ArtifactDataSnapshot } from "../../artifact-model.js";

export function ArtifactDiagnostics({ diagnostics }: {
  diagnostics: ArtifactDataSnapshot["diagnostics"];
}): React.JSX.Element {
  if (diagnostics.length === 0) return <span>No diagnostics</span>;
  const worst = diagnostics.some((item) => item.level === "error")
    ? "error"
    : diagnostics.some((item) => item.level === "warning") ? "warning" : "info";
  return <details className={`artifact-diagnostics level-${worst}`}>
    <summary>{diagnostics.length} diagnostic{diagnostics.length === 1 ? "" : "s"}</summary>
    <ul>
      {diagnostics.map((item, index) => <li key={`${item.code}:${index}`} className={`level-${item.level}`}>
        <strong>{item.code}</strong><span>{item.message}</span>{item.address !== undefined && <code>{item.address}</code>}
      </li>)}
    </ul>
  </details>;
}
