import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const evidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-discovery-01';
const repo = 'G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin';
const meta = JSON.parse(await readFile(join(evidence, 'cli-help-and-schema.json'), 'utf8'));
const nativePackage = createRequire(meta.launcher).resolve('@openai/codex-win32-x64/package.json');
const binary = join(dirname(nativePackage), 'vendor/x86_64-pc-windows-msvc/bin/codex.exe');
const { CodexHarness } = await import(pathToFileURL(join(repo, 'packages/adapter-codex/src/harness.ts')).href);
const root = await mkdtemp('G:/ggq/gg442-native-');
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(key)));
const commands = [], results = [], requests = [], failures = [];
let active;
async function command(command, args, env, cwd, timeoutMs = 20000) {
  const started = Date.now();
  const outcome = await new Promise((resolve, reject) => {
    let stdout = '', stderr = '', timedOut = false;
    const child = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
  const row = { command, args, cwd, ...outcome, elapsedMs: Date.now() - started };
  commands.push(row);
  await appendFile(join(evidence, 'native-commands.jsonl'), JSON.stringify(row) + '\n');
  return row;
}
const checked = async (...args) => { const row = await command(...args); assert.equal(row.code, 0, row.stderr + row.stdout); return row; };
const sse = (type, body) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;
const server = http.createServer(async (req, res) => {
  let bytes = '';
  for await (const chunk of req) bytes += chunk;
  if (req.method !== 'POST' || !req.url.endsWith('/responses')) { res.writeHead(404).end(); return; }
  assert(active, 'Only an active controlled turn may send model requests');
  const body = JSON.parse(bytes);
  active.requests.push(body);
  requests.push({ case: active.name, path: req.url, body });
  if (active.requests.length === 1) await new Promise(resolve => setTimeout(resolve, 300));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(sse('response.created', { response: { id: 'resp_gg442' } }));
  const item = active.requests.length === 1 ? {
    type: 'custom_tool_call', id: 'tool_gg442', call_id: 'call_' + active.name,
    namespace: 'functions', name: 'exec',
    input: 'const found = ALL_TOOLS.filter(t => /mcp__gg442_.*__echo_fixture$/.test(t.name)); text({ available: found.map(t => t.name).sort() }); for (const t of found) text(await tools[t.name]({}));',
  } : { type: 'message', role: 'assistant', id: 'msg_gg442', content: [{ type: 'output_text', text: 'GG442_OK' }] };
  res.write(sse('response.output_item.done', { item }));
  res.end(sse('response.completed', { response: { id: 'resp_gg442', usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert(![4747, 4748].includes(port));
await writeFile(join(root, 'mcp.mjs'), `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const [log] = process.argv.slice(2);
const record = event => appendFileSync(log, JSON.stringify({pid:process.pid,event})+'\\n');
record('started'); process.on('exit',()=>record('exit'));
for await (const line of readline.createInterface({input:process.stdin})) {
 const request=JSON.parse(line); if(request.id===undefined)continue;
 let result={};
 if(request.method==='initialize') result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'gg442-fixture',version:'1.0.0'}};
 if(request.method==='tools/list'){record('tools/list');result={tools:[{name:'echo_fixture',description:'Return a harmless constant marker',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]};}
 if(request.method==='tools/call'){record('tools/call');result={content:[{type:'text',text:'GG442_PLUGIN_OK'}]};}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
}
`);

async function appServer(env, work, market, pluginName) {
  const messages = [], pending = new Map();
  let stderr = '', next = 1;
  const child = spawn(binary, ['app-server', '--stdio'], { cwd: work, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { messages.push({ nonJson: line }); return; }
    messages.push(message);
    if (message.id !== undefined && pending.has(message.id)) { const resolve = pending.get(message.id); pending.delete(message.id); resolve(message); }
  });
  const call = async (method, params) => {
    const id = next++;
    const reply = new Promise(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    let timer;
    try { return await Promise.race([reply, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RPC timeout: ' + method)), 15000); })]); }
    finally { clearTimeout(timer); }
  };
  const replies = [];
  try {
    replies.push(await call('initialize', { clientInfo: { name: 'gg442-discovery', version: '1.0.0' }, capabilities: { experimentalApi: true } }));
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    for (const [method, params] of [
      ['config/read', { cwd: work, includeLayers: false }],
      ['plugin/list', { cwds: [work], marketplaceKinds: ['local'], forceRefetch: false }],
      ['plugin/installed', {}],
      ['plugin/read', { marketplacePath: market, pluginName }],
      ['mcpServerStatus/list', {}],
    ]) replies.push({ method, ...(await call(method, params)) });
  } catch (error) { replies.push({ fixtureError: error.message }); }
  finally { child.stdin.end(); }
  let timer;
  const exit = await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => { child.kill(); resolve({ forcedStop: true }); }, 5000); })]);
  clearTimeout(timer);
  if (exit.forcedStop) await closed;
  return { replies, messages, stderr, exit };
}

async function scenario(provenance, variant, { disabled = false, feature, overrides = {}, resume = false } = {}) {
  const name = `${provenance}-${variant}${disabled ? '-disabled' : ''}${feature === false ? '-feature-off' : ''}${overrides.features?.plugins === false ? '-node-off' : ''}${overrides.features?.plugins === true ? '-node-on' : ''}${resume ? '-resume' : ''}`;
  const folder = join(root, name), home = join(folder, 'home'), work = join(folder, 'work'), market = join(folder, 'market'), plugin = join(market, 'plugins/fixture');
  const mcpLog = join(folder, 'mcp.jsonl');
  await Promise.all([mkdir(home, {recursive:true}), mkdir(work, {recursive:true}), mkdir(join(plugin, '.codex-plugin'), {recursive:true}), mkdir(join(market, '.agents/plugins'), {recursive:true})]);
  await writeFile(join(home, 'gitconfig'), '');
  const env = { ...baseEnv, CODEX_HOME: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', description: 'Disposable #442 harmless plugin fixture', author: {name:'GraphGoblin QA'}, mcpServers: variant === 'missing-asset' ? './missing.json' : './.mcp.json' }));
  await writeFile(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { gg442_fixture: { command: process.execPath, args: [join(root, 'mcp.mjs'), mcpLog], startup_timeout_sec: 10 } } }));
  let source = { source: 'local', path: './plugins/fixture' };
  if (provenance === 'git') {
    for (const args of [['init', '--initial-branch=main'], ['add', '.'], ['-c', 'user.name=GraphGoblin QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Disposable plugin fixture']]) await checked('git', args, env, plugin);
    source = { source: 'git', url: pathToFileURL(plugin).href };
  }
  await writeFile(join(market, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'gg442-' + provenance, plugins: [{ name: 'fixture', source, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }] }));
  await checked(binary, ['plugin', 'marketplace', 'add', market, '--json'], env, work);
  await checked(binary, ['plugin', 'add', 'fixture@gg442-' + provenance, '--json'], env, work);
  const installed = await readFile(join(home, 'config.toml'), 'utf8');
  const config = 'model_provider="gg442"\n' + installed.replace('enabled = true', 'enabled = ' + !disabled) +
    (feature === undefined ? '' : '\n[features]\nplugins=' + feature + '\n') +
    '\n[model_providers.gg442]\nname="GraphGoblin local fixture"\nbase_url="http://127.0.0.1:' + port + '/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n' +
    (variant === 'unknown-id' ? '\n[plugins."missing@gg442-' + provenance + '"]\nenabled=true\n' : '');
  await writeFile(join(home, 'config.toml'), config);
  const cliDiagnostics = [];
  for (const args of [['plugin','list','--marketplace','gg442-' + provenance,'--json'], ['mcp','list','--json'], ['debug','prompt-input']]) cliDiagnostics.push(await command(binary, args, env, work));
  const rpc = await appServer(env, work, market, variant === 'unknown-id' ? 'missing' : 'fixture');
  active = { name, requests: [] };
  const harness = new CodexHarness({ env });
  const request = { workingDirectory: work, model: 'gpt-6-luna', effort: 'low', options: { sandbox: 'read-only', approval: 'never', configOverrides: overrides }, turn: { prompt: 'Controlled fixture: inspect harmless tool and reply GG442_OK.' } };
  const outputsFor = () => active.requests.at(-1)?.input?.filter(item => item.type === 'custom_tool_call_output' && item.call_id === 'call_' + name).flatMap(item => item.output.map(o => o.text)) ?? [];
  const runTurn = async resumeId => {
    const session = resumeId ? harness.resume(resumeId, request, AbortSignal.timeout(30000)) : harness.start(request, AbortSignal.timeout(30000));
    const value = await session.result;
    return { value: value.finalText, id: await session.sessionId };
  };
  let first, second, error;
  try { first = await runTurn(); if (resume) { active.requests = []; second = await runTurn(first.id); } }
  catch (caught) { error = { code: caught.code, name: caught.name, message: caught.message }; }
  const output = outputsFor();
  const available = output.map(text => { try { return JSON.parse(text).available; } catch { return undefined; } }).find(Array.isArray);
  const expected = variant === 'missing-asset' || disabled || overrides.features?.plugins === false || (feature === false && overrides.features?.plugins !== true) ? [] : ['mcp__gg442_fixture__echo_fixture'];
  const row = { name, provenance: provenance === 'git' ? 'Git-sourced/local-file-transport' : 'local-path-source', variant, disabled, feature, overrides, cliDiagnostics, rpc, output, available, expected, first, second, error, modelRequests: active.requests.length, folder, mcpEvents: (await readFile(mcpLog, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  results.push(row);
  await writeFile(join(evidence, name + '.json'), JSON.stringify(row, null, 2) + '\n');
  console.log(JSON.stringify({ name, available, expected, error, rpcErrors: rpc.replies.filter(r=>r.error||r.fixtureError).map(r=>({method:r.method,error:r.error||r.fixtureError})) }));
  assert.equal(error, undefined, JSON.stringify(error));
  assert.deepEqual(available, expected);
  assert.equal(first.value, 'GG442_OK');
  if (expected.length) assert(output.some(text => text.includes('GG442_PLUGIN_OK')));
}

try {
  for (const provenance of ['local','git']) {
    for (const variant of ['healthy','unknown-id','missing-asset']) await scenario(provenance, variant);
    await scenario(provenance, 'healthy', { disabled: true });
    await scenario(provenance, 'healthy', { overrides: {features:{plugins:false}} });
  }
  await scenario('local', 'healthy', { feature: false });
  await scenario('local', 'healthy', { feature: false, overrides: {features:{plugins:true}} });
  await scenario('local', 'healthy', { resume: true });
} catch (error) { failures.push({ name: error.name, message: error.message, stack: error.stack }); console.error(error); process.exitCode = 1; }
finally {
  active = undefined;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(evidence, 'native-discovery-result.json'), JSON.stringify({ root, repo, base: '02351e2fb932b3be44e7cc3fb3943a61d568226c', binary, binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'), node: process.version, port, remoteProviderCalls: 0, results, commands, failures }, null, 2) + '\n');
  await writeFile(join(evidence, 'responses-requests.json'), JSON.stringify(requests, null, 2) + '\n');
  console.log(JSON.stringify({ root, passed: results.filter(r=>!r.error && JSON.stringify(r.available)===JSON.stringify(r.expected)).length, failures }));
}
