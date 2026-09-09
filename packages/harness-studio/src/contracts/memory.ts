export interface MemorySource {
  sourceId: string;
  host: string;
  support: string;
  scope: string;
  workspace?: { identity: string; qualification: string };
  root?: { displayPath: string; source: string };
  capabilities: { read: boolean; enumerate: boolean; metadata: boolean; write: false };
  coverage: { state: string; reason?: string };
}
export interface MemoryDocument {
  id: string;
  sourceId: string;
  nativeIdentity: { path: string };
  role: string;
  scope: string;
  metadata: { title: string; updatedAt: string; byteSize: number };
  provenance: { host: string; sourceKind: 'native-memory'; observedAt: string };
}
export interface MemoryInventory { sources: MemorySource[]; documents: MemoryDocument[] }
export interface MemorySnapshot {
  documentId: string;
  content: string;
  digest: string;
  capturedAt: string;
  sourceRevision: string;
  scope: string;
  workspace?: { identity: string; qualification: string };
  provenance: { host: string; sourceId: string; nativeIdentity: string };
}
