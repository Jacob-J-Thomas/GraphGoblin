// Native Codex 0.160.0 + real GraphGoblin SDK adapter, with a disposable CODEX_HOME, local
// marketplace/MCP server and loopback Responses fixture. No owner config/auth or remote provider.
// Run after pnpm build: node docs/qa/2026-11-07-439-plugin-inheritance/scripts/native-plugins.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexHarness } from '../../../../packages/adapter-codex/dist/harness.js';
import { bundledCli, runCli } from '../../../../packages/adapter-codex/dist/cli.js';
import { CodexStructured } from '../../../../packages/adapter-codex/dist/structured.js';

const root = await mkdtemp(join(tmpdir(), 'gg-439-plugin-'));
const home = join(root, 'home');
const work = join(root, 'work');
const market = join(root, 'market');
const plugin = join(market, 'plugins', 'fixture');
const log = join(root, 'mcp.jsonl');
await Promise.all([
  mkdir(home),
  mkdir(work),
  mkdir(join(plugin, '.codex-plugin'), { recursive: true }),
  mkdir(join(market, '.agents', 'plugins'), { recursive: true }),
]);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(key),
  ),
);
Object.assign(env, {
  CODEX_HOME: home,
  HOME: home,
  USERPROFILE: home,
  APPDATA: home,
  LOCALAPPDATA: home,
});
const cli = bundledCli();
assert(cli, 'Pinned bundled CLI must be installed');
async function command(args) {
  const result = await runCli({ ...cli, cwd: work, env }, args, 30_000);
  assert.equal(result.code, 0, result.output);
  return result.stdout;
}
const version = (await command(['--version'])).trim();
await writeFile(
  join(plugin, '.codex-plugin', 'plugin.json'),
  JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    description: 'Disposable harmless availability fixture',
    author: { name: 'GraphGoblin QA' },
    mcpServers: './.mcp.json',
  }),
);
await writeFile(
  join(plugin, '.mcp.json'),
  JSON.stringify({
    mcpServers: {
      gg439_plugin: {
        command: process.execPath,
        args: [join(root, 'mcp.mjs'), log, 'plugin'],
        startup_timeout_sec: 10,
      },
    },
  }),
);
await writeFile(
  join(market, '.agents', 'plugins', 'marketplace.json'),
  JSON.stringify({
    name: 'gg439-local',
    plugins: [
      {
        name: 'fixture',
        source: { source: 'local', path: './plugins/fixture' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      },
    ],
  }),
);
await writeFile(
  join(root, 'mcp.mjs'),
  `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';
const [log, kind] = process.argv.slice(2);
const record = (event) => appendFileSync(log, JSON.stringify({ pid: process.pid, kind, event }) + '\\n');
record('started');
process.on('exit', () => record('exit'));
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result = {};
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'gg439-' + kind, version: '1.0.0' } };
  if (request.method === 'tools/list') { record('tools/list'); result = { tools: [{ name: 'echo_' + kind, description: 'Return a constant harmless fixture marker. No side effects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] }; }
  if (request.method === 'tools/call') { record('tools/call'); result = { content: [{ type: 'text', text: 'GG439_' + kind.toUpperCase() + '_OK' }] }; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
}
`,
);
await command(['plugin', 'marketplace', 'add', market]);
await command(['plugin', 'add', 'fixture@gg439-local']);
const installedConfig = await readFile(join(home, 'config.toml'), 'utf8');

const sse = (type, body) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;
let active;
const server = http.createServer(async (req, res) => {
  let bytes = '';
  for await (const chunk of req) bytes += chunk;
  if (req.method !== 'POST' || !req.url.endsWith('/responses')) {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.parse(bytes);
  active.requests.push(body);
  active.received?.();
  if (active.cancel) return; // Cancellation fixture holds the model request open.
  // MCP clients start concurrently. Give the controlled standalone client time to register before
  // the synthetic model immediately invokes code mode, rather than relying on human/model latency.
  if (active.requests.length === 1) await new Promise((resolve) => setTimeout(resolve, 300));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(sse('response.created', { response: { id: 'resp_gg439' } }));
  const item =
    active.requests.length === 1
      ? {
          type: 'custom_tool_call',
          id: 'tool_gg439',
          call_id: 'call_' + active.name,
          namespace: 'functions',
          name: 'exec',
          input:
            'const found = ALL_TOOLS.filter(t => /echo_(plugin|standalone)/.test(t.name)); text({ available: found.map(t => t.name).sort() }); for (const t of found) text(await tools[t.name]({}));',
        }
      : {
          type: 'message',
          role: 'assistant',
          id: 'msg_gg439',
          content: [{ type: 'output_text', text: active.structured ? '{"ok":true}' : 'GG439_OK' }],
        };
  res.write(sse('response.output_item.done', { item }));
  res.end(
    sse('response.completed', {
      response: {
        id: 'resp_gg439',
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      },
    }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await mkdir(join(work, '.codex'));
async function configure({ enabled = true, feature, profile = false, project = '' } = {}) {
  await writeFile(
    join(home, 'config.toml'),
    'model_provider="gg439"\n' +
      (profile ? 'profile="fixture_off"\n' : '') +
      installedConfig.replace('enabled = true', 'enabled = ' + enabled) +
      (feature === undefined ? '' : '\n[features]\nplugins=' + feature + '\n') +
      (profile ? '\n[profiles.fixture_off.features]\nplugins=false\n' : '') +
      '\n[model_providers.gg439]\nname="GraphGoblin local fixture"\nbase_url="http://127.0.0.1:' +
      port +
      '/v1"\nwire_api="responses"\nrequest_max_retries=0\nstream_max_retries=0\n' +
      '\n[projects.' +
      JSON.stringify(work) +
      ']\ntrust_level="trusted"\n' +
      '\n[mcp_servers.gg439_standalone]\ncommand=' +
      JSON.stringify(process.execPath) +
      '\nargs=' +
      JSON.stringify([join(root, 'mcp.mjs'), log, 'standalone']) +
      '\n',
  );
  await writeFile(join(work, '.codex', 'config.toml'), project);
}
const results = [];
const listings = [];
const harness = new CodexHarness({
  env,
  cliRunner: async (...args) => {
    const result = await runCli(...args);
    if (args[1][0] === 'mcp')
      listings.push({
        args: args[1],
        code: result.code,
        names: result.code === 0 ? JSON.parse(result.stdout).map((s) => s.name) : undefined,
      });
    return result;
  },
});
const records = async () =>
  (await readFile(log, 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
async function cleanupEvidence(before) {
  const pids = [
    ...new Set(
      (await records())
        .slice(before)
        .filter((e) => e.event === 'started')
        .map((e) => e.pid),
    ),
  ];
  if (!pids.length) return 0;
  const alive = () => {
    if (process.platform !== 'win32')
      return pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    // Windows rapidly reuses PIDs under parallel CI. Confirm command identity, not merely that
    // some process now owns a PID recorded by a previous fixture turn. Print PIDs only.
    const quoted = root.replaceAll("'", "''");
    const filter = pids.map((pid) => 'ProcessId = ' + pid).join(' OR ');
    const json = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "$fixturePath='" +
          quoted +
          "'; @(Get-CimInstance Win32_Process -Filter '" +
          filter +
          "' | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fixturePath) -and $_.CommandLine.Contains('mcp.mjs') } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress",
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    return json ? [JSON.parse(json)].flat() : [];
  };
  const deadline = Date.now() + 5000;
  let remaining = alive();
  while (remaining.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    remaining = alive();
  }
  assert.deepEqual(remaining, [], 'fixture MCP processes must end with the turn');
  return pids.length;
}
async function turn(
  name,
  {
    overrides = {},
    resumeId,
    expected = ['mcp__gg439_plugin__echo_plugin'],
    structured = false,
    cancel = false,
    failure,
  } = {},
) {
  active = { name, requests: [], structured, cancel };
  const received = new Promise((resolve) => {
    active.received = resolve;
  });
  const before = (await records()).length;
  const listingBefore = listings.length;
  const request = {
    workingDirectory: work,
    model: 'gpt-6-luna',
    effort: 'low',
    options: { sandbox: 'read-only', approval: 'never', configOverrides: overrides },
    turn: { prompt: 'Controlled local availability fixture. Reply GG439_OK.' },
  };
  const signal = AbortSignal.timeout(60_000);
  let id;
  let value;
  let error;
  try {
    if (structured)
      value = (
        await new CodexStructured(harness).complete(
          {
            workingDirectory: work,
            model: 'gpt-6-luna',
            effort: 'low',
            prompt: 'Controlled local structured fixture.',
            schema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
              additionalProperties: false,
            },
          },
          signal,
        )
      ).value;
    else {
      const session = resumeId
        ? harness.resume(resumeId, request, signal)
        : harness.start(request, signal);
      if (cancel) {
        await Promise.race([received, session.result]);
        await session.cancel();
      }
      value = (await session.result).finalText;
      id = await session.sessionId;
    }
  } catch (caught) {
    error = {
      code: typeof caught.code === 'string' ? caught.code : caught.name,
      message: caught.message,
      submission: caught.submission,
    };
  }
  const outputs =
    active.requests
      .at(-1)
      ?.input?.filter((i) => i.type === 'custom_tool_call_output' && i.call_id === 'call_' + name)
      .flatMap((i) => i.output.map((o) => o.text)) ?? [];
  const available = outputs
    .map((t) => {
      try {
        return JSON.parse(t).available;
      } catch {
        return undefined;
      }
    })
    .find(Array.isArray);
  if (failure || cancel) {
    assert.equal(error?.code, cancel ? 'AbortError' : failure);
    if (failure) {
      assert.equal(error.submission, 'definitely-not-submitted');
      assert.equal(active.requests.length, 0);
      assert.match(error.message, /could not list.*MCP servers.*turn did not start/);
    }
  } else {
    assert.equal(error, undefined, JSON.stringify(error));
    if (JSON.stringify(available) !== JSON.stringify(expected)) {
      await writeFile(join(root, 'failed-requests.json'), JSON.stringify(active.requests, null, 2));
      console.log('fixture-failed', root, JSON.stringify(outputs));
    }
    assert.deepEqual(available, expected);
    for (const tool of expected)
      assert(
        outputs.some((text) =>
          text.includes(tool.endsWith('echo_plugin') ? 'GG439_PLUGIN_OK' : 'GG439_STANDALONE_OK'),
        ),
        'available tool must execute successfully',
      );
    assert.equal(active.requests[0].model, 'gpt-6-luna');
    assert.equal(active.requests[0].reasoning.effort, 'low');
    if (structured) assert.deepEqual(value, { ok: true });
    else assert.equal(value, 'GG439_OK');
  }
  const pidsEnded = await cleanupEvidence(before);
  const fixtureEvents = (await records()).slice(before);
  if (cancel)
    assert(
      fixtureEvents.some((event) => event.kind === 'plugin' && event.event === 'tools/list'),
      'cancel after the plugin actually starts',
    );
  const entry = {
    name,
    pass: true,
    modelRequests: active.requests.length,
    available,
    workerOutput: outputs,
    value,
    error,
    listing: listings.slice(listingBefore),
    fixtureEvents,
    trackedProcessesEnded: pidsEnded,
  };
  results.push(entry);
  console.log(
    JSON.stringify({
      name,
      pass: true,
      available,
      error: error?.code,
      modelRequests: active.requests.length,
    }),
  );
  return id;
}
try {
  await configure();
  const fresh = await turn('enabled-inherited');
  await turn('enabled-resumed', { resumeId: fresh });
  await turn('enabled-structured', { structured: true });
  await turn('node-disabled', { overrides: { features: { plugins: false } }, expected: [] });
  await turn('standalone-explicit-enable', {
    overrides: { mcp_servers: { gg439_standalone: { enabled: true } } },
    expected: ['mcp__gg439_plugin__echo_plugin', 'mcp__gg439_standalone__echo_standalone'],
  });
  await configure({ enabled: false });
  await turn('individual-disabled', { expected: [] });
  await turn('feature-enable-keeps-individual-disabled', {
    overrides: { features: { plugins: true } },
    expected: [],
  });
  await configure({ feature: false });
  await turn('global-feature-disabled', { expected: [] });
  await turn('node-feature-enabled', { overrides: { features: { plugins: true } } });
  await configure({ profile: true });
  await turn('unsupported-legacy-profile-refused', { failure: 'HARNESS_TURN_FAILED' });
  await configure({ project: '[plugins."fixture@gg439-local"]\nenabled=false\n' });
  await turn('trusted-project-disabled', { expected: [] });
  await configure();
  await turn('cancel-with-plugin-started', { cancel: true });
  await configure({ enabled: '"invalid"' });
  await turn('invalid-plugin-config', { failure: 'HARNESS_TURN_FAILED' });
  await configure();
  await writeFile(
    join(home, 'config.toml'),
    (await readFile(join(home, 'config.toml'), 'utf8')) +
      '\n[plugins."missing@gg439-local"]\nenabled=true\n',
  );
  await turn('cli-limit-unknown-enabled-plugin-id');
  await configure();
  const cachedManifest = join(
    home,
    'plugins',
    'cache',
    'gg439-local',
    'fixture',
    '1.0.0',
    '.codex-plugin',
    'plugin.json',
  );
  const manifest = JSON.parse(await readFile(cachedManifest, 'utf8'));
  await writeFile(cachedManifest, JSON.stringify({ ...manifest, mcpServers: './missing.json' }));
  await turn('cli-limit-missing-plugin-mcp-file', { expected: [] });
  const summary = {
    version,
    node: process.version,
    platform: process.platform,
    fixtureRoot: root,
    remoteProviderCalls: 0,
    results,
    limitations: [
      'CLI 0.160.0 silently skips unknown plugin IDs and missing plugin MCP files. See README and follow-up #442; this is not accepted as a health check.',
    ],
  };
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native-result.json');
  await writeFile(out, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.length, evidence: out, fixtureRoot: root }));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
