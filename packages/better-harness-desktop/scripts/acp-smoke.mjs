#!/usr/bin/env node
// Drive the staged ACP host end to end and report what actually happened.
//
// This exists because "the tests pass" and "the shipped binary runs" are
// different claims. `cargo test` builds its own debug binary from the crate;
// this speaks to the release executable that packaging stages, over the same
// stdio contract the Node runtime will use.
//
// Usage: node scripts/acp-smoke.mjs [--agent <command>] [--agent-arg <arg>]
//                                   [--transport stdio|nsxpc]
// Defaults to the shared TypeScript fixture agent, which blocks every turn on a
// permission request, so a passing run proves the permission round trip too.
// `--transport nsxpc` drives the macOS `harness-acp-client` bridge from
// `dist/native/Harness ACP.app` instead of the plain stdio driver.

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(root, '..', '..');
const STEP_TIMEOUT_MS = 30_000;

function parseArguments(argv) {
  const agentArgs = [];
  let agent;
  let transport = 'stdio';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--agent') agent = argv[index += 1];
    else if (argv[index] === '--agent-arg') agentArgs.push(argv[index += 1]);
    else if (argv[index] === '--transport') transport = argv[index += 1];
  }
  if (!['stdio', 'nsxpc'].includes(transport)) throw new Error(`Unknown --transport ${transport}`);
  return { agent, agentArgs, transport };
}

const options = parseArguments(process.argv.slice(2));
const hostExecutable = options.transport === 'nsxpc'
  ? join(root, 'dist', 'native', 'Harness ACP.app', 'Contents', 'MacOS', 'harness-acp-client')
  : join(
      root, 'dist', 'native',
      process.platform === 'win32' ? 'harness-acp-host.exe' : 'harness-acp-host',
    );
const fixtureAgent = join(
  repositoryRoot, 'packages', 'harness', 'test', 'fixtures', 'acp-agent.mjs',
);

/** Fail with a directed message rather than a spawn error the reader must decode. */
async function requireFile(path, remedy) {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new Error(`Missing ${path}\n  ${remedy}`);
  }
}

/** Framed access to the host's stdio, mirroring what the Node executor will do. */
class HostSession {
  #child;
  #pendingReplies = new Map();
  #eventWaiters = [];
  #nextId = 0;

  constructor(child) {
    this.#child = child;
    createInterface({ input: child.stdout }).on('line', (line) => this.#route(line));
  }

  #route(line) {
    if (line.trim() === '') return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch (error) {
      throw new Error(`The host emitted a non-JSON line: ${line}\n  ${error.message}`);
    }
    // A reply carries the id it answers; an event carries none. That is the whole
    // demultiplexing rule, and it is why events never need a correlation field.
    if (frame.id === undefined) {
      this.events.push(frame.event);
      for (const waiter of this.#eventWaiters.splice(0)) waiter(frame.event);
      return;
    }
    const pending = this.#pendingReplies.get(frame.id);
    if (pending === undefined) throw new Error(`Unmatched reply id ${frame.id}`);
    this.#pendingReplies.delete(frame.id);
    pending(frame);
  }

  events = [];

  /** Send a request and return its id without waiting, so turns can overlap. */
  send(method, params) {
    const id = (this.#nextId += 1);
    const settled = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for a reply to ${method}`)),
        STEP_TIMEOUT_MS,
      );
      this.#pendingReplies.set(id, (frame) => { clearTimeout(timer); resolvePromise(frame); });
    });
    this.#child.stdin.write(`${JSON.stringify({ version: 1, id, method, params })}\n`);
    return { id, settled };
  }

  async call(method, params) {
    const { settled } = this.send(method, params);
    const frame = await settled;
    if (frame.error !== undefined) {
      throw new Error(`${method} failed: ${frame.error.code} ${frame.error.message}`);
    }
    return frame.result;
  }

  waitForEvent(type) {
    const seen = this.events.find((event) => event.type === type);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for a ${type} event`)),
        STEP_TIMEOUT_MS,
      );
      const check = (event) => {
        if (event.type !== type) { this.#eventWaiters.push(check); return; }
        clearTimeout(timer);
        resolvePromise(event);
      };
      this.#eventWaiters.push(check);
    });
  }

  async close() {
    await this.call('shutdown', null).catch(() => undefined);
    this.#child.stdin.end();
    await new Promise((resolvePromise) => this.#child.once('close', resolvePromise));
  }
}

function report(step, detail) {
  process.stdout.write(`  ✓ ${step}${detail === undefined ? '' : ` — ${detail}`}\n`);
}

async function main() {
  await requireFile(
    hostExecutable,
    'Build it first: npm run build:rust -w @qoder-ai/better-harness-desktop',
  );
  const agentCommand = options.agent ?? process.execPath;
  const agentArgs = options.agent === undefined
    ? [fixtureAgent, ...options.agentArgs]
    : options.agentArgs;
  if (options.agent === undefined) {
    await requireFile(fixtureAgent, 'The shared ACP fixture agent is part of the repository.');
  }

  process.stdout.write(`ACP host smoke\n  host  ${hostExecutable}\n  transport ${options.transport}\n  agent ${agentCommand} ${agentArgs.join(' ')}\n\n`);
  const child = spawn(hostExecutable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.once('error', (error) => { throw error; });
  const session = new HostSession(child);

  const described = await session.call('host.describe', null);
  report('host.describe', `${described.host} ${described.version} · ${described.protocol}`);

  if (options.transport === 'nsxpc') {
    const proof = await session.waitForEvent('transport');
    if (proof.transport !== 'nsxpc' || !(proof.servicePid > 0) || proof.servicePid === proof.bridgePid) {
      throw new Error(`bad NSXPC transport proof: ${JSON.stringify(proof)}`);
    }
    session.events.length = 0;
    report('transport proof', `service ${proof.servicePid} ≠ bridge ${proof.bridgePid}`);
  }

  const opened = await session.call('connection.open', {
    connectionId: 'smoke',
    command: agentCommand,
    args: agentArgs,
    allowRoots: [repositoryRoot],
  });
  report('connection.open', `reused=${opened.reused}, roots=${opened.allowRoots.length}`);

  const { sessionId } = await session.call('session.create', {
    connectionId: 'smoke',
    cwd: repositoryRoot,
  });
  report('session.create', sessionId);

  // Two turns on one process is the property this host exists for, so the smoke
  // run proves it rather than asserting a single turn and inferring the rest.
  for (const turn of [1, 2]) {
    const prompt = session.send('session.prompt', {
      connectionId: 'smoke',
      sessionId,
      prompt: `smoke turn ${turn}`,
    });
    const requested = await session.waitForEvent('permission-requested');
    const chosen = requested.options[0].optionId;
    await session.call('permission.decide', { requestId: requested.requestId, optionId: chosen });
    session.events.length = 0;
    const frame = await prompt.settled;
    if (frame.error !== undefined) throw new Error(`turn ${turn}: ${frame.error.message}`);
    if (frame.result.stopReason !== 'end_turn') {
      throw new Error(`turn ${turn} stopped with ${frame.result.stopReason}, expected end_turn`);
    }
    report(`session.prompt turn ${turn}`, `permission ${chosen} → ${frame.result.stopReason}`);
  }

  const reopened = await session.call('connection.open', {
    connectionId: 'smoke',
    command: agentCommand,
    args: agentArgs,
  });
  if (reopened.reused !== true) throw new Error('a known connection id should be reused');
  report('connection.open again', 'reused the live agent');

  await session.close();
  report('shutdown', `exit ${child.exitCode ?? 'signalled'}`);
  process.stdout.write('\nACP host smoke passed\n');
}

main().catch((error) => {
  process.stderr.write(`\nACP host smoke failed\n  ${error.message}\n`);
  process.exitCode = 1;
});
