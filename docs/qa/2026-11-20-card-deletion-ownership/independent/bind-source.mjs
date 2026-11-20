import fs from'node:fs/promises';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';import assert from'node:assert/strict';
const[lane,root,phase,expectedHead]=process.argv.slice(2);
const git=(...args)=>{const r=spawnSync('git',['-C',lane,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const head=git('rev-parse','HEAD');if(expectedHead)assert.equal(head,expectedHead);const status=git('status','--porcelain');assert.equal(status,'','Candidate checkout must remain clean');
const digest=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sourceFiles=['apps/web/src/editor/decision-route-edges.ts','apps/web/src/editor/store.ts','apps/web/src/editor/NodeEditorDialog.tsx','apps/web/src/editor/useAutosave.ts','apps/web/src/editor/useLoadEditor.ts'];
const sourceHashes={};for(const relative of sourceFiles)sourceHashes[relative]=await digest(path.join(lane,relative));
async function assets(directory,prefix=''){const result={};for(const entry of await fs.readdir(directory,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())Object.assign(result,await assets(path.join(directory,entry.name),relative+'/'));else result[relative]=await digest(path.join(directory,entry.name));}return result;}
const driverHashes={};for(const relative of ['criteria.md','seed.mjs','run-case.mjs','journey.browser.js','authenticate-browser.mjs','readback.js','start-server.mjs','recover-current.browser.js','run-recovery.mjs','verify-records.mjs','store-controls.mjs','playwright-cli.json','replay-inputs/prior-live-collision.json'])driverHashes[relative]=await digest(path.join(root,relative));
const record={head,tree:git('rev-parse','HEAD^{tree}'),parents:git('show','-s','--format=%P'),clean:status==='',node:process.version,at:new Date().toISOString(),sourceHashes,driverHashes,webAssetHashes:await assets(path.join(lane,'apps/web/dist'))};
if(phase==='after'){
 const before=JSON.parse(await fs.readFile(path.join(root,'records/source-before.json'),'utf8'));assert.deepEqual(record.sourceHashes,before.sourceHashes);assert.deepEqual(record.webAssetHashes,before.webAssetHashes);assert.equal(record.head,before.head);
 let amendment;try{amendment=JSON.parse((await fs.readFile(path.join(root,'records/driver-amendment.json'),'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')throw error;}
 const amendments=amendment?(Array.isArray(amendment)?amendment:[amendment]):[];
 for(const[relative,hash]of Object.entries(record.driverHashes)){const change=amendments.find(a=>a.relative===relative);if(change){assert.equal(before.driverHashes[relative],change.beforeSha256);assert.equal(hash,change.afterSha256);assert.equal(await digest(path.join(root,change.original)),change.beforeSha256);}else assert.equal(hash,before.driverHashes[relative]);}
 record.matchesBefore=true;record.driverAmendment=amendment??null;
}
await fs.writeFile(path.join(root,'records/source-'+phase+'.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({head,tree:record.tree,clean:record.clean,sourceFiles:sourceFiles.length,assetFiles:Object.keys(record.webAssetHashes).length,matchesBefore:record.matchesBefore}));
