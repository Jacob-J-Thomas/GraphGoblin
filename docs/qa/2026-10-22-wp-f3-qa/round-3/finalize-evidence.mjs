// Sanitize only this round and build a complete Markdown retention manifest.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { repo, evidence, sanitize, save, head } from './qa-lib.mjs';
const files = [];
async function visit(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await visit(p);
      continue;
    }
    files.push(relative(evidence, p).replaceAll('\\', '/'));
    if (/\.(?:log|json|md|txt)$/.test(e.name)) {
      const value = await readFile(p, 'utf8');
      await writeFile(p, sanitize(value));
    }
  }
}
await visit(evidence);
const remaining = (await readdir(tmpdir(), { withFileTypes: true }))
  .filter((x) => x.isDirectory() && x.name.startsWith('gg-qa-243-r3-'))
  .map((x) => x.name);
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
await save('final-boundary.json', {
  expectedHead: head,
  actualHead: git(['rev-parse', 'HEAD']),
  trackedDiff: git(['diff', '--name-only']),
  indexDiff: git(['diff', '--cached', '--name-only']),
  remainingRound3Stores: remaining,
  scope: 'Only round-3 QA files may be added; no commit performed.',
});
files.push('final-boundary.json');
const summary = [];
for (const name of files.filter((x) => x.endsWith('-results.json') && !x.includes('retention'))) {
  try {
    const value = JSON.parse((await readFile(join(evidence, name), 'utf8')).replace(/^\uFEFF/, ''));
    if (value.output !== undefined && value.exitCode !== undefined) {
      value.head ??= head;
      await save(name, value);
    }
    if (Array.isArray(value.results))
      summary.push({
        artifact: name,
        status: value.results.every((x) => x.status === 'PASS') ? 'PASS' : 'FAIL',
        checks: value.results.length,
        cleanup: value.cleanup,
      });
    else if (value.exitCode !== undefined)
      summary.push({
        artifact: name,
        status: value.exitCode === 0 ? 'PASS' : 'FAIL',
        exitCode: value.exitCode,
      });
  } catch {}
}
await save('replay-summary.json', {
  head,
  collection:
    'Scripts invoked individually in serial PowerShell batches; see each JSON for actual observations.',
  summary,
});
files.push('replay-summary.json');
if (!files.includes('ARTIFACTS.md')) files.push('ARTIFACTS.md');
files.push('retention-check-results.json');
const manifest =
  '# Complete retention manifest\n\nEvery replay input, script and observation intended for preservation is linked below.\n\n' +
  [...new Set(files)]
    .sort()
    .map((name) => `- [${name}](${name})`)
    .join('\n') +
  '\n';
await writeFile(join(evidence, 'ARTIFACTS.md'), manifest);
const start = '<!-- QA-ARTIFACTS-START -->',
  end = '<!-- QA-ARTIFACTS-END -->',
  readmePath = join(evidence, 'README.md');
let readme = await readFile(readmePath, 'utf8');
const at = readme.indexOf(start);
if (at >= 0) readme = readme.slice(0, at).trimEnd();
readme +=
  '\n\n' +
  start +
  '\n\n## Complete preservation links\n\n' +
  [...new Set(files)]
    .sort()
    .map((name) => `- [${name}](${name})`)
    .join('\n') +
  '\n\n' +
  end +
  '\n';
await writeFile(readmePath, readme);
const unlinked = [...new Set(files)].filter((name) => !readme.includes(`[${name}](${name})`));
await save('retention-check-results.json', {
  head,
  artifactCount: new Set(files).size,
  allLinkedDirectlyFromReadme: unlinked.length === 0,
  unlinked,
});
console.log(
  JSON.stringify({
    remainingRound3Stores: remaining,
    linkedArtifacts: new Set(files).size,
    unlinked,
  }),
);
