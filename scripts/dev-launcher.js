'use strict';

const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const authServer = path.resolve(rootDir, '..', 'ig-bot-backend', 'server.js');
const vitePackage = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(vitePackage), 'bin', 'vite.js');
const children = [];
let shuttingDown = false;

function launch(name, args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.once('exit', (code) => {
    if (shuttingDown) return;
    console.error(`[${name}] завершён с кодом ${code ?? 1}`);
    shutdown(code ?? 1);
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

launch('AUTH', [authServer], {
  env: { PORT: '5000', HOST: '127.0.0.1' },
});
launch('API', [path.join(rootDir, 'backend', 'server.js')], {
  env: {
    PORT: '5001',
    HOST: '127.0.0.1',
    AUTH_SERVER_URL: 'http://127.0.0.1:5000',
  },
});
launch('WEB', [viteBin, '--host', '0.0.0.0'], {
  cwd: path.join(rootDir, 'frontend'),
  env: { VITE_AUTH_URL: 'http://127.0.0.1:5000' },
});

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
