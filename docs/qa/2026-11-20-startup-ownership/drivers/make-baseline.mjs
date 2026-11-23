#!/usr/bin/env node
// GraphGoblin #409 QA: reconstruct a main-equivalent built API OUTSIDE the checkout.
//
// The candidate changes exactly two non-test API modules (data-dir-lock.ts, serve.ts). This
// script copies the candidate's built apps/api/dist into a scratch folder, replaces those two
// modules with main's sources transpiled by the checkout's own TypeScript, and links the
// checkout's node_modules through directory junctions so the normal entry (dist/main.js) runs.
// It only READS the checkout and Git (git show / git diff); nothing tracked or built is changed.
//
// Fidelity check: the same transpile of the CANDIDATE sources must equal the candidate's tsc
// output byte for byte (ignoring the trailing sourceMappingURL comment).
//
// Usage:
//   node make-baseline.mjs --checkout <repo> --base <main-sha> --head <candidate-sha> --out <dir>
//   node make-baseline.mjs --out <dir> --remove-links      (removes only the junctions it made)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
  else {
    args[a.slice(2)] = next;
    i++;
  }
}
const out = path.resolve(String(args.out));
const linkPaths = [path.join(out, 'node_modules'), path.join(out, 'apps', 'api', 'node_modules')];

async function removeLinks() {
  for (const link of linkPaths) {
    try {
      const info = await lstat(link);
      // Never recurse: a junction is removed as a link, its target is untouched.
      if (info.isSymbolicLink()) await unlink(link);
      else throw new Error(`${link} is not a link; refusing to remove it`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

if (args['remove-links']) {
  await removeLinks();
  console.log(`removed junctions under ${out}`);
  process.exit(0);
}

const checkout = path.resolve(String(args.checkout));
const base = String(args.base);
const head = String(args.head);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const git = (...gitArgs) =>
  execFileSync('git', ['-C', checkout, ...gitArgs], { encoding: 'utf8', maxBuffer: 16 << 20 });

const actualHead = git('rev-parse', 'HEAD').trim();
if (actualHead !== head) throw new Error(`checkout HEAD ${actualHead} is not ${head}`);
const changed = git('diff', '--name-only', base, head, '--', 'apps/api/src', 'packages')
  .split('\n')
  .filter((name) => name && !name.endsWith('.test.ts'));
const MODULES = ['data-dir-lock', 'serve'];
const expected = MODULES.map((m) => `apps/api/src/${m}.ts`).sort();
if (JSON.stringify(changed.sort()) !== JSON.stringify(expected))
  throw new Error(`unexpected non-test runtime diff: ${JSON.stringify(changed)}`);

const require = createRequire(path.join(checkout, 'apps', 'api', 'package.json'));
const ts = require('typescript');
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  esModuleInterop: true,
  noImplicitOverride: true,
  sourceMap: false,
};
const transpile = (source, fileName) =>
  ts.transpileModule(source, { compilerOptions, fileName }).outputText;
const stripMap = (js) => js.replace(/\n\/\/# sourceMappingURL=.*\s*$/u, '\n');

await mkdir(path.join(out, 'apps', 'api'), { recursive: true });
await cp(path.join(checkout, 'apps', 'api', 'dist'), path.join(out, 'apps', 'api', 'dist'), {
  recursive: true,
});
await cp(path.join(checkout, 'apps', 'api', 'templates'), path.join(out, 'apps', 'api', 'templates'), {
  recursive: true,
});
await cp(
  path.join(checkout, 'apps', 'api', 'package.json'),
  path.join(out, 'apps', 'api', 'package.json'),
);

const manifest = {
  purpose: 'Reconstructed main-equivalent API build for #409 baseline QA (not a product build)',
  checkout,
  candidateHead: head,
  baseCommit: base,
  typescript: ts.version,
  nonTestRuntimeDiff: changed,
  modules: [],
};
for (const m of MODULES) {
  const rel = `apps/api/src/${m}.ts`;
  const candidateSource = await readFile(path.join(checkout, rel), 'utf8');
  const candidateBuilt = await readFile(path.join(checkout, 'apps', 'api', 'dist', `${m}.js`), 'utf8');
  const candidateTranspiled = transpile(candidateSource, `${m}.ts`);
  const fidelity = stripMap(candidateBuilt) === candidateTranspiled;
  if (!fidelity) throw new Error(`transpile fidelity check failed for ${m}`);
  const baseSource = git('show', `${base}:${rel}`);
  const baseJs = transpile(baseSource, `${m}.ts`);
  const target = path.join(out, 'apps', 'api', 'dist', `${m}.js`);
  await writeFile(target, baseJs);
  // Remove the copied candidate source map so it cannot be mistaken for the baseline module's.
  await unlink(`${target}.map`).catch(() => undefined);
  manifest.modules.push({
    module: rel,
    candidateDistSha256: sha256(candidateBuilt),
    candidateTranspileEqualsTsc: fidelity,
    baseSourceSha256: sha256(baseSource),
    baselineJsSha256: sha256(baseJs),
  });
}

await removeLinks();
await symlink(path.join(checkout, 'node_modules'), linkPaths[0], 'junction');
await symlink(path.join(checkout, 'apps', 'api', 'node_modules'), linkPaths[1], 'junction');
manifest.junctions = linkPaths;
await writeFile(path.join(out, 'baseline-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
