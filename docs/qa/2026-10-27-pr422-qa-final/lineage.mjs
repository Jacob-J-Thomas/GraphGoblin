import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import * as L from './lib.mjs';
let api, receiver;
const E = {};
const deliveries = [];
try {
  receiver = createServer(async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    deliveries.push({ body, headers: req.headers });
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise((r) => receiver.listen(6662, '127.0.0.1', r));
  api = await L.startApi('lineage', 6660);
  const childDef = L.loop('Pinned child version one');
  const childLoop = await L.publish(api, childDef);
  const nodes = [
    {
      id: 'prepare',
      kind: 'mutate',
      label: 'Seed values',
      config: {
        operations: [
          { op: 'set', path: '/vars/trace', value: { kind: 'literal', value: ['seed'] } },
          { op: 'append-message', role: 'user', content: 'Initial QA message' },
        ],
      },
    },
    L.inference('think', { policy: 'resume-own' }),
    {
      id: 'gate',
      kind: 'decision',
      label: 'Repeat',
      config: {
        kind: 'expression',
        jsonata: '"again"',
        maxPasses: 2,
        routes: [
          { id: 'again', label: 'Again', repeat: true },
          { id: 'finish', label: 'Finish' },
        ],
      },
    },
    {
      id: 'sub',
      kind: 'subloop',
      label: 'Pinned child',
      config: { loopRef: { loopId: childLoop, version: 'latest' } },
    },
    L.scriptNode(path.join(L.RECORD, 'effect.mjs'), [
      'exit',
      path.join(L.ROOT, 'lineage-effects'),
      path.join(L.ROOT, 'lineage-ready'),
    ]),
  ];
  fs.writeFileSync(path.join(L.ROOT, 'lineage-ready'), 'ready');
  const def = L.loop('Replay seed and pins', nodes, {}, [
    L.edge('a', 'start', 'prepare'),
    L.edge('b', 'prepare', 'think'),
    L.edge('c', 'think', 'gate'),
    L.edge('d', 'gate', 'think', 'again'),
    L.edge('e', 'gate', 'sub', 'finish'),
    L.edge('f', 'gate', 'sub', 'limit-reached'),
    L.edge('g', 'sub', 'script'),
    L.edge('h', 'script', 'done'),
  ]);
  def.nodes.at(-1).config = {
    returns: 'vars',
    destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:6662/delivery' }],
  };
  const loopId = await L.publish(api, def);
  let source = await L.run(api, loopId);
  source = await L.state(api, source.id, ['succeeded']);
  await L.until(async () => !!(await api.get('/runs/' + source.id)).finalizedAt);
  let sourceHistory = await L.events(api, source.id);
  let firstStart = sourceHistory.find((e) => e.type === 'node.started' && e.nodeId === 'think');
  let preFirst = await api.get(`/runs/${source.id}/thread?at=${firstStart.seq - 1}`);
  let sourceThread = await api.get(`/runs/${source.id}/thread`);
  let sourceChildren = (await api.get('/runs?parent=' + source.id)).items;
  let firstDelivery = structuredClone(deliveries);
  let before = await api.get('/runs/' + source.id);
  // Publish changed parent/child versions after the source is pinned.
  const childV2 = structuredClone(childDef);
  childV2.name = 'Changed child version two';
  childV2.nodes.at(-1).config = { outcome: 'exhausted' };
  let edit = await api.call('PUT', `/loops/${childLoop}/draft`, { definition: childV2 });
  if (edit.status !== 200) throw Error(JSON.stringify(edit));
  await api.post(`/loops/${childLoop}/publish`);
  const parentV2 = structuredClone(def);
  parentV2.name = 'Changed parent version two';
  edit = await api.call('PUT', `/loops/${loopId}/draft`, { definition: parentV2 });
  if (edit.status !== 200) throw Error(JSON.stringify(edit));
  await api.post(`/loops/${loopId}/publish`);
  const admitted = await api.post(`/runs/${source.id}/replay`, {
    nodeId: 'think',
    observedSeq: before.recovery.observedSeq,
  });
  let fork = await L.state(api, admitted.run.id, ['succeeded']);
  await L.until(async () => !!(await api.get('/runs/' + fork.id)).finalizedAt);
  let forkHistory = await L.events(api, fork.id);
  let seed = forkHistory[0].initialThread;
  let expected = preFirst.thread ?? preFirst;
  let sameFields = ['vars', 'messages', 'outputs', 'gates', 'counters'];
  let same = sameFields.every((k) => JSON.stringify(seed[k]) === JSON.stringify(expected[k]));
  L.check(
    'Replay seeds before selected node FIRST start',
    same &&
      sourceHistory.filter((e) => e.type === 'node.started' && e.nodeId === 'think').length === 2,
    {
      sameFields: sameFields.map((k) => ({
        field: k,
        equal: JSON.stringify(seed[k]) === JSON.stringify(expected[k]),
      })),
      seed,
      expected,
    },
  );
  let forkChildren = (await api.get('/runs?parent=' + fork.id)).items;
  L.check(
    'Replay preserves parent and child pinned versions after publishing edits',
    fork.versionId === source.versionId &&
      forkChildren.length === 1 &&
      forkChildren[0].versionId === sourceChildren[0].versionId &&
      forkChildren[0].id !== sourceChildren[0].id,
    {
      source,
      fork,
      sourceChildren,
      forkChildren,
      sourcePins: sourceHistory[0].subloopVersions,
      forkPins: forkHistory[0].subloopVersions,
    },
  );
  const after = await api.get('/runs/' + source.id);
  const afterThread = await api.get(`/runs/${source.id}/thread`);
  L.check(
    'Replay preserves source history thread result and recorded deliveries',
    JSON.stringify(sourceHistory) === JSON.stringify(await L.events(api, source.id)) &&
      JSON.stringify(sourceThread) === JSON.stringify(afterThread) &&
      JSON.stringify(before.result) === JSON.stringify(after.result) &&
      JSON.stringify(before.deliveries) === JSON.stringify(after.deliveries),
    { before, after },
  );
  L.check(
    'fork owns one new delivery and source delivery is not resent',
    firstDelivery.length === 1 &&
      deliveries.length === 2 &&
      deliveries[0].headers['idempotency-key'] !== deliveries[1].headers['idempotency-key'],
    deliveries,
  );
  L.check(
    'fork has new ID and explicit source link',
    fork.id !== source.id &&
      (await api.get('/runs/' + fork.id)).recovery.replayOf?.runId === source.id,
    { source: source.id, fork: fork.id },
  );
  E.details = {
    source,
    fork,
    preFirst,
    seed,
    sourceHistory,
    forkHistory,
    sourceChildren,
    forkChildren,
    deliveries,
    before,
    after,
  };
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('lineage driver completed', false, E.error);
} finally {
  await L.cleanup();
  if (receiver) await new Promise((r) => receiver.close(r));
  L.save(
    'lineage-processes.json',
    L.processes.map((p) => ({
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('lineage-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
