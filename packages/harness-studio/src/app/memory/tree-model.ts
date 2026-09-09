import type { MemoryInventory, MemorySnapshot } from '../../contracts/memory.js';
import { hostLabel, memoryProjects, memoryRows, type MemoryRow, type MemoryViewKind } from './browser-model.js';

export interface MemoryTreeNode { id: string; label: string; title?: string; children?: MemoryTreeNode[]; item?: { row: MemoryRow; view: MemoryViewKind; project?: string } }
export interface MemoryTreeRow { node: MemoryTreeNode; level: number; parent?: string; position: number; size: number }
export const memoryEditorKey = (documentId: string, entryId?: string): string => JSON.stringify([documentId, entryId ?? '']);
export function buildMemoryTree(inventory: MemoryInventory, snapshots: MemorySnapshot[], labels: (key: string) => string, host = 'all'): MemoryTreeNode[] {
  const rows = (view: MemoryViewKind, project?: string) => memoryRows(inventory, snapshots, { view, project, host, query: '' });
  const leaf = (row: MemoryRow, view: MemoryViewKind, project?: string): MemoryTreeNode => ({ id: `${view}:${memoryEditorKey(row.document.id, row.entry?.id)}`, label: row.title, title: `${row.document.nativeIdentity.path} · ${hostLabel(row.document.provenance.host)}`, item: { row, view, project } });
  const roots: MemoryTreeNode[] = [
    { id: 'personal', label: labels('views.personal'), children: rows('personal').map(row => leaf(row, 'personal')) },
    { id: 'cross-project', label: labels('views.cross-project'), children: rows('cross-project').map(row => leaf(row, 'cross-project')) },
    { id: 'projects', label: labels('views.projects'), children: memoryProjects(inventory, snapshots).filter(project => host === 'all' || project.host === host).map(project => ({ id: `project:${project.key}`, label: project.identity, title: `${project.identity} · ${hostLabel(project.host)}`, children: rows('projects', project.key).map(row => leaf(row, 'projects', project.key)) })) },
    { id: 'sources', label: labels('views.sources'), children: [] },
  ];
  const sources = roots[3]!;
  for (const row of rows('sources')) {
    const doc = row.document, source = inventory.sources.find(value => value.sourceId === doc.sourceId);
    const libraryKey = `library:${doc.libraryId ?? doc.sourceId}`;
    let library = sources.children!.find(node => node.id === libraryKey);
    if (!library) { library = { id: libraryKey, label: `${hostLabel(doc.provenance.host)}${source?.library?.accountNamespace ? ` · ${source.library.accountNamespace}` : ''}`, title: source?.library?.root, children: [] }; sources.children!.push(library); }
    const role = doc.materialRole ?? 'unknown', roleKey = `${libraryKey}:${role}`;
    let folder = library.children!.find(node => node.id === roleKey);
    if (!folder) { folder = { id: roleKey, label: labels(`roles.${role}`), children: [] }; library.children!.push(folder); }
    // metadata.title is the native v2 contract's portable display path.
    let parent: MemoryTreeNode = folder;
    const parts = doc.metadata.title.split('/');
    for (const part of parts.slice(0, -1)) {
      const id = `${parent.id}/${part}`;
      let child: MemoryTreeNode | undefined = parent.children!.find(node => node.id === id);
      if (!child) { child = { id, label: part, children: [] }; parent.children!.push(child); }
      parent = child;
    }
    parent.children!.push({ ...leaf(row, 'sources'), label: parts.at(-1) ?? row.title });
  }
  return roots;
}
export function filterMemoryTree(nodes: MemoryTreeNode[], query: string): MemoryTreeNode[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return nodes;
  return nodes.flatMap(node => {
    if (`${node.label} ${node.title ?? ''} ${node.item?.row.entry?.content ?? ''}`.toLocaleLowerCase().includes(term)) return [node];
    const children = node.children && filterMemoryTree(node.children, query);
    return children?.length ? [{ ...node, children }] : [];
  });
}
export function flattenMemoryTree(nodes: MemoryTreeNode[], expanded: Set<string>, all = false, level = 1, parent?: string): MemoryTreeRow[] {
  return nodes.flatMap((node, index) => [{ node, level, parent, position: index + 1, size: nodes.length }, ...(node.children && (all || expanded.has(node.id)) ? flattenMemoryTree(node.children, expanded, all, level + 1, node.id) : [])]);
}
export function memoryTreeAncestors(nodes: MemoryTreeNode[], key: string, ancestors: string[] = []): string[] | undefined {
  for (const node of nodes) {
    if (node.item && memoryEditorKey(node.item.row.document.id, node.item.row.entry?.id) === key) return ancestors;
    const found = node.children && memoryTreeAncestors(node.children, key, [...ancestors, node.id]);
    if (found) return found;
  }
  return undefined;
}
