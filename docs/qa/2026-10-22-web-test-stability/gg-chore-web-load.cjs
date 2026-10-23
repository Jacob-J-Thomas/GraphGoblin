const { Worker } = require('node:worker_threads');
const workers = Array.from({ length: 3 }, () => new Worker(
  'for (;;) { let n = 0; for (let i = 0; i < 1000000; i++) n += Math.sqrt(i); }',
  { eval: true },
));
setTimeout(() => workers.forEach((worker) => worker.terminate()), 30 * 60 * 1000);
