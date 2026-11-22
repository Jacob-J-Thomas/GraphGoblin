// Seal for D203 independent QA: bytes and SHA-256 of every evidence file except SEAL.json itself.
// Run directly (not through record.mjs) so no file is created after the seal is computed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-364-deadline-independent-01';
const SEAL = join(ROOT, 'SEAL.json');
if (existsSync(SEAL)) throw new Error('SEAL.json already exists');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const files = walk(ROOT)
  .map((path) => relative(ROOT, path).split(sep).join('/'))
  .sort()
  .map((path) => {
    const bytes = readFileSync(join(ROOT, ...path.split('/')));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
const find = (path) => files.find((file) => file.path === path);
const seal = {
  kind: 'D203 independent behavior QA for #364 (criterion QA only; no Astra approval, CI, merge or owner acceptance)',
  model: 'claude-opus-5-5 (Opus 5.5), xhigh, actual Claude Code',
  utc: new Date().toISOString(),
  candidate: {
    head: 'e8cf31d51837a4fa362f909604b3070277db6c25',
    tree: '0927bbbf9f3889791c956e7816e3524c9a5a8fe6',
    parent: '580aded6d295061897b047ac16811e5da230d9e0',
    builtProcessJs: '9f8f001123502726bdd986e21935f4940b0d2bdae5905982c581cc07df50202f',
  },
  verdicts: { C1: 'PASS', C2: 'PASS', C3: 'PASS', C4: 'PASS', C5: 'PASS' },
  instrumentationCorrectionsUsed: '3 of 3 (conservative count)',
  report: find('REPORT.md'),
  plan: find('PLAN.md'),
  memberCount: files.length,
  payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  files,
};
writeFileSync(SEAL, JSON.stringify(seal, null, 2) + '\n');
const sealHash = createHash('sha256').update(readFileSync(SEAL)).digest('hex');
console.log(JSON.stringify({ members: files.length, report: seal.report.sha256, seal: sealHash }));
