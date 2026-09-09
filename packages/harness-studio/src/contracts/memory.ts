export type MemoryScopeKind = 'personal' | 'cross-project' | 'project' | 'task' | 'mixed' | 'unknown';
export type MemoryMaterialRole = 'summary' | 'registry' | 'knowledge' | 'episode' | 'skill' | 'extension' | 'working' | 'unknown';
export interface MemoryContentScope {
  kind: MemoryScopeKind;
  projectIdentity?: string;
  evidence: 'native-binding' | 'native-layout' | 'source-declared' | 'unparsed';
}
export interface MemoryBinding { kind: 'global' | 'project' | 'unknown'; identity?: string; qualification?: string }
export interface MemoryLibrary { id: string; host: string; root: string; accountNamespace?: string }
export interface MemorySource {
  sourceId: string;
  host: string;
  support: string;
  scope: string;
  workspace?: { identity: string; qualification: string };
  root?: { displayPath: string; source: string };
  capabilities: { read: boolean; enumerate: boolean; metadata: boolean; write: false };
  coverage: { state: string; reason?: string };
  library?: MemoryLibrary;
  binding?: MemoryBinding;
}
export interface MemoryDocument {
  id: string;
  sourceId: string;
  nativeIdentity: { path: string };
  role: string;
  scope: string;
  metadata: { title: string; updatedAt: string; byteSize: number };
  provenance: { host: string; sourceKind: 'native-memory'; observedAt: string };
  libraryId?: string;
  binding?: MemoryBinding;
  materialRole?: MemoryMaterialRole;
  contentScope?: MemoryContentScope;
}
export interface MemoryInventory { schemaVersion?: 2; sources: MemorySource[]; documents: MemoryDocument[] }
export interface MemorySnapshot {
  schemaVersion?: 2;
  documentId: string;
  content: string;
  digest: string;
  capturedAt: string;
  sourceRevision: string;
  scope: string;
  workspace?: { identity: string; qualification: string };
  provenance: { host: string; sourceId: string; nativeIdentity: string };
  document?: MemoryDocument;
  source?: MemorySource;
  extraction?: MemoryExtraction;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  scope: MemoryContentScope;
  source: { documentId: string; digest: string; startLine: number; endLine: number };
}
export interface MemoryExtraction {
  schemaVersion: 1;
  parser: 'native-memory-sections-v1';
  status: 'parsed' | 'unsupported' | 'partial';
  contentScope: MemoryScopeKind;
  entries: MemoryEntry[];
}
