// Read-only listener sampling. Never connects to a service or changes a tested component.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = new URL('.', import.meta.url);
const samples = [];
const start = Date.now();
while (Date.now() - start < 900000) {
  const text = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const ports = [
    ...new Set(
      [...text.matchAll(/127\.0\.0\.1:(591\d|593\d)\s+\S+\s+LISTENING\s+\d+/g)].map((m) =>
        Number(m[1]),
      ),
    ),
  ].sort();
  if (
    ports.some((p) => p >= 5910 && p <= 5919) &&
    ports.some((p) => p >= 5930 && p <= 5939) &&
    samples.length < 12
  )
    samples.push({ elapsedSeconds: Math.round((Date.now() - start) / 1000), ports });
  let records = [];
  try {
    records = (await fs.readFile(new URL('results.jsonl', out), 'utf8'))
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
  } catch {}
  await fs.writeFile(
    new URL('parallel-port-overlap.json', out),
    JSON.stringify(
      {
        method: 'Read-only netstat listener sampling; no requests sent.',
        simultaneousRangesObserved: samples.length > 0,
        samples,
      },
      null,
      2,
    ) + '\n',
  );
  if (records.some((r) => r.name === 'with-subloop')) break;
  await new Promise((r) => setTimeout(r, 1000));
}
process.stdout.write('Listener observation finished; see parallel-port-overlap.json.\n');
