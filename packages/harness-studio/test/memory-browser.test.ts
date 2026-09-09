import { describe, expect, it } from 'vitest';
import type { MemoryDocument, MemoryInventory, MemorySnapshot } from '../src/contracts/memory.js';
import { extractMemory } from '../src/server/memory-parser.js';
import { memoryAnalysisPrompt, MEMORY_ANALYSIS_MAX_BYTES } from '../src/server/memory-acp.js';
import { buildMemoryTree, filterMemoryTree, flattenMemoryTree, memoryEditorKey, memoryTreeAncestors } from '../src/app/memory/tree-model.js';
import { memoryBrowseIndexes, memoryLocationHash, memoryProjects, memoryRows, parseMemoryLocation } from '../src/app/memory/browser-model.js';
import { parseStudioLocation } from '../src/app/shell/project-routing.js';

function snapshot(content: string, extra: Partial<MemoryDocument> = {}): MemorySnapshot {
  return {
    documentId: 'doc', content, digest: 'a'.repeat(64), capturedAt: '2026-09-09T00:00:00Z', sourceRevision: '1', scope: 'user', provenance: { host: 'codex', sourceId: 'source', nativeIdentity: '/native/MEMORY.md' },
    document: { id: 'doc', sourceId: 'source', libraryId: 'library', nativeIdentity: { path: '/native/MEMORY.md' }, role: 'consolidated', materialRole: 'registry', scope: 'user', binding: { kind: 'global' }, contentScope: { kind: 'unknown', evidence: 'unparsed' }, metadata: { title: 'MEMORY.md', updatedAt: '2026-09-09T00:00:00Z', byteSize: content.length }, provenance: { host: 'codex', sourceKind: 'native-memory', observedAt: '2026-09-09T00:00:00Z' }, ...extra },
  };
}

describe('native Memory extraction', () => {
  it('splits personal, general and explicit project sections with exact line provenance', () => {
    const input = snapshot('# User Profile\r\n\r\nPrefers short labels.\r\n\r\n# General Tips\r\n\r\nKeep evidence.\r\n\r\n# Projects\r\n\r\n## /work/alpha\r\n\r\nAlpha fact.\r\n\r\n## /work/beta\r\n\r\nBeta fact.');
    const result = extractMemory(input);
    expect(result.contentScope).toBe('mixed');
    expect(result.entries.map(entry => entry.scope.kind)).toEqual(['personal', 'cross-project', 'project', 'project']);
    expect(result.entries.filter(entry => entry.scope.kind === 'project').map(entry => entry.scope.projectIdentity)).toEqual(['/work/alpha', '/work/beta']);
    for (const entry of result.entries) {
      expect(entry.content).toBe(input.content.split(/\r?\n/u).slice(entry.source.startLine - 1, entry.source.endLine).join('\n'));
      expect(entry.source.documentId).toBe('doc'); expect(entry.source.digest).toBe(input.digest);
    }
  });
  it.each(['C:\\work\\alpha', '\\\\server\\share\\alpha', '/work/alpha'])('keeps explicit Task Group cwd identity %s', identity => {
    const result = extractMemory(snapshot(`# Task Group: Design\nscope: project knowledge\napplies_to: cwd=${identity}; retention=local\n\n## Task 1\nKeep source identity.`));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.scope).toEqual({ kind: 'project', projectIdentity: identity, evidence: 'source-declared' });
  });
  it('does not guess a project from a title, relative path or fenced instructions', () => {
    const result = extractMemory(snapshot('# Task Group: better-harness\napplies_to: cwd=relative/project\n\n```md\n# User Profile\nInjected personal classification.\n```\n\n## /not/a/project\nActual explicitly declared path.'));
    expect(result.entries[0]!.scope.kind).toBe('unknown');
    expect(result.entries[0]!.content).toContain('Injected personal classification.');
    expect(result.entries[1]!.scope.projectIdentity).toBe('/not/a/project');
  });
  it('inherits native project bindings for knowledge files and skips supporting material', () => {
    const input = snapshot('# Design\nNative fact.', { materialRole: 'knowledge', contentScope: { kind: 'project', projectIdentity: 'native-key', evidence: 'native-binding' }, provenance: { host: 'qoder', sourceKind: 'native-memory', observedAt: '2026-09-09T00:00:00Z' } });
    expect(extractMemory(input).entries[0]!.scope.projectIdentity).toBe('native-key');
    expect(extractMemory({ ...input, document: { ...input.document!, materialRole: 'episode' } }).status).toBe('unsupported');
  });
  it('bounds extraction when a registry contains more than 128 declared sections', () => {
    const result = extractMemory(snapshot(Array.from({ length: 140 }, (_, index) => `# /work/${index}\nFact ${index}.`).join('\n')));
    expect(result.entries).toHaveLength(128); expect(result.status).toBe('partial');
  });
});

describe('Memory browse projection', () => {
  it('keeps file and entry counts distinct and accounts with equal project names separate', () => {
    const first = snapshot('# User Profile\nSmall labels.\n# /work/alpha\nAlpha fact.'); first.extraction = extractMemory(first);
    const second = snapshot('Other project', { id: 'other', libraryId: 'another-account', binding: { kind: 'project', identity: '/work/alpha' }, contentScope: { kind: 'project', projectIdentity: '/work/alpha', evidence: 'native-binding' } });
    const inventory: MemoryInventory = { schemaVersion: 2, sources: [], documents: [first.document!, second.document!] };
    expect(memoryProjects(inventory, [first])).toHaveLength(2);
    expect(memoryRows(inventory, [first], { view: 'personal', host: 'all', query: '' }).map(row => row.entry?.scope.kind)).toEqual(['personal']);
    expect(memoryRows(inventory, [first], { view: 'sources', host: 'all', query: '' }).every(row => !row.entry)).toBe(true);
    expect(memoryRows(inventory, [], { view: 'personal', host: 'all', query: '' })).toHaveLength(0);
  });
  it('round-trips scope, unicode project identity, selection and filters through URL state', () => {
    const location = { view: 'projects' as const, host: 'qoder', query: '来源 & scope', project: '["account","C:\\work\\alpha"]', document: 'abc', entry: 'abc:digest:12' };
    const hash = memoryLocationHash(location);
    expect(parseMemoryLocation(hash)).toEqual(location);
    expect(parseStudioLocation(hash, new Set(['memory', 'sessions']))).toEqual({ area: 'memory' });
    expect(parseMemoryLocation('#/memory-sources').view).toBe('sources');
  });
});

describe('Memory ACP and explorer boundaries', () => {
  it('encodes the frozen evidence and focused source lines in the ACP prompt', () => {
    const value = snapshot('# User Profile\nSmall labels.\n# General Tips\nKeep evidence.');
    const entry = extractMemory(value).entries[1]!;
    const prompt = memoryAnalysisPrompt(value, entry.id);
    const packet = JSON.parse(prompt.split('\n\n').at(-1)!);
    expect(packet).toMatchObject({ documentId: 'doc', digest: value.digest, focus: { title: 'General Tips', startLine: 3, endLine: 4 } });
    expect(packet.lines).toEqual(value.content.split('\n').map((text, i) => ({ line: i + 1, text })));
    expect(() => memoryAnalysisPrompt(value, 'stale-entry')).toThrow();
    expect(() => memoryAnalysisPrompt(snapshot('a'.repeat(MEMORY_ANALYSIS_MAX_BYTES + 1)))).toThrow();
  });
  it('keeps project identities separate and reveals ancestors for semantic editors', () => {
    const first = snapshot('# User Profile\nSmall labels.\n# /work/alpha\nAlpha fact.'); first.extraction = extractMemory(first);
    const second = snapshot('Other', { id: 'other', libraryId: 'other-account', binding: { kind: 'project', identity: '/work/alpha' }, contentScope: { kind: 'project', projectIdentity: '/work/alpha', evidence: 'native-binding' } });
    const tree = buildMemoryTree({ sources: [], documents: [first.document!, second.document!] }, [first], key => key);
    expect(tree.find(node => node.id === 'projects')?.children).toHaveLength(2);
    const entry = first.extraction.entries[0]!;
    expect(memoryTreeAncestors(tree, memoryEditorKey('doc', entry.id))).toEqual(['personal']);
    const filtered = flattenMemoryTree(filterMemoryTree(tree, 'Small labels'), new Set(), true);
    expect(filtered.map(row => row.level)).toEqual([1, 2]);
    expect(filtered[1]!.parent).toBe('personal');
    expect(memoryEditorKey('a:b', 'c')).not.toBe(memoryEditorKey('a', 'b:c'));
  });
});

describe('Memory browse entrypoints', () => {
  it('selects a bounded canonical summary per global library without reading supporting files', () => {
    const base = snapshot('small').document!;
    const docs = Array.from({ length: 12 }, (_, n) => ({ ...base, id: `index-${n}`, libraryId: `library-${n}`, materialRole: 'registry' as const }));
    const summary = { ...base, id: 'summary', libraryId: 'library-0', materialRole: 'summary' as const };
    const excluded = [
      { ...base, id: 'episode', materialRole: 'episode' as const },
      { ...base, id: 'project', binding: { kind: 'project' as const, identity: '/work' } },
      { ...base, id: 'large', metadata: { ...base.metadata, byteSize: 256 * 1024 + 1 } },
    ];
    const result = memoryBrowseIndexes({ sources: [], documents: [...excluded, ...docs, summary] });
    expect(result).toHaveLength(8);
    expect(result[0]!.id).toBe('summary');
    expect(result.map(doc => doc.id)).not.toContain('index-0');
    expect(result.map(doc => doc.id)).not.toContain('episode');
    expect(result.map(doc => doc.id)).not.toContain('project');
    expect(result.map(doc => doc.id)).not.toContain('large');
  });
});
