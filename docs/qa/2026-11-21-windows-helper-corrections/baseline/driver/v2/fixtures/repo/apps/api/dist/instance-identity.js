// QA459I independent #459 correction baseline QA fixture. Not product code. Installed only as
// apps/api/dist/instance-identity.js inside a disposable fixture repository copy, where the
// launcher runs it as its read-only helper. Identity calls print the scenario identity bytes.
// --store-state calls print the scenario's exact ownership response bytes for this call index
// (the last entry repeats), or relay the actual unmodified built ownership producer's stdout bytes
// verbatim. A fixed privacy canary goes only to stderr, which the launcher discards.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const caseDir = process.env.QA459I_CASE_DIR;
const kind = process.argv[2] === '--store-state' ? 'ownership' : 'identity';
const scenario = JSON.parse(readFileSync(join(caseDir, 'scenario.json'), 'utf8'));
const eventsFile = join(caseDir, 'events.ndjson');
const event = (record) =>
  appendFileSync(eventsFile, JSON.stringify({ at: Date.now(), pid: process.pid, kind, ...record }) + '\n');
const index =
  (existsSync(eventsFile)
    ? readFileSync(eventsFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((item) => item.event === 'helper-start' && item.kind === kind).length
    : 0) + 1;
event({ event: 'helper-start', index, argument: process.argv[2] ?? null });
process.on('exit', (code) => event({ event: 'helper-exit', index, code }));
process.stderr.write(scenario.stderrCanary + '\n');

const list = kind === 'identity' ? [scenario.identity] : scenario.ownership;
const spec = list[Math.min(index, list.length) - 1];
if (spec.source === 'bytes') {
  const bytes = Buffer.from(spec.base64, 'base64');
  process.stdout.write(bytes, () => {
    event({ event: 'helper-wrote', index, bytes: bytes.length });
    process.exitCode = 0;
  });
} else if (spec.source === 'real-producer') {
  const child = spawn(process.execPath, [scenario.realProducer, '--store-state'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const out = [];
  const err = [];
  child.stdout.on('data', (chunk) => out.push(chunk));
  child.stderr.on('data', (chunk) => err.push(chunk));
  child.on('close', (code, signal) => {
    const bytes = Buffer.concat(out);
    writeFileSync(join(caseDir, `real-producer-${index}.stdout.bin`), bytes);
    writeFileSync(join(caseDir, `real-producer-${index}.stderr.bin`), Buffer.concat(err));
    event({ event: 'real-producer-exit', index, producerPid: child.pid, code, signal, bytes: bytes.length });
    process.stdout.write(bytes, () => {
      event({ event: 'helper-wrote', index, bytes: bytes.length });
      process.exitCode = code === 0 ? 0 : 1;
    });
  });
} else {
  event({ event: 'fixture-setup-fault', index, reason: 'unknown response source' });
  process.exitCode = 97;
}
