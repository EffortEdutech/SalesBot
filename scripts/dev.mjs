import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readRootEnvKeys, runtimePorts, stopSalesBotListeners } from './dev-processes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const envFile = resolve(repo, '.env');

const rootEnv = readRootEnvKeys(envFile);
if (!rootEnv.exists) {
  console.error('SalesBot development cannot start: repository-root .env is missing.');
  console.error('Copy .env.example to .env and fill DATABASE_URL and BRIDGE_TOKEN_PEPPER.');
  process.exit(1);
}

const required = ['DATABASE_URL', 'BRIDGE_TOKEN_PEPPER'];
const missing = required.filter((key) => !rootEnv.keys.has(key) && !process.env[key]);
if (missing.length) {
  console.error(`SalesBot development cannot start: missing ${missing.join(', ')} in root .env.`);
  process.exit(1);
}

const preflight = await stopSalesBotListeners(runtimePorts);
if (preflight.foreign.length) {
  console.error(
    'SalesBot development cannot start: runtime port is owned by a non-SalesBot process.',
  );
  for (const listener of preflight.foreign) {
    console.error(`${listener.port}: PID ${listener.pid}`);
  }
  process.exit(2);
}

for (const listener of preflight.stopped) {
  console.log(`Stopped stale SalesBot dev process PID ${listener.pid}.`);
}

console.log('');
console.log('SalesBot Development');
console.log('--------------------------------------------');
console.log('Bridge API      http://127.0.0.1:4170');
console.log('Operator UI     http://127.0.0.1:4173');
console.log('Bidwright       http://127.0.0.1:4171');
console.log('Root env        .env (loaded by each service)');
console.log('--------------------------------------------');
console.log('Starting Bridge + Operator UI in this terminal...');
console.log('');

const pnpm = 'pnpm';
const childEnv = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: '4170',
  BRIDGE_PROXY_TARGET: 'http://127.0.0.1:4170',
};

const children = [
  spawn(pnpm, ['--filter', '@frontdesk-q/bridge-api', 'dev'], {
    cwd: repo,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  }),
  spawn(pnpm, ['--filter', '@frontdesk-q/salesbot-web', 'dev'], {
    cwd: repo,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  }),
];

let stopping = false;

function terminateChild(child) {
  if (!child.pid || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) terminateChild(child);
  setTimeout(() => process.exit(code), 50).unref();
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Unable to start SalesBot development process: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
      stop(0);
    } else {
      console.error(`A SalesBot development process exited unexpectedly (${code ?? signal}).`);
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
