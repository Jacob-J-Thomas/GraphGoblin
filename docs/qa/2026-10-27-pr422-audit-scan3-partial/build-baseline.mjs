// Exact git snapshot, normal TypeScript isolated-module emit, no dependency copies or links.
// Existing installed dependencies are resolved by baseline-loader.mjs. Not a pnpm main gate.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const ts = createRequire(path.join(process.env.GG_AUDIT_REPO, 'package.json'))('typescript');
import * as L from './lib.mjs';
const dest = path.join(L.ROOT, 'baseline-main');
fs.mkdirSync(dest, { recursive: true });
const sha = spawnSync('git', ['rev-parse', '35576b4a'], {
  cwd: L.REPO,
  encoding: 'utf8',
}).stdout.trim();
if (!fs.existsSync(path.join(dest, 'apps/api/src/main.ts'))) {
  const tar = path.join(L.ROOT, 'baseline-main.tar');
  const archive = spawnSync(
    'git',
    [
      'archive',
      '--format=tar',
      '--output=' + tar,
      sha,
      'apps/api',
      'packages/contracts',
      'packages/domain',
      'packages/engine',
      'packages/infrastructure',
      'packages/adapter-codex',
      'packages/adapter-jev',
      'package.json',
      'pnpm-lock.yaml',
    ],
    { cwd: L.REPO, encoding: 'utf8' },
  );
  if (archive.status !== 0) throw Error(String(archive.stderr || archive.error));
  let extract = spawnSync('tar.exe', ['-xf', tar, '-C', dest], { encoding: 'utf8' });
  if (extract.status !== 0) throw Error(extract.stderr || String(extract.error));
}
const packages = [
  'apps/api',
  'packages/contracts',
  'packages/domain',
  'packages/engine',
  'packages/infrastructure',
  'packages/adapter-codex',
  'packages/adapter-jev',
];
let emitted = 0;
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
for (const pkg of packages)
  for (const file of walk(path.join(dest, pkg, 'src'))) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.includes('__fixtures__'))
      continue;
    const relative = path.relative(path.join(dest, pkg, 'src'), file);
    const out = path.join(dest, pkg, 'dist', relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: true,
        esModuleInterop: true,
        isolatedModules: true,
      },
    });
    fs.writeFileSync(out, result.outputText, 'utf8');
    emitted++;
  }
fs.cpSync(path.join(dest, 'apps/api/templates'), path.join(dest, 'apps/api/dist/catalog'), {
  recursive: true,
});
const changed = spawnSync('git', ['diff', sha, 'HEAD', '--', 'pnpm-lock.yaml', 'package.json'], {
  cwd: L.REPO,
  encoding: 'utf8',
}).stdout;
L.save('baseline-build.json', {
  sha,
  method:
    'TypeScript 6 isolated-module emit of exact git snapshot; existing installed dependency resolution via loader; no source modifications; not standard pnpm build/typecheck',
  emitted,
  lockAndRootManifestEqual: changed.length === 0,
  node: process.version,
  sourceRoot: dest,
});
console.log(
  'Emitted baseline ' +
    sha +
    ' modules=' +
    emitted +
    ' dependency lock unchanged=' +
    (changed.length === 0),
);
