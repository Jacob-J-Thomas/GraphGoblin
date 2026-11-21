// Writes i4-486-independent-02/SHA256SUMS.json (excluding runner-owned provider/ and itself) and
// re-verifies every original01/checkpoint file listed in the quota checkpoint is byte-unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents';
const root = path.join(Q, 'i4-486-independent-02');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(root, p).split(path.sep).join('/');
    if (rel === 'provider' || rel.startsWith('provider/') || rel === 'SHA256SUMS.json') continue;
    if (e.isDirectory()) walk(p);
    else files.push({ path: rel, bytes: fs.statSync(p).size, sha256: sha(p) });
  }
}
walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const cp = JSON.parse(fs.readFileSync(path.join(Q, 'i4-486-quota-checkpoint-01/checkpoint.json'), 'utf8'));
const preservation = [];
for (const pk of cp.packets)
  for (const f of pk.files) {
    for (const loc of [f.original, f.snapshot].filter(Boolean)) {
      const p = loc.split('\\').join('/');
      let h = 'missing';
      try { h = sha(p); } catch {}
      preservation.push({ path: p, ok: h === f.sha256 });
    }
  }
const manifest = {
  generatedUTC: new Date().toISOString(),
  packet: 'i4-486-independent-02',
  excludes: ['provider/ (runner-owned)', 'SHA256SUMS.json (self)'],
  candidate: { head: '633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9', tree: 'd0e38c6c0212e312e6b605ac3d6bc8f7af5a129f' },
  files,
  originalPreservation: { checked: preservation.length, allEqual: preservation.every((p) => p.ok), mismatches: preservation.filter((p) => !p.ok) },
  inheritedInputs: {
    originalPlan: 'd2b0684a529be79ece08c5e3afbd5bbcbf05d4adba146a7ffdaf917c1caf6c83',
    d1Results: '6a60a755376bf5c1d6d74dedbba8e5bbe39e08297a82621c4ef85ff8e239f9f4',
    originalEvents: '29635e3c9e73e24d8316fde9b05292be88febdfe62c56e47dd21cc7dc427b90e',
    originalResult: 'c6462974c0126701ea5628f5505ef38737e5479eb603baa6002f59f709e1a5d3',
    originalExit: 'ecd8500957b5a9213f891f4610a356a83c1845af65d19a130695c9f4036a4447',
    checkpointToolCalls: '0612cd852acbc4d71fda82b2a7d13bddb70021e26252e7b456d31c45d7300530',
    checkpointVisibleText: '260533428fcd593dfb29dd7b8f1199dc419ddf262a9d3896f1c9a991829675af',
  },
};
fs.writeFileSync(path.join(root, 'SHA256SUMS.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify({ files: files.length, preservationChecked: preservation.length, allEqual: manifest.originalPreservation.allEqual, mismatches: manifest.originalPreservation.mismatches }));
