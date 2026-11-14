import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const worktree = resolve(process.argv[2]);
const apiWorktree = worktree;
const expected = process.argv[3];
const head = (cwd) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' }).trim(), '');
assert.equal(head(worktree), expected);
const scratch = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '455 native 漢 '));
const buildRoot = join(worktree, 'apps', 'plugin-claude', 'dist');
const artifact = join(scratch, 'built plugin 漢');
const cwd = join(scratch, 'neutral workdir');
const configuredNode = join(scratch, 'node runtime é', basename(process.execPath));
const config = join(scratch, 'isolated Claude config');
await mkdir(config);
await mkdir(cwd);
await mkdir(dirname(configuredNode));
await cp(process.execPath, configuredNode);
const observations = [];
const commands = [], allToolNames = new Set();
const secrets = new Set();
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(?:GG_|ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|CLAUDECODE$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NODE_OPTIONS$)/i.test(key)));
const claudeEnv = {
  ...inherited, CLAUDE_CONFIG_DIR: config, GG_NODE_BINARY: configuredNode, DISABLE_AUTOUPDATER: '1',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'independent-loopback-default',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ENABLE_TOOL_SEARCH: 'false',
};

async function command(file, args, env) {
  const child = spawn(file, args, {
    env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 45_000, killSignal: 'SIGKILL',
  });
  const collect = (stream) => new Promise((accept) => {
    let output = '';
    stream.setEncoding('utf8').on('data', (chunk) => { output += chunk; }).on('end', () => accept(output));
  });
  const [code, stdout, stderr] = await Promise.all([
    new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); }),
    collect(child.stdout), collect(child.stderr),
  ]);
  assert(![...secrets].some((token) => stdout.includes(token) || stderr.includes(token)), 'Output contained a fixture credential');
  commands.push({ pid: child.pid, exitCode: code, command: basename(file), purpose: args[0] });
  return { code, stdout, stderr };
}

const claudeBinary = process.env.GG_TEST_CLAUDE_BINARY || 'claude';
const version = await command(claudeBinary, ['--version'], claudeEnv);
assert.equal(version.code, 0);
assert.match(version.stdout, /^\d+\.\d+\.\d+ \(Claude Code\)/);
const node = await command(configuredNode, ['--version'], claudeEnv);
assert.equal(node.stdout.trim(), process.version);
const builtMcp = join(worktree, 'apps', 'mcp', 'dist', 'main.js');
const linkedMcp = join(scratch, 'moved checkout é', 'mcp entry.mjs');
await mkdir(dirname(linkedMcp));
await writeFile(linkedMcp, 'import { main } from ' + JSON.stringify(pathToFileURL(builtMcp).href) + ';\nconst server = await main(process.argv.slice(2), process.env);\nprocess.exitCode = server.exitCode;\n');
const build = await command(process.execPath, [join(buildRoot, 'cli.js'), '--out', artifact, '--mcp-entry', linkedMcp], claudeEnv);
assert.equal(build.code, 0, build.stderr);
const generated = JSON.parse(await readFile(join(artifact, '.mcp.json'), 'utf8'));
assert.equal(generated.mcpServers.graphgoblin.env, undefined);
const fileHash = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const fingerprints = {
  api: await fileHash(join(apiWorktree, 'apps', 'api', 'dist', 'main.js')),
  mcp: await fileHash(builtMcp),
  pluginManifest: await fileHash(join(artifact, '.claude-plugin', 'plugin.json')),
};

for (const key of Object.keys(process.env)) {
  if (/^GG_|^(JEV_API_KEY|NODE_OPTIONS)$/i.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  GG_DATA_DIR: join(scratch, 'gateway'),
  GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'true', GG_LOG_LEVEL: 'silent',
  GG_WEB_DIST: '', GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false', GG_OLLAMA_ENABLED: 'false',
});
const { main } = await import(pathToFileURL(join(apiWorktree, 'apps', 'api', 'dist', 'main.js')).href);
const gateway = await main();
const api = 'http://127.0.0.1:' + gateway.app.server.address().port;
assert(!/:474[78]$/.test(api));
const keys = gateway.container.repos.apiKeys;
const token = (await keys.create('local', 'native acceptance author', ['loops:write', 'runs:write'])).token;
const readerToken = (await keys.create('local', 'native acceptance reader', ['loops:read'])).token;
const otherToken = (await keys.create('other', 'native acceptance other', ['loops:write'])).token;
secrets.add(token); secrets.add(readerToken); secrets.add(otherToken); secrets.add('independent-invalid-credential');
const headers = { authorization: 'Bearer ' + token };
const environment = { ...claudeEnv, CLAUDE_CONFIG_DIR: config, GG_API_URL: api, GG_API_KEY: token };

async function inspectLoader(plugin, configured = false) {
  const args = configured ? [] : ['--plugin-dir', plugin];
  const validation = await command(claudeBinary, ['plugin', 'validate', '--strict', '--json', plugin], environment);
  assert.equal(validation.code, 0, validation.stderr || validation.stdout);
  assert.equal(JSON.parse(validation.stdout).success, true);
  const list = await command(claudeBinary, [...args, 'plugin', 'list', '--json'], environment);
  assert.equal(list.code, 0);
  const plugins = JSON.parse(list.stdout);
  assert(plugins.some((item) => item.id === 'graphgoblin@' + (configured ? 'skills-dir' : 'inline') && item.enabled));
  const details = await command(claudeBinary, [...args, 'plugin', 'details', 'graphgoblin'], environment);
  assert.match(details.stdout, /Skills \(3\).*design-loop.*inspect-run.*run-loop/);
  const mcp = await command(claudeBinary, [...args, 'mcp', 'list'], environment);
  assert.match(mcp.stdout, /plugin:graphgoblin:graphgoblin: .*Connected/);
  observations.push({ stage: 'native loader', installed: configured, validation: JSON.parse(validation.stdout).success, inventory: details.stdout, mcp: mcp.stdout });
}

const fullName = (name) => 'mcp__plugin_graphgoblin_graphgoblin__' + name;
const successText = 'Controlled Claude Code workflow completed.';
const toolResult = (request, index) => {
  const blocks = request.messages.flatMap(({ content }) => Array.isArray(content) ? content : []);
  return blocks.find((block) => block.type === 'tool_result' && block.tool_use_id === 'toolu_' + index);
};
const resultText = (block) => Array.isArray(block?.content)
  ? block.content.map((item) => item.text ?? '').join('\n')
  : block?.content;
const resultJson = (block) => JSON.parse(resultText(block));

async function nativeSession(scenario, slash, signature, steps, caseEnv = environment, plugin = artifact) {
  const trace = [];
  let failure;
  const messages = createServer(async (request, response) => {
    try {
      assert.match(request.url, /^\/v1\/messages/);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert(JSON.stringify(body.messages).includes(signature), 'requested skill body must enter the model request');
      const turn = trace.filter(({ waiting }) => !waiting).length;
      const previous = turn > 0 ? toolResult(body, turn - 1) : undefined;
      if (turn > 0) {
        assert(previous, 'Claude must return the prior real MCP result');
        steps[turn - 1].check(previous);
      }
      const next = steps[turn];
      const args = next ? (typeof next.input === 'function' ? next.input(body) : next.input) : undefined;
      const available = body.tools.map(({ name }) => name);
      for (const name of available) if (name.startsWith('mcp__plugin_graphgoblin_')) allToolNames.add(name);
      const waiting = next && !available.includes(fullName(next.tool)) && available.includes('WaitForMcpServers');
      if (waiting) assert(trace.filter((item) => item.waiting).length < 4, 'MCP did not finish startup');
      if (next && !waiting) assert(available.includes(fullName(next.tool)), 'plugin tool ' + next.tool + ' missing. Exposed tools: ' + available.join(', '));
      assert(!body.tools.some(({ name }) => /__publish|__delete_loop/.test(name)));
      trace.push({ turn, waiting, tool: waiting ? 'WaitForMcpServers' : next?.tool, result: resultText(previous) });
      const call = next
        ? {
            type: 'tool_use', id: waiting ? 'toolu_wait_' + trace.length : 'toolu_' + turn,
            name: waiting ? 'WaitForMcpServers' : fullName(next.tool), input: {},
          }
        : { type: 'text', text: '' };
      const message = {
        id: 'msg_native_' + turn, type: 'message', role: 'assistant', model: body.model,
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
      };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (type, data) => response.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
      send('message_start', { message });
      send('content_block_start', { index: 0, content_block: call });
      send('content_block_delta', { index: 0, delta: next
        ? { type: 'input_json_delta', partial_json: JSON.stringify(waiting ? {} : args) }
        : { type: 'text_delta', text: successText } });
      send('content_block_stop', { index: 0 });
      send('message_delta', { delta: { stop_reason: next ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      send('message_stop', {});
      response.end();
    } catch (error) {
      failure = error;
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Acceptance fixture assertion failed' } }));
    }
  });
  await new Promise((accept) => messages.listen(0, '127.0.0.1', accept));
  assert(![4747, 4748].includes(messages.address().port));
  try {
    const permissions = [...new Set(steps.map(({ tool }) => fullName(tool)))];
    const flags = plugin ? ['--plugin-dir', plugin] : [];
    const run = await command(claudeBinary, [
      ...flags, '--allowedTools', ...permissions, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'dontAsk', '--no-session-persistence', '-p', slash,
    ], {
      ...caseEnv, ANTHROPIC_API_KEY: 'loopback-fixture',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + messages.address().port,
    });
    observations.push({ stage: 'native CLI tool invocation', scenario, exitCode: run.code, trace, stderr: run.stderr });
    if (failure) throw failure;
    assert.equal(run.code, 0, run.stderr || run.stdout);
    assert.equal(trace.filter(({ waiting }) => !waiting).length, steps.length + 1);
    assert(run.stdout.includes(successText));
  if (scenario === 'draft create, validate and save') {
    const traceNames = trace.filter((r) => !r.waiting).map((r) => r.tool).filter(Boolean);
    assert.deepEqual(traceNames, ['list_loops','create_loop_draft','get_loop_draft','validate_loop_definition','save_loop_draft']);
  }
  } finally {
    messages.closeAllConnections();
    await new Promise((accept) => messages.close(accept));
  }
}

const providerFree = {
  schemaVersion: 4, name: 'Independent Claude loop draft',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual', inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } } } } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"independent-result Ω:" & trigger.payload.value' } },
  ],
  edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
};
const designSignature = 'End the design workflow at the draft.';
const inspectSignature = 'Summarise';
let loopId;
let runId, originalDraftToken;
const newDefinition = { ...providerFree, name: providerFree.name + ' revised' };
try {
  await inspectLoader(artifact);
  await inspectLoader(join(buildRoot, 'plugin', 'graphgoblin'));
  await nativeSession('draft create, validate and save', '/graphgoblin:design-loop create then refine the provider-free draft', designSignature, [
    { tool: 'list_loops', input: {}, check: (block) => assert(Array.isArray(resultJson(block).items)) },
    { tool: 'create_loop_draft', input: { definition: providerFree }, check: (block) => {
      const result = resultJson(block);
      assert.equal(result.draft.status, 'draft');
      assert.deepEqual(result.issues, []);
      loopId = result.loop.id;
    } },
    { tool: 'get_loop_draft', input: () => ({ loopId }), check: (block) => { originalDraftToken = resultJson(block).draftToken; assert.match(originalDraftToken, /^[0-9a-f]{16}$/); } },
    { tool: 'validate_loop_definition', input: () => ({ loopId, definition: newDefinition }), check: (block) => assert.equal(resultJson(block).publishable, true) },
    { tool: 'save_loop_draft', input: (body) => ({ loopId, definition: newDefinition, draftToken: resultJson(toolResult(body, 2)).draftToken }), check: (block) => assert.equal(resultJson(block).draft.definition.name, newDefinition.name) },
  ]);
  const detail = await (await fetch(api + '/loops/' + loopId, { headers })).json();
  assert.equal(detail.current, undefined);
  assert.equal(detail.draft.definition.name, newDefinition.name);
  const beforeRun = await (await fetch(api + '/runs?loopId=' + loopId, { headers })).json();
  assert.deepEqual(beforeRun.items, []);
  await nativeSession('draft opt-in omitted', '/graphgoblin:run-loop verify draft refusal without permission', 'Only start a run when the user explicitly requests one.', [{
    tool: 'start_run', input: { loopId, input: { value: 'fixture' } }, check: (block) => { assert.equal(block.is_error, true); assert.match(resultText(block), /LOOP_NOT_FOUND \(HTTP 404\).*no published version|VERSION_NOT_PUBLISHED/); },
  }]);
  assert.deepEqual((await (await fetch(api + '/runs?loopId=' + loopId, { headers })).json()).items, []);
  await nativeSession('explicit provider-free draft run', '/graphgoblin:run-loop run this unpublished draft (allowDraft is approved)', 'Only start a run when the user explicitly requests one.', [
    { tool: 'describe_loop', input: { loopId }, check: (block) => assert(resultJson(block).triggers.some((trigger) => trigger.startableFromMcp)) },
    { tool: 'start_run', input: { loopId, allowDraft: true, input: { value: 'literal dollars and é' } }, check: (block) => { runId = resultJson(block).runId; assert(runId); } },
    { tool: 'wait_for_run', input: () => ({ runId, timeoutSeconds: 10 }), check: (block) => {
      const result = resultJson(block);
      assert.equal(result.finished, true);
      assert.equal(result.run.result, 'independent-result Ω:literal dollars and é');
    } },
  ]);
  await nativeSession('inspect snapshot and events', '/graphgoblin:inspect-run ' + runId, inspectSignature, [
    { tool: 'get_run', input: { runId }, check: (block) => assert.equal(resultJson(block).result, 'independent-result Ω:literal dollars and é') },
    { tool: 'read_run_events', input: { runId }, check: (block) => {
      const events = resultJson(block).items;
      assert(events.some((event) => event.type === 'node.finished'));
      assert(events.some((event) => event.type === 'run.finished' && event.status === 'succeeded'));
      assert(events.some((event) => event.type === 'return.delivered'));
      assert.deepEqual(events.map(({seq})=>seq),events.map((_,i)=>i+1));
    } },
  ]);
  const afterRun = await (await fetch(api + '/runs?loopId=' + loopId, { headers })).json();
  assert.deepEqual(afterRun.items.map(({ id }) => id), [runId]);
  const inspected = await (await fetch(api + '/loops/' + loopId, { headers })).json();
  assert.equal(inspected.current, undefined);

  const failureStep = (tool, input, expected) => ({ tool, input, check: (block) => {
    assert.equal(block.is_error, true);
    assert.match(resultText(block), expected);
  } });
  await nativeSession('malformed and structurally invalid definitions', '/graphgoblin:design-loop check invalid definitions', designSignature, [
    failureStep('create_loop_draft', { definition: {} }, /VALIDATION_FAILED \(HTTP 400\)/),
    { tool: 'validate_loop_definition', input: { loopId, definition: { ...providerFree, edges: [] } }, check: (block) => assert.equal(resultJson(block).publishable, false) },
  ]);
  await nativeSession('stale draft save', '/graphgoblin:design-loop check obsolete draft edit', designSignature, [
    failureStep('save_loop_draft', { loopId, definition: providerFree, draftToken: originalDraftToken }, /DRAFT_CONFLICT \(HTTP 409\)/),
  ]);
  assert.notEqual(detail.draftToken, originalDraftToken);
  const stillCurrent = await (await fetch(api + '/loops/' + loopId, { headers })).json();
  assert.equal(stillCurrent.draft.definition.name, newDefinition.name);
  assert.equal(stillCurrent.draftToken, detail.draftToken);
  const { GG_API_KEY: _, ...withoutToken } = environment;
  for (const [scenario, flags, expected, tool, input] of [
    ['missing credentials', withoutToken, /UNAUTHORIZED \(HTTP 401\)/, 'get_loop_draft', { loopId }],
    ['invalid credentials', { ...environment, GG_API_KEY: 'independent-invalid-credential' }, /UNAUTHORIZED \(HTTP 401\)/, 'get_loop_draft', { loopId }],
    ['insufficient scope', { ...environment, GG_API_KEY: readerToken }, /FORBIDDEN \(HTTP 403\).*loops:write/, 'create_loop_draft', { definition: providerFree }],
    ['other owner', { ...environment, GG_API_KEY: otherToken }, /LOOP_NOT_FOUND/, 'get_loop_draft', { loopId }],
  ]) {
    await nativeSession(scenario, '/graphgoblin:design-loop check access', designSignature, [
      failureStep(tool, input, expected),
    ], flags);
  }

  const installed = join(config, 'skills', 'graphgoblin');
  await mkdir(dirname(installed));
  await cp(artifact, installed, { recursive: true });
  await inspectLoader(installed, true);
  await nativeSession('copied artifact inspection', '/graphgoblin:inspect-run ' + runId, inspectSignature, [
    { tool: 'get_run', input: { runId }, check: (block) => assert.equal(resultJson(block).id, runId) },
  ], environment, null);
  await rename(installed, join(scratch, 'retired plugin copy'));
  const removed = await command(claudeBinary, ['plugin', 'list', '--json'], environment);
  assert(!(JSON.parse(removed.stdout)).some(({ id }) => id === 'graphgoblin@skills-dir'));

  async function scanArtifact(root) {
    let scanned = 0;
    for (const item of await readdir(root, { withFileTypes: true })) {
      const file = join(root, item.name);
      if (item.isDirectory()) scanned += await scanArtifact(file);
      else {
        const bytes = await readFile(file);
        for (const secret of secrets) assert(!bytes.includes(Buffer.from(secret)), 'Generated artifact leaked synthetic credential');
        scanned++;
      }
    }
    return scanned;
  }
  const failedRuntimePath = join(scratch, 'missing runtime é', basename(configuredNode));
  const movedRuntime = await command(claudeBinary, ['--plugin-dir', artifact, 'mcp', 'list'], { ...environment, GG_NODE_BINARY: failedRuntimePath });
  assert(!/ \- Connected\b/.test(movedRuntime.stdout), movedRuntime.stdout);
  observations.push({ stage: 'moved Node path', exitCode: movedRuntime.code, report: movedRuntime.stdout.trim(), diagnostic: movedRuntime.stderr.trim() });
  const alternateNode = join(scratch, 'replacement runtime 漢', basename(configuredNode));
  await mkdir(dirname(alternateNode));
  await cp(configuredNode, alternateNode);
  const recoveredRuntime = await command(claudeBinary, ['--plugin-dir', artifact, 'mcp', 'list'], { ...environment, GG_NODE_BINARY: alternateNode });
  assert.match(recoveredRuntime.stdout, /plugin:graphgoblin:graphgoblin: .*Connected/);
  observations.push({ stage: 'replacement Node absolute path', status: 'connected' });
  const foreign = join(artifact, 'sentinel.txt');
  await writeFile(foreign, 'independent foreign sentinel');
  const refusedAssembly = await command(process.execPath, [join(buildRoot, 'cli.js'), '--out', artifact, '--mcp-entry', linkedMcp], environment);
  assert.equal(refusedAssembly.code, 1);
  assert.match(refusedAssembly.stderr, /not owned by this builder/);
  assert.equal(await readFile(foreign, 'utf8'), 'independent foreign sentinel');
  await rename(foreign, join(scratch, 'preserved foreign sentinel.txt'));
  const scannedFiles = await scanArtifact(artifact);
  const copiedFiles = await scanArtifact(join(scratch, 'retired plugin copy'));
  observations.push({ stage: 'artifact credential and ownership checks', scannedFiles, copiedFiles, refusedExtraFile: true });
  await rename(linkedMcp, join(scratch, 'relocated MCP'));
  const missingInClaude = await command(claudeBinary, ['--plugin-dir', artifact, 'mcp', 'list'], environment);
  assert(!/ \- Connected\b/.test(missingInClaude.stdout), missingInClaude.stdout);
  observations.push({ stage: 'moved MCP real loader', exitCode: missingInClaude.code, connection: missingInClaude.stdout.trim(), diagnostic: missingInClaude.stderr.trim() });
  const guard = await command(configuredNode, ['--require', join(artifact, 'check-runtime.cjs'), linkedMcp, '--draft-tools'], environment);
  assert.equal(guard.code, 1);
  assert.match(guard.stderr, /could not find its MCP entry.*pnpm build/);
  observations.push({ stage: 'moved MCP entry guard', exitCode: guard.code, diagnostic: guard.stderr.trim() });
  const rebuilt = await command(process.execPath, [join(buildRoot, 'cli.js'), '--out', artifact], environment);
  assert.equal(rebuilt.code, 0, rebuilt.stderr);
  await inspectLoader(artifact);
  assert.equal(await scanArtifact(artifact), scannedFiles);

  await gateway.app.close();
  await nativeSession('gateway unavailable', '/graphgoblin:design-loop find loops', designSignature, [
    failureStep('list_loops', {}, /NETWORK_ERROR \(HTTP 0\)/),
  ]);
  observations.push({ stage: 'verified REST state', loopId, runId, outcome: 'succeeded', draftPublished: false, totalRuns: 1, snapshotResult: 'independent-result Ω:literal dollars and é' });
} catch (error) {
  observations.push({ stage: 'QA assertion', message: String(error), stack: error.stack });
  throw error;
} finally {
  await gateway.app.close();
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' }).trim(), '');
  assert.equal(head(worktree), expected);
  const evidence = JSON.stringify({ versions: { claude: version.stdout.trim(), node: process.version }, platform: process.platform, worktree, head: head(worktree), apiWorktree, apiHead: head(apiWorktree), fingerprints, gateway: { origin: api, store: join(scratch, 'gateway'), ownedPid: process.pid }, commands, toolNames: [...allToolNames].sort(), observations }, null, 2);
  for (const secret of [token, readerToken, otherToken]) assert(!evidence.includes(secret));
  await writeFile(join(scratch, 'observed.json'), evidence);
  console.log(join(scratch, 'observed.json'));
}


