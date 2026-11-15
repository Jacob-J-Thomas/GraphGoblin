import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
assert.equal(process.version,'v22.23.4');
const manifestBytes=await readFile(join(root,'driver-v2-manifest.json'));
const manifest=JSON.parse(manifestBytes),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [path,expected] of Object.entries(manifest.files)) assert.equal(sha(await readFile(join(root,path))),expected,path);
const admission=JSON.parse(await readFile(join(root,'admission-build.json'),'utf8'));
admission.driverManifestSha256=sha(manifestBytes);
await writeFile(join(root,'admission-v2.json'),JSON.stringify(admission,null,2)+'\n',{flag:'wx'});
const cli='C:/Users/98jak/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/@playwright/cli/playwright-cli.js';
await access(cli);
const rejects=spawnSync(process.execPath,[join(root,'driver-v2/run-case.mjs'),join(root,'..','final-parent','admission-template.json'),cli,'h-d1','initial'],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:128*1024*1024});
assert.notEqual(rejects.status,0);assert(rejects.stderr.includes('authorized'));
await writeFile(join(root,'inactive-admission-refusal.log'),rejects.stdout+rejects.stderr,{flag:'wx'});
const preflight=join(root,'preflight');await mkdir(preflight);
let code=await readFile(join(root,'verify-binding.mjs'),'utf8');
code=code.replace('const evidence = dirname(fileURLToPath(import.meta.url));',"const evidence = join(dirname(fileURLToPath(import.meta.url)), 'preflight');");
await writeFile(join(root,'verify-binding-preflight.mjs'),code,{flag:'wx'});
const output=execFileSync(process.execPath,[join(root,'verify-binding-preflight.mjs'),join(root,'admission-v2.json'),'source'],{cwd:root,windowsHide:true,maxBuffer:128*1024*1024,encoding:'utf8'});
await writeFile(join(root,'preflight','source-admission.log'),output,{flag:'wx'});
const old=JSON.parse(await readFile(join(root,'..','binding/read-only-offline.json'),'utf8'));
const inventory=JSON.parse(await readFile(join(preflight,'prebuild-inventory.json'),'utf8'));
const changed=[];
for(const [dir,tree] of Object.entries(inventory)) for(const [path,hash] of Object.entries(tree.hashes)) if(old.artifacts[path]!==hash)changed.push({path,historical:old.artifacts[path]??null,current:hash});
const mapPaths=Object.keys(old.artifacts).filter(path=>path.startsWith('apps/web/dist/')&&path.endsWith('.js.map'));
const oldEmbedded=[];
for(const path of mapPaths){const map=JSON.parse(await readFile(join(admission.checkout,path),'utf8'));for(const source of map.sources)if(/expression-references|NodeEditorDialog|RenameNotice|pointer-press|SchemaForm|\/repair\./.test(source))oldEmbedded.push(source);}
const report={status:'offline-correction1-admission-pass',node:process.version,cwd:root,cli,manifestSha256:sha(manifestBytes),
  currentHead:admission.head,currentTree:admission.tree,gitBuffer:128*1024*1024,
  effectiveSourceFiles:Object.keys(JSON.parse(await readFile(join(preflight,'source-binding.json'),'utf8')).sourceReadback).length,
  prebuildChangedComparedWithHistorical821:changed,oldEmbedded,
  inactiveGrantRefusedBeforeOwnedResourceCreation:true,newFixtureCorrectionBatchesConsumed:1,newFixtureCorrectionBatchCap:2,
  oldFixtureCorrectionBatchesExhausted:2,nativeStarted:false,buildStarted:false};
await writeFile(join(root,'admission-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,sources:report.effectiveSourceFiles,changedPrebuild:changed.length,oldEmbedded,manifestSha256:report.manifestSha256}));
