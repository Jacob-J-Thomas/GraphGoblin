import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const root = process.cwd(),
  temp = join(tmpdir(), 'gg-qa-231-9896cf-independent'),
  req = createRequire(resolve('apps/web/package.json'));
const workspaceSpecs = [
  '@graphgoblin/api',
  '@graphgoblin/api/testing',
  '@graphgoblin/engine/testing',
  '@graphgoblin/contracts',
];
const resolvedWorkspace = new Map();
for (const spec of workspaceSpecs) {
  const pieces = spec.split('/'),
    dir = resolve('apps/web/node_modules', pieces.slice(0, 2).join('/'));
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const key = pieces.length === 2 ? '.' : './' + pieces.slice(2).join('/');
  resolvedWorkspace.set(spec, resolve(dir, pkg.exports[key].import));
}
const ts = createRequire(resolve('package.json'))('typescript');
await mkdir(temp, { recursive: true });
const sourcePath = resolve('apps/web/e2e/server.ts');
let source = await readFile(sourcePath, 'utf8');
source = source.replace(
  "const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');",
  'const dist = ' + JSON.stringify(resolve('apps/web/dist')) + ';',
);
source = source.replace('port: 0', 'port: nextQaPort++');
source = source.replace('controlServer.listen(0,', 'controlServer.listen(5639,');
source = 'let nextQaPort = 5634;\n' + source;
let compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const workerPath = join(temp, 'worker.mjs');
const worker = await readFile(resolve('apps/web/src/e2e-support/worker.ts'), 'utf8');
await writeFile(
  workerPath,
  ts.transpileModule(worker, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText,
);
compiled = compiled.replace(/from ['"]([^'"]+)['"]/g, (all, spec) => {
  if (spec.startsWith('node:')) return all;
  const path = spec.startsWith('../')
    ? workerPath
    : (resolvedWorkspace.get(spec) ?? req.resolve(spec));
  return 'from ' + JSON.stringify(pathToFileURL(path).href);
});
await writeFile(join(temp, 'e2e-server.mjs'), compiled);
console.log(
  'Prepared unchanged E2E cases with built public packages, fixed disposable ports5634+ and control5639',
);
