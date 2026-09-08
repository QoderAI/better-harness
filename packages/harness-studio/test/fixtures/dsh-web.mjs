import { createServer } from 'node:http';
const mode = process.argv[2];
if (mode === 'exit') process.exit(2);
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'oversize') { process.stdout.write('x'.repeat(70000)); setInterval(() => {}, 1000); }
else {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(3) }));
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`dsh web: http://127.0.0.1:${server.address().port}/?token=fixture-token\n`);
  });
  if (mode === 'crash') setTimeout(() => process.exit(3), 250);
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
