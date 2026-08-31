import { classifyListeners, getPortListeners, runtimePorts } from './dev-processes.mjs';

const classified = classifyListeners(getPortListeners(runtimePorts));

console.log('SalesBot runtime status');
console.log('-----------------------');

if (!classified.length) {
  for (const port of runtimePorts) console.log(`${port}: free`);
  process.exit(0);
}

for (const port of runtimePorts) {
  const listeners = classified.filter((listener) => listener.port === port);
  if (!listeners.length) {
    console.log(`${port}: free`);
    continue;
  }

  for (const listener of listeners) {
    const owner = listener.salesbotOwned ? 'SalesBot dev process' : 'foreign process';
    console.log(`${port}: PID ${listener.pid} (${owner})`);
  }
}

if (classified.some((listener) => !listener.salesbotOwned)) process.exitCode = 2;
