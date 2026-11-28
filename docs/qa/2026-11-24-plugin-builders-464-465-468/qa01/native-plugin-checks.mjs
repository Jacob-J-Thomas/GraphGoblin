import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';

const evidence = dirname(fileURLToPath(import.meta.url));
const worktree = 'G:/ggq/gg-fu-plugin-builders-20261124/GraphGoblin';
const codex = 'G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin/node_modules/.pnpm/@openai+codex@0.160.0-win32-x64/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
const claude = 'C:/Users/98jak/.local/bin/claude.exe';
const scratch = mkdtempSync('G:/ggq/gg-native-464-');
const cwd = join(scratch, 'neutral workspace');
const codexHome = join(scratch, 'disposable Codex home');
const claudeHome = join(scratch, 'disposable Claude home');
const codexArtifact = join(scratch, 'marketplace 漢 fixture');
const claudeArtifact = join(scratch, 'Claude plugin é fixture');
for (const dir of [cwd, codexHome, claudeHome]) mkdirSync(dir);
const gitConfig = join(scratch, 'empty.gitconfig');
writeFileSync(gitConfig, '');
const results = [];
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const canonical = (value) => String(value).replaceAll('\\', '/').toLowerCase();
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(key)));
const home = (dir) => ({
  ...inherited, HOME: dir, USERPROFILE: dir, APPDATA: dir, LOCALAPPDATA: dir, XDG_CONFIG_HOME: dir,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'protocol.http.allow', GIT_CONFIG_VALUE_0: 'never',
  GIT_CONFIG_KEY_1: 'protocol.https.allow', GIT_CONFIG_VALUE_1: 'never',
  GIT_CONFIG_KEY_2: 'protocol.ssh.allow', GIT_CONFIG_VALUE_2: 'never',
  GIT_CONFIG_KEY_3: 'protocol.file.allow', GIT_CONFIG_VALUE_3: 'always',
  HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
  ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
});
const mcpEntry = join(worktree, 'apps/mcp/dist/main.js');
const shaOutput = (bytes) => createHash('sha256').update(bytes).digest('hex');
const logs = (id, stdout, stderr) => {
  writeFileSync(join(evidence, 'native-' + id + '.stdout.log'), stdout, {flag: 'wx'});
  writeFileSync(join(evidence, 'native-' + id + '.stderr.log'), stderr, {flag: 'wx'});
  return {stdoutSha256: shaOutput(stdout), stderrSha256: shaOutput(stderr)};
};

function run(label, file, args, env) {
  const run = spawnSync(file, args, {
    cwd, env, windowsHide: true, timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = run.stdout ?? Buffer.alloc(0);
  const stderr = run.stderr ?? Buffer.alloc(0);
  results.push({
    label, binary: basename(file), args, exitCode: run.status, signal: run.signal,
    error: run.error?.code ?? null, ...logs(label, stdout, stderr),
  });
  if (run.status !== 0) throw new Error(label + ' exited ' + run.status + ': ' + stderr.toString().slice(-600));
  return stdout.toString('utf8');
}

const requests = [];
const server = createServer((req, res) => {
  requests.push({method: req.method, url: req.url});
  res.writeHead(503).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert(![11434, 4747, 4748, 7443].includes(port));
const codexEnv = {...home(codexHome), CODEX_HOME: codexHome, GG_API_URL: 'http://127.0.0.1:' + port};
const claudeEnv = {
  ...home(claudeHome), CLAUDE_CONFIG_DIR: claudeHome, DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
};
const report = {
  scratch, nodeVersion: process.version, isolated: {codexHome, claudeHome, neutralCwd: cwd},
  fixtureGateway: codexEnv.GG_API_URL, fixtureGatewayRequests: requests,
  exactMcpEntry: mcpEntry, commandReceipts: results, codex: {}, claude: {},
};

async function codexNative() {
  report.codex.binarySha256 = sha(codex);
  report.codex.version = run('codex-version', codex, ['--version'], codexEnv).trim();
  run('assemble-codex', process.execPath, [
    join(worktree, 'apps/plugin-codex/dist/cli.js'), '--out', codexArtifact, '--mcp-entry', mcpEntry,
  ], home(codexHome));
  const marketFile = join(codexArtifact, '.agents/plugins/marketplace.json');
  const configFile = join(codexArtifact, 'plugins/graphgoblin/.mcp.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  assert.equal(canonical(config.mcpServers.graphgoblin.args[0]), canonical(mcpEntry));
  report.codex.artifact = {marketplaceSha256: sha(marketFile), mcpConfigSha256: sha(configFile)};
  run('marketplace-add', codex, ['plugin', 'marketplace', 'add', codexArtifact, '--json'], codexEnv);
  run('plugin-add', codex, ['plugin', 'add', 'graphgoblin@graphgoblin-local', '--json'], codexEnv);

  const args = ['app-server', '--disable', 'remote_plugin', '--stdio'];
  const child = spawn(codex, args, {cwd, env: codexEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({code, signal})));
  let startupError;
  child.on('error', (error) => { startupError = error; });
  child.stdin.on('error', (error) => { startupError ??= error; });
  const out = [], err = [], pending = new Map();
  const replies = {};
  child.stdout.on('data', (chunk) => out.push(chunk));
  child.stderr.on('data', (chunk) => err.push(chunk));
  readline.createInterface({input: child.stdout}).on('line', (line) => {
    try {
      const event = JSON.parse(line);
      pending.get(event.id)?.(event);
    } catch {
      // Retained in raw stdout.
    }
  });
  let next = 1;
  async function call(method, params) {
    assert.ifError(startupError);
    const id = next++;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({id, method, params}) + '\n');
    let timer;
    try {
      const answer = await Promise.race([
        reply, closed.then(() => { throw new Error('App-server closed before ' + method); }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + method)), 15000); }),
      ]);
      replies[method] = answer;
      assert.equal(answer.error, undefined, JSON.stringify(answer.error));
      return answer.result;
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  }
  try {
    await call('initialize', {clientInfo: {name: 'graphgoblin-native-qa', version: '1.0.0'}, capabilities: {experimentalApi: true}});
    child.stdin.write(JSON.stringify({method: 'initialized'}) + '\n');
    const {marketplaces} = await call('plugin/list', {cwds: [cwd], marketplaceKinds: ['local'], forceRefetch: false});
    const installed = marketplaces.flatMap((market) => market.plugins).find(({id}) => id === 'graphgoblin@graphgoblin-local');
    assert.ok(installed?.installed && installed?.enabled);
    report.codex.installedAndEnabled = true;
    const {plugin} = await call('plugin/read', {marketplacePath: marketFile, pluginName: 'graphgoblin'});
    const skills = plugin.skills.map(({name}) => name.split(':').at(-1)).sort();
    assert.deepEqual(skills, ['design-loop', 'inspect-run', 'run-loop']);
    assert.ok(plugin.mcpServers.includes('graphgoblin'));
    report.codex.loadedMetadata = {skills, mcpServers: plugin.mcpServers};
    const {data} = await call('mcpServerStatus/list', {});
    const mcp = data.find(({name, pluginId}) => name === 'graphgoblin' && pluginId === installed.id);
    assert.ok(mcp?.serverInfo && Object.keys(mcp.tools ?? {}).length > 0 && !mcp.toolsError);
    report.codex.nativeStdioDiscovery = {serverInfo: mcp.serverInfo, toolNames: Object.keys(mcp.tools).sort()};
  } finally {
    child.stdin.end();
    let timer;
    let exit;
    try {
      exit = await Promise.race([closed, new Promise((resolve) => {
        timer = setTimeout(() => { child.kill(); resolve({forcedStop: true}); }, 7000);
      })]);
      if (exit.forcedStop) await closed;
    } finally {
      clearTimeout(timer);
      report.codex.appServer = {
        args, exit, methodsObserved: Object.keys(replies),
        ...logs('codex-app-server', Buffer.concat(out), Buffer.concat(err)),
      };
      writeFileSync(join(evidence, 'native-codex-rpc.json'), JSON.stringify(replies, null, 2) + '\n', {flag: 'wx'});
    }
  }
  assert.deepEqual(requests, [], 'Metadata discovery should not call the local gateway');
}

function claudeNative() {
  report.claude.binarySha256 = sha(claude);
  report.claude.version = run('claude-version', claude, ['--version'], claudeEnv).trim();
  run('assemble-claude', process.execPath, [
    join(worktree, 'apps/plugin-claude/dist/cli.js'), '--out', claudeArtifact, '--mcp-entry', mcpEntry,
  ], home(claudeHome));
  const validation = JSON.parse(run(
    'claude-validate', claude, ['plugin', 'validate', '--strict', '--json', claudeArtifact], claudeEnv,
  ));
  assert.equal(validation.success, true);
  report.claude.strictValidated = true;
  report.claude.artifact = {
    manifestSha256: sha(join(claudeArtifact, '.claude-plugin/plugin.json')),
    mcpConfigSha256: sha(join(claudeArtifact, '.mcp.json')),
  };
}

try {
  try { await codexNative(); } catch (error) { report.codex.failure = error.message; }
  try { claudeNative(); } catch (error) { report.claude.failure = error.message; }
} finally {
  await new Promise((resolve) => server.close(resolve));
  writeFileSync(join(evidence, 'NATIVE-PLUGIN-RESULTS.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = report.codex.failure || report.claude.failure ? 1 : 0;

