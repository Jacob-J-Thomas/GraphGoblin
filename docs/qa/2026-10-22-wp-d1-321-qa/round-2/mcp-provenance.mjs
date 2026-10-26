// Read-only MCP tool calls against the completed independent QA store in <repo>.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const runtime = JSON.parse(await fs.readFile(join(out, 'runtime.json'), 'utf8'));
const checks = JSON.parse(await fs.readFile(join(out, 'independent-results.json'), 'utf8')).checks;
const store = runtime.stores[0].store;
assert.match(store, /^gg-qa-321-r2-independent-[A-Za-z0-9]+$/);
const dir = join(tmpdir(), store);
const port = 5927;
const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(port, '127.0.0.1', () => listener.close(resolve));
});
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !k.toUpperCase().startsWith('GG_') &&
      !['JEV_API_KEY', 'NODE_V8_COVERAGE'].includes(k.toUpperCase()),
  ),
);
Object.assign(env, {
  GG_DATA_DIR: dir,
  GG_DB_URL: `file:${join(dir, 'graphgoblin.db')}`,
  GG_HOST: '127.0.0.1',
  GG_PORT: String(port),
  GG_REQUIRE_API_KEY: 'false',
  GG_JEV_API_KEY: '',
  GG_WEB_DIST: '',
  GG_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
  LIVE: '0',
});
const child = spawn(process.execPath, [join(repo, 'apps/api/dist/main.js')], {
  cwd: repo,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (b) => {
  log += b;
});
child.stderr.on('data', (b) => {
  log += b;
});
const exited = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', () => resolve());
});
let mcp, server;
try {
  const deadline = Date.now() + 60000;
  while (!log.includes('GraphGoblin API listening')) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('MCP QA API exited before readiness');
    if (Date.now() > deadline) throw new Error('MCP QA API readiness deadline');
    await new Promise((r) => setTimeout(r, 25));
  }
  const require = createRequire(join(repo, 'apps/mcp/package.json'));
  const { createMcpServer } = await import(pathToFileURL(join(repo, 'apps/mcp/dist/index.js')));
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const [a, b] = InMemoryTransport.createLinkedPair();
  server = createMcpServer({ apiUrl: `http://127.0.0.1:${port}` });
  mcp = new Client({ name: 'qa-321-provenance', version: '2' });
  await server.connect(a);
  await mcp.connect(b);
  const response = await mcp.callTool({ name: 'list_runs', arguments: { limit: 100 } });
  assert.notEqual(response.isError, true);
  const list = JSON.parse(response.content.find((c) => c.type === 'text').text);
  const scriptId = checks.find((c) => c.id === 'native-nonzero').actual.id;
  const ordinaryId = checks.find((c) => c.id === 'edge-non-script-failure').actual.id;
  const script = list.items.find((r) => r.id === scriptId),
    ordinary = list.items.find((r) => r.id === ordinaryId);
  assert.ok(script.failure.script.dispatchId);
  assert.equal(script.failure.script.state, 'completed');
  assert.equal(script.failure.script.exitCode, 7);
  assert.equal(script.failure.resumable, true);
  assert.equal('script' in ordinary.failure, false);
  assert.equal('resumable' in ordinary.failure, false);
  await fs.writeFile(
    join(out, 'mcp-provenance.json'),
    JSON.stringify(
      {
        head: runtime.head,
        status: 'PASS',
        steps:
          'Reopen completed independent store; call MCP list_runs through public SDK transport.',
        expected:
          'Script summaries carry provenance/resumability; ordinary failure summaries omit them.',
        actual: { script: script.failure, ordinary: ordinary.failure },
        port,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'PASS: MCP list_runs wire summaries retain script provenance only where applicable.\n',
  );
} finally {
  if (mcp) await mcp.close();
  if (server) await server.close();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
  const processExit = JSON.parse(await fs.readFile(join(out, 'process-exit.json'), 'utf8'));
  processExit.stores
    .find((s) => s.store === store)
    .apiProcesses.push({ pid: child.pid, exited: true, role: 'MCP summary wire probe', port });
  await fs.writeFile(join(out, 'process-exit.json'), JSON.stringify(processExit, null, 2) + '\n');
}
