// Independent QA: real candidate CodexHarness + pinned SDK/native CLI, controlled loopback provider.
// Run using Node 22.23.4, --conditions=development and the candidate tsx loader.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = 'G:/ggq/gg-i4-427-qa/GraphGoblin';
const out = dirname(fileURLToPath(import.meta.url));
const attempt = process.env.GG_QA_ATTEMPT || 'native-source-attempt-1';
const root = join(out, attempt);
await mkdir(root, { recursive: false });
const home = join(root, 'home');
const work = join(root, 'work');
await Promise.all([mkdir(home), mkdir(work)]);
const from = (rel) => import(pathToFileURL(join(repo, rel)).href);
const { CodexHarness } = await from('packages/adapter-codex/src/harness.ts');
const { bundledCli, runCli } = await from('packages/adapter-codex/src/cli.ts');
const env = Object.fromEntries(Object.entries(process.env).filter(([k,v]) => v !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(k)));
Object.assign(env, { CODEX_HOME: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home });
const cli = bundledCli();
assert(cli, 'bundled CLI present');
const version = await runCli({ ...cli, cwd: work, env }, ['--version'], 15_000);
assert.equal(version.code, 0);
const sdkFile = join(repo, 'packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js');
const requireSdk = createRequire(await realpath(sdkFile));
const cliPackage = requireSdk.resolve('@openai/codex/package.json');
const requireCli = createRequire(cliPackage);
const nativePackage = requireCli.resolve('@openai/codex-win32-x64/package.json');
const nativeBinary = join(dirname(nativePackage), 'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const hash = async (f) => createHash('sha256').update(await readFile(f)).digest('hex');
let active;
const requests = [];
const unexpected = [];
const server = http.createServer(async (req,res) => {
  let bytes = ''; for await (const part of req) bytes += part;
  if (req.method !== 'POST' || !req.url.endsWith('/responses')) {
    unexpected.push({ method: req.method, url: req.url }); res.writeHead(404).end(); return;
  }
  const body = JSON.parse(bytes);
  const record = { scenario: active.name, method: req.method, path: req.url, body };
  requests.push(record);
  active.requests.push(record);
  if (active.status !== 200) {
    res.writeHead(active.status, {'content-type':'application/json'});
    res.end(JSON.stringify(active.body));
    return;
  }
  const sse = (type, body) => `event: ${type}\ndata: ${JSON.stringify({type,...body})}\n\n`;
  res.writeHead(200, {'content-type':'text/event-stream'});
  res.write(sse('response.created',{response:{id:'resp_qa427'}}));
  res.write(sse('response.output_item.done',{item:{type:'message',role:'assistant',id:'msg_qa427',content:[{type:'output_text',text:'QA427_SUPPORTED_OK'}]}}));
  res.end(sse('response.completed',{response:{id:'resp_qa427',usage:{input_tokens:1,input_tokens_details:{cached_tokens:0},output_tokens:1,output_tokens_details:{reasoning_tokens:0},total_tokens:2}}}));
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const port = server.address().port;
assert(![4747,4748].includes(port));
await writeFile(join(home,'config.toml'), `model_provider="qa427"\n[model_providers.qa427]\nname="QA local synthetic Responses"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.${JSON.stringify(work)}]\ntrust_level="trusted"\n`);
const calls=[];
const harness = new CodexHarness({ env, cliRunner: async (...args) => {
  const result = await runCli(...args);
  calls.push({ args: args[1], code: result.code, output: result.output });
  return result;
}});
const historical = "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.";
const cases = [
  { name:'historical-account-refusal', model:'gpt-5.5', status:400, body:{type:'error',status:400,error:{type:'invalid_request_error',code:'model_not_found',param:null,message:historical}} },
  { name:'supported-positive', model:'gpt-6-luna', status:200 },
];
const results=[];
let failure;
try {
  for (const scenario of cases) {
    active={...scenario,requests:[]};
    const session = harness.start({workingDirectory:work,model:scenario.model,effort:'low',options:{sandbox:'read-only',approval:'never',configOverrides:{features:{plugins:false}}},turn:{prompt:'Synthetic QA427 native refusal fixture. No tools. Reply QA427_SUPPORTED_OK.'}},AbortSignal.timeout(30_000));
    const events=[];
    const consume=(async()=>{for await (const e of session.events) events.push(e)})();
    let result,error,id;
    const idTask=session.sessionId.then(v=>{id=v},()=>{});
    try {result=await session.result} catch(e){error={code:e.code,name:e.name,message:e.message,retriable:e.retriable,submission:e.submission}}
    await consume; await idTask;
    const row={name:scenario.name,model:scenario.model,id,result,error,events,requests:active.requests.length};
    results.push(row);
    await writeFile(join(root,'results.json'),JSON.stringify(results,null,2));
    assert.equal(active.requests.length,1,'exactly one local model request; no provider retry/fallback');
    if(scenario.status===200){assert.equal(error,undefined);assert.equal(result.finalText,'QA427_SUPPORTED_OK')}
    else {assert.equal(error?.code,'HARNESS_ARGUMENTS_REJECTED');assert.equal(error?.retriable,false);assert(error.message.includes(historical));}
    console.log(JSON.stringify(row));
  }
} catch(e){failure={name:e.name,message:e.message,stack:e.stack};console.error(JSON.stringify(failure));process.exitCode=1}
finally {
  await writeFile(join(root,'requests.json'),JSON.stringify(requests,null,2));
  await writeFile(join(root,'cli-calls.json'),JSON.stringify(calls,null,2));
  await writeFile(join(root,'manifest.json'),JSON.stringify({repo,attempt,node:process.version,version,cliPackage,nativePackage,nativeBinary,sdkSha256:await hash(sdkFile),nativeSha256:await hash(nativeBinary),port,unexpected,results,failure,tier:'real candidate source harness + pinned SDK/native CLI; synthetic local provider; no live entitlement measured'},null,2));
  server.closeAllConnections();await new Promise(r=>server.close(r));
}
