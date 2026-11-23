import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = new URL('./', import.meta.url);
const worktree = 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin';
const helper = `${worktree}/apps/web/e2e/independent-420-geometry.ts`;
const require = createRequire(`${worktree}/apps/web/package.json`);
const prettier = require('prettier');
const ts = require('typescript');
const original = await readFile(new URL('independent-420-geometry.original.ts', directory), 'utf8');
const proposedUrl = new URL('independent-420-geometry.proposed.ts', directory);
const beforeFormat = await readFile(proposedUrl, 'utf8');
const config = await prettier.resolveConfig(helper);
const proposed = await prettier.format(beforeFormat, { ...config, filepath: helper });
await writeFile(proposedUrl, proposed);
const withoutDiagnostics = beforeFormat
  .replace('  await page.evaluate(() => document.fonts.ready.then(() => undefined));\n', '')
  .replace(/  const culprits = await page\.evaluate\(\(\) => \{[\s\S]*?\n  \}\);\n(?=  const measurement = \{)/, '')
  .replace('    culprits,\n', '');
const normal = (value) => value.replaceAll('\r\n', '\n');
if (normal(withoutDiagnostics) !== normal(original)) throw new Error('Existing helper text changed');
const result = ts.transpileModule(proposed, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  fileName: 'independent-420-geometry.proposed.ts', reportDiagnostics: true,
});
const diagnostics = (result.diagnostics ?? []).map((entry) => ({
  category: ts.DiagnosticCategory[entry.category], code: entry.code,
  message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
}));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const current = await readFile(helper);
const receipt = {
  node: process.version, executable: process.execPath,
  typescript: { path: require.resolve('typescript'), version: ts.version },
  prettier: { path: require.resolve('prettier'), version: prettier.version },
  preparationOnly: true, appImported: false, productTestOrBuildOrBrowserRun: false,
  syntaxOnlyDiagnostics: diagnostics, existingHelperTextPreserved: true,
  originalCopySha256: digest(await readFile(new URL('independent-420-geometry.original.ts', directory))),
  currentCheckoutHelperSha256: digest(current), proposedSha256: digest(Buffer.from(proposed)),
  proposedPath: fileURLToPath(proposedUrl),
};
if (receipt.originalCopySha256 !== receipt.currentCheckoutHelperSha256)
  throw new Error('Checkout helper differs from original copy');
await writeFile(new URL('SYNTAX-ONLY.json', directory), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(receipt) + '\n');
if (diagnostics.some((entry) => entry.category === 'Error')) process.exitCode = 1;
