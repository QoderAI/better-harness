import { Worker } from 'node:worker_threads';

// A Node worker gives Node libraries (notably PDF.js) a genuine Node environment.
// The Electron utility owns its lifetime and remains the process boundary.
const port = process.parentPort;
if (!port) throw new Error('Studio service requires an Electron utility parent');
const runtime = new Worker(new URL('./studio-runtime.mjs', import.meta.url));
port.on('message', ({ data }) => runtime.postMessage(data));
runtime.on('message', (data) => port.postMessage(data));
runtime.on('error', (error) => { console.error(error); process.exit(1); });
runtime.on('exit', (code) => process.exit(code));
