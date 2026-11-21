import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import diagnostics from 'node:diagnostics_channel';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const write = (target, data) => fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
const err = (e) => ({ name: e?.name, code: e?.code, message: e?.message, submission: e?.submission, retriable: e?.retriable, stack: e?.stack });
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function until(test, ms = 7000) { const end = Date.now() + ms; while (!test()) { if (Date.now() >= end) throw new Error('Bounded fixture wait expired'); await delay(20); } }
const { CodexStructured } = await import(pathToFileURL(path.join(config.checkout, 'packages/adapter-codex/src/structured.ts')).href);
const { CodexHarness } = await import(pathToFileURL(path.join(config.checkout, 'packages/adapter-codex/src/harness.ts')).href);
const state = { id: config.id, tier: config.tier, mode: config.mode, pid: process.pid, platform: process.platform, node: process.version, temp: os.tmpdir(), tempLength: os.tmpdir().length, cwd: process.cwd(), codexHome: process.env.CODEX_HOME, before: fs.readdirSync(config.temp), children: [], requests: [], unexpectedRequests: [], observations: [], at: new Date().toISOString() };
const tracked = [];
const observeChild = ({ process: child }) => {
  // Public Node diagnostics channel; no built-in, SDK or harness replacement.
  const args = [...(child.spawnargs ?? [])];
  const row = { pid: child.pid, executable: child.spawnfile, args, at: new Date().toISOString(), exited: false };
  tracked.push(child); state.children.push(row);
  child.once('spawn', () => { row.pid = child.pid; row.spawned = true; row.args = [...(child.spawnargs ?? [])]; row.executable = child.spawnfile; });
  child.once('error', (e) => { row.error = err(e); });
  // The SDK removes listeners after exit; do not await close.
  child.once('exit', (code, signal) => { row.exited = true; row.exitCode = code; row.signal = signal; row.exitAt = new Date().toISOString(); });
};
diagnostics.subscribe('child_process', observeChild);
let server;
const controller = new AbortController();
let deadline;
try {
  assert.equal(process.version, 'v22.23.4'); assert.equal(process.platform, 'win32'); assert.equal(os.tmpdir(), config.temp);
  const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(key)));
  let options;
  if (config.tier === 'harmless') {
    Object.assign(cliEnv, { NODE_OPTIONS: `--import=${pathToFileURL(config.fakeCli).href}`, QA363_LIST: config.listFile, QA363_TURN: config.turnFile, QA363_MODE: config.mode });
    options = { codexBinary: process.execPath, env: cliEnv };
  } else {
    server = http.createServer(async (request, response) => {
      try {
        let bytes = ''; for await (const part of request) bytes += part;
        if (request.method !== 'POST' || !request.url.endsWith('/responses')) { state.unexpectedRequests.push({ method: request.method, url: request.url }); response.writeHead(404).end(); return; }
        const body = JSON.parse(bytes);
        const product = fs.readdirSync(config.temp);
        const schemaName = product.find((name) => name.startsWith('gg-schema-') && !config.sentinelNames.includes(name));
        const scratchName = product.find((name) => name.startsWith('gg-structured-') && !config.sentinelNames.includes(name));
        const schemaPath = path.join(config.temp, schemaName, 'schema.json');
        const scratch = path.join(config.temp, scratchName);
        const schemaBytes = fs.readFileSync(schemaPath);
        state.requests.push({ method: request.method, url: request.url, body, schemaPath, schemaDir: path.dirname(schemaPath), schemaDirLength: path.dirname(schemaPath).length, schemaFileLength: schemaPath.length, schemaText: schemaBytes.toString(), schema: JSON.parse(schemaBytes), schemaSha256: hash(schemaBytes), scratch, scratchLength: scratch.length, scratchEntries: fs.readdirSync(scratch), at: new Date().toISOString() });
        write(config.stateFile, state);
        const event = (type, fields) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(event('response.created', { response: { id: 'resp_qa363' } }));
        response.write(event('response.output_item.done', { item: { type: 'message', role: 'assistant', id: 'msg_qa363', content: [{ type: 'output_text', text: '{"proof":"sdk363","ok":true}' }] } }));
        response.end(event('response.completed', { response: { id: 'resp_qa363', usage: { input_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 5 } } }));
      } catch (e) { state.serverError = err(e); response.writeHead(500).end('QA local fixture failed'); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; assert(![4747, 4748].includes(port)); state.port = port;
    fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), `model_provider="qa363"\n[model_providers.qa363]\nname="Independent local synthetic Responses"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n[features]\nplugins=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n`);
    options = { env: cliEnv };
  }
  write(config.stateFile, state);
  deadline = setTimeout(() => controller.abort(new Error('Independent fixture deadline')), 25000);
  const completion = new CodexStructured(new CodexHarness(options)).complete({ prompt: 'Controlled QA363 local-only fixture. No tools. Return the schema-conforming proof.', model: 'gpt-6-luna', effort: 'low', schema: config.schema }, controller.signal).then((value) => ({ kind: 'resolved', value }), (error) => ({ kind: 'rejected', error: err(error) }));
  if (config.mode === 'abort') {
    await until(() => fs.existsSync(config.turnFile));
    const turn = JSON.parse(fs.readFileSync(config.turnFile));
    state.abortObservation = { pid: turn.pid, schemaFileExists: fs.existsSync(turn.schemaPath), scratchExists: fs.existsSync(turn.cwd), at: new Date().toISOString() };
    controller.abort(new Error('Independent caller abort after actual schema read'));
  }
  state.outcome = await completion;
  clearTimeout(deadline);
  await until(() => tracked.every((child) => child.exitCode !== null || child.signalCode !== null), 6000);
  state.handleTermination = tracked.map((child) => ({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode }));
  state.liveHandles = state.handleTermination.filter((child) => child.exitCode === null && child.signalCode === null);
  state.listing = fs.existsSync(config.listFile) ? JSON.parse(fs.readFileSync(config.listFile)) : null;
  state.turn = fs.existsSync(config.turnFile) ? JSON.parse(fs.readFileSync(config.turnFile)) : null;
  const schema = state.turn ?? state.requests[0];
  const scratch = state.turn?.cwd ?? state.requests[0]?.scratch ?? state.listing?.cwd;
  state.schemaDirExistsAfter = schema ? fs.existsSync(schema.schemaDir) : null;
  state.scratchExistsAfter = scratch ? fs.existsSync(scratch) : null;
} catch (e) { state.fixtureFailure = err(e); process.exitCode = 1; }
finally {
  clearTimeout(deadline);
  diagnostics.unsubscribe('child_process', observeChild);
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  state.after = fs.readdirSync(config.temp);
  state.sentinelContents = config.sentinels.map((item) => ({ path: item.path, actual: fs.readFileSync(item.path, 'utf8'), expected: item.text }));
  state.end = new Date().toISOString();
  write(config.stateFile, state); console.log(JSON.stringify(state));
}
