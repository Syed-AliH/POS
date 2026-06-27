const path = require('node:path');
const { spawn } = require('node:child_process');

const apiRoot = path.join(__dirname, 'apps', 'api');
const entry = path.join(apiRoot, 'dist', 'server.js');

const child = spawn(process.execPath, [entry], {
  cwd: apiRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
