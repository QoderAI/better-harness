import { createHash } from 'node:crypto';
export const SUPPORT = ['filesystem-native', 'host-observed', 'api-native', 'unavailable'];
export const SCOPES = ['user', 'project', 'team', 'agent'];
export const digest = (text) => createHash('sha256').update(text).digest('hex');
export const identity = (...parts) => digest(JSON.stringify(parts));
export function validateInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.sources) || !Array.isArray(inventory.documents)) throw new TypeError('Invalid Memory inventory');
  const text = (value) => typeof value === 'string' && value.length > 0;
  const date = (value) => text(value) && Number.isFinite(Date.parse(value));
  const sources = new Map();
  for (const source of inventory.sources) {
    if (!source || !text(source.sourceId) || !text(source.host) || sources.has(source.sourceId) || !SUPPORT.includes(source.support) || !SCOPES.includes(source.scope) || source.capabilities?.write !== false || !['enumerate', 'read', 'metadata'].every((key) => typeof source.capabilities[key] === 'boolean') || !['available', 'partial', 'unavailable'].includes(source.coverage?.state)) throw new TypeError('Invalid MemorySource');
    if (source.root && (!text(source.root.displayPath) || !['default', 'config', 'host-discovery'].includes(source.root.source))) throw new TypeError('Invalid Memory root');
    if (source.workspace && (!text(source.workspace.identity) || !['git-root', 'working-directory', 'host-native', 'unknown'].includes(source.workspace.qualification))) throw new TypeError('Invalid Memory workspace');
    if (source.capabilities.read && !source.root) throw new TypeError('Readable Memory source requires a root');
    if (source.support === 'unavailable' && (source.capabilities.read || source.capabilities.enumerate || source.coverage.state !== 'unavailable')) throw new TypeError('Unsupported Memory source must fail closed');
    sources.set(source.sourceId, source);
  }
  const ids = new Set();
  for (const doc of inventory.documents) {
    if (!doc || !text(doc.id) || ids.has(doc.id) || !sources.has(doc.sourceId) || !SCOPES.includes(doc.scope) || !text(doc.nativeIdentity?.path) || doc.provenance?.sourceKind !== 'native-memory' || !['index', 'topic', 'pinned', 'generated', 'consolidated', 'unknown'].includes(doc.role)) throw new TypeError('Invalid MemoryDocument');
    const source = sources.get(doc.sourceId);
    if (doc.provenance.host !== source.host || doc.scope !== source.scope || !date(doc.provenance.observedAt) || !date(doc.metadata?.updatedAt) || !Number.isSafeInteger(doc.metadata?.byteSize) || doc.metadata.byteSize < 0 || 'content' in doc || 'body' in doc) throw new TypeError('Invalid Memory document metadata or provenance');
    ids.add(doc.id);
  }
  return inventory;
}
