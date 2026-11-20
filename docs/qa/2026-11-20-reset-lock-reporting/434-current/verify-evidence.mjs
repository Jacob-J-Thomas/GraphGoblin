import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p));
const json = (p) => JSON.parse(read(p));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const inventory = (dir, base = dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? inventory(path.join(dir, e.name), base)
        : [path.relative(base, path.join(dir, e.name)).replaceAll('\\', '/')],
    )
    .sort();
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--integrity-only'));
const manifest = json('evidence-manifest.json');
assert.equal(manifest.base, '8181f350028e284529c76b51927f32890afcb68a');
assert.equal(manifest.source, 'dc65a245a3c21a8dec6b975d9d1d2d63f8a59eaa');
assert.deepEqual(
  inventory(root).filter((p) => p !== 'evidence-manifest.json'),
  manifest.files.map((f) => f.path).sort(),
);
for (const f of manifest.files) {
  assert.ok(path.resolve(root, f.path).startsWith(root + path.sep));
  assert.equal(read(f.path).length, f.bytes, f.path);
  assert.equal(sha(read(f.path)), f.sha256, f.path);
}
const prior = json('../434-first-held/evidence-manifest.json');
assert.equal(
  sha(read('../434-first-held/evidence-manifest.json')),
  'c9e380f934dad3469b032a38ded3ed16857adc917af4e140f4ff862795899c3a',
);
for (const f of prior.files) assert.equal(sha(read('../434-first-held/' + f.path)), f.sha256);
const p = json('provenance.json');
const binding = json('source-binding.json');
assert.equal(p.publicationReady, false);
assert.equal(binding.source, manifest.source);
assert.equal(binding.files.length, 11);
assert.deepEqual(
  binding.files
    .filter((f) => !f.sameAsCorrective)
    .map((f) => f.path)
    .sort(),
  ['apps/api/src/reset/reset-acquisition.test.ts', 'apps/api/src/reset/reset-ownership.test.ts'],
);
assert.deepEqual(binding.carryOver.productionDelta, []);
const state = json('independent/state.json');
assert.equal(state.terminalVerdict, null);
assert.equal(state.pendingSlot.status, 'awaiting genuine independent terminal QA after reset');
assert.equal(state.process.code, 1);
assert.equal(state.provider.is_error, true);
assert.equal(state.publicationReady, false);
assert.equal(
  state.rawResult.sha256,
  '763770cfb734ed23b4c7dd2c85efb7fd470c5f88aece8093243e2ecdb650a779',
);
for (const f of state.drivers) assert.equal(sha(read(f.path)), f.sha256);
const independent = json('independent/run-01.projection.json');
assert.equal(independent.originalSource.sha256, state.rawResult.sha256);
assert.equal(independent.provenance.head, manifest.source);
assert.deepEqual(independent.provenance.trackedChanges, []);
assert.equal(
  independent.provenance.fileSha256['apps/api/src/reset/reset.ts'],
  binding.files.find((f) => f.path === 'apps/api/src/reset/reset.ts').sha256,
);
const assertions = independent.scenarios.flatMap((s) => s.assertions);
const tally = (list) => ({
  total: list.length,
  pass: list.filter((a) => a.outcome === 'pass').length,
  fail: list.filter((a) => a.outcome === 'fail').length,
  notRun: list.filter((a) => !['pass', 'fail'].includes(a.outcome)).length,
});
assert.deepEqual(tally(assertions), { total: 282, pass: 280, fail: 2, notRun: 0 });
assert.deepEqual(tally(assertions), independent.totals.all);
for (const kind of Object.keys(independent.totals.byKind))
  assert.deepEqual(
    tally(assertions.filter((a) => a.kind === kind)),
    independent.totals.byKind[kind],
  );
assert.equal(independent.totals.byKind.acceptance.pass, 69);
assert.equal(independent.totals.byKind.safety.pass, 66);
assert.deepEqual(
  assertions.filter((a) => a.outcome === 'fail').map((a) => a.id),
  ['S08.confirmed.dirLockReleasedAndReported', 'S11.confirmed.nestedUnrelatedListedAsKept'],
);
const terminals = json('author/terminal-receipts.json');
assert.deepEqual(
  terminals.map((t) => t.originalReport.sha256),
  [
    '619ca33b1d45795b06726adfd13c1975c99a83a87202aa2ecba01366c7322d07',
    'f50b8679e35c583ee4bd197b8fe19bc4a3b2f498bc684fc8ab5a90c68dac95d0',
  ],
);
for (const t of terminals) {
  assert.equal(t.code, 0);
  assert.equal(t.providerSubtype, 'success');
  assert.equal(t.is_error, false);
  assert.equal(t.messageMatchesProviderResult, true);
}
const ci = json('ci-status.json');
assert.equal(ci.current.run, 44707027142);
assert.equal(ci.current.head, manifest.source);
assert.equal(ci.current.unitPassed, 9997);
assert.equal(ci.current.unitSkipped, 50);
assert.equal(ci.current.browserPassed, 488);
assert.equal(ci.current.nativeWindowsPassed, 25);
assert.equal(Object.keys(ci.current.jobs).length, 6);
for (const job of Object.values(ci.current.jobs)) assert.equal(job.conclusion, 'success');
assert.equal(ci.current.windowsCorpus.head, manifest.source);
assert.equal(ci.current.windowsCorpus.records, 234);
assert.equal(ci.current.windowsCorpus.canonicalReplay, true);
assert.equal(ci.historical.source, 'a8191dd97aacfe9709d2369afd60497214bf00a7');
assert.equal(ci.historical.windowsCorpus.records, 234);
assert.equal(ci.historical.windowsCorpus.head, ci.historical.source);
const preview = json('prospective-combination.json');
assert.equal(preview.inputs.reset.commit, manifest.source);
assert.match(preview.limits.join('\n'), /not induced/);
let links = 0;
for (const file of inventory(root)) {
  const text = read(file).toString('utf8');
  const decoded = text.replaceAll('\\\\', '\\');
  assert.ok(!/(?:^|[^a-z])[a-z]:(?:\\|\/(?!\/))/im.test(decoded), 'absolute drive path: ' + file);
  assert.ok(
    !/\\\\[^\s\\]+\\(?:Users|home)|Bearer\s+[a-z0-9._-]{8,}|sk-(?:ant-)?[a-z0-9_-]{12,}/i.test(
      decoded,
    ),
    'private path or credential-like value: ' + file,
  );
  if (file.endsWith('.md'))
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      assert.ok(
        fs.existsSync(path.resolve(root, path.dirname(file), link.split('#')[0])),
        'broken local link: ' + link,
      );
      links++;
    }
}
const summary = {
  result: args.includes('--integrity-only') ? 'integrity-pass' : 'held',
  publicationReady: false,
  source: manifest.source,
  manifestSha256: sha(read('evidence-manifest.json')),
  files: manifest.files.length,
  bytes: manifest.files.reduce((s, f) => s + f.bytes, 0),
  assertions: assertions.length,
  pass: 280,
  fail: 2,
  acceptance: 69,
  safety: 66,
  localLinks: links,
  priorPacketVerified: true,
  independentTerminal: 'pending',
};
console.log(JSON.stringify(summary, null, 2));
process.exitCode = args.includes('--integrity-only') ? 0 : 2;
