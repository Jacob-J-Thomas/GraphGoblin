import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidence=dirname(fileURLToPath(import.meta.url));
const checkout='G:/ggq/gg-i4-363-structured/GraphGoblin';
const owner=await mkdtemp('G:/ggq/gg363-source-author-');
const cwd=join(owner,'cwd'),home=join(owner,'home');await Promise.all([mkdir(cwd),mkdir(home),mkdir(join(evidence,'raw'),{recursive:true})]);
await writeFile(join(home,'config.toml'),'[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n');
const loader=pathToFileURL(join(checkout,'apps/api/node_modules/tsx/dist/loader.mjs')).href;
const schema={type:'object',properties:{fixture:{type:'string'},ok:{type:'boolean'}},required:['fixture','ok'],additionalProperties:false};
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const observations=[];
const prefixEntries=entries=>entries.filter(name=>name.startsWith('gg-structured-')||name.startsWith('gg-schema-')).sort();
for(const label of ['short','long-226'])for(const mode of ['success','error','abort']){
 const id=label+'-'+mode,folder=join(owner,id);let temp=join(folder,'tmp');
 if(label==='long-226'){while(temp.length+42<226)temp=join(temp,'segment'.repeat(5));temp=join(temp,'x'.repeat(226-temp.length-1));assert.equal(temp.length,226);}
 await mkdir(temp,{recursive:true});
 const sentinels=[join(temp,'gg-schema-KEEP00'),join(temp,'gg-structured-keep')];
 for(const sentinel of sentinels){await mkdir(sentinel);await writeFile(join(sentinel,'keep'),id);}
 await writeFile(join(temp,'unrelated.txt'),'Keep unrelated data');
 const config={id,mode,checkout,temp,cwd,schema,fakeCli:join(evidence,'source-cli.mjs'),listingFile:join(evidence,'raw',id+'.listing.json'),turnFile:join(evidence,'raw',id+'.turn.json'),stateFile:join(evidence,'raw',id+'.state.json')};
 const configFile=join(evidence,'raw',id+'.config.json');await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
 const env={...baseEnv,TEMP:temp,TMP:temp,TMPDIR:temp,CODEX_HOME:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home};
 const args=['--import',loader,'--conditions=development',join(evidence,'source-case.mjs'),configFile];
 const stdout=execFileSync(process.execPath,args,{cwd,env,windowsHide:true,timeout:15000,encoding:'utf8'});await writeFile(join(evidence,'raw',id+'.stdout'),stdout);
 const state=JSON.parse(await readFile(config.stateFile,'utf8'));
 assert(state.listingExists&&state.turnExists,'Real listing and real SDK schema read are both required');
 if(mode==='success'){assert.equal(state.outcome.kind,'resolved');assert.deepEqual(state.outcome.result.value,{fixture:'sdk-boundary',ok:true});}
 else{assert.equal(state.outcome.kind,'rejected');if(mode==='error')assert.match(state.outcome.error.message,/Controlled author schema CLI failure/);else{assert.equal(state.outcome.error.name,'AbortError');assert.equal(state.schemaPresentAtAbort,true);}}
 assert.deepEqual(state.turn.schema,schema);assert.equal(state.turn.schemaText,JSON.stringify(schema));
 assert.equal(state.scratchExistsAfter,false);assert.equal(state.schemaDirExistsAfter,false);
 assert.deepEqual(prefixEntries(state.tempEntriesAfter),prefixEntries(state.tempEntriesBefore));
 for(const sentinel of sentinels)assert.equal(await readFile(join(sentinel,'keep'),'utf8'),id);
 assert.equal(await readFile(join(temp,'unrelated.txt'),'utf8'),'Keep unrelated data');
 if(label==='long-226'){assert.equal(state.listing.cwdLength,249);assert.equal(state.turn.schemaDirLength,243);assert.equal(state.turn.schemaPathLength,255);}
 observations.push({id,pass:true,mode,rootLength:temp.length,scratchLength:state.listing.cwdLength,schemaDirectoryLength:state.turn.schemaDirLength,schemaFileLength:state.turn.schemaPathLength,outcome:state.outcome.kind,scratchRemoved:!state.scratchExistsAfter,schemaRemoved:!state.schemaDirExistsAfter,tempEntriesAfter:state.tempEntriesAfter,schemaSha256:state.turn.schemaSha256});
 console.log(JSON.stringify(observations.at(-1)));
}
await writeFile(join(evidence,'source-replay-result.json'),JSON.stringify({owner,checkout,base:'76beeb0f2e99343697578c2713ac06f80d59e7b5',node:process.version,kind:'author actual source adapter/default harness/installed SDK/harmless CLI; no mocks or provider',observations,paidProviderCalls:0,sdkSha256:createHash('sha256').update(await readFile(join(checkout,'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js'))).digest('hex'),remainingOwnerEntries:await readdir(owner)},null,2)+'\n');
