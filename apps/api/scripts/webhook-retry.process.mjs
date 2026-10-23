// A real built API process with orderly close over IPC (Windows SIGTERM is forceful).
import process from 'node:process';
import { main } from '../dist/main.js';
const { app } = await main();
process.on('message', (message) => {
  if (message !== 'stop') return;
  void app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
