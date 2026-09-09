import { posix, win32 } from 'node:path';
import type { MemoryContentScope, MemoryEntry, MemoryExtraction, MemorySnapshot } from '../contracts/memory.js';

const UNKNOWN: MemoryContentScope = { kind: 'unknown', evidence: 'unparsed' };
const MAX_ENTRIES = 128;

function declaredProject(value: string): string | undefined {
  const text = value.trim().replace(/^`(.*)`$/, '$1');
  // These are source-declared identities, never paths resolved against the server's cwd.
  return (posix.isAbsolute(text) || win32.isAbsolute(text)) && !/[\r\n]/u.test(text) ? text : undefined;
}

function declaredScope(title: string, preamble: string[]): MemoryContentScope | undefined {
  const label = title.trim().toLowerCase();
  if (['user profile', 'user preferences', '用户画像', '个人偏好'].includes(label)) return { kind: 'personal', evidence: 'source-declared' };
  if (['general tips', 'general preferences', '通用经验', '通用技巧'].includes(label)) return { kind: 'cross-project', evidence: 'source-declared' };
  const project = declaredProject(title);
  if (project) return { kind: 'project', projectIdentity: project, evidence: 'source-declared' };
  if (/^task group:/iu.test(title)) {
    const identities = preamble.flatMap(line => {
      const match = /^applies_to:\s*cwd=([^;]+)(?:;|$)/u.exec(line.trim());
      const identity = match && declaredProject(match[1]!);
      return identity ? [identity] : [];
    });
    if (new Set(identities).size === 1) return { kind: 'project', projectIdentity: identities[0]!, evidence: 'source-declared' };
  }
  return undefined;
}

/** Bounded, versioned native-format parser. Never derives applicability from topic similarity. */
export function extractMemory(snapshot: MemorySnapshot): MemoryExtraction {
  const result: MemoryExtraction = { schemaVersion: 1, parser: 'native-memory-sections-v1', status: 'unsupported', contentScope: 'unknown', entries: [] };
  const doc = snapshot.document;
  if (!doc || !['summary', 'registry', 'knowledge'].includes(doc.materialRole ?? '') || snapshot.content.length > 1024 * 1024) return result;
  const lines = snapshot.content.split(/\r?\n/u);
  const headings: Array<{ line: number; level: number; title: string }> = [];
  let fence: { marker: string; length: number } | undefined;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line]!;
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(text)?.[1];
    if (marker && !fence) { fence = { marker: marker[0]!, length: marker.length }; continue; }
    if (fence) {
      if (new RegExp(`^\\s{0,3}${fence.marker}{${fence.length},}\\s*$`, 'u').test(text)) fence = undefined;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(text);
    if (heading) headings.push({ line, level: heading[1]!.length, title: heading[2]! });
  }
  const baseScope = doc.contentScope?.kind === 'project' || doc.contentScope?.kind === 'personal' ? doc.contentScope : UNKNOWN;
  const stack: Array<{ level: number; scope: MemoryContentScope; origin: number }> = [];
  const sections: Array<{ start: number; end: number; title: string; scope: MemoryContentScope; origin: number }> = [];
  if (!headings.length || headings[0]!.line > 0) sections.push({ start: 0, end: (headings[0]?.line ?? lines.length) - 1, title: doc.metadata.title, scope: baseScope, origin: -1 });
  headings.forEach((heading, index) => {
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
    const next = headings[index + 1]?.line ?? lines.length;
    const own = doc.provenance.host === 'codex' ? declaredScope(heading.title, lines.slice(heading.line + 1, next)) : undefined;
    const scope = own ?? stack.at(-1)?.scope ?? baseScope;
    const origin = own ? heading.line : stack.at(-1)?.origin ?? -1;
    stack.push({ level: heading.level, scope, origin });
    const previous = sections.at(-1);
    if (previous && previous.origin === origin && JSON.stringify(previous.scope) === JSON.stringify(scope)) previous.end = next - 1;
    else sections.push({ start: heading.line, end: next - 1, title: heading.title, scope, origin });
  });
  for (const section of sections) {
    let { start, end } = section;
    while (end > start && !lines[end]?.trim()) end--;
    if (!lines.slice(start, end + 1).some(line => line.trim() && !/^#{1,6}\s/u.test(line))) continue;
    if (result.entries.length === MAX_ENTRIES) { result.status = 'partial'; break; }
    const entry: MemoryEntry = {
      id: `${snapshot.documentId}:${snapshot.digest}:${start + 1}`,
      title: section.title,
      content: lines.slice(start, end + 1).join('\n'),
      scope: section.scope,
      source: { documentId: snapshot.documentId, digest: snapshot.digest, startLine: start + 1, endLine: end + 1 },
    };
    result.entries.push(entry);
  }
  if (result.status !== 'partial') result.status = 'parsed';
  const scopes = new Set(result.entries.map(entry => entry.scope.kind === 'project' ? `project:${entry.scope.projectIdentity}` : entry.scope.kind));
  result.contentScope = scopes.size > 1 ? 'mixed' : result.entries[0]?.scope.kind ?? 'unknown';
  return result;
}
