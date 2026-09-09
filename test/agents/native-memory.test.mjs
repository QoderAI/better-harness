import { test as baseTest } from 'vitest';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { discoverMemory, readMemory, validateInventory } from '../../scripts/memory/index.mjs';
const encodeProject = (workspace, platform = process.platform) => (platform === 'win32' ? workspace.toLowerCase() : workspace).replace(/[^a-zA-Z0-9]/g, '-');
import { digest } from '../../scripts/memory/contract.mjs';
import { collectNativeMemoryMetadata } from '../../scripts/coding-agent-practices/inventory.mjs';
// Native integration suite: run after build:rust or with an explicit executable.
const binary = path.resolve('packages/better-harness-desktop/dist/native', process.platform === 'win32' ? 'harness-evidence-host.exe' : 'harness-evidence-host');
const test = baseTest.skipIf(!process.env.BETTER_HARNESS_EVIDENCE_HOST && !existsSync(binary));

async function fixture(fn) {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'bh-memory-')));
  const workspace = path.join(home, 'repo');
  await mkdir(workspace);
  const put = async (file, body = '# Native knowledge\n\nprivate body marker') => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, body); return file; };
  try { await fn({ home, workspace, put }); } finally { await rm(home, { recursive: true, force: true }); }
}
test('four providers enumerate metadata and bounded authorized snapshots with provenance', async () => fixture(async ({ home, workspace, put }) => {
  for (const host of ['claude', 'qwen']) {
    await put(path.join(home, `.${host}`, 'projects', encodeProject(workspace), 'memory', 'MEMORY.md'));
    await put(path.join(home, `.${host}`, 'projects', encodeProject(workspace), 'memory', 'topic.md'));
  }
  await put(path.join(home, '.qwen', 'projects', encodeProject(workspace), 'memory', 'pinned', 'architecture.md'));
  await put(path.join(home, '.qwen', 'memories', 'personal.md'));
  await put(path.join(workspace, '.qwen', 'team-memory', 'team.md'));
  await put(path.join(home, '.codex', 'memories', 'MEMORY.md'));
  const slug = workspace.replace(/^[A-Za-z]:/, '').replace(/[\\/]+/g, '-').replace(/^-+|-+$/g, '');
  await put(path.join(home, '.qoder', 'memories', 'account', 'projects', slug, 'architecture', 'memory.md'));
  await put(path.join(home, '.qoder', 'memories', 'account', 'global', 'preferences', 'memory.md'));
  const otherProject = await put(path.join(home, '.qoder', 'memories', 'account', 'projects', 'unrelated-project', 'memory.md'));
  await put(path.join(home, '.codex', 'memories', 'AGENTS.md'));
  await put(path.join(home, '.codex', 'memories', 'sessions', 'transcript.md'));
  const inventory = await discoverMemory({ home, workspace });
  assert.equal(inventory.documents.length, 10);
  assert.equal(validateInventory(inventory), inventory);
  const invalid = structuredClone(inventory);
  invalid.documents[0].provenance.host = 'wrong-host';
  assert.throws(() => validateInventory(invalid), /provenance/);
  assert.doesNotMatch(JSON.stringify(inventory), /private body marker/);
  assert.equal(inventory.documents.filter((doc) => doc.role === 'pinned').length, 1);
  assert.equal(inventory.sources.find((source) => source.host === 'qoder').support, 'host-observed');
  assert.equal(inventory.sources.find((source) => source.host === 'cursor').coverage.reason, 'native-memory-storage-contract-unavailable');
  for (const host of ['codex', 'qoder']) {
    // The Rust port must preserve the report inventory owner's qualification.
    const nativePaths = inventory.documents.filter(doc => doc.provenance.host === host).map(doc => doc.nativeIdentity.path).sort();
    const legacy = await collectNativeMemoryMetadata({ platform: host, root: path.join(home, `.${host}`, 'memories'), workspace, includeUserHome: true });
    const legacyPaths = legacy.flatMap(category => category.titleEntries.map(entry => entry.path))
      .filter(file => path.basename(file) !== 'AGENTS.md' && !file.includes(`${path.sep}sessions${path.sep}`)).sort();
    assert.deepEqual(legacyPaths, nativePaths);
    assert.ok(!nativePaths.includes(otherProject));
  }
  for (const doc of inventory.documents) {
    await assert.rejects(readMemory({ home, workspace, id: doc.id, scope: doc.scope }));
    const snapshot = await readMemory({ home, workspace, id: doc.id, scope: doc.scope, includeMemories: true, includeMemoryContent: true });
    assert.equal(snapshot.digest, digest(snapshot.content));
    assert.equal(snapshot.provenance.host, doc.provenance.host);
    assert.equal(snapshot.scope, doc.scope);
    assert.ok(snapshot.workspace.qualification);
    assert.equal(Object.isFrozen(snapshot.provenance), true);
    assert.ok(snapshot.capturedAt);
  }
}));
test('Claude configured root overrides defaults; malformed configuration fails closed', async () => fixture(async ({ home, workspace, put }) => {
  const root = path.join(home, 'custom-memory');
  await put(path.join(root, 'MEMORY.md'));
  await put(path.join(root, 'debugging.md'));
  const settings = await put(path.join(home, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: root }));
  const result = await discoverMemory({ home, workspace, platform: 'claude' });
  assert.equal(result.documents.length, 2);
  assert.equal(result.sources[0].root.source, 'config');
  await writeFile(settings, JSON.stringify({ autoMemoryDirectory: '../unsafe' }));
  assert.equal((await discoverMemory({ home, workspace, platform: 'claude' })).sources[0].coverage.state, 'unavailable');
}));
test('Codex home override, symlink replacement, scope mismatch and size limit fail closed', async () => fixture(async ({ home, workspace, put }) => {
  const codexHome = path.join(home, 'codex-override');
  const file = await put(path.join(codexHome, 'memories', 'MEMORY.md'));
  const doc = (await discoverMemory({ home, workspace, codexHome, platform: 'codex' })).documents[0];
  const options = { home, workspace, codexHome, id: doc.id, scope: 'user', includeMemories: true, includeMemoryContent: true };
  await assert.rejects(readMemory({ ...options, scope: 'project' }));
  await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(readMemory(options), /too-large/);
  await rm(file);
  const outside = await put(path.join(home, 'outside.md'));
  await symlink(outside, file);
  assert.equal((await discoverMemory(options)).documents.length, 0);
  await assert.rejects(readMemory(options));
}));
test('Claude git worktrees share main repository memory while Qwen keeps checkout identity', async () => fixture(async ({ home, workspace, put }) => {
  execFileSync('git', ['init', workspace]);
  execFileSync('git', ['-C', workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init']);
  const worktree = path.join(home, 'worktree');
  execFileSync('git', ['-C', workspace, 'worktree', 'add', '-b', 'fixture', worktree]);
  await put(path.join(home, '.claude', 'projects', encodeProject(workspace), 'memory', 'MEMORY.md'));
  const result = await discoverMemory({ home, workspace: worktree, platform: 'claude' });
  assert.equal(result.documents.length, 1);
  assert.equal(result.sources[0].workspace.qualification, 'git-root');
  assert.equal(encodeProject('C:\\Projects\\My Repo', 'win32'), 'c--projects-my-repo');
}));
test('CLI help, metadata output and rejected content authorization', async () => fixture(async ({ home, workspace, put }) => {
  await put(path.join(home, '.codex', 'memories', 'MEMORY.md'));
  const cli = path.resolve('scripts/better-harness.mjs');
  const run = (...args) => execFileSync(process.execPath, [cli, 'memory', ...args], { encoding: 'utf8' });
  assert.match(run('--help'), /include-memory-content/);
  const inventory = JSON.parse(run('list', '--home', home, '--workspace', workspace, '--platform', 'codex'));
  assert.equal(inventory.documents.length, 1);
  const envInventory = JSON.parse(execFileSync(process.execPath, [cli, 'memory', 'list', '--workspace', workspace, '--platform', 'codex'], { encoding: 'utf8', env: { ...process.env, CODEX_HOME: path.join(home, '.codex') } }));
  assert.equal(envInventory.documents[0].id, inventory.documents[0].id);
  assert.throws(() => run('list', '--include-memory-content'));
  assert.throws(() => run('read', '--wat'));
}));
