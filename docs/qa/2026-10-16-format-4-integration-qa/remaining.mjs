import fs from 'node:fs';
import path from 'node:path';
import {
  assert,
  clone,
  root,
  req,
  get,
  post,
  status,
  test,
  node,
  edge,
  minimal,
  create,
  ready,
  save,
  publish,
  start,
  run,
  waitRun,
  runs,
  waitCount,
  endpoint,
  events,
  sleep,
  tag,
} from './common.mjs';
const E = 'Event triggers',
  P = 'Poll and cron',
  I = 'Old export import',
  T = 'Templates',
  D = 'Loop deletion';
const type = tag + '-event';
const eDef = minimal('event fanout', { type: 'event', eventType: type });
const a = await ready(eDef),
  b = await ready({ ...clone(eDef), name: eDef.name + ' second' });
await test(
  E,
  'EV-fanout',
  'POST /events fans out to both matching triggers',
  '202 duplicate=false with two run IDs; correct Event payload in both threads',
  async () => {
    const payload = { hello: 'event', n: 3 };
    const r = await post('/events', { type, payload });
    status(r, 202);
    assert.equal(r.data.duplicate, false);
    assert.equal(r.data.runIds.length, 2);
    for (const id of r.data.runIds) {
      const sn = await waitRun(id);
      assert([a, b].includes(sn.loopId));
      const t = await get(`/runs/${id}/thread`);
      assert.equal(t.data.invocation.trigger.kind, 'event');
      assert.deepEqual(t.data.invocation.trigger.payload, payload);
    }
    return r.data;
  },
);
await test(
  E,
  'EV-key',
  'global Event key repeats deduplicate',
  '202 duplicate true on repeat with original ID/run IDs and no new fanout',
  async () => {
    const body = { type, payload: { key: 'global' }, dedupeKey: 'event-global-key' };
    const x = await post('/events', body),
      y = await post('/events', body);
    status(x, 202);
    status(y, 202);
    assert.equal(x.data.duplicate, false);
    assert.equal(y.data.duplicate, true);
    assert.equal(y.data.id, x.data.id);
    assert.deepEqual(y.data.runIds, x.data.runIds);
    return { first: x.data, repeat: y.data };
  },
);
await test(
  E,
  'EV-key-empty',
  'empty Event envelope key retains old unkeyed behavior',
  'two 202 duplicate=false; distinct Event IDs and two runs per delivery',
  async () => {
    const body = { type, payload: { empty: true }, dedupeKey: '' };
    const x = await post('/events', body),
      y = await post('/events', body);
    status(x, 202);
    status(y, 202);
    assert.equal(x.data.duplicate, false);
    assert.equal(y.data.duplicate, false);
    assert.notEqual(x.data.id, y.data.id);
    assert.equal(x.data.runIds.length, 2);
    assert.equal(y.data.runIds.length, 2);
    return {
      statuses: [x.status, y.status],
      ids: [x.data.id, y.data.id],
      duplicates: [x.data.duplicate, y.data.duplicate],
    };
  },
);
for (const [name, key] of [
  ['513', 'x'.repeat(513)],
  ['null', null],
])
  await test(
    E,
    'EV-key-invalid-' + name,
    'Event key ' + name + ' uses existing validation',
    '400 VALIDATION_FAILED',
    async () => {
      const r = await post('/events', { type, payload: null, dedupeKey: key });
      status(r, 400, 'VALIDATION_FAILED');
      return r.data;
    },
  );
await test(E, 'EV-unmatched', 'unmatched Event type', '202 stored; runIds empty', async () => {
  const r = await post('/events', { type: type + '-unmatched', payload: null });
  status(r, 202);
  assert.deepEqual(r.data.runIds, []);
  return r.data;
});
await test(
  E,
  'EV-node-key',
  'Event trigger expression keys remain per-node deduplicated',
  'two stored distinct events; one matching run across both posts',
  async () => {
    const eventType = type + '-node-key';
    const id = await ready(
      minimal('event node key', { type: 'event', eventType, dedupeKey: 'id' }),
    );
    const body = { type: eventType, payload: { id: 'same' } };
    const x = await post('/events', body),
      y = await post('/events', body);
    status(x, 202);
    status(y, 202);
    assert.equal(x.data.runIds.length, 1);
    assert.equal(y.data.runIds.length, 0);
    assert.equal((await runs(id)).length, 1);
    return { first: x.data, repeat: y.data };
  },
);
const polls = [];
for (const [name, probe, fireWhen] of [
  ['none', { kind: 'none' }, 'true'],
  [
    'script',
    {
      kind: 'script',
      command: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify({ready:true}))'],
      timeoutSeconds: 3,
    },
    'probe.json.ready',
  ],
  ['false', { kind: 'none' }, 'false'],
]) {
  const def = minimal('poll ' + name, {
    type: 'poll',
    intervalSeconds: 5,
    probe,
    fireWhen,
    dedupeKey: '"one-per-node"',
    enabled: true,
  });
  const id = await ready(def);
  polls.push({ name, id, def });
}
await sleep(6100);
for (const h of polls)
  await test(
    P,
    'P-' + h.name,
    'poll ' + h.name + ' probe',
    'armed poll; ' +
      (h.name === 'false'
        ? 'no run when fireWhen=false'
        : 'one successful run; poll envelope/probe retained'),
    async () => {
      const listing = await get(`/loops/${h.id}/triggers`);
      status(listing, 200);
      assert.equal(listing.data.polls.length, 1);
      const rr = await runs(h.id);
      if (h.name === 'false') assert.equal(rr.length, 0);
      else {
        assert.equal(rr.length, 1);
        const sn = await waitRun(rr[0].id);
        assert.equal(sn.status, 'succeeded');
        const t = await get(`/runs/${rr[0].id}/thread`);
        assert.equal(t.data.invocation.trigger.kind, 'poll');
        assert.equal(t.data.invocation.trigger.dedupeKey, 'one-per-node');
        if (h.name === 'script') assert.equal(t.data.invocation.trigger.payload.json.ready, true);
      }
      return { listing: listing.data.polls, runs: rr };
    },
  );
await sleep(5200);
await test(
  P,
  'P-key',
  'poll key remains consumed on later sweeps',
  'still one run per true poll after a second tick; false poll still zero',
  async () => {
    const counts = [];
    for (const h of polls) {
      const count = (await runs(h.id)).length;
      assert.equal(count, h.name === 'false' ? 0 : 1);
      counts.push({ probe: h.name, count });
    }
    return counts;
  },
);
for (const h of polls) {
  h.def.nodes[0].config.enabled = false;
  await save(h.id, h.def);
  await publish(h.id);
}
await test(
  P,
  'P-disabled',
  'published disabled polls disarm',
  'trigger listing has zero armed polls',
  async () => {
    const result = [];
    for (const h of polls) {
      const r = await get(`/loops/${h.id}/triggers`);
      status(r, 200);
      assert.equal(r.data.polls.length, 0);
      result.push(r.data.polls);
    }
    return result;
  },
);
await test(
  P,
  'P-invalid',
  'poll interval below five seconds',
  '400 VALIDATION_FAILED',
  async () => {
    const r = await post('/loops', {
      definition: minimal('bad poll', {
        type: 'poll',
        intervalSeconds: 4,
        probe: { kind: 'none' },
        fireWhen: 'true',
      }),
    });
    status(r, 400, 'VALIDATION_FAILED');
    return r.data;
  },
);
await test(
  P,
  'C-preview',
  'cron preview exact UTC slots',
  '200 three strictly later five-minute slots; no schedule/run creation',
  async () => {
    const r = await post('/triggers/cron/preview', {
      expression: '*/5 * * * *',
      timezone: 'UTC',
      count: 3,
      from: '2026-10-16T00:00:00Z',
    });
    status(r, 200);
    assert.deepEqual(r.data.next, [
      '2026-10-16T00:05:00.000Z',
      '2026-10-16T00:10:00.000Z',
      '2026-10-16T00:15:00.000Z',
    ]);
    return r.data;
  },
);
for (const [name, change, code] of [
  ['expression', { expression: 'not cron' }, 'CRON_INVALID'],
  ['timezone', { timezone: 'Not/A_Zone' }, 'CRON_INVALID'],
  ['count-zero', { count: 0 }, 'VALIDATION_FAILED'],
  ['count-eleven', { count: 11 }, 'VALIDATION_FAILED'],
  ['from', { from: 'yesterday' }, 'VALIDATION_FAILED'],
])
  await test(
    P,
    'C-invalid-' + name,
    'cron preview invalid ' + name,
    '400 ' + code + ' with field path',
    async () => {
      const r = await post('/triggers/cron/preview', {
        expression: '*/5 * * * *',
        timezone: 'UTC',
        count: 3,
        ...change,
      });
      status(r, 400, code);
      return r.data;
    },
  );
await test(
  P,
  'C-publish',
  'cron publish arms a future schedule',
  '200 publish; enabled schedule with nextFireAt and no immediate run',
  async () => {
    const id = await ready(
      minimal('future cron', {
        type: 'cron',
        expression: '0 0 1 1 *',
        timezone: 'UTC',
        enabled: true,
      }),
    );
    const r = await get(`/loops/${id}/triggers`);
    status(r, 200);
    assert.equal(r.data.schedules.length, 1);
    assert(r.data.schedules[0].enabled);
    assert(new Date(r.data.schedules[0].nextFireAt) > new Date());
    assert.equal((await runs(id)).length, 0);
    return r.data;
  },
);
await test(
  P,
  'C-invalid-publish',
  'invalid cron cannot publish',
  'draft CRON_INVALID issue; publish 422 LOOP_INVALID',
  async () => {
    const c = await create(
      minimal('bad cron', { type: 'cron', expression: 'bad', timezone: 'UTC' }),
    );
    assert(c.issues.some((i) => i.code === 'CRON_INVALID'));
    const r = await post(`/loops/${c.loop.id}/publish`);
    status(r, 422, 'LOOP_INVALID');
    return { issues: c.issues, publish: r.data };
  },
);
function v3(name, kind = 'expression') {
  return {
    format: 'graphgoblin-loop',
    formatVersion: 3,
    exportedAt: '2026-10-16T00:00:00.000Z',
    loop: {
      schemaVersion: 3,
      name: tag + ' ' + name,
      settings: { maxIterations: 7 },
      nodes: [
        node('start', 'trigger', { subtype: 'manual' }),
        node('pick', 'decision', {
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'Yes', criteria: 'Ready' },
              { id: 'no', label: 'No', criteria: 'Not ready' },
            ],
          },
          evaluation:
            kind === 'expression'
              ? { kind: 'expression', jsonata: '"yes"' }
              : {
                  kind: 'llm',
                  harness: 'codex',
                  question: 'Select ready route',
                  model: { mode: 'inherit' },
                  effort: { mode: 'inherit' },
                  context: {},
                },
          recordAlternatives: true,
        }),
        node('done', 'exit', {}),
      ],
      edges: [
        edge('e1', 'start', 'pick'),
        edge('e2', 'pick', 'done', 'yes'),
        edge('e3', 'pick', 'done', 'no'),
      ],
    },
  };
}
await test(
  I,
  'I-auto',
  'format-3 portable export converts automatically',
  '201 format 4; rewrite notices; old fields removed; draft publishes and expression-only run succeeds',
  async () => {
    const source = v3('auto conversion');
    fs.writeFileSync(path.join(root, 'format3-automatic.json'), JSON.stringify(source, null, 2));
    const r = await post('/loops/import', source);
    status(r, 201);
    const d = r.data.draft.definition;
    assert.equal(d.schemaVersion, 4);
    assert.equal(d.settings.maxNodeVisits, 7);
    assert(!('maxIterations' in d.settings));
    assert.equal(d.nodes[0].config.type, 'manual');
    assert.equal(d.nodes[1].config.kind, 'expression');
    assert.equal(d.nodes[2].config.outcome, 'success');
    assert(r.data.notices.length);
    assert(r.data.notices.some((n) => n.code === 'unused-controls'));
    await publish(r.data.loop.id);
    const id = await start(r.data.loop.id);
    const sn = await waitRun(id);
    assert.equal(sn.status, 'succeeded');
    return {
      status: r.status,
      issues: r.data.issues,
      notices: r.data.notices,
      definition: d,
      runStatus: sn.status,
    };
  },
);
await test(
  I,
  'I-auto-bare',
  'bare format-3 minimal definition converts',
  '201 current draft with notices array',
  async () => {
    const source = {
      schemaVersion: 3,
      name: tag + ' bare old',
      nodes: [node('start', 'trigger', { subtype: 'manual' }), node('done', 'exit', {})],
      edges: [edge('e1', 'start', 'done')],
    };
    const r = await post('/loops/import', source);
    status(r, 201);
    assert.equal(r.data.draft.definition.schemaVersion, 4);
    assert(Array.isArray(r.data.notices));
    return r.data;
  },
);
await test(
  I,
  'I-pending-llm',
  'format-3 LLM decision requires review',
  '400 LOOP_FORMAT_UPGRADE_REQUIRED; pending review item IDs/hashes/reasons; no loop created',
  async () => {
    const source = v3('pending LLM', 'llm');
    fs.writeFileSync(path.join(root, 'format3-pending-llm.json'), JSON.stringify(source, null, 2));
    const before = await get('/loops');
    const r = await post('/loops/import', source);
    status(r, 400, 'LOOP_FORMAT_UPGRADE_REQUIRED');
    assert(
      r.data.errors.reviewItems.some(
        (x) => x.id && /^[a-f0-9]{64}$/.test(x.hash) && x.reason && x.status === 'pending',
      ),
    );
    assert(r.data.errors.issues.some((x) => x.kind === 'pending'));
    const after = await get('/loops');
    assert.equal(after.data.items.length, before.data.items.length);
    return r.data;
  },
);
await test(
  I,
  'I-pending-webhook',
  'format-3 webhook decoding changes require review',
  '400 LOOP_FORMAT_UPGRADE_REQUIRED with webhook-json-decoding review',
  async () => {
    const source = v3('pending webhook');
    source.loop.nodes[0].config = {
      subtype: 'webhook',
      signature: {
        scheme: 'hmac-sha256-body',
        header: 'x-hub-signature-256',
        secretRef: 'qa-unused-secret',
      },
    };
    const r = await post('/loops/import', source);
    status(r, 400, 'LOOP_FORMAT_UPGRADE_REQUIRED');
    assert(r.data.errors.reviewItems.some((x) => x.id.includes('webhook-json-decoding')));
    return r.data;
  },
);
for (const [name, edit] of [
  [
    'malformed-v3',
    (x) => {
      x.loop.nodes[0].config.subtype = 'unknown';
    },
  ],
  [
    'bad-envelope',
    (x) => {
      x.exportedAt = 'not-a-time';
    },
  ],
  [
    'unknown-field',
    (x) => {
      x.loop.extra = 'invalid';
    },
  ],
])
  await test(
    I,
    'I-invalid-' + name,
    'invalid old source ' + name,
    '400 LOOP_IMPORT_SOURCE_INVALID; invalid issue classification; no loop',
    async () => {
      const source = v3(name);
      edit(source);
      const r = await post('/loops/import', source);
      status(r, 400, 'LOOP_IMPORT_SOURCE_INVALID');
      assert(r.data.errors.issues.some((x) => x.kind === 'invalid'));
      return r.data;
    },
  );
let catalog;
await test(
  T,
  'T-catalog',
  'catalogue lists all starting points',
  '200 starter/implementation/review/qa; manifest-only entries',
  async () => {
    const r = await get('/templates');
    status(r, 200);
    catalog = r.data.items;
    assert.deepEqual(catalog.map((x) => x.manifest.id).sort(), [
      'implementation',
      'qa',
      'review',
      'starter',
    ]);
    assert(catalog.every((x) => Object.keys(x).join() === 'manifest'));
    return r.data;
  },
);
const copies = [];
for (const template of ['starter', 'implementation', 'review', 'qa'])
  await test(
    T,
    'T-draft-' + template,
    'Use ' + template + ' creates ordinary draft',
    '201 editable format-4 loop; no published version, binding or runs; GET loop round trip',
    async () => {
      const r = await post(`/templates/${template}/draft`, { name: tag + ' copy ' + template });
      status(r, 201);
      copies.push(r.data);
      assert.equal(r.data.draft.definition.schemaVersion, 4);
      assert(!r.data.loop.currentVersionId);
      assert(!('templateInstanceId' in r.data));
      const d = await get(`/loops/${r.data.loop.id}`);
      status(d, 200);
      assert(!d.data.current);
      assert.deepEqual(d.data.draft.definition, r.data.draft.definition);
      assert.equal((await runs(r.data.loop.id)).length, 0);
      return { loop: r.data.loop, draftId: r.data.draft.id, issues: r.data.issues };
    },
  );
await test(
  T,
  'T-independent',
  'repeat copies are independently editable',
  'distinct loop/version IDs; first copy edit preserves second and catalogue default',
  async () => {
    const first = copies[0];
    const second = await post('/templates/starter/draft', {});
    status(second, 201);
    assert.notEqual(first.loop.id, second.data.loop.id);
    assert.notEqual(first.draft.id, second.data.draft.id);
    const original = clone(second.data.draft.definition);
    const edited = clone(first.draft.definition);
    edited.nodes[0].label = 'QA edited independent copy';
    await save(first.loop.id, edited);
    const check = await get(`/loops/${second.data.loop.id}`);
    assert.deepEqual(check.data.draft.definition, original);
    const third = await post('/templates/starter/draft', {});
    status(third, 201);
    assert.deepEqual(third.data.draft.definition, original);
    return {
      loopIds: [first.loop.id, second.data.loop.id, third.data.loop.id],
      editedLabel: edited.nodes[0].label,
      otherLabel: check.data.draft.definition.nodes[0].label,
    };
  },
);
for (const [id, p, b] of [
  ['T-direct-run', '/templates/starter/runs', {}],
  ['T-retired-instantiate', '/templates/starter/instantiate', {}],
  ['T-retired-instance', '/template-instances', {}],
])
  await test(
    T,
    id,
    'cannot execute template directly ' + p,
    '404; no execution endpoint',
    async () => {
      const r = await post(p, b);
      status(r, 404);
      return r.data;
    },
  );
await test(T, 'T-unknown', 'unknown template draft', '404 TEMPLATE_NOT_FOUND', async () => {
  const r = await post('/templates/qa-does-not-exist/draft', {});
  status(r, 404, 'TEMPLATE_NOT_FOUND');
  return r.data;
});
await test(T, 'T-invalid-name', 'blank copied draft name', '400 VALIDATION_FAILED', async () => {
  const r = await post('/templates/starter/draft', { name: '  ' });
  status(r, 400, 'VALIDATION_FAILED');
  return r.data;
});
await test(
  D,
  'D-cascade',
  'deleting a terminal loop removes all its runs and projections',
  '204; loop/version/export and run/thread/events 404; run list empty',
  async () => {
    const id = await ready(minimal('delete terminal'));
    const ids = [await start(id, { n: 1 }), await start(id, { n: 2 })];
    for (const r of ids) await waitRun(r);
    const del = await req('DELETE', `/loops/${id}`);
    status(del, 204);
    assert.equal(del.text, '');
    const checks = [];
    for (const p of [
      `/loops/${id}`,
      `/loops/${id}/versions`,
      `/loops/${id}/export`,
      ...ids.flatMap((r) => [`/runs/${r}`, `/runs/${r}/thread`, `/runs/${r}/events`]),
    ]) {
      const r = await get(p);
      status(r, 404);
      checks.push({ path: p, status: r.status, code: r.data.code });
    }
    assert.deepEqual(await runs(id), []);
    return { deleteStatus: del.status, checks };
  },
);
await test(
  D,
  'D-active-waiting-paused',
  'deletion refuses waiting and paused active run',
  '409 LOOP_IN_USE in both states; loop/run remain; cancel then delete 204',
  async () => {
    const d = minimal('delete active');
    d.nodes.splice(1, 0, node('wait', 'wait', { mode: 'input', prompt: 'QA hold' }));
    d.edges = [edge('e1', 'start', 'wait'), edge('e2', 'wait', 'done')];
    const id = await ready(d),
      rid = await start(id);
    await waitRun(rid, 'waiting');
    const waiting = await req('DELETE', `/loops/${id}`);
    status(waiting, 409, 'LOOP_IN_USE');
    status(await get(`/loops/${id}`), 200);
    status(await post(`/runs/${rid}/pause`), 200);
    await waitRun(rid, 'paused');
    const paused = await req('DELETE', `/loops/${id}`);
    status(paused, 409, 'LOOP_IN_USE');
    status(await get(`/runs/${rid}`), 200);
    status(await post(`/runs/${rid}/cancel`), 200);
    await waitRun(rid, 'cancelled');
    const del = await req('DELETE', `/loops/${id}`);
    status(del, 204);
    return { waiting: waiting.data, paused: paused.data, afterCancel: del.status };
  },
);
await test(
  D,
  'D-active-running',
  'deletion refuses a running script',
  '409 LOOP_IN_USE while running; cancel before deleting',
  async () => {
    const d = minimal('delete running');
    d.nodes.splice(
      1,
      0,
      node('delay', 'script', {
        command: process.execPath,
        args: ['-e', 'setTimeout(()=>{},5000)'],
        stdin: 'none',
        stdout: 'ignore',
        timeoutSeconds: 7,
      }),
    );
    d.edges = [edge('e1', 'start', 'delay'), edge('e2', 'delay', 'done')];
    const id = await ready(d),
      rid = await start(id);
    await waitRun(rid, 'running');
    const r = await req('DELETE', `/loops/${id}`);
    status(r, 409, 'LOOP_IN_USE');
    status(await post(`/runs/${rid}/cancel`), 200);
    await waitRun(rid, 'cancelled');
    status(await req('DELETE', `/loops/${id}`), 204);
    return r.data;
  },
);
await test(
  D,
  'D-hook-history',
  'deleting webhook loop removes runs/receipts/endpoints',
  '204; hook 404, runs removed, Events rows absent',
  async () => {
    const id = await ready(minimal('delete hook', { type: 'webhook' })),
      ep = await endpoint(id);
    status(await post(ep.path, { qa: 'delete hook' }), 202);
    const rr = await waitCount(id, 1);
    await waitRun(rr[0].id);
    assert((await events()).some((e) => e.webhook?.loopId === id));
    status(await req('DELETE', `/loops/${id}`), 204);
    const hook = await post(ep.path, {});
    status(hook, 404, 'HOOK_NOT_FOUND');
    assert(!(await events()).some((e) => e.webhook?.loopId === id));
    status(await get(`/runs/${rr[0].id}`), 404, 'RUN_NOT_FOUND');
    return { deleteStatus: 204, hook: hook.data, runId: rr[0].id };
  },
);
await test(D, 'D-missing', 'deleting a missing loop', '404 LOOP_NOT_FOUND', async () => {
  const c = await create(minimal('delete twice')),
    id = c.loop.id;
  status(await req('DELETE', `/loops/${id}`), 204);
  const r = await req('DELETE', `/loops/${id}`);
  status(r, 404, 'LOOP_NOT_FOUND');
  return r.data;
});
