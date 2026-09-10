import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from '@phosphor-icons/react/X';
import { SessionTranscript } from '../session/SessionTranscript.js';
import type { DebuggerSession } from '../../contracts/debugger-session.js';

/**
 * The retained conversation beside its own timing. A reader comparing an
 * interval with the message that produced it should not have to hold two
 * screens in their head, so the same Session is read here through the Session
 * projection rather than re-described in timing terms.
 */
export function SessionTranscriptPane(props: {
  sessionId: string;
  activeCallStartMs?: number;
  linkedCallStartMs: ReadonlySet<number>;
  onSelectCall: (startedAtMs: number) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('performance');
  const [session, setSession] = useState<DebuggerSession>();
  const [failed, setFailed] = useState<'missing' | 'error'>();
  useEffect(() => {
    const controller = new AbortController();
    setSession(undefined);
    setFailed(undefined);
    fetch(`api/sessions/${encodeURIComponent(props.sessionId)}/debugger`, { signal: controller.signal })
      // Timing reaches further back than the bounded Session list, so a Session
      // with no retained conversation is an absence to state, not a failure.
      .then(async response => { if (!response.ok) throw new Error(response.status === 404 ? 'missing' : 'error'); return await response.json() as DebuggerSession; })
      .then(setSession)
      .catch((error: Error) => { if (!controller.signal.aborted) setFailed(error.message === 'missing' ? 'missing' : 'error'); });
    return () => controller.abort();
  }, [props.sessionId]);
  return <aside className="performance-transcript" aria-label={t('transcript')}>
    <div className="performance-toolbar">
      <h3>{t('transcript')}</h3>
      <button aria-label={t('closeTranscript')} onClick={props.onClose}><X aria-hidden="true" size={15} /></button>
    </div>
    {failed !== undefined
      ? <p className="performance-state" role={failed === 'missing' ? 'status' : 'alert'}>{t(failed === 'missing' ? 'transcriptMissing' : 'transcriptError')}</p>
      : session === undefined
        ? <p className="performance-state" role="status">{t('loading')}</p>
        : <>
          <p className="performance-note">{t('transcriptSummary', { agent: session.agent, events: session.events.length })}</p>
          <SessionTranscript
            events={session.events}
            {...(props.activeCallStartMs === undefined ? {} : { activeCallStartMs: props.activeCallStartMs })}
            linkedCallStartMs={props.linkedCallStartMs}
            onSelectCall={props.onSelectCall}
          />
        </>}
  </aside>;
}
