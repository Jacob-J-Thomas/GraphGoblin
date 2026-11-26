import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=process.cwd();
const current=await import(pathToFileURL(join(repo,'tooling/plugin-output.mjs')));
const previousSource=(await fs.readFile(new URL('./prior-candidate/tooling/plugin-output.mjs',import.meta.url),'utf8')).replace("'./plugin-output-metadata.mjs'",JSON.stringify(pathToFileURL(join(repo,'tooling/plugin-output-metadata.mjs')).href));
const previous=await import('data:text/javascript;base64,'+Buffer.from(previousSource).toString('base64'));
const scratch=await fs.mkdtemp(join(await fs.realpath(tmpdir()),'gg-review2-faults-'));
const originalOpen=fs.open,originalUnlink=fs.unlink;
const evidence=[];
for(const [revision,mod] of [['review-01-control',previous],['review-02-corrected',current]]){
 for(const mode of ['write-only','close-only','write-plus-close','write-plus-close-plus-cleanup']){
  const packageDir=join(scratch,revision,mode,'package');
  const outDir=join(packageDir,'dist','marketplace');
  const source=join(packageDir,'source');await fs.mkdir(source,{recursive:true});
  const options={packageDir,defaultOutDir:outDir,outDir,protectedPaths:[source],kind:'review-fixture',files:{'plugin/manifest.json':'original'}};
  await mod.writePluginOutput(options);
  const before=await fs.readFile(join(outDir,'plugin/manifest.json'));
  const write=new Error('REVIEW: primary staged write failure');
  const close=new Error('REVIEW: staged file close failure');
  const cleanup=new Error('REVIEW: staged removal failure');
  let opened=false,unlinked=false;
  fs.open=async function(path,flags,...rest){
   const handle=await originalOpen(path,flags,...rest);
   if(!opened&&flags==='wx'&&String(path).includes('.graphgoblin-build')){
    opened=true;
    return {async writeFile(content){if(mode!=='close-only')throw write;await handle.writeFile(content);},async close(){await handle.close();if(mode!=='write-only')throw close;}};
   }
   return handle;
  };
  if(mode.endsWith('plus-cleanup'))fs.unlink=async function(path,...rest){if(!unlinked){unlinked=true;throw cleanup;}return originalUnlink(path,...rest);};
  syncBuiltinESMExports();
  let error;
  try{await mod.writePluginOutput({...options,files:{'plugin/manifest.json':'replacement'}});}catch(reason){error=reason;}finally{fs.open=originalOpen;fs.unlink=originalUnlink;syncBuiltinESMExports();}
  assert.equal(opened,true);assert.deepEqual(await fs.readFile(join(outDir,'plugin/manifest.json')),before);
  if(mode==='write-only')assert.equal(error,write);
  else if(mode==='close-only')assert.equal(error,close);
  else if(revision==='review-02-corrected'){
   assert(error instanceof AggregateError);assert.equal(error.cause,write);
   assert.deepEqual(error.errors,mode.endsWith('plus-cleanup')?[write,close,cleanup]:[write,close]);
   assert(error.message.includes(write.message));assert(error.message.includes(close.message));
   if(mode.endsWith('plus-cleanup'))assert(error.message.includes(cleanup.message));
  }else{
   assert(!error.message.includes(write.message));assert.notEqual(error.cause,write);
  }
  const distEntries=await fs.readdir(join(packageDir,'dist'));
  const retained=distEntries.includes('.marketplace.graphgoblin-build');
  assert.equal(retained,mode.endsWith('plus-cleanup'));
  if(retained)assert.deepEqual(await fs.readdir(join(packageDir,'dist','.marketplace.graphgoblin-build')),['next']);
  evidence.push({revision,mode,observedName:error.name,observedMessage:error.message,observedCause:error.cause?.message??null,observedErrors:error.errors?.map(item=>item.message)??null,primaryRetained:error===write||error.cause===write||error.errors?.includes(write)||false,previousOutputUnchanged:true,retainedStaging:retained});
 }
}
console.log(JSON.stringify({boundary:'public writePluginOutput; native filesystem with narrowly instrumented actual file handle and one unlink',cases:evidence},null,2));
await fs.rm(scratch,{recursive:true,force:true});
