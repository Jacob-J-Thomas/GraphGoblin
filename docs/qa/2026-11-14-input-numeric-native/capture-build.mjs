import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const cwd='C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin';
const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch',out=join(batch,'input-235-numeric-native');
const label=process.argv[2]; if(!['before','after'].includes(label))throw new Error('Require before or after');
mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024}).trim();
const head=git('rev-parse','HEAD');
if(head!=='1ae90e2b35c2f2365efad4118e5cebf98ad1d3fd'||git('status','--porcelain=v1'))throw new Error('Candidate is not frozen clean1ae90e2b');
const base='e0ff50c5e8fadd4fa53ed30d4e659e670fdf3139';
const runtimeDelta=git('diff','--name-only',base+'..'+head,'--','apps/api','packages');
if(runtimeDelta)throw new Error('API/package runtime changed');
const distRoot=join(cwd,'apps/web/dist');
const files=root=>readdirSync(root,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(join(root,item.name)):[join(root,item.name)]);
const assets=files(distRoot).map(path=>({path:relative(distRoot,path).replaceAll('\\','/'),sha256:hash(readFileSync(path)),bytes:readFileSync(path).length})).sort((a,b)=>a.path.localeCompare(b.path));
const prior=JSON.parse(readFileSync(join(batch,'review-235/gpt-scan1/build-binding-check.json'),'utf8')).filter(x=>x.kind==='dist');
const priorPaths=new Set(prior.map(x=>x.path.replace(/^\.\//,'')));
const extraSourceMaps=assets.filter(x=>!priorPaths.has(x.path));
if(label==='before'){
 if(extraSourceMaps.some(x=>!x.path.endsWith('.map')))throw new Error('Unexpected old build runtime artifact');
 for(const item of prior){const found=assets.find(x=>x.path===item.path.replace(/^\.\//,''));if(found?.sha256!==item.actual)throw new Error('Old build drift '+item.path);}
}
const sourcePaths=['apps/web/src/forms/JsonSchemaForm.tsx','apps/web/src/forms/JsonSchemaForm.test.tsx','apps/web/e2e/form-controls.spec.ts','docs/09-frontend-and-pwa.md'];
const sources=sourcePaths.map(path=>({path,sha256:hash(readFileSync(join(cwd,path)))}));
const apiEntry='apps/api/dist/main.js';
const apiHash=hash(readFileSync(join(cwd,apiEntry)));
const priorApi=JSON.parse(readFileSync(join(batch,'review-235/gpt-scan1/api-binding-check.json'),'utf8'));
if(apiHash!==priorApi.currentApi)throw new Error('API entry drift');
const manifestSha256=hash(Buffer.from(assets.map(x=>x.sha256+'  '+x.path).join('\n')+'\n'));
const result={capturedAt:new Date().toISOString(),label,candidateHead:head,builtUiOrigin:label==='before'?base:head,meaning:label==='before'?'Preserved pre-correction runtime with new regression source, an explicit negative control':'Rebuilt numeric correction; inspect the accompanying build log',assets,assetCount:assets.length,manifestSha256,sources,apiEntry:{path:apiEntry,sha256:apiHash,unchangedFrom:base},apiPackageSourceDelta:runtimeDelta,priorBinding:label==='before'?{runtimeAssetsChecked:prior.length,additionalSourceMaps:extraSourceMaps,limit:'Initial inventory comparison rejected28versus25 files. The three differences were source maps omitted by the earlier binding, not executable runtime drift. All25 recorded runtime assets match; all28 current files are hashed here.'}:undefined};
writeFileSync(join(out,label+'-build-binding.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({label,head,assetCount:assets.length,manifestSha256,apiHash}));

