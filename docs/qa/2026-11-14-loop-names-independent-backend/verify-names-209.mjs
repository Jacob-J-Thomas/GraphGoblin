import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';

const candidate=await realpath(process.argv[2]);
const baseline=await realpath(process.argv[3]);
const expected='5df84b2d434fa367a241891a57df13f6401cf17b';
const beforeNames='b3b5e1874a8252cc01c065d18fef42cbfbe075b4';
const evidence=await realpath(dirname(fileURLToPath(import.meta.url)));
for(const dir of [candidate,baseline]) assert(relative(dir,evidence).startsWith('..'));
const scratch=await mkdtemp(join(evidence,'independent labels '));
process.env.TEMP=scratch;
process.env.TMP=scratch;
const tracked=['apps/api/src','apps/api/templates','packages','patches','pnpm-lock.yaml'];
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
function sourceIdentity(){
  assert.equal(git(candidate,'rev-parse','HEAD'),expected);
  assert.equal(git(baseline,'rev-parse','HEAD'),beforeNames);
  for(const dir of [candidate,baseline]) assert.equal(git(dir,'status','--porcelain=v1','--',...tracked),'');
  for(const ancestor of ['fddadabf','f9e17528'])git(candidate,'merge-base','--is-ancestor',ancestor,expected);
}
const use=(root,path)=>import(pathToFileURL(join(root,path)).href);
const hash=(b)=>createHash('sha256').update(b).digest('hex');
const sha=async(path)=>hash(await readFile(path));
const files=[
  'apps/api/src/index.ts','apps/api/src/testing/test-app.ts','apps/api/src/routes/loops.ts',
  'apps/api/src/routes/templates.ts','apps/api/src/container.ts','apps/api/src/plugins/errors.ts',
  'packages/contracts/src/loop.ts','packages/infrastructure/src/sqlite/loops.ts',
  'packages/infrastructure/src/sqlite/store-format.ts','packages/infrastructure/src/sqlite/loop-names.ts',
  'packages/infrastructure/src/sqlite/db.ts','packages/infrastructure/src/sqlite/database-types.ts','pnpm-lock.yaml',
];
const runtimeFiles=['apps/api/dist/main.js','apps/api/dist/routes/loops.js',
  'packages/infrastructure/dist/sqlite/loop-names.js','packages/infrastructure/dist/sqlite/store-format.js',
  'apps/api/node_modules/tsx/dist/loader.mjs'];
const fingerprints={}, unusedBuildFingerprints={}, observations=[], requests=[];
const owned=[];
let active='initialization', failure;
const verb = (method,url,payload)=>({method,url,...(payload===undefined?{}:{payload})});
const inject=async (api,req,expectedStatus,headers={})=>{
  const ret=await api.app.inject({...req,headers:{...headers,...req.headers}});
  const value=ret.json();
  requests.push({fixture:api.label,stage:active,method:req.method,url:req.url,status:ret.statusCode,
    code:value.code??null,suggestedName:value.suggestedName??null});
  if(expectedStatus!==undefined) assert.equal(ret.statusCode,expectedStatus,ret.body);
  return {status:ret.statusCode,value,type:ret.headers['content-type']};
};
const body=(x)=>x.value;
const byId=(id)=>'/loops/'+id;
const ifMatch=(t)=>({'if-match':'"'+t+'"'});
const norm=(s)=>s.trim().replace(/\s+/gu,' ').toLowerCase();
const match=(x,code='LOOP_NAME_CONFLICT')=>{
  assert.equal(x.value.code,code);
  assert.match(x.type,/application\/problem\+json/);
  if(code==='LOOP_NAME_CONFLICT'){
    assert.equal(typeof x.value.suggestedName,'string');
    assert(x.value.suggestedName.length>0 && x.value.detail.length>0);
  }
  return x.value;
};
const shape=(d)=>({ ...d,name:'ignore name' });
const envFor=(dir)=>({GG_DATA_DIR:dir,GG_DB_URL:'file:'+join(dir,'fixture.db').replaceAll('\\','/'),
  GG_REQUIRE_API_KEY:'false',GG_OLLAMA_ENABLED:'false',GG_SWAGGER_UI:'false'});
async function start(testApp,dir,label){
  await mkdir(dir,{recursive:true});
  const api=await testApp({env:envFor(dir)});
  assert.equal(api.app.server.listening,false);
  api.label=label;
  owned.push(api);
  return api;
}
async function close(api){
  try{await api.close()}finally{owned.splice(owned.indexOf(api),1)}
}
try {
  sourceIdentity();
  assert(process.execArgv.includes('--conditions=development'));
  for(const p of files) fingerprints[p]=await sha(join(candidate,p));
  for(const p of runtimeFiles) {
    try{unusedBuildFingerprints[p]=await sha(join(candidate,p));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const {createTestApp}=await use(candidate,'apps/api/src/testing/test-app.ts');
  const {createTestApp:oldApp}=await use(baseline,'apps/api/src/testing/test-app.ts');
  const {createContainer,loadConfig}=await use(candidate,'apps/api/src/index.ts');
  const {minimalLoop}=await use(candidate,'packages/contracts/src/testing/index.ts');
  const definition=(name,note='original marker')=>({...minimalLoop(),name,description:note});
  const create=(name,note)=>verb('POST','/loops',{definition:definition(name,note)});
  const save=(id,token,d)=>({...verb('PUT',byId(id)+'/draft',{definition:d}),headers:ifMatch(token)});
  const get=(id)=>verb('GET',byId(id));
  const list=verb('GET','/loops');
  const template=(name)=>verb('POST','/templates/starter/draft',{name});
  const api=await start(createTestApp,join(scratch,'live-api'),'candidate API');

  active='owner-scoped identity, exact spelling and Unicode limits';
  const key1=(await api.container.repos.apiKeys.create('independent-alpha','test scopes',['loops:write'])).token;
  const key2=(await api.container.repos.apiKeys.create('independent-beta','test scopes',['loops:write'])).token;
  const a={authorization:'Bearer '+key1}, b={authorization:'Bearer '+key2};
  const firstName='  Ångström\u3000  Σ 🚀  ';
  const equivalent='\u00a0ångström\tσ 🚀';
  assert.equal(norm(firstName),norm(equivalent));
  const first=body(await inject(api,create(firstName),201,a));
  assert.equal(first.loop.name,firstName);
  const collision=match(await inject(api,create(equivalent),409,a));
  assert.notEqual(norm(collision.suggestedName),norm(firstName));
  const other=body(await inject(api,create(equivalent),201,b));
  assert.notEqual(first.loop.id,other.loop.id);
  match(await inject(api,get(first.loop.id),404,b),'LOOP_NOT_FOUND');
  const composed=body(await inject(api,create('É space'),201,a));
  const decomposed=body(await inject(api,create('E\u0301 space'),201,a));
  assert.notEqual(composed.loop.id,decomposed.loop.id);
  observations.push({case:active,first:first.loop,other:other.loop,normalizationDistinct:[composed.loop.id,decomposed.loop.id]});

  active='rename token precedence and atomic refusal';
  const base=body(await inject(api,create('Draft source'),201,a));
  const original=body(await inject(api,get(base.loop.id),200,a));
  const self=body(await inject(api,save(base.loop.id,original.draftToken,definition(' dRaFt\tSOURCE ','concurrent later edit')),200,a));
  assert.equal(self.draft.id,original.draft.id);
  assert.notEqual(self.draftToken,original.draftToken);
  const ahead=body(await inject(api,get(base.loop.id),200,a));
  const contested=definition(equivalent,'must not leak into DB');
  const stale=match(await inject(api,save(base.loop.id,original.draftToken,contested),409,a),'DRAFT_CONFLICT');
  assert.equal(stale.draftToken,self.draftToken);
  assert.equal(stale.suggestedName,undefined);
  const taken=match(await inject(api,save(base.loop.id,self.draftToken,contested),409,a));
  assert.equal(taken.draftToken,undefined);
  assert.deepEqual(body(await inject(api,get(base.loop.id),200,a)),ahead);
  const repaired=body(await inject(api,save(base.loop.id,self.draftToken,
    {...contested,name:taken.suggestedName}),200,a));
  assert.equal(repaired.draft.id,base.draft.id);
  assert.equal(repaired.draft.definition.description,contested.description);
  observations.push({case:active,loopId:base.loop.id,draftId:base.draft.id,retainedBeforeConflict:ahead.draft.definition,
    acceptedName:repaired.draft.definition.name});

  active='import unchanged export, stale suggestion, and explicit retry';
  const published=body(await inject(api,verb('POST',byId(first.loop.id)+'/publish'),200,a));
  const exported=body(await inject(api,verb('GET',byId(first.loop.id)+'/export'),200,a));
  const originalDocument=JSON.stringify(exported);
  const countBefore=body(await inject(api,list,200,a)).items.length;
  const initialSuggestion=match(await inject(api,verb('POST','/loops/import',exported),409,a)).suggestedName;
  assert.equal(body(await inject(api,list,200,a)).items.length,countBefore);
  await inject(api,create(initialSuggestion.toUpperCase()),201,a);
  const second=match(await inject(api,verb('POST','/loops/import?name='+encodeURIComponent(initialSuggestion),exported),409,a));
  assert.notEqual(norm(second.suggestedName),norm(initialSuggestion));
  const copied=body(await inject(api,verb('POST','/loops/import?name='+encodeURIComponent(second.suggestedName),exported),201,a));
  assert.notEqual(copied.loop.id,first.loop.id);
  assert.deepEqual(shape(copied.draft.definition),shape(exported.loop));
  assert.equal(JSON.stringify(exported),originalDocument);
  assert.deepEqual(body(await inject(api,verb('GET',byId(first.loop.id)+'/versions/'+published.version.id),200,a)),published.version);
  observations.push({case:active,oldId:first.loop.id,copyId:copied.loop.id,initialSuggestion,refreshedSuggestion:second.suggestedName});

  active='template repetition reserves only one name';
  const entry=body(await inject(api,template('Runbook  Copy'),201,a));
  const existingDetail=body(await inject(api,get(entry.loop.id),200,a));
  const templateRefusal=match(await inject(api,template(' runbook\u2003copy '),409,a));
  assert.deepEqual(body(await inject(api,get(entry.loop.id),200,a)),existingDetail);
  const explicit=body(await inject(api,template(templateRefusal.suggestedName),201,a));
  assert.notEqual(explicit.loop.id,entry.loop.id);
  assert.deepEqual(shape(explicit.draft.definition),shape(entry.draft.definition));
  observations.push({case:active,originalId:entry.loop.id,copyId:explicit.loop.id,
    explicit:explicit.loop.name});

  active='simultaneous public writes across routes';
  const runner=body(await inject(api,create('Separate race draft'),201,a));
  const runnerBefore=body(await inject(api,get(runner.loop.id),200,a));
  const responses=await Promise.all([
    inject(api,create('Race Δream'),undefined,a),
    inject(api,save(runner.loop.id,runnerBefore.draftToken,definition('RACE  δREAM')),undefined,a),
    inject(api,verb('POST','/loops/import',definition(' Race\tΔream ')),undefined,a),
    inject(api,template(' race Δream '),undefined,a),
  ]);
  assert.equal(responses.filter(x=>x.status===409).length,3);
  assert.equal(responses.filter(x=>[200,201].includes(x.status)).length,1);
  for(const reply of responses.filter(x=>x.status===409)) match(reply);
  const names=body(await inject(api,list,200,a)).items.filter(x=>norm(x.name)==='race δream');
  assert.equal(names.length,1);
  if(responses[1].status===409) assert.deepEqual(body(await inject(api,get(runner.loop.id),200,a)),runnerBefore);
  const two=await Promise.all([inject(api,create('Race same route'),undefined,a),inject(api,create('race\u2009SAME route'),undefined,a)]);
  assert.deepEqual(two.map(x=>x.status).sort(),[201,409]);
  match(two.find(x=>x.status===409));
  observations.push({case:active,mixedStatuses:responses.map(x=>x.status),survivor:names[0],sameRoute:two.map(x=>x.status)});

  active='invalid UTF-16 and NUL across every writer';
  const valid=body(await inject(api,create('Valid replacement � and astronaut 🧑‍🚀'),201,a));
  const detail=body(await inject(api,get(valid.loop.id),200,a));
  const num=body(await inject(api,list,200,a)).items.length;
  for(const name of ['embedded\u0000suffix','leading \ud800 single','trailing \udfff single']){
    for(const req of [create(name),save(valid.loop.id,detail.draftToken,definition(name)),
      verb('POST','/loops/import',definition(name)),template(name)]){
      match(await inject(api,req,400,a),'LOOP_NAME_INVALID');
    }
  }
  assert.deepEqual(body(await inject(api,get(valid.loop.id),200,a)),detail);
  assert.equal(body(await inject(api,list,200,a)).items.length,num);
  await close(api);
  observations.push({case:active,invalidVariants:3,writers:4,validSpelling:valid.loop.name});

  active='previous-build duplicate startup refusal then explicit repair';
  const legacyRoot=join(scratch,'legacy fixture store');
  const old=await start(oldApp,legacyRoot,'previous-build API');
  const seed1=body(await inject(old,create('Legacy É Board'),201));
  const seed2=body(await inject(old,create('  legacy\té  board '),201));
  const oldVersion1=body(await inject(old,verb('POST',byId(seed1.loop.id)+'/publish'),200)).version;
  const oldVersion2=body(await inject(old,verb('POST',byId(seed2.loop.id)+'/publish'),200)).version;
  const oldRun=body(await inject(old,verb('POST',byId(seed2.loop.id)+'/runs',{input:{proof:'pinned legacy'}}),202));
  await old.idle();
  const historical=body(await inject(old,verb('GET','/runs/'+oldRun.run.id),200));
  assert.equal(historical.status,'succeeded');
  assert.equal(historical.pinned.name,seed2.loop.name);
  await close(old);

  const dbSnapshot=async()=>Object.fromEntries(await Promise.all((await readdir(legacyRoot)).filter(f=>f.startsWith('fixture.db')).sort().map(async f=>[f,await sha(join(legacyRoot,f))])));
  const pre=await dbSnapshot();
  assert(pre['fixture.db']);
  let refused;
  try{
    const bad=await createContainer(loadConfig(envFor(legacyRoot)),{startTimers:false});
    await bad.dispose();
    assert.fail('Candidate unexpectedly accepted legacy equivalent names');
  }catch(error){
    assert.equal(error.code,'STORE_UNSUPPORTED',String(error));
    assert.match(error.message,/equivalent names/);
    assert(error.message.includes(seed1.loop.id)&&error.message.includes(seed2.loop.id));
    assert.match(error.message,/Rename one in the previous build/);
    assert.match(error.message,/--reset/);
    refused=error.message;
  }
  assert.deepEqual(await dbSnapshot(),pre);
  assert(!(await readdir(legacyRoot)).some(x=>x.includes('lock')||x.includes('reclaim')));

  const repair=await start(oldApp,legacyRoot,'previous-build repair API');
  const legacyDetail=body(await inject(repair,get(seed2.loop.id),200));
  await inject(repair,save(seed2.loop.id,legacyDetail.draftToken,
    {...legacyDetail.current.definition,name:'Legacy explicitly repaired'}),200);
  await close(repair);
  const reopened=await start(createTestApp,legacyRoot,'candidate reopened API');
  const saved=body(await inject(reopened,get(seed2.loop.id),200));
  assert.equal(saved.loop.id,seed2.loop.id);
  assert.equal(saved.loop.name,'Legacy explicitly repaired');
  assert.equal(saved.draft.definition.name,'Legacy explicitly repaired');
  assert.deepEqual(saved.current,oldVersion2);
  assert.deepEqual(body(await inject(reopened,get(seed1.loop.id),200)).current,oldVersion1);
  const runAfter=body(await inject(reopened,verb('GET','/runs/'+historical.id),200));
  assert.deepEqual(runAfter.pinned,historical.pinned);
  assert.equal(runAfter.versionId,historical.versionId);
  await close(reopened);
  observations.push({case:active,ids:[seed1.loop.id,seed2.loop.id],oldVersions:[oldVersion1.id,oldVersion2.id],
    pinnedRun:historical.id,dbSnapshotBeforeRefusal:pre,dbUnchangedOnRefusal:true,operatorMessage:refused,repairedName:saved.loop.name});

  sourceIdentity();
  for(const [f,v] of Object.entries(fingerprints))assert.equal(await sha(join(candidate,f)),v);
} catch(error) {
  failure={case:active,message:String(error),stack:error.stack};
  throw error;
} finally{
  for(const app of [...owned].reverse()) await close(app);
  const result={expected,baseline:beforeNames,headAfter:git(candidate,'rev-parse','HEAD'),
    backendStatusAfter:git(candidate,'status','--porcelain=v1','--',...tracked),runtime:process.version,pid:process.pid,
    sourceCondition:process.execArgv,platform:process.platform,fingerprints,unusedBuildFingerprints,
    appSocketsOpened:0,observations,requests,failure:failure??null};
  const out=join(scratch,'observed.json');
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
  console.log(out);
}
