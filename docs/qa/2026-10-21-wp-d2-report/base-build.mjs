// Build the archived base without installing dependencies or creating external workspace links.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, dirname } from 'node:path';
import process from 'node:process';
import console from 'node:console';
const require = createRequire(join(process.cwd(), 'package.json'));
const ts = require('typescript');
const root = process.argv[2];
if (!root) throw Error('Pass the git-archive export directory.');
let files = 0;
async function compile(source, output) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const input = join(source, entry.name);
    if (entry.isDirectory()) await compile(input, join(output, entry.name));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const result = ts.transpileModule(await readFile(input, 'utf8'), {
        fileName: input,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          isolatedModules: true,
          esModuleInterop: true,
        },
        reportDiagnostics: true,
      });
      if (result.diagnostics?.length)
        throw Error(
          ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
            getCanonicalFileName: (path) => path,
            getCurrentDirectory: () => root,
            getNewLine: () => '\n',
          }),
        );
      await mkdir(output, { recursive: true });
      await writeFile(join(output, entry.name.replace(/\.ts$/, '.js')), result.outputText);
      files++;
    }
  }
}
for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = join(root, 'packages', entry.name, 'src');
  try {
    await compile(source, join(dirname(source), 'dist'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await compile(join(root, 'apps/api/src'), join(root, 'apps/api/dist'));
console.log(
  JSON.stringify({ source: relative(process.cwd(), root), emittedJavaScriptFiles: files }),
);
