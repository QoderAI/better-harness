process.stdin.setRawMode(true);
process.stdout.write('PI_FIXTURE_READY\r\n');
process.stdin.on('data', data => {
  if (data.toString() === 'EXIT') process.exit(0);
  if (data.toString() === 'FLOOD') process.stdout.write('x'.repeat(10000));
  else process.stdout.write(data);
});
process.stdout.on('resize', () => process.stdout.write(`SIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`));
