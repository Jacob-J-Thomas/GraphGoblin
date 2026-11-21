// #365: executable SDK argv evidence with a controlled recorder replacing the native CLI.
// This does not select/run a Windows backend or prove an effective permission boundary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const repo='G:/ggq/gg-i4-427-qa/GraphGoblin';
const out=dirname(fileURLToPath(import.meta.url));
const root=join(out,'sandbox-argv');await mkdir(root,{recursive:false});
const from=(p)=>import(pathToFileURL(join(repo,p)).href);
const {clientOptions,threadOptions}=await from('packages/adapter-codex/src/options.ts');
const sdkFile=await realpath(join(repo,'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js'));
const {Codex}=await import(pathToFileURL(sdkFile).href);
const recorder=join(root,'recorder.mjs');
await writeFile(recorder,`import {writeFileSync} from 'node:fs';
writeFileSync(process.env.GG_QA_ARGV_FILE,JSON.stringify({argv:process.argv,envKeys:Object.keys(process.env).sort()},null,2));
process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'synthetic-sdk-argv-thread'})+'\\n');
process.stdout.write(JSON.stringify({type:'turn.started'})+'\\n');
process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}})+'\\n');
process.exit(0);
`);
const results=[];
for(const c of [{name:'inherited-backend',overrides:{}},{name:'explicit-backend',overrides:{windows:{sandbox:'unelevated'},sandbox_mode:'danger-full-access',approval_policy:'on-request'}}]){
 const argvFile=join(root,c.name+'.json');
 const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(k)));
 Object.assign(env,{NODE_OPTIONS:'--import='+pathToFileURL(recorder).href,GG_QA_ARGV_FILE:argvFile});
 const options={sandbox:'read-only',approval:'never',configOverrides:c.overrides};
 const client=clientOptions(options,process.execPath,env);
 const thread=threadOptions({model:'gpt-6-luna',effort:'low',options});
 const streamed=await new Codex(client).startThread(thread).runStreamed('Controlled SDK argv capture only.',{signal:AbortSignal.timeout(15_000)});
 const events=[];for await(const event of streamed.events)events.push(event);
 const recorded=JSON.parse(await readFile(argvFile,'utf8'));const args=recorded.argv.slice(2);
 assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
 assert(args.includes('approval_policy="never"'));
 if(c.name==='inherited-backend')assert(!args.some(v=>v.startsWith('windows.sandbox=')));
 else{
  assert(args.includes('windows.sandbox="unelevated"'));
  assert(args.indexOf('sandbox_mode="danger-full-access"')<args.indexOf('--sandbox'));
  assert(args.indexOf('approval_policy="on-request"')<args.indexOf('approval_policy="never"'));
 }
 assert(!Object.hasOwn(thread,'windows'));
 results.push({name:c.name,clientConfig:client.config,threadOptions:thread,args,events,observation:c.name==='inherited-backend'?'No windows.sandbox config is emitted; the authored permission level is explicit.':'Explicit windows.sandbox override is emitted before the distinct --sandbox permission option. Same-key approval override precedes the authored thread value.'});
}
const typesFile=join(dirname(sdkFile),'index.d.ts');const sdkTypes=await readFile(typesFile,'utf8');
const threadType=sdkTypes.slice(sdkTypes.indexOf('type ThreadOptions ='),sdkTypes.indexOf('\n};',sdkTypes.indexOf('type ThreadOptions ='))+3);
assert(threadType.includes('sandboxMode?: SandboxMode'));assert(!/windows|backend/i.test(threadType));
await writeFile(join(root,'ThreadOptions.txt'),threadType);
const hash=async(p)=>createHash('sha256').update(await readFile(p)).digest('hex');
const result={node:process.version,sdkFile,sdkSha256:await hash(sdkFile),typesFile,typesSha256:await hash(typesFile),recorderSha256:await hash(recorder),results,tier:'Real candidate options + actual pinned SDK serialization + controlled Node argv-recorder process. Static inheritance conclusion only; no owner Windows backend experiment and no permission weakening claimed.'};
await writeFile(join(root,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
