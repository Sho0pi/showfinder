const procs = [
  Bun.spawn(['bun', '--watch', 'backend/server.ts'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' }),
  Bun.spawn(['bunx', '--bun', 'vite', '--host', '0.0.0.0'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
];

const shutdown = () => {
  for (const proc of procs) proc.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.race(procs.map((proc) => proc.exited));
shutdown();
