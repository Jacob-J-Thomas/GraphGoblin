// Follow-up to s4/s5: the Codex `max` effort on an LLM decision, and what the run records show.
import { join } from 'node:path';
import process from 'node:process';
import {
  ROOT,
  byMarker,
  createPublished,
  edge,
  events,
  get,
  loop,
  requests,
  resetCli,
  saveJson,
  startApi,
  startRun,
  summarize,
  waitRun,
} from './lib.mjs';

const api = await startApi({ name: 's4b', port: 6446, dataDir: join(ROOT, 'data-s4b') });
const out = {};
try {
  await resetCli();
  const def = loop(
    'llm max',
    [
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          kind: 'llm',
          harness: 'codex',
          instructions: 'DECIDEMAX run={{ run.id }} choose',
          model: { mode: 'explicit', value: 'gpt-6-luna' },
          effort: { mode: 'explicit', value: 'max' },
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
      },
    ],
    [edge('s-p', 'start', 'pick'), edge('p-y', 'pick', 'done', 'yes'), edge('p-n', 'pick', 'done', 'no')],
  );
  const loopId = await createPublished(api.base, def);
  const run = await startRun(api.base, loopId);
  const end = await waitRun(api.base, run.id, ['succeeded', 'failed']);
  const reqs = byMarker(await requests(), `DECIDEMAX run=${run.id} `).map((x) => ({ ...summarize(x), argv: x.argv }));
  const evs = await events(api.base, run.id);
  out.llmMax = {
    status: end.status,
    sent: reqs.map((r) => r.effort),
    argvEffort: reqs.map((r) => r.argv.find((a) => a.startsWith('model_reasoning_effort'))),
    decisionEvents: evs.filter((e) => e.type.startsWith('decision')).map((e) => ({ type: e.type, model: e.model, effort: e.effort, evaluation: e.evaluation })),
  };
  console.log(JSON.stringify(out, null, 2));
} finally {
  await api.kill();
  await saveJson('s4b-codex-max-results.json', out);
}
process.exitCode = 0;
void get;
