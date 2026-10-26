// Read-only audit of <repo>; write only this round's small JSON evidence.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
const here = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const qa = resolve(here, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = (text) => createHash('sha256').update(text).digest('hex');
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const save = (name, data) => writeFile(join(here, name), JSON.stringify(data, null, 2) + '\n');
const head = git('rev-parse', 'HEAD');
if (head !== '9f654e7f7cfe4180dd8d1258174cc4a2d2a30110') throw Error('Unexpected HEAD');
const prefix = 'docs/qa/2026-10-22-wp-f3-qa/round-3/';
const committed = git('ls-files', prefix)
  .split('\n')
  .map((p) => p.slice(prefix.length));
const readme = await readFile(join(qa, 'round-3/README.md'), 'utf8');
const logs = committed.filter((name) => name.endsWith('.log.txt'));
const links = async (file) => {
  const text = await readFile(file, 'utf8'),
    results = [];
  for (const match of text.matchAll(/\]\(([^)\s#]+)\)/g)) {
    if (/^[a-z]+:/i.test(match[1])) continue;
    results.push({ target: match[1], resolves: await exists(resolve(file, '..', match[1])) });
  }
  return results;
};
const original = JSON.parse(await readFile(join(qa, 'round-3/api-results.json'), 'utf8'));
const rootReport = 'docs/qa/2026-10-22-wp-f3-qa/report.md';
const historicalReportHash = hash(await readFile(join(root, rootReport)));
const committedReportHash = hash(
  execFileSync('git', ['show', 'HEAD:' + rootReport], { cwd: root }),
);
const before = process.argv.includes('--before');
if (before) {
  await save('historical-exit-contradiction.json', {
    source: '../round-3/api-results.json',
    head: original.head,
    note: 'Extracted from retained original JSON; not a regenerated round-3 observation.',
    lifecycle: original.lifecycle,
    cleanup: original.cleanup,
    contradiction:
      'Two signal-exit lifecycle records say unconfirmed; cleanup used a literal true argument.',
  });
  const old = await readFile(join(qa, 'round-2/README.md'), 'utf8');
  const names = [
    ...new Set(
      [...old.matchAll(/[A-Za-z0-9_][A-Za-z0-9_-]*\.(?:log|json|mjs|ps1|txt)/g)].map((m) => m[0]),
    ),
  ].sort();
  await save('round-2-citation-disposition.json', {
    sourceHead: head,
    originalReadmeSha256: hash(old),
    originalEvidenceNames: names,
    retainedRound2Files: git('ls-files', 'docs/qa/2026-10-22-wp-f3-qa/round-2/').split('\n'),
    ownTempDirectories: (await readdir(tmpdir())).filter((n) => /^gg-qa-(?:243|f3)-/.test(n)),
    disposition:
      'Original replay artifacts not retained; round-2 narrative reworded, not regenerated. Round-3 links explicitly identify fresh observations.',
  });
}
const ownLinks = {};
for (const round of ['round-2', 'round-3', 'round-4']) {
  ownLinks[round] = [];
  for (const name of await readdir(join(qa, round))) {
    if (name.endsWith('.md'))
      ownLinks[round].push(
        ...(await links(join(qa, round, name))).map((v) => ({ report: name, ...v })),
      );
  }
}
const actual = await readdir(join(qa, 'round-3'));
await save(before ? 'record-audit-before.json' : 'record-audit-results.json', {
  head,
  committedRound3Count: committed.length,
  committedLogs: await Promise.all(
    logs.map(async (name) => ({
      name,
      exists: await exists(join(qa, 'round-3', name)),
      directlyLinked: readme.includes(`](${name})`),
    })),
  ),
  everyCommittedFileDirectlyLinked: committed.every((name) => readme.includes(`](${name})`)),
  committedRound3Files: committed,
  ignoredOldLogDuplicates: actual.filter((name) => name.endsWith('.log')),
  ownMarkdownLinks: ownLinks,
  rootReportUnchanged: historicalReportHash === committedReportHash,
  rootReportSha256: historicalReportHash,
  round3ApiJsonUnchanged:
    hash(await readFile(join(qa, 'round-3/api-results.json'))) ===
    hash(
      execFileSync('git', ['show', 'HEAD:docs/qa/2026-10-22-wp-f3-qa/round-3/api-results.json'], {
        cwd: root,
      }),
    ),
  remainingRound4Stores: (await readdir(tmpdir())).filter((n) => n.startsWith('gg-qa-f3-r4-')),
  trackedDiff: git('diff', '--name-only').split('\n').filter(Boolean),
  indexDiff: git('diff', '--cached', '--name-only'),
});
console.log(
  JSON.stringify({
    head,
    committedRound3Count: committed.length,
    committedLogs: logs.length,
    rootReportUnchanged: historicalReportHash === committedReportHash,
  }),
);
