// QA167I independent D167 behavior QA fixture. Not product code. Installed only as
// apps/api/dist/instance-identity.js inside a disposable fixture repository copy, where the compiled
// launcher runs it as its read-only helper inside the private job. The case's scenario.json drives it:
// identity calls print the fixed 64-hex identity or stall; --store-state calls print held/free for this
// call index (the last entry repeats) after an optional delay, or stall. A stalled helper appends a
// heartbeat every 50 ms so the driver can observe its termination without PID lookups. The driver never
// signals a helper; any termination is the launcher's own private-job cleanup.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const caseDir = process.env.QA167I_CASE_DIR;
const kind = process.argv[2] === '--store-state' ? 'ownership' : 'identity';
const scenario = JSON.parse(readFileSync(join(caseDir, 'scenario.json'), 'utf8'));
const eventsFile = join(caseDir, 'events.ndjson');
const event = (record) =>
  appendFileSync(eventsFile, JSON.stringify({ at: Date.now(), pid: process.pid, ppid: process.ppid, kind, ...record }) + '\n');
const index =
  (existsSync(eventsFile)
    ? readFileSync(eventsFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((item) => item.event === 'helper-start' && item.kind === kind).length
    : 0) + 1;
event({ event: 'helper-start', index });
process.on('exit', (code) => event({ event: 'helper-exit', index, code }));

const list = scenario[kind];
const step = list[Math.min(index, list.length) - 1];
const write = (text) =>
  process.stdout.write(text, () => event({ event: 'helper-wrote', index, mode: step.mode, bytes: Buffer.byteLength(text) }));
const later = (text) => setTimeout(() => write(text), step.delayMs ?? 0);
if (step.mode === 'identity') later(scenario.identityHex + '\n');
else if (step.mode === 'free') later(JSON.stringify({ state: 'free' }) + '\n');
else if (step.mode === 'held')
  later(JSON.stringify({ state: 'held', path: scenario.lockPath, detail: 'another GraphGoblin process holds this store' }) + '\n');
else if (step.mode === 'stall') {
  const beat = join(caseDir, `heartbeat-${kind}-${index}.ndjson`);
  const tick = () => appendFileSync(beat, JSON.stringify({ at: Date.now(), pid: process.pid }) + '\n');
  tick();
  setInterval(tick, 50);
} else {
  event({ event: 'fixture-fault', index });
  process.exitCode = 97;
}
