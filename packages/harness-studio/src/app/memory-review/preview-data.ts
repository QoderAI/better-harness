/** Illustrative design data only. These are not claims extracted from the user's files. */
export type MemoryKind = 'Decision' | 'Constraint' | 'Procedure' | 'Lesson';
export type MemoryOwner = 'ADR' | 'Project Wiki' | 'Procedure' | 'Personal Memory';
export interface MemoryEvidence {
  source: string;
  reference: string;
  observation: string;
  level: 'Claimed' | 'Observed' | 'Grounded' | 'Verified';
}
export interface MemoryCandidate {
  id: string;
  kind: MemoryKind;
  title: string;
  statement: string;
  status: 'new' | 'review' | 'conflict' | 'accepted' | 'rejected';
  owner: MemoryOwner;
  evidence: MemoryEvidence[];
  appliesTo: string[];
  conflict?: { previous: string; current: string };
}
export function memoryPreviewCandidates(): MemoryCandidate[] {
  return [
    {
      id: 'isolation', kind: 'Decision', title: 'Isolate third-party connectors', status: 'new', owner: 'ADR',
      statement: 'Run third-party connectors outside the product control plane so a connector crash cannot bring down the application.',
      appliesTo: ['Connector Runtime', 'Plugin Runtime'],
      evidence: [
        { source: 'Claude Code', reference: 'Memory · crash investigation', observation: 'A connector failure interrupted the main application process during the investigation.', level: 'Observed' },
        { source: 'Codex', reference: 'Memory · runtime boundaries', observation: 'The proposed native host keeps connector execution separate from the product process.', level: 'Observed' },
        { source: 'Repository', reference: 'ADR-0042 · fault isolation', observation: 'The architecture decision describes an out-of-process boundary for third-party connectors.', level: 'Grounded' },
      ],
    },
    {
      id: 'artifact-verification', kind: 'Lesson', title: 'Verify artifacts through a browser surface', status: 'review', owner: 'Procedure',
      statement: 'Use the browser surface as a common verification boundary for generated artifacts, including intermediate interaction states.',
      appliesTo: ['Artifact Runtime', 'Verification'],
      evidence: [
        { source: 'Qoder', reference: 'Memory · artifact preview', observation: 'Opening a generated artifact exposed a layout problem that static checks did not detect.', level: 'Observed' },
        { source: 'Claude Code', reference: 'Memory · acceptance', observation: 'A second episode used the same browser interaction to validate the result.', level: 'Observed' },
      ],
    },
    {
      id: 'revision-anchor', kind: 'Constraint', title: 'Anchor edits to the revision being reviewed', status: 'new', owner: 'Project Wiki',
      statement: 'An artifact edit must reference the revision the user inspected. Reject the edit when that revision is no longer current.',
      appliesTo: ['Artifact Editor', 'Revision Store'],
      evidence: [
        { source: 'Codex', reference: 'Memory · concurrent editing', observation: 'A stale editor view can otherwise overwrite a newer artifact revision.', level: 'Observed' },
        { source: 'Repository', reference: 'Revision contract · compare and swap', observation: 'The revision contract requires an expected revision before applying an edit.', level: 'Grounded' },
      ],
    },
    {
      id: 'connector-conflict', kind: 'Decision', title: 'Resolve the connector process boundary', status: 'conflict', owner: 'ADR',
      statement: 'The current architecture decision takes precedence over the older in-process connector note.',
      appliesTo: ['Connector Runtime'],
      conflict: { previous: 'Connector code may run in the main process.', current: 'Third-party connectors must run out of process.' },
      evidence: [
        { source: 'Claude Code', reference: 'Memory · Jul 12', observation: 'An older implementation note allows connectors in the main process.', level: 'Claimed' },
        { source: 'Repository', reference: 'ADR-0042 · Sep 3', observation: 'The later accepted decision requires process isolation.', level: 'Grounded' },
      ],
    },
    {
      id: 'review-snapshot', kind: 'Procedure', title: 'Review the snapshot before promoting Memory', status: 'review', owner: 'Procedure',
      statement: 'Inspect the source snapshot and its freshness before accepting a candidate into project memoryReview.',
      appliesTo: ['Memory Review'],
      evidence: [{ source: 'Qwen Code', reference: 'Memory · review workflow', observation: 'The note proposes snapshot review before a project-level decision is recorded.', level: 'Claimed' }],
    },
  ];
}
