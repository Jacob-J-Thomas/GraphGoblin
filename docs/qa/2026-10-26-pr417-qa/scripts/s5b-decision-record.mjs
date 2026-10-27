// Check 4 follow-up: where an LLM decision at effort max is recorded, and that the record and the
// CLI argv agree. Dumps the run, its events and its sessions for one Codex LLM decision at
// gpt-6-luna/max, and one at gpt-6.1-sol/xhigh for comparison.
import * as L from './lib.mjs';

const rec = new L.Recorder('s5b-decision-record');
const dir = L.makeStore('s5b');
let g;
try {
  const cli = L.sessionCli(dir);
  g = await L.startGateway({ dir, port: 6531, label: 's5b', env: { ...cli.env }, rec });
  for (const [model, effort] of [
    ['gpt-6-luna', 'max'],
    ['gpt-6.1-sol', 'xhigh'],
  ]) {
    const def = {
      schemaVersion: 4,
      name: `decision ${model} ${effort}`,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            kind: 'llm',
            harness: 'codex',
            instructions: 'DECIDEREC run={{ run.id }} choose',
            model: { mode: 'explicit', value: model },
            effort: { mode: 'explicit', value: effort },
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
    const loopId = await L.publishLoop(g.call, def);
    const run = await L.startRun(g.call, loopId);
    const end = await L.waitRun(g.call, run, ['succeeded', 'failed']);
    const evs = await L.events(g.call, run);
    const sessions = (await g.call(`/runs/${run}/sessions`)).json;
    const argv = cli.requests().filter((q) => q.prompt.includes(`run=${run} `)).map((q) => q.argv.find((a) => /reasoning_effort/.test(a)));
    // Every place an effort is named in the run's events, with the event type and the JSON path.
    const named = [];
    const walk = (value, at, type) => {
      if (value && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) {
          if (k === 'effort' && typeof v === 'string') named.push({ type, path: `${at}.${k}`, effort: v });
          else walk(v, `${at}.${k}`, type);
        }
    };
    for (const e of evs) walk(e, `#${e.seq}`, e.type);
    const decisionMade = evs.find((e) => e.type === 'decision.made');
    rec.log(`${model}/${effort} run`, { run, status: end.status, argv, effortsNamedInEvents: named, sessions, decisionMade });
    rec.check(`${model}/${effort}: argv carries ${effort}`, argv.length === 1 && argv[0] === `model_reasoning_effort="${effort}"`, argv);
    rec.check(
      `${model}/${effort}: the decision.made record (provenance) names ${model}/${effort}`,
      decisionMade?.provenance?.model === model && decisionMade?.provenance?.effort === effort,
      decisionMade?.provenance,
    );
    rec.check(
      `${model}/${effort}: every effort the run's events name for the decision node is ${effort}`,
      named.filter((n) => !/settings|defaults|classifier/i.test(n.path)).every((n) => n.effort === effort),
      named,
    );
  }
  await g.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } });
  await g.waitExit(30_000);
} catch (error) {
  rec.check('S5b completed without exception', false, String(error?.stack ?? error));
} finally {
  if (g && g.exitCode() === null) {
    await g.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
    await g.waitExit(20_000);
  }
  rec.finish();
  L.cleanupStore(dir, rec);
}
