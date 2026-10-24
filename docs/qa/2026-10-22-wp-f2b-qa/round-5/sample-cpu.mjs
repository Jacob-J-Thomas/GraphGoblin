import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
const path = new URL('./host-cpu.json', import.meta.url);
const started = new Date().toISOString(),
  samples = [];
const total = () =>
  cpus()
    .map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }))
    .reduce((a, b) => ({ idle: a.idle + b.idle, total: a.total + b.total }), { idle: 0, total: 0 });
let before = total();
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const now = total(),
    pct = 100 * (1 - (now.idle - before.idle) / (now.total - before.total));
  samples.push({ utc: new Date().toISOString(), hostCpuPercent: Number(pct.toFixed(2)) });
  await writeFile(
    path,
    JSON.stringify(
      {
        method: 'Node os.cpus cumulative OS times across all logical CPUs',
        samplerPid: process.pid,
        startedUtc: started,
        durationSeconds: (Date.now() - Date.parse(started)) / 1000,
        samples,
      },
      null,
      2,
    ) + '\n',
  );
  before = now;
}
console.log('CPU minute complete');
