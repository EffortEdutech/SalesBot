import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '..');
export const runtimePorts = [4170, 4173];

function normalize(value) {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .toLowerCase();
}

function isRepoScopedSalesBotCommand(commandLine, repoRoot = repo) {
  const command = normalize(commandLine);
  const normalizedRepo = normalize(repoRoot);
  if (!command.includes(normalizedRepo)) return false;
  if (command.includes('scripts/dev-stop.mjs') || command.includes('scripts/dev-status.mjs')) {
    return false;
  }

  return [
    'scripts/dev.mjs',
    '@frontdesk-q/bridge-api',
    '@frontdesk-q/salesbot-web',
    'apps/bridge-api',
    'apps/salesbot-web',
    'src/server.ts',
    'vite',
  ].some((marker) => command.includes(marker));
}

export function isSalesBotDevProcess(commandLine, repoRoot = repo, port = null) {
  const command = normalize(commandLine);
  if (!command) return false;
  if (isRepoScopedSalesBotCommand(commandLine, repoRoot)) return true;

  if (
    port === 4170 &&
    command.includes('--env-file=../../.env') &&
    command.includes('--import tsx') &&
    command.includes('src/server.ts')
  ) {
    return true;
  }

  if (port === 4173 && command.includes('node_modules') && command.includes('vite')) {
    return true;
  }

  return false;
}

function runPowerShell(command) {
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  const result = spawnSync(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || 'PowerShell command failed';
    throw new Error(message);
  }
  return result.stdout.trim();
}

function parseJsonArray(output) {
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function windowsPortListeners(ports = runtimePorts) {
  const portList = ports.join(',');
  const command = `
$ports = @(${portList})
$connections = Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue
$items = foreach ($connection in $connections) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
  $commandLine = ''
  if ($process) { $commandLine = [string]$process.CommandLine }
  [pscustomobject]@{
    port = [int]$connection.LocalPort
    pid = [int]$connection.OwningProcess
    commandLine = $commandLine
  }
}
$items | ConvertTo-Json -Compress
`;
  return parseJsonArray(runPowerShell(command));
}

function windowsRepoProcesses() {
  const repoPattern = normalize(repo).replaceAll("'", "''");
  const command = `
$repo = '${repoPattern}'
$processes = Get-CimInstance Win32_Process | Where-Object {
  $cmd = ([string]$_.CommandLine).Replace('\\','/').ToLowerInvariant()
  $cmd -like "*$repo*"
}
$items = foreach ($process in $processes) {
  [pscustomobject]@{
    port = $null
    pid = [int]$process.ProcessId
    commandLine = [string]$process.CommandLine
  }
}
$items | ConvertTo-Json -Compress
`;
  return parseJsonArray(runPowerShell(command));
}

function genericPortListeners(ports = runtimePorts) {
  const listeners = [];
  for (const port of ports) {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'], {
      encoding: 'utf8',
    });
    if (result.status !== 0 || !result.stdout.trim()) continue;
    let currentPid = null;
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith('p')) currentPid = Number(line.slice(1));
      if (line.startsWith('c') && currentPid) {
        listeners.push({ port, pid: currentPid, commandLine: line.slice(1) });
      }
    }
  }
  return listeners;
}

export function getPortListeners(ports = runtimePorts) {
  if (process.platform === 'win32') return windowsPortListeners(ports);
  return genericPortListeners(ports);
}

export function getSalesBotProcessCandidates(repoRoot = repo) {
  const processes = process.platform === 'win32' ? windowsRepoProcesses() : [];
  return processes.filter((item) => isRepoScopedSalesBotCommand(item.commandLine, repoRoot));
}

export function classifyListeners(listeners, repoRoot = repo) {
  return listeners.map((listener) => ({
    ...listener,
    salesbotOwned: isSalesBotDevProcess(listener.commandLine, repoRoot, listener.port),
  }));
}

export function stopProcessTree(pid) {
  if (pid === process.pid) return;

  if (process.platform === 'win32') {
    const result = spawnSync(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', String(pid), '/t', '/f'],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    if (result.status !== 0) {
      throw new Error(
        result.stderr?.trim() || result.stdout?.trim() || `Unable to stop PID ${pid}`,
      );
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

export async function waitForPortsToClear(ports = runtimePorts, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getPortListeners(ports).length === 0) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  return getPortListeners(ports).length === 0;
}

export async function stopSalesBotListeners(ports = runtimePorts) {
  const classified = classifyListeners(getPortListeners(ports));
  const foreign = classified.filter((listener) => !listener.salesbotOwned);
  if (foreign.length) return { stopped: [], foreign };

  const byPid = new Map();
  for (const listener of classified) byPid.set(listener.pid, listener);
  for (const processCandidate of getSalesBotProcessCandidates()) {
    byPid.set(processCandidate.pid, { ...processCandidate, salesbotOwned: true });
  }

  const stopped = [];
  for (const listener of byPid.values()) {
    if (listener.pid === process.pid) continue;
    stopProcessTree(listener.pid);
    stopped.push(listener);
  }

  await waitForPortsToClear(ports);
  return { stopped, foreign: [] };
}

export function readRootEnvKeys(envFile = resolve(repo, '.env')) {
  if (!existsSync(envFile)) return { exists: false, keys: new Set() };
  const source = readFileSync(envFile, 'utf8');
  const keys = new Set(
    source
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
      .filter(Boolean),
  );
  return { exists: true, keys };
}
