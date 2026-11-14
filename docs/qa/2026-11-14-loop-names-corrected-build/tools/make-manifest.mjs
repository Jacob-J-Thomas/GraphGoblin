// Builds manifest.json from the recorded artifacts. Read-only over the worktree.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const V = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-209-correction-verification';
const A = join(V, 'artifacts');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = (p) => JSON.parse(readFileSync(join(A, p), 'utf8'));
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );

const before = json('before-build/identity.json');
const afterBuild = json('after-build/identity.json');
const afterE2e = json('after-e2e/identity.json');
const comparison = json('build-before-after-comparison.json');
const binding = json('bundle-source-binding.json');
const e2e = json('e2e-selected.results-summary.json');
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const strip = (t) =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [v.files, v.bytes, v.listingSha256]]));

const files = [
  ...walk(A),
  ...walk(join(V, 'tools')),
]
  .map((f) => {
    const buf = readFileSync(f);
    return { path: relative(V, f).replaceAll('\\', '/'), bytes: buf.length, sha256: sha(buf) };
  })
  .sort((x, y) => x.path.localeCompare(y.path));

const manifest = {
  schema: 'ui-209-correction-verification/manifest/1',
  generatedAt: new Date().toISOString(),
  worktree: 'C:/Users/98jak/.codex/worktrees/gg-20261114-loop-names/GraphGoblin',
  branch: afterE2e.branch,
  head: afterE2e.head,
  tree: afterE2e.tree,
  mainTarget: '7c6e635539e12c56b82f226f1ee734d83b985ad4',
  remoteFeatureRefObserved: '0d2fad63c448bc5591c530d087dd05c9af7821cc (expected; correction unpublished)',
  runtime: { node: afterE2e.node, pnpm: '12.8.1 via pnpm.cmd', turbo: '2.11.6', vite: '8.3.4', playwright: '1.63.0', browser: 'Microsoft Edge channel msedge, install dir 157.0.4341.46, headless, ephemeral temp profile' },
  commands: [
    { name: 'build-force', startUtc: '2026-11-14T15:46:09.198Z', endUtc: '2026-11-14T15:46:24.868Z', exit: 0, command: 'pnpm.cmd build --force --cache-dir=.turbo/local-cache', expands: 'turbo run build --force --cache-dir=.turbo/local-cache', turbo: { successful: 12, total: 12, cached: 0, reportedTime: '15.091s' } },
    { name: 'e2e-selected', startUtc: '2026-11-14T15:47:18.891Z', endUtc: '2026-11-14T15:47:49.634Z', exit: 0, command: 'env LIVE=0 PLAYWRIGHT_JSON_OUTPUT_NAME=<artifacts>/e2e-selected.results.json pnpm.cmd --filter @graphgoblin/web test:e2e e2e/loop-names.spec.ts e2e/template-gallery.spec.ts --retries=0 --reporter=list,json --output=<artifacts>/playwright-test-results', playwright: e2e.stats },
  ],
  source: {
    sourceHashesUnchangedAcrossRun: same(before.sources, afterBuild.sources) && same(afterBuild.sources, afterE2e.sources),
    hashes: Object.fromEntries(Object.entries(afterE2e.sources).map(([k, v]) => [k, v.sha256])),
    gitBlobs: Object.fromEntries(Object.entries(afterE2e.sources).map(([k, v]) => [k, v.gitBlob])),
    statusPorcelainLinesBefore: before.statusPorcelainLines,
    statusPorcelainLinesAfter: afterE2e.statusPorcelainLines,
  },
  buildOutputs: {
    unchangedBetweenBuildAndE2e: same(strip(afterBuild.trees), strip(afterE2e.trees)),
    trees: Object.fromEntries(
      Object.entries(afterE2e.trees).map(([k, v]) => [
        k,
        {
          files: v.files,
          bytes: v.bytes,
          listingSha256: v.listingSha256,
          listing: `artifacts/after-e2e/tree-${k.replaceAll('/', '_')}.sha256`,
          changedByThisBuild: !comparison[k].identical,
        },
      ]),
    ),
    changedByThisBuild: Object.fromEntries(
      Object.entries(comparison)
        .filter(([, v]) => !v.identical)
        .map(([k, v]) => [k, { added: v.added, removed: v.removed, changed: v.changed }]),
    ),
    bundleSourceBinding: { bundle: binding.bundle, bundleSha256: binding.bundleSha256, mapSha256: binding.mapSha256, allFiveRuntimeSourcesEmbeddedEqualDisk: binding.allEqual },
  },
  e2e: { tier: 'source-TS real API (tsx, --conditions=development) over in-memory database with FakeHarness, serving freshly built apps/web/dist; Edge via Playwright; ephemeral port', stats: e2e.stats, tests: e2e.tests.map((t) => ({ file: t.file, title: t.title, status: t.status, attempts: t.results.length, ms: t.results[0].duration })) },
  files,
};
writeFileSync(join(V, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(files.length, 'files listed;', 'manifest sha256', sha(readFileSync(join(V, 'manifest.json'))));
