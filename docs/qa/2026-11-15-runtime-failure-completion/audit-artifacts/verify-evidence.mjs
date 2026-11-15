import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const out = path.join(batch, 'review-485-astra-scan2');
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p).toString('utf8').replace(/^\uFEFF/, ''));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const text = (...args) => git(...args).toString('utf8').trim();
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const report = { at: new Date().toISOString(), node: process.version, identity: {}, packets: [], source: {}, build: {}, shapes: {} };
report.identity = {
  head: text('rev-parse', 'HEAD'), tree: text('rev-parse', 'HEAD^{tree}'), target: text('rev-parse', 'origin/main'),
  status: text('status', '--porcelain=v1'), mergeBase: text('merge-base', 'HEAD', 'f91bd69b79dc417a2997ddb9c7670cb33df7597c'),
  testedMerge: text('cat-file', '-p', '955dccf755f5f34387f990ff47fa49c7bbf45f55'),
  productDeltaAfterSource: text('diff', '--name-status', '615d50bc358d73bc55ad0591f4f625f1a46cb671..HEAD', '--', 'packages', 'apps', 'tooling', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', '.github'),
  allDeltaAfterSource: text('diff', '--name-status', '615d50bc358d73bc55ad0591f4f625f1a46cb671..HEAD', '--', '.', ':!docs/qa'),
  effectivePaths: text('diff', '--name-only', 'f91bd69b79dc417a2997ddb9c7670cb33df7597c..HEAD').split('\n'),
};
const packetNames = ['2026-11-15-runtime-failure-baseline', '2026-11-15-runtime-failure-implementation', '2026-11-15-runtime-failure-candidate', '2026-11-15-runtime-failure-ci', '2026-11-15-runtime-failure-review', '2026-11-15-poll-dedupe-current-ci', '2026-11-15-poll-dedupe-completion'];
for (const name of packetNames) {
  const dir = path.join(repo, 'docs/qa', name);
  const manifestName = fs.existsSync(path.join(dir, 'SHA256SUMS.txt')) ? 'SHA256SUMS.txt' : 'SHA256SUMS';
  const entries = read(path.join(dir, manifestName)).toString().split(/\r?\n/).filter(Boolean).map(line => {
    const m = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new Error('Unrecognized manifest row: ' + line);
    const file = path.resolve(dir, m[2]);
    if (!file.toLowerCase().startsWith((dir + path.sep).toLowerCase())) throw new Error('Manifest escapes packet');
    return { path: m[2], expected: m[1], actual: hash(read(file)) };
  });
  const present = walk(dir).map(p => path.relative(dir, p).replaceAll('\\', '/')).filter(p => p !== manifestName);
  const inventory = new Set(entries.map(e => e.path.replaceAll('\\', '/')));
  const result = { name, manifestSha256: hash(read(path.join(dir, manifestName))), count: entries.length, mismatches: entries.filter(e => e.actual !== e.expected), unlisted: present.filter(p => !inventory.has(p)), copyMap: null };
  const mapPath = path.join(dir, 'source-copy-map.json');
  if (fs.existsSync(mapPath)) {
    const map = json(mapPath);
    const rows = Array.isArray(map) ? map : map.files ?? map.entries ?? map.copies;
    if (!Array.isArray(rows)) throw new Error('Unknown copy-map schema: ' + name);
    const outcomes = rows.map(row => {
      const destination = row.destinationPath ?? row.destination ?? row.path;
      const source = row.sourcePath ?? row.sources?.[0]?.path;
      const result = { destination, source };
      if (!destination) return { ...result, externalOnly: true, row };
      const dst = read(path.resolve(dir, destination));
      result.destinationHash = hash(dst);
      const expectedHash = row.destinationSHA256 ?? row.destinationSha256 ?? row.sha256 ?? entries.find(e => e.path === destination)?.expected;
      const expectedBytes = row.destinationBytes ?? row.bytes;
      result.destinationMatches = result.destinationHash === expectedHash && (expectedBytes === undefined || dst.length === expectedBytes);
      if (source) {
        const sourcePath = path.isAbsolute(source) ? source : path.resolve(batch, source);
        if (fs.existsSync(sourcePath)) {
          const src = read(sourcePath);
          const sourceHash = row.sourceSHA256 ?? row.sourceSha256 ?? row.sources?.[0]?.sha256 ?? expectedHash;
          const sourceBytes = row.sourceBytes ?? (row.sources ? row.sources[0]?.bytes : expectedBytes);
          result.sourceMatches = hash(src) === sourceHash && (sourceBytes === undefined || src.length === sourceBytes);
          if (/derived|extracts/i.test((row.kind ?? '') + ' ' + (row.method ?? ''))) result.derivedNotByteCopy = true;
          else result.byteExact = src.equals(dst);
        } else result.sourceMissing = true;
      } else result.remoteOrDerivedOrigin = row.source ?? row.kind ?? 'See original source map';
      return result;
    });
    result.copyMap = { entries: rows.length, outcomes };
  }
  report.packets.push(result);
}
const source = json(path.join(repo, 'docs/qa/2026-11-15-runtime-failure-implementation/implementation/changed-source.json'));
report.source.entries = source.changed.map(row => {
  const original = git('show', '615d50bc358d73bc55ad0591f4f625f1a46cb671:' + row.path);
  const current = git('show', 'HEAD:' + row.path);
  return { path: row.path, sourceMatchesManifest: hash(original) === row.sha256 && original.length === row.bytes, headMatchesOriginal: current.equals(original), currentSha256: hash(current) };
});
const binding = json(path.join(repo, 'docs/qa/2026-11-15-runtime-failure-candidate/build/candidate-build-binding.json'));
report.build = { head: binding.head, tree: binding.tree, sourceCount: Object.keys(binding.source).length, outputCount: Object.keys(binding.output).length, outputRoots: binding.roots, outputChanges: [] };
for (const [p, expected] of Object.entries(binding.output)) {
  const full = path.resolve(repo, p);
  const actual = fs.existsSync(full) ? hash(read(full)) : 'missing';
  if (actual !== expected) report.build.outputChanges.push({ path: p, expected, actual });
}
for (const [name, relative] of Object.entries({
  functional: 'functional/corrected-attempt-1/a1-explicit/before-recovery.json',
  internal: 'internal/evidence-candidate-first/typed-inference-internal.json',
  historical: 'internal/evidence-candidate-first/historical-nested-recording.json',
})) {
  const value = json(path.join(repo, 'docs/qa/2026-11-15-runtime-failure-candidate', relative));
  report.shapes[name] = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, Array.isArray(v) ? { type: 'array', length: v.length, firstKeys: typeof v[0] === 'object' && v[0] ? Object.keys(v[0]) : [] } : typeof v === 'object' && v ? Object.keys(v) : v]));
}
fs.writeFileSync(path.join(out, 'evidence-integrity.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ head: report.identity.head, tree: report.identity.tree, target: report.identity.target, status: report.identity.status, effectivePaths: report.identity.effectivePaths.length, productDeltaAfterSource: report.identity.productDeltaAfterSource, packets: report.packets.map(p => ({ name: p.name, count: p.count, mismatches: p.mismatches.length, unlisted: p.unlisted, copyCount: p.copyMap?.entries, copyExceptions: p.copyMap?.outcomes.filter(o => o.destinationMatches === false || o.sourceMatches === false || o.byteExact === false || o.sourceMissing), remoteOrDerived: p.copyMap?.outcomes.filter(o => o.remoteOrDerivedOrigin).length })), sourceCount: report.source.entries.length, sourceChanges: report.source.entries.filter(e => !e.sourceMatchesManifest || !e.headMatchesOriginal), build: report.build }, null, 2));
