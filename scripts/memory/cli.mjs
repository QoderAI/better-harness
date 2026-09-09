#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { discoverMemory, readMemory } from './index.mjs';
const help = 'better-harness memory sources|list|read [--workspace <repo>] [--platform all|claude|codex|qoder|qwen] [--scope user|project|team]\nRead requires --id <id> --scope <scope> --include-memories --include-memory-content.\nHome overrides: --home, --claude-home, --codex-home, --qoder-home, --qwen-home. Inventory is metadata-only.\n';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries([...['workspace', 'platform', 'scope', 'memory-scope', 'id', 'home', 'claude-home', 'codex-home', 'qoder-home', 'qwen-home'].map((name) => [name, { type: 'string' }]), ...['help', 'include-memories', 'include-memory-content'].map((name) => [name, { type: 'boolean' }])]) });
  if (values.help) process.stdout.write(help);
  else {
    if (positionals.length !== 1 || !['sources', 'list', 'read'].includes(positionals[0])) throw new Error(help);
    const options = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
    options.scope ??= options.memoryScope;
    if (options.includeMemoryContent && (!options.includeMemories || positionals[0] !== 'read')) throw new Error('Content flags require an explicit read with --include-memories');
    const result = positionals[0] === 'read' ? await readMemory(options) : await discoverMemory(options);
    process.stdout.write(`${JSON.stringify(positionals[0] === 'sources' ? { sources: result.sources } : result, null, 2)}\n`);
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
