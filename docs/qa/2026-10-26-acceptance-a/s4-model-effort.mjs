// #205 "saved values and defaults match the actual provider request": the built API with the real
// Codex/Claude adapters and the recording fake CLIs; each layer of defaults and explicit values is
// compared with the --model / --effort / model_reasoning_effort argv the CLI actually received.
import { join } from 'node:path';
import process from 'node:process';
import {
  ROOT,
  byMarker,
  call,
  createPublished,
  edge,
  events,
  get,
  loop,
  put,
  requests,
  resetCli,
  saveJson,
  startApi,
  startRun,
  summarize,
  waitRun,
} from './lib.mjs';

const checks = [];
function check(id, description, pass, detail) {
  checks.push({ id, description, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${description}`);
  if (!pass) console.log('  detail: ' + JSON.stringify(detail));
}
const evidence = {};
const PROCESS_DEFAULTS = {
  byHarness: {
    codex: { model: 'gpt-6-sol', effort: 'minimal' },
    claude: { model: 'claude-sonnet-5-5', effort: 'medium' },
  },
};
const api = await startApi({
  name: 's4',
  port: 6444,
  dataDir: join(ROOT, 'data-s4'),
  env: { GG_DEFAULTS: JSON.stringify(PROCESS_DEFAULTS) },
});

function single(name, harness, config, settings = {}) {
  return loop(
    name,
    [
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
    ],
    [edge('s-w', 'start', 'work'), edge('w-d', 'work', 'done')],
    settings,
  );
}
async function runOnce(name, def) {
  const loopId = await createPublished(api.base, def);
  const run = await startRun(api.base, loopId);
  const end = await waitRun(api.base, run.id, ['succeeded', 'failed']);
  const reqs = byMarker(await requests(), `run=${run.id} `).map((x) => ({ ...summarize(x), argv: x.argv }));
  const sessions = (await get(api.base, `/runs/${run.id}/sessions`)).items;
  const pinned = (await get(api.base, `/runs/${run.id}`)).pinned;
  return { loopId, runId: run.id, status: end.status, failure: end.failure, requests: reqs, sessions, pinned };
}
function expectRequest(id, description, result, harness, model, effort) {
  const r = result.requests[0];
  check(
    id,
    description,
    result.status === 'succeeded' &&
      result.requests.length === 1 &&
      r.harness === harness &&
      r.model === model &&
      r.effort === effort &&
      result.sessions[0]?.model === model,
    { expected: { model, effort }, request: r && { model: r.model, effort: r.effort }, sessionRow: result.sessions[0], failure: result.failure },
  );
}

try {
  await resetCli();
  evidence.processDefaults = await get(api.base, '/system/model-defaults');
  check(
    '205-process-defaults-exposed',
    'GET /system/model-defaults reports the GG_DEFAULTS process layer',
    JSON.stringify(evidence.processDefaults).includes('gpt-6-sol') &&
      JSON.stringify(evidence.processDefaults).includes('claude-sonnet-5-5'),
    evidence.processDefaults,
  );

  // Layer 1: process defaults only.
  for (const harness of ['codex', 'claude']) {
    const result = await runOnce(`p-${harness}`, single(`p-${harness}`, harness, {}));
    evidence[`process-${harness}`] = result;
    const d = PROCESS_DEFAULTS.byHarness[harness];
    expectRequest(`205-inherit-process-${harness}`, `${harness}: an inheriting node sends the process defaults`, result, harness, d.model, d.effort);
  }

  // Layer 2: owner Settings override part of each harness's defaults.
  evidence.ownerSettings = await put(api.base, '/settings', {
    defaults: { byHarness: { codex: { effort: 'high' }, claude: { model: 'claude-haiku-5-5' } } },
  });
  for (const [harness, model, effort] of [
    ['codex', 'gpt-6-sol', 'high'],
    ['claude', 'claude-haiku-5-5', 'medium'],
  ]) {
    const result = await runOnce(`o-${harness}`, single(`o-${harness}`, harness, {}));
    evidence[`owner-${harness}`] = result;
    expectRequest(`205-inherit-owner-${harness}`, `${harness}: owner Settings layer wins field by field over process defaults`, result, harness, model, effort);
  }

  // Layer 3: loop defaults.
  const loopDefaults = { defaults: { byHarness: { codex: { model: 'gpt-6.1-sol' }, claude: { effort: 'xhigh' } } } };
  for (const [harness, model, effort] of [
    ['codex', 'gpt-6.1-sol', 'high'],
    ['claude', 'claude-haiku-5-5', 'xhigh'],
  ]) {
    const result = await runOnce(`l-${harness}`, single(`l-${harness}`, harness, {}, loopDefaults));
    evidence[`loop-${harness}`] = result;
    expectRequest(`205-inherit-loop-${harness}`, `${harness}: loop defaults win over owner and process layers`, result, harness, model, effort);
  }

  // Layer 4: explicit node values.
  for (const [harness, model, effort] of [
    ['codex', 'gpt-6-luna', 'low'],
    ['codex', 'gpt-6-luna', 'xhigh'],
    ['claude', 'claude-opus-5-5', 'max'],
    ['claude', 'claude-fable-5-1', 'low'],
  ]) {
    const name = `e-${harness}-${model}-${effort}`;
    const result = await runOnce(name, single(name, harness, { model, effort }, loopDefaults));
    evidence[`explicit-${name}`] = result;
    expectRequest(`205-explicit-${harness}-${model}-${effort}`, `${harness}: explicit ${model}/${effort} is what the CLI receives`, result, harness, model, effort);
  }

  // Codex catalog lists max; the adapter documents max -> xhigh. Observe what is saved and sent.
  {
    const result = await runOnce('codex-max', single('codex-max', 'codex', { model: 'gpt-6-luna', effort: 'max' }));
    evidence['codex-max'] = result;
    check(
      '205-codex-max-mapping',
      'codex explicit max: run succeeds; record saved/session effort versus the CLI effort (documented max->xhigh mapping)',
      result.status === 'succeeded' && result.requests[0]?.effort === 'xhigh',
      { request: result.requests[0]?.effort, sessionRow: result.sessions[0]?.effort },
    );
  }

  // Unsupported effort: Claude has no minimal.
  {
    const def = single('claude-minimal', 'claude', { model: 'claude-opus-5-5', effort: 'minimal' });
    const created = await call(api.base, 'POST', '/loops', { definition: def });
    const loopId = created.body?.loop?.id;
    const validate = loopId ? await call(api.base, 'POST', `/loops/${loopId}/validate`, { definition: def }) : undefined;
    const publish = loopId ? await call(api.base, 'POST', `/loops/${loopId}/publish`, {}) : undefined;
    const draftRun = loopId ? await call(api.base, 'POST', `/loops/${loopId}/runs`, { allowDraft: true }) : undefined;
    const before = (await requests()).length;
    evidence['claude-minimal'] = {
      create: created.status,
      createBody: created.body,
      validate: validate && { status: validate.status, body: validate.body },
      publish: publish && { status: publish.status, body: publish.body },
      draftRun: draftRun && { status: draftRun.status, body: draftRun.body },
    };
    check(
      '205-claude-minimal-refused',
      'claude minimal effort is refused before any provider request (validation/publish/admission)',
      // First run: the create itself was refused (400), so publish/run were never reachable.
      (created.status >= 400 || ((publish?.status ?? 0) >= 400 && (draftRun?.status ?? 0) >= 400)) &&
        (await requests()).length === before,
      evidence['claude-minimal'],
    );
  }

  // LLM decision: explicit and inherited selections reach the structured Codex request.
  for (const [label, model, effort, expected] of [
    ['explicit', { mode: 'explicit', value: 'gpt-6.1-sol' }, { mode: 'explicit', value: 'xhigh' }, ['gpt-6.1-sol', 'xhigh']],
    ['inherit', { mode: 'inherit' }, { mode: 'inherit' }, ['gpt-6-sol', 'high']],
  ]) {
    const def = loop(
      `llm ${label}`,
      [
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            kind: 'llm',
            harness: 'codex',
            instructions: `DECIDE-${label} run={{ run.id }} choose a route`,
            model,
            effort,
            routes: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        },
      ],
      [edge('s-p', 'start', 'pick'), edge('p-yes', 'pick', 'done', 'yes'), edge('p-no', 'pick', 'done', 'no')],
    );
    const result = await runOnce(`llm-${label}`, def);
    const evs = await events(api.base, result.runId);
    result.decision = evs.filter((e) => e.type.startsWith('decision'));
    evidence[`llm-${label}`] = result;
    const r = result.requests[0];
    check(
      `205-llm-${label}`,
      `LLM decision ${label}: the structured Codex request carries ${expected.join('/')}`,
      result.status === 'succeeded' && r?.model === expected[0] && r?.effort === expected[1] && r.argv.includes('--output-schema'),
      { request: r && { model: r.model, effort: r.effort }, failure: result.failure },
    );
  }
} finally {
  await api.kill();
  await saveJson('s4-model-effort-results.json', { checks, evidence });
}
const failedChecks = checks.filter((c) => !c.pass);
console.log(`${checks.length - failedChecks.length}/${checks.length} checks passed`);
process.exitCode = failedChecks.length ? 1 : 0;
