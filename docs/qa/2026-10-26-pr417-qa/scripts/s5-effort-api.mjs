// Check 4 (#205 D1), API level, acceptance group A s4/s4b re-run and extended. The built API with
// the real Codex SDK and Claude adapters runs against group A's recording CLI (session-cli.cs), so
// every check compares the saved/recorded effort with the argv the CLI actually received.
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('s5-effort-api');
const gateways = [];
const dirs = [];
const PROCESS_DEFAULTS = {
  byHarness: {
    codex: { model: 'gpt-6-sol', effort: 'minimal' },
    claude: { model: 'claude-sonnet-5-5', effort: 'medium' },
  },
};

function single(name, harness, config, settings = {}) {
  return {
    schemaVersion: 4,
    name,
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          harness,
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: `EFFORT-${name} run={{ run.id }} task.` },
          ...config,
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 's-w', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'w-d', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

function decision(name, model, effort, settings = {}) {
  return {
    schemaVersion: 4,
    name,
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          kind: 'llm',
          harness: 'codex',
          instructions: `DECIDE-${name} run={{ run.id }} choose a route`,
          model,
          effort,
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 's-p', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      { id: 'p-y', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
      { id: 'p-n', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
    ],
  };
}

try {
  const dir = L.makeStore('s5');
  dirs.push(dir);
  const cli = L.sessionCli(dir);
  const g = await L.startGateway({ dir, port: 6531, label: 's5', env: { ...cli.env, GG_DEFAULTS: JSON.stringify(PROCESS_DEFAULTS) }, rec });
  gateways.push(g);
  const call = g.call;
  const forRun = (runId) => cli.requests().filter((q) => q.prompt.includes(`run=${runId} `));

  async function runOnce(name, def) {
    const created = await call('/loops', { method: 'POST', body: { definition: def } });
    if (created.status !== 201) return { created: created.status, body: created.json };
    const loopId = created.json.loop.id;
    const published = await call(`/loops/${loopId}/publish`, { method: 'POST' });
    if (published.status >= 300) return { created: 201, published: published.status, body: published.json };
    const started = await call(`/loops/${loopId}/runs`, { method: 'POST', body: {} });
    if (started.status !== 202) return { created: 201, started: started.status, body: started.json };
    const runId = started.json.run.id;
    const end = await L.waitRun(call, runId, ['succeeded', 'failed']);
    const reqs = forRun(runId).map((q) => ({ harness: q.harness, model: q.model, effort: q.effort, argvEffort: q.argv.find((a) => /reasoning_effort/.test(a)) ?? (q.argv.includes('--effort') ? `--effort ${q.argv[q.argv.indexOf('--effort') + 1]}` : undefined) }));
    const sessions = (await call(`/runs/${runId}/sessions`)).json.items ?? [];
    const evs = await L.events(call, runId);
    return {
      runId,
      status: end.status,
      failure: end.failure,
      requests: reqs,
      sessionRows: sessions.map((s) => ({ harness: s.harness, model: s.model, effort: s.effort })),
      effortEvents: evs.filter((e) => e.effort !== undefined || e.model !== undefined).map((e) => ({ type: e.type, model: e.model, effort: e.effort })),
    };
  }
  const sentMatches = (res, harness, model, effort) =>
    res.status === 'succeeded' && res.requests.length === 1 && res.requests[0].harness === harness && res.requests[0].model === model && res.requests[0].effort === effort;

  // ---- catalog ----
  const catalog = (await call('/model-catalog')).json.items;
  const codexModels = catalog.filter((e) => e.harness === 'codex');
  rec.log('Codex catalog', codexModels.map((e) => ({ model: e.model, efforts: e.efforts, defaultEffort: e.defaultEffort, enabled: e.enabled })));
  rec.check('C0 GPT-5.5 lists minimal..xhigh and no max', JSON.stringify(codexModels.find((e) => e.model === 'gpt-5.5')?.efforts) === JSON.stringify(['minimal', 'low', 'medium', 'high', 'xhigh']), codexModels.find((e) => e.model === 'gpt-5.5')?.efforts);
  rec.check('C0 every other Codex model lists max', codexModels.filter((e) => e.model !== 'gpt-5.5').every((e) => e.efforts.includes('max')), null);

  // ---- inherited defaults, three layers ----
  const layers = [];
  for (const harness of ['codex', 'claude']) {
    const d = PROCESS_DEFAULTS.byHarness[harness];
    const res = await runOnce(`p-${harness}`, single(`p-${harness}`, harness, {}));
    layers.push({ layer: 'process', harness, expected: d, res });
  }
  await call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { effort: 'high' }, claude: { model: 'claude-haiku-5-5' } } } } });
  for (const [harness, model, effort] of [
    ['codex', 'gpt-6-sol', 'high'],
    ['claude', 'claude-haiku-5-5', 'medium'],
  ]) {
    const res = await runOnce(`o-${harness}`, single(`o-${harness}`, harness, {}));
    layers.push({ layer: 'owner', harness, expected: { model, effort }, res });
  }
  const loopDefaults = { defaults: { byHarness: { codex: { model: 'gpt-6.1-sol' }, claude: { effort: 'xhigh' } } } };
  for (const [harness, model, effort] of [
    ['codex', 'gpt-6.1-sol', 'high'],
    ['claude', 'claude-haiku-5-5', 'xhigh'],
  ]) {
    const res = await runOnce(`l-${harness}`, single(`l-${harness}`, harness, {}, loopDefaults));
    layers.push({ layer: 'loop', harness, expected: { model, effort }, res });
  }
  // Inherited max: loop default effort max on a model that lists it.
  {
    const res = await runOnce('l-codex-max', single('l-codex-max', 'codex', {}, { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'max' } } } }));
    layers.push({ layer: 'loop (max)', harness: 'codex', expected: { model: 'gpt-6-luna', effort: 'max' }, res });
  }
  for (const l of layers) {
    rec.check(
      `D-${l.layer}-${l.harness} inherited ${l.expected.model}/${l.expected.effort} is what the CLI receives and the session row records`,
      sentMatches(l.res, l.harness, l.expected.model, l.expected.effort) && l.res.sessionRows[0]?.model === l.expected.model && l.res.sessionRows[0]?.effort === l.expected.effort,
      { requests: l.res.requests, sessionRows: l.res.sessionRows, failure: l.res.failure },
    );
  }

  // ---- explicit Codex matrix: every catalog model x every listed effort ----
  const matrix = [];
  for (const entry of codexModels) {
    for (const effort of entry.efforts) {
      const name = `x-${entry.model}-${effort}`;
      const res = await runOnce(name, single(name, 'codex', { model: entry.model, effort }));
      matrix.push({
        model: entry.model,
        effort,
        status: res.status,
        sent: res.requests.map((q) => q.argvEffort),
        sentModel: res.requests[0]?.model,
        sessionEffort: res.sessionRows[0]?.effort,
        ok: sentMatches(res, 'codex', entry.model, effort) && res.sessionRows[0]?.effort === effort && res.sessionRows[0]?.model === entry.model,
      });
    }
  }
  rec.log('Explicit Codex matrix (model, effort, argv sent, session row)', matrix.map((m) => `${m.model} ${m.effort} -> ${m.sent.join(',')} session=${m.sessionEffort} ${m.status}`));
  rec.check(`X1 every explicit Codex model/effort pair is sent unchanged and recorded as sent (${matrix.length} runs)`, matrix.length > 0 && matrix.every((m) => m.ok), matrix.filter((m) => !m.ok));
  rec.check('X1 max is sent as model_reasoning_effort="max" on every model that lists it', matrix.filter((m) => m.effort === 'max').every((m) => m.sent[0] === 'model_reasoning_effort="max"'), matrix.filter((m) => m.effort === 'max').map((m) => ({ model: m.model, sent: m.sent })));

  // ---- Claude regression ----
  for (const [model, effort] of [
    ['claude-opus-5-5', 'max'],
    ['claude-fable-5-1', 'low'],
  ]) {
    const name = `c-${model}-${effort}`;
    const res = await runOnce(name, single(name, 'claude', { model, effort }));
    rec.check(`X2 Claude explicit ${model}/${effort} is sent as --effort ${effort}`, sentMatches(res, 'claude', model, effort) && res.requests[0].argvEffort === `--effort ${effort}`, { requests: res.requests, failure: res.failure });
  }
  {
    const before = cli.requests().length;
    const res = await call('/loops', { method: 'POST', body: { definition: single('c-minimal', 'claude', { model: 'claude-opus-5-5', effort: 'minimal' }) } });
    rec.check('X2 Claude minimal is refused (400 EFFORT_UNSUPPORTED) before any request', res.status === 400 && JSON.stringify(res.json).includes('EFFORT_UNSUPPORTED') && cli.requests().length === before, { status: res.status });
  }

  // ---- LLM decisions ----
  for (const [label, model, effort, expected] of [
    ['luna-max', { mode: 'explicit', value: 'gpt-6-luna' }, { mode: 'explicit', value: 'max' }, ['gpt-6-luna', 'max']],
    ['sol-max', { mode: 'explicit', value: 'gpt-6.1-sol' }, { mode: 'explicit', value: 'max' }, ['gpt-6.1-sol', 'max']],
    ['sol-xhigh', { mode: 'explicit', value: 'gpt-6.1-sol' }, { mode: 'explicit', value: 'xhigh' }, ['gpt-6.1-sol', 'xhigh']],
    ['gpt55-xhigh', { mode: 'explicit', value: 'gpt-5.5' }, { mode: 'explicit', value: 'xhigh' }, ['gpt-5.5', 'xhigh']],
    ['inherit', { mode: 'inherit' }, { mode: 'inherit' }, ['gpt-6-sol', 'high']],
  ]) {
    const res = await runOnce(`llm-${label}`, decision(`llm-${label}`, model, effort));
    const decisionEffort = res.effortEvents?.filter((e) => e.type.startsWith('decision'));
    rec.check(
      `X3 LLM decision ${label}: the structured Codex request carries ${expected.join('/')} and the decision record says the same`,
      sentMatches(res, 'codex', expected[0], expected[1]) && (decisionEffort?.length ? decisionEffort.every((e) => e.effort === expected[1] && e.model === expected[0]) : true),
      { requests: res.requests, decisionEvents: decisionEffort, failure: res.failure },
    );
  }

  // ---- GPT-5.5 max refused before any request ----
  {
    const before = cli.requests().length;
    const inf = await call('/loops', { method: 'POST', body: { definition: single('r-inf', 'codex', { model: 'gpt-5.5', effort: 'max' }) } });
    const dec = await call('/loops', { method: 'POST', body: { definition: decision('r-dec', { mode: 'explicit', value: 'gpt-5.5' }, { mode: 'explicit', value: 'max' }) } });
    const owner = await call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model: 'gpt-5.5', effort: 'max' } } } } });
    const loopDef = await call('/loops', { method: 'POST', body: { definition: single('r-loopdef', 'codex', {}, { defaults: { byHarness: { codex: { model: 'gpt-5.5', effort: 'max' } } } }) } });
    const summary = Object.fromEntries(
      Object.entries({ inference: inf, decision: dec, ownerSettings: owner, loopDefaults: loopDef }).map(([k, v]) => [k, { status: v.status, code: v.json?.code, errors: v.json?.errors?.map?.((e) => e.code ?? e.message) }]),
    );
    rec.log('GPT-5.5 max refusals', summary);
    for (const [k, v] of Object.entries({ inference: inf, decision: dec, ownerSettings: owner, loopDefaults: loopDef }))
      rec.check(`R1 GPT-5.5 max as ${k} is refused 400 EFFORT_UNSUPPORTED`, v.status === 400 && JSON.stringify(v.json).includes('EFFORT_UNSUPPORTED'), summary[k]);
    rec.check('R1 no CLI request was made for any refused GPT-5.5 max', cli.requests().length === before, { before, after: cli.requests().length });
  }
  // Explicit max on a node whose model is inherited as GPT-5.5 (owner Settings model).
  {
    await call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model: 'gpt-5.5', effort: 'high' } } } } });
    const before = cli.requests().length;
    const res = await runOnce('r-inherited-model', single('r-inherited-model', 'codex', { effort: 'max' }));
    rec.log('explicit max with an inherited GPT-5.5 model', { created: res.created, published: res.published, started: res.started, status: res.status, failure: res.failure, body: res.body });
    const refused = (res.created === 400 || res.published >= 400 || res.started >= 400 || (res.status === 'failed' && res.failure?.code === 'EFFORT_UNSUPPORTED')) && JSON.stringify(res).includes('EFFORT_UNSUPPORTED');
    rec.check('R2 explicit max with GPT-5.5 inherited from Settings is refused EFFORT_UNSUPPORTED before any request', refused && cli.requests().length === before, { refusedAt: res.created === 400 ? 'create' : res.published ? 'publish' : res.started ? 'start' : 'execution', requestsMade: cli.requests().length - before });
    const control = await runOnce('r-inherited-xhigh', single('r-inherited-xhigh', 'codex', { effort: 'xhigh' }));
    rec.check('R2 control: xhigh with inherited GPT-5.5 is sent unchanged', sentMatches(control, 'codex', 'gpt-5.5', 'xhigh'), { requests: control.requests, failure: control.failure });
    await call('/settings/defaults', { method: 'DELETE' });
  }
  await call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  rec.check('Z1 gateway drains to exit 0', (await g.waitExit(30_000)) === 0, g.exitCode());
  g.copyLog('s5-gateway.log.txt');

  // ---- GG_DEFAULTS with GPT-5.5 max (process layer) ----
  {
    const dir2 = L.makeStore('s5p');
    dirs.push(dir2);
    const cli2 = L.sessionCli(dir2);
    let g2;
    let startError;
    try {
      g2 = await L.startGateway({ dir: dir2, port: 6532, label: 's5p', env: { ...cli2.env, GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-5.5', effort: 'max' } } }) }, rec });
      gateways.push(g2);
    } catch (error) {
      startError = String(error?.message ?? error).split('\n').filter((l) => /EFFORT|GG_DEFAULTS|configuration|error/i.test(l)).slice(0, 6).map(L.redact);
    }
    if (startError) {
      rec.log('GG_DEFAULTS gpt-5.5/max: startup refused', startError);
      rec.check('R3 GG_DEFAULTS codex gpt-5.5/max is refused (startup) before any request', JSON.stringify(startError).includes('EFFORT_UNSUPPORTED') || /not supported/i.test(JSON.stringify(startError)), startError);
    } else {
      const created = await g2.call('/loops', { method: 'POST', body: { definition: single('p-inherit', 'codex', {}) } });
      let detail = { created: created.status, body: created.json?.code };
      if (created.status === 201) {
        const loopId = created.json.loop.id;
        const pub = await g2.call(`/loops/${loopId}/publish`, { method: 'POST' });
        const st = pub.status < 300 ? await g2.call(`/loops/${loopId}/runs`, { method: 'POST', body: {} }) : undefined;
        let run;
        if (st?.status === 202) run = await L.waitRun(g2.call, st.json.run.id, ['succeeded', 'failed']);
        detail = { ...detail, publish: pub.status, publishCode: pub.json?.code, start: st?.status, startCode: st?.json?.code, runStatus: run?.status, runFailure: run?.failure?.code };
      }
      detail.requests = cli2.requests().length;
      rec.log('GG_DEFAULTS gpt-5.5/max: gateway started; inheriting node', detail);
      rec.check('R3 GG_DEFAULTS codex gpt-5.5/max: an inheriting node is refused EFFORT_UNSUPPORTED before any request', JSON.stringify(detail).includes('EFFORT_UNSUPPORTED') && detail.requests === 0, detail);
      await g2.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
      await g2.waitExit(30_000);
      g2.copyLog('s5-gateway-process-defaults.log.txt');
    }
  }
} catch (error) {
  rec.check('S5 completed without exception', false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) {
    if (x.exitCode() === null) {
      await x.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
      await x.waitExit(20_000);
    }
  }
  rec.finish();
  for (const d of dirs) L.cleanupStore(d, rec);
}
void path;
