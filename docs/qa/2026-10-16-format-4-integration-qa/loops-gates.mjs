import {
  assert,
  clone,
  req,
  get,
  post,
  status,
  test,
  node,
  edge,
  minimal,
  create,
  publish,
  save,
  ready,
  start,
  run,
  waitRun,
  runs,
} from './common.mjs';
const S = 'Loops and definitions',
  G = 'Gates and exits';
const routes = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];
function decision(config) {
  const d = minimal(config.kind);
  d.nodes.splice(1, 0, node('choose', 'decision', config));
  d.edges = [
    edge('e1', 'start', 'choose'),
    edge('e2', 'choose', 'done', 'yes'),
    edge('e3', 'choose', 'done', 'no'),
  ];
  return d;
}
const configs = {
  expression: { kind: 'expression', jsonata: '"yes"', routes },
  llm: {
    kind: 'llm',
    instructions: 'Select the matching route for {{ invocation.trigger.payload | json }}',
    harness: 'codex',
    model: { mode: 'inherit' },
    effort: { mode: 'inherit' },
    routes,
    context: {},
  },
  classifier: {
    kind: 'classifier',
    model: 'jev',
    question: 'Choose the matching label.',
    answer: { type: 'choice', options: routes.map((r) => ({ ...r, criteria: r.label })) },
    context: {},
    recordAlternatives: true,
  },
};
for (const [kind, config] of Object.entries(configs))
  await test(
    S,
    'L-' + kind,
    'create/save/publish/export/import ' + kind,
    '201 create; 200 save/publish/export; 201 current import; same evaluator config, format 4, empty notices',
    async () => {
      const c = await create(decision(config)),
        id = c.loop.id;
      const def = clone(c.draft.definition);
      def.description = 'QA round trip ' + kind;
      const saved = await save(id, def);
      await publish(id);
      const exported = await get(`/loops/${id}/export`);
      status(exported, 200);
      assert.equal(exported.data.formatVersion, 4);
      assert.deepEqual(exported.data.loop, def);
      const imported = await post('/loops/import', exported.data);
      status(imported, 201);
      assert.deepEqual(imported.data.draft.definition, def);
      assert.deepEqual(imported.data.notices, []);
      return {
        loopId: id,
        create: 201,
        save: 200,
        publish: 200,
        export: 200,
        import: 201,
        kind: exported.data.loop.nodes[1].config.kind,
        notices: imported.data.notices,
      };
    },
  );
for (const [name, edit] of [
  [
    'subtype',
    (d) => {
      d.nodes[0].config = { subtype: 'manual' };
    },
  ],
  [
    'webhook-filter',
    (d) => {
      d.nodes[0].config = { type: 'webhook', filter: 'true' };
    },
  ],
  [
    'event-filter',
    (d) => {
      d.nodes[0].config = { type: 'event', eventType: 'qa-event', filter: 'true' };
    },
  ],
  [
    'flat-signature',
    (d) => {
      d.nodes[0].config = {
        type: 'webhook',
        signature: { header: 'x-signature', secretRef: 'qa-absent' },
      };
    },
  ],
  [
    'maxIterations',
    (d) => {
      d.settings = { maxIterations: 3 };
    },
  ],
  [
    'old-exit-fields',
    (d) => {
      d.nodes[1].config = {
        criteria: [],
        default: 'success',
        return: { mapping: 'none', channels: [] },
      };
    },
  ],
  [
    'old-decision-fields',
    (d) => {
      const x = decision(configs.expression);
      Object.assign(d, x);
      d.nodes[1].config = {
        answer: {
          type: 'noul',
          true: { id: 'yes', label: 'Yes' },
          false: { id: 'no', label: 'No' },
        },
        evaluation: { kind: 'expression', jsonata: 'true' },
      };
    },
  ],
  [
    'event-pointer-text',
    (d) => {
      d.nodes[0].config = {
        type: 'webhook',
        body: { type: 'text' },
        eventType: { source: 'json-pointer', pointer: '/type' },
      };
    },
  ],
])
  await test(
    S,
    'L-reject-' + name,
    'strict contract rejects ' + name,
    '400 VALIDATION_FAILED with offending field path',
    async () => {
      const d = minimal(name);
      edit(d);
      const r = await post('/loops', { definition: d });
      status(r, 400, 'VALIDATION_FAILED');
      assert(r.data.errors);
      return r.data;
    },
  );
await test(
  S,
  'L-save-reject',
  'strict draft save/validate rejects old maxIterations',
  '400 VALIDATION_FAILED on both; original draft unchanged',
  async () => {
    const c = await create(minimal('old field save'));
    const d = clone(c.draft.definition);
    d.settings.maxIterations = 2;
    const a = await req('PUT', `/loops/${c.loop.id}/draft`, { definition: d });
    status(a, 400, 'VALIDATION_FAILED');
    const b = await post(`/loops/${c.loop.id}/validate`, { definition: d });
    status(b, 400, 'VALIDATION_FAILED');
    const detail = await get(`/loops/${c.loop.id}`);
    assert.deepEqual(detail.data.draft.definition, c.draft.definition);
    return { save: a.data, validate: b.data };
  },
);
for (const [name, edit] of [
  [
    'blank-expression',
    (d) => {
      d.nodes[1].config.jsonata = ' ';
    },
  ],
  [
    'duplicate-routes',
    (d) => {
      d.nodes[1].config.routes[1].id = 'yes';
    },
  ],
  [
    'reserved-port',
    (d) => {
      d.nodes[1].config.routes[0].id = 'limit-reached';
    },
  ],
  [
    'missing-maxPasses',
    (d) => {
      d.nodes[1].config.routes[0].repeat = true;
    },
  ],
  [
    'limits-without-repeat',
    (d) => {
      d.nodes[1].config.maxPasses = 2;
    },
  ],
  [
    'two-repeats',
    (d) => {
      d.nodes[1].config.routes.forEach((r) => (r.repeat = true));
      d.nodes[1].config.maxPasses = 2;
    },
  ],
])
  await test(S, 'L-config-' + name, name, '400 VALIDATION_FAILED with source path', async () => {
    const d = decision(clone(configs.expression));
    edit(d);
    const r = await post('/loops', { definition: d });
    status(r, 400, 'VALIDATION_FAILED');
    return r.data;
  });
for (const [name, cfg] of [
  ['blank-llm', { ...configs.llm, instructions: ' ' }],
  ['blank-classifier', { ...configs.classifier, question: ' ' }],
  ['inactive-llm-field', { ...configs.expression, instructions: 'wrong kind' }],
])
  await test(S, 'L-config-' + name, name, '400 VALIDATION_FAILED', async () => {
    const r = await post('/loops', { definition: decision(cfg) });
    status(r, 400, 'VALIDATION_FAILED');
    return r.data;
  });
export function gate(
  name,
  {
    expression = 'gates.gate.passes < 3 ? "again" : "done"',
    maxPasses = 3,
    maxRunTimeSeconds,
    maxNodeVisits = 10,
    delay = 0,
  } = {},
) {
  const d = minimal(name);
  d.settings = { maxNodeVisits };
  d.nodes = [
    d.nodes[0],
    node('gate', 'decision', {
      kind: 'expression',
      jsonata: expression,
      routes: [
        { id: 'again', label: 'Again', repeat: true },
        { id: 'done', label: 'Done' },
      ],
      maxPasses,
      ...(maxRunTimeSeconds ? { maxRunTimeSeconds } : {}),
    }),
    node(
      'work',
      delay ? 'script' : 'mutate',
      delay
        ? {
            command: process.execPath,
            args: ['-e', `setTimeout(()=>process.stdout.write('finished'),${delay})`],
            stdin: 'none',
            stdout: 'ignore',
            timeoutSeconds: 5,
          }
        : {
            operations: [
              { op: 'set', path: '/vars/visited', value: { kind: 'literal', value: true } },
            ],
          },
    ),
    node('success', 'exit', {
      outcome: 'success',
      returns: '{"passes":gates.gate.passes,"visited":vars.visited}',
      destinations: [{ kind: 'caller' }],
    }),
    node('exhausted', 'exit', {
      outcome: 'exhausted',
      returns: '{"passes":gates.gate.passes}',
      destinations: [{ kind: 'caller' }],
    }),
  ];
  d.edges = [
    edge('e1', 'start', delay ? 'work' : 'gate'),
    edge('e2', 'gate', 'work', 'again'),
    edge('e3', 'work', 'gate'),
    edge('e4', 'gate', 'success', 'done'),
    edge('e5', 'gate', 'exhausted', 'limit-reached'),
  ];
  return d;
}
for (const [name, opts, want, passes, limit] of [
  ['successful-repeat', {}, 'succeeded', 3, null],
  ['max-passes', { expression: '"again"' }, 'exhausted', 3, 'max-passes'],
  [
    'max-time',
    { expression: '"again"', maxPasses: 8, maxRunTimeSeconds: 1, delay: 1300 },
    'exhausted',
    1,
    'max-run-time',
  ],
  [
    'finish-after-time',
    { expression: '"done"', maxPasses: 8, maxRunTimeSeconds: 1, delay: 1300 },
    'succeeded',
    1,
    null,
  ],
  [
    'both-limits',
    { expression: '"again"', maxPasses: 1, maxRunTimeSeconds: 1, delay: 1300 },
    'exhausted',
    1,
    'max-passes',
  ],
])
  await test(
    G,
    'G-' + name,
    name,
    'terminal ' +
      want +
      '; passes ' +
      passes +
      '; limit ' +
      limit +
      '; structured decision evidence and thread counts',
    async () => {
      const x = await run(gate(name, opts));
      assert.equal(x.snapshot.status, want);
      assert.equal(x.snapshot.result.passes, passes);
      const t = await get(`/runs/${x.runId}/thread`);
      status(t, 200);
      assert.equal(t.data.gates.gate.passes, passes);
      assert.equal(t.data.run.iteration, 1);
      const ev = await get(`/runs/${x.runId}/events?limit=1000`);
      status(ev, 200);
      const ds = ev.data.items.filter((e) => e.type === 'decision.made');
      assert(ds.length);
      const last = ds.at(-1);
      assert(last, JSON.stringify(ds.at(-1)));
      assert.equal(last.gate.limit, limit);
      assert.equal(last.portId, limit ? 'limit-reached' : 'done');
      assert.equal(last.observation.kind, 'route');
      assert.equal(last.observation.routeId, limit ? 'again' : 'done');
      assert(last.provenance);
      assert.deepEqual(last.diagnostics, []);
      assert(!ev.data.items.some((e) => e.type === 'iteration.incremented'));
      return {
        runId: x.runId,
        status: x.snapshot.status,
        result: x.snapshot.result,
        threadGate: t.data.gates.gate,
        lastDecision: last,
        decisionCount: ds.length,
      };
    },
  );
await test(
  G,
  'G-warning',
  'gate maxPasses exceeds visit cap across admissions',
  'GATE_PASSES_ABOVE_VISIT_CAP warning with both numbers/cycle nodes; publication allowed',
  async () => {
    const d = gate('warning', { maxPasses: 5, maxNodeVisits: 3 });
    const c = await create(d),
      id = c.loop.id;
    const v = await post(`/loops/${id}/validate`, { definition: d });
    status(v, 200);
    const saved = await save(id, d),
      published = await publish(id);
    const exported = await get(`/loops/${id}/export`);
    const imported = await post('/loops/import', exported.data);
    status(imported, 201);
    const results = [c, v.data, saved, published, imported.data];
    const warnings = results.map((x) =>
      x.issues?.find((y) => y.code === 'GATE_PASSES_ABOVE_VISIT_CAP'),
    );
    assert(warnings.every(Boolean), JSON.stringify(results));
    for (const w of warnings) {
      assert.equal(w.severity, 'warning');
      assert.match(w.message, /5/);
      assert.match(w.message, /3/);
      assert.match(w.message, /work/);
      assert.match(w.message, /gate/);
    }
    return { create: 201, validate: 200, save: 200, publish: 200, import: 201, warnings };
  },
);
for (const [name, edit, code] of [
  [
    'repeat-not-cyclic',
    (d) => {
      d.edges.find((e) => e.id === 'e2').to.node = 'success';
    },
    'REPEAT_ROUTE_NOT_CYCLIC',
  ],
  [
    'missing-limit-edge',
    (d) => {
      d.edges = d.edges.filter((e) => e.id !== 'e5');
    },
    'PORT_UNCONNECTED',
  ],
])
  await test(
    G,
    'G-invalid-' + name,
    name,
    'draft issues include ' + code + '; publish 422 LOOP_INVALID',
    async () => {
      const d = gate(name);
      edit(d);
      const c = await create(d);
      assert(
        c.issues.some((i) => i.code === code),
        JSON.stringify(c.issues),
      );
      const r = await post(`/loops/${c.loop.id}/publish`);
      status(r, 422, 'LOOP_INVALID');
      return { issues: c.issues, publish: r.data };
    },
  );
await test(
  G,
  'G-visit-cap',
  'unmarked runaway hits independent visit cap',
  'failed MAX_NODE_VISITS, nonresumable; details.maxNodeVisits=2',
  async () => {
    const d = decision({ ...clone(configs.expression), jsonata: '"yes"' });
    d.settings = { maxNodeVisits: 2 };
    d.nodes.push(
      node('work', 'mutate', {
        operations: [{ op: 'set', path: '/vars/seen', value: { kind: 'literal', value: true } }],
      }),
    );
    d.edges.find((e) => e.id === 'e2').to.node = 'work';
    d.edges.push(edge('e4', 'work', 'choose'));
    const x = await run(d);
    assert.equal(x.snapshot.status, 'failed');
    assert.equal(x.snapshot.failure.code, 'MAX_NODE_VISITS');
    assert.equal(x.snapshot.failure.resumable, false);
    assert.equal(x.snapshot.failure.details.maxNodeVisits, 2);
    return x.snapshot;
  },
);
for (const [name, jsonata, code] of [
  ['non-string', 'true', 'EVALUATION_INVALID_RESPONSE'],
  ['undeclared', '"missing"', 'EVALUATION_INVALID_RESPONSE'],
  ['undefined', 'missing', 'EVALUATION_INVALID_RESPONSE'],
])
  await test(
    G,
    'G-runtime-' + name,
    'expression ' + name + ' route fails',
    'typed nonresumable evaluator failure; no fallback or decision output',
    async () => {
      const x = await run(decision({ ...clone(configs.expression), jsonata }));
      assert.equal(x.snapshot.status, 'failed');
      assert.equal(x.snapshot.failure.resumable, false);
      assert.match(x.snapshot.failure.code, /^EVALUATION_/);
      const ev = await get(`/runs/${x.runId}/events`);
      assert(!ev.data.items.some((e) => e.type === 'decision.made'));
      return x.snapshot;
    },
  );
await test(
  G,
  'G-failure-return',
  'terminal Failure returns mapped data and cannot resume',
  'failed with unchanged result; return.delivered; resume 409',
  async () => {
    const payload = { reason: 'qa-failure', detail: { x: 7 } };
    const x = await run(
      minimal('failure', undefined, {
        outcome: 'failure',
        returns: 'invocation.trigger.payload',
        destinations: [{ kind: 'caller' }],
      }),
      payload,
    );
    assert.equal(x.snapshot.status, 'failed');
    assert.deepEqual(x.snapshot.result, payload);
    assert(!x.snapshot.failure);
    const ev = await get(`/runs/${x.runId}/events`);
    assert(ev.data.items.some((e) => e.type === 'return.delivered'));
    const resume = await post(`/runs/${x.runId}/resume`);
    status(resume, 409);
    return {
      snapshot: x.snapshot,
      resume: resume.data,
      terminalEvents: ev.data.items.filter((e) =>
        ['exit.evaluated', 'run.finished', 'return.delivered'].includes(e.type),
      ),
    };
  },
);
await test(
  G,
  'G-return-error',
  'invalid return mapping follows node failure handling',
  'failed with a node failure; no terminal exit run.finished',
  async () => {
    const x = await run(
      minimal('return mapping error', undefined, {
        outcome: 'failure',
        returns: '$error("qa mapping error")',
        destinations: [{ kind: 'caller' }],
      }),
    );
    assert.equal(x.snapshot.status, 'failed');
    assert(x.snapshot.failure);
    const ev = await get(`/runs/${x.runId}/events`);
    assert(!ev.data.items.some((e) => e.type === 'run.finished'));
    return x.snapshot;
  },
);
