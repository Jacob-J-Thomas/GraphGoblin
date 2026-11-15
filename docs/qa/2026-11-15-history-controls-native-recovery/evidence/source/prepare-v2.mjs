import assert from 'node:assert/strict';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const old=join(root,'final-parent'),next=join(root,'final-parent-v2');
await mkdir(next);await cp(join(old,'driver-v1'),join(next,'driver-v2'),{recursive:true,errorOnExist:true,force:false});
for(const file of ['verify-binding.mjs','build-frozen.ps1','freeze-drivers.mjs','admission-build.json']) await cp(join(old,file),join(next,file),{errorOnExist:true,force:false});
let source=await readFile(join(next,'verify-binding.mjs'),'utf8');
source=source.replace("const opts = { cwd: checkout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };", "const opts = { cwd: checkout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 128 * 1024 * 1024 };");
source=source.replace("  'editor/ValidationIndicator.tsx',", "  'editor/ValidationIndicator.tsx',\n  'editor/NodeEditorDialog.tsx',\n  'editor/RenameNotice.tsx',\n  'editor/pointer-press.ts',\n  'forms/SchemaForm.tsx',\n  'forms/repair.ts',");
source=source.replace("].map((path) => 'apps/web/src/' + path);", "].map((path) => 'apps/web/src/' + path).concat('packages/domain/src/expression-references.ts');");
source=source.replace("original.replaceAll('\\\\', '/').endsWith('/' + candidate.slice('apps/web/src/'.length))", "original.replaceAll('\\\\', '/').endsWith('/' + (candidate.startsWith('apps/web/src/') ? candidate.slice('apps/web/src/'.length) : candidate))");
await writeFile(join(next,'verify-binding.mjs'),source);
let run=await readFile(join(next,'driver-v2/run-case.mjs'),'utf8');
run=run.replaceAll('driver-v1-manifest.json','driver-v2-manifest.json');
run=run.replace("{cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe']}", "{cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:128*1024*1024}");
await writeFile(join(next,'driver-v2/run-case.mjs'),run);
let reuse=await readFile(join(next,'driver-v2/verify-reuse.mjs'),'utf8');
reuse=reuse.replace("original.replaceAll('\\\\','/').endsWith('/'+candidate.slice('apps/web/src/'.length))", "original.replaceAll('\\\\','/').endsWith('/'+(candidate.startsWith('apps/web/src/')?candidate.slice('apps/web/src/'.length):candidate))");
reuse=reuse.replace('assert.equal(Object.keys(sourceMap).length,16);','assert.equal(Object.keys(sourceMap).length,22);').replace('mapped:16,','mapped:22,');
await writeFile(join(next,'driver-v2/verify-reuse.mjs'),reuse);
let driver=await readFile(join(next,'driver-v2/history.playwright.js'),'utf8');
driver=driver.replace("    await page.getByText('published v1', { exact: true }).waitFor({ timeout: 12000 });", "    await page.getByText('published v1', { exact: true }).waitFor({ timeout: 12000 });\n    await mark('published-current-only-visible');");
await writeFile(join(next,'driver-v2/history.playwright.js'),driver);
let freeze=await readFile(join(next,'freeze-drivers.mjs'),'utf8');
freeze=freeze.replaceAll('driver-v1','driver-v2').replace('final-parent-driver-v1','final-parent-driver-v2');
await writeFile(join(next,'freeze-drivers.mjs'),freeze);
await writeFile(join(old,'admission-failure.json'),JSON.stringify({status:'fixture-admission-failed-before-build',step:'verify-binding source',
 error:'spawnSync git ENOBUFS',syscall:'execFileSync git ls-tree -r -z HEAD',bufferBytes:1052672,
 reason:'Default 1MiB child-process buffer cannot hold current tree listing with retained QA evidence',
 firstOutcomePreserved:true,buildStarted:false,nativeStarted:false,productFinding:false,
 correction:'batch1: explicit128MiB read-only Git output buffer; related argv/cwd/API shape/source-map/cleanup syntax audit before retry'},null,2)+'\n',{flag:'wx'});
await writeFile(join(root,'fixture-corrections.json'),JSON.stringify([{attempt:'correction1',groups:['h-d1','h-d2','h-n768','h-r512','ownership-d1','ownership-r512'],
 phase:'prebuild admission',firstEvidence:'final-parent/admission-failure.json',fixtureCause:'Git tree listing exceeded execFileSync default buffer before build/native; v2 explicit128MiB buffer, source closure and inherited22map binding, visible publish mark; all product oracles retained'}],null,2)+'\n');
console.log(next);
