import { runtimePorts, stopSalesBotListeners } from './dev-processes.mjs';

const result = await stopSalesBotListeners(runtimePorts);

if (result.foreign.length) {
  console.error('SalesBot dev stop refused: runtime port is owned by a non-SalesBot process.');
  for (const listener of result.foreign) {
    console.error(`${listener.port}: PID ${listener.pid}`);
  }
  process.exit(2);
}

if (!result.stopped.length) {
  console.log('No SalesBot dev processes are listening on runtime ports.');
} else {
  for (const listener of result.stopped) {
    console.log(`Stopped SalesBot dev process PID ${listener.pid}.`);
  }
}
