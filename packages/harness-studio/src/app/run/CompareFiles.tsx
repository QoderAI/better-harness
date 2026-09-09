import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ToolStatus } from '../components/ai-elements/tool.js';
import { toolElementState } from './ai-elements-adapter.js';
import { toolStatusLabel } from './TimelineEntry.js';
import { compareFileEvidence, type CompareEvidenceLane } from './compare-evidence.js';
import { useSessionOwnedState } from './session-view-store.js';

export function CompareFiles({ lanes, owner, onReveal }: {
  owner: string;
  lanes: (CompareEvidenceLane & { label: string })[];
  onReveal: (laneKey: string, toolId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('compare');
  const { t: runT } = useTranslation('run');
  const files = useMemo(() => compareFileEvidence(lanes), [lanes]);
  const [open, setOpen] = useSessionOwnedState(`${owner}:files-open`, false);
  return <details className="compare-files" data-lanes={lanes.length} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('live.files', { count: files.length })}</summary>
    {files.length === 0 ? <p>{t('live.noFiles')}</p> : <div className="compare-files-scroll"><table>
      <thead><tr><th scope="col">{t('live.file')}</th>{lanes.map(lane => <th key={lane.key} scope="col">{lane.label}</th>)}</tr></thead>
      <tbody>{files.map(file => <tr key={file.path}>
        <th scope="row"><code>{file.path}</code></th>
        {lanes.map(lane => {
          const operations = file.operations.filter(operation => operation.laneKey === lane.key);
          return <td key={lane.key}>{operations.length === 0 ? <span className="compare-unobserved">{t('live.notObserved')}</span>
            : operations.map(operation => <button key={operation.toolId} type="button"
              title={operation.title} aria-label={t('live.revealFileCall', { agent: lane.label, path: file.path, status: toolStatusLabel(operation.status, runT) })}
              onClick={() => onReveal(lane.key, operation.toolId)}>
              {operation.kind && <span>{t(`live.fileKind.${operation.kind}`, { defaultValue: operation.kind })}</span>}
              <ToolStatus state={toolElementState(operation.status)} label={toolStatusLabel(operation.status, runT)} />
            </button>)}</td>;
        })}
      </tr>)}</tbody>
    </table></div>}
  </details>;
}
