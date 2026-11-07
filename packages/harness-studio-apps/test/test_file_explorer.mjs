/**
 * Smoke for the file-explorer Node backend — the reference app this package
 * keeps. Pins the contract a page can observe: the process starts and passes
 * the host health gate, the proxy HMAC gate holds every other route (401),
 * `tree`, `read` and `resolve` answer off an isolated home, a path outside
 * the allowed roots is refused, and an undeclared route answers 404.
 *
 * Run: node test/test_file_explorer.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signProxyRequest } from '../lib/proxyAuth.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOME_DIR = join(root, '.state', 'fe-test-home')
const PORT = 9335
const SECRET = 'test-secret'
// The backend serves its routes under /api/*; the host adds the /apps/<name>
// segment when it proxies, so the smoke drives the backend's own shape.
const BASE = '/api'

rmSync(HOME_DIR, { recursive: true, force: true })
mkdirSync(join(HOME_DIR, 'notes'), { recursive: true })
writeFileSync(join(HOME_DIR, 'notes', 'hello.md'), '# Hello\n\nSmoke fixture.\n')
writeFileSync(join(HOME_DIR, 'root.txt'), 'root level\n')

let failures = 0
function check(label, cond, detail = '') {
  if (cond) console.log(`  ok    ${label}`)
  else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function startBackend() {
  const child = spawn(process.execPath, [join(root, 'apps', 'file-explorer', 'server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      HOME: HOME_DIR,
      USERPROFILE: HOME_DIR,
      KIROCREW_HOME: HOME_DIR,
      KIROCREW_PROXY_SECRET: SECRET,
      PORT: String(PORT),
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => process.stdout.write(`[be] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[be!] ${d}`))
  return child
}

async function waitHealth(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('backend never became healthy')
}

async function call(path) {
  const sig = signProxyRequest({ method: 'GET', target: path, body: Buffer.alloc(0), secret: SECRET })
  return fetch(`http://127.0.0.1:${PORT}${path}`, { headers: { 'X-KiroCrew-Proxy': sig } })
}

async function stopBackend(backend) {
  if (backend.exitCode === null && backend.signalCode === null) {
    const exited = new Promise((resolve) => backend.once('exit', resolve))
    backend.kill('SIGTERM')
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))])
  }
  backend.stdout?.destroy()
  backend.stderr?.destroy()
}

const child = startBackend()

try {
  await waitHealth()
  console.log('health ok')

  // The HMAC gate is the whole auth story: unsigned reads are refused.
  const unsigned = await fetch(`http://127.0.0.1:${PORT}${BASE}/tree?path=${encodeURIComponent(HOME_DIR)}`)
  check('unsigned tree -> 401', unsigned.status === 401, `got ${unsigned.status}`)

  let r = await call(`${BASE}/tree?depth=1&path=${encodeURIComponent(HOME_DIR)}`)
  let v = await r.json()
  check(
    'tree lists the fixture home',
    r.status === 200 &&
      Array.isArray(v.entries) &&
      v.entries.some((entry) => entry.name === 'notes' && entry.type === 'dir') &&
      v.entries.some((entry) => entry.name === 'root.txt' && entry.type === 'file'),
    JSON.stringify(v).slice(0, 160),
  )

  r = await call(`${BASE}/read?path=${encodeURIComponent(join(HOME_DIR, 'notes', 'hello.md'))}`)
  v = await r.json()
  check(
    'read returns the file content',
    r.status === 200 && v.mime !== undefined && typeof v.content === 'string' && v.content.includes('Smoke fixture'),
    JSON.stringify(v).slice(0, 160),
  )

  r = await call(`${BASE}/resolve?path=${encodeURIComponent(join(HOME_DIR, 'notes'))}`)
  v = await r.json()
  check('resolve reports a directory', r.status === 200 && v.type === 'dir' && v.exists === true, r.status)

  // The allow-list is home + tmp + /home + /opt; anything else is a 403, not a read.
  r = await call(`${BASE}/read?path=${encodeURIComponent('/etc/hosts')}`)
  check('outside-home read refused', r.status === 403, `got ${r.status}`)

  r = await call(`${BASE}/nope`)
  check('unknown route -> 404', r.status === 404, `got ${r.status}`)
} finally {
  await stopBackend(child)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exitCode = failures === 0 ? 0 : 1
