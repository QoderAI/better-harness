import type { MemoryDocument, MemoryEntry, MemoryInventory, MemoryMaterialRole, MemorySnapshot } from '../../contracts/memory.js';

export type MemoryViewKind = 'personal' | 'cross-project' | 'projects' | 'sources';
export interface MemoryLocation { view: MemoryViewKind; project?: string; host: string; query: string; document?: string; entry?: string }
const VIEWS: MemoryViewKind[] = ['personal', 'cross-project', 'projects', 'sources'];
export const MEMORY_LOCATION_KEY = 'harness-memory-location';
export const HOST_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', qoder: 'Qoder', qwen: 'Qwen Code', cursor: 'Cursor', pi: 'Pi', kimi: 'Kimi', copilot: 'Copilot', workbuddy: 'WorkBuddy', grok: 'Grok', auggie: 'Auggie', dsh: 'DSH' };
export const hostLabel = (host: string): string => HOST_LABELS[host] ?? host;

export function parseMemoryLocation(hash: string): MemoryLocation {
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  const view = query.get('view') as MemoryViewKind | null;
  const legacy = hash.split('?')[0]!.endsWith('/memory-sources');
  return { view: view && VIEWS.includes(view) ? view : legacy ? 'sources' : 'personal', host: query.get('host') ?? 'all', query: query.get('q') ?? '', ...(query.get('project') ? { project: query.get('project')! } : {}), ...(query.get('document') ? { document: query.get('document')! } : {}), ...(query.get('entry') ? { entry: query.get('entry')! } : {}) };
}
export function memoryLocationHash(location: MemoryLocation): string {
  const query = new URLSearchParams({ view: location.view });
  if (location.project) query.set('project', location.project);
  if (location.host !== 'all') query.set('host', location.host);
  if (location.query) query.set('q', location.query);
  if (location.document) query.set('document', location.document);
  if (location.entry) query.set('entry', location.entry);
  return `#/memory?${query}`;
}

// Bodies never enter localStorage. Keep a bounded cache for this page session only.
const snapshots = new Map<string, MemorySnapshot>();
export function rememberSnapshot(snapshot: MemorySnapshot): void {
  snapshots.delete(snapshot.documentId); snapshots.set(snapshot.documentId, snapshot);
  let size = [...snapshots.values()].reduce((total, value) => total + value.content.length * 2, 0);
  while (snapshots.size > 16 || size > 8 * 1024 * 1024) {
    const first = snapshots.keys().next().value!;
    size -= snapshots.get(first)!.content.length * 2;
    snapshots.delete(first);
  }
}
export function knownSnapshots(inventory: MemoryInventory): MemorySnapshot[] {
  return inventory.documents.flatMap(doc => {
    const snapshot = snapshots.get(doc.id);
    if (!snapshot || snapshot.document?.metadata.updatedAt !== doc.metadata.updatedAt || snapshot.document?.metadata.byteSize !== doc.metadata.byteSize) return [];
    return [snapshot];
  });
}
export function forgetSnapshots(): void { snapshots.clear(); }

export function projectKey(doc: MemoryDocument, identity: string): string { return JSON.stringify([doc.libraryId ?? doc.sourceId, identity]); }
export interface MemoryProject { key: string; identity: string; host: string }
export function memoryProjects(inventory: MemoryInventory, loaded: MemorySnapshot[]): MemoryProject[] {
  const projects = new Map<string, MemoryProject>();
  const add = (doc: MemoryDocument, identity: string): void => { const key = projectKey(doc, identity); projects.set(key, { key, identity, host: doc.provenance.host }); };
  for (const doc of inventory.documents) if (doc.binding?.kind === 'project' && doc.binding.identity) add(doc, doc.binding.identity);
  for (const snapshot of loaded) if (snapshot.document) for (const entry of snapshot.extraction?.entries ?? []) if (entry.scope.kind === 'project' && entry.scope.projectIdentity) add(snapshot.document, entry.scope.projectIdentity);
  return [...projects.values()].sort((a, b) => a.identity.localeCompare(b.identity) || a.host.localeCompare(b.host));
}
export interface MemoryRow { id: string; title: string; document: MemoryDocument; entry?: MemoryEntry }
export function memoryRows(inventory: MemoryInventory, loaded: MemorySnapshot[], location: MemoryLocation): MemoryRow[] {
  const snapshotsById = new Map(loaded.map(snapshot => [snapshot.documentId, snapshot]));
  const rows: MemoryRow[] = [];
  const term = location.query.trim().toLocaleLowerCase();
  for (const doc of inventory.documents) {
    if (location.host !== 'all' && doc.provenance.host !== location.host) continue;
    const includesScope = (kind: string, identity?: string): boolean => {
      if (location.view === 'sources') return true;
      if (location.view === 'projects') return kind === 'project' && (!location.project || !!identity && projectKey(doc, identity) === location.project);
      return kind === location.view;
    };
    const entries = snapshotsById.get(doc.id)?.extraction?.entries;
    if (location.view !== 'sources' && entries?.length) {
      for (const entry of entries) if (includesScope(entry.scope.kind, entry.scope.projectIdentity) && `${entry.title} ${entry.content} ${hostLabel(doc.provenance.host)}`.toLocaleLowerCase().includes(term)) rows.push({ id: entry.id, title: entry.title, document: doc, entry });
    } else if (includesScope(doc.contentScope?.kind ?? 'unknown', doc.contentScope?.projectIdentity) && `${doc.metadata.title} ${hostLabel(doc.provenance.host)}`.toLocaleLowerCase().includes(term)) rows.push({ id: doc.id, title: doc.metadata.title, document: doc });
  }
  return rows;
}
export const MATERIAL_ORDER: MemoryMaterialRole[] = ['summary', 'registry', 'knowledge', 'episode', 'skill', 'extension', 'working', 'unknown'];

/** Only canonical global entrypoints are loaded when a user opens a semantic view. */
export function memoryBrowseIndexes(inventory: MemoryInventory): MemoryDocument[] {
  const libraries = new Map<string, MemoryDocument>();
  for (const doc of inventory.documents) {
    if (doc.binding?.kind !== 'global' || !['summary', 'registry'].includes(doc.materialRole ?? '') || doc.metadata.byteSize > 256 * 1024) continue;
    const key = doc.libraryId ?? doc.sourceId;
    if (!libraries.has(key) || doc.materialRole === 'summary') libraries.set(key, doc);
  }
  return [...libraries.values()].slice(0, 8);
}
