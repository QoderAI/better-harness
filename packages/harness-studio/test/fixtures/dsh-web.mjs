import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const mode = process.argv[2];
if (mode === 'exit') process.exit(2);
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'oversize') { process.stdout.write('x'.repeat(70000)); setInterval(() => {}, 1000); }
else {
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/harness-design/status') {
      const patch = process.argv[process.argv.indexOf('--patch') + 1];
      const config = JSON.parse(await readFile(patch, 'utf8'))[0].insert[0].config;
      if (request.headers['x-harness-design-token'] !== config.token) { response.writeHead(403); response.end(); return; }
      response.end(JSON.stringify({ phase: 'idle', entry: config.entry, message: 'Controller ready.' })); return;
    }
    response.end(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(3) }));
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`dsh web: http://127.0.0.1:${server.address().port}/?token=fixture-token\n`);
  });
  if (mode === 'crash') setTimeout(() => process.exit(3), 250);
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
