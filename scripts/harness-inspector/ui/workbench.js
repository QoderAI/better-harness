(() => {
  const report = JSON.parse(document.getElementById("inspector-data").textContent);
  const byNode = new Map(report.featureTree.nodes.map(node => [node.id,node]));
  const byStory = new Map(report.stories.map(story => [story.id,story]));
  const bySession = new Map(report.sessions.map(session => [session.sessionId,session]));
  const byCommit = new Map(report.commits.map(commit => [commit.hash,commit]));
  const defaultCompactCommitKinds = new Set(report.presentation?.defaultCompactCommitEvidenceKinds ?? []);
  const callsBySession = new Map(report.sessions.map(session => [session.sessionId,new Map(session.toolActivity.calls.map(call => [call.id,call]))]));
  const storyScore = story => story.sessionLinks.reduce((score, link) => {
    const session = bySession.get(link.sessionId);
    if (!session) return score;
    return score + session.commitLinks.reduce((sum, commit) => sum + (commit.overlappingFiles?.length ?? 0), 0) + session.toolActivity.files.length;
  }, 0);
  const storyLastSeen = story => Math.max(0,...story.sessionLinks.map(link => new Date(bySession.get(link.sessionId)?.lastSeen ?? 0).getTime()).filter(Number.isFinite));
  const stageMatchedStories = report.stories.filter(story => story.stage === report.filters.stage);
  const eligibleStories = report.filters.stage && stageMatchedStories.length > 0 ? stageMatchedStories : report.stories;
  const initialStory = [...eligibleStories].sort((left,right) => storyLastSeen(right) - storyLastSeen(left) || storyScore(right) - storyScore(left))[0] ?? report.stories[0];
  const initialFeature = initialStory?.id ?? report.featureTree.roots[0] ?? null;
  const latestDay = report.days.at(-1)?.date ?? null;
  const calendarMonths = [...new Set(report.days.map(day => day.date.slice(0,7)))].sort();
  const initialParams = new URLSearchParams(location.search);
  const requestedMode = initialParams.get('mode');
  const hasFeatureEvidence = report.stories.some(story => story.sessionLinks.length || story.commitHashes.length);
  const defaultMode = report.featureTree.nodes.length && hasFeatureEvidence ? 'feature' : 'date';
  const initialMode = requestedMode === 'date' || requestedMode === 'feature'
    ? requestedMode
    : defaultMode;
  const requestedScope = initialMode === 'feature' ? initialParams.get('feature') : initialParams.get('date');
  const validScope = initialMode === 'feature'
    ? byNode.has(requestedScope)
    : report.days.some(day => day.date === requestedScope);
  const state = {
    mode:initialMode,
    scope:validScope ? requestedScope : initialMode === 'feature' ? initialFeature : latestDay,
    calendarMonth:(validScope && initialMode === 'date' ? requestedScope : latestDay)?.slice(0,7) ?? calendarMonths.at(-1) ?? null,
    sessionTrigger:null,
    sessionItem:null,
    sessionOpen:false,
    sessionPushed:false,
    syncingHistory:false,
    sessionMode:['replay','usage'].includes(initialParams.get('session-mode')) ? initialParams.get('session-mode') : 'trace',
    replayEventId:initialParams.get('replay-event'),
    replayIndexTab:'events',
    replayPlaying:false,
    replaySpeed:2,
    replayTimer:null,
    // Chart zoom is a per-session view concern and stays out of the deep link.
    zoom:new Map(),
    // Prompt-cache policy is mutable reference data, not Session evidence. A
    // reader may compare another profile without changing the report model.
    promptCacheProfileBySession:new Map(),
    // Usage range and response selection are local to an open Session report.
    usageExplorer:new Map(),
    // Commit file layout is presentation-only, scoped to each visible delivery
    // pane, and survives workbench rerenders within this generated report.
    commitFileViews:new Map(),
    collapsedCards:new Set(),
    items:[],
  };
  const escape = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
  const markdownTextInline = value => {
    const links = [];
    const tokenized = String(value ?? '').replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/gu,(source,label,rawTarget) => {
      const target = rawTarget.trim().replace(/^<|>$/gu,'');
      if (!/^(?:https?:\/\/|mailto:|#|\.{0,2}\/)/iu.test(target)) return source;
      const external = /^https?:\/\//iu.test(target);
      const token = '@@SESSION_LINK_' + links.length + '@@';
      links.push('<a href="' + escape(target) + '"' + (external ? ' target="_blank" rel="noreferrer"' : '') + '>' + escape(label) + '</a>');
      return token;
    });
    let rendered = escape(tokenized).replace(/\*\*([^*\n]+)\*\*/gu,'<strong>$1</strong>');
    links.forEach((link,index) => { rendered = rendered.replace('@@SESSION_LINK_' + index + '@@',link); });
    return rendered;
  };
  const markdownInline = value => String(value ?? '').split(/(`[^`\n]+`)/gu).map(part => {
    if (part.startsWith('`') && part.endsWith('`')) return '<code>' + escape(part.slice(1,-1)) + '</code>';
    return markdownTextInline(part);
  }).join('');
  const renderSessionMarkdown = value => {
    const lines = String(value ?? '').replaceAll('\r\n','\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }
      const fence = line.match(/^\s*```([^`]*)$/u);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        const language = fence[1].trim().replaceAll(/[^a-z0-9_-]/giu,'');
        blocks.push('<pre><code' + (language ? ' class="language-' + language + '"' : '') + '>' + escape(code.join('\n')) + '</code></pre>');
        continue;
      }
      const heading = line.match(/^\s*(#{1,4})\s+(.+)$/u);
      if (heading) {
        const level = Math.min(4,heading[1].length + 1);
        blocks.push('<h' + level + '>' + markdownInline(heading[2]) + '</h' + level + '>');
        index += 1;
        continue;
      }
      const list = line.match(/^\s*(?:([-*])|(\d+\.))\s+(.+)$/u);
      if (list) {
        const ordered = Boolean(list[2]);
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*(?:([-*])|(\d+\.))\s+(.+)$/u);
          if (!item || Boolean(item[2]) !== ordered) break;
          items.push('<li>' + markdownInline(item[3]) + '</li>');
          index += 1;
        }
        blocks.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }
      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim()
        && !/^\s*```/u.test(lines[index])
        && !/^\s*#{1,4}\s+/u.test(lines[index])
        && !/^\s*(?:[-*]|\d+\.)\s+/u.test(lines[index])) paragraph.push(lines[index++].trim());
      blocks.push('<p>' + paragraph.map(markdownInline).join('<br>') + '</p>');
    }
    return blocks.join('') || '<p></p>';
  };
  const formatDuration = value => Number.isFinite(value) ? (value >= 3600000 ? (value / 3600000).toFixed(1) + "h" : Math.max(1,Math.round(value / 60000)) + "m") : "unknown";
  const formatLatency = value => !Number.isFinite(value) ? "timing unavailable"
    : value < 1000 ? Math.round(value) + " ms"
      : value < 60000 ? (Math.round(value / 100) / 10) + " s"
        : (Math.round(value / 6000) / 10) + " min";
  const formatSpan = value => !Number.isFinite(value) ? "unknown"
    : value < 60000 ? Math.max(1,Math.round(value / 1000)) + "s"
      : value < 3600000 ? Math.round(value / 60000) + "m"
        : (value / 3600000).toFixed(1) + "h";
  const pad = value => String(value).padStart(2,'0');
  const formatClock = value => {
    const time = new Date(value ?? NaN);
    return Number.isNaN(time.getTime()) ? 'time unknown' : pad(time.getUTCHours()) + ':' + pad(time.getUTCMinutes()) + ' UTC';
  };
  const formatShortClock = value => {
    const time = new Date(value ?? NaN);
    return Number.isNaN(time.getTime()) ? '—' : pad(time.getUTCHours()) + ':' + pad(time.getUTCMinutes());
  };
  const formatStamp = value => {
    const time = new Date(value ?? NaN);
    return Number.isNaN(time.getTime()) ? null : pad(time.getUTCHours()) + ':' + pad(time.getUTCMinutes()) + ':' + pad(time.getUTCSeconds());
  };
  const formatTokenCount = value => value >= 1000000 ? (Math.round(value / 100000) / 10) + 'M'
    : value >= 1000 ? (Math.round(value / 100) / 10) + 'K' : String(value);
  const formatObservedTokenCount = value => Number.isFinite(value) ? formatTokenCount(value) : 'not reported';
  const formatSignedTokenCount = value => !Number.isFinite(value) ? 'not comparable'
    : value > 0 ? '+' + formatTokenCount(value) : value < 0 ? '−' + formatTokenCount(Math.abs(value)) : '0';
  const sessionContextSnapshotPresentation = session => {
    const reportedCurrent = session?.usageReport?.currentContextTokens;
    const manifestCurrent = session?.contextManifest?.usedTokens;
    const hasReportedCurrent = reportedCurrent !== null && reportedCurrent !== undefined && Number.isFinite(Number(reportedCurrent)) && Number(reportedCurrent) >= 0;
    const hasManifestCurrent = manifestCurrent !== null && manifestCurrent !== undefined && Number.isFinite(Number(manifestCurrent)) && Number(manifestCurrent) >= 0;
    const currentTokens = hasReportedCurrent
      ? Math.round(Number(reportedCurrent))
      : hasManifestCurrent ? Math.round(Number(manifestCurrent)) : null;
    const compactionSnapshots = (session?.contextManifest?.compactionEvents ?? [])
      .map(event => event?.contextTokens)
      .filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0)
      .map(Number)
      .map(Math.round);
    const compactionCount = Math.max(0,Math.round(Number(session?.contextManifest?.compactionCount) || 0));
    const compactionTokens = compactionSnapshots.reduce((sum,value) => sum + value,0);
    const observedTokens = (currentTokens ?? 0) + compactionTokens;
    const observedSnapshotCount = (currentTokens === null ? 0 : 1) + compactionSnapshots.length;
    const parts = [];
    if (currentTokens !== null) parts.push(formatTokenCount(currentTokens) + ' current');
    if (compactionSnapshots.length > 0) parts.push(compactionSnapshots.length + ' comp · ' + formatTokenCount(compactionTokens));
    else if (compactionCount > 0) parts.push(compactionCount + ' compaction' + (compactionCount === 1 ? '' : 's') + ' · tokens unobserved');
    const titleParts = [];
    if (currentTokens !== null) titleParts.push('Current Context: ' + formatTokenCount(currentTokens));
    compactionSnapshots.forEach((value,index) => titleParts.push('Compaction ' + (index + 1) + ': ' + formatTokenCount(value)));
    if (compactionCount > compactionSnapshots.length) titleParts.push((compactionCount - compactionSnapshots.length) + ' compaction token snapshot' + (compactionCount - compactionSnapshots.length === 1 ? '' : 's') + ' unavailable');
    return { currentTokens, compactionCount, compactionTokens, observedTokens, observedSnapshotCount, compact:parts.join(' · '), title:titleParts.join('\n') };
  };
  const dayContextSnapshotPresentation = sessions => {
    const summaries = sessions.map(sessionContextSnapshotPresentation);
    return {
      observedTokens: summaries.reduce((sum,summary) => sum + summary.observedTokens,0),
      observedSessions: summaries.filter(summary => summary.observedSnapshotCount > 0).length,
      compactionCount: summaries.reduce((sum,summary) => sum + summary.compactionCount,0),
    };
  };
  // Mirrors EMPTY_USAGE_REPORT in scripts/session-analysis/usage-progression.mjs
  // so this renderer never invents a second "nothing observed" shape.
  const EMPTY_USAGE_REPORT = { actualModelCalls:0,duplicateRecordsCollapsed:0,conflictingDuplicateRecords:0,contextResetCount:0,modelBoundaryCount:0,progressionTotalCount:0,progressionTruncated:false,progression:[] };
  const sessionUsageReport = session => session?.usageReport ?? EMPTY_USAGE_REPORT;
  const formatUsageSnapshotTime = value => {
    const time = new Date(value ?? NaN);
    return Number.isNaN(time.getTime()) ? null : time.toISOString().slice(0,19).replace('T',' ') + ' UTC';
  };
  const usageSnapshotFreshness = session => {
    const projectedAt = formatUsageSnapshotTime(session?.usageSnapshot?.timestamp);
    if (session?.usageSnapshot?.status === 'observed-through' && projectedAt) return { note:'Static snapshot · observed through ' + projectedAt,evidence:'observed through ' + projectedAt };
    if (session?.usageSnapshot?.status === 'generated-at' && projectedAt) return { note:'Static snapshot · generated ' + projectedAt,evidence:'generated ' + projectedAt };
    if (session?.usageSnapshot?.status === 'unavailable') return { note:'Static snapshot · freshness unavailable',evidence:'freshness unavailable' };
    const progression = sessionUsageReport(session).progression ?? [];
    const observedAt = [...progression].reverse().map(point => formatUsageSnapshotTime(point.timestamp)).find(Boolean);
    if (observedAt) return { note:'Static snapshot · observed through ' + observedAt,evidence:'observed through ' + observedAt };
    const generatedAt = formatUsageSnapshotTime(report.generatedAt);
    if (generatedAt) return { note:'Static snapshot · generated ' + generatedAt,evidence:'generated ' + generatedAt };
    return { note:'Static snapshot · freshness unavailable',evidence:'freshness unavailable' };
  };
  const formatTokens = usage => {
    if (!usage) return 'token usage unavailable';
    if (Number.isFinite(usage.totalTokens)) return formatTokenCount(usage.totalTokens) + ' total tokens';
    const inputOutput = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    return inputOutput > 0 ? formatTokenCount(inputOutput) + ' input + output tokens' : 'usage observed';
  };
  const formatInvocationUsage = usage => {
    if (!usage) return 'not observed';
    const parts = [];
    if (Number.isFinite(usage.totalTokens)) parts.push(formatTokenCount(usage.totalTokens) + ' total');
    if (Number.isFinite(usage.inputTokens)) parts.push(formatTokenCount(usage.inputTokens) + ' input');
    if (Number.isFinite(usage.outputTokens)) parts.push(formatTokenCount(usage.outputTokens) + ' output');
    if (Number.isFinite(usage.cacheReadInputTokens)) parts.push(formatTokenCount(usage.cacheReadInputTokens) + ' cache read');
    if (Number.isFinite(usage.cacheCreationInputTokens)) parts.push(formatTokenCount(usage.cacheCreationInputTokens) + ' cache write');
    if (Number.isFinite(usage.reasoningOutputTokens)) parts.push(formatTokenCount(usage.reasoningOutputTokens) + ' reasoning');
    return parts.join(' · ') || 'not observed';
  };
  const formatCacheReuse = reuse => {
    if (!reuse) return 'not observed';
    if (reuse.status === 'observed' && Number.isFinite(reuse.reusePercent)) return reuse.reusePercent + '% input reused';
    if (reuse.status === 'inconsistent') return formatTokenCount(reuse.cacheReadTokens) + ' cached · rate unavailable (inconsistent counters)';
    return formatTokenCount(reuse.cacheReadTokens) + ' cached · rate unavailable';
  };
  const cacheReuseBarMarkup = (reuse,detailed = false) => {
    if (reuse?.status !== 'observed' || !Number.isFinite(reuse.promptInputTokens) || reuse.promptInputTokens <= 0) return '';
    const cacheCreation = Number.isFinite(reuse.cacheCreationTokens) ? Math.min(reuse.uncachedInputTokens,reuse.cacheCreationTokens) : 0;
    const otherUncached = Math.max(0,reuse.uncachedInputTokens - cacheCreation);
    const buckets = [
      ['cached','Cached input',reuse.cacheReadTokens],
      ...(detailed ? [['created','Cache creation',cacheCreation]] : []),
      ['uncached',detailed ? 'Other uncached input' : 'Uncached input',detailed ? otherUncached : reuse.uncachedInputTokens],
    ].filter(([_kind,_label,value]) => Number.isFinite(value) && value > 0);
    const label = reuse.reusePercent + '% of ' + formatTokenCount(reuse.promptInputTokens) + ' observed input was served from cache';
    return '<div class="usage-reuse-bar" role="img" aria-label="' + escape(label) + '">' + buckets.map(([kind,bucketLabel,value]) => '<i class="reuse-' + kind + '" style="flex-grow:' + value + '" title="' + escape(bucketLabel + ': ' + formatTokenCount(value)) + '"></i>').join('') + '</div>';
  };
  const cacheReuseSummaryMarkup = reuse => {
    if (!reuse) return '';
    const observed = reuse.status === 'observed' && Number.isFinite(reuse.promptInputTokens);
    const headline = observed ? reuse.reusePercent + '% reused' : formatTokenCount(reuse.cacheReadTokens) + ' cached';
    const detail = observed
      ? formatTokenCount(reuse.cacheReadTokens) + ' cached of ' + formatTokenCount(reuse.promptInputTokens) + ' observed input'
      : reuse.status === 'inconsistent' ? 'Reuse rate unavailable because provider counters are inconsistent' : 'Reuse rate unavailable because the cache relationship is unknown';
    return '<div class="usage-summary-reuse"><div class="usage-context-meta"><strong>Input reuse</strong><span>' + escape(headline) + '</span></div>' + cacheReuseBarMarkup(reuse) + '<p>' + escape(detail) + '</p></div>';
  };
  const cacheReuseSectionMarkup = reuse => {
    if (!reuse) return '';
    const observed = reuse.status === 'observed' && Number.isFinite(reuse.promptInputTokens);
    const cacheCreation = Number.isFinite(reuse.cacheCreationTokens) ? reuse.cacheCreationTokens : null;
    const otherUncached = observed && cacheCreation > 0 ? Math.max(0,reuse.uncachedInputTokens - cacheCreation) : reuse.uncachedInputTokens;
    const facts = [
      ['Cached input',reuse.cacheReadTokens,'reuse-cached'],
      ...(cacheCreation !== null ? [['Cache creation',cacheCreation,'reuse-created']] : []),
      ...(observed ? [[cacheCreation > 0 ? 'Other uncached input' : 'Uncached input',otherUncached,'reuse-uncached']] : []),
    ];
    const relation = reuse.accountingMode === 'included-in-input' ? 'Cache reads are included in the provider input total.'
      : reuse.accountingMode === 'separate-input-lane' ? 'Cache reads and cache creation are separate provider input lanes.'
        : 'The provider relationship between input and cache counters was not observed.';
    const status = observed ? reuse.reusePercent + '% reused' : reuse.status === 'inconsistent' ? 'rate unavailable' : formatTokenCount(reuse.cacheReadTokens) + ' cached';
    return '<section class="usage-report-section usage-reuse-section" data-cache-reuse-status="' + escape(reuse.status) + '"><header><div><h4>Input reuse</h4><p>Cached input still occupies context. Provider caching can reduce cost or latency, but this report does not estimate savings.</p></div><strong>' + escape(status) + '</strong></header>'
      + cacheReuseBarMarkup(reuse,true)
      + '<ul class="usage-reuse-list">' + facts.map(([label,value,kind]) => '<li><i class="' + kind + '"></i><span>' + escape(label) + '</span><strong>' + formatTokenCount(value) + '</strong>' + (observed ? '<small>' + (Math.round((value / reuse.promptInputTokens) * 1000) / 10) + '%</small>' : '') + '</li>').join('') + '</ul>'
      + '<p class="usage-reuse-note">' + escape(relation + (reuse.status === 'inconsistent' ? ' The observed values are retained, but no rate is derived.' : '')) + '</p></section>';
  };
  const formatContextWindowUsage = context => {
    if (!context) return 'not observed for this response';
    const hasUsed = Number.isFinite(context.usedTokens) && context.usedTokens >= 0;
    const hasWindow = Number.isFinite(context.windowTokens) && context.windowTokens > 0;
    const hasPercent = Number.isFinite(context.percentFull) && context.percentFull >= 0 && context.percentFull <= 100;
    if (hasUsed && hasWindow) {
      const percent = hasPercent ? context.percentFull : Math.min(100,Math.round((context.usedTokens / context.windowTokens) * 1000) / 10);
      return formatTokenCount(context.usedTokens) + ' / ' + formatTokenCount(context.windowTokens) + ' · ' + percent + '% full';
    }
    if (hasPercent) return context.percentFull + '% full · window size not observed';
    if (hasUsed) return formatTokenCount(context.usedTokens) + (context.basis === 'prompt-tokens' ? ' observed prompt tokens' : ' used tokens') + ' · context window not observed';
    return 'not observed for this response';
  };
  const usageStepMarkup = (step,index,inline = false) => {
    const source = step.source ?? 'normalized model evidence';
    const total = Number.isFinite(step.tokenUsage?.totalTokens)
      ? step.tokenUsage.totalTokens
      : Number(step.tokenUsage?.inputTokens ?? 0) + Number(step.tokenUsage?.outputTokens ?? 0);
    const compactTokens = total > 0 ? formatTokenCount(total) + ' tokens' : 'usage observed';
    const context = formatContextWindowUsage(step.contextUsage);
    const detail = formatInvocationUsage(step.tokenUsage) + ' · ' + (step.cacheReuse ? formatCacheReuse(step.cacheReuse) + ' · ' : '') + context;
    const content = '<strong>Model response ' + index + '</strong><span>' + escape(compactTokens + ' · ' + context) + '</span>';
    return inline
      ? '<span class="session-usage-inline" data-session-event="usage" title="' + escape((step.model ?? source) + ' · ' + detail) + '">' + content + '</span>'
      : '<article class="session-event usage session-usage-compact" data-session-event="usage" title="' + escape((step.model ?? source) + ' · ' + detail) + '">' + content + '</article>';
  };
  const usageContextPresentation = session => {
    const context = session.contextManifest;
    const hasUsedTokens = Number.isFinite(context?.usedTokens) && context.usedTokens >= 0;
    const hasWindowTokens = Number.isFinite(context?.windowTokens) && context.windowTokens > 0;
    const hasContextWindow = hasUsedTokens && hasWindowTokens;
    const hasObservedPercent = Number.isFinite(context?.percentFull) && context.percentFull >= 0 && context.percentFull <= 100;
    const windowTokens = hasWindowTokens ? context.windowTokens : 0;
    const usedTokens = hasUsedTokens ? Math.min(hasWindowTokens ? windowTokens : Number.POSITIVE_INFINITY,context.usedTokens) : 0;
    const percentFull = hasObservedPercent
      ? Math.max(0,Math.min(100,context.percentFull))
      : hasContextWindow ? Math.round((usedTokens / windowTokens) * 1000) / 10 : 0;
    let remaining = usedTokens;
    const categories = hasUsedTokens ? (context?.categories ?? []).filter(category => Number.isFinite(category.estimatedTokens) && category.estimatedTokens > 0) : [];
    const segments = categories.flatMap((category,index) => {
      const tokens = Math.min(remaining,category.estimatedTokens);
      remaining -= tokens;
      return tokens > 0 ? [{ kind:category.kind,label:category.label,tokens,colorIndex:index }] : [];
    });
    if (remaining > 0) segments.push({ kind:categories.length ? 'other' : 'observed',label:categories.length ? 'Other' : 'Observed context',tokens:remaining,colorIndex:7 });
    const turns = session.dialogue?.turns?.length ? session.dialogue.turns : [];
    const observations = turns.flatMap(turn => turn.steps?.filter(step => step.kind === 'usage') ?? []).map((step,index) => ({ index:index + 1,step }));
    return { segments,unusedTokens:hasContextWindow ? Math.max(0,windowTokens - usedTokens) : 0,hasCategoryBreakdown:categories.length > 0,hasContextWindow,hasUsedTokens,hasPercentFull:hasObservedPercent || hasContextWindow,usedTokens,windowTokens,percentFull,observations };
  };
  const contextBarMarkup = (context,label) => '<div class="usage-context-bar" role="img" aria-label="' + escape(label) + '">'
    + context.segments.map(segment => '<i class="usage-context-segment category-' + (segment.colorIndex % 8) + '" style="flex-grow:' + segment.tokens + '" title="' + escape(segment.label + ': ' + formatTokenCount(segment.tokens) + ' tokens') + '"></i>').join('')
    + (context.unusedTokens > 0 ? '<i class="usage-context-unused" style="flex-grow:' + context.unusedTokens + '" title="Unused: ' + escape(formatTokenCount(context.unusedTokens)) + ' tokens"></i>' : '')
    + '</div>';
  const occupancyBarMarkup = (percent,label) => '<div class="usage-progress-bar usage-occupancy-bar" role="img" aria-label="' + escape(label) + '"><i style="width:' + percent + '%"></i></div>';
  const progressionBoundaryNote = usageReport => {
    const notes = [];
    if (usageReport.contextResetCount > 0) notes.push(usageReport.contextResetCount + ' context shrink/reset' + (usageReport.contextResetCount === 1 ? '' : 's'));
    if (usageReport.modelBoundaryCount > 0) notes.push(usageReport.modelBoundaryCount + ' model boundar' + (usageReport.modelBoundaryCount === 1 ? 'y' : 'ies'));
    return notes.length ? ' Observed: ' + notes.join(' · ') + '.' : '';
  };
  const usagePromptFor = (session,point) => {
    const direct = point.userPrompt;
    const turn = Number.isFinite(point.turnIndex) ? session.dialogue?.turns?.find(candidate => candidate.index === point.turnIndex) : null;
    const prompt = direct ?? turn?.prompt?.text ?? (Number.isFinite(point.turnIndex) ? session.prompts?.find(candidate => candidate.turnIndex === point.turnIndex)?.text : null);
    const normalized = prompt == null ? '' : String(prompt).replace(/\s+/gu,' ').trim();
    return normalized || null;
  };
  const usagePointDetail = (point,prompt = point.userPrompt) => {
    const stamp = formatStamp(point.timestamp);
    const facts = [...(Number.isFinite(point.turnIndex) ? ['Turn ' + point.turnIndex] : []),'Response ' + point.index];
    if (stamp) facts.push(stamp + ' UTC');
    if (Number.isFinite(point.contextTokens)) facts.push(formatTokenCount(point.contextTokens) + ' context');
    if (Number.isFinite(point.contextDeltaTokens)) facts.push(formatSignedTokenCount(point.contextDeltaTokens));
    if (point.boundary === 'shrink') facts.push('context shrink/reset');
    if (point.boundary === 'model-change') facts.push('model boundary');
    const normalizedPrompt = prompt ? String(prompt).replace(/\s+/gu,' ').trim() : '';
    const promptDetail = normalizedPrompt || (Number.isFinite(point.turnIndex) || point.promptBoundary
      ? 'Linked prompt text was not retained'
      : 'No observed linked prompt');
    return { primary:promptDetail,secondary:facts.join(' · ') };
  };
  const usagePointAttributes = point => {
    const detail = usagePointDetail(point);
    return ' role="button" tabindex="0" aria-label="' + escape(detail.primary + '. ' + detail.secondary) + '" data-usage-chart-detail="' + escape(detail.primary) + '" data-usage-chart-secondary="' + escape(detail.secondary) + '"';
  };
  const USAGE_WINDOW_SIZE = 60;
  const USAGE_MIN_WINDOW_SIZE = 10;
  const usageExplorerState = session => {
    const points = sessionUsageReport(session).progression ?? [];
    const defaultSize = Math.min(USAGE_WINDOW_SIZE,points.length);
    const minSize = Math.min(USAGE_MIN_WINDOW_SIZE,points.length);
    const previous = state.usageExplorer.get(session.sessionId);
    const lastCycleBoundary = points.reduce((latest,point,index) => ['shrink','model-change'].includes(point.boundary) ? index : latest,-1);
    const lastCycleLength = lastCycleBoundary >= 0 ? points.length - lastCycleBoundary : 0;
    const defaultStart = lastCycleBoundary >= 0 && lastCycleLength >= minSize && lastCycleLength <= defaultSize ? lastCycleBoundary : points.length - defaultSize;
    let start = Math.max(0,Math.min(Math.max(0,points.length - minSize),Number.isInteger(previous?.start) ? previous.start : defaultStart));
    let end = Math.max(start,Math.min(points.length,Number.isInteger(previous?.end) ? previous.end : start + defaultSize));
    if (end - start < minSize) {
      if (start + minSize <= points.length) end = start + minSize;
      else start = Math.max(0,end - minSize);
    }
    const size = end - start;
    const maxStart = Math.max(0,points.length - size);
    const next = {
      start,
      end,
      selected:Number.isInteger(previous?.selected) && previous.selected >= -1 && previous.selected < points.length ? previous.selected : points.length - 1,
    };
    state.usageExplorer.set(session.sessionId,next);
    return { ...next,size,minSize,maxStart,points };
  };
  const usageTurnEntries = entries => {
    const turns = new Set();
    return entries.filter(entry => {
      if (Number.isFinite(entry.point.turnIndex)) {
        if (turns.has(entry.point.turnIndex)) return false;
        turns.add(entry.point.turnIndex);
        return true;
      }
      return Boolean(entry.point.promptBoundary);
    });
  };
  const usageSegments = points => {
    const segments = [];
    let current = [];
    points.forEach(entry => {
      if (entry.point.boundary === 'model-change' && current.length) {
        segments.push(current);
        current = [];
      }
      if (Number.isFinite(entry.point.contextTokens)) current.push(entry);
    });
    if (current.length) segments.push(current);
    return segments;
  };
  const usageStepPath = (segment,x,y) => segment.reduce((path,entry,index) => {
    const pointX = x(entry);
    const pointY = y(entry);
    return index === 0 ? 'M' + pointX + ' ' + pointY : path + ' H' + pointX + ' V' + pointY;
  },'');
  const usageBoundaryLabel = point => point.boundary === 'shrink' ? 'Context shrink/reset'
    : point.boundary === 'model-change' ? 'Model boundary'
      : point.boundary === 'baseline' ? 'Baseline' : 'Within context cycle';
  const usageReuseCompact = reuse => !reuse ? '—'
    : reuse.status === 'observed' && Number.isFinite(reuse.reusePercent) ? reuse.reusePercent + '% reused'
      : formatTokenCount(reuse.cacheReadTokens) + ' cached';
  const usageResponseDetailMarkup = (session,point) => {
    if (!point) return '<aside class="usage-response-detail" aria-live="polite"><strong>Response details</strong><p>Select a chart point to lock its bounded usage evidence.</p></aside>';
    const fact = (label,value) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>';
    const prompt = usagePromptFor(session,point);
    return '<aside class="usage-response-detail" aria-live="polite"><header><span>Response details</span><strong>Response ' + point.index + '</strong><small>' + escape(formatStamp(point.timestamp) ? formatStamp(point.timestamp) + ' UTC' : 'response time unavailable') + '</small></header><dl>'
      + fact('Context',Number.isFinite(point.contextTokens) ? formatTokenCount(point.contextTokens) : 'not observed')
      + fact('Δ context',Number.isFinite(point.contextDeltaTokens) ? formatSignedTokenCount(point.contextDeltaTokens) : 'not comparable')
      + fact('Output',Number.isFinite(point.outputTokens) ? formatTokenCount(point.outputTokens) : 'not observed')
      + fact('Input reuse',usageReuseCompact(point.cacheReuse))
      + fact('Boundary',usageBoundaryLabel(point))
      + '</dl>' + (prompt ? '<div class="usage-response-prompt"><span>Linked user prompt' + (Number.isFinite(point.turnIndex) ? ' · T' + point.turnIndex : '') + '</span><p title="' + escape(prompt) + '">' + escape(prompt) + '</p></div>' : '') + '<div class="usage-response-actions"><button type="button" data-usage-step="-1">Previous</button><button type="button" data-usage-step="1">Next</button></div></aside>';
  };
  const usageInspectStripMarkup = (entry,{ hovered = false,processedVisible = false } = {}) => {
    if (!entry) return '<div class="usage-inspect-strip empty" data-usage-inspect-strip aria-label="Hovered or selected response values"><p>Hover a response or use the arrow keys to inspect its values.</p></div>';
    const point = entry.point;
    const fact = (label,value) => '<span><small>' + escape(label) + '</small><strong>' + escape(value) + '</strong></span>';
    return '<div class="usage-inspect-strip' + (processedVisible ? ' with-processed' : '') + '" data-usage-inspect-strip data-usage-inspect-mode="' + (hovered ? 'hover' : 'selected') + '" data-usage-inspect-position="' + entry.position + '" aria-label="Hovered or selected response values">'
      + '<div class="usage-inspect-identity"><small>' + (hovered ? 'Hover' : 'Selected') + '</small><strong>Response ' + point.index + '</strong></div>'
      + fact('Time',formatStamp(point.timestamp) ? formatStamp(point.timestamp) + ' UTC' : '—')
      + fact('Context',Number.isFinite(point.contextTokens) ? formatTokenCount(point.contextTokens) : '—')
      + fact('Δ context',Number.isFinite(point.contextDeltaTokens) ? formatSignedTokenCount(point.contextDeltaTokens) : '—')
      + fact('Reuse',usageReuseCompact(point.cacheReuse))
      + (processedVisible ? fact('Processed',Number.isFinite(point.processedTokens) ? formatTokenCount(point.processedTokens) : '—') : '')
      + fact('Output',Number.isFinite(point.outputTokens) ? formatTokenCount(point.outputTokens) : '—')
      + '</div>';
  };
  const usageExplorerMarkup = session => {
    const usageReport = sessionUsageReport(session);
    const explorer = usageExplorerState(session);
    if (!explorer.points.length) return '<p class="usage-report-unavailable">Per-response context snapshots were not retained.</p>';
    const entries = explorer.points.map((point,position) => ({ point,position }));
    const visible = entries.slice(explorer.start,explorer.end);
    const numeric = entries.filter(entry => Number.isFinite(entry.point.contextTokens));
    const values = numeric.map(entry => entry.point.contextTokens);
    const overviewMin = values.length ? Math.min(...values) : 0;
    const overviewMax = values.length ? Math.max(...values) : 1;
    const overviewRange = Math.max(1,overviewMax - overviewMin);
    const focusValues = visible.map(entry => entry.point.contextTokens).filter(Number.isFinite);
    const focusMin = focusValues.length ? Math.min(...focusValues) : overviewMin;
    const focusMax = focusValues.length ? Math.max(...focusValues) : overviewMax;
    const focusRange = Math.max(1,focusMax - focusMin);
    const width = 960;
    const overviewHeight = 106;
    const focusHeight = 180;
    const padX = 28;
    const overviewTop = 34;
    const overviewBottom = 78;
    const focusTop = 30;
    const focusBottom = 132;
    const overviewX = entry => padX + (entry.position / Math.max(1,entries.length - 1)) * (width - padX * 2);
    const focusX = entry => padX + ((entry.position - explorer.start) / Math.max(1,visible.length - 1)) * (width - padX * 2);
    const overviewY = entry => overviewBottom - ((entry.point.contextTokens - overviewMin) / overviewRange) * (overviewBottom - overviewTop);
    const focusY = entry => focusBottom - ((entry.point.contextTokens - focusMin) / focusRange) * (focusBottom - focusTop);
    const overviewPaths = usageSegments(entries).filter(segment => segment.length > 1).map(segment => '<path class="usage-chart-line" d="' + usageStepPath(segment,overviewX,overviewY) + '"></path>').join('');
    const focusPaths = usageSegments(visible).filter(segment => segment.length > 1).map(segment => '<path class="usage-chart-line" d="' + usageStepPath(segment,focusX,focusY) + '"></path>').join('');
    const brushX = overviewX(entries[explorer.start]);
    const brushEnd = overviewX(entries[Math.min(entries.length - 1,explorer.end - 1)]);
    const promptEntries = usageTurnEntries(entries);
    const activePromptPosition = explorer.selected < 0 ? undefined : promptEntries.reduce((active,entry) => entry.position <= explorer.selected ? entry.position : active,undefined);
    const overviewTurns = promptEntries.map(entry => {
      const markerX = overviewX(entry);
      const label = Number.isFinite(entry.point.turnIndex) ? 'T' + entry.point.turnIndex : 'P';
      const chipWidth = Math.max(18,10 + label.length * 5);
      const halfWidth = chipWidth / 2;
      const chipX = Math.max(padX + halfWidth,Math.min(width - padX - halfWidth,markerX));
      const tooltipWidth = 250;
      const tooltipX = Math.max(padX,Math.min(width - padX - tooltipWidth,markerX - tooltipWidth / 2));
      const hitX = markerX - 11;
      const hitRight = markerX + 11;
      const detail = usagePointDetail(entry.point,usagePromptFor(session,entry.point));
      const selected = entry.position === activePromptPosition;
      return '<g class="usage-overview-turn-marker' + (selected ? ' selected' : '') + '" data-usage-overview-turn-marker data-usage-response-position="' + entry.position + '"><title>' + escape(detail.primary + '. ' + detail.secondary) + '</title><rect class="usage-overview-turn-hit" x="' + hitX + '" y="8" width="' + (hitRight - hitX) + '" height="44"></rect><line class="usage-overview-turn" x1="' + markerX + '" x2="' + markerX + '" y1="24" y2="78"></line><rect class="usage-overview-turn-chip" x="' + (chipX - halfWidth) + '" y="17" width="' + chipWidth + '" height="12" rx="2"></rect><text class="usage-overview-turn-label" x="' + chipX + '" y="26" text-anchor="middle">' + escape(label) + '</text><foreignObject class="usage-overview-prompt-tooltip" x="' + tooltipX + '" y="12" width="' + tooltipWidth + '" height="38"><div role="tooltip"><strong>' + escape(detail.primary) + '</strong><span>' + escape(detail.secondary) + '</span></div></foreignObject></g>';
    }).join('');
    const overviewEvents = entries.filter(entry => ['shrink','model-change'].includes(entry.point.boundary)).map(entry => '<path class="usage-overview-event boundary-' + entry.point.boundary + '" d="M' + overviewX(entry) + ' 82 l4 4 -4 4 -4 -4z"></path>').join('');
    const selectedEntry = entries[explorer.selected] ?? null;
    const selectedVisible = selectedEntry && selectedEntry.position >= explorer.start && selectedEntry.position < explorer.end;
    const crosshair = selectedVisible && Number.isFinite(selectedEntry.point.contextTokens)
      ? '<line class="usage-selection-line" x1="' + focusX(selectedEntry) + '" x2="' + focusX(selectedEntry) + '" y1="' + focusTop + '" y2="164"></line><circle class="usage-selection-point" cx="' + focusX(selectedEntry) + '" cy="' + focusY(selectedEntry) + '" r="5"></circle>' : '';
    const focusPoints = visible.map((entry,index) => {
      const markerX = focusX(entry);
      const markerY = Number.isFinite(entry.point.contextTokens) ? focusY(entry) : focusBottom;
      const previousX = index > 0 ? focusX(visible[index - 1]) : padX;
      const nextX = index < visible.length - 1 ? focusX(visible[index + 1]) : width - padX;
      const hitLeft = index > 0 ? (previousX + markerX) / 2 : padX;
      const hitRight = index < visible.length - 1 ? (markerX + nextX) / 2 : width - padX;
      return '<g class="usage-focus-point' + (entry.position === explorer.selected ? ' selected' : '') + '" data-usage-focus-point data-usage-response-position="' + entry.position + '" aria-hidden="true"><rect class="usage-focus-point-hit" x="' + hitLeft + '" y="8" width="' + Math.max(1,hitRight - hitLeft) + '" height="158"></rect><line class="usage-hover-line" x1="' + markerX + '" x2="' + markerX + '" y1="' + focusTop + '" y2="164"></line><circle class="usage-hover-point" cx="' + markerX + '" cy="' + markerY + '" r="5"></circle></g>';
    }).join('');
    const focusEvents = visible.filter(entry => ['shrink','model-change'].includes(entry.point.boundary)).map(entry => {
      const markerX = focusX(entry);
      const marker = entry.point.boundary === 'shrink' ? '<path class="usage-focus-event boundary-shrink" d="M' + markerX + ' 147 l4 4 -4 4 -4 -4z"></path>'
        : '<rect class="usage-focus-event boundary-model-change" x="' + (markerX - 4) + '" y="147" width="8" height="8"></rect>';
      return '<g aria-hidden="true">' + marker + '</g>';
    }).join('');
    const processedVisible = visible.some(entry => Number.isFinite(entry.point.processedTokens));
    const first = visible[0]?.point.index;
    const last = visible.at(-1)?.point.index;
    const timed = entries.filter(entry => formatStamp(entry.point.timestamp));
    const timeRange = timed.length > 1 ? formatStamp(timed[0].point.timestamp) + ' → ' + formatStamp(timed.at(-1).point.timestamp) + ' UTC' : 'Response timestamps unavailable';
    const hasWindowControls = entries.length > USAGE_WINDOW_SIZE;
    const promptLabel = promptEntries.length === 1 ? 'linked prompt' : 'linked prompts';
    const promptActions = '<div class="usage-overview-prompt-actions" aria-label="Linked prompt navigation">' + promptEntries.map(entry => {
      const label = Number.isFinite(entry.point.turnIndex) ? 'T' + entry.point.turnIndex : 'P';
      const detail = usagePointDetail(entry.point,usagePromptFor(session,entry.point));
      const selected = entry.position === activePromptPosition;
      return '<button' + (selected ? ' class="selected"' : '') + ' type="button" tabindex="-1" aria-pressed="' + selected + '" data-usage-response-position="' + entry.position + '" aria-label="' + escape(detail.primary + '. ' + detail.secondary) + '">' + escape(label) + '</button>';
    }).join('') + '</div>';
    const overviewMarkup = hasWindowControls
      ? '<div class="usage-overview"><div class="chart-toolbar"><span class="chart-basis">Overview · ' + entries.length + ' responses · ' + promptEntries.length + ' ' + promptLabel + '</span><span class="chart-range">' + escape(timeRange) + '</span></div><svg data-usage-overview-chart tabindex="' + (promptEntries.length ? '0' : '-1') + '" data-usage-prompt-count="' + promptEntries.length + '" viewBox="0 0 ' + width + ' ' + overviewHeight + '" role="group" aria-roledescription="Interactive context chart" aria-label="' + (promptEntries.length ? 'Complete retained context progression. Arrow keys select linked prompts.' : 'Complete retained context progression. No linked prompts were retained for keyboard navigation.') + '"><rect class="usage-overview-surface" data-usage-overview-surface x="' + padX + '" y="8" width="' + (width - padX * 2) + '" height="88"></rect><rect class="usage-overview-brush" x="' + brushX + '" y="8" width="' + Math.max(6,brushEnd - brushX) + '" height="88"></rect>' + overviewPaths + overviewTurns + overviewEvents + '<rect class="usage-overview-handle-hit start" data-usage-window-handle="start" x="' + (brushX - 11) + '" y="48" width="22" height="48"></rect><rect class="usage-overview-handle start" x="' + (brushX - 4) + '" y="52" width="8" height="44"></rect><rect class="usage-overview-handle-hit end" data-usage-window-handle="end" x="' + (brushEnd - 11) + '" y="48" width="22" height="48"></rect><rect class="usage-overview-handle end" x="' + (brushEnd - 4) + '" y="52" width="8" height="44"></rect><text x="' + padX + '" y="14">' + escape(formatTokenCount(overviewMax)) + '</text><text x="' + padX + '" y="102">' + escape(formatTokenCount(overviewMin)) + '</text></svg>' + promptActions + '</div>'
      + '<div class="usage-window-toolbar"><div class="usage-window-summary"><strong>Responses ' + first + '–' + last + '</strong><span>' + visible.length + ' of ' + entries.length + '</span></div><button type="button" data-usage-window-step="-1"' + (explorer.start === 0 ? ' disabled' : '') + '>Previous window</button><div class="usage-window-edge-controls"><label>Start<input type="range" min="0" max="' + Math.max(0,explorer.end - explorer.minSize) + '" value="' + explorer.start + '" data-usage-window-edge="start" aria-label="Visible response window start" aria-valuetext="Response ' + first + '"></label><label>End<input type="range" min="' + Math.min(entries.length,explorer.start + explorer.minSize) + '" max="' + entries.length + '" value="' + explorer.end + '" data-usage-window-edge="end" aria-label="Visible response window end" aria-valuetext="Response ' + last + '"></label></div><button type="button" data-usage-window-step="1"' + (explorer.end === entries.length ? ' disabled' : '') + '>Next window</button></div>'
      : '';
    return '<div class="usage-linked-explorer ' + (hasWindowControls ? 'has-window-controls' : 'short-session') + '" data-usage-explorer="' + escape(session.sessionId) + '">' + overviewMarkup
      + '<div class="usage-focus-layout"><div class="usage-context-chart"><div class="chart-toolbar"><span class="chart-basis">' + (hasWindowControls ? 'Focus · ' : '') + 'Responses ' + first + '–' + last + '</span><span class="chart-range">Hover for details · Arrow keys select · Esc clears</span></div><svg class="usage-focus-chart" data-usage-focus-surface tabindex="0" viewBox="0 0 ' + width + ' ' + focusHeight + '" role="group" aria-roledescription="Interactive context chart" aria-label="Context progression for responses ' + first + ' through ' + last + '"><rect class="usage-focus-surface" x="' + padX + '" y="8" width="' + (width - padX * 2) + '" height="158"></rect>' + [0,.5,1].map(ratio => { const lineY = focusTop + ratio * (focusBottom - focusTop); return '<line class="usage-chart-grid" x1="' + padX + '" x2="' + (width - padX) + '" y1="' + lineY + '" y2="' + lineY + '"></line>'; }).join('') + focusPaths + focusPoints + crosshair + focusEvents + '<text x="' + padX + '" y="' + (focusTop - 4) + '">' + escape(formatTokenCount(focusMax)) + '</text><text x="' + padX + '" y="172">' + escape(formatTokenCount(focusMin)) + '</text></svg><div class="usage-chart-legend"><span><i class="growth"></i>Context snapshot</span><span><i class="shrink"></i>Context shrink/reset</span><span><i class="boundary"></i>Model boundary</span></div>' + usageInspectStripMarkup(selectedEntry,{ processedVisible }) + '</div>' + usageResponseDetailMarkup(session,selectedEntry?.point) + '</div></div>';
  };
  const processingBreakdownMarkup = (usage,usageReport) => {
    if (!Number.isFinite(usageReport?.processedTokens)) return '';
    const buckets = [
      ['cache-read','Cache read',usage?.cacheReadInputTokens],
      ['cache-write','Cache creation',usage?.cacheCreationInputTokens],
      ['input','Uncached input',usage?.inputTokens],
      ['output','Output',usage?.outputTokens],
    ].filter(([_kind,_label,value]) => Number.isFinite(value) && value > 0);
    const total = usageReport.processedTokens;
    const bar = buckets.length ? '<div class="usage-processing-bar" role="img" aria-label="Derived processed-token breakdown">' + buckets.map(([kind,label,value]) => '<i class="bucket-' + kind + '" style="flex-grow:' + value + '" title="' + escape(label + ': ' + formatTokenCount(value)) + '"></i>').join('') + '</div>' : '';
    return '<section class="usage-report-section"><header><div><h4>Session processing breakdown</h4><p>Additive input buckets and output across unique model responses; this is derived usage, not provider total or cost.</p></div><strong>' + formatTokenCount(total) + ' processed</strong></header>' + bar + '<ul class="usage-processing-list">' + buckets.map(([kind,label,value]) => '<li><i class="bucket-' + kind + '"></i><span>' + escape(label) + '</span><strong>' + formatTokenCount(value) + '</strong><small>' + (Math.round((value / total) * 1000) / 10) + '%</small></li>').join('') + '</ul></section>';
  };
  const usageContextMarkup = session => {
    const usage = session.tokenUsage;
    const context = usageContextPresentation(session);
    const usageReport = sessionUsageReport(session);
    const freshness = usageSnapshotFreshness(session);
    const cacheReuse = session.cacheReuse;
    const metrics = [];
    if (Number.isFinite(usageReport.currentContextTokens)) metrics.push([formatTokenCount(usageReport.currentContextTokens),'Latest observed context']);
    else if (context.hasPercentFull) metrics.push([context.percentFull + '%','Latest observed occupancy']);
    if (cacheReuse) metrics.push([cacheReuse.status === 'observed' ? cacheReuse.reusePercent + '%' : formatTokenCount(cacheReuse.cacheReadTokens),'Input reused']);
    metrics.push([Number.isFinite(usageReport.processedTokens) ? formatTokenCount(usageReport.processedTokens) : 'not derived','Session processed']);
    if (usageReport.actualModelCalls > 0) metrics.push([String(usageReport.actualModelCalls),'Model calls']);
    const contextMarkup = context.hasContextWindow ? contextBarMarkup(context,context.percentFull + '% of the observed context window is full')
      : context.hasPercentFull ? occupancyBarMarkup(context.percentFull,context.percentFull + '% context occupancy observed; window size unavailable') : '';
    const net = Number.isFinite(usageReport.netContextDeltaTokens) ? ' · ' + formatSignedTokenCount(usageReport.netContextDeltaTokens) + ' net' : '';
    const boundary = context.hasContextWindow ? formatTokenCount(context.usedTokens) + ' / ' + formatTokenCount(context.windowTokens) + ' · ' + context.percentFull + '% full' + net
      : context.hasPercentFull ? 'Context window size unavailable'
        : context.hasUsedTokens ? 'Context window and token categories unavailable' : 'Context evidence unavailable';
    const diagnostics = usageReport.duplicateRecordsCollapsed > 0 ? '<p class="usage-summary-diagnostics">' + usageReport.duplicateRecordsCollapsed + ' duplicate record' + (usageReport.duplicateRecordsCollapsed === 1 ? '' : 's') + ' collapsed' + (usageReport.conflictingDuplicateRecords > 0 ? ' · ' + usageReport.conflictingDuplicateRecords + ' conflict' + (usageReport.conflictingDuplicateRecords === 1 ? '' : 's') : '') + '</p>' : '';
    return '<section class="session-usage-summary" aria-labelledby="session-usage-summary-title"><header class="session-usage-head"><div><h3 id="session-usage-summary-title">Usage and context</h3><span>'
      + escape(usage?.coverage ?? session.contextManifest?.status ?? 'unobserved') + '</span></div><button class="usage-report-link" type="button" data-open-usage-report>View report</button></header>'
      + '<p class="usage-summary-freshness">' + escape(freshness.note) + '</p>'
      + '<dl class="usage-summary-metrics">' + metrics.map(([value,label]) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>').join('') + '</dl>'
      + contextMarkup + '<p class="usage-summary-boundary">' + escape(boundary) + '</p>' + cacheReuseSummaryMarkup(cacheReuse) + diagnostics + '</section>';
  };
  const usageReportMarkup = session => {
    const usage = session.tokenUsage;
    const context = usageContextPresentation(session);
    const usageReport = sessionUsageReport(session);
    const freshness = usageSnapshotFreshness(session);
    const cacheReuse = session.cacheReuse;
    const runtime = session.runtime;
    const compactionCount = Number(session.contextManifest?.compactionCount) || 0;
    const compactionSnapshots = (session.contextManifest?.compactionEvents ?? [])
      .filter(event => Number.isFinite(Number(event?.contextTokens)))
      .map(event => ({
        timestamp: event.timestamp,
        contextTokens: Math.max(0,Math.round(Number(event.contextTokens))),
        contextSnapshotTimestamp: event.contextSnapshotTimestamp,
      }));
    const showCompactionSnapshots = compactionSnapshots.length > 0 && context.hasUsedTokens;
    const compactionNote = compactionCount > 0 ? ' Provider reported ' + compactionCount + ' compaction boundar' + (compactionCount === 1 ? 'y' : 'ies') + '.' : '';
    const contextBoundaryBadge = compactionCount > 0
      ? compactionCount + ' compaction' + (compactionCount === 1 ? '' : 's')
      : usageReport.contextResetCount > 0 ? usageReport.contextResetCount + ' reset' + (usageReport.contextResetCount === 1 ? '' : 's') : '';
    const contextBoundaryTitle = compactionCount > 0
      ? 'Provider reported ' + compactionCount + ' compaction boundar' + (compactionCount === 1 ? 'y' : 'ies')
      : usageReport.contextResetCount > 0 ? usageReport.contextResetCount + ' observed context shrink/reset' + (usageReport.contextResetCount === 1 ? '' : 's') : '';
    const compactionSnapshotTitle = compactionSnapshots.length > 0
      ? compactionSnapshots.map(event => formatShortClock(event.timestamp) + ' UTC · ' + formatTokenCount(event.contextTokens) + ' context at latest observed snapshot' + (event.contextSnapshotTimestamp ? ' (' + formatShortClock(event.contextSnapshotTimestamp) + ' UTC)' : '')).join('\n')
      : contextBoundaryTitle;
    const compactionHistoryValue = compactionSnapshots.map(event => formatTokenCount(event.contextTokens)).join(' + ');
    const fact = (label,value) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>';
    const inputLabel = usage?.cacheAccountingMode === 'included-in-input' ? 'Total input (includes cached)'
      : usage?.cacheAccountingMode === 'separate-input-lane' ? 'Uncached input' : 'Input (cache relationship unknown)';
    const accounting = [['Provider total',usage?.totalTokens],[inputLabel,usage?.inputTokens],['Output',usage?.outputTokens],['Cached input read',usage?.cacheReadInputTokens],['Cache creation',usage?.cacheCreationInputTokens],['Reasoning',usage?.reasoningOutputTokens]]
      .map(([label,value]) => fact(label,formatObservedTokenCount(value))).join('');
    const occupancyBar = context.hasContextWindow ? contextBarMarkup(context,context.percentFull + '% of the observed context window is full')
      : context.hasPercentFull ? occupancyBarMarkup(context.percentFull,context.percentFull + '% context occupancy observed; window size unavailable') : '';
    const occupancyHeading = '<span>' + (showCompactionSnapshots ? 'Current + historical compaction snapshots' : 'Latest observed context') + '</span>' + (contextBoundaryBadge ? '<em class="usage-summary-compactions" title="' + escape(compactionSnapshotTitle) + '">' + escape(contextBoundaryBadge) + '</em>' : '');
    const occupancyValue = value => '<div class="usage-context-values"><strong class="usage-context-current">' + escape(value) + '</strong>' + (showCompactionSnapshots ? '<span class="usage-context-plus" aria-hidden="true">+</span><strong class="usage-context-history" title="' + escape(compactionSnapshotTitle) + '">' + escape(compactionHistoryValue) + '</strong>' : '') + '</div>';
    const occupancy = context.hasContextWindow
      ? occupancyValue(formatTokenCount(usageReport.currentContextTokens ?? context.usedTokens)) + '<div class="usage-summary-tile-heading">' + occupancyHeading + '</div><small>' + formatTokenCount(context.usedTokens) + ' / ' + formatTokenCount(context.windowTokens) + ' · ' + context.percentFull + '% full</small><p class="usage-report-freshness">' + escape(freshness.note) + '</p>' + occupancyBar
      : context.hasPercentFull
        ? occupancyValue(context.percentFull + '%') + '<div class="usage-summary-tile-heading">' + occupancyHeading + '</div><small>Window size not observed</small><p class="usage-report-freshness">' + escape(freshness.note) + '</p>' + occupancyBar
        : context.hasUsedTokens
          ? occupancyValue(formatTokenCount(usageReport.currentContextTokens ?? context.usedTokens)) + '<div class="usage-summary-tile-heading">' + occupancyHeading + '</div><small>Context window not observed</small><p class="usage-report-freshness">' + escape(freshness.note) + '</p>'
          : occupancyValue('—') + '<div class="usage-summary-tile-heading"><span>Occupancy unavailable</span></div><small>No observed context evidence</small><p class="usage-report-freshness">' + escape(freshness.note) + '</p>';
    const reuseDetail = cacheReuse?.status === 'observed' && Number.isFinite(cacheReuse.promptInputTokens)
      ? formatTokenCount(cacheReuse.cacheReadTokens) + ' cached · ' + formatTokenCount(cacheReuse.uncachedInputTokens) + ' uncached'
      : cacheReuse ? formatTokenCount(cacheReuse.cacheReadTokens) + ' cached · rate unavailable' : 'No observed cache evidence';
    const reuseTile = '<div class="usage-report-reuse-tile"><dt>Input reused</dt><dd><strong>'
      + escape(cacheReuse ? (cacheReuse.status === 'observed' ? cacheReuse.reusePercent + '%' : 'rate unavailable') : 'not observed')
      + '</strong>' + (cacheReuse ? cacheReuseBarMarkup(cacheReuse) : '') + '<small>' + escape(reuseDetail) + '</small></dd></div>';
    const duplicateEvidence = usageReport.duplicateRecordsCollapsed > 0
      ? fact('Duplicates collapsed',String(usageReport.duplicateRecordsCollapsed)) + fact('Conflicting duplicates',String(usageReport.conflictingDuplicateRecords ?? 0))
      : '';
    const evidenceProvider = runtime?.modelProvider ?? session.platform ?? 'not observed';
    const evidenceContextBasis = session.contextManifest?.basis ?? 'not observed';
    const evidenceSource = usage?.source ?? session.contextManifest?.source ?? 'not observed';
    const evidenceGroup = (label,facts) => '<div class="usage-evidence-group"><strong class="usage-evidence-group-title">' + escape(label) + '</strong><dl class="usage-report-facts">' + facts + '</dl></div>';
    const evidenceCoverage = usage?.coverage ?? session.contextManifest?.status ?? 'unobserved';
    const evidenceDetails = '<details class="usage-report-evidence"><summary><span>Evidence &amp; methodology</span><small>Runtime, provenance, accounting basis, and static-snapshot boundaries</small></summary><div class="usage-evidence-groups">'
      + evidenceGroup('Observability',fact('Coverage',evidenceCoverage) + fact('Snapshot',freshness.evidence) + fact('Time basis',session.timestampBasis ?? 'unobserved') + fact('Raw context','omitted'))
      + evidenceGroup('Runtime',fact('Provider',evidenceProvider) + fact('Effort',runtime?.effort ?? 'not observed') + fact('CLI',runtime?.cliVersion ?? 'not observed'))
      + evidenceGroup('Accounting',fact('Context basis',evidenceContextBasis) + fact('Processed basis',usageReport.processedTokensBasis ?? 'not derived') + (usageReport.processedCoverage ? fact('Processed coverage',usageReport.processedCoverage) : ''))
      + evidenceGroup('Provenance',fact('Evidence source',evidenceSource) + duplicateEvidence)
      + '</div></details>';
    const structureLayers = (session.contextManifest?.layers ?? []).filter(layer => Number.isFinite(layer.itemCount) && layer.itemCount > 0);
    const structureTotal = structureLayers.reduce((sum,layer) => sum + layer.itemCount,0);
    const structure = structureLayers.length
      ? '<ul class="usage-structure-list count-only" aria-label="Context structure by observed item count: ' + structureTotal + ' items across ' + structureLayers.length + ' layers">' + structureLayers.map(layer => '<li><span>' + escape(layer.kind) + '</span><strong>×' + layer.itemCount + '</strong><small>' + escape(layer.kind + ': ' + layer.itemCount + ' item' + (layer.itemCount === 1 ? '' : 's')) + '</small></li>').join('') + '</ul>'
      : '<p class="usage-report-unavailable">Context-layer counts were not observed.</p>';
    return '<section class="session-mode-panel usage-report" aria-label="Usage report" data-session-mode-panel="usage" hidden>'
      + '<header class="usage-report-lead"><div class="usage-report-heading"><h3>Usage report</h3><p>Latest observed Context Window, freshness, and progression for this retained Session.</p></div><aside class="usage-report-summary" aria-label="Session usage summary"><div class="usage-report-occupancy">' + occupancy + '</div><dl class="usage-report-lead-facts">' + reuseTile + fact('Baseline context',Number.isFinite(usageReport.baselineContextTokens) ? formatTokenCount(usageReport.baselineContextTokens) : 'not observed') + fact('Net vs baseline',Number.isFinite(usageReport.netContextDeltaTokens) ? formatSignedTokenCount(usageReport.netContextDeltaTokens) : 'not comparable') + fact('Session processed',Number.isFinite(usageReport.processedTokens) ? formatTokenCount(usageReport.processedTokens) : 'not derived') + fact('Model calls',usageReport.actualModelCalls ? String(usageReport.actualModelCalls) : 'not observed') + '</dl></aside><p class="usage-report-context-note">Cached input still occupies context. Provider caching can reduce cost or latency, but this report does not estimate savings.</p></header>'
      + evidenceDetails
      + '<section class="usage-report-section"><header><div><h4>Context progression</h4><p>Absolute prompt snapshots across unique model responses. Deltas are net context change, not consumption.' + escape(progressionBoundaryNote(usageReport) + compactionNote) + '</p></div><strong>' + usageReport.actualModelCalls + ' unique calls</strong></header>' + usageExplorerMarkup(session) + '</section>'
      + processingBreakdownMarkup(usage,usageReport)
      + '<div class="usage-report-columns"><section class="usage-report-section"><header><div><h4>Provider accounting</h4><p>Observed provider counters. Labels preserve whether cached input is included or reported as a separate lane.</p></div></header><dl class="usage-report-facts">' + accounting + '</dl></section>'
      + '<section class="usage-report-section usage-structure-section"><header><div><h4>Context structure</h4><p>Observed layer item counts. Per-layer token sizes were not retained, so K values cannot be derived. Prompt text remains omitted.</p></div>' + (structureLayers.length ? '<strong>' + structureTotal + ' items · token sizes unavailable</strong>' : '') + '</header>' + structure + '</section></div></section>';
  };
  const evidence = (kind, label = kind) => '<span class="evidence ' + escape(kind) + '">' + escape(label) + '</span>';
  const isDirectCommitLink = link => link?.evidenceKind === 'explicit' || link?.evidenceKind === 'observed-commit';
  // Colour lives in workbench.css. The chart and the call list read the same
  // family and state custom properties so nothing forks a second palette.
  const FAMILY_KEYS = new Set(['inspect','change','execute','verify','coordinate','deliver','other']);
  const familyColor = family => 'var(--family-' + (FAMILY_KEYS.has(family) ? family : 'other') + ')';
  const FAILED_COLOR = 'var(--color-danger)';

  // Turn vocabulary comes from one projected object so the workbench lane, the
  // Session View titlebar, and the filter counts can never disagree.
  function turnCoverageOf(session) {
    return session?.turnCoverage ?? { turnCount:session?.dialogue?.turns?.length ?? 0, shownPromptCount:session?.prompts?.length ?? 0, normalizedUserTurnCount:0, observationCount:0, truncated:false };
  }

  function coverageLabel(session) {
    if (!session) return 'no linked session';
    const coverage = turnCoverageOf(session);
    const turns = coverage.turnCount + ' turn' + (coverage.turnCount === 1 ? '' : 's');
    return coverage.truncated ? coverage.shownPromptCount + ' of ' + turns + ' shown' : turns;
  }

  function coverageTitle(session) {
    const coverage = turnCoverageOf(session);
    return coverage.turnCount + ' dialogue turns · ' + coverage.normalizedUserTurnCount
      + ' normalized user turns · ' + coverage.observationCount + ' raw prompt observations. Open Session View for every turn.';
  }

  function descendantStories(nodeId) {
    const node = byNode.get(nodeId);
    if (!node) return [];
    if (node.type === "story") return [byStory.get(node.id)].filter(Boolean);
    const result = [];
    const queue = [...node.children];
    while (queue.length) {
      const child = byNode.get(queue.shift());
      if (!child) continue;
      if (child.type === "story") result.push(byStory.get(child.id));
      queue.push(...child.children);
    }
    return result.filter(Boolean);
  }

  function scopedItems() {
    if (state.mode === "date") {
      const day = report.days.find(item => item.date === state.scope);
      const rows = (day?.sessionIds ?? []).map(sessionId => ({ story:null, session:bySession.get(sessionId), link:{ evidenceKind:"contextual", confidence:"date" }, date:day })).filter(item => item.session);
      const sessionLinked = new Set(rows.flatMap(row => row.session.commitLinks.filter(link => isDirectCommitLink(link) && byCommit.get(link.hash)?.day === day?.date).map(link => link.hash)));
      const unassignedCommitHashes = (day?.commitHashes ?? []).filter(hash => !sessionLinked.has(hash));
      if (unassignedCommitHashes.length) rows.push({ story:null, session:null, link:{ evidenceKind:"contextual", confidence:"date" }, date:day, unassignedCommitHashes });
      return rows;
    }
    const stories = descendantStories(state.scope);
    const rows = [];
    for (const story of stories) {
      if (!story.sessionLinks.length) rows.push({ story, session:null, link:{ evidenceKind:story.evidence, confidence:"tree" }, date:null });
      for (const link of story.sessionLinks) rows.push({ story, session:bySession.get(link.sessionId) ?? null, link, date:null });
    }
    return rows;
  }

  function commitsFor(item) {
    const hashes = new Set(item.story?.commitHashes ?? []);
    for (const link of item.session?.commitLinks ?? []) {
      if (!item.date || (isDirectCommitLink(link) && byCommit.get(link.hash)?.day === item.date.date)) hashes.add(link.hash);
    }
    for (const hash of item.unassignedCommitHashes ?? []) hashes.add(hash);
    return [...hashes].map(hash => byCommit.get(hash)).filter(Boolean).sort((a,b) => String(b.committedAt).localeCompare(String(a.committedAt)));
  }

  function itemTitle(item) {
    const session = item.session;
    return item.story?.title
      ?? (item.date ? (session?.prompts?.[0]?.text ?? session?.locator ?? 'Commits without a linked session') : ('Activity on ' + (session?.day ?? 'unknown date')));
  }

  function promptLane(item) {
    const session = item.session;
    const prompts = session?.prompts ?? [];
    const declaredPrompt = item.story?.refs?.prompts?.[0];
    const cards = [];
    if (declaredPrompt) cards.push('<div class="intent-card declared-intent"><p>' + escape(declaredPrompt) + '</p><small>Feature Tree intent · ' + escape(item.story.evidence) + '</small></div>');
    prompts.forEach(prompt => {
      // Retained prompts are capped and de-duplicated upstream, so the card
      // links to the Turn the projection resolved, never to its array index.
      const turnIndex = Number.isInteger(prompt.turnIndex) ? prompt.turnIndex : null;
      const label = turnIndex ? 'User turn ' + turnIndex : 'Retained prompt';
      cards.push('<div class="intent-card"><p>' + escape(prompt.text) + '</p><small>' + escape(label) + (prompt.timestamp ? ' · ' + escape(formatClock(prompt.timestamp)) : '') + '</small></div>');
    });
    const coverage = turnCoverageOf(session);
    const more = session && coverage.truncated
      ? '<button type="button" class="lane-more" data-open-session-for="' + escape(session.sessionId) + '">Open Session View for all ' + coverage.turnCount + ' turns</button>'
      : '';
    return '<section class="lane prompt-lane' + (cards.length ? '' : ' lane-empty') + '"><div class="lane-title"><strong>User prompts</strong><span title="' + escape(coverageTitle(session)) + '">' + escape(coverageLabel(session)) + '</span></div>' + (cards.join("") || '<div class="empty-state">No retained privacy-safe user turn for this scope.</div>') + more + '</section>';
  }

  function activityLane(item) {
    const session = item.session;
    if (!session) return '<section class="lane activity-lane lane-empty"><div class="lane-title"><strong>Normalized activity</strong><span>0 calls</span></div><div class="empty-state">A session link is required before activity can be inspected.</div></section>';
    const activity = session.toolActivity;
    if (!activity.totalCalls) return '<section class="lane activity-lane lane-empty"><div class="lane-title"><strong>Checkpoint activity</strong><span>0 calls</span></div><div class="empty-state">No normalized tool call was retained for this session.</div></section>';
    const actionCounts = new Map();
    const actionFamily = new Map();
    activity.calls.forEach(call => {
      actionCounts.set(call.actionLabel,(actionCounts.get(call.actionLabel) ?? 0) + 1);
      if (!actionFamily.has(call.actionLabel)) actionFamily.set(call.actionLabel,call.family);
    });
    const rankedActions = [...actionCounts.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0,6);
    const max = Math.max(...rankedActions.map(([,count]) => count),1);
    const bars = rankedActions.map(([actionLabel,count]) => {
      const tone = familyColor(actionFamily.get(actionLabel));
      return '<div class="family-row"><span title="' + escape(actionLabel) + '"><i class="family-dot" style="background:' + tone + '"></i>' + escape(actionLabel) + '</span><div class="family-track"><div class="family-fill" style="width:' + Math.max(2,(count/max)*100) + '%;background:' + tone + '"></div></div><strong>' + count + '</strong></div>';
    }).join("");
    const span = activity.timeline?.spanMs;
    const spanCopy = Number.isFinite(span) && span > 0 ? ' · ' + formatSpan(span) + ' span' : '';
    const directCommits = commitsFor(item).filter(commit => isDirectCommitLink(session.commitLinks.find(link => link.hash === commit.hash)));
    const directLinks = directCommits.map(commit => session.commitLinks.find(link => link.hash === commit.hash)).filter(Boolean);
    const linkedEditCallIds = new Set(directLinks.flatMap(link => link.linkedEditCallIds ?? []));
    const linkedEditFiles = new Set(directLinks.flatMap(link => link.linkedEditFiles ?? []));
    const committedPaths = new Set(directCommits.flatMap(commit => commit.files.map(file => file.path)));
    const pathSummary = activity.files.length + ' tool-attributed path' + (activity.files.length === 1 ? '' : 's')
      + (directCommits.length ? ' · ' + committedPaths.size + ' committed path' + (committedPaths.size === 1 ? '' : 's') : '');
    const commitBridge = linkedEditCallIds.size > 0
      ? '<p class="commit-bridge linked">' + directCommits.length + ' commit' + (directCommits.length === 1 ? '' : 's') + ' linked to ' + linkedEditCallIds.size + ' observed Edit/Write call' + (linkedEditCallIds.size === 1 ? '' : 's') + ' across ' + linkedEditFiles.size + ' exact changed path' + (linkedEditFiles.size === 1 ? '' : 's') + ' before the commit.</p>'
      : directCommits.length
        ? '<p class="commit-bridge">' + directCommits.length + ' commit' + (directCommits.length === 1 ? ' was' : 's were') + ' created in this session, but no Edit/Write path was observed before the commit. The files may have entered the session as existing workspace changes.</p>'
        : '';
    return '<section class="lane activity-lane"><div class="lane-title"><strong>Checkpoint activity</strong><span>' + pathSummary + '</span></div><div class="activity-summary"><div class="activity-total"><strong>' + activity.totalCalls + '</strong><span>calls · ' + activity.failedCalls + ' failed' + escape(spanCopy) + '</span></div><div class="family-bars">' + bars + '</div></div>' + commitBridge + '<details class="activity-details" data-activity-session="' + escape(session.sessionId) + '"><summary><span>Expand ' + activity.totalCalls + ' normalized actions</span><span class="activity-disclosure-actions"><button type="button" class="activity-action primary" data-open-session-for="' + escape(session.sessionId) + '">Open session</button><small>focus view</small></span></summary><div class="trace-target" data-activity-chart="' + escape(session.sessionId) + '"></div></details></section>';
  }

  function diffStats(change, label = 'File') {
    const added = Number.isFinite(change.added) ? '<span class="diff-add" aria-label="' + escape(label) + ': ' + change.added + ' lines added">+' + change.added + '</span>' : '';
    const removed = Number.isFinite(change.removed) ? '<span class="diff-remove" aria-label="' + escape(label) + ': ' + change.removed + ' lines removed">-' + change.removed + '</span>' : '';
    return '<span class="diff-stat">' + (added || removed ? added + removed : '<span class="diff-binary">binary</span>') + '</span>';
  }

  function fileRow(file, display = file.path) {
    return '<div class="file-row" title="' + escape(file.path) + '"><code>' + escape(display) + '</code>' + diffStats(file,file.path) + '</div>';
  }

  function flatFileList(commit) {
    return commit.files.map(file => fileRow(file)).join('');
  }

  function buildDirectoryTree(files) {
    const root = { path:'', directories:new Map(), files:[], fileCount:0 };
    for (const file of files) {
      const parts = file.path.split('/');
      const name = parts.pop() || file.path;
      let directory = root;
      directory.fileCount += 1;
      for (const segment of parts) {
        if (!directory.directories.has(segment)) {
          const path = directory.path ? directory.path + '/' + segment : segment;
          directory.directories.set(segment,{ name:segment, path, directories:new Map(), files:[], fileCount:0 });
        }
        directory = directory.directories.get(segment);
        directory.fileCount += 1;
      }
      directory.files.push({ ...file, name });
    }
    return root;
  }

  function directoryTreeMarkup(directory) {
    const childDirectories = [...directory.directories.values()]
      .sort((left,right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      .map(child => '<details class="file-tree-node" open><summary><span class="file-tree-chevron" aria-hidden="true">›</span><span class="file-tree-folder" title="' + escape(child.path) + '">' + escape(child.name) + '</span><small>' + child.fileCount + '</small></summary><div class="file-tree-children">' + directoryTreeMarkup(child) + '</div></details>')
      .join('');
    const childFiles = [...directory.files]
      .sort((left,right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      .map(file => fileRow(file,file.name))
      .join('');
    return childDirectories + childFiles;
  }

  function commitFileViewMarkup(commit, view) {
    if (!commit.files.length) return '<div class="empty-state">No changed paths retained.</div>';
    return view === 'tree'
      ? '<div class="commit-file-view file-tree-view" data-file-view-panel="tree">' + directoryTreeMarkup(buildDirectoryTree(commit.files)) + '</div>'
      : '<div class="commit-file-view file-list-view" data-file-view-panel="list">' + flatFileList(commit) + '</div>';
  }

  function commitFileViewKey(item) {
    return [state.mode,state.scope,item.story?.id ?? '',item.session?.sessionId ?? '',item.date ?? ''].join(':');
  }

  function commitLaneContext(item, commit) {
    const link = item.session?.commitLinks?.find(candidate => candidate.hash === commit.hash) ?? null;
    const kind = link?.evidenceKind ?? (item.story?.commitHashes?.includes(commit.hash) ? item.story.evidence : 'contextual');
    return { link, kind, compact:defaultCompactCommitKinds.has(kind) };
  }

  function deliveryLane(item, commits) {
    const fileViewKey = commitFileViewKey(item);
    const fileView = state.commitFileViews.get(fileViewKey) ?? 'list';
    const commitContexts = commits.map(commit => ({ commit, ...commitLaneContext(item,commit) }));
    const compactCount = commitContexts.filter(context => context.compact).length;
    const cards = commitContexts.map(({ commit, link, kind, compact }) => {
      const label = kind === 'file-context' ? 'same-file history' : kind === 'observed-overlap' ? 'observed same-path' : kind === 'observed-commit' ? 'created in session' : kind;
      const relation = link ? (link.evidenceKind === 'file-context' ? ' · same-file context' : link.evidenceKind === 'observed-commit' ? ' · observed commit action' : ' · ' + escape(link.confidence) + ' correlation') : '';
      const stats = commit.fileCount + ' files · ' + diffStats({ added:commit.linesAdded, removed:commit.linesRemoved },'Commit') + relation;
      const files = '<div class="commit-files">' + commitFileViewMarkup(commit,fileView) + '</div>';
      if (compact) {
        return '<details class="commit-card commit-card-compact" data-commit-hash="' + escape(commit.hash) + '"><summary class="commit-head"><div class="commit-head-line compact"><span class="commit-chevron" aria-hidden="true">›</span><code>' + escape(commit.shortHash) + '</code><span class="commit-subject" title="' + escape(commit.subject) + '">' + escape(commit.subject) + '</span><span class="commit-stats">' + stats + '</span>' + evidence(kind,label) + '</div></summary>' + files + '</details>';
      }
      return '<details class="commit-card commit-card-expanded" data-commit-hash="' + escape(commit.hash) + '" open><summary class="commit-head"><div class="commit-head-line"><span class="commit-id"><span class="commit-chevron" aria-hidden="true">›</span><code>' + escape(commit.shortHash) + '</code></span>' + evidence(kind,label) + '</div><p>' + escape(commit.subject) + '</p><div class="commit-stats">' + stats + '</div></summary>' + files + '</details>';
    }).join('');
    if (!commits.length) return '<section class="lane delivery-lane lane-empty"><div class="lane-title"><div class="delivery-title-copy"><strong>Commits / files</strong><span>0 commits</span></div></div><div class="empty-state">No commit is linked to this session or Story.</div></section>';
    const compactLabel = compactCount ? ' · ' + compactCount + ' compact' : '';
    const viewSwitch = '<div class="file-view-switch" role="group" aria-label="Commit file view">'
      + '<button type="button" data-commit-file-view="list" aria-pressed="' + String(fileView === 'list') + '">List</button>'
      + '<button type="button" data-commit-file-view="tree" aria-pressed="' + String(fileView === 'tree') + '">Tree</button>'
      + '</div>';
    return '<section class="lane delivery-lane" data-file-view="' + fileView + '" data-file-view-key="' + escape(fileViewKey) + '"><div class="lane-title"><div class="delivery-title-copy"><strong>Commits / files</strong><span>' + commits.length + ' commits' + compactLabel + '</span></div><div class="delivery-actions">' + viewSwitch + '<button class="delivery-toggle" data-toggle-delivery aria-expanded="true" aria-label="Collapse commits and files"><span class="open-label">Hide</span><span class="closed-label">Show files</span></button></div></div><div class="delivery-content" tabindex="0" aria-label="Changed files">' + cards + '</div></section>';
  }

  function setDeliveryCollapsed(workbench, collapsed) {
    if (!workbench) return;
    workbench.classList.toggle('delivery-collapsed',collapsed);
    const toggle = workbench.querySelector('[data-toggle-delivery]');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.setAttribute('aria-label',collapsed ? 'Expand commits and files' : 'Collapse commits and files');
  }

  function workbench(item,index) {
    const commits = commitsFor(item);
    const session = item.session;
    const title = itemTitle(item);
    const contextSummary = session ? sessionContextSnapshotPresentation(session) : null;
    const contextMeta = contextSummary?.compact ? '<span class="workbench-token-summary" title="' + escape(contextSummary.title) + '">' + escape(contextSummary.compact) + '</span>' : '';
    const sessionMeta = session
      ? '<span class="workbench-provider">' + escape(session.platform) + '</span><span>' + escape(formatClock(session.firstSeen)) + '</span><span class="workbench-duration">' + escape(formatDuration(session.durationMs)) + '</span>' + contextMeta
      : '<span>' + (item.date ? 'Unlinked commits' : 'No linked session') + '</span>';
    const sessionAction = session ? '<button class="prepare-button" data-open-session="' + escape(session.sessionId) + '">Open session</button>' : '';
    // The title identifies the session; explicit commands own all navigation.
    const header = '<div class="workbench-title-line"><div class="workbench-meta" title="' + escape(session?.locator ?? '') + '">' + sessionMeta + '</div><h3 title="' + escape(title) + '">' + escape(title) + '</h3></div>';
    const collapsed = state.collapsedCards.has(index);
    const collapseToggle = '<button class="card-collapse" type="button" data-toggle-card="' + index + '" aria-expanded="' + String(!collapsed) + '" aria-label="' + (collapsed ? 'Expand' : 'Collapse') + ' this workbench">' + (collapsed ? '+' : '−') + '</button>';
    return '<article class="workbench' + (collapsed ? ' card-collapsed' : '') + '" id="workbench-card-' + index + '" data-workbench="' + index + '"><header class="workbench-head">' + header + '<div class="head-actions">' + sessionAction + collapseToggle + '</div></header><div class="workbench-grid">' + promptLane(item) + '<div class="lane-resizer prompt" data-resize-lane="prompt" role="separator" aria-orientation="vertical" aria-label="Resize prompt and activity lanes" tabindex="0"></div>' + activityLane(item) + '<div class="lane-resizer delivery" data-resize-lane="delivery" role="separator" aria-orientation="vertical" aria-label="Resize activity and delivery lanes" tabindex="0"></div>' + deliveryLane(item,commits) + '</div></article>';
  }

  // ---------------------------------------------------------------- activity chart

  function chartLanes(activity, maxLanes = 7) {
    const counts = new Map();
    const firstStep = new Map();
    for (const call of activity.calls) {
      const label = String(call.actionLabel ?? call.toolName ?? 'Use tool');
      counts.set(label,(counts.get(label) ?? 0) + 1);
      if (!firstStep.has(label)) firstStep.set(label,call.step);
    }
    const ranked = [...counts.keys()].sort((left,right) => counts.get(right) - counts.get(left) || firstStep.get(left) - firstStep.get(right) || left.localeCompare(right));
    const laneLimit = Math.max(2,maxLanes);
    const visibleCount = ranked.length > laneLimit ? laneLimit - 1 : laneLimit;
    const visible = new Set(ranked.slice(0,visibleCount));
    const lanes = ranked.slice(0,visibleCount).map(label => ({ label, title:label, count:counts.get(label) }));
    if (ranked.length > visibleCount) {
      const rest = ranked.slice(visibleCount);
      lanes.push({
        label:'Other activity',
        title:'Other activity: ' + rest.slice(0,6).join(', ') + (rest.length > 6 ? ' and more' : ''),
        count:rest.reduce((sum,label) => sum + counts.get(label),0),
      });
    }
    return { lanes, laneFor:call => visible.has(String(call.actionLabel ?? call.toolName)) ? String(call.actionLabel ?? call.toolName) : 'Other activity' };
  }

  function chartDomain(activity, zoom) {
    const timeline = activity.timeline ?? {};
    const timeBasis = timeline.basis === 'observed-time'
      && Number.isFinite(timeline.startMs)
      && Number.isFinite(timeline.endMs)
      && timeline.endMs > timeline.startMs;
    const fullMin = timeBasis ? timeline.startMs : 1;
    const fullMax = timeBasis ? timeline.endMs : Math.max(1,...activity.calls.map(call => call.step),1);
    const width = Math.max(1,fullMax - fullMin);
    return {
      timeBasis,
      fullMin,
      fullMax,
      min: zoom ? fullMin + width * zoom.from : fullMin,
      max: zoom ? fullMin + width * zoom.to : fullMax,
    };
  }

  const callPosition = (call, timeBasis) => timeBasis
    ? (Number.isFinite(call.startedAt) ? call.startedAt : null)
    : call.step;

  function promptCacheProfileForSession(session) {
    const selectedId = state.promptCacheProfileBySession.get(session.sessionId);
    if (selectedId === '') return null;
    if (selectedId) return PROMPT_CACHE_PROFILES.find(profile => profile.id === selectedId) ?? null;
    return resolvePromptCacheProfile(PROMPT_CACHE_PROFILES,{
      provider:session.runtime?.modelProvider ?? session.platform,
      models:session.models,
    });
  }

  function promptCachePolicyMarkup(session, selectedProfile) {
    const orderedProfiles = selectedProfile
      ? [selectedProfile,...PROMPT_CACHE_PROFILES.filter(profile => profile.id !== selectedProfile.id)]
      : [...PROMPT_CACHE_PROFILES];
    const selectOptions = [
      '<option value=""' + (selectedProfile ? '' : ' selected') + '>Not observed</option>',
      ...PROMPT_CACHE_PROFILES.map(profile => '<option value="' + escape(profile.id) + '"' + (profile.id === selectedProfile?.id ? ' selected' : '') + '>' + escape(profile.provider + ' · ' + profile.modelLabel) + '</option>'),
    ].join('');
    const rows = orderedProfiles.map((profile,index) => {
      const selected = profile.id === selectedProfile?.id;
      return '<div class="cache-policy-row' + (selected ? ' selected' : '') + '" role="row"' + (index >= 3 ? ' data-cache-policy-extra hidden' : '') + '>'
        + '<span role="cell"><strong>' + escape(profile.provider) + '</strong> · ' + escape(profile.modelLabel) + '</span>'
        + '<span role="cell">' + escape(profile.cacheModeLabel) + '</span>'
        + '<span role="cell">' + escape(profile.ttlLabel) + '</span>'
        + '<span role="cell">' + escape(profile.priceBasis) + '</span>'
        + '<span role="cell"><a href="' + escape(profile.officialUrl) + '" target="_blank" rel="noreferrer">Official docs ↗</a></span>'
        + '</div>';
    }).join('');
    return '<section class="cache-policy-panel" data-cache-policy-panel="' + escape(session.sessionId) + '" aria-label="Prompt cache policy reference">'
      + '<header class="cache-policy-header"><strong>Prompt cache policy</strong><label>Current: <select data-cache-profile-select="' + escape(session.sessionId) + '" aria-label="Prompt cache reference profile">' + selectOptions + '</select></label><span>' + escape(PROMPT_CACHE_POLICY_NOTICE) + '</span></header>'
      + '<div class="cache-policy-table" role="table" aria-label="Prompt cache model profiles">'
      + '<div class="cache-policy-head" role="row"><span role="columnheader">Provider / model</span><span role="columnheader">Cache mode</span><span role="columnheader">TTL / retention</span><span role="columnheader">Price basis</span><span role="columnheader">Source</span></div>'
      + rows + '</div>'
      + '<button type="button" class="cache-policy-toggle" data-cache-policy-toggle aria-expanded="false">View all ' + PROMPT_CACHE_PROFILES.length + ' model profiles</button>'
      + '</section>';
  }

  function activityChartMarkup(session, availableWidth, { compact = false, calls = null } = {}) {
    const retainedCalls = calls ?? session.toolActivity.calls;
    const timedCalls = retainedCalls.filter(call => Number.isFinite(call.startedAt));
    const activity = calls ? {
      ...session.toolActivity,
      calls:retainedCalls,
      totalCalls:retainedCalls.length,
      failedCalls:retainedCalls.filter(call => call.status === 'failed').length,
      timeline:timedCalls.length ? {
        basis:'observed-time',
        startMs:Math.min(...timedCalls.map(call => call.startedAt)),
        endMs:Math.max(...timedCalls.map(call => call.startedAt + (call.durationStatus === 'observed' && Number.isFinite(call.durationMs) ? Math.max(1,call.durationMs) : 1))),
      } : { basis:'call-sequence' },
    } : session.toolActivity;
    if (!activity.totalCalls) return '<div class="chart-empty">No normalized tool call was retained for this session.</div>';
    const zoom = calls ? null : state.zoom.get(session.sessionId) ?? null;
    const domain = chartDomain(activity,zoom);
    const { lanes, laneFor } = chartLanes(activity,compact ? 4 : 7);
    const laneIndex = new Map(lanes.map((lane,index) => [lane.label,index]));
    const untimed = domain.timeBasis ? activity.calls.filter(call => !Number.isFinite(call.startedAt)).length : 0;
    const inDomain = activity.calls.filter(call => {
      const position = callPosition(call,domain.timeBasis);
      return position !== null && position >= domain.min && position <= domain.max;
    });
    const commitEvents = domain.timeBasis && !calls ? session.commitLinks
      .filter(isDirectCommitLink)
      .map(link => ({ link, commit:byCommit.get(link.hash) }))
      .map(item => ({ ...item, position:new Date(item.commit?.committedAt ?? item.commit?.authoredAt ?? NaN).getTime() }))
      .filter(item => item.commit && Number.isFinite(item.position) && item.position >= domain.min && item.position <= domain.max)
      .sort((left,right) => left.position - right.position) : [];
    const contextCompactionEvents = domain.timeBasis
      ? [...new Set((session.contextManifest?.compactionEvents ?? [])
        .map(event => new Date(event?.timestamp ?? NaN).getTime())
        .filter(position => Number.isFinite(position) && position >= domain.min && position <= domain.max))]
        .sort((left,right) => left - right)
      : [];
    const cacheProfile = promptCacheProfileForSession(session);
    const responsePositions = [...new Set([
      ...(session.usageReport?.progression ?? []).map(point => new Date(point.timestamp ?? NaN).getTime()),
      ...(session.dialogue?.turns ?? []).flatMap(turn => (turn.steps ?? [])
        .filter(step => step.kind === 'usage')
        .map(step => new Date(step.timestamp ?? NaN).getTime())),
    ].filter(Number.isFinite))].sort((left,right) => left - right);

    const labelWidth = compact ? 88 : 132;
    const rowHeight = compact ? 18 : 26;
    // The ribbon fills the whole observed span with no holes, so the time
    // between calls stays visible instead of reading as blank canvas. It only
    // makes sense against real clock time; on the call-order fallback the
    // spacing would be an artefact of ordinal position, so it is omitted.
    const showRibbon = domain.timeBasis;
    const ribbonTop = compact ? 4 : 8;
    const ribbonHeight = compact ? 12 : 22;
    const topPad = showRibbon ? ribbonTop + ribbonHeight + (compact ? 8 : 14) : (compact ? 4 : 8);
    const width = Math.max(300,Math.floor(availableWidth || 640));
    const plotLeft = labelWidth + 12;
    const plotRight = width - (compact ? 8 : 14);
    const plotWidth = Math.max(60,plotRight - plotLeft);
    const laneArea = topPad + lanes.length * rowHeight + 4;
    const height = laneArea + (compact ? 22 : 30);
    const domainWidth = Math.max(1,domain.max - domain.min);
    const timelineScale = buildCompressedTimelineScale({
      min:domain.min,
      max:domain.max,
      positions:inDomain.map(call => callPosition(call,domain.timeBasis)),
      plotLeft,
      plotWidth,
      timeBasis:domain.timeBasis,
    });
    const xFor = timelineScale.xFor;
    const laneTop = index => topPad + index * rowHeight;
    const laneCenter = index => laneTop(index) + rowHeight / 2;

    const binPx = 5;
    const binCount = Math.max(1,Math.min(600,Math.floor(plotWidth / binPx)));
    const binOf = position => Math.min(binCount - 1,Math.max(0,Math.floor(timelineScale.visualFractionFor(position) * binCount)));
    const bins = new Map();
    for (const call of inDomain) {
      const position = callPosition(call,domain.timeBasis);
      const lane = laneIndex.get(laneFor(call)) ?? 0;
      const index = binOf(position);
      const key = lane + ':' + index;
      const bin = bins.get(key) ?? { lane, index, count:0, failed:0, ids:[], min:position, max:position, family:call.family };
      bin.count += 1;
      if (call.status === 'failed') bin.failed += 1;
      if (bin.ids.length < 400) bin.ids.push(call.id);
      bin.min = Math.min(bin.min,position);
      bin.max = Math.max(bin.max,position);
      bins.set(key,bin);
    }
    const maxBin = Math.max(1,...[...bins.values()].map(bin => bin.count));
    // Individual marks only survive while every bin holds one call. Above that
    // the lane switches to counted bars, so no call is hidden under another.
    const detailMode = maxBin <= 1;

    const laneMarkup = lanes.map((lane,index) => {
      const label = [...lane.label].length > 18 ? [...lane.label].slice(0,17).join('') + '…' : lane.label;
      const alt = index % 2 ? '<rect class="chart-row-alt" x="' + labelWidth + '" y="' + laneTop(index) + '" width="' + (width - labelWidth) + '" height="' + rowHeight + '"></rect>' : '';
      return '<g class="chart-lane" data-action-lane="' + escape(lane.label) + '">' + alt
        + '<line class="chart-lane-line" x1="' + (plotLeft - 6) + '" x2="' + (plotRight + 6) + '" y1="' + (laneTop(index) + rowHeight - 3) + '" y2="' + (laneTop(index) + rowHeight - 3) + '"></line>'
        + '<text class="chart-lane-label" x="' + (labelWidth - 10) + '" y="' + (laneCenter(index) + 3) + '" text-anchor="end"><title>' + escape(lane.title + ' · ' + lane.count + ' calls') + '</title>' + escape(label) + '</text></g>';
    }).join('');

    // Idle stretches are the point of a time axis: shade any window where the
    // session produced no observed call so waiting is visible, not inferred.
    // The threshold tracks the span loosely enough that real waits still
    // qualify — keyed off the span alone, a busy session reported no idle at all.
    let gapMarkup = '';
    let longestGap = null;
    const cacheCues = [];
    if (domain.timeBasis && inDomain.length > 1) {
      const positions = inDomain.map(call => callPosition(call,true)).sort((left,right) => left - right);
      const threshold = Math.max(45000,domainWidth / 120);
      for (let index = 1; index < positions.length; index += 1) {
        const gap = positions[index] - positions[index - 1];
        if (gap < threshold) continue;
        if (!longestGap || gap > longestGap.gap) longestGap = { gap, at:positions[index - 1] };
        const gapStart = positions[index - 1];
        const gapEnd = positions[index];
        const compressed = timelineScale.gaps.some(candidate => candidate.from === gapStart && candidate.to === gapEnd);
        const left = xFor(gapStart);
        const right = Math.max(xFor(positions[index]),left + 3);
        const cacheCue = buildPromptCacheGapCue({ profile:cacheProfile, gapStartMs:gapStart, gapEndMs:gapEnd, responsePositions, responsePositionsSorted:true });
        if (cacheCue) cacheCues.push(cacheCue);
        const caption = 'No observed call for ' + formatSpan(gap) + ' (' + formatShortClock(gapStart) + ' → ' + formatShortClock(gapEnd) + ' UTC)'
          + (compressed ? '. This long idle gap uses a visual scale break; its UTC duration is unchanged.' : '')
          + (cacheCue ? ' Longest interval without an observed model response: ' + formatSpan(cacheCue.silenceMs) + '. ' + cacheCue.detail : '');
        const idleLabel = 'idle ' + formatSpan(gap);
        const label = compressed
          ? '<text class="chart-gap-label" x="0" y="0" transform="translate(' + ((left + right) / 2) + ' ' + (laneArea - 9) + ') rotate(-90)" text-anchor="start">' + escape(idleLabel) + '</text>'
          : right - left > 46
            ? '<text class="chart-gap-label" x="' + ((left + right) / 2) + '" y="' + (topPad + 10) + '" text-anchor="middle">' + escape(idleLabel) + '</text>'
            : '';
        const breakMark = compressed
          ? '<path class="chart-gap-break" d="M ' + (((left + right) / 2) - 7) + ' ' + (laneArea - 4) + ' l 4 -4 l 4 4 l 4 -4 l 4 4"></path>'
          : '';
        const cacheEdge = cacheCue
          ? '<line class="chart-gap-cache-edge" x1="' + left + '" x2="' + right + '" y1="' + topPad + '" y2="' + topPad + '"></line>'
          : '';
        const cacheAttributes = cacheCue
          ? ' data-cache-gap-profile="' + escape(cacheCue.profileId) + '" data-cache-gap-provider="' + escape(cacheCue.providerLabel) + '" data-cache-gap-threshold-ms="' + cacheCue.thresholdMs + '" data-cache-gap-silence-ms="' + cacheCue.silenceMs + '"'
          : '';
        gapMarkup += '<g class="chart-gap' + (compressed ? ' compressed' : '') + (cacheCue ? ' cache-ttl-crossed' : '') + '"' + cacheAttributes + '><rect x="' + left + '" y="' + topPad + '" width="' + (right - left) + '" height="' + (laneArea - topPad) + '"><title>' + escape(caption) + '</title></rect>' + cacheEdge + label + breakMark + '</g>';
      }
    }

    // The base band is the span itself; every observed call is painted over it,
    // so whatever stays bare is time this session did not spend inside a tool.
    // That residue is labelled as unattributed, never as a model turn: the host
    // timestamps calls, not the model's own work, and the projection drops the
    // note stamps that would be needed to claim otherwise.
    let ribbonMarkup = '';
    if (showRibbon) {
      const ribbonMid = ribbonTop + ribbonHeight / 2;
      const blocks = inDomain.map(call => {
        const position = callPosition(call,true);
        const timed = call.durationStatus === 'observed' && Number.isFinite(call.durationMs);
        const left = xFor(position);
        const blockWidth = timed
          ? Math.max(1.5,Math.min(plotLeft + plotWidth - left,timelineScale.durationWidth(position,call.durationMs)))
          : 1.5;
        const failed = call.status === 'failed';
        const stamp = formatStamp(call.startedAt);
        const label = call.id + ' · ' + (call.actionLabel ?? call.toolName) + ' · ' + call.toolName
          + (stamp ? ' · ' + stamp + ' UTC' : '')
          + ' · ' + (timed ? formatLatency(call.durationMs) : 'timing unavailable')
          + (failed ? ' · failed' : '');
        return '<rect class="chart-ribbon-block' + (failed ? ' failed' : '') + '" data-session-id="' + escape(session.sessionId) + '" data-call-id="' + escape(call.id) + '"'
          + ' data-chart-detail="' + escape(label) + '"'
          + ' x="' + left + '" y="' + ribbonTop + '" width="' + blockWidth + '" height="' + ribbonHeight + '"'
          + ' fill="' + (failed ? FAILED_COLOR : familyColor(call.family)) + '"'
          + ' tabindex="0" role="button" aria-label="' + escape(label) + '"><title>' + escape(label) + '</title></rect>';
      }).join('');
      const toolMs = inDomain.reduce((sum,call) => sum + (call.durationStatus === 'observed' && Number.isFinite(call.durationMs) ? call.durationMs : 0),0);
      const baseLabel = 'Full observed span. Coloured blocks are observed tool calls; bare band is time not attributed to any tool call — model work or waiting the host did not separately observe.';
      ribbonMarkup = '<g class="chart-ribbon">'
        + '<rect class="chart-ribbon-base" x="' + plotLeft + '" y="' + ribbonTop + '" width="' + plotWidth + '" height="' + ribbonHeight + '" rx="3"><title>' + escape(baseLabel) + '</title></rect>'
        + blocks
        + '<text class="chart-lane-label chart-ribbon-label" x="' + (labelWidth - 10) + '" y="' + (ribbonMid + 3) + '" text-anchor="end"><title>' + escape('Observed tool time ' + formatSpan(toolMs) + ' of ' + formatSpan(domain.max - domain.min) + ' in view') + '</title>All activity</text>'
        + '</g>';
    }

    let marksMarkup = '';
    if (detailMode) {
      marksMarkup = inDomain.map(call => {
        const position = callPosition(call,domain.timeBasis);
        const lane = laneIndex.get(laneFor(call)) ?? 0;
        const timed = call.durationStatus === 'observed' && Number.isFinite(call.durationMs);
        const markWidth = domain.timeBasis && timed
          ? Math.max(3,Math.min(plotWidth,timelineScale.durationWidth(position,call.durationMs)))
          : 4;
        const failed = call.status === 'failed';
        const tone = failed ? FAILED_COLOR : familyColor(call.family);
        const stamp = formatStamp(call.startedAt);
        const label = call.id + ' · ' + (call.actionLabel ?? call.toolName) + ' · ' + call.toolName
          + (stamp ? ' · ' + stamp + ' UTC' : '')
          + ' · ' + (failed ? 'failed' : 'observed') + ' · ' + (timed ? formatLatency(call.durationMs) : 'timing unavailable')
          + (call.detail ? ' · ' + call.detail : '')
          + (call.filePaths?.length ? ' · ' + call.filePaths.join(' · ') : '');
        const markHeight = compact ? 8 : 10;
        return '<rect class="chart-mark' + (failed ? ' failed' : '') + '" data-session-id="' + escape(session.sessionId) + '" data-call-id="' + escape(call.id) + '"'
          + ' data-chart-detail="' + escape(label) + '"'
          + ' x="' + xFor(position) + '" y="' + (laneCenter(lane) - markHeight / 2) + '" width="' + markWidth + '" height="' + markHeight + '" rx="2"'
          + ' fill="' + (timed || failed ? tone : 'var(--color-surface)') + '" stroke="' + tone + '" stroke-width="' + (timed || failed ? 1 : 1.5) + '"'
          + ' tabindex="0" role="button" aria-label="' + escape(label) + '"><title>' + escape(label) + '</title></rect>';
      }).join('');
    } else {
      marksMarkup = [...bins.values()].map(bin => {
        const barHeight = 4 + Math.sqrt(bin.count / maxBin) * (rowHeight - 11);
        const top = laneTop(bin.lane) + rowHeight - 3 - barHeight;
        const tone = bin.failed > 0 ? FAILED_COLOR : familyColor(bin.family);
        const slice = domain.timeBasis
          ? formatShortClock(bin.min) + '–' + formatShortClock(bin.max) + ' UTC'
          : 'calls ' + Math.round(bin.min) + '–' + Math.round(bin.max);
        const label = bin.count + ' call' + (bin.count === 1 ? '' : 's') + ' · ' + lanes[bin.lane].label + ' · ' + slice + (bin.failed ? ' · ' + bin.failed + ' failed' : '');
        return '<rect class="chart-bin' + (bin.failed ? ' failed' : '') + '" data-chart-bin data-bin-from="' + bin.min + '" data-bin-to="' + bin.max + '" data-bin-count="' + bin.count + '" data-session-id="' + escape(session.sessionId) + '" data-call-id="' + escape(bin.ids[0]) + '" data-chart-detail="' + escape(label) + '"'
          + ' x="' + xFor(bin.min) + '" y="' + top + '" width="' + Math.max(2,binPx - 1) + '" height="' + barHeight + '" rx="1" fill="' + tone + '"'
          + ' tabindex="0" role="button" aria-label="' + escape(label) + '"><title>' + escape(label) + '</title></rect>';
      }).join('');
    }

    const commitMarkup = commitEvents.map(({ commit, link, position }) => {
      const linkedCalls = link.linkedEditCallIds?.length ?? 0;
      const linkedPaths = link.linkedEditFiles?.length ?? 0;
      const association = linkedCalls
        ? linkedCalls + ' linked Edit/Write call' + (linkedCalls === 1 ? '' : 's') + ' across ' + linkedPaths + ' exact changed path' + (linkedPaths === 1 ? '' : 's')
        : 'no linked Edit/Write path observed before this commit';
      const label = 'Commit ' + commit.shortHash + ' · ' + commit.subject + ' · ' + formatShortClock(position) + ' UTC · ' + association;
      const x = xFor(position);
      const markerY = topPad + 7;
      return '<line class="chart-commit-line" x1="' + x + '" x2="' + x + '" y1="' + (markerY + 5) + '" y2="' + laneArea + '"></line>'
        + '<path class="chart-commit chart-commit-marker" data-session-id="' + escape(session.sessionId) + '" data-commit-hash="' + escape(commit.hash) + '"'
        + ' data-chart-detail="' + escape(label) + '" d="M ' + x + ' ' + (markerY - 5) + ' L ' + (x + 5) + ' ' + markerY + ' L ' + x + ' ' + (markerY + 5) + ' L ' + (x - 5) + ' ' + markerY + ' Z"'
        + ' tabindex="0" role="button" aria-label="' + escape(label) + '"><title>' + escape(label) + '</title></path>';
    }).join('');

    const contextCompactionMarkup = contextCompactionEvents.map(position => {
      const x = xFor(position);
      const markerY = topPad + 7;
      const label = 'Context compressed · ' + formatShortClock(position) + ' UTC · explicit provider compaction boundary';
      return '<g class="chart-context-compaction"><line class="chart-context-compaction-line" x1="' + x + '" x2="' + x + '" y1="' + (markerY + 5) + '" y2="' + laneArea + '"></line>'
        + '<path class="chart-context-compaction-marker" data-session-id="' + escape(session.sessionId) + '" data-chart-detail="' + escape(label) + '" d="M ' + x + ' ' + (markerY - 5) + ' L ' + (x + 5) + ' ' + markerY + ' L ' + x + ' ' + (markerY + 5) + ' L ' + (x - 5) + ' ' + markerY + ' Z"'
        + ' tabindex="0" role="button" aria-label="' + escape(label) + '"><title>' + escape(label) + '</title></path></g>';
    }).join('');

    const tickCount = Math.max(2,Math.min(7,Math.floor(plotWidth / 92)));
    const ticks = Array.from({ length:tickCount },(_,index) => plotLeft + (plotWidth * index) / (tickCount - 1));
    const tickMarkup = ticks.map(x => {
      const position = timelineScale.positionForX(x);
      return '<g><line class="chart-grid-line" x1="' + x + '" x2="' + x + '" y1="' + topPad + '" y2="' + laneArea + '"></line><text class="chart-tick" x="' + x + '" y="' + (laneArea + (compact ? 14 : 17)) + '" text-anchor="middle">' + escape(domain.timeBasis ? formatShortClock(position) : String(Math.round(position))) + '</text></g>';
    }).join('');

    const basisNote = domain.timeBasis
      ? (timelineScale.compressed ? 'Wall-clock timestamps; long idle gaps use visual scale breaks and bar height counts calls in that slice.' : 'Wall-clock time; bar height counts calls in that slice.')
      : 'No observed call timing in this session; the axis falls back to call order.';
    const aria = activity.totalCalls + ' normalized tool calls by action over ' + (domain.timeBasis ? 'observed time, with ' + commitEvents.length + ' commit events in view' : 'call sequence');
    const cacheCueDescription = cacheCues.length
      ? ' ' + cacheCues.length + ' idle window' + (cacheCues.length === 1 ? '' : 's') + ' cross prompt-cache TTL references. These are pricing-risk cues, not observed cache expiry, cache misses, or billed cost.'
      : '';
    const cacheCueKey = cacheCues.length
      ? '<div class="chart-cache-key"><i aria-hidden="true"></i><span>cache TTL exceeded</span><span class="visually-hidden"> for ' + escape(cacheCues[0].providerLabel + ' ' + cacheCues[0].modelLabel) + '; pricing-risk reference only</span></div>'
      : '';
    const policyPane = !compact && !calls ? promptCachePolicyMarkup(session,cacheProfile) : '';
    const statusSummary = inDomain.length + ' / ' + activity.totalCalls + ' calls'
      + (longestGap ? ' · longest idle ' + formatSpan(longestGap.gap) + ' at ' + formatShortClock(longestGap.at) + ' UTC' : '')
      + (untimed ? ' · ' + untimed + ' without observed timing' : '');

    return '<section class="chart-card' + (compact ? ' chart-compact' : '') + '" aria-label="NormalizedToolActivityV1 provider-neutral actions">'
      + '<div class="chart-toolbar"><span class="chart-basis' + (domain.timeBasis ? '' : ' fallback') + '">' + escape(domain.timeBasis ? 'Time axis' : 'Sequence axis (no observed timing)') + '</span>'
      + '<span class="chart-range">' + escape(domain.timeBasis ? formatShortClock(domain.min) + ' → ' + formatShortClock(domain.max) + ' UTC · ' + formatSpan(domain.max - domain.min) : 'calls ' + Math.round(domain.min) + '–' + Math.round(domain.max)) + '</span>'
      + '<button type="button" class="chart-reset" data-chart-reset="' + escape(session.sessionId) + '"' + (zoom ? '' : ' disabled') + '>Reset zoom</button></div>'
      + '<svg class="activity-chart" data-activity-svg="' + escape(session.sessionId) + '" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(aria) + '">'
      + '<title>' + escape(aria) + '</title><desc>' + escape(basisNote + ' Shaded columns are windows with no observed call. Idle gaps with scale breaks retain their real UTC duration.' + cacheCueDescription + (contextCompactionEvents.length ? ' ' + contextCompactionEvents.length + ' explicit provider context compaction event' + (contextCompactionEvents.length === 1 ? ' is' : 's are') + ' marked.' : '') + ' Red marks are failed calls. Green diamonds mark directly linked commit times. Drag across the plot to zoom.') + '</desc>'
      + '<rect class="chart-surface" data-chart-surface x="' + plotLeft + '" y="' + topPad + '" width="' + plotWidth + '" height="' + (laneArea - topPad) + '" data-plot-left="' + plotLeft + '" data-plot-width="' + plotWidth + '" data-domain-min="' + domain.min + '" data-domain-max="' + domain.max + '" data-full-min="' + domain.fullMin + '" data-full-max="' + domain.fullMax + '" data-axis-segments="' + escape(JSON.stringify(timelineScale.segments)) + '" data-session-id="' + escape(session.sessionId) + '"></rect>'
      + laneMarkup + gapMarkup + tickMarkup + ribbonMarkup + marksMarkup + commitMarkup + contextCompactionMarkup
      + '<rect class="chart-brush" data-chart-brush x="0" y="' + topPad + '" width="0" height="' + (laneArea - topPad) + '" hidden></rect>'
      + '<line class="chart-axis-line" x1="' + labelWidth + '" x2="' + (plotRight + 6) + '" y1="' + laneArea + '" y2="' + laneArea + '"></line>'
      + '<text class="chart-axis-label" x="' + (labelWidth - 10) + '" y="' + (laneArea + (compact ? 14 : 17)) + '" text-anchor="end">' + escape(domain.timeBasis ? 'UTC' : 'Call') + '</text>'
      + '</svg>'
      + cacheCueKey + policyPane
      + '<footer class="chart-statusbar">'
      + '<div class="chart-inspector" data-chart-inspector aria-live="polite"></div>'
      + '<button type="button" class="chart-status-link" data-chart-locate data-open-session-for="' + escape(session.sessionId) + '" disabled>Locate in Session View ↗</button>'
      + '<span class="chart-status-summary' + (untimed ? ' chart-warning' : '') + '">' + escape(statusSummary) + '</span>'
      + '<span class="chart-status-legends">'
      + (showRibbon ? '<span><i class="legend-dot between"></i>between calls</span>' : '')
      + '<span><i class="legend-dot failed"></i>failed</span><span><i class="legend-dot gap"></i>idle window</span>'
      + (contextCompactionEvents.length ? '<span><i class="legend-dot context-compaction"></i>context compressed</span>' : '')
      + (domain.timeBasis ? '<span><i class="legend-dot commit"></i>linked commit</span>' : '')
      + '</span></footer></section>';
  }

  function renderActivityChart(container) {
    const session = bySession.get(container.dataset.activityChart);
    if (!session || !container.clientWidth) return;
    const turnIndex = Number(container.dataset.activityTurn);
    const turn = Number.isFinite(turnIndex) ? session.dialogue?.turns?.find(item => item.index === turnIndex) : null;
    const turnCallIds = turn ? new Set(turn.steps.filter(step => step.kind === 'tool').map(step => step.callId)) : null;
    const calls = turnCallIds ? session.toolActivity.calls.filter(call => turnCallIds.has(call.id)) : null;
    container.innerHTML = activityChartMarkup(session,container.clientWidth,{ compact:Boolean(container.closest('.session-axis-panel, .session-turn-activity')), calls });
  }

  const chartObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => entries.forEach(entry => {
      if (entry.target.dataset.activityChart) renderActivityChart(entry.target);
    }))
    : null;

  function showChartDetail(element) {
    const card = element.closest('.chart-card');
    const inspector = card?.querySelector('[data-chart-inspector]');
    if (!inspector || !element.dataset.chartDetail) return;
    inspector.innerHTML = '<strong>' + escape(element.dataset.chartDetail) + '</strong>';
    const locate = card.querySelector('[data-chart-locate]');
    if (!locate) return;
    delete locate.dataset.callId;
    delete locate.dataset.commitHash;
    if (element.dataset.callId) locate.dataset.callId = element.dataset.callId;
    if (element.dataset.commitHash) locate.dataset.commitHash = element.dataset.commitHash;
    locate.disabled = !element.dataset.callId && !element.dataset.commitHash;
  }

  function showUsageChartDetail(element) {
    const inspector = element.closest('.usage-context-chart')?.querySelector('[data-usage-chart-inspector]');
    if (!inspector || !element.dataset.usageChartDetail) return;
    inspector.innerHTML = '<strong>' + escape(element.dataset.usageChartDetail) + '</strong><span>' + escape(element.dataset.usageChartSecondary ?? 'No observed linked prompt') + '</span>';
  }

  function usageSessionFor(element) {
    const sessionId = element?.closest?.('[data-usage-explorer]')?.dataset.usageExplorer;
    return sessionId ? bySession.get(sessionId) : null;
  }

  function updateUsageInspectStrip(element,position,{ hovered = false } = {}) {
    const session = usageSessionFor(element);
    const strip = element?.closest?.('[data-usage-explorer]')?.querySelector('[data-usage-inspect-strip]');
    if (!session || !strip) return;
    const explorer = usageExplorerState(session);
    const entry = Number.isInteger(position) && position >= 0 && position < explorer.points.length
      ? { point:explorer.points[position],position }
      : null;
    const processedVisible = explorer.points.slice(explorer.start,explorer.end).some(point => Number.isFinite(point.processedTokens));
    strip.outerHTML = usageInspectStripMarkup(entry,{ hovered,processedVisible });
  }

  function restoreUsageInspectStrip(element) {
    const session = usageSessionFor(element);
    if (!session) return;
    updateUsageInspectStrip(element,usageExplorerState(session).selected);
  }

  function refreshUsageExplorer(session,{ focus = null } = {}) {
    const current = document.querySelector('[data-usage-explorer="' + CSS.escape(session.sessionId) + '"]');
    if (!current) return;
    current.outerHTML = usageExplorerMarkup(session);
    const next = document.querySelector('[data-usage-explorer="' + CSS.escape(session.sessionId) + '"]');
    const focusTarget = focus === 'start' || focus === 'end' ? next?.querySelector('[data-usage-window-edge="' + focus + '"]')
      : focus === 'chart' ? next?.querySelector('[data-usage-focus-surface]')
        : focus === 'overview' ? next?.querySelector('[data-usage-overview-chart]') : null;
    focusTarget?.focus({ preventScroll:true });
  }

  function setUsageSelection(session,position,{ reveal = true,focus = null } = {}) {
    const explorer = usageExplorerState(session);
    if (!Number.isInteger(position) || position < 0 || position >= explorer.points.length) return;
    explorer.selected = position;
    if (reveal && position < explorer.start) {
      explorer.start = Math.max(0,position);
      explorer.end = Math.min(explorer.points.length,explorer.start + explorer.size);
    }
    if (reveal && position >= explorer.end) {
      explorer.end = Math.min(explorer.points.length,position + 1);
      explorer.start = Math.max(0,explorer.end - explorer.size);
    }
    state.usageExplorer.set(session.sessionId,{ start:explorer.start,end:explorer.end,selected:explorer.selected });
    refreshUsageExplorer(session,{ focus });
  }

  function stepUsageSelection(session,delta,{ focus = 'chart' } = {}) {
    const explorer = usageExplorerState(session);
    const selected = explorer.selected >= 0 ? explorer.selected : explorer.start;
    setUsageSelection(session,Math.max(0,Math.min(explorer.points.length - 1,selected + delta)),{ focus });
  }

  function setUsageWindow(session,start,{ focus = 'start' } = {}) {
    const explorer = usageExplorerState(session);
    explorer.start = Math.max(0,Math.min(explorer.maxStart,Math.round(start)));
    explorer.end = explorer.start + explorer.size;
    if (explorer.selected < explorer.start) explorer.selected = explorer.start;
    if (explorer.selected >= explorer.end) explorer.selected = explorer.end - 1;
    state.usageExplorer.set(session.sessionId,{ start:explorer.start,end:explorer.end,selected:explorer.selected });
    refreshUsageExplorer(session,{ focus });
  }

  function centerUsageSelection(session,position,{ focus = 'chart' } = {}) {
    const explorer = usageExplorerState(session);
    if (!Number.isInteger(position) || position < 0 || position >= explorer.points.length) return;
    const start = Math.max(0,Math.min(explorer.maxStart,position - Math.floor(explorer.size / 2)));
    state.usageExplorer.set(session.sessionId,{ start,end:start + explorer.size,selected:position });
    refreshUsageExplorer(session,{ focus });
  }

  function moveUsagePromptSelection(session,step) {
    const explorer = usageExplorerState(session);
    const entries = explorer.points.map((point,position) => ({ point,position }));
    const prompts = usageTurnEntries(entries);
    if (!prompts.length) return;
    const selectedPoint = explorer.points[explorer.selected];
    let current = prompts.findIndex(entry => entry.position === explorer.selected
      || Number.isFinite(selectedPoint?.turnIndex) && entry.point.turnIndex === selectedPoint.turnIndex);
    if (current < 0) {
      const next = prompts.findIndex(entry => entry.position > explorer.selected);
      current = next > 0 ? next - 1 : next === 0 ? 0 : prompts.length - 1;
    }
    const next = step === 'first' ? 0 : step === 'last' ? prompts.length - 1
      : Math.max(0,Math.min(prompts.length - 1,current + Number(step || 0)));
    if (next === current) return;
    centerUsageSelection(session,prompts[next].position,{ focus:'overview' });
  }

  function setUsageWindowEdge(session,edge,value,{ focus = edge } = {}) {
    const explorer = usageExplorerState(session);
    if (edge === 'start') explorer.start = Math.max(0,Math.min(explorer.end - explorer.minSize,Math.round(value)));
    else explorer.end = Math.min(explorer.points.length,Math.max(explorer.start + explorer.minSize,Math.round(value)));
    if (explorer.selected < explorer.start) explorer.selected = explorer.start;
    if (explorer.selected >= explorer.end) explorer.selected = explorer.end - 1;
    state.usageExplorer.set(session.sessionId,{ start:explorer.start,end:explorer.end,selected:explorer.selected });
    refreshUsageExplorer(session,{ focus });
  }

  function usagePositionAt(surface,clientX,session,{ focusWindow = false } = {}) {
    const explorer = usageExplorerState(session);
    const rect = surface.getBoundingClientRect();
    const ratio = Math.max(0,Math.min(1,(clientX - rect.left) / Math.max(1,rect.width)));
    const count = focusWindow ? explorer.size : explorer.points.length;
    return (focusWindow ? explorer.start : 0) + Math.round(ratio * Math.max(0,count - 1));
  }

  function chartPositionAt(surface, x) {
    const plotLeft = Number(surface.dataset.plotLeft);
    const plotWidth = Math.max(1,Number(surface.dataset.plotWidth));
    const ratio = (Math.min(plotLeft + plotWidth,Math.max(plotLeft,x)) - plotLeft) / plotWidth;
    try {
      const segments = JSON.parse(surface.dataset.axisSegments ?? '[]');
      const visualSpan = Number(segments.at(-1)?.visualTo);
      if (segments.length && Number.isFinite(visualSpan) && visualSpan > 0) {
        const visual = ratio * visualSpan;
        const segment = segments.find(candidate => visual <= candidate.visualTo) ?? segments.at(-1);
        const within = (visual - segment.visualFrom) / Math.max(Number.EPSILON,segment.visualTo - segment.visualFrom);
        return segment.from + within * (segment.to - segment.from);
      }
    } catch { /* Fall back to the linear report contract below. */ }
    const domainMin = Number(surface.dataset.domainMin);
    return domainMin + ratio * (Number(surface.dataset.domainMax) - domainMin);
  }

  function setZoom(sessionId, from, to) {
    if (to - from >= 0.999) state.zoom.delete(sessionId);
    else state.zoom.set(sessionId,{ from:Math.max(0,from), to:Math.min(1,Math.max(from + 0.0005,to)) });
    document.querySelectorAll('[data-activity-chart="' + CSS.escape(sessionId) + '"]').forEach(renderActivityChart);
  }

  // ---------------------------------------------------------------- session view

  const commitTime = commit => new Date(commit.committedAt ?? commit.authoredAt ?? 0).getTime();

  // A commit only joins a Turn when its timestamp falls inside that Turn's
  // observed window. Everything else stays in an explicit outside-the-window
  // track, so layout never implies a Turn produced a commit it predates.
  function placeCommits(commits, turns, session) {
    const inTurn = new Map();
    const outside = [];
    const sessionStart = new Date(session.firstSeen ?? NaN).getTime();
    const sessionEnd = new Date(session.lastSeen ?? NaN).getTime();
    for (const commit of commits) {
      const time = commitTime(commit);
      const turn = turns.find(item => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && time >= item.startMs && time <= item.endMs);
      if (turn) {
        const bucket = inTurn.get(turn.index) ?? [];
        bucket.push(commit);
        inTurn.set(turn.index,bucket);
        continue;
      }
      const relation = Number.isFinite(sessionStart) && time < sessionStart ? 'before this session started'
        : Number.isFinite(sessionEnd) && time > sessionEnd ? 'after this session ended'
          : 'between observed turn windows';
      outside.push({ commit, relation });
    }
    return { inTurn, outside };
  }

  // Long traces repeat the same redacted row many times over. Collapsing an
  // identical consecutive run keeps every call addressable while removing the
  // rows a reviewer has no way to tell apart.
  function toolRuns(calls) {
    const runs = [];
    for (const call of calls) {
      const key = [call.actionLabel,call.toolName,call.status,call.detail ?? '',(call.filePaths ?? []).join(',')].join('|');
      const current = runs.at(-1);
      if (current && current.key === key) current.calls.push(call);
      else runs.push({ key, calls:[call] });
    }
    return runs;
  }

  // Surfaces whether a call's "detail" line is the model's own rewritten
  // summary or a summary with redacted arguments, so neither reads as the
  // tool's literal command/output.
  function detailKindBadge(call) {
    if (!call.detail) return '';
    return call.detailKind === 'redacted-input-summary'
      ? '<span class="detail-kind redacted" title="Original arguments were removed by privacy filtering; this line is a rewritten summary, not the raw command or output.">redacted</span>'
      : '<span class="detail-kind summary" title="A normalized summary generated from the observed call, not verbatim tool output.">summary</span>';
  }

  function toolRowMarkup(session, call) {
    const stamp = formatStamp(call.startedAt);
    const dot = '<i class="family-dot" style="background:' + familyColor(call.family) + '" aria-hidden="true"></i>';
    return '<div class="session-tool-row" data-session-tool-row data-tool="' + escape(call.toolName) + '" id="session-call-' + escape(call.id) + '">'
      + '<span class="session-tool-id">' + escape(call.id) + '</span>'
      + '<span class="session-tool-copy">' + dot + '<strong>' + escape(call.actionLabel) + '</strong><code title="' + escape(call.toolName) + '">' + escape(call.toolName) + '</code>' + (call.status === 'failed' ? '<em class="session-tool-failed">failed</em>' : '') + '</span>'
      + '<span class="session-tool-time"><code>' + escape(stamp ?? '—') + '</code><small>' + escape(call.durationStatus === 'observed' ? formatLatency(call.durationMs) : '—') + '</small></span>'
      + (call.detail ? '<span class="session-tool-detail-row"><code class="session-tool-detail">' + escape(call.detail) + '</code>' + detailKindBadge(call) + '</span>' : '')
      + (call.filePaths?.length ? '<code class="session-tool-file">' + escape(call.filePaths.join(' · ')) + '</code>' : '')
      + '</div>';
  }

  function toolListMarkup(session, calls) {
    const blocks = toolRuns(calls).map((run) => {
      if (run.calls.length === 1) return toolRowMarkup(session,run.calls[0]);
      const first = run.calls[0];
      const last = run.calls.at(-1);
      const total = run.calls.reduce((sum,call) => sum + (call.durationStatus === 'observed' ? call.durationMs : 0),0);
      return '<details class="session-tool-run" data-tool="' + escape(first.toolName) + '" data-call-count="' + run.calls.length + '" id="' + escape(session.sessionId + '-run-' + first.id + '-' + last.id) + '"><summary><span class="session-tool-id">' + escape(first.id) + '–' + escape(last.id) + '</span>'
        + '<span class="session-tool-copy"><i class="family-dot" style="background:' + familyColor(first.family) + '" aria-hidden="true"></i><strong>' + escape(first.actionLabel) + ' ×' + run.calls.length + '</strong><code>' + escape(first.toolName) + '</code></span>'
        + '<span class="session-tool-time"><code>' + escape(formatStamp(first.startedAt) ?? '—') + '</code><small>' + escape(total ? formatLatency(total) + ' total' : '—') + '</small></span>'
        + (first.detail ? '<span class="session-tool-detail-row"><code class="session-tool-detail">' + escape(first.detail) + '</code>' + detailKindBadge(first) + '</span>' : '')
        + '</summary>' + run.calls.map(call => toolRowMarkup(session,call)).join('') + '</details>';
    });
    // A show-more reveal replaces the old nested scroll box, so one long page
    // never traps the wheel inside eighteen independent scroll containers.
    return '<div class="session-call-list">' + blocks.slice(0,14).join('')
      + (blocks.length > 14 ? '<div class="session-call-overflow" data-call-overflow hidden>' + blocks.slice(14).join('') + '</div><button type="button" class="session-call-more" data-reveal-calls>Show ' + (blocks.length - 14) + ' more grouped rows</button>' : '')
      + '</div>';
  }

  function processStreamMarkup(session, turn, callsById) {
    const rows = [];
    let pendingCalls = [];
    let noteIndex = 0;
    let usageIndex = 0;
    const flushCalls = usage => {
      if (!pendingCalls.length) {
        if (usage) rows.push(usageStepMarkup(usage.step,usage.index));
        return;
      }
      const calls = pendingCalls;
      pendingCalls = [];
      const names = [...new Set(calls.map(call => call.toolName))];
      const nameMarkup = names.slice(0,3).map(name => '<span class="session-process-tool-name" data-tool="' + escape(name) + '">' + escape(name) + '</span>').join('<i aria-hidden="true"> · </i>') + (names.length > 3 ? '<i> +' + (names.length - 3) + '</i>' : '');
      rows.push('<details class="session-event tools session-process-tool-run session-process-combined' + (usage ? ' with-usage' : '') + '" data-session-process-group data-tools-visible="true"><summary class="session-event-head session-process-combined-summary"><span class="session-process-tool-summary" data-session-event="tools"><strong>' + calls.length + ' tool call' + (calls.length === 1 ? '' : 's') + '</strong><span class="session-process-tool-names">' + nameMarkup + '</span></span>' + (usage ? usageStepMarkup(usage.step,usage.index,true) : '') + '</summary><div class="session-process-tool-body" data-session-event="tools">' + toolListMarkup(session,calls) + '</div></details>');
    };
    (turn.steps ?? []).forEach(step => {
      if (step.kind === 'tool') {
        const call = callsById.get(step.callId);
        if (call) pendingCalls.push(call);
        else {
          flushCalls();
          rows.push('<article class="session-event session-tool-unavailable" data-session-event="tools"><div class="session-event-body"><strong>' + escape(step.toolName ?? 'Tool call') + '</strong><span>Structured call detail was not retained.</span></div></article>');
        }
        return;
      }
      if (step.kind === 'note') {
        flushCalls();
        noteIndex += 1;
        rows.push('<article class="session-event intermediate" data-session-event="intermediate"><div class="session-note-label">Intermediate ' + noteIndex + '</div><div class="session-markdown">' + renderSessionMarkdown(step.text) + '</div></article>');
      } else if (step.kind === 'usage') {
        usageIndex += 1;
        flushCalls({ step, index:usageIndex });
      }
    });
    flushCalls();
    return rows.join('');
  }

  function turnOutcomeMarkup(session, turn, calls, commits) {
    const editCalls = calls.filter(call => call.family === 'change');
    const verifyCalls = calls.filter(call => call.family === 'verify');
    const editPaths = [...new Set(editCalls.flatMap(call => call.filePaths ?? []))];
    const responseStatus = turn.responseStatus ?? (turn.response ? 'retained' : 'unavailable');
    const statusLabel = responseStatus === 'retained' ? 'Terminal response retained'
      : responseStatus === 'incomplete' ? 'Retained Turn is incomplete'
        : 'Terminal response unavailable';
    const facts = [
      editCalls.length ? '<li><strong>' + editCalls.length + '</strong> edit call' + (editCalls.length === 1 ? '' : 's') + ' observed</li>' : '',
      verifyCalls.length ? '<li><strong>' + verifyCalls.length + '</strong> verification call' + (verifyCalls.length === 1 ? '' : 's') + ' observed</li>' : '',
      commits.length ? '<li><strong>' + commits.length + '</strong> correlated commit' + (commits.length === 1 ? '' : 's') + '</li>' : '',
    ].filter(Boolean).join('');
    const paths = editPaths.length
      ? '<div class="session-outcome-paths"><span>Observed edit paths</span><div>' + editPaths.map(path => '<code>' + escape(path) + '</code>').join('') + '</div></div>'
      : '';
    const patchNotice = editCalls.length
      ? '<p class="session-patch-unavailable">Session-scoped patch was not retained; the current worktree is not used as this Turn’s diff.</p>'
      : '';
    const response = turn.response
      ? '<article class="session-event response" data-session-event="responses"><div class="session-response-label">Assistant response</div><div class="session-event-body session-markdown">' + renderSessionMarkdown(turn.response) + '</div></article>'
      : '<article class="session-event response session-unavailable" data-session-event="responses"><div class="session-event-body"><p>' + (responseStatus === 'incomplete' ? 'A later tool call was observed after the last assistant message, so no terminal response is claimed.' : 'No terminal assistant response was retained after privacy filtering.') + '</p></div></article>';
    return '<section class="session-outcome" aria-label="Turn ' + turn.index + ' outcome"><header><strong>Outcome</strong><span data-response-status="' + escape(responseStatus) + '">' + escape(statusLabel) + '</span></header>'
      + (facts ? '<ul class="session-outcome-facts">' + facts + '</ul>' : '<p class="session-outcome-empty">No edit, verification, or commit evidence was attributed to this Turn.</p>')
      + paths + patchNotice + response + commits.map(commit => commitEventMarkup(session,commit,'within this turn window')).join('') + '</section>';
  }

  function commitEventMarkup(session, commit, relation) {
    return '<article class="session-event commit" data-session-event="commits" id="session-commit-' + escape(commit.shortHash) + '"><div class="commit-head">'
      + '<header class="session-event-head"><strong>' + escape(commit.shortHash) + ' · ' + escape(commit.subject) + '</strong><span>' + commit.fileCount + ' files</span></header>'
      + '<div class="session-event-body"><p>+' + commit.linesAdded + ' / -' + commit.linesRemoved + ' · ' + escape(formatClock(commit.committedAt ?? commit.authoredAt)) + ' · committed ' + escape(relation) + ' · shared paths remain contextual.</p></div></div></article>';
  }

  function sessionViewMarkup(item) {
    const session = item.session;
    const commits = commitsFor(item);
    const callsById = callsBySession.get(session.sessionId) ?? new Map();
    const title = item.story?.title ?? session.prompts?.[0]?.text ?? session.locator;
    const toolCounts = new Map();
    session.toolActivity.calls.forEach(call => toolCounts.set(call.toolName,(toolCounts.get(call.toolName) ?? 0) + 1));
    const rankedTools = [...toolCounts.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const fallbackTurns = session.prompts.map((prompt,index) => {
      const turnIndex = prompt.turnIndex ?? index + 1;
      return { index:turnIndex, anchorId:'turn-' + turnIndex, prompt, steps:[], response:null, durationMs:null, toolCallCount:0, messageCount:0 };
    });
    const turns = session.dialogue?.turns?.length ? session.dialogue.turns : fallbackTurns;
    const placement = placeCommits(commits,turns,session);
    const turnEvents = turns.map(turn => {
      const anchor = turn.anchorId ?? ('turn-' + turn.index);
      const prompt = '<article class="session-event prompt" data-session-event="prompts"><div class="session-event-body session-prose"><p>' + escape(turn.prompt?.text ?? 'Prompt unavailable after privacy filtering') + '</p></div></article>';
      const calls = turn.steps.filter(step => step.kind === 'tool').map(step => callsById.get(step.callId)).filter(Boolean);
      const turnToolNames = [...new Set(calls.map(call => call.toolName).filter(Boolean))];
      const observedCallTimes = calls.map(call => call.startedAt).filter(Number.isFinite);
      const observedCallWindow = observedCallTimes.length
        ? formatShortClock(Math.min(...observedCallTimes)) + '–' + formatShortClock(Math.max(...observedCallTimes)) + ' UTC'
        : 'timing unavailable';
      // One plain fact line instead of a bordered sub-grid: the same retained
      // counts, tools, and observed window without adding a nested frame.
      const processEvidence = calls.length ? '<p class="session-process-facts">' + calls.length + ' retained calls · ' + escape(turnToolNames.slice(0,3).join(' · ') || 'tools unavailable') + (turnToolNames.length > 3 ? ' +' + (turnToolNames.length - 3) : '') + ' · ' + escape(observedCallWindow) + '</p>' : '';
      const processTimeline = calls.length ? '<section class="session-turn-activity" aria-label="Turn ' + turn.index + ' activity timeline"><div data-activity-chart="' + escape(session.sessionId) + '" data-activity-turn="' + turn.index + '"></div></section>' : '';
      const clock = Number.isFinite(turn.startMs) ? formatShortClock(turn.startMs) + (Number.isFinite(turn.endMs) ? '–' + formatShortClock(turn.endMs) : '') + ' UTC · ' : '';
      const intermediateCount = Number.isInteger(turn.intermediateCount) ? turn.intermediateCount : turn.steps.filter(step => step.kind === 'note').length;
      const usageEventCount = Number.isInteger(turn.usageEventCount) ? turn.usageEventCount : turn.steps.filter(step => step.kind === 'usage').length;
      const eventCount = Number.isInteger(turn.eventCount) ? turn.eventCount : intermediateCount + usageEventCount + turn.toolCallCount;
      const shownEventCount = Number.isInteger(turn.shownEventCount) ? turn.shownEventCount : turn.steps.length;
      const truncationSummary = turn.processTruncated ? shownEventCount + ' of ' + eventCount + ' process events retained · ' : eventCount + ' process events · ';
      const kindSummary = usageEventCount + ' model response' + (usageEventCount === 1 ? '' : 's') + ' · ' + intermediateCount + ' intermediate response' + (intermediateCount === 1 ? '' : 's') + ' · ' + turn.toolCallCount + ' tool calls' + (turn.processTruncated ? ' observed' : '');
      const summary = clock + truncationSummary + kindSummary + (Number.isFinite(turn.durationMs) ? ' · ' + formatDuration(turn.durationMs) : '');
      const turnCommits = placement.inTurn.get(turn.index) ?? [];
      const processStream = processStreamMarkup(session,turn,callsById);
      const process = processStream
        ? '<details class="session-process"><summary><span>Process trace</span><em>' + shownEventCount + (turn.processTruncated ? ' of ' + eventCount : '') + ' retained events · observed order</em></summary><div class="session-process-body">' + processEvidence + processTimeline + '<div class="session-process-stream">' + processStream + '</div></div></details>'
        : '<div class="session-process session-process-empty"><span>Process</span><em>No retained process evidence</em></div>';
      const outcome = turnOutcomeMarkup(session,turn,calls,turnCommits);
      return '<section class="session-cell" data-session-cell="run"><header class="session-turn-head"><strong>Turn ' + turn.index + '</strong><span>' + escape(summary) + '</span></header><section class="session-turn" id="session-' + escape(anchor) + '" data-turn-index="' + turn.index + '"><div class="session-row-marker session-input-marker"><span class="turn-select">In [' + turn.index + ']</span></div>' + prompt + '<div class="session-row-marker session-process-marker" aria-hidden="true"></div>' + process + '<div class="session-row-marker session-output-marker"><span>Out [' + turn.index + ']</span></div><div class="session-cell-output">' + outcome + '</div></section></section>';
    }).join('');

    const placedCallIds = new Set(turns.flatMap(turn => turn.steps.filter(step => step.kind === 'tool').map(step => step.callId)));
    // Order the page-tail bucket by observed start time so a session with no
    // dialogue Turns still reads as a trace. This reuses the same startedAt the
    // timeline strip plots; it never infers a time the host did not observe.
    const unplacedCalls = session.toolActivity.calls
      .filter(call => !placedCallIds.has(call.id))
      .slice()
      .sort((left,right) => {
        const leftTime = Number.isFinite(left.startedAt) ? left.startedAt : Infinity;
        const rightTime = Number.isFinite(right.startedAt) ? right.startedAt : Infinity;
        return leftTime - rightTime || String(left.id).localeCompare(String(right.id));
      });
    const unplacedFiles = unplacedCalls.length || turns.length === 0 ? session.toolActivity.files : [];
    const unplacedFileEvent = unplacedFiles.length
      ? '<article class="session-event files"><header class="session-event-head"><strong>' + unplacedFiles.length + ' attributed file path' + (unplacedFiles.length === 1 ? '' : 's') + '</strong><span>observed tool evidence</span></header><div class="session-file-list">' + unplacedFiles.map(file => '<code>' + escape(file.path) + '</code>').join('') + '</div></article>'
      : '';
    const unplacedToolSummary = (() => {
      const grouped = new Map();
      unplacedCalls.forEach(call => grouped.set(call.toolName, (grouped.get(call.toolName) ?? 0) + 1));
      return [...grouped.entries()].sort((a,b) => b[1] - a[1]).map(([name,count]) => escape(name) + ' ×' + count).join(' · ');
    })();
    const unplacedToolEvent = unplacedCalls.length
      ? '<details class="session-event tools" data-session-event="tools"><summary class="session-event-head"><strong>' + unplacedCalls.length + ' tool call' + (unplacedCalls.length === 1 ? '' : 's') + '</strong><span>' + escape(unplacedToolSummary) + '</span></summary>' + toolListMarkup(session,unplacedCalls) + '</details>'
      : '';
    const unplacedMarkup = unplacedToolEvent || unplacedFileEvent
      ? '<section class="session-cell session-unplaced" id="session-unplaced" data-session-cell="unplaced"><header class="session-turn-head"><strong>Unplaced evidence</strong><span>' + unplacedCalls.length + ' calls · ' + unplacedFiles.length + ' files</span></header><div class="session-cell-marker"><span>[ ]</span></div><section class="session-turn">' + unplacedToolEvent + unplacedFileEvent + '</section></section>'
      : '';
    const outsideMarkup = placement.outside.length
      ? '<section class="session-cell session-outside" id="session-outside-commits" data-session-cell="outside"><header class="session-turn-head"><strong>Commits outside turn windows</strong><span>' + placement.outside.length + ' commit' + (placement.outside.length === 1 ? '' : 's') + '</span></header><div class="session-cell-marker"><span>[ ]</span></div><section class="session-turn"><div class="session-outside-note">Timestamps fall outside every observed Turn window.</div>' + placement.outside.map(entry => commitEventMarkup(session,entry.commit,entry.relation)).join('') + '</section></section>'
      : '';

    const jumpOptions = turns.map(turn => '<option value="session-' + escape(turn.anchorId ?? ('turn-' + turn.index)) + '">In [' + turn.index + ']' + (Number.isFinite(turn.startMs) ? ' · ' + formatShortClock(turn.startMs) : '') + '</option>').join('')
      + (unplacedMarkup ? '<option value="session-unplaced">Unplaced evidence</option>' : '')
      + (outsideMarkup ? '<option value="session-outside-commits">Commits outside turn windows</option>' : '');
    const timeline = turnEvents + unplacedMarkup + outsideMarkup || '<div class="empty-state">No retained dialogue or observed evidence exists for this session.</div>';
    const toolFilters = rankedTools.slice(0,8).map(([toolName,count]) => '<label class="session-filter subtype"><input type="checkbox" checked data-session-tool-filter="' + escape(toolName) + '"><span>' + escape(toolName) + '</span><em>' + count + '</em></label>').join('');
    const responseCount = session.dialogue?.responseCount ?? turns.filter(turn => turn.response).length;
    const noteCount = session.dialogue?.noteCount ?? turns.reduce((sum,turn) => sum + turn.steps.filter(step => step.kind === 'note').length,0);
    const usageCount = turns.reduce((sum,turn) => sum + (turn.usageEventCount ?? turn.steps.filter(step => step.kind === 'usage').length),0);
    const compactFilters = '<details class="session-filter-disclosure"><summary><span>Evidence filters</span><em>' + session.toolActivity.totalCalls + ' calls</em></summary><div class="session-filter-list"><label class="session-filter"><input type="checkbox" checked data-session-kind-filter="prompts"><span>Prompts</span><em>' + turns.length + '</em></label><label class="session-filter"><input type="checkbox" checked data-session-kind-filter="responses"><span>Results</span><em>' + responseCount + '</em></label><label class="session-filter"><input type="checkbox" checked data-session-kind-filter="intermediate"><span>Intermediate</span><em>' + noteCount + '</em></label><label class="session-filter"><input type="checkbox" checked data-session-kind-filter="usage"><span>Model usage</span><em>' + usageCount + '</em></label><label class="session-filter"><input type="checkbox" checked data-session-kind-filter="commits"><span>Commits</span><em>' + commits.length + '</em></label><label class="session-filter"><input type="checkbox" checked data-session-kind-filter="tools"><span>Tool calls</span><em>' + session.toolActivity.totalCalls + '</em></label>' + toolFilters + '<label class="session-filter subtype"><input type="checkbox" checked data-session-file-filter><span>File paths</span><em>' + session.toolActivity.files.length + '</em></label></div></details>';
    const compactFacts = '<section class="session-facts-compact session-outline-facts" aria-labelledby="session-facts-title"><h3 id="session-facts-title">Session facts</h3><dl><div><dt>Runtime</dt><dd>' + escape(session.platform) + '</dd></div><div><dt>Model</dt><dd title="' + escape(session.models.join(', ') || 'unavailable') + '">' + escape(session.models.join(', ') || 'unavailable') + '</dd></div><div><dt>Duration</dt><dd>' + escape(formatDuration(session.durationMs)) + '</dd></div></dl></section>';
    const sessionOutline = '<aside class="session-sidebar" aria-label="Session outline"><header><strong>Session outline</strong></header><section class="session-outline-controls"><select class="jump-select" aria-label="Jump to Session cell" data-session-jump>' + jumpOptions + '</select></section>' + compactFilters + compactFacts + usageContextMarkup(session) + '</aside>';
    const overallActivity = session.toolActivity.totalCalls ? '<section class="session-overall-activity"><details class="session-axis-panel" data-session-axis><summary><span>Overall session activity <em>' + session.toolActivity.totalCalls + ' calls</em></span><small>All retained Turns and unplaced calls</small></summary><div class="session-axis" data-activity-chart="' + escape(session.sessionId) + '"></div></details></section>' : '';
    const tracePanel = '<section class="session-mode-panel" id="session-panel-trace" role="tabpanel" aria-labelledby="session-tab-trace" data-session-mode-panel="trace" tabindex="-1">'
      + '<div class="session-layout"><main class="session-notebook-main"><div class="session-timeline" aria-label="Session run cells">' + overallActivity + timeline + '</div></main>' + sessionOutline + '</div></section>';
    const replayPanel = '<section class="session-mode-panel replay-shell" id="session-panel-replay" role="tabpanel" aria-labelledby="session-tab-replay" data-session-mode-panel="replay" hidden>'
      + '<div class="replay-boundary"><strong>Read-only evidence playback</strong><span>Replay advances through retained evidence. It never reruns tools, resumes the host session, or invents missing time.</span></div>'
      + '<div class="replay-layout"><main class="replay-stage" tabindex="0" aria-label="Current replay event; J and L move between events, Space toggles playback" data-replay-stage aria-live="polite"></main><aside class="replay-index"><div class="replay-index-tabs" role="tablist" aria-label="Replay index"><button type="button" id="replay-index-tab-events" role="tab" aria-controls="replay-index-body" aria-selected="true" tabindex="0" data-replay-index-tab="events">Events <span>' + session.replay.eventCount + '</span></button><button type="button" id="replay-index-tab-files" role="tab" aria-controls="replay-index-body" aria-selected="false" tabindex="-1" data-replay-index-tab="files">Files <span>' + session.replay.files.length + '</span></button></div><div class="replay-index-body" id="replay-index-body" role="tabpanel" aria-labelledby="replay-index-tab-events" data-replay-index-body></div></aside></div>'
      + '<section class="replay-transport" aria-label="Replay controls"><div class="replay-rail-head"><strong>Session timeline</strong><span data-replay-range></span></div><div class="replay-rail" data-replay-rail></div><div class="replay-rail-legend">' + replayLegendMarkup(session.replay) + '</div><div class="replay-controls"><button type="button" data-replay-step="-1">Previous event <kbd>J</kbd></button><button type="button" class="replay-play" data-replay-play>Play <kbd>Space</kbd></button><button type="button" data-replay-step="1">Next event <kbd>L</kbd></button><span class="replay-position" data-replay-position></span><div class="replay-speeds" aria-label="Replay speed">' + [1,2,4,8].map(speed => '<button type="button" data-replay-speed="' + speed + '" aria-pressed="' + String(speed === state.replaySpeed) + '">' + speed + 'x</button>').join('') + '</div></div></section></section>';
    const modeTabs = '<div class="session-mode-tabs" role="tablist" aria-label="Session view mode"><button type="button" id="session-tab-trace" role="tab" aria-controls="session-panel-trace" aria-selected="true" tabindex="0" data-session-mode="trace">Trace</button><button type="button" id="session-tab-replay" role="tab" aria-controls="session-panel-replay" aria-selected="false" tabindex="-1" data-session-mode="replay">Replay</button></div>';
    const usageReturn = '<button class="usage-report-return" type="button" data-session-mode="trace" hidden>Back to Trace</button>';
    return { title, html:'<div class="session-shell"><header class="session-titlebar"><div class="session-notebook-brand"><strong>Harness Inspector</strong></div><div class="session-title-copy"><h2>' + escape(title) + '</h2></div><div class="session-title-actions">' + modeTabs + usageReturn + '</div></header>' + tracePanel + replayPanel + usageReportMarkup(session) + '</div>' };
  }

  function replayModel() {
    return state.sessionItem?.session?.replay ?? null;
  }

  function replayCurrentEvent() {
    const replay = replayModel();
    return replay?.events.find(event => event.id === state.replayEventId) ?? replay?.events[0] ?? null;
  }

  function replayTiming(event) {
    if (!event) return 'No event selected';
    if (event.timeBasis === 'observed') return formatStamp(event.atMs) + ' UTC · observed time';
    if (event.timeBasis === 'turn-boundary') return formatStamp(event.atMs) + ' UTC · Turn boundary, not exact event time';
    return 'Sequence only · timestamp unavailable';
  }

  /* The rail paints one colour per event type, so name only the types this
     session actually retained. */
  function replayLegendMarkup(replay) {
    const present = new Set(replay.events.map(event => event.type));
    const entries = [['prompt','Prompt'],['intermediate','Intermediate'],['response','Response'],['tool-call','Tool call'],['commit','Commit']]
      .filter(([type]) => present.has(type));
    if (replay.events.some(event => event.status === 'failed')) entries.push(['failed','Failed']);
    return entries.map(([type,label]) => '<span class="' + type + '">' + label + '</span>').join('');
  }

  function replayStageMarkup(event) {
    if (!event) return '<div class="empty-state">No retained replay event exists for this session.</div>';
    const files = event.files?.length
      ? '<div class="replay-stage-files"><strong>Files</strong>' + event.files.map(file => '<button type="button" data-replay-file="' + escape(file) + '"><code>' + escape(file) + '</code></button>').join('') + '</div>'
      : '';
    const unavailable = event.availability === 'unavailable' ? '<span class="replay-availability">Content unavailable</span>' : '';
    const excerpt = event.bodyExcerpt ? '<span class="replay-excerpt" title="The projection retained a bounded excerpt of this content.">Excerpt</span>' : '';
    const status = event.status === 'failed' ? '<span class="replay-status failed">Failed</span>' : '';
    return '<article class="replay-event-card ' + escape(event.type) + '"><header><div><small>' + escape(event.label) + '</small><h3>' + escape(event.title) + '</h3></div><div class="replay-event-badges">' + status + unavailable + excerpt + '</div></header>'
      + '<div class="replay-event-meta"><span>' + escape(replayTiming(event)) + '</span>' + (event.meta ? '<code>' + escape(event.meta) + '</code>' : '') + (Number.isFinite(event.durationMs) ? '<span>' + escape(formatLatency(event.durationMs)) + '</span>' : '') + '</div>'
      + '<div class="replay-event-body"><p>' + escape(event.body) + '</p></div>' + files
      + '<footer><span>' + (event.turnIndex ? 'Turn ' + event.turnIndex : 'Outside any observed Turn') + '</span></footer></article>';
  }

  function renderReplayIndex() {
    const replay = replayModel();
    const body = document.querySelector('[data-replay-index-body]');
    if (!replay || !body) return;
    document.querySelectorAll('[data-replay-index-tab]').forEach(tab => {
      const selected = tab.dataset.replayIndexTab === state.replayIndexTab;
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    body.setAttribute('aria-labelledby','replay-index-tab-' + state.replayIndexTab);
    if (state.replayIndexTab === 'files') {
      body.innerHTML = replay.files.length
        ? '<div class="replay-file-list">' + replay.files.map(file => '<button type="button" data-replay-file="' + escape(file.path) + '"><code>' + escape(file.path) + '</code><span>' + file.eventIds.length + ' events</span></button>').join('') + '</div>'
        : '<div class="empty-state">No repository-relative file was retained for Replay.</div>';
      return;
    }
    body.innerHTML = '<div class="replay-event-list">' + replay.events.map(event => { const current = event.id === state.replayEventId; return '<button type="button"' + (current ? ' class="replay-current"' : '') + ' data-replay-event="' + escape(event.id) + '" aria-current="' + (current ? 'step' : 'false') + '"><span class="replay-event-order">' + event.order + '</span><span class="replay-event-copy"><strong>' + escape(event.title) + '</strong><small>' + escape(replayTiming(event)) + '</small></span><span class="replay-event-kind">' + escape(event.type.replace('-', ' ')) + '</span></button>'; }).join('') + '</div>';
    keepReplayIndexRowVisible();
  }

  function renderReplayRail() {
    const replay = replayModel();
    const rail = document.querySelector('[data-replay-rail]');
    const range = document.querySelector('[data-replay-range]');
    if (!replay || !rail || !range) return;
    const timed = replay.events.filter(event => Number.isFinite(event.atMs));
    const start = replay.startMs;
    const end = replay.endMs;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || timed.length === 0) {
      range.textContent = 'Sequence axis · no observed event timing';
      rail.innerHTML = '<div class="replay-sequence-rail"><span>1</span><div></div><span>' + replay.eventCount + '</span></div>';
      return;
    }
    range.textContent = formatShortClock(start) + ' → ' + formatShortClock(end) + ' UTC · ' + formatSpan(end - start);
    const span = Math.max(1,end - start);
    const bins = new Map();
    const binCount = 120;
    for (const event of timed) {
      const index = Math.min(binCount - 1,Math.max(0,Math.floor(((event.atMs - start) / span) * binCount)));
      const bin = bins.get(index) ?? { index, events:[], failed:false };
      bin.events.push(event);
      if (event.status === 'failed') bin.failed = true;
      bins.set(index,bin);
    }
    const marks = [...bins.values()].map(bin => {
      const first = bin.events[0];
      const label = bin.events.length + ' event' + (bin.events.length === 1 ? '' : 's') + ' near ' + formatStamp(first.atMs) + ' UTC';
      return '<button type="button" class="replay-rail-mark ' + escape(first.type) + (bin.failed ? ' failed' : '') + '" data-replay-event="' + escape(first.id) + '" style="left:' + ((bin.index / binCount) * 100) + '%;width:' + Math.max(0.7,100 / binCount) + '%" aria-label="' + escape(label) + '" title="' + escape(label) + '"></button>';
    }).join('');
    rail.innerHTML = '<div class="replay-rail-track"><span class="replay-rail-fill"></span>' + marks + '<span class="replay-rail-cursor" data-replay-cursor></span></div><div class="replay-rail-labels"><span>' + escape(formatShortClock(start)) + '</span><span>' + escape(formatShortClock(end)) + '</span></div>';
    rail.dataset.startMs = String(start);
    rail.dataset.endMs = String(end);
  }

  /* Only the index's own scroller moves, so following the current event can never
     scroll Session View or the page underneath it. */
  function keepReplayIndexRowVisible() {
    const body = document.querySelector('[data-replay-index-body]');
    const row = body?.querySelector('.replay-event-list .replay-current');
    if (!body || !row) return;
    const view = body.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top >= view.top && target.bottom <= view.bottom) return;
    body.scrollTop += target.top - view.top - Math.max(0,(view.height - target.height) / 2);
  }

  function updateReplayPresentation() {
    const replay = replayModel();
    const event = replayCurrentEvent();
    if (!replay) return;
    const stage = document.querySelector('[data-replay-stage]');
    if (stage) stage.innerHTML = replayStageMarkup(event);
    document.querySelectorAll('[data-replay-event]').forEach(row => {
      const current = row.dataset.replayEvent === event?.id;
      row.classList.toggle('replay-current',current);
      if (row.closest('.replay-event-list')) row.setAttribute('aria-current',current ? 'step' : 'false');
    });
    keepReplayIndexRowVisible();
    const cursor = document.querySelector('[data-replay-cursor]');
    if (cursor) {
      const start = Number(cursor.closest('[data-replay-rail]')?.dataset.startMs);
      const end = Number(cursor.closest('[data-replay-rail]')?.dataset.endMs);
      if (Number.isFinite(event?.atMs) && end > start) {
        cursor.style.left = Math.min(100,Math.max(0,((event.atMs - start) / (end - start)) * 100)) + '%';
        cursor.hidden = false;
      } else cursor.hidden = true;
    }
    const position = document.querySelector('[data-replay-position]');
    if (position) position.textContent = 'Event ' + (event ? event.order : 0) + ' / ' + replay.eventCount;
    const play = document.querySelector('[data-replay-play]');
    if (play) {
      play.innerHTML = (state.replayPlaying ? 'Pause' : 'Play') + ' <kbd>Space</kbd>';
      play.setAttribute('aria-pressed',String(state.replayPlaying));
    }
    document.querySelectorAll('[data-replay-speed]').forEach(button => button.setAttribute('aria-pressed',String(Number(button.dataset.replaySpeed) === state.replaySpeed)));
  }

  function renderReplay() {
    const replay = replayModel();
    if (!replay) return;
    if (!replay.events.some(event => event.id === state.replayEventId)) {
      state.replayEventId = replay.events[0]?.id ?? null;
    }
    renderReplayIndex();
    renderReplayRail();
    updateReplayPresentation();
  }

  function stopReplay() {
    if (state.replayTimer) clearTimeout(state.replayTimer);
    state.replayTimer = null;
    state.replayPlaying = false;
    updateReplayPresentation();
  }

  function scheduleReplay() {
    if (!state.replayPlaying) return;
    if (state.replayTimer) clearTimeout(state.replayTimer);
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    const delay = Math.max(reducedMotion ? 220 : 90,900 / state.replaySpeed);
    state.replayTimer = setTimeout(() => {
      state.replayTimer = null;
      const replay = replayModel();
      const current = replay?.events.findIndex(event => event.id === state.replayEventId) ?? -1;
      if (!replay || current >= replay.events.length - 1) {
        stopReplay();
        return;
      }
      setReplayEvent(replay.events[current + 1].id,{ updateHistory:true });
      scheduleReplay();
    },delay);
  }

  function setReplayPlaying(playing) {
    const replay = replayModel();
    if (!replay?.events.length) return;
    if (!playing) {
      stopReplay();
      return;
    }
    if (replay.events.at(-1)?.id === state.replayEventId) state.replayEventId = replay.events[0].id;
    state.replayPlaying = true;
    updateReplayPresentation();
    updateUrl();
    scheduleReplay();
  }

  function setReplayEvent(eventId,{ updateHistory = true } = {}) {
    const replay = replayModel();
    const event = replay?.events.find(candidate => candidate.id === eventId);
    if (!event) return;
    state.replayEventId = event.id;
    updateReplayPresentation();
    if (updateHistory) updateUrl();
  }

  function stepReplay(delta) {
    const replay = replayModel();
    if (!replay?.events.length) return;
    const current = Math.max(0,replay.events.findIndex(event => event.id === state.replayEventId));
    const next = Math.max(0,Math.min(replay.events.length - 1,current + delta));
    setReplayEvent(replay.events[next].id);
    if (state.replayPlaying && next === replay.events.length - 1) stopReplay();
  }

  function setSessionMode(mode,{ updateHistory = true, restoreFocus = false } = {}) {
    const next = mode === 'replay' || mode === 'usage' ? mode : 'trace';
    state.sessionMode = next;
    if (next !== 'replay') stopReplay();
    document.querySelectorAll('.session-mode-tabs [data-session-mode]').forEach(tab => {
      const selected = tab.dataset.sessionMode === next;
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    const modeTabs = document.querySelector('.session-mode-tabs');
    const usageReturn = document.querySelector('.usage-report-return');
    if (modeTabs) modeTabs.hidden = next === 'usage';
    if (usageReturn) usageReturn.hidden = next !== 'usage';
    document.querySelectorAll('[data-session-mode-panel]').forEach(panel => { panel.hidden = panel.dataset.sessionModePanel !== next; });
    if (next === 'replay') renderReplay();
    if (next === 'trace' && restoreFocus) requestAnimationFrame(() => document.querySelector('[data-session-mode-panel="trace"]')?.focus({ preventScroll:true }));
    if (updateHistory) updateUrl();
  }

  function applySessionFilters() {
    document.querySelectorAll('[data-session-kind-filter]').forEach(input => {
      document.querySelectorAll('[data-session-event="' + CSS.escape(input.dataset.sessionKindFilter) + '"]').forEach(element => {
        element.classList.toggle('session-hidden',!input.checked);
      });
      if (input.dataset.sessionKindFilter === 'prompts') {
        document.querySelectorAll('.session-input-marker').forEach(element => {
          element.classList.toggle('session-hidden',!input.checked);
        });
      }
    });
    document.querySelectorAll('[data-session-tool-filter]').forEach(input => {
      const selector = '[data-tool="' + CSS.escape(input.dataset.sessionToolFilter) + '"]';
      document.querySelectorAll('.session-tool-row' + selector + ', details.session-tool-run' + selector + ', .session-process-tool-name' + selector).forEach(row => {
        row.classList.toggle('session-hidden',!input.checked);
      });
    });
    const showFiles = document.querySelector('[data-session-file-filter]')?.checked !== false;
    document.querySelectorAll('.session-tool-file, .session-outcome-paths, .session-event.files').forEach(element => {
      element.classList.toggle('session-hidden',!showFiles);
    });
    document.querySelectorAll('[data-session-process-group]').forEach(group => {
      const toolSummary = group.querySelector(':scope > summary > [data-session-event="tools"]');
      const usageSummary = group.querySelector(':scope > summary > [data-session-event="usage"]');
      const visibleToolRows = [...group.querySelectorAll('.session-tool-row')].filter(row => !row.closest('.session-hidden'));
      const toolsVisible = toolSummary && !toolSummary.classList.contains('session-hidden') && visibleToolRows.length > 0;
      const usageVisible = usageSummary && !usageSummary.classList.contains('session-hidden');
      toolSummary?.classList.toggle('session-hidden',!toolsVisible);
      group.querySelector(':scope > .session-process-tool-body')?.classList.toggle('session-hidden',!toolsVisible);
      const toolCount = toolSummary?.querySelector('strong');
      if (toolCount && toolsVisible) toolCount.textContent = visibleToolRows.length + ' tool call' + (visibleToolRows.length === 1 ? '' : 's');
      const toolNames = toolSummary?.querySelector('.session-process-tool-names');
      if (toolNames && toolsVisible) toolNames.textContent = [...new Set(visibleToolRows.map(row => row.dataset.tool))].slice(0,3).join(' · ');
      group.classList.toggle('session-hidden',!toolsVisible && !usageVisible);
      group.dataset.toolsVisible = String(Boolean(toolsVisible));
      group.dataset.usageVisible = String(Boolean(usageVisible));
      if (!toolsVisible) group.open = false;
    });
    const toolsEm = document.querySelector('[data-session-kind-filter="tools"]')?.closest('.session-filter')?.querySelector('em');
    if (toolsEm) {
      let visible = 0;
      document.querySelectorAll('#session-view .session-tool-row').forEach(row => {
        if (row.closest('.session-tool-run')) return;
        if (!row.closest('.session-hidden')) visible += 1;
      });
      document.querySelectorAll('#session-view details.session-tool-run').forEach(run => {
        if (!run.closest('.session-hidden')) visible += Number(run.dataset.callCount) || 0;
      });
      toolsEm.textContent = String(visible);
    }
  }

  let jumpObserver = null;

  // Scroll-spy keeps "Jump to" reporting where the reader actually is; a static
  // select stuck on Turn 1 is not navigation for a fifty-turn session.
  function observeTurnsForJump() {
    jumpObserver?.disconnect();
    jumpObserver = null;
    const select = document.querySelector('[data-session-jump]');
    const view = document.getElementById('session-view');
    if (!select || !view || typeof IntersectionObserver !== 'function') return;
    const order = [...view.querySelectorAll('.session-turn')].map(section => section.id);
    const visible = new Set();
    jumpObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const top = order.find(id => visible.has(id));
      if (top && select.value !== top) select.value = top;
    },{ root:view, rootMargin:'-8% 0px -72% 0px', threshold:0 });
    view.querySelectorAll('.session-turn').forEach(section => jumpObserver.observe(section));
  }

  function revealSessionTarget(target) {
    if (!target) return;
    target.closest('.session-call-overflow')?.removeAttribute('hidden');
    let run = target.closest('details.session-tool-run');
    while (run) {
      run.open = true;
      run = run.parentElement?.closest('details.session-tool-run');
    }
    const tools = target.closest('details.session-event.tools');
    if (tools) tools.open = true;
    const process = target.closest('details.session-process');
    if (process) process.open = true;
    target.scrollIntoView({ block:'center' });
  }

  function openSessionView(item,trigger = document.activeElement,{ updateHistory = true } = {}) {
    const view = sessionViewMarkup(item);
    const params = new URLSearchParams(location.search);
    const restoringThisSession = params.get('session') === item.session.sessionId;
    const changingSession = state.sessionItem?.session?.sessionId !== item.session.sessionId;
    if (changingSession) {
      state.replayEventId = restoringThisSession ? params.get('replay-event') : null;
      const restoredMode = params.get('session-mode');
      state.sessionMode = restoringThisSession && (restoredMode === 'replay' || restoredMode === 'usage') ? restoredMode : 'trace';
      state.replayIndexTab = 'events';
    }
    state.sessionItem = item;
    state.sessionTrigger = trigger;
    state.sessionOpen = true;
    document.getElementById('session-view-title').textContent = view.title;
    document.getElementById('session-view-body').innerHTML = view.html;
    document.getElementById('session-view').hidden = false;
    document.body.classList.add('session-open');
    document.getElementById('session-view-close').focus();
    setSessionMode(state.sessionMode,{ updateHistory:false });
    if (updateHistory) {
      state.sessionPushed = true;
      updateUrl({ push:true });
    }
    requestAnimationFrame(() => {
      const axis = document.querySelector('[data-session-mode-panel="trace"] [data-session-axis] [data-activity-chart]');
      if (axis && !axis.childElementCount) {
        renderActivityChart(axis);
        chartObserver?.observe(axis);
      }
      observeTurnsForJump();
    });
  }

  function teardownSessionView() {
    stopReplay();
    jumpObserver?.disconnect();
    jumpObserver = null;
    state.sessionOpen = false;
    state.sessionItem = null;
    state.sessionMode = 'trace';
    state.replayEventId = null;
    state.replayIndexTab = 'events';
    document.getElementById('session-view').hidden = true;
    document.getElementById('session-view-body').innerHTML = '';
    document.body.classList.remove('session-open');
    const trigger = state.sessionTrigger;
    state.sessionTrigger = null;
    if (trigger?.isConnected) trigger.focus();
  }

  function closeSessionView() {
    // The Session View owns a history entry, so Back and Close agree.
    if (state.sessionPushed) {
      state.sessionPushed = false;
      history.back();
      return;
    }
    teardownSessionView();
    updateUrl();
  }

  function itemForSession(session) {
    if (!session) return null;
    return state.items?.find(candidate => candidate.session?.sessionId === session.sessionId)
      ?? { story:null, session, link:{ evidenceKind:'contextual', confidence:'session-view' }, date:null };
  }

  function urlForState() {
    const url = new URL(location.href);
    ['feature','date','session','view','session-mode','replay-event'].forEach(key => url.searchParams.delete(key));
    url.searchParams.set('mode',state.mode);
    if (state.mode === 'feature' && state.scope) url.searchParams.set('feature',state.scope);
    if (state.mode === 'date' && state.scope) url.searchParams.set('date',state.scope);
    // Session View is a navigable state, so a copied link reopens the surface
    // the reviewer was reading rather than the workbench behind it.
    if (state.sessionOpen) {
      url.searchParams.set('view','session');
      const sessionId = state.sessionItem?.session?.sessionId;
      if (sessionId) url.searchParams.set('session',sessionId);
      if (state.sessionMode === 'replay' || state.sessionMode === 'usage') {
        url.searchParams.set('session-mode',state.sessionMode);
      }
      if (state.sessionMode === 'replay') {
        if (state.replayEventId) url.searchParams.set('replay-event',state.replayEventId);
      }
    }
    return url;
  }

  function updateUrl({ push = false } = {}) {
    if (state.syncingHistory) return;
    const url = urlForState();
    if (push) history.pushState({ view:'session' },'',url);
    else history.replaceState(null,'',url);
  }

  function setPickerCollapsed(collapsed) {
    const app = document.querySelector('.app');
    const toggle = document.querySelector('[data-toggle-picker]');
    app.classList.toggle('picker-collapsed',collapsed);
    toggle?.setAttribute('aria-expanded',String(!collapsed));
    toggle?.setAttribute('aria-label',collapsed ? 'Expand capability tree' : 'Collapse capability tree');
  }

  function renderScopeIndex(items) {
    const wrapper = document.querySelector('.scope-index');
    const select = document.getElementById('scope-index');
    if (!wrapper || !select) return;
    wrapper.hidden = state.mode === 'date' || items.length < 4;
    select.innerHTML = '<option value="">Jump to workbench…</option>' + items.map((item,index) => {
      const label = itemTitle(item);
      return '<option value="workbench-card-' + index + '">' + escape([...label].length > 46 ? [...label].slice(0,45).join('') + '…' : label) + '</option>';
    }).join('');
  }

  function renderDateSessionNavigator(items) {
    const list = document.querySelector('[data-date-session-list]');
    const count = document.querySelector('[data-date-session-count]');
    if (!list || !count) return;
    const sessions = items.map((item,index) => ({ item,index })).filter(entry => entry.item.session);
    count.textContent = String(sessions.length);
    list.innerHTML = sessions.map(({ item,index }) => {
      const session = item.session;
      const title = itemTitle(item);
      const calls = session.toolActivity.totalCalls;
      const contextSummary = sessionContextSnapshotPresentation(session);
      const tokenSummary = contextSummary.compact ? '<span class="date-session-token-summary" title="' + escape(contextSummary.title) + '">' + escape(contextSummary.compact) + '</span>' : '';
      const label = 'Locate ' + session.platform + ' Session at ' + formatClock(session.firstSeen) + ': ' + title;
      return '<button class="date-session-row" type="button" data-date-session-target="workbench-card-' + index + '" aria-label="' + escape(label) + '"><span class="date-session-row-top"><span class="date-session-row-meta"><strong>' + escape(session.platform) + '</strong><time>' + escape(formatClock(session.firstSeen)) + '</time><span>' + escape(formatDuration(session.durationMs)) + '</span></span><span class="date-session-row-stat">' + calls + ' call' + (calls === 1 ? '' : 's') + '</span></span><span class="date-session-title" title="' + escape(title) + '">' + escape(title) + '</span>' + tokenSummary + '</button>';
    }).join('') || '<p class="picker-empty">No Sessions were observed on this date.</p>';
  }

  function renderCalendarMonth() {
    const monthIndex = calendarMonths.indexOf(state.calendarMonth);
    document.querySelectorAll('[data-calendar-month]').forEach(grid => {
      grid.hidden = grid.dataset.calendarMonth !== state.calendarMonth;
    });
    const grid = document.querySelector('[data-calendar-month="' + state.calendarMonth + '"]');
    const label = document.querySelector('[data-calendar-label]');
    if (label && grid) label.textContent = grid.dataset.calendarLabel;
    const previous = document.querySelector('[data-calendar-step="-1"]');
    const next = document.querySelector('[data-calendar-step="1"]');
    if (previous) previous.disabled = monthIndex <= 0;
    if (next) next.disabled = monthIndex < 0 || monthIndex >= calendarMonths.length - 1;
  }

  function renderScope() {
    const items = scopedItems();
    const sessions = [...new Map(items.map(item => item.session).filter(Boolean).map(session => [session.sessionId,session])).values()];
    const commits = new Map(items.flatMap(item => commitsFor(item)).map(commit => [commit.hash,commit]));
    const stories = new Set(items.map(item => item.story?.id).filter(Boolean));
    const node = state.mode === 'feature' ? byNode.get(state.scope) : null;
    document.getElementById('workspace-scope-crumb').textContent = node?.title ?? state.scope ?? 'No scope';
    const metricValues = {
      stories: stories.size,
      sessions: sessions.length,
      calls: sessions.reduce((sum,session) => sum + session.toolActivity.totalCalls,0),
      commits: commits.size,
    };
    Object.entries(metricValues).forEach(([name,value]) => {
      const metric = document.querySelector('[data-metric="' + name + '"]');
      const output = metric?.querySelector('strong');
      if (output) output.textContent = value;
      if (metric) {
        metric.hidden = value === 0;
        const metricLabel = value === 1
          ? metric.dataset.metricSingular ?? metric.dataset.metricLabel ?? name
          : metric.dataset.metricLabel ?? name;
        metric.setAttribute('aria-label',value + ' ' + metricLabel);
      }
    });
    state.items = items;
    document.getElementById('workbench-list').innerHTML = items.map(workbench).join('') || '<div class="empty-state">No provenance workbench exists in this scope.</div>';
    renderScopeIndex(items);
    renderDateSessionNavigator(items);
    renderCalendarMonth();
    document.querySelectorAll('[data-feature-id]').forEach(button => button.classList.toggle('active', state.mode === 'feature' && button.dataset.featureId === state.scope));
    document.querySelectorAll('[data-date]').forEach(button => {
      const active = state.mode === 'date' && button.dataset.date === state.scope;
      button.classList.toggle('active',active);
      button.setAttribute('aria-current',active ? 'date' : 'false');
    });
    const activeDate = state.mode === 'date' ? document.querySelector('[data-date="' + state.scope + '"]') : null;
    const dateSummaryLabel = document.querySelector('[data-date-summary-label]');
    const dateSummaryMeta = document.querySelector('[data-date-summary-meta]');
    const dateContextSummary = document.querySelector('[data-date-context-summary]');
    const dateContextTotal = document.querySelector('[data-date-context-total]');
    const dateContextMeta = document.querySelector('[data-date-context-meta]');
    if (activeDate && dateSummaryLabel && dateSummaryMeta) {
      const selectedDate = new Date(activeDate.dataset.date + 'T00:00:00.000Z');
      dateSummaryLabel.textContent = new Intl.DateTimeFormat('en',{ weekday:'short', month:'short', day:'numeric', timeZone:'UTC' }).format(selectedDate);
      const sessionCount = Number(activeDate.dataset.sessionCount) || 0;
      const commitCount = Number(activeDate.dataset.commitCount) || 0;
      dateSummaryMeta.textContent = sessionCount + ' session' + (sessionCount === 1 ? '' : 's') + ' · ' + commitCount + ' commit' + (commitCount === 1 ? '' : 's');
      const context = dayContextSnapshotPresentation(sessions);
      if (dateContextSummary && dateContextTotal && dateContextMeta) {
        dateContextSummary.hidden = context.observedSessions === 0 && context.compactionCount === 0;
        dateContextTotal.textContent = context.observedSessions > 0 ? formatTokenCount(context.observedTokens) + ' observed context snapshots' : 'Context tokens unobserved';
        dateContextMeta.textContent = context.observedSessions + '/' + sessionCount + ' Sessions observed · ' + context.compactionCount + ' compaction' + (context.compactionCount === 1 ? '' : 's');
      }
    }
  }

  function setMode(mode,{ updateHistory = true } = {}) {
    state.mode = mode;
    if (mode === 'feature' && !byNode.has(state.scope)) state.scope = initialFeature;
    if (mode === 'date' && !report.days.some(day => day.date === state.scope)) state.scope = latestDay;
    if (mode === 'date' && state.scope) state.calendarMonth = state.scope.slice(0,7);
    state.collapsedCards.clear();
    document.querySelectorAll('[data-mode]').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('.picker-panel').forEach(panel => {
      const active = panel.dataset.panel === mode;
      panel.classList.toggle('active',active);
      panel.hidden = !active;
    });
    renderScope();
    if (updateHistory) updateUrl();
  }

  function setTreeItemExpanded(item, expanded) {
    if (!item?.hasAttribute('aria-expanded')) return;
    item.setAttribute('aria-expanded',String(expanded));
    item.classList.toggle('collapsed',!expanded);
    const toggle = item.querySelector(':scope > .tree-line [data-tree-toggle]');
    if (toggle) {
      toggle.setAttribute('aria-expanded',String(expanded));
      const title = item.querySelector(':scope > .tree-line [data-feature-id] .tree-copy strong')?.textContent ?? 'branch';
      toggle.setAttribute('aria-label',(expanded ? 'Collapse ' : 'Expand ') + title);
    }
  }

  function initializeTree() {
    // The capability tree opens fully expanded so every declared node is
    // visible without hunting; the picker is short and reviewers scan it whole.
    document.querySelectorAll('[data-tree-item][aria-expanded]').forEach(item => setTreeItemExpanded(item,true));
  }

  document.addEventListener('click', event => {
    const usageOnlyProcessSummary = event.target.closest('[data-session-process-group][data-tools-visible="false"] > summary');
    if (usageOnlyProcessSummary) {
      event.preventDefault();
      return;
    }
    const cachePolicyToggle = event.target.closest('[data-cache-policy-toggle]');
    if (cachePolicyToggle) {
      const panel = cachePolicyToggle.closest('[data-cache-policy-panel]');
      const expanded = cachePolicyToggle.getAttribute('aria-expanded') !== 'true';
      panel?.querySelectorAll('[data-cache-policy-extra]').forEach(row => { row.hidden = !expanded; });
      cachePolicyToggle.setAttribute('aria-expanded',String(expanded));
      cachePolicyToggle.textContent = expanded ? 'Show fewer model profiles' : 'View all ' + PROMPT_CACHE_PROFILES.length + ' model profiles';
      return;
    }
    const usageOverviewTurn = event.target.closest('[data-usage-overview-turn-marker]');
    if (usageOverviewTurn) {
      const session = usageSessionFor(usageOverviewTurn);
      const position = Number(usageOverviewTurn.dataset.usageResponsePosition);
      if (session) centerUsageSelection(session,position);
      return;
    }
    const usageResponse = event.target.closest('[data-usage-response-position]');
    if (usageResponse) {
      const session = usageSessionFor(usageResponse);
      if (session) setUsageSelection(session,Number(usageResponse.dataset.usageResponsePosition),{ focus:'chart' });
      return;
    }
    const usageOverview = event.target.closest('[data-usage-overview-surface]');
    if (usageOverview) {
      const session = usageSessionFor(usageOverview);
      if (session) {
        const position = usagePositionAt(usageOverview,event.clientX,session);
        const explorer = usageExplorerState(session);
        const start = Math.max(0,Math.min(explorer.maxStart,position - Math.floor(explorer.size / 2)));
        state.usageExplorer.set(session.sessionId,{ start,end:start + explorer.size,selected:position });
        refreshUsageExplorer(session,{ focus:'chart' });
      }
      return;
    }
    const usageFocus = event.target.closest('[data-usage-focus-surface]');
    if (usageFocus) {
      const session = usageSessionFor(usageFocus);
      if (session) setUsageSelection(session,usagePositionAt(usageFocus,event.clientX,session,{ focusWindow:true }),{ focus:'chart' });
      return;
    }
    const usageWindowStep = event.target.closest('[data-usage-window-step]');
    if (usageWindowStep) {
      const session = usageSessionFor(usageWindowStep);
      if (session) {
        const explorer = usageExplorerState(session);
        setUsageWindow(session,explorer.start + Number(usageWindowStep.dataset.usageWindowStep) * explorer.size,{ focus:'start' });
      }
      return;
    }
    const usageStep = event.target.closest('[data-usage-step]');
    if (usageStep) {
      const session = usageSessionFor(usageStep);
      if (session) stepUsageSelection(session,Number(usageStep.dataset.usageStep),{ focus:'chart' });
      return;
    }
    const usageMarker = event.target.closest('[data-usage-chart-detail]');
    if (usageMarker) { showUsageChartDetail(usageMarker); return; }
    const chartReset = event.target.closest('[data-chart-reset]');
    if (chartReset) { setZoom(chartReset.dataset.chartReset,0,1); return; }
    const commitEvent = event.target.closest('.chart-commit');
    if (commitEvent) {
      showChartDetail(commitEvent);
      if (event.target.closest('#session-view')) {
        const commit = byCommit.get(commitEvent.dataset.commitHash);
        revealSessionTarget(document.getElementById('session-commit-' + (commit?.shortHash ?? '')));
      }
      return;
    }
    const bin = event.target.closest('[data-chart-bin]');
    if (bin) {
      const sessionId = bin.dataset.sessionId;
      // Inside Session View the strip is a minimap: a bar always scrolls the
      // list to the calls under it, and a multi-call bar zooms in as well.
      const inSession = event.target.closest('#session-view');
      const locate = () => inSession && revealSessionTarget(document.getElementById('session-call-' + bin.dataset.callId));
      if (bin.closest('.session-turn-activity')) { locate(); return; }
      if (Number(bin.dataset.binCount) === 1) { locate(); return; }
      const surface = bin.ownerSVGElement?.querySelector('[data-chart-surface]');
      const fullMin = Number(surface?.dataset.fullMin);
      const fullWidth = Math.max(1,Number(surface?.dataset.fullMax) - fullMin);
      const from = (Number(bin.dataset.binFrom) - fullMin) / fullWidth;
      const to = (Number(bin.dataset.binTo) - fullMin) / fullWidth;
      const padding = Math.max(0.004,(to - from) * 0.3);
      setZoom(sessionId,Math.max(0,from - padding),Math.min(1,to + padding));
      locate();
      return;
    }
    const mark = event.target.closest('.chart-mark, .chart-ribbon-block');
    if (mark) {
      showChartDetail(mark);
      if (event.target.closest('#session-view')) revealSessionTarget(document.getElementById('session-call-' + mark.dataset.callId));
      return;
    }
    const mode = event.target.closest('[data-mode]');
    if (mode) { setMode(mode.dataset.mode); return; }
    const treeToggle = event.target.closest('[data-tree-toggle]');
    if (treeToggle) {
      const item = treeToggle.closest('[data-tree-item]');
      setTreeItemExpanded(item,item?.getAttribute('aria-expanded') !== 'true');
      return;
    }
    const feature = event.target.closest('[data-feature-id]');
    if (feature) {
      state.scope = feature.dataset.featureId;
      setTreeItemExpanded(feature.closest('[data-tree-item]'),true);
      setMode('feature');
      return;
    }
    const pickerToggle = event.target.closest('[data-toggle-picker]');
    if (pickerToggle) {
      setPickerCollapsed(!document.querySelector('.app').classList.contains('picker-collapsed'));
      return;
    }
    const date = event.target.closest('[data-date]');
    if (date) { state.scope = date.dataset.date; state.calendarMonth = state.scope.slice(0,7); setMode('date'); return; }
    const calendarStep = event.target.closest('[data-calendar-step]');
    if (calendarStep) {
      const index = calendarMonths.indexOf(state.calendarMonth);
      const nextMonth = calendarMonths[index + Number(calendarStep.dataset.calendarStep)];
      if (nextMonth) { state.calendarMonth = nextMonth; renderCalendarMonth(); }
      return;
    }
    const sessionTarget = event.target.closest('[data-date-session-target]');
    if (sessionTarget) {
      const target = document.getElementById(sessionTarget.dataset.dateSessionTarget);
      if (target) target.scrollIntoView({ behavior:'smooth', block:'start' });
      document.querySelectorAll('[data-date-session-target]').forEach(row => {
        const active = row === sessionTarget;
        row.classList.toggle('active',active);
        row.setAttribute('aria-current',active ? 'true' : 'false');
      });
      return;
    }
    const cardToggle = event.target.closest('[data-toggle-card]');
    if (cardToggle) {
      const index = Number(cardToggle.dataset.toggleCard);
      const collapsed = cardToggle.closest('.workbench').classList.toggle('card-collapsed');
      if (collapsed) state.collapsedCards.add(index);
      else state.collapsedCards.delete(index);
      cardToggle.setAttribute('aria-expanded',String(!collapsed));
      cardToggle.textContent = collapsed ? '+' : '−';
      return;
    }
    const openSession = event.target.closest('[data-open-session]');
    if (openSession) {
      const item = itemForSession(bySession.get(openSession.dataset.openSession));
      if (item) openSessionView(item,openSession);
      return;
    }
    const openSessionFor = event.target.closest('[data-open-session-for]');
    if (openSessionFor) {
      if (openSessionFor.closest('summary')) event.preventDefault();
      const item = itemForSession(bySession.get(openSessionFor.dataset.openSessionFor));
      if (item) {
        openSessionView(item,openSessionFor);
        const callId = openSessionFor.dataset.callId;
        const commit = byCommit.get(openSessionFor.dataset.commitHash);
        const target = callId ? document.getElementById('session-call-' + callId)
          : commit ? document.getElementById('session-commit-' + commit.shortHash)
            : null;
        if (target) revealSessionTarget(target);
      }
      return;
    }
    const deliveryToggle = event.target.closest('[data-toggle-delivery]');
    if (deliveryToggle) {
      const workbench = deliveryToggle.closest('.workbench');
      setDeliveryCollapsed(workbench,!workbench.classList.contains('delivery-collapsed'));
      return;
    }
    const commitFileView = event.target.closest('[data-commit-file-view]');
    if (commitFileView) {
      const delivery = commitFileView.closest('.delivery-lane');
      const view = commitFileView.dataset.commitFileView;
      if (!delivery || !['list','tree'].includes(view)) return;
      state.commitFileViews.set(delivery.dataset.fileViewKey,view);
      delivery.dataset.fileView = view;
      delivery.querySelectorAll('[data-commit-hash]').forEach(card => {
        const commit = byCommit.get(card.dataset.commitHash);
        const files = card.querySelector('.commit-files');
        if (commit && files) files.innerHTML = commitFileViewMarkup(commit,view);
      });
      delivery.querySelectorAll('[data-commit-file-view]').forEach(button => {
        button.setAttribute('aria-pressed',String(button.dataset.commitFileView === view));
      });
      return;
    }
    const revealCalls = event.target.closest('[data-reveal-calls]');
    if (revealCalls) {
      revealCalls.parentElement.querySelector('[data-call-overflow]')?.removeAttribute('hidden');
      revealCalls.remove();
      return;
    }
    const openUsageReport = event.target.closest('[data-open-usage-report]');
    if (openUsageReport) { setSessionMode('usage'); return; }
    const returnToTrace = event.target.closest('.usage-report-return');
    if (returnToTrace) { setSessionMode('trace',{ restoreFocus:true }); return; }
    const sessionMode = event.target.closest('[data-session-mode]');
    if (sessionMode) { setSessionMode(sessionMode.dataset.sessionMode); return; }
    const replayIndexTab = event.target.closest('[data-replay-index-tab]');
    if (replayIndexTab) {
      state.replayIndexTab = replayIndexTab.dataset.replayIndexTab === 'files' ? 'files' : 'events';
      renderReplayIndex();
      return;
    }
    const replayEvent = event.target.closest('[data-replay-event]');
    if (replayEvent) { setReplayEvent(replayEvent.dataset.replayEvent); return; }
    const replayFile = event.target.closest('[data-replay-file]');
    if (replayFile) {
      const filePath = replayFile.dataset.replayFile;
      const file = replayModel()?.files.find(candidate => candidate.path === filePath);
      if (file?.eventIds[0]) setReplayEvent(file.eventIds[0],{ updateHistory:false });
      return;
    }
    const replayStep = event.target.closest('[data-replay-step]');
    if (replayStep) { stepReplay(Number(replayStep.dataset.replayStep)); return; }
    if (event.target.closest('[data-replay-play]')) { setReplayPlaying(!state.replayPlaying); return; }
    const replaySpeed = event.target.closest('[data-replay-speed]');
    if (replaySpeed) {
      state.replaySpeed = Number(replaySpeed.dataset.replaySpeed) || 1;
      updateReplayPresentation();
      if (state.replayPlaying) scheduleReplay();
      return;
    }
    if (event.target.closest('[data-close-session]')) { closeSessionView(); return; }
  });

  document.addEventListener('mouseover', event => {
    const usageFocusPoint = event.target.closest?.('[data-usage-focus-point]');
    if (usageFocusPoint) {
      updateUsageInspectStrip(usageFocusPoint,Number(usageFocusPoint.dataset.usageResponsePosition),{ hovered:true });
      return;
    }
    const usageMarker = event.target.closest?.('[data-usage-chart-detail]');
    if (usageMarker) { showUsageChartDetail(usageMarker); return; }
    const mark = event.target.closest?.('.chart-mark, .chart-ribbon-block, .chart-commit, .chart-context-compaction-marker, [data-chart-bin]');
    if (mark) showChartDetail(mark);
  });

  document.addEventListener('mouseout', event => {
    const usageFocusPoint = event.target.closest?.('[data-usage-focus-point]');
    if (!usageFocusPoint || event.relatedTarget?.closest?.('[data-usage-focus-point]') === usageFocusPoint) return;
    restoreUsageInspectStrip(usageFocusPoint);
  });

  document.addEventListener('focusin', event => {
    const usageMarker = event.target.closest?.('[data-usage-chart-detail]');
    if (usageMarker) { showUsageChartDetail(usageMarker); return; }
    const mark = event.target.closest?.('.chart-mark, .chart-ribbon-block, .chart-commit, .chart-context-compaction-marker, [data-chart-bin]');
    if (mark) showChartDetail(mark);
  });

  document.addEventListener('toggle', event => {
    const process = event.target.closest?.('details.session-process');
    if (process) {
      if (!process.open) return;
      const processAxis = process.querySelector('[data-activity-turn][data-activity-chart]');
      if (processAxis && !processAxis.childElementCount) {
        renderActivityChart(processAxis);
        chartObserver?.observe(processAxis);
      }
      return;
    }
    const axisPanel = event.target.closest?.('[data-session-axis]');
    if (axisPanel) {
      if (!axisPanel.open) return;
      const axis = axisPanel.querySelector('[data-activity-chart]');
      if (axis && !axis.childElementCount) {
        renderActivityChart(axis);
        chartObserver?.observe(axis);
      }
      return;
    }
    const details = event.target.closest?.('[data-activity-session]');
    if (!details) return;
    const workbench = details.closest('.workbench');
    workbench?.classList.toggle('activity-expanded',details.open);
    if (!details.open) return;
    // Activity is the focus surface. Give its chart the delivery width on each
    // open transition, while leaving the delivery toggle available for a
    // reviewer who wants both surfaces visible afterward.
    setDeliveryCollapsed(workbench,true);
    const target = details.querySelector('[data-activity-chart]');
    if (!target || target.childElementCount) return;
    // Render synchronously: the open Details already has layout, and a hidden
    // tab starves requestAnimationFrame. Deferring left the chart permanently
    // empty, because an already-open Details never fires toggle again.
    renderActivityChart(target);
    chartObserver?.observe(target);
  }, true);

  document.addEventListener('change', event => {
    if (event.target.matches('[data-cache-profile-select]')) {
      const sessionId = event.target.dataset.cacheProfileSelect;
      state.promptCacheProfileBySession.set(sessionId,event.target.value);
      document.querySelectorAll('[data-activity-chart="' + CSS.escape(sessionId) + '"]').forEach(renderActivityChart);
      document.querySelector('[data-cache-profile-select="' + CSS.escape(sessionId) + '"]')?.focus({ preventScroll:true });
      return;
    }
    if (event.target.matches('[data-usage-window-edge]')) {
      const session = usageSessionFor(event.target);
      if (session) setUsageWindowEdge(session,event.target.dataset.usageWindowEdge,Number(event.target.value));
      return;
    }
    if (event.target.matches('[data-session-kind-filter], [data-session-tool-filter], [data-session-file-filter]')) applySessionFilters();
    if (event.target.matches('[data-session-jump]')) document.getElementById(event.target.value)?.scrollIntoView({ behavior:'smooth', block:'start' });
    if (event.target.matches('[data-scope-index]') && event.target.value) {
      document.getElementById(event.target.value)?.scrollIntoView({ behavior:'smooth', block:'start' });
      event.target.value = '';
    }
  });

  document.addEventListener('pointerdown', event => {
    const usageHandle = event.target.closest('[data-usage-window-handle]');
    if (usageHandle) {
      const session = usageSessionFor(usageHandle);
      const surface = usageHandle.ownerSVGElement?.querySelector('[data-usage-overview-surface]');
      if (!session || !surface) return;
      state.usageWindowDrag = { session,edge:usageHandle.dataset.usageWindowHandle,rect:surface.getBoundingClientRect(),lastPosition:null };
      usageHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const surface = event.target.closest('[data-chart-surface]');
    if (surface) {
      if (surface.closest('.session-turn-activity')) return;
      const svg = surface.ownerSVGElement;
      const rect = svg.getBoundingClientRect();
      const scale = (Number(svg.getAttribute('width')) || rect.width) / (rect.width || 1);
      state.brush = {
        surface,
        brush:svg.querySelector('[data-chart-brush]'),
        rect,
        scale,
        startX:(event.clientX - rect.left) * scale,
      };
      surface.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    const handle = event.target.closest('[data-resize-lane]');
    if (!handle) return;
    const grid = handle.closest('.workbench-grid');
    const prompt = grid.querySelector('.prompt-lane').getBoundingClientRect();
    const delivery = grid.querySelector('.delivery-lane').getBoundingClientRect();
    state.resize = { handle, grid, kind:handle.dataset.resizeLane, startX:event.clientX, promptWidth:prompt.width, deliveryWidth:delivery.width };
    handle.classList.add('resizing');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  document.addEventListener('pointermove', event => {
    const usageDrag = state.usageWindowDrag;
    if (usageDrag) {
      const explorer = usageExplorerState(usageDrag.session);
      const ratio = Math.max(0,Math.min(1,(event.clientX - usageDrag.rect.left) / Math.max(1,usageDrag.rect.width)));
      const position = Math.round(ratio * Math.max(0,explorer.points.length - 1));
      if (position !== usageDrag.lastPosition) {
        usageDrag.lastPosition = position;
        setUsageWindowEdge(usageDrag.session,usageDrag.edge,usageDrag.edge === 'end' ? position + 1 : position,{ focus:null });
      }
      return;
    }
    const brush = state.brush;
    if (brush) {
      const current = (event.clientX - brush.rect.left) * brush.scale;
      const left = Math.min(brush.startX,current);
      const width = Math.abs(current - brush.startX);
      brush.brush.setAttribute('x',String(left));
      brush.brush.setAttribute('width',String(width));
      if (width > 2) brush.brush.removeAttribute('hidden');
      return;
    }
    const resize = state.resize;
    if (!resize) return;
    const laneWidths = document.getElementById('workbench-list').style;
    const gridWidth = resize.grid.getBoundingClientRect().width;
    if (resize.kind === 'prompt') {
      const next = Math.max(180,Math.min(gridWidth - resize.deliveryWidth - 330,resize.promptWidth + event.clientX - resize.startX));
      laneWidths.setProperty('--prompt-width',next + 'px');
    } else {
      const next = Math.max(240,Math.min(gridWidth - resize.promptWidth - 330,resize.deliveryWidth - event.clientX + resize.startX));
      laneWidths.setProperty('--delivery-width',next + 'px');
    }
  });

  document.addEventListener('pointerup', event => {
    if (state.usageWindowDrag) {
      state.usageWindowDrag = null;
      return;
    }
    const brush = state.brush;
    if (brush) {
      const current = (event.clientX - brush.rect.left) * brush.scale;
      const left = Math.min(brush.startX,current);
      const right = Math.max(brush.startX,current);
      brush.brush.setAttribute('hidden','');
      brush.brush.setAttribute('width','0');
      state.brush = null;
      if (right - left > 6) {
        const fullMin = Number(brush.surface.dataset.fullMin);
        const fullWidth = Math.max(1,Number(brush.surface.dataset.fullMax) - fullMin);
        setZoom(brush.surface.dataset.sessionId,(chartPositionAt(brush.surface,left) - fullMin) / fullWidth,(chartPositionAt(brush.surface,right) - fullMin) / fullWidth);
      }
      return;
    }
    state.resize?.handle.classList.remove('resizing');
    state.resize = null;
  });

  document.addEventListener('keydown', event => {
    const usageOverviewChart = event.target.closest?.('[data-usage-overview-chart]');
    if (usageOverviewChart && Number(usageOverviewChart.dataset.usagePromptCount) > 0 && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(event.key)) {
      const session = usageSessionFor(usageOverviewChart);
      if (!session) return;
      if (event.key === 'Escape') {
        const explorer = usageExplorerState(session);
        state.usageExplorer.set(session.sessionId,{ start:explorer.start,end:explorer.end,selected:-1 });
        refreshUsageExplorer(session,{ focus:'overview' });
      } else if (event.key === 'Home') moveUsagePromptSelection(session,'first');
      else if (event.key === 'End') moveUsagePromptSelection(session,'last');
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') moveUsagePromptSelection(session,-1);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') moveUsagePromptSelection(session,1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const usageExplorer = event.target.closest?.('[data-usage-explorer]');
    const usageNativeControl = event.target.closest?.('input, select, textarea, button');
    if (usageExplorer && !usageNativeControl && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape'].includes(event.key)) {
      const session = usageSessionFor(event.target);
      if (!session) return;
      if (event.key === 'Escape') {
        const explorer = usageExplorerState(session);
        state.usageExplorer.set(session.sessionId,{ start:explorer.start,end:explorer.end,selected:-1 });
        refreshUsageExplorer(session,{ focus:'chart' });
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        stepUsageSelection(session,-1,{ focus:'chart' });
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        stepUsageSelection(session,1,{ focus:'chart' });
      } else if (event.key === 'Home' || event.key === 'End') {
        const explorer = usageExplorerState(session);
        setUsageSelection(session,event.key === 'Home' ? explorer.start : explorer.end - 1,{ focus:'chart' });
      }
      event.preventDefault();
      return;
    }
    const usageMarker = event.target.closest?.('[data-usage-chart-detail]');
    if (usageMarker && (event.key === 'Enter' || event.key === ' ')) {
      showUsageChartDetail(usageMarker);
      event.preventDefault();
      return;
    }
    const sessionModeTab = event.target.closest?.('.session-mode-tabs [data-session-mode]');
    if (sessionModeTab && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const nextMode = sessionModeTab.dataset.sessionMode === 'trace' ? 'replay' : 'trace';
      setSessionMode(nextMode);
      document.querySelector('[data-session-mode="' + nextMode + '"]')?.focus();
      event.preventDefault();
      return;
    }
    const replayIndexTab = event.target.closest?.('[data-replay-index-tab]');
    if (replayIndexTab && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      state.replayIndexTab = replayIndexTab.dataset.replayIndexTab === 'events' ? 'files' : 'events';
      renderReplayIndex();
      document.querySelector('[data-replay-index-tab="' + state.replayIndexTab + '"]')?.focus();
      event.preventDefault();
      return;
    }
    const shortcutTarget = event.target.closest?.('input, select, textarea, button, [contenteditable="true"]');
    if (state.sessionOpen && state.sessionMode === 'replay' && !shortcutTarget) {
      const key = event.key.toLowerCase();
      if (event.key === ' ') setReplayPlaying(!state.replayPlaying);
      else if (key === 'j' || event.key === 'ArrowLeft') stepReplay(-1);
      else if (key === 'l' || event.key === 'ArrowRight') stepReplay(1);
      else if ([1,2,4,8].includes(Number(event.key))) {
        state.replaySpeed = Number(event.key);
        updateReplayPresentation();
        if (state.replayPlaying) scheduleReplay();
      } else if (key === 'p') stepReplay(-1);
      else if (key === 'n') stepReplay(1);
      else if (event.key !== 'Escape') return;
      if (event.key !== 'Escape') {
        event.preventDefault();
        return;
      }
    }
    const bin = event.target.closest?.('[data-chart-bin]');
    if (bin && (event.key === 'Enter' || event.key === ' ')) {
      bin.dispatchEvent(new MouseEvent('click',{ bubbles:true }));
      event.preventDefault();
      return;
    }
    const modeTab = event.target.closest?.('[data-mode]');
    if (modeTab && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const nextMode = modeTab.dataset.mode === 'feature' ? 'date' : 'feature';
      const nextTab = document.querySelector('[data-mode="' + nextMode + '"]');
      setMode(nextMode);
      nextTab?.focus();
      event.preventDefault();
      return;
    }
    const resizeHandle = event.target.closest?.('[data-resize-lane]');
    if (resizeHandle && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const workbench = resizeHandle.closest('.workbench');
      const laneWidths = document.getElementById('workbench-list').style;
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      if (resizeHandle.dataset.resizeLane === 'prompt') {
        const width = workbench.querySelector('.prompt-lane').getBoundingClientRect().width;
        laneWidths.setProperty('--prompt-width',Math.max(180,width + direction * 24) + 'px');
      } else {
        const width = workbench.querySelector('.delivery-lane').getBoundingClientRect().width;
        laneWidths.setProperty('--delivery-width',Math.max(240,width - direction * 24) + 'px');
      }
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (state.sessionOpen) closeSessionView();
    }
  });

  // Back and forward move between Inspector states instead of leaving the
  // report, so a Session View deep link behaves like a real navigation step.
  addEventListener('popstate', () => {
    state.syncingHistory = true;
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode') === 'date' ? 'date' : 'feature';
    const scope = mode === 'feature' ? params.get('feature') : params.get('date');
    if (mode === 'feature' ? byNode.has(scope) : report.days.some(day => day.date === scope)) state.scope = scope;
    setMode(mode,{ updateHistory:false });
    const session = bySession.get(params.get('session'));
    if (params.get('view') === 'session' && session) {
      const restoredMode = params.get('session-mode');
      state.sessionMode = restoredMode === 'replay' || restoredMode === 'usage' ? restoredMode : 'trace';
      state.replayEventId = params.get('replay-event');
      const item = itemForSession(session);
      if (item) openSessionView(item,state.sessionTrigger,{ updateHistory:false });
    } else if (state.sessionOpen) {
      state.sessionPushed = false;
      teardownSessionView();
    }
    state.syncingHistory = false;
  });

  initializeTree();
  setMode(state.mode,{ updateHistory:false });
  if (initialParams.get('view') === 'session') {
    const item = itemForSession(bySession.get(initialParams.get('session')));
    if (item) openSessionView(item,null,{ updateHistory:false });
  }
  updateUrl();
})();
