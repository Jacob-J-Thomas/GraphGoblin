// Independent QA collector. Built API + repository no-turn native fixtures only.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { minimalLoop } from '../../../packages/contracts/dist/testing/index.js';
import { createRequire } from 'node:module';
import { cliFailureState } from '../../../packages/domain/dist/readiness.js';
import { preflightCli, runCli } from '../../../packages/adapter-codex/dist/cli.js';

const root = process.cwd();
const evidence = resolve('docs/qa/2026-10-20-wp-f1-qa');
const temp = join(tmpdir(), readFileSync(join(evidence, 'temp-root.txt'), 'utf8').trim());
const children = new Set();
const results = [];
let token;
export const url = 'http://127.0.0.1:5810';
const env = {
  ...process.env,
  GG_DATA_DIR: join(temp, 'store'),
  GG_PORT: '5810',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'true',
  GG_WEB_DIST: resolve('apps/web/dist'),
  GG_CLAUDE_BINARY: join(temp, 'claude/claude.exe'),
  GG_CODEX_BINARY: join(temp, 'codex/codex.exe'),
  GG_DEFAULTS: JSON.stringify({
    byHarness: {
      codex: { model: 'gpt-6-luna', effort: 'high' },
      claude: { model: 'claude-opus-5-5', effort: 'high' },
    },
  }),
};
export function scenario(h, s) {
  writeFileSync(join(temp, h, 'scenario.txt'), s);
}
function probes() {
  return Object.fromEntries(
    ['claude', 'codex'].map((h) => [
      h,
      existsSync(join(temp, h, 'probes.log'))
        ? readFileSync(join(temp, h, 'probes.log'), 'utf8')
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
        : [],
    ]),
  );
}
function delta(a, b) {
  return Object.fromEntries(['claude', 'codex'].map((h) => [h, b[h].slice(a[h].length)]));
}
export function record(name, expected, actual, pass) {
  results.push({ name, expected, actual, pass });
  writeFileSync(
    join(
      evidence,
      process.env.QA_READY_ONLY === '1'
        ? 'ready-admission.json'
        : process.env.QA_OWNER_ONLY === '1'
          ? 'owner-followup.json'
          : process.env.QA_PUBLISH_ONLY === '1'
            ? 'publish.json'
            : process.env.QA_FOCUS_ONLY === '1'
              ? 'browser-focus.json'
              : process.env.QA_ONLY_BROWSER === '1'
                ? 'browser.json'
                : 'runtime.json',
    ),
    JSON.stringify(results, null, 2),
  );
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
}
export async function request(path, method = 'GET', body) {
  const before = probes(),
    start = performance.now();
  const r = await fetch(url + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: r.status,
    ms: Math.round(performance.now() - start),
    body: data,
    probes: delta(before, probes()),
  };
}
export function definition(harness = 'claude', mixed = false) {
  const d = minimalLoop();
  d.name = `QA ${harness} ${Date.now()}`;
  const nodes = [harness, ...(mixed ? ['codex', harness] : [harness])].map((h, i) => ({
    id: `infer${i}`,
    kind: 'inference',
    label: `Work ${i}`,
    ui: { x: 260 * (i + 1), y: 80 },
    config: {
      harness: h,
      model: h === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
      effort: 'high',
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template: 'No provider turn' },
    },
  }));
  d.nodes = [d.nodes[0], ...nodes, d.nodes[1]];
  d.edges = d.nodes.slice(0, -1).map((n, i) => ({
    id: `e${i}`,
    from: { node: n.id, port: 'out' },
    to: { node: d.nodes[i + 1].id },
  }));
  return d;
}
async function start() {
  const p = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(p);
  writeFileSync(join(temp, 'api-pid.txt'), String(p.pid));
  let log = '';
  p.stdout.on('data', (b) => {
    log += b;
  });
  p.stderr.on('data', (b) => {
    log += b;
  });
  p.on('exit', () => children.delete(p));
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(url + '/healthz')).ok) return p;
    } catch {}
    if (p.exitCode !== null) throw Error('API startup failed: ' + log);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('API startup timed out');
}
async function stop(p) {
  const start = performance.now();
  p.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => p.once('exit', r)),
    new Promise((r) => setTimeout(r, 12000)),
  ]);
  return {
    ms: Math.round(performance.now() - start),
    exit: p.exitCode,
    signal: p.signalCode,
    stopped: !children.has(p),
  };
}
async function main() {
  scenario('claude', 'ready');
  scenario('codex', 'ready');
  if (process.env.QA_OWNER_ONLY === '1') {
    env.PATH = [join(temp, 'claude'), join(temp, 'codex'), env.PATH].join(';');
    env.GG_CLAUDE_BINARY = 'claude.exe';
    env.GG_CODEX_BINARY = 'codex.exe';
  }
  mkdirSync(env.GG_DATA_DIR, { recursive: true });
  const keyOut = execFileSync(
    process.execPath,
    ['apps/api/dist/main.js', '--create-api-key', 'qa'],
    { cwd: root, env, encoding: 'utf8', windowsHide: true },
  );
  token = /\bgg_[A-Za-z0-9_-]+/.exec(keyOut)?.[0];
  if (!token) throw Error('Key creation output did not contain token');
  let api = await start();
  let mcp;
  try {
    if (process.env.QA_OWNER_ONLY === '1') {
      const r = await request('/harness/preflight');
      record(
        'README PATH and bare executable overrides',
        'both ready through prepended PATH and explicit bare names',
        r,
        r.body.items.every((x) => x.state === 'ready'),
      );
      const { ownerChecks } = await import('./owner.mjs');
      await ownerChecks({
        url,
        token,
        request,
        scenario,
        record,
        evidence,
        missing: async () => {
          await stop(api);
          env.GG_CLAUDE_BINARY = join(temp, 'missing-claude.exe');
          env.GG_CODEX_BINARY = join(temp, 'missing-codex.exe');
          api = await start();
        },
      });
      return;
    }
    if (process.env.QA_PUBLISH_ONLY === '1') {
      scenario('claude', 'hang');
      scenario('codex', 'hang');
      for (const kind of ['starter', 'implementation', 'review', 'qa']) {
        const r = await request(`/templates/${kind}/draft`, 'POST', {
          name: `QA template ${kind} ${Date.now()}`,
        });
        record(
          'hung template: ' + kind,
          '201; zero probes; no CLI wait',
          r,
          r.status === 201 && Object.values(r.probes).every((x) => x.length === 0) && r.ms < 3000,
        );
      }
      scenario('claude', 'ready');
      const timeout = await request('/harness/preflight');
      record(
        'Codex-only hang deadline',
        'Codex unknown after 15-second deadline; Claude ready',
        timeout,
        timeout.ms >= 15000 &&
          timeout.ms < 20000 &&
          timeout.body.items.find((x) => x.harness === 'codex').state === 'unknown' &&
          timeout.body.items.find((x) => x.harness === 'claude').state === 'ready',
      );
      for (const [s, state] of Object.entries({
        ready: 'ready',
        auth: 'auth',
        old: 'cli-incompatible',
        'missing-model': 'cli-incompatible',
        'missing-effort': 'cli-incompatible',
        quota: 'quota',
        transport: 'transport',
        unknown: 'unknown',
        hang: 'unknown',
      })) {
        scenario('claude', s);
        scenario('codex', s);
        const d = definition('claude', true);
        const c = await request('/loops', 'POST', { definition: d });
        const r = await request(`/loops/${c.body.loop.id}/publish`, 'POST', {});
        const codes = (r.body.errors ?? r.body.issues ?? [])
          .filter((x) => x.code?.startsWith('HARNESS_READINESS_'))
          .map((x) => x.code);
        const count = Object.values(r.probes).every(
          (x) => x.filter((line) => line.split(' ').includes('--version')).length === 1,
        );
        record(
          s + ': publish valid draft',
          { state, oneProbePerHarness: true },
          r,
          s === 'ready'
            ? r.status === 200 && count
            : r.status === 422 &&
                codes.length === 3 &&
                codes.every(
                  (x) => x === `HARNESS_READINESS_${state.toUpperCase().replaceAll('-', '_')}`,
                ) &&
                count,
        );
      }
      await stop(api);
      env.GG_CLAUDE_BINARY = join(temp, 'missing-claude.exe');
      env.GG_CODEX_BINARY = join(temp, 'missing-codex.exe');
      api = await start();
      const c = await request('/loops', 'POST', { definition: definition('claude', true) });
      const r = await request(`/loops/${c.body.loop.id}/publish`, 'POST', {});
      record(
        'missing CLI: publish valid draft',
        '422 CLI_MISSING readiness issues',
        r,
        r.status === 422 && JSON.stringify(r.body).includes('HARNESS_READINESS_CLI_MISSING'),
      );
      return;
    }
    if (process.env.QA_ONLY_BROWSER === '1') {
      const { browserChecks } = await import(
        process.env.QA_FOCUS_ONLY === '1' ? './focus.mjs' : './browser.mjs'
      );
      await browserChecks({ url, token, request, scenario, definition, record, evidence, temp });
      return;
    }
    const d = definition('claude', true),
      created = await request('/loops', 'POST', { definition: d });
    record('initial mixed draft', 201, created, created.status === 201);
    const id = created.body.loop.id;
    const initialPublish = await request(`/loops/${id}/publish`, 'POST', {});
    record('ready publication', 200, initialPublish, initialPublish.status === 200);
    const require = createRequire(resolve('apps/mcp/package.json'));
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    mcp = new Client({ name: 'independent-qa', version: '1.0.0' });
    await mcp.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['apps/mcp/dist/main.js'],
        cwd: root,
        env: { ...env, GG_API_URL: url, GG_API_KEY: token },
        stderr: 'pipe',
      }),
    );
    if (process.env.QA_READY_ONLY === '1') {
      const settle = async (runId) => {
        for (let i = 0; i < 100; i++) {
          const r = await request(`/runs/${runId}`);
          if (['failed', 'succeeded', 'cancelled'].includes(r.body.status)) return r.body;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw Error('Fixture refusal did not settle');
      };
      let before = probes();
      const admitted = await request(`/loops/${id}/runs`, 'POST', { input: null });
      record(
        'ready: API run admitted',
        '202; fake CLI cannot accept a provider turn',
        admitted,
        admitted.status === 202,
      );
      const finished = await settle(admitted.body.run.id);
      record(
        'ready: API fixture refuses execution',
        'failed after fixture refusal; no provider turn',
        { status: finished.status, failure: finished.failure, probes: delta(before, probes()) },
        finished.status === 'failed',
      );
      before = probes();
      const result = await mcp.callTool({
        name: 'start_run',
        arguments: { loopId: id, input: null },
      });
      const value = result.structuredContent ?? JSON.parse(result.content[0].text);
      record(
        'ready: MCP run admitted',
        'runId, no MCP error',
        result,
        result.isError !== true && typeof value.runId === 'string',
      );
      const finishedMcp = await settle(value.runId);
      record(
        'ready: MCP fixture refuses execution',
        'failed after fixture refusal; no provider turn',
        {
          status: finishedMcp.status,
          failure: finishedMcp.failure,
          probes: delta(before, probes()),
        },
        finishedMcp.status === 'failed',
      );
      return;
    }
    const states = {
      ready: 'ready',
      auth: 'auth',
      old: 'cli-incompatible',
      'missing-model': 'cli-incompatible',
      'missing-effort': 'cli-incompatible',
      quota: 'quota',
      transport: 'transport',
      unknown: 'unknown',
      hang: 'unknown',
    };
    for (const [s, state] of Object.entries(states)) {
      scenario('claude', s);
      scenario('codex', s);
      for (const [op, path, method, body] of [
        ['harness', '/harness/preflight', 'GET'],
        ['system', '/system/preflight', 'GET'],
        ['validate', `/loops/${id}/validate`, 'POST', { definition: d }],
        ['publish', `/loops/${id}/publish`, 'POST', {}],
        ...(s === 'ready' ? [] : [['run', `/loops/${id}/runs`, 'POST', {}]]),
      ]) {
        const r = await request(path, method, body);
        const got =
          op === 'harness'
            ? r.body.items.map((x) => x.state)
            : op === 'system'
              ? r.body.checks.filter((x) => x.id.startsWith('harness.')).map((x) => x.state)
              : op === 'run'
                ? [r.body.code]
                : r.body.issues
                    ?.filter((x) => x.code.startsWith('HARNESS_READINESS_'))
                    .map((x) => x.code);
        const count = Object.values(r.probes).every(
          (lines) => lines.filter((x) => x.split(' ').includes('--version')).length === 1,
        );
        const pass =
          op === 'run'
            ? r.status === 422 && r.body.code === 'HARNESS_NOT_READY' && count
            : op === 'harness' || op === 'system'
              ? got.length === 2 && got.every((x) => x === state) && count
              : s === 'ready'
                ? r.status === 200 && count
                : got?.length > 0 &&
                  got.every(
                    (x) => x === `HARNESS_READINESS_${state.toUpperCase().replaceAll('-', '_')}`,
                  ) &&
                  count;
        record(`${s}: ${op}`, { state, oneProbePerHarness: true }, r, !!pass);
      }
      if (s !== 'ready') {
        const before = probes(),
          start = performance.now();
        const r = await mcp.callTool({ name: 'start_run', arguments: { loopId: id } });
        const text = r.content.map((c) => c.text ?? '').join('');
        const calls = delta(before, probes());
        record(
          `${s}: MCP run`,
          'HARNESS_NOT_READY HTTP 422; one probe each; no turn',
          { result: r, ms: Math.round(performance.now() - start), probes: calls },
          r.isError === true &&
            text.includes('HARNESS_NOT_READY (HTTP 422)') &&
            Object.values(calls).every(
              (x) => x.filter((line) => line.split(' ').includes('--version')).length === 1,
            ),
        );
      }
    }
    scenario('claude', 'hang');
    scenario('codex', 'ready');
    const before = probes(),
      pending = request('/harness/preflight');
    await new Promise((r) => setTimeout(r, 1500));
    const concurrent = delta(before, probes());
    record(
      'hung Claude concurrent Codex completion',
      'Codex login status invoked before Claude timeout',
      concurrent,
      concurrent.codex.includes('login status'),
    );
    await pending;
    scenario('codex', 'hang');
    const draft = definition('codex');
    const c = await request('/loops', 'POST', { definition: draft });
    record(
      'hung drafts: create',
      '201; zero probes; no CLI wait',
      c,
      c.status === 201 && Object.values(c.probes).every((x) => x.length === 0) && c.ms < 3000,
    );
    const saved = await request(`/loops/${c.body.loop.id}/draft`, 'PUT', { definition: draft });
    record(
      'hung drafts: save',
      '200; zero probes; no CLI wait',
      saved,
      saved.status === 200 &&
        Object.values(saved.probes).every((x) => x.length === 0) &&
        saved.ms < 3000,
    );
    const imported = await request('/loops/import', 'POST', {
      format: 'graphgoblin-loop',
      formatVersion: draft.schemaVersion,
      exportedAt: new Date().toISOString(),
      loop: draft,
    });
    record(
      'hung drafts: import',
      '201; zero probes; no CLI wait',
      imported,
      imported.status === 201 &&
        Object.values(imported.probes).every((x) => x.length === 0) &&
        imported.ms < 3000,
    );
    const templates = await request('/templates');
    const templateId = templates.body.items[0].manifest.id;
    const templated = await request(`/templates/${templateId}/draft`, 'POST', {});
    record(
      'hung drafts: template',
      '201; zero probes; no CLI wait',
      templated,
      templated.status === 201 &&
        Object.values(templated.probes).every((x) => x.length === 0) &&
        templated.ms < 3000,
    );
    const validate = await request(`/loops/${c.body.loop.id}/validate`, 'POST', {
      definition: draft,
    });
    record(
      'hung drafts: explicit validation',
      'one Codex probe',
      validate,
      validate.probes.codex.filter((x) => x === '--version').length === 1,
    );
    scenario('claude', 'ready');
    scenario('codex', 'ready');
    await request('/model-catalog/claude/claude-opus-5-5', 'PATCH', { enabled: false });
    const disabled = await request('/loops', 'POST', { definition: definition() });
    record(
      'disabled catalog draft',
      'MODEL_DISABLED; no probes',
      disabled,
      JSON.stringify(disabled.body).includes('MODEL_DISABLED') &&
        Object.values(disabled.probes).every((x) => x.length === 0),
    );
    const disabledValidation = await request(`/loops/${disabled.body.loop.id}/validate`, 'POST', {
      definition: disabled.body.draft.definition,
    });
    record(
      'disabled catalog validation',
      'MODEL_DISABLED',
      disabledValidation,
      JSON.stringify(disabledValidation.body).includes('MODEL_DISABLED'),
    );
    const disabledPublish = await request(`/loops/${disabled.body.loop.id}/publish`, 'POST', {});
    record(
      'disabled catalog publication',
      '422 MODEL_DISABLED',
      disabledPublish,
      disabledPublish.status === 422 &&
        JSON.stringify(disabledPublish.body).includes('MODEL_DISABLED'),
    );
    await request('/model-catalog/claude/claude-opus-5-5', 'PATCH', { enabled: true });
    const removed = definition();
    removed.nodes.find((n) => n.id === 'infer0').config.model = 'removed-model';
    const missing = await request('/loops', 'POST', { definition: removed });
    record(
      'removed catalog draft',
      '400 MODEL_NOT_IN_CATALOG; no probes',
      missing,
      missing.status === 400 &&
        JSON.stringify(missing.body).includes('MODEL_NOT_IN_CATALOG') &&
        Object.values(missing.probes).every((x) => x.length === 0),
    );
    const removedValidation = await request(`/loops/${id}/validate`, 'POST', {
      definition: removed,
    });
    record(
      'removed catalog validation',
      'MODEL_NOT_IN_CATALOG',
      removedValidation,
      JSON.stringify(removedValidation.body).includes('MODEL_NOT_IN_CATALOG'),
    );
    const del = await request('/model-catalog/claude/claude-opus-5-5', 'DELETE');
    record(
      'harness catalog deletion prohibited',
      'MODEL_MANAGED_BY_HARNESS',
      del,
      JSON.stringify(del.body).includes('MODEL_MANAGED_BY_HARNESS'),
    );
    const syntax = [
      "error: unknown option '--network-access'",
      "error: unexpected argument '--network' found",
      'Failed to connect to authentication server: ECONNREFUSED',
      'API Error: 500 Internal server error',
      'stream disconnected before completion: authentication token refresh timed out',
    ];
    const classified = syntax.map((text) => ({ text, state: cliFailureState(text) }));
    record(
      'CLI diagnostic precedence',
      'syntax incompatible; connection and HTTP 500 transport',
      classified,
      classified.every((x, i) => x.state === (i < 2 ? 'cli-incompatible' : 'transport')),
    );
    for (const s of ['prerelease', 'missing-resume-json']) {
      const r = await preflightCli(
        {
          command: process.execPath,
          prefix: [resolve('packages/adapter-codex/src/fixtures/readiness-cli.mjs'), s],
        },
        runCli,
        15000,
      );
      record(
        'package Codex ' + s,
        s === 'prerelease' ? 'ready' : 'cli-incompatible naming --json',
        r,
        s === 'prerelease'
          ? r.state === 'ready'
          : r.state === 'cli-incompatible' && r.problems[0].includes('--json'),
      );
    }
    await mcp.close();
    mcp = undefined;
    const stopped = await stop(api);
    record('built API shutdown', 'process stops within 12s', stopped, stopped.stopped);
    api = await start();
    const restarted = await request(`/loops/${id}`);
    record(
      'same-store restart',
      'loop persists and API key accepted',
      { status: restarted.status, name: restarted.body.loop?.name },
      restarted.status === 200,
    );
    await stop(api);
    env.GG_CLAUDE_BINARY = join(temp, 'missing-claude.exe');
    env.GG_CODEX_BINARY = join(temp, 'missing-codex.exe');
    api = await start();
    for (const [op, path, method, body] of [
      ['harness', '/harness/preflight', 'GET'],
      ['system', '/system/preflight', 'GET'],
      ['validate', `/loops/${id}/validate`, 'POST', { definition: d }],
      ['publish', `/loops/${id}/publish`, 'POST', {}],
      ['run', `/loops/${id}/runs`, 'POST', {}],
    ]) {
      const r = await request(path, method, body);
      const text = JSON.stringify(r.body);
      record(
        'missing CLI: ' + op,
        'cli-missing or HARNESS_READINESS_CLI_MISSING; no turn',
        r,
        op === 'run'
          ? r.status === 422 && r.body.code === 'HARNESS_NOT_READY'
          : text.includes('cli-missing') || text.includes('HARNESS_READINESS_CLI_MISSING'),
      );
    }
    if (process.env.QA_BROWSER === '1') {
      const { browserChecks } = await import('./browser.mjs');
      await browserChecks({ url, token, request, scenario, definition, record, evidence, temp });
    }
  } finally {
    if (mcp) await mcp.close();
    const stopped = await stop(api);
    record('final API shutdown', 'stopped', stopped, stopped.stopped);
  }
}
main()
  .catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => {
    for (const p of children) p.kill();
  });
