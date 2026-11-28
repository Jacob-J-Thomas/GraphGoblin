import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.cwd();
const { writePluginOutput } = await import(pathToFileURL(join(repo, 'tooling/plugin-output.mjs')));
const scratch = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'gg-review-write-close-'));
const packageDir = join(scratch, 'package');
const outDir = join(packageDir, 'dist', 'marketplace');
await fs.mkdir(join(packageDir, 'source'), {recursive:true});
const options = { packageDir, defaultOutDir:outDir, outDir, protectedPaths:[join(packageDir,'source')], kind:'review-fixture', files:{'plugin/manifest.json':'original'} };
await writePluginOutput(options);
const before = await fs.readFile(join(outDir, 'plugin/manifest.json'), 'utf8');
const primary = new Error('REVIEW: primary staged write failure');
const close = new Error('REVIEW: staged file close failure');
const originalOpen = fs.open;
let instrumented = false;
fs.open = async function(path, flags, ...rest) {
  const handle = await originalOpen(path, flags, ...rest);
  if (!instrumented && flags === 'wx' && String(path).includes('.graphgoblin-build')) {
    instrumented = true;
    return { async writeFile() { throw primary; }, async close() { await handle.close(); throw close; } };
  }
  return handle;
};
syncBuiltinESMExports();
let error;
try { await writePluginOutput({...options, files:{'plugin/manifest.json':'replacement'}}); }
catch (reason) { error = reason; }
finally { fs.open = originalOpen; syncBuiltinESMExports(); }
assert.equal(instrumented, true);
assert.equal(error, close);
assert.equal(await fs.readFile(join(outDir,'plugin/manifest.json'),'utf8'),before);
const evidence={test:'public writePluginOutput; narrowly injected write plus FileHandle.close failure', writeFailure:primary.message, closeFailure:close.message, observedName:error.name, observedMessage:error.message, observedCause:error.cause?.message??null, observedErrors:error.errors?.map(item=>item.message)??null, primaryRetained:error===primary||error.cause===primary||error.errors?.includes(primary)||error.message.includes(primary.message)||false, previousOutputUnchanged:true, cleanupEntries:await fs.readdir(join(packageDir,'dist'))};
console.log(JSON.stringify(evidence,null,2));
await fs.rm(scratch,{recursive:true,force:true});
