import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const directory = fileURLToPath(new URL('./', import.meta.url));
const root = 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin';
const require = createRequire(`${root}/apps/web/package.json`);
const prettier = require('prettier');
const ts = require('typescript');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fragmentPath = join(directory, 'CASES.diagnostic.tsx.fragment');
const initial = await readFile(fragmentPath, 'utf8');
const oldLine = "        originalRunHeader = originalSessionButton.closest('header');";
if (initial.split(oldLine).length !== 2) throw new Error('Exact root-named header correction site required');
const corrected = initial.replace(oldLine, "        originalRunHeader = (await heading(run.id)).closest('header');\n        expect(originalRunHeader).not.toBeNull();");
const config = await prettier.resolveConfig(`${root}/apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx`);
const formatted = await prettier.format(corrected, { ...config, parser: 'typescript' });
const base = await readFile(join(directory, 'base63.component.tsx'));
const proposed = Buffer.concat([base.subarray(0, 60996), Buffer.from('\n'), Buffer.from(formatted)]);
const diagnostics = (ts.transpileModule(proposed.toString(), { fileName: 'component.diagnostic.proposed.tsx', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).diagnostics ?? []).map(item => ({
    code: item.code, category: ts.DiagnosticCategory[item.category], message: ts.flattenDiagnosticMessageText(item.messageText, '\n') }));
if (diagnostics.some(item => item.category === 'Error')) throw new Error('Syntax diagnostic');
await writeFile(fragmentPath, formatted);
await writeFile(join(directory, 'component.diagnostic.proposed.tsx'), proposed);
const binding = JSON.parse(await readFile(join(directory, 'BINDING.json'), 'utf8'));
binding.initialUnexecutedDiagnosticProposalSha256 = binding.proposedSha256;
binding.proposedSha256 = sha(proposed);
binding.proposedBytes = proposed.length;
binding.fragmentSha256 = sha(Buffer.from(formatted));
binding.syntaxOnlyDiagnostics = diagnostics;
binding.rootHeaderCorrection = 'Original run header is captured from existing heading.closest(header), with non-null assertion before rotation; SessionRecoveryControls is outside that header.';
await writeFile(join(directory, 'BINDING.json'), JSON.stringify(binding, null, 2) + '\n');
process.stdout.write(JSON.stringify({ proposedSha256: binding.proposedSha256, fragmentSha256: binding.fragmentSha256,
  syntaxOnlyDiagnostics: diagnostics, rootHeaderCorrectionApplied: true, noCheckoutWrites: true }, null, 2) + '\n');
