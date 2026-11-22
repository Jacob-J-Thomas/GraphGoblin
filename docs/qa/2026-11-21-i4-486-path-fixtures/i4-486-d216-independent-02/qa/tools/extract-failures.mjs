// Read-only extraction of the full Expected/Received and diff blocks that vitest's verbose reporter
// wrote to each baseline control's stderr (vitest's JSON failureMessages truncate long paths).
// Writes qa/raw/60-baseline-failure-blocks.json. Source stderr files are recorded by hash.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RAW =
  'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d216-independent-02\\qa\\raw';
const ids = [
  's1a-baseline6de-upper-g-temp-engine-temp-recordonly',
  's2a-baseline6de-c-short-temp-engine-fixed-temp-template-recordonly',
];
const out = { at: new Date().toISOString(), method: 'split stderr on " FAIL " headers; no editing', controls: [] };
for (const id of ids) {
  const p = path.join(RAW, `${id}.stderr.txt`);
  const bytes = fs.readFileSync(p);
  const text = bytes.toString('utf8');
  const blocks = text.split(/\n FAIL /).slice(1).map((b) => ' FAIL ' + b);
  out.controls.push({
    id,
    stderr: { source: p, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
    failures: blocks.map((b) => {
      const lines = b.split(/\r?\n/);
      return {
        header: lines[0],
        kind: (lines[0].match(/uses real (\w+) paths/) ?? [])[1],
        location: (b.match(/fs\.test\.ts:(\d+):(\d+)/) ?? [])[0],
        expectedLine: lines.find((l) => l.startsWith('Expected: ')) ?? null,
        receivedLine: lines.find((l) => l.startsWith('Received: ')) ?? null,
        diffMinusLines: lines.filter((l) => /^-\s+"/.test(l)),
        diffPlusLines: lines.filter((l) => /^\+\s+"/.test(l)),
        sourceExcerpt: lines.filter((l) => /^\s+(❯ |\d+\|)/.test(l)),
      };
    }),
  });
}
fs.writeFileSync(path.join(RAW, '60-baseline-failure-blocks.json'), JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
for (const c of out.controls)
  for (const f of c.failures)
    console.log(c.id.slice(0, 3), f.kind, f.location, '|', f.expectedLine ?? f.diffMinusLines[1], '|', f.receivedLine ?? f.diffPlusLines[1]);
