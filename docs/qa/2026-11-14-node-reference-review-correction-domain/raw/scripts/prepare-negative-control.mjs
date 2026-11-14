import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [repoArgument] = process.argv.slice(2);
if (!repoArgument) throw new Error('Pass the admitted checkout path');
const repo = realpathSync(repoArgument);
const base = 'ae8add8a791699e905540465b5ddf929d00c50eb';
const evidence = dirname(fileURLToPath(import.meta.url));
const mirror = join(evidence, 'negative-control');
const domain = 'packages/domain';
const finalTest = domain + '/src/node-references.test.ts';
const correctedProduct = new Set([
  domain + '/src/node-references.ts',
  domain + '/src/expression-references.ts',
]);
const git = (...args) =>
  execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });

const tree = git('rev-parse', base + '^{tree}').toString().trim();
git('diff', '--exit-code', base, '--', 'packages/contracts', 'tooling', 'pnpm-lock.yaml', 'patches');
const manifest = git(
  'ls-tree',
  '-r',
  '-z',
  base,
  '--',
  'tsconfig.base.json',
  domain + '/package.json',
  domain + '/tsconfig.json',
  domain + '/vitest.config.ts',
  domain + '/src',
)
  .toString()
  .split('\0')
  .filter(Boolean);
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

const copies = [];
for (const kind of ['ae8', 'corrected']) {
  const copy = join(mirror, kind);
  mkdirSync(dirname(copy), { recursive: true });
  mkdirSync(copy);
  const sources = [];
  for (const entry of manifest) {
    const [metadata, file] = entry.split('\t');
    const [, type, baseBlob] = metadata.split(' ');
    if (type !== 'blob') throw new Error('Unexpected Git object for ' + file);
    const useFinal = file === finalTest || (kind === 'corrected' && correctedProduct.has(file));
    const baseBytes = git('cat-file', 'blob', baseBlob);
    const bytes = useFinal ? readFileSync(join(repo, file)) : baseBytes;
    const destination = join(copy, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    const readback = readFileSync(destination);
    if (!readback.equals(bytes)) throw new Error('Byte mismatch in ' + destination);
    const blob = digest('sha1', Buffer.concat([Buffer.from('blob ' + readback.length + '\0'), readback]));
    if (!useFinal && blob !== baseBlob) throw new Error('Git blob mismatch in ' + destination);
    sources.push({
      file,
      from: useFinal ? 'corrected checkout' : base,
      baseBlob,
      blob,
      sha256: digest('sha256', readback),
      size: readback.length,
    });
  }
  const dependencies = [];
  for (const dependency of [
    '@graphgoblin/contracts',
    '@graphgoblin/tooling',
    'ajv',
    'ajv-formats',
    'jsonata',
    'liquidjs',
    'vitest',
  ]) {
    const target = realpathSync(join(repo, domain, 'node_modules', dependency));
    const junction = join(copy, domain, 'node_modules', dependency);
    mkdirSync(dirname(junction), { recursive: true });
    symlinkSync(target, junction, 'junction');
    if (resolve(realpathSync(junction)) !== resolve(target)) {
      throw new Error('Dependency junction mismatch in ' + junction);
    }
    dependencies.push({ dependency, target });
  }
  copies.push({ kind, copy, sources, dependencies });
}
writeFileSync(
  join(mirror, 'source-manifest.json'),
  JSON.stringify({ repo, base, tree, node: process.version, copies }, null, 2) + '\n',
);
for (const { kind, sources } of copies) {
  console.log(kind + ': ' + sources.length + ' byte-verified source/config files');
  console.log(finalTest + ' ' + sources.find(({ file }) => file === finalTest).sha256);
}
