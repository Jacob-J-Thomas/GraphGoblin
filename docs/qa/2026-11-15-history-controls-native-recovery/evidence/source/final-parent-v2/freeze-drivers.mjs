// Offline syntax and contract preflight; immutable manifest writer. No native application import.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const checkout='C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.version,'v22.23.4');
const driver=await readFile(join(root,'driver-v2','history.playwright.js'),'utf8');
const check=(value,message)=>assert(value,message);
const defSource=driver.slice(driver.indexOf('  const def = ')+14,driver.indexOf('\n  const ids = '));
const def=new Function('check','return '+defSource)(check);
const canonical=driver.slice(driver.indexOf('  function wireToCanonical('),driver.indexOf('  async function saved('));
const convert=new Function(canonical+'; return wireToCanonical;')();
const {LoopDefinitionSchema,LoopRecordSchema}=await import(pathToFileURL(join(checkout,'packages/contracts/dist/index.js')).href);
const prior=JSON.parse(await readFile(join(root,'..','..','history-208-independent','runs','h-d1-correction2','raw','actions.json'),'utf8'));
const row=prior.out.checkpoints.find(row=>row.request?.body?.definition && row.server?.draft?.definition);
assert(row);
assert.deepEqual(convert(row.request.body.definition),LoopDefinitionSchema.parse(row.request.body.definition));
assert.deepEqual(convert(row.request.body.definition),row.server.draft.definition);
assert.deepEqual(row.device.definition,row.request.body.definition);
assert.deepEqual(def(row.server),row.server.draft.definition);
const currentOnly={...row.server,current:row.server.draft,loop:{...row.server.loop,currentVersionId:row.server.draft.id}};
delete currentOnly.draft;delete currentOnly.loop.draftVersionId;
assert(LoopRecordSchema.safeParse(currentOnly.loop).success);
assert(!LoopRecordSchema.safeParse({...currentOnly.loop,draftVersionId:null}).success);
assert.deepEqual(def(currentOnly),row.server.draft.definition);
assert.deepEqual(def({...row.server,current:{definition:{sentinel:'old'}}}),row.server.draft.definition);
assert.throws(()=>def({}));
assert(driver.includes("!Object.hasOwn(settled.loop, 'draftVersionId')"));
const files={};
async function collect(dir){for(const item of await readdir(join(root,dir),{withFileTypes:true})){
  const path=dir+'/'+item.name;if(item.isDirectory())await collect(path);else files[path]=sha(await readFile(join(root,path)));
}}
await collect('driver-v2');
for(const file of ['verify-binding.mjs','build-frozen.ps1','freeze-drivers.mjs']) files[file]=sha(await readFile(join(root,file)));
for(const path of Object.keys(files).filter(path=>/\.(mjs|js)$/.test(path))) execFileSync(process.execPath,['--check',join(root,path)],{windowsHide:true,stdio:'pipe'});
const manifest=JSON.stringify({version:'final-parent-driver-v2',files},null,2)+'\n';
await writeFile(join(root,'driver-v2-manifest.json'),manifest,{flag:'wx'});
const report={status:'offline-driver-preflight-pass',node:process.version,manifestSha256:sha(manifest),
  pureContractBuild:'Historical821 compiled contracts; rerun schema replay if final contracts bytes change',
  originalActualRequestReplayed:true,onlyKnownScriptDefaults:true,wireDeviceExact:true,fullApiExact:true,
  fallbackCases:['draft-only','current-only','draft-precedence','missing-refusal'],optionalRecordShape:'omitted, never SQL null',
  syntaxChecks:Object.keys(files).filter(path=>/\.(mjs|js)$/.test(path)),
  nativeStarted:false,buildStarted:false,correctionBatchesConsumed:0,priorCorrectionBatchesExhausted:2};
await writeFile(join(root,'offline-driver-preflight.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
