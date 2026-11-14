import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = await realpath(process.argv[2]);
const claude = process.argv[3];
const installedOtherNodes = process.argv.slice(4);
const expected = '618382606211297d8cb0619c86b76cc12fd8fb6a';
const parent = '1757c666ae3e64d46c14b52dfd895f53f4625b89';
const correction = '38fab562d24a255574c0274e0e60c069df54f454';
const exported = await realpath(dirname(fileURLToPath(import.meta.url)));
assert(relative(repo, exported).startsWith('..'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const identity = () => ({ head:git('rev-parse','HEAD'), status:git('status','--porcelain=v1') });
assert.deepEqual(identity(), {head:expected,status:''});
for (const ancestor of [parent,correction]) git('merge-base','--is-ancestor',ancestor,expected);
const scratch = await mkdtemp(join(exported, '463 local 漢 '));
const outputs = join(scratch,"artifact & owner"+ "'s [claude] é");
const artifact = join(outputs,'GraphGoblin $漢');
const cwd = join(scratch,'neutral cwd');
const config = join(scratch,'isolated Claude config');
const cli = join(repo,'apps/plugin-claude/dist/cli.js');
const mcp = join(repo,'apps/mcp/dist/main.js');
const manifest = '.claude-plugin/plugin.json';
const guard = 'check-runtime.cjs';
const marker = '.graphgoblin-plugin-output.json';
const read = (path) => readFile(path, 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = async (path) => digest(await readFile(path));
const checked = [
  'apps/plugin-claude/src/cli.ts','apps/plugin-claude/src/index.ts','apps/plugin-claude/README.md',
  'apps/plugin-claude/plugin/design-draft.md','apps/plugin-claude/plugin/'+guard,
  'apps/plugin-claude/plugin/'+manifest,'apps/plugin-claude/dist/cli.js',
  'apps/plugin-claude/dist/index.js','apps/mcp/dist/main.js','apps/mcp/src/tools.ts',
  'apps/api/dist/main.js','tooling/plugin-output.mjs','tooling/plugin-output-metadata.mjs',
  'tooling/windows-plugin-streams.ps1','apps/plugin-codex/plugin/graphgoblin/skills/run-loop/SKILL.md',
];
const fingerprints = Object.fromEntries(await Promise.all(checked.map(async (p) => [p,await fileHash(join(repo,p))])));
const commands=[], scenarios=[], wire=[];
const token = 'synthetic-463-' + randomUUID();
const streamName = 'foreign-' + randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>
  !/^(?:GG_|ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|CLAUDECODE$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NODE_OPTIONS$)/i.test(key)));
Object.assign(env,{
  CLAUDE_CONFIG_DIR:config, GG_API_URL:'http://127.0.0.1:1', GG_API_KEY:token,
  ANTHROPIC_BASE_URL:'http://127.0.0.1:1', ANTHROPIC_API_KEY:'synthetic-loopback-only',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',
});
for(const path of [outputs,cwd,config]) await mkdir(path);
const append = async (label, executable, args, status, message, additions={}) => {
  const child = spawn(executable,args, {cwd,env:{...env,...additions},windowsHide:true,timeout:25_000,killSignal:'SIGKILL',stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.setEncoding('utf8').on('data',b=>out+=b);
  child.stderr.setEncoding('utf8').on('data',b=>err+=b);
  const {code,signal}=await new Promise((accept,reject)=>{
    child.on('error',reject);
    child.on('close',(code,signal)=>accept({code,signal}));
  });
  const leaked=[token,streamName].some(x=>out.includes(x)||err.includes(x));
  commands.push({label,executable,pid:child.pid,code,signal,stdout:leaked?'[suppressed]':out.trim(),stderr:leaked?'[suppressed]':err.trim()});
  assert.equal(leaked,false);
  assert.equal(signal,null);
  if(status!==undefined)assert.equal(code,status,out+err);
  if(message)assert.match(out+err,message);
  return {out,err,code};
};
const allFiles=async (dir,base=dir) => {
  const output=[];
  for (const d of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,d.name);
    if(d.isDirectory())output.push(...await allFiles(path,base));
    else { assert(d.isFile()); output.push(relative(base,path).replaceAll('\\','/')); }
  }
  return output.sort();
};
const snapshot=async () => {
  const list = await allFiles(artifact);
  const result = {};
  for(const file of list){
    const bytes=await readFile(join(artifact,file));
    assert(!bytes.includes(Buffer.from(token)));
    result[file]=digest(bytes);
  }
  const owned=JSON.parse(await read(join(artifact,marker)));
  assert.equal(owned.kind,'claude-plugin');
  assert.equal(Object.keys(owned.files).length,7);
  assert.deepEqual(Object.keys(result).filter(x=>x!==marker).sort(),Object.keys(owned.files).sort());
  for(const [path,hash]of Object.entries(owned.files))assert.equal(result[path],hash);
  return result;
};
const assemble=async (label,status,message, entry=mcp) => {
  assert.equal(await realpath(dirname(artifact)), resolve(outputs));
  return append(label,process.execPath,[cli,'--out',artifact,'--mcp-entry',entry],status,message);
};
let api, mcpClient, mcpTransport, failure, active, apiOrigin;

try {
  active='version inventory and stale-artifact provenance';
  const native = await append('native default Node PATH','node.exe',['--version'],0,/v22\.23\.4/);
  const claudeVersion = await append('installed Claude',claude,['--version'],0,/Claude Code/);
  const worktreeArtifact=join(repo,'apps/plugin-claude/dist/plugin/graphgoblin');
  const priorRun=await read(join(worktreeArtifact,'skills/run-loop/SKILL.md'));
  scenarios.push({case:active,node:native.out.trim(),claude:claudeVersion.out.trim(),
    ignoredDefaultRunSkillSha256:digest(priorRun),
    ignoredDefaultContainsCorrectedGuard:priorRun.includes('cannot select a newer draft')});

  active='fresh assembly and metadata refusal';
  await assemble('fresh public compiled CLI artifact',0,/Assembled GraphGoblin for Claude Code/);
  const built=await snapshot();
  const mcpConfig=JSON.parse(await read(join(artifact,'.mcp.json'))).mcpServers.graphgoblin;
  assert.equal(mcpConfig.command,'${GG_NODE_BINARY:-node}');
  assert.equal(mcpConfig.env,undefined);
  assert.equal(resolve(mcpConfig.args[2]),resolve(mcp));
  for(const item of [manifest,guard])assert.equal(built[item],fingerprints['apps/plugin-claude/plugin/'+item]);
  const checkedSkill=join(artifact,'skills','run-loop','SKILL.md');
  const stream=checkedSkill+':'+streamName+':$DATA';
  const foreign = Buffer.from([0,28,255,32,145]);
  await writeFile(stream,foreign);
  assert.deepEqual(await readFile(stream),foreign);
  await assemble('inherited shared metadata refusal on Claude skill',1,/Unowned alternate data stream found/);
  assert.deepEqual(await readFile(stream),foreign);
  assert.deepEqual(await snapshot(),built);
  // Truncate no artifact output. Remove only the independently verified fixture-created stream.
  const { unlink } = await import('node:fs/promises');
  await unlink(stream);
  assert.equal(await stat(stream).catch((err)=>err.code), 'ENOENT');
  await assemble('same output rebuild after removing only fixture ADS',0,/Assembled GraphGoblin for Claude Code/);
  assert.deepEqual(await snapshot(),built);
  assert.equal((await readdir(outputs)).length,1);
  scenarios.push({case:active, artifactFiles:built, streamPreservedSha256:digest(foreign)});

  active='generated guidance matches revision-selection rules';
  const runSkill=await read(checkedSkill);
  const designSkill=await read(join(artifact,'skills','design-loop','SKILL.md'));
  for (const text of [runSkill,designSkill]){
    assert.match(text,/only when the loop has no published version/);
    assert.match(text,/cannot select a newer draft of a published loop/);
    assert.match(text,/do not run the published version/);
    assert.match(text,/unless (?:the user|they) explicitly confirm/);
    assert.match(text,/disable-model-invocation: true/);
  }
  const sourceDesign=await read(join(repo,'apps/plugin-claude/plugin/design-draft.md'));
  assert(designSkill.endsWith(sourceDesign));
  const verification=JSON.parse(await read(join(repo,'docs/qa/2026-11-14-claude-plugin-corrections/output-ownership-manifest.json')));
  const current=JSON.parse(await read(join(artifact,marker)));
  assert.deepEqual(current.files,verification.files);
  scenarios.push({case:active,sourceDesignIncluded:true,generatedBytesMatchImplementerInventory:true,
    generatedClauses:[runSkill.split('\n').filter(l=>/cannot select|substitute/.test(l)),designSkill.split('\n').filter(l=>/cannot select/.test(l))]});

  active='actual Node runtime guard';
  const guardPath=join(artifact,guard);
  const entry=join(scratch,'MCP entry marker & é.cjs');
  await writeFile(entry,"console.log('entered under '+process.version)\n");
  await append('supported explicit binary starts entry',process.execPath,['--require',guardPath,entry],0,/entered under v22\.23\.4/);
  await append('bare PATH command starts entry', 'node.exe',['--require',guardPath,entry],0,/entered under v22\.23\.4/);
  await append('actual supported version missing entry',process.execPath,['--require',guardPath,join(scratch,'missing entry & é.cjs')],1,
    /could not find its MCP entry[\s\S]*pnpm build/);
  const refused=[];
  for(const binary of installedOtherNodes){
    const version=(await append('native installed alternate version',binary,['--version'],0,/v\d+\.\d+\.\d+/)).out.trim();
    const [maj,min,patch]=version.slice(1).split('.').map(Number);
    if(maj===22&&(min>22||(min===22&&patch>=2))) continue;
    const result=await append('native version refused by generated guard',binary,['--require',guardPath,entry],1,
      /requires Node 22\.22\.2 or later in major 22[\s\S]*GG_NODE_BINARY/);
    assert.doesNotMatch(result.out,/entered under/);
    refused.push({binary,version});
  }
  assert(refused.some(({version})=>!version.startsWith('v22.')));
  scenarios.push({case:active,supported:process.version,nativeRefused:refused,simulatedVersionsUsed:false});

  active='actual Claude native loading with no model turns';
  const strict=await append('strict native plugin validator',claude,['plugin','validate','--strict','--json',artifact],0);
  assert.equal(JSON.parse(strict.out).success,true);
  const list=await append('inline plugin inventory',claude,['--plugin-dir',artifact,'plugin','list','--json'],0);
  assert(JSON.parse(list.out).some(({id,enabled})=>id==='graphgoblin@inline'&&enabled));
  await append('native skill details',claude,['--plugin-dir',artifact,'plugin','details','graphgoblin'],0,
    /Skills \(3\).*design-loop.*inspect-run.*run-loop/);
  const connection=await append('native MCP PATH runtime connection',claude,['--plugin-dir',artifact,'mcp','list'],0,
    /plugin:graphgoblin:graphgoblin: .*Connected/);
  scenarios.push({case:active,connected:true,usingDefaultNode:connection.out.includes('node --require'),modelTurns:0});

  active='published-plus-draft MCP admission';
  for(const key of Object.keys(process.env))if(/^GG_/i.test(key)||/^JEV_API_KEY$/i.test(key))delete process.env[key];
  const store=join(scratch,'disposable store');
  Object.assign(process.env,{GG_DATA_DIR:store,GG_HOST:'127.0.0.1',GG_PORT:'0',GG_REQUIRE_API_KEY:'false',
    GG_WEB_DIST:'',GG_GOBLIN_DIST:'',GG_OLLAMA_ENABLED:'false',GG_SWAGGER_UI:'false',GG_LOG_LEVEL:'silent'});
  const { main }=await import(pathToFileURL(join(repo,'apps/api/dist/main.js')).href);
  api=await main();
  assert(![4747,4748].includes(api.app.server.address().port));
  apiOrigin='http://127.0.0.1:'+api.app.server.address().port;
  const sdk=join(repo,'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
  const { Client }=await import(pathToFileURL(join(sdk,'index.js')));
  const { StdioClientTransport }=await import(pathToFileURL(join(sdk,'stdio.js')));
  mcpClient=new Client({name:'independent-correction-test',version:'1.0.0'});
  mcpTransport=new StdioClientTransport({command:process.execPath,
    args:['--require',guardPath,mcpConfig.args[2],'--draft-tools'],cwd,env:{...env,GG_API_URL:apiOrigin,GG_API_KEY:''},stderr:'pipe'});
  await mcpClient.connect(mcpTransport);
  const mcpPid=mcpTransport.pid;
  const http=async (method,path,status,body,extra={})=>{
    const response=await fetch(apiOrigin+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
    const parsed=await response.json();
    wire.push({layer:'rest',method,path,status:response.status,code:parsed.code??null});
    assert.equal(response.status,status,JSON.stringify(parsed));
    return parsed;
  };
  const call=async (name,args)=>{
    const reply=await mcpClient.callTool({name,arguments:args});
    const json=reply.content?.find(({type})=>type==='text')?.text;
    assert(json);
    if(reply.isError){
      wire.push({layer:'mcp',name,label:'error',body:json});
      return {error:json};
    }
    const parsed=JSON.parse(json);
    wire.push({layer:'mcp',name,label:'success',body:parsed});
    return parsed;
  };
  const graph=(name,result)=>({schemaVersion:4,name,nodes:[
    {id:'start',kind:'trigger',label:'Start',config:{type:'manual',exposeTo:['mcp','api','ui']}},
    {id:'done',kind:'exit',label:'Done',config:{returns:JSON.stringify(result)}}],
    edges:[{id:'from-start',from:{node:'start',port:'out'},to:{node:'done'}}]});
  const old='Published revision Ω';
  const next='Newer draft only é';
  const created=await http('POST','/loops',201,{definition:graph('Plugin selection control',old)});
  const path='/loops/'+created.loop.id;
  const published=await http('POST',path+'/publish',200);
  const beforeDraft=await http('GET',path,200);
  await http('PUT',path+'/draft',200,{definition:graph('Plugin selection control',next)},{'if-match':'"'+beforeDraft.draftToken+'"'});
  const simultaneous=await http('GET',path,200);
  assert.equal(simultaneous.current.id,published.version.id);
  assert.notEqual(simultaneous.draft.id,simultaneous.current.id);
  const pure=await http('POST','/loops',201,{definition:graph('Draft-only positive control',next)});
  const without=await call('start_run',{loopId:pure.loop.id});
  assert.match(without.error,/no published version/);
  const selected=await call('start_run',{loopId:created.loop.id,allowDraft:true});
  const completed=await call('wait_for_run',{runId:selected.runId,timeoutSeconds:10});
  assert.equal(completed.run.status,'succeeded');
  assert.equal(completed.run.result,old);
  assert.equal(completed.run.versionId,published.version.id);
  const onlyDraft=await call('start_run',{loopId:pure.loop.id,allowDraft:true});
  const finished=await call('wait_for_run',{runId:onlyDraft.runId,timeoutSeconds:10});
  assert.equal(finished.run.status,'succeeded');
  assert.equal(finished.run.result,next);
  assert.equal(finished.run.pinned.source,'draft');
  const preserved=await http('GET',path,200);
  assert.equal(preserved.draft.id,simultaneous.draft.id);
  scenarios.push({case:active, publishedVersion:published.version.id,newerDraft:preserved.draft.id,
    retiredResult:completed.run.result,draftControlResult:finished.run.result,mcpPid,controlledCaller:true});

  assert.deepEqual(await allFiles(config).then(async (files)=>{
    const leaks=[];
    for(const file of files)if((await readFile(join(config,file))).includes(Buffer.from(token)))leaks.push(file);
    return leaks;
  }),[]);
  for(const [p,h] of Object.entries(fingerprints)) assert.equal(await fileHash(join(repo,p)),h);
  assert.deepEqual(identity(),{head:expected,status:''});
} catch (error) {
  failure={case:active,message:String(error),stack:error.stack};
  throw error;
} finally {
  await mcpClient?.close();
  await api?.app.close();
  const report={expected,parent,correction,identityAfter:identity(),runtime:process.version,pid:process.pid,scratch,apiOrigin,
    gatewayListening:api?.app.server.listening??false,fingerprints,commands,scenarios,wire,failure:failure??null};
  const encoded=JSON.stringify(report,null,2)+'\n';
  assert(!encoded.includes(token)&&!encoded.includes(streamName));
  const out=join(scratch,'observed.json');
  await writeFile(out,encoded);
  console.log(out);
}
