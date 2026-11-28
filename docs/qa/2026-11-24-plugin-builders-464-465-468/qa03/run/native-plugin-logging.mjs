// Prepared QA03: supported Codex stderr logging only; untouched generated MCP configuration.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';

const evidence = dirname(fileURLToPath(import.meta.url));
const worktree = 'G:/ggq/gg-fu-plugin-builders-20261124/GraphGoblin';
const codex = 'G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin/node_modules/.pnpm/@openai+codex@0.160.0-win32-x64/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
const mcpEntry = join(worktree, 'apps/mcp/dist/main.js');
const scratch = mkdtempSync('G:/ggq/gg-native-464-log-');
const cwd = join(scratch, 'neutral workspace');
const codexHome = join(scratch, 'disposable Codex home');
const artifact = join(scratch, 'marketplace 漢 fixture');
for (const path of [cwd, codexHome]) mkdirSync(path);
const gitConfig = join(scratch, 'empty.gitconfig');
writeFileSync(gitConfig, '', {flag: 'wx'});
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const shaBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => String(value).replaceAll('\\', '/').toLowerCase();
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(key)));
const env = {
  ...inherited, HOME: codexHome, USERPROFILE: codexHome, CODEX_HOME: codexHome,
  APPDATA: codexHome, LOCALAPPDATA: codexHome, XDG_CONFIG_HOME: codexHome,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'protocol.http.allow', GIT_CONFIG_VALUE_0: 'never',
  GIT_CONFIG_KEY_1: 'protocol.https.allow', GIT_CONFIG_VALUE_1: 'never',
  GIT_CONFIG_KEY_2: 'protocol.ssh.allow', GIT_CONFIG_VALUE_2: 'never',
  GIT_CONFIG_KEY_3: 'protocol.file.allow', GIT_CONFIG_VALUE_3: 'always',
  HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
  ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
};
let phase = 'setup';
const phases = [], requests = [], commands = [];
const report = {
  mechanism: 'Codex built-in RUST_LOG/LOG_FORMAT JSON stderr; logical protocol diagnostics',
  scratch, nodeVersion: process.version, isolated: {codexHome, neutralCwd: cwd},
  exactMcpEntry: mcpEntry, mcpEntrySha256: sha(mcpEntry), phases, requests, commands,
  sourceOrGeneratedConfigModified: false, inferenceTurnRequests: 0,
  limits: ['Typed diagnostic events, not byte-for-byte MCP wire capture.',
    'Native child PID and OS exit are not observed; app-server exit and logical session closure are distinct.'],
  success: false,
};
function setPhase(value) {
  phase = value;
  phases.push({sequence: phases.length + 1, phase, utcMs: Date.now()});
}
function logs(label, stdout, stderr) {
  writeFileSync(join(evidence, label + '.stdout.log'), stdout, {flag: 'wx'});
  writeFileSync(join(evidence, label + '.stderr.log'), stderr, {flag: 'wx'});
  return {stdoutSha256: shaBytes(stdout), stderrSha256: shaBytes(stderr), stdoutBytes: stdout.length, stderrBytes: stderr.length};
}
function run(label, file, args) {
  setPhase('cli:' + label);
  const result = spawnSync(file, args, {cwd, env, windowsHide: true, timeout: 45000,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  commands.push({label, binary: basename(file), args, exitCode: result.status,
    error: result.error?.code ?? null, ...logs('native-' + label, stdout, stderr)});
  assert.equal(result.status, 0, label + ': ' + stderr.toString().slice(-600));
  return stdout.toString('utf8');
}
function inventory(directory) {
  const files = {};
  function walk(path, prefix = '') {
    for (const entry of readdirSync(path, {withFileTypes: true})) {
      const file = join(path, entry.name), relative = prefix + entry.name;
      assert.ok(!lstatSync(file).isSymbolicLink(), 'No fixture artifact symlink.');
      if (entry.isDirectory()) walk(file, relative + '/');
      else { assert.ok(entry.isFile()); files[relative] = {bytes: readFileSync(file).length, sha256: sha(file)}; }
    }
  }
  walk(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
const server = createServer((request, response) => {
  requests.push({sequence: requests.length + 1, phase, utcMs: Date.now(), method: request.method, url: request.url,
    responseStatus: request.method === 'GET' && request.url === '/runs?limit=20' ? 200 : 503});
  if (request.method === 'GET' && request.url === '/runs?limit=20')
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({items: [], nextCursor: null}));
  else response.writeHead(503).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert.ok(![4747, 4748, 7443, 11434].includes(port));
env.GG_API_URL = 'http://127.0.0.1:' + port;
report.fixture = {address: env.GG_API_URL, response: {status: 200, body: {items: [], nextCursor: null}}};

async function appServer(marketFile) {
  const settings = {
    RUST_LOG: 'warn,rmcp::service=trace,codex_rmcp_client::rmcp_client=trace,codex_mcp::rmcp_client=trace,codex_app_server::app_server_tracing=info',
    LOG_FORMAT: 'json',
  };
  report.builtInLogging = settings;
  const args = ['app-server', '--disable', 'remote_plugin', '--stdio'];
  setPhase('app-server:start');
  const child = spawn(codex, args, {cwd, env: {...env, ...settings}, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']});
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
  let startupError;
  child.on('error', error => { startupError = error; });
  child.stdin.on('error', error => { startupError ??= error; });
  const out = [], err = [], pending = new Map(), replies = {};
  child.stdout.on('data', chunk => out.push(chunk));
  child.stderr.on('data', chunk => err.push(chunk));
  readline.createInterface({input: child.stdout}).on('line', line => {
    try { const event = JSON.parse(line); pending.get(event.id)?.(event); } catch { /* raw stdout retained */ }
  });
  let next = 1;
  async function call(method, params) {
    setPhase('app-server:' + method);
    assert.ifError(startupError);
    const id = next++;
    const reply = new Promise(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({id, method, params}) + '\n');
    let timer;
    try {
      const answer = await Promise.race([reply, closed.then(() => { throw new Error('App-server closed before ' + method); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + method)), 15000); })]);
      replies[method] = answer;
      assert.equal(answer.error, undefined, JSON.stringify(answer.error));
      return answer.result;
    } finally { clearTimeout(timer); pending.delete(id); setPhase('app-server:idle'); }
  }
  try {
    await call('initialize', {clientInfo: {name: 'graphgoblin-native-qa03', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    child.stdin.write(JSON.stringify({method: 'initialized'}) + '\n');
    const {marketplaces} = await call('plugin/list', {cwds: [cwd], marketplaceKinds: ['local'], forceRefetch: false});
    const installed = marketplaces.flatMap(market => market.plugins).find(item => item.id === 'graphgoblin@graphgoblin-local');
    assert.ok(installed?.installed && installed?.enabled);
    report.installedAndEnabled = true;
    const {plugin} = await call('plugin/read', {marketplacePath: marketFile, pluginName: 'graphgoblin'});
    const skills = plugin.skills.map(item => item.name.split(':').at(-1)).sort();
    assert.deepEqual(skills, ['design-loop', 'inspect-run', 'run-loop']);
    assert.deepEqual(plugin.mcpServers, ['graphgoblin']);
    report.loadedMetadata = {skills, mcpServers: plugin.mcpServers};
    assert.equal(requests.length, 0, 'No gateway request before native MCP status discovery.');
    const {data} = await call('mcpServerStatus/list', {});
    assert.equal(data.length, 1, 'No unexplained additional MCP server.');
    const mcp = data.find(item => item.name === 'graphgoblin' && item.pluginId === installed.id);
    assert.ok(mcp?.serverInfo && !mcp.toolsError);
    assert.equal(Object.keys(mcp.tools ?? {}).length, 14);
    assert.deepEqual(mcp.resources, []);
    assert.deepEqual(mcp.resourceTemplates.map(item => item.uriTemplate).sort(),
      ['graphgoblin://runs/{id}/events', 'graphgoblin://runs/{id}/thread']);
    report.nativeDiscovery = {serverInfo: mcp.serverInfo, tools: Object.keys(mcp.tools).sort(),
      resources: mcp.resources, resourceTemplates: mcp.resourceTemplates};
  } finally {
    child.stdin.end();
    let timer, exit;
    try {
      exit = await Promise.race([closed, new Promise(resolve => {
        timer = setTimeout(() => { child.kill(); resolve({forcedStop: true}); }, 7000);
      })]);
      if (exit.forcedStop) await closed;
    } finally {
      clearTimeout(timer);
      report.appServer = {args, pid: child.pid, exit, methods: Object.keys(replies),
        ...logs('native-codex-app-server', Buffer.concat(out), Buffer.concat(err))};
      writeFileSync(join(evidence, 'native-codex-rpc.json'), JSON.stringify(replies, null, 2) + '\n', {flag: 'wx'});
    }
    assert.deepEqual(exit, {code: 0, signal: null});
  }
  return Buffer.concat(err).toString('utf8');
}

function logicalDiagnostics(stderr) {
  const decoded = [], invalidLines = [];
  for (const [i, line] of stderr.split('\n').entries()) {
    if (!line.trim()) continue;
    try { decoded.push({rawLine: i + 1, ...JSON.parse(line)}); }
    catch { invalidLines.push({rawLine: i + 1, text: line}); }
  }
  const service = decoded.filter(item => item.target === 'rmcp::service');
  const initialized = service.filter(item => item.fields?.message === 'Service initialized as client');
  const serverInitialized = service.filter(item => item.fields?.message === 'Service initialized as server');
  const names = item => [...new Set([item.span, ...(item.spans ?? [])].filter(Boolean)
    .map(span => span.server_name).filter(value => typeof value === 'string'))];
  const sessionNames = [...new Set(initialized.flatMap(names))];
  const events = service.filter(item => item.fields?.message === 'new event');
  const sent = [], received = [], unknownRequests = [], peerRequests = [], unparsedProtocolEvents = [];
  const methodOf = text => {
    for (const [variant, method] of [['ListResourceTemplatesRequest', 'resources/templates/list'],
      ['ListResourcesRequest', 'resources/list'], ['ListToolsRequest', 'tools/list'],
      ['CallToolRequest', 'tools/call'], ['PingRequest', 'ping']])
      if (text.includes(variant)) return method;
    return null;
  };
  const idOf = text => /\bid: Number\((-?\d+)\)/.exec(text)?.[1] ?? /\bid: String\("([^"]*)"\)/.exec(text)?.[1] ?? null;
  for (const event of events) {
    const text = event.fields?.evt;
    if (typeof text !== 'string') { unparsedProtocolEvents.push(event); continue; }
    if (/^ProxyMessage\(Request\s*\{/.test(text)) {
      const item = {id: idOf(text), method: methodOf(text), timestamp: event.timestamp,
        rawLine: event.rawLine, serverNames: names(event), diagnostic: text};
      sent.push(item);
      if (!item.method || item.id === null) unknownRequests.push(item);
    }
    if (/^PeerMessage\((?:Response|Error)\(/.test(text))
      received.push({id: idOf(text), timestamp: event.timestamp, rawLine: event.rawLine,
        serverNames: names(event), error: /^PeerMessage\(Error\(/.test(text), diagnostic: text});
    if (/^PeerMessage\(Request\(/.test(text)) peerRequests.push(event);
    if (!/^(?:ProxyMessage\((?:Request\s*\{|Notification\s*\{)|PeerMessage\((?:Response|Error|Request|Notification)\(|SendTaskResult\(|ResponseSendTaskResult\(|ToSink\()/.test(text))
      unparsedProtocolEvents.push(event);
  }
  const spanEvent = (item, name, action) => item.fields?.message === action && item.span?.name === name;
  const opened = decoded.filter(item => spanEvent(item, 'serve_inner', 'new'));
  const closed = decoded.filter(item => spanEvent(item, 'serve_inner', 'close'));
  const summary = {evidenceTier: 'built-in typed logical MCP diagnostic events, not raw wire bytes',
    invalidLines, initialized, serverInitialized, sessionNames, sessionSpansOpened: opened,
    sessionSpansClosed: closed, sent, received, unknownRequests, peerRequests, unparsedProtocolEvents,
    toolsCallCount: sent.filter(item => item.method === 'tools/call').length,
    decodedLogLines: decoded.length, serviceEventCount: events.length, calibrated: false,
    nativeChildPidObserved: false, nativeChildOsExitObserved: false};
  report.logicalProtocol = summary; // Always preserve actual partial evidence before assertions.
  assert.equal(invalidLines.length, 0, 'Unparsed native stderr cannot establish complete diagnostics.');
  assert.equal(initialized.length, 1, 'Exactly one successful MCP client initialization is required.');
  assert.equal(serverInitialized.length, 0);
  assert.match(String(initialized[0].fields?.peer_info), /graphgoblin/);
  assert.equal(sessionNames.length, 1, 'Initialization must identify one native server context.');
  assert.equal(opened.length, 1); assert.equal(closed.length, 1);
  assert.ok(events.length > 0 && sent.length >= 3, 'Missing TRACE events are not a quiet success.');
  assert.equal(unknownRequests.length, 0);
  assert.equal(peerRequests.length, 0, 'Unexpected server-initiated request.');
  assert.equal(unparsedProtocolEvents.length, 0, 'Uncalibrated event representation.');
  assert.equal(summary.toolsCallCount, 0);
  assert.ok(sent.every(item => item.serverNames.length === 1 && item.serverNames[0] === sessionNames[0]));
  assert.equal(new Set(sent.map(item => item.id)).size, sent.length, 'Duplicate request IDs or retries.');
  assert.equal(received.length, sent.length, 'Orphan or missing typed response.');
  assert.ok(received.every(item => item.id !== null && !item.error && sent.some(call => call.id === item.id)));
  for (const [method, result] of [['tools/list', 'ListToolsResult'],
    ['resources/templates/list', 'ListResourceTemplatesResult'], ['resources/list', 'ListResourcesResult']]) {
    const calls = sent.filter(item => item.method === method);
    assert.equal(calls.length, 1, 'Expected exactly one ' + method);
    const replies = received.filter(item => item.id === calls[0].id);
    assert.equal(replies.length, 1); assert.equal(replies[0].error, false);
    assert.ok(replies[0].diagnostic.includes(result), 'Expected typed successful ' + result);
    assert.deepEqual(replies[0].serverNames, [sessionNames[0]]);
  }
  const call = sent.find(item => item.method === 'resources/list');
  const response = received.find(item => item.id === call.id);
  assert.match(response.diagnostic, /resources:\s*\[\]/);
  const lower = Date.parse(call.timestamp), upper = Date.parse(response.timestamp);
  assert.ok(Number.isFinite(lower) && Number.isFinite(upper) && lower <= upper);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.deepEqual([request.method, request.url, request.phase], ['GET', '/runs?limit=20', 'app-server:mcpServerStatus/list']);
    assert.ok(request.utcMs >= lower && request.utcMs <= upper, 'GET falls outside the observed resource-list request/result interval.');
  }
  summary.resourcesListHttpMapping = {requestId: call.id, serverContext: sessionNames[0],
    requestTimestamp: call.timestamp, resultTimestamp: response.timestamp, gatewayRequestSequences: requests.map(item => item.sequence),
    qualification: 'Logical request/result interval plus sole native context and frozen callback source; no injected correlation header or child OS PID.'};
  for (const ping of sent.filter(item => item.method === 'ping'))
    assert.equal(received.filter(item => item.id === ping.id && !item.error).length, 1, 'Unanswered protocol ping.');
  assert.ok(sent.every(item => ['tools/list', 'resources/list', 'resources/templates/list', 'ping'].includes(item.method)));
  assert.ok(sent.length <= 8, 'Unexpected protocol traffic volume.');
  summary.calibrated = true;
}

try {
  assert.equal(process.version, 'v22.23.4');
  const prior = JSON.parse(readFileSync(join(evidence, 'BINDINGS.json'), 'utf8')).priorNativeIdentity;
  report.codexBinarySha256 = sha(codex);
  assert.equal(report.codexBinarySha256, prior.binarySha256);
  report.codexVersion = run('codex-version', codex, ['--version']).trim();
  assert.equal(report.codexVersion, 'codex-cli 0.160.0');
  run('assemble-codex', process.execPath, [join(worktree, 'apps/plugin-codex/dist/cli.js'),
    '--out', artifact, '--mcp-entry', mcpEntry]);
  const marketFile = join(artifact, '.agents/plugins/marketplace.json');
  const configFile = join(artifact, 'plugins/graphgoblin/.mcp.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  assert.equal(config.mcpServers.graphgoblin.command, 'node');
  assert.deepEqual(config.mcpServers.graphgoblin.env_vars, ['GG_API_URL', 'GG_API_KEY']);
  assert.equal(config.mcpServers.graphgoblin.env, undefined);
  assert.equal(canonical(config.mcpServers.graphgoblin.args[0]), canonical(mcpEntry));
  const before = inventory(artifact);
  report.artifact = {path: artifact, before, marketplaceSha256: sha(marketFile), mcpConfigSha256: sha(configFile)};
  assert.equal(report.artifact.marketplaceSha256, prior.artifact.marketplaceSha256);
  assert.equal(report.artifact.mcpConfigSha256, prior.artifact.mcpConfigSha256);
  run('marketplace-add', codex, ['plugin', 'marketplace', 'add', artifact, '--json']);
  const installed = JSON.parse(run('plugin-add', codex, ['plugin', 'add', 'graphgoblin@graphgoblin-local', '--json']));
  const installedPath = realpathSync(installed.installedPath), ownedHome = realpathSync(codexHome);
  assert.ok(installedPath.toLowerCase().startsWith((ownedHome + '\\').toLowerCase()));
  const installedConfig = join(installedPath, '.mcp.json');
  assert.equal(sha(installedConfig), sha(configFile));
  report.installedArtifact = {receipt: installed, path: installedPath, before: inventory(installedPath),
    configPath: installedConfig, mcpConfigSha256: sha(installedConfig)};
  const stderr = await appServer(marketFile);
  assert.deepEqual(report.nativeDiscovery.tools, prior.nativeStdioDiscovery.toolNames);
  report.artifact.after = inventory(artifact);
  assert.deepEqual(report.artifact.after, before);
  assert.equal(sha(installedConfig), report.installedArtifact.mcpConfigSha256);
  logicalDiagnostics(stderr);
  report.success = true;
} catch (error) {
  report.firstFailure = error.message;
} finally {
  // Retain diagnostics even when a preceding native assertion fails.
  const diagnosticFile = join(evidence, 'native-codex-app-server.stderr.log');
  try {
    if (!report.logicalProtocol && report.appServer) logicalDiagnostics(readFileSync(diagnosticFile, 'utf8'));
  } catch (error) { report.diagnosticCalibrationFailure = error.message; }
  try {
    if (report.artifact) {
      report.artifact.after = inventory(artifact);
      report.artifact.bytesUnchanged = JSON.stringify(report.artifact.before) === JSON.stringify(report.artifact.after);
      assert.equal(report.artifact.bytesUnchanged, true);
    }
    if (report.installedArtifact) {
      report.installedArtifact.after = inventory(report.installedArtifact.path);
      report.installedArtifact.bytesUnchanged = JSON.stringify(report.installedArtifact.before) === JSON.stringify(report.installedArtifact.after);
      assert.equal(report.installedArtifact.bytesUnchanged, true);
      report.installedArtifact.afterMcpConfigSha256 = sha(report.installedArtifact.configPath);
      assert.equal(report.installedArtifact.afterMcpConfigSha256, report.installedArtifact.mcpConfigSha256);
    }
  } catch (error) { report.immutabilityFailure = error.message; report.success = false; }
  setPhase('complete');
  await new Promise(resolve => server.close(resolve));
  report.fixtureClosed = true;
  writeFileSync(join(evidence, 'NATIVE-PLUGIN-RESULTS.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = report.success ? 0 : 1;
