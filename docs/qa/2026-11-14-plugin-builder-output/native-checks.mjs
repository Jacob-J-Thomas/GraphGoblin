import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const evidence=await realpath(dirname(fileURLToPath(import.meta.url)));
const worktree=await realpath(process.argv[2]);
const expected=process.argv[3];
const git=(...args)=>execFileSync('git',args,{cwd:worktree,encoding:'utf8'}).trim();
assert.equal(git('rev-parse','HEAD'),expected);
assert.equal(git('status','--porcelain'),'');
const root=await mkdtemp(join(evidence,'native-漢-fixture-'));
const workspace=join(root,'package-copy');
const cwd=join(root,'caller work');
const src=join(workspace,'plugin','graphgoblin');
const nodeModules=join(workspace,'node_modules');
const deploy=join(root,'disposable outputs');
const metadata='.graphgoblin-plugin-output.json';
const mcpRelative='plugins/graphgoblin/.mcp.json';
const skillRelative='plugins/graphgoblin/skills/design-loop/SKILL.md';
const hash=b=>createHash('sha256').update(b).digest('hex');
const active=new Set();
const report={head:expected,worktree,root,node:process.version,platform:process.platform,commands:[],cases:[],fingerprints:{}};
const pathExists=async(p)=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
function within(base,path){
 const rel=relative(base,path);
 return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);
}
async function physical(path) {
 try {return await realpath(path);}
 catch(e){if(e.code!=='ENOENT')throw e;if(dirname(path)===path)throw e;return join(await physical(dirname(path)),parse(path).base);}
}
async function verifyFixturePath(value){
 const path=resolve(cwd,value);
 assert(within(root,path),'lexical path outside disposable root '+path);
 const resolved=await physical(path);
 assert(within(root,resolved),'physical path outside disposable root '+resolved);
 return {path,resolved};
}
async function snapshot(path){
 if(!await pathExists(path))return null;
 const result={};
 async function inspect(p,tag='.') {
  const stat=await lstat(p);
  if(stat.isSymbolicLink()){result[tag]={type:'link',target:await realpath(p)};return;}
  if(stat.isFile()){result[tag]={type:'file',size:stat.size,sha256:hash(await readFile(p))};return;}
  assert(stat.isDirectory(),'Unsupported fixture entry');
  result[tag]={type:'directory'};
  for(const n of (await readdir(p)).sort())await inspect(join(p,n),tag==='.'?n:tag+'/'+n);
 }
 await inspect(path);
 return result;
}
async function cli(out,entry,opts={}){
 const checked=await verifyFixturePath(out);
 const target=await verifyFixturePath(entry);
 const argv=[join(workspace,'dist','cli.js'),...(opts.defaultOut?[]:['--out',out]),'--mcp-entry',entry];
 await verifyFixturePath(argv[0]);
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^NODE_OPTIONS$|^GG_/i.test(k)));
 const child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const record={pid:child.pid,argv,cwd,out:checked,entry:target,stdout:'',stderr:''};
 report.commands.push(record);
 active.add(child);
 child.stdout.on('data',b=>record.stdout+=b);
 child.stderr.on('data',b=>record.stderr+=b);
 const ended=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{active.delete(child);record.exit={code,signal};resolve(record);});});
 const watchdog=setTimeout(()=>{if(active.has(child)){record.watchdog=true;child.kill();}},45000);
 watchdog.unref();
 ended.finally(()=>clearTimeout(watchdog)).catch(()=>{});
 return opts.background?{child,ended,record}:ended;
}
async function check(name,fn){
 try{report.cases.push({name,status:'pass',details:await fn()});}
 catch(e){report.cases.push({name,status:'fail',message:String(e),stack:e.stack});}
}
function success(r){assert.equal(r.exit.code,0,r.stderr);assert.match(r.stderr,/Assembled graphgoblin@graphgoblin-local/);}
function refused(r,pattern=/Unsafe plugin output destination/){assert.equal(r.exit.code,1,r.stderr);assert.match(r.stderr,pattern);assert(r.stderr.includes(r.out.path),r.stderr);}
const wp=(...s)=>join(worktree,...s);
const mcpA=join(root,'MCP path A','main.js'), mcpB=join(root,'MCP path B 漢','main.js');
async function prepare(){
 for(const p of [workspace,cwd,deploy,dirname(mcpA),dirname(mcpB),join(nodeModules,'@graphgoblin','tooling'),join(workspace,'dist')])await mkdir(p,{recursive:true});
 for(const p of ['cli.js','assemble.js','manifest.js']){
  const contents=await readFile(wp('apps','plugin-codex','dist',p));
  report.fingerprints['apps/plugin-codex/dist/'+p]=hash(contents);
  await writeFile(join(workspace,'dist',p),contents);
 }
 for(const p of ['package.json'])await cp(wp('apps','plugin-codex',p),join(workspace,p));
 for(const p of ['package.json','plugin-output.mjs']){
  const contents=await readFile(wp('tooling',p));report.fingerprints['tooling/'+p]=hash(contents);
  await writeFile(join(nodeModules,'@graphgoblin','tooling',p),contents);
 }
 await cp(wp('apps','plugin-codex','plugin'),join(workspace,'plugin'),{recursive:true,dereference:true});
 await cp(await realpath(wp('apps','plugin-codex','node_modules','zod')),join(nodeModules,'zod'),{recursive:true,dereference:true});
 await writeFile(mcpA,'// fake MCP path A, never started\n');await writeFile(mcpB,'// fake MCP path B\n');
 assert.equal(await realpath(root),root);
}
async function owned(path,expectedEntry){
 const tree=await snapshot(path);
 const data=JSON.parse(await readFile(join(path,metadata),'utf8'));
 assert.equal(data.format,1);assert.equal(data.kind,'codex-marketplace');
 assert.deepEqual(Object.keys(data.files).sort(),Object.keys(tree).filter(k=>tree[k].type==='file'&&k!==metadata).sort());
 for(const [k,v] of Object.entries(data.files))assert.equal(tree[k].sha256,v);
 const plugin=JSON.parse(await readFile(join(path,mcpRelative),'utf8'));
 assert(Object.values(plugin.mcpServers).some(s=>s.args.includes(expectedEntry)));
 return tree;
}
async function canaryRefusal(out,expectedTargets,entry=mcpA,pattern){
 const images=await Promise.all(expectedTargets.map(snapshot));
 const request=await cli(out,entry);
 refused(request,pattern);
 for(let i=0;i<images.length;i++)assert.deepEqual(await snapshot(expectedTargets[i]),images[i]);
 return {message:request.stderr.trim(),preserved:expectedTargets.map(p=>relative(root,p))};
}
async function waitFor(predicate,ms=5000){
 const end=performance.now()+ms;
 while(performance.now()<end){if(await predicate())return;await delay(5);}
 throw Error('Condition not observed');
}
try{
 await prepare();
 await check('first build from an empty folder and two changed-output rebuilds',async()=>{
  const output=join(deploy,'normal 空');await mkdir(output);
  success(await cli(output,mcpA));const a=await owned(output,mcpA);
  success(await cli(relative(cwd,output),mcpB));const b=await owned(output,mcpB);
  assert.notEqual(a[mcpRelative].sha256,b[mcpRelative].sha256);
  assert.equal(a[skillRelative].sha256,b[skillRelative].sha256);
  success(await cli(output,mcpB));assert.deepEqual(await owned(output,mcpB),b);
  return {fileCount:Object.values(b).filter(v=>v.type==='file').length,mcpChanged:true,identicalRebuild:true};
 });
 await check('empty default in copied package works under repeated public CLI assembly',async()=>{
  const out=join(workspace,'dist','marketplace');await verifyFixturePath(out);
  const first=await cli(out,mcpA,{defaultOut:true});success(first);await owned(out,mcpA);
  success(await cli(out,mcpB));await owned(out,mcpB);
  return {out:relative(root,out)};
 });
 await check('foreign files, marker-only forgery, modified bytes and extra inventory entries',async()=>{
  const results=[];
  for(const kind of ['foreign','forged','modified','extra-nested','extra-empty-dir','old-unmarked','stage-sentinel']){
   const out=join(deploy,kind);
   if(kind==='foreign'||kind==='forged'){
    await mkdir(out);await writeFile(join(out,'bystander.txt'),Buffer.from([0,127,255]));
    if(kind==='forged')await writeFile(join(out,metadata),JSON.stringify({format:1,kind:'codex-marketplace',files:{'bystander.txt':hash(Buffer.from([0,127,255]))}}));
   } else {
    success(await cli(out,mcpA));
    if(kind==='modified')await writeFile(join(out,skillRelative),'edited fixture text');
    if(kind==='extra-nested')await writeFile(join(out,'plugins','graphgoblin','skills','design-loop','owner.bin'),Buffer.from([1,255,2]));
    if(kind==='extra-empty-dir')await mkdir(join(out,'unrelated-empty'));
    if(kind==='old-unmarked')await unlink(join(out,metadata));
    if(kind==='stage-sentinel'){
     const stage=join(deploy,'.stage-sentinel.graphgoblin-build');
     await mkdir(stage);await writeFile(join(stage,'existing.dat'),'belongs to earlier attempt');
     results.push({kind,...await canaryRefusal(out,[out,stage])});continue;
    }
   }
   results.push({kind,...await canaryRefusal(out,[out])});
  }
  return results;
 });
 await check('physical junction target, junction ancestor with missing output and linked owned subtree',async()=>{
  const target=join(root,'junction real target');await mkdir(target);await writeFile(join(target,'sentinel.dat'),'retained');
  const alias=join(root,'junction alias');await symlink(target,alias,'junction');
  const cases=[await canaryRefusal(alias,[target,alias]),await canaryRefusal(join(alias,'missing','new'),[target,alias])];
  assert.equal(await pathExists(join(target,'missing')),false);
  const out=join(deploy,'linked subtree');success(await cli(out,mcpA));
  const inside=join(out,'plugins','graphgoblin','skills','design-loop');
  const moved=join(root,'moved generated skill');await rename(inside,moved);
  await symlink(moved,inside,'junction');
  cases.push(await canaryRefusal(out,[out,moved]));
  return cases;
 });
 await check('overlap with protected disposable package, cwd, source and MCP input ancestor',async()=>{
  const tests=[[workspace,[workspace]],[cwd,[cwd]],[src,[src]],[dirname(mcpA),[dirname(mcpA)]],[join(workspace,'dist','must-not-create'),[join(workspace,'dist')]]];
  const out=[];
  for(const [destination,disposables] of tests)out.push(await canaryRefusal(destination,disposables,mcpA,/overlaps the working directory, builder package, or input path/));
  return out;
 });
 await check('Windows ambiguous path component within disposable output refuses cleanly',async()=>{
  const out=join(deploy,'CON.txt','nested');
  return canaryRefusal(out,[deploy],mcpA,/ambiguous Windows path component/);
 });
 await check('concurrent public CLI writers leave one complete valid marketplace and no staging tree',async()=>{
  const output=join(deploy,'contended');success(await cli(output,mcpA));
  const children=await Promise.all(Array.from({length:4},(_,i)=>cli(output,i%2===0?mcpA:mcpB,{background:true})));
  const results=await Promise.all(children.map(c=>c.ended));
  assert(results.some(r=>r.exit.code===0));
  assert(results.some(r=>r.exit.code===1));
  for(const r of results)if(r.exit.code===0)success(r);else refused(r,/another build is using/);
  const config=JSON.parse(await readFile(join(output,mcpRelative),'utf8'));
  const winner=Object.values(config.mcpServers)[0].args.find(a=>a===mcpA||a===mcpB);
  const final=await owned(output,winner);
  assert.equal(await pathExists(join(deploy,'.contended.graphgoblin-build')),false);
  return {successful:results.filter(r=>r.exit.code===0).length,refused:results.filter(r=>r.exit.code===1).length,winningMcp:relative(root,winner),files:Object.values(final).filter(v=>v.type==='file').length};
 });
 await check('interrupted owned process preserves previous artifact, and retry refuses an orphan stage',async()=>{
  const output=join(deploy,'interrupt');
  const sourceSkill=join(src,'skills','design-loop','SKILL.md');
  const original=await readFile(sourceSkill);
  try {
   const filler=Buffer.alloc(8*1024*1024,0x20);
   await writeFile(sourceSkill,Buffer.concat([original,Buffer.from('\n'),filler]));
   success(await cli(output,mcpA));const before=await owned(output,mcpA);
   const stage=join(deploy,'.interrupt.graphgoblin-build');
   const candidate=await cli(output,mcpB,{background:true});
   await waitFor(async()=>await pathExists(join(stage,'next'))&&!await pathExists(join(stage,'previous')));
   assert(active.has(candidate.child),'Owned fixture child exited before deliberate interruption');
   candidate.child.kill();
   const ended=await candidate.ended;
   assert.equal(ended.exit.signal,'SIGTERM');
   const live=await snapshot(output), previous=await snapshot(join(stage,'previous'));
   assert.deepEqual(live??previous,before);
   const blocked=await canaryRefusal(output,[output,stage],mcpB,/another build is using/);
   if(!live)await rename(join(stage,'previous'),output);
   const retainedStage=join(root,'interrupted-stage-retained');
   await rename(stage,retainedStage);
   success(await cli(output,mcpB));await owned(output,mcpB);
   return {killStage:live?'before-swap':'immediately-after-incumbent-move',blocked,restored:true,stageRetained:relative(root,retainedStage)};
  } finally {await writeFile(sourceSkill,original);}
 });
 const turbo=JSON.parse(await readFile(wp('turbo.json'),'utf8'));
 assert.equal(turbo.tasks['@graphgoblin/plugin-codex#build'].cache,false);
 assert.deepEqual(turbo.tasks['@graphgoblin/plugin-codex#build'].dependsOn,['^build']);
 report.cachePolicy={cache:false,source:'turbo.json',actualExecGate:'separate running full-suite'};
} catch(e){report.harnessFailure={message:String(e),stack:e.stack};}
finally{
 for(const p of active)p.kill();
 await waitFor(()=>active.size===0);
 report.finalHead=git('rev-parse','HEAD');
 report.finalStatus=git('status','--porcelain');
 report.liveChildren=active.size;
 await writeFile(join(evidence,'native-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({cases:report.cases,cachePolicy:report.cachePolicy,harnessFailure:report.harnessFailure,finalHead:report.finalHead,finalStatus:report.finalStatus,children:report.liveChildren},null,2));
 if(report.cases.some(c=>c.status!=='pass')||report.harnessFailure||report.finalHead!==expected||report.finalStatus)process.exitCode=1;
}

