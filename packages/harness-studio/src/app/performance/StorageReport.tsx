import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretRight } from '@phosphor-icons/react/CaretRight';
import { Cpu } from '@phosphor-icons/react/Cpu';
import { TerminalWindow } from '@phosphor-icons/react/TerminalWindow';
import { GitFork } from '@phosphor-icons/react/GitFork';
import { Clock } from '@phosphor-icons/react/Clock';
import { Lightning } from '@phosphor-icons/react/Lightning';
import { Question } from '@phosphor-icons/react/Question';
import type { PerformanceDetail } from '../../contracts/session-performance.js';
import { timingDuration } from './SessionPerformanceWorkspace.js';
const icons={model:Cpu,tool:TerminalWindow,hook:Lightning,wait:Clock,subagent:GitFork,unknown:Question};
const percent=(part:number,total:number):string=>total?`${Math.round(part/total*1000)/10}%`:'—';
export function StorageReport({detail,onSelect}:{detail:PerformanceDetail;onSelect:(id:string)=>void}):React.JSX.Element {
 const {t}=useTranslation('performance');const id=useId();
 const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
 const toggle=(key:string,open?:boolean):void=>setExpanded(current=>{const next=new Set(current);if(open??!next.has(key))next.add(key);else next.delete(key);return next;});
 const summary=detail.session;const total=summary.breakdown.activityTotalMs;
 const segments=summary.breakdown.segments.filter(s=>s.kind!=='parallel');
 const label=(kind:string):string=>t(`storageKinds.${kind}`,{defaultValue:kind});
 const partName=(name:string):string=>name==='concurrent-calls'?t('concurrentCalls'):name==='unknown'?label('unknown'):name;
 return <div className="storage-report">
  <section className="storage-summary" aria-label={t('distribution')}>
   <div className="storage-title"><h2>{summary.label}</h2><span><strong>{timingDuration(total)}</strong><small>{t('activityTotal')}</small></span></div>
   <div className="storage-bar" aria-label={t('distribution')}>{segments.filter(s=>s.activityMs>0).map(s=><button key={s.kind} className={`storage-segment storage-${s.kind}`} style={{flexGrow:s.activityMs}} aria-label={`${label(s.kind)} ${timingDuration(s.activityMs)} ${percent(s.activityMs,total)}`} title={`${label(s.kind)} · ${percent(s.activityMs,total)}`} onClick={()=>toggle(s.kind,true)}/>)}</div>
   <div className="storage-legend">{segments.filter(s=>s.activityMs>0).map(s=><button key={s.kind} aria-expanded={expanded.has(s.kind)} aria-controls={`${id}-${s.kind}`} onClick={()=>toggle(s.kind)}><i className={`storage-dot storage-${s.kind}`}/>{label(s.kind)}</button>)}</div>
   <p className="storage-caption">{t('elapsedBasis',{duration:timingDuration(summary.breakdown.totalMs)})}</p>
  </section>
  <div className="storage-category-list" aria-label={t('categories')}>{segments.map(segment=>{
   const Icon=icons[segment.kind as keyof typeof icons]??Clock;const open=expanded.has(segment.kind);
   const parts=segment.callParts.length?segment.callParts:segment.parts;
   const base=segment.callParts.length?segment.cumulativeMs:segment.durationMs;
   return <div key={segment.kind} className={`storage-group storage-${segment.kind}`}>
    <button className="storage-category" aria-expanded={open} aria-controls={`${id}-${segment.kind}`} onClick={()=>toggle(segment.kind)}>
     <span className="storage-icon"><Icon size={21} aria-hidden="true"/></span>
     <span className="storage-row-name">{label(segment.kind)}{segment.kind==='subagent'&&<small>{t('agentCountShort',{count:summary.subagents.count})}</small>}</span>
     <span className="storage-row-value">{timingDuration(segment.activityMs)}<small>{percent(segment.activityMs,total)}</small></span><CaretRight className="storage-caret" size={16} aria-hidden="true"/>
    </button>
    {open&&<div className="storage-expanded" id={`${id}-${segment.kind}`} role="region" aria-label={label(segment.kind)}>
     <div className="storage-detail-heading"><span>{segment.callParts.length?t('cumulativeCalls'):t('categoryShare')}</span><strong>{timingDuration(base)}</strong></div>
     {segment.kind==='subagent'&&<div className="storage-agent-summary"><span>{t('elapsed')} <strong>{timingDuration(summary.subagents.elapsedMs)}</strong></span><span>{t('peak')} <strong>{summary.subagents.peakConcurrency}</strong></span></div>}
     {parts.map((part,index)=>{
      const key=`${segment.kind}:${part.label}`;const partOpen=expanded.has(key);const region=`${id}-${segment.kind}-${index}`;
      return <div key={part.label} className="storage-part-group">
       <button className="storage-part" disabled={!part.calls.length} aria-expanded={part.calls.length?partOpen:undefined} aria-controls={part.calls.length?region:undefined} onClick={()=>toggle(key)}>
        <span className="storage-row-name">{partName(part.label)}</span><span className="storage-mini-track" aria-hidden="true"><i style={{width:`${base?part.durationMs/base*100:0}%`}}/></span>
        <span className="storage-row-value">{timingDuration(part.durationMs)}<small>{percent(part.durationMs,base)}</small></span>{part.calls.length>0&&<CaretRight className="storage-caret" size={14} aria-hidden="true"/>}
       </button>
       {partOpen&&<div className="storage-calls" id={region} role="region" aria-label={partName(part.label)}>
        {part.calls.map((call,callIndex)=><button className="storage-call" key={call.spanId} disabled={!detail.spans.some(s=>s.id===call.spanId)} onClick={()=>onSelect(call.spanId)}>
         <span>{t('callNumber',{number:callIndex+1})}</span><span className="storage-mini-track" aria-hidden="true"><i style={{width:`${part.cumulativeMs?call.durationMs/part.cumulativeMs*100:0}%`}}/></span><span className="storage-row-value">{timingDuration(call.durationMs)}<small>{percent(call.durationMs,part.cumulativeMs)}</small></span><CaretRight size={13} aria-hidden="true"/>
        </button>)}
        {part.count>part.calls.length&&<p className="storage-caption">{t('topCalls',{shown:part.calls.length,total:part.count})}</p>}
       </div>}
      </div>;
     })}
     {!parts.length&&<p className="storage-caption">{t('noSpans')}</p>}
     {segment.callParts.length>0&&<p className="storage-caption">{t('callsOverlap')}</p>}
    </div>}
   </div>;
  })}</div>
  <details className="storage-method"><summary>{t('timingNotes')}{summary.status==='partial'?` · ${t('partial')}`:''}</summary><p>{t('activityNote')}</p><p>{t('modelNote')}</p><p>{t('coverage',{events:summary.coverage.events,files:summary.coverage.files,unpaired:summary.coverage.unpairedEvents,ambiguous:summary.coverage.ambiguousPairs,clocks:summary.coverage.clockConflicts})}</p></details>
 </div>;
}
