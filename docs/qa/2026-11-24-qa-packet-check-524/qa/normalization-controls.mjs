/** Public-CLI QA adaptation of review-02/autocrlf-check.mjs, with a literal-path and raw-byte control. */
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const candidate = 'G:/ggq/gg-fu-qa-packets-20261124/GraphGoblin';
const scratch = mkdtempSync(join(tmpdir(), 'gg-independent-524-'));
const root = join(scratch, 'repository');
mkdirSync(root);
const empty = join(scratch, 'empty.gitconfig');
writeFileSync(empty, '');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: empty,
  GIT_CEILING_DIRECTORIES: scratch,
  GIT_AUTHOR_NAME: 'Independent QA fixture',
  GIT_AUTHOR_EMAIL: 'qa@example.invalid',
  GIT_COMMITTER_NAME: 'Independent QA fixture',
  GIT_COMMITTER_EMAIL: 'qa@example.invalid',
};
const git = (...args) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8', windowsHide: true});
const readOnlyGit = (...args) => git('--no-optional-locks', '-c', 'diff.autoRefreshIndex=false', ...args);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => {
  const file = join(root, path);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, bytes);
};

const historical = 'docs/qa/qa524-control/README.md';
const literal = 'docs/qa/qa524-control/notes [v2].md';
const similarlyNamed = 'docs/qa/qa524-control/notes 2.md';
const rawOriginal = 'docs/qa/2026-11-17-ci-intent-1-independent-qa/immutable-original.md.txt';
const oldMarkdown = '# QA packet\n\nPrevious fixture.\n';
const rawLf = '#  Original evidence\n\n  preserve this spacing\n';
const rawCrlf = Buffer.from(rawLf.replaceAll('\n', '\r\n'));
const stale = new Date('2020-01-01T00:00:00Z');

git('init', '--quiet', '--initial-branch=main');
git('config', 'core.autocrlf', 'true');
git('config', 'diff.autoRefreshIndex', 'true');
const attributes = readFileSync(join(candidate, '.gitattributes'));
assert.match(attributes.toString(), /^\* text=auto eol=lf\b/);
write('.gitattributes', attributes);
write('.prettierrc', readFileSync(join(candidate, '.prettierrc')));
for (const path of [historical, literal, similarlyNamed]) write(path, oldMarkdown);
write(rawOriginal, rawLf);
git('add', '-A');
git('commit', '--quiet', '-m', 'QA fixture baseline');
git('switch', '--quiet', '-c', 'fixture-candidate');
for (const path of [historical, literal]) write(path, oldMarkdown.replaceAll('\n', '\r\n'));
write(similarlyNamed, '# QA packet\n\nA real content change.\n');
write(rawOriginal, rawCrlf);
for (const path of [historical, literal, similarlyNamed, rawOriginal]) {
  utimesSync(join(root, path), stale, stale);
}

const rawIndex = join(root, '.git', 'index');
const observedPaths = [
  historical, literal, similarlyNamed, rawOriginal, '.gitattributes', '.git/config',
];
const snapshot = () => ({
  index: sha(readFileSync(rawIndex)),
  files: Object.fromEntries(observedPaths.map((path) => [path, sha(readFileSync(join(root, path)))])),
  head: readOnlyGit('rev-parse', 'HEAD').trim(),
});
const before = snapshot();
const equalAfterNormalization = Object.fromEntries(
  [historical, literal].map((path) => {
    const indexed = readOnlyGit('rev-parse', ':' + path).trim();
    const normalized = readOnlyGit('hash-object', '--path', path, join(root, path)).trim();
    return [path, {indexed, normalized, equal: indexed === normalized}];
  }),
);
const visibleStalePaths = readOnlyGit('diff-files', '--name-only', '--');
const run = spawnSync(
  process.execPath,
  [join(candidate, 'tooling/scripts/check-qa-packet.mjs'), '--base', 'main'],
  {cwd: root, env, windowsHide: true},
);
const after = snapshot();
const stdout = (run.stdout ?? Buffer.alloc(0)).toString('utf8');
const stderr = (run.stderr ?? Buffer.alloc(0)).toString('utf8');
const entries = [...stdout.matchAll(/^ {2}(\S+) +(.+?)(?: {2}\[(.*)\])?$/gm)].map(
  ([, classification, path, note]) => ({classification, path, note: note ?? null}),
);
writeFileSync(join(evidence, 'NORMALIZATION-CLI.stdout.log'), run.stdout ?? Buffer.alloc(0), {flag: 'wx'});
writeFileSync(join(evidence, 'NORMALIZATION-CLI.stderr.log'), run.stderr ?? Buffer.alloc(0), {flag: 'wx'});
const result = {
  root, node: process.version, gitVersion: git('--version').trim(),
  candidateCheckerSha256: sha(readFileSync(join(candidate, 'tooling/scripts/check-qa-packet.mjs'))),
  attributesSha256: sha(attributes), configuration: {
    autocrlf: git('config', '--local', '--get', 'core.autocrlf').trim(),
    autoRefreshIndex: git('config', '--local', '--get', 'diff.autoRefreshIndex').trim(),
  },
  equalAfterNormalization, visibleStalePaths, before, after, entries, exitCode: run.status,
  sourceAndIndexUnchanged: JSON.stringify(before) === JSON.stringify(after),
  rawOriginalSha256: sha(rawCrlf),
};
writeFileSync(join(evidence, 'NORMALIZATION-CONTROL.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
assert.equal(run.status, 0, stdout + stderr);
assert.equal(Object.values(equalAfterNormalization).every((control) => control.equal), true);
for (const path of [historical, literal, similarlyNamed, rawOriginal]) {
  assert.ok(visibleStalePaths.includes(path), path + ' must be visible before the CLI filters paths');
}
assert.deepEqual(after, before);
assert.deepEqual(entries, [
  {classification: 'retained', path: rawOriginal, note: 'sha256=' + sha(rawCrlf)},
  {classification: 'formatted', path: similarlyNamed, note: null},
]);
console.log(JSON.stringify(result, null, 2));

