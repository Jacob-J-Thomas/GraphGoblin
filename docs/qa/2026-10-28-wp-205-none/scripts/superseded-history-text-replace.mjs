// WP-205 QA round 1 (Q205-1): every stored place that can hold an effort, found by one SELECT and
// corrected by the CHANGELOG's hand statements. One disposable store (%TEMP%\gg-205-history-*),
// port 6300, the built WP-205 head, and the controlled fake Codex/Claude CLI compiled from
// docs/qa/2026-10-28-wp-205-qa/scripts/fake-cli.cs.txt into %TEMP%\gg-205-tools\fake. No real
// provider turn.
//
//   P  produce, through the public API, a row of every effort-bearing kind at effort `none`:
//      owner defaults; loop versions (inference, LLM decision, loop defaults, a draft snapshot);
//      runs.pinned and runs.failure (missing session); run_events run.queued, harness.session,
//      decision.made, run.failed, run.resumed; harness_sessions; event and webhook receipts.
//   H  write `minimal` into the run-history places only (as a run made before #205 would hold it):
//      startup succeeds; record what each read does; the SELECT finds every row.
//   F  write `minimal` into the definition, settings and catalog places too: the SELECT finds all
//      of them, startup refuses; apply the hand statements; every read is 200 and the SELECT is
//      empty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('round1/history');
const dir = L.makeStore('history');
const cli = path.join(dir, 'fake-cli');
fs.mkdirSync(cli);
for (const name of ['codex.exe', 'claude.exe'])
  fs.copyFileSync(path.join(os.tmpdir(), 'gg-205-tools', 'fake', name), path.join(cli, name));
const env = {
  GG_CODEX_BINARY: path.join(cli, 'codex.exe'),
  GG_CLAUDE_BINARY: path.join(cli, 'claude.exe'),
};
const mode = (value) => fs.writeFileSync(path.join(cli, 'codex-mode.txt'), value);
const spec = (events, exit) => {
  fs.writeFileSync(path.join(cli, 'spec-events.txt'), events.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(cli, 'spec-stderr.txt'), '');
  fs.writeFileSync(path.join(cli, 'spec-exit.txt'), String(exit));
  mode('spec');
};
const requests = () => {
  const file = path.join(cli, 'requests.jsonl');
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
};
const gateways = [];
const start = async (label) => {
  const g = await L.startGateway({ dir, port: 6300, label, env, rec });
  gateways.push(g);
  return g;
};
const stop = async (g) => {
  const code = g.failedStart === undefined ? await g.stop() : g.exitCode();
  g.copyLog(`round1/history-${g.label}-gateway.log.txt`);
  return code;
};
const sql = (statement, args = []) =>
  L.withDb(dir, async (db) => db.execute({ sql: statement, args }));

/** The CHANGELOG's discovery SELECT: one row per stored place that names effort minimal. */
export const SELECT = `SELECT 'loop_versions' AS place, id AS ref FROM loop_versions WHERE definition LIKE '%"effort":"minimal"%' OR definition LIKE '%"effort":{"mode":"explicit","value":"minimal"}%'
UNION ALL SELECT 'settings', key FROM settings WHERE value LIKE '%"effort":"minimal"%'
UNION ALL SELECT 'model_catalog', harness || '/' || model FROM model_catalog WHERE efforts LIKE '%"minimal"%' OR default_effort = 'minimal'
UNION ALL SELECT 'runs', id FROM runs WHERE pinned LIKE '%"effort":"minimal"%' OR failure LIKE '%"effort":"minimal"%' OR initial_thread LIKE '%"effort":"minimal"%' OR thread_snapshot LIKE '%"effort":"minimal"%'
UNION ALL SELECT 'run_events', run_id || '#' || seq || ' ' || type FROM run_events WHERE payload LIKE '%"effort":"minimal"%'
UNION ALL SELECT 'harness_sessions', run_id || '/' || node_id || '/' || attempt FROM harness_sessions WHERE effort = 'minimal'
UNION ALL SELECT 'webhook_receipts', id FROM webhook_receipts WHERE intent LIKE '%"effort":"minimal"%' OR intent LIKE '%"effort":{"mode":"explicit","value":"minimal"}%'
UNION ALL SELECT 'event_receipts', id FROM event_receipts WHERE intent LIKE '%"effort":"minimal"%' OR intent LIKE '%"effort":{"mode":"explicit","value":"minimal"}%'`;

const both = (column) =>
  `replace(replace(${column}, '"effort":"minimal"', '"effort":"none"'), '"effort":{"mode":"explicit","value":"minimal"}', '"effort":{"mode":"explicit","value":"none"}')`;
const has = (column) =>
  `(${column} LIKE '%"effort":"minimal"%' OR ${column} LIKE '%"effort":{"mode":"explicit","value":"minimal"}%')`;

/** The CHANGELOG's hand statements, in order, with GraphGoblin stopped. */
export const FIX = [
  `UPDATE loop_versions SET definition = ${both('definition')} WHERE status <> 'snapshot' AND ${has('definition')}`,
  `UPDATE settings SET value = replace(value, '"effort":"minimal"', '"effort":"none"') WHERE value LIKE '%"effort":"minimal"%'`,
  `UPDATE model_catalog SET efforts = replace(efforts, '"minimal"', '"none"'), default_effort = replace(default_effort, 'minimal', 'none') WHERE efforts LIKE '%"minimal"%' OR default_effort = 'minimal'`,
  `UPDATE runs SET ${['pinned', 'failure', 'initial_thread', 'thread_snapshot'].map((c) => `${c} = replace(${c}, '"effort":"minimal"', '"effort":"none"')`).join(', ')} WHERE ${['pinned', 'failure', 'initial_thread', 'thread_snapshot'].map((c) => `${c} LIKE '%"effort":"minimal"%'`).join(' OR ')}`,
  `UPDATE run_events SET payload = replace(payload, '"effort":"minimal"', '"effort":"none"') WHERE payload LIKE '%"effort":"minimal"%'`,
  `UPDATE harness_sessions SET effort = 'none' WHERE effort = 'minimal'`,
  `UPDATE webhook_receipts SET intent = ${both('intent')} WHERE ${has('intent')}`,
  `UPDATE event_receipts SET intent = ${both('intent')} WHERE ${has('intent')}`,
];

const TRIGGER =
  "CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`\nWHEN OLD.status = 'snapshot'\nBEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END";
/** Draft snapshots: lift the immutability trigger, fix, restore it, in one transaction. */
export const SNAPSHOT_FIX = [
  'DROP TRIGGER loop_versions_snapshot_immutable',
  `UPDATE loop_versions SET definition = ${both('definition')} WHERE status = 'snapshot' AND ${has('definition')}`,
  TRIGGER,
];

const infer = (id, policy, x) => ({
  id,
  kind: 'inference',
  label: id,
  ui: { x, y: 80 },
  config: {
    harness: 'codex',
    model: 'gpt-6-luna',
    effort: 'none',
    session: { policy },
    harnessOptions: { sandbox: 'read-only', approval: 'never' },
    prompt: { template: 'Reply with READY.' },
  },
});
const hold = { id: 'hold', kind: 'wait', label: 'Hold', ui: { x: 500, y: 80 }, config: { mode: 'input', prompt: 'QA gate' } };
const resumeLoop = (name) =>
  L.loop(name, [infer('w1', 'fresh', 260), hold, infer('w2', 'resume-previous', 740)], [
    L.edge('e1', 'start', 'w1'),
    L.edge('e2', 'w1', 'hold'),
    L.edge('e3', 'hold', 'w2'),
    L.edge('e4', 'w2', 'done'),
  ]);
const withTrigger = (name, config, settings = {}) => ({
  schemaVersion: 4,
  name,
  settings,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ],
  edges: [L.edge('e1', 'start', 'done')],
});
const effortsIn = (events) =>
  events
    .filter((e) => JSON.stringify(e).includes('"effort"'))
    .map((e) => ({ seq: e.seq, type: e.type, efforts: [...JSON.stringify(e).matchAll(/"effort":"([a-z]+)"/g)].map((m) => m[1]) }));

const ids = {};
fs.writeFileSync(
  path.join(L.OUT, 'round1', 'hand-fix.sql.txt'),
  [
    '-- Discovery (one statement): every stored place that names effort minimal.',
    `${SELECT};`,
    '',
    '-- Hand fix, GraphGoblin stopped, one statement per place.',
    ...FIX.map((statement) => `${statement};`),
    '',
    '-- Draft snapshots (status snapshot) are immutable by trigger: one transaction.',
    'BEGIN;',
    ...SNAPSHOT_FIX.map((statement) => `${statement};`),
    'COMMIT;',
    '',
  ].join('\n'),
);
try {
  // ---------------- P: produce every effort-bearing row at none ----------------
  let g = await start('produce');
  mode('success');
  const put = await g.call('/settings', {
    method: 'PUT',
    body: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'none' } } } },
  });
  ids.A = await L.publishLoop(g.call, resumeLoop('H A recovered'));
  ids.B = await L.publishLoop(g.call, resumeLoop('H B missing session'));
  ids.C = await L.publishLoop(g.call, L.single('H C llm decision', L.llmDecisionNode('work', { model: 'gpt-6-luna', effort: 'none' })));
  const runs = {};
  for (const k of ['A', 'B']) {
    const r = await g.call(`/loops/${ids[k]}/runs`, { method: 'POST', body: { input: null } });
    runs[k] = r.json.run.id;
    const parked = await L.waitRun(g.call, runs[k], ['waiting', 'failed', 'succeeded'], 60_000);
    runs[`${k}wait`] = parked.waiting?.waitId;
  }
  // The resumed second turn finds its conversation gone (the CLI's own wording).
  spec(
    [
      { type: 'error', message: 'thread not found: qa-205' },
      { type: 'turn.failed', error: { message: 'thread not found: qa-205' } },
    ],
    1,
  );
  const failed = {};
  for (const k of ['A', 'B']) {
    await g.call(`/runs/${runs[k]}/input`, { method: 'POST', body: { waitId: runs[`${k}wait`], input: 'go' } });
    failed[k] = await L.waitRun(g.call, runs[k], ['failed', 'succeeded'], 60_000);
  }
  rec.check(
    'P-1 runs A and B fail HARNESS_SESSION_MISSING with failure.missingSession.effort none',
    ['A', 'B'].every((k) => failed[k].failure?.code === 'HARNESS_SESSION_MISSING' && failed[k].failure?.missingSession?.effort === 'none'),
    { put: put.status, A: failed.A.failure, B: failed.B.failure },
  );
  spec(
    [
      { type: 'thread.started', thread_id: 'qa-205-decision' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'qa', type: 'agent_message', text: JSON.stringify({ route: 'finish', confidence: 0.9, reasoning: 'QA fixture' }) } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ],
    0,
  );
  const c = await g.call(`/loops/${ids.C}/runs`, { method: 'POST', body: { input: null } });
  runs.C = c.json.run.id;
  const cDone = await L.waitRun(g.call, runs.C, ['failed', 'succeeded'], 60_000);
  mode('success');
  const aEvents = await L.events(g.call, runs.A);
  const failureSeq = aEvents.find((e) => e.type === 'run.failed')?.seq;
  const recovered = await g.call(`/runs/${runs.A}/recover-session`, {
    method: 'POST',
    body: { nodeId: 'w2', failureSeq },
  });
  const aDone = await L.waitRun(g.call, runs.A, ['failed', 'succeeded'], 60_000);
  rec.check(
    'P-2 run C (LLM decision at none) succeeds; run A recovers with a fresh session and succeeds',
    cDone.status === 'succeeded' && recovered.status === 200 && aDone.status === 'succeeded',
    { C: cDone.status, Cfailure: cDone.failure ?? null, recover: L.problemOf(recovered), A: aDone.status },
  );
  // Event and webhook admissions store their run admission as the receipt's intent.
  ids.E = await L.publishLoop(g.call, withTrigger('H E event', { type: 'event', eventType: 'qa-205' }));
  const event = { loopId: ids.E, type: 'qa-205', payload: { n: 1 }, dedupeKey: 'qa-205-k1' };
  const e1 = await g.call('/events', { method: 'POST', body: event });
  const e2 = await g.call('/events', { method: 'POST', body: event });
  ids.W = await L.publishLoop(g.call, withTrigger('H W webhook', { type: 'webhook' }));
  const hook = (await g.call(`/loops/${ids.W}/triggers`)).json.webhooks[0].path;
  const w1 = await g.call(hook, { method: 'POST', body: { n: 1 } });
  const w2 = await g.call(hook, { method: 'POST', body: { n: 1 } });
  // A draft snapshot whose loop defaults hold an effort.
  const s = await L.createLoop(g.call, withTrigger('H S snapshot', { type: 'manual' }, { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'none' } } } }));
  ids.S = s.json.loop.id;
  const sDraft = (await g.call(`/loops/${ids.S}`)).json.loop.draftVersionId;
  const sRun = await g.call(`/loops/${ids.S}/runs`, { method: 'POST', body: { input: null, versionId: sDraft, allowDraft: true } });
  runs.S = sRun.json?.run?.id;
  await L.sleep(1500);
  const baseline = {
    eventFirst: L.problemOf(e1),
    eventDuplicate: { ...L.problemOf(e2), duplicate: e2.json?.duplicate },
    webhookFirst: L.problemOf(w1),
    webhookRepeat: L.problemOf(w2),
    snapshotRun: (await g.call(`/runs/${runs.S}`)).json?.status,
  };
  rec.log('P baseline receipts and snapshot run', baseline);
  const reads = async (gw) => {
    const out = {};
    for (const k of ['A', 'B', 'C', 'S']) {
      out[`run ${k}`] = (await gw.call(`/runs/${runs[k]}`)).status;
      out[`events ${k}`] = L.problemOf(await gw.call(`/runs/${runs[k]}/events?after=0&limit=1000`));
    }
    out['observation A'] = (await gw.call(`/runs/${runs.A}/observation`)).status;
    out['thread C'] = (await gw.call(`/runs/${runs.C}/thread`)).status;
    out['observation C'] = (await gw.call(`/runs/${runs.C}/observation`)).status;
    out['GET /runs'] = (await gw.call('/runs')).status;
    out['event re-sent'] = { ...L.problemOf(await gw.call('/events', { method: 'POST', body: event })) };
    out['webhook re-sent'] = L.problemOf(await gw.call(hook, { method: 'POST', body: { n: 1 } }));
    return out;
  };
  const produced = await reads(g);
  for (const k of ['A', 'B', 'C']) produced[`efforts ${k}`] = effortsIn(await L.events(g.call, runs[k]));
  rec.check(
    'P-3 every read is 200 and the run events carry effort none in run.queued, harness.session, run.failed, run.resumed and decision.made',
    Object.entries(produced).every(([k, v]) => k.startsWith('efforts') || k.includes('re-sent') || v === 200 || v?.status === 200) &&
      ['run.queued', 'harness.session', 'run.failed', 'run.resumed'].every((t) => produced['efforts A'].some((e) => e.type === t && e.efforts.includes('none'))) &&
      produced['efforts C'].some((e) => e.type === 'decision.made' && e.efforts.includes('none')),
    produced,
  );
  rec.check('P-4 no real provider: every turn reached the fake CLI', requests().length >= 5, requests().map((r) => ({ model: r.model, effort: r.effort, resume: r.resume, mode: r.mode })));
  rec.check('P-5 gateway drains to exit 0', (await stop(g)) === 0);
  const inventory = {};
  for (const [place, query] of Object.entries({
    loop_versions: `SELECT status, count(*) AS n FROM loop_versions WHERE definition LIKE '%"effort":%' GROUP BY status`,
    settings: `SELECT key AS status, count(*) AS n FROM settings WHERE value LIKE '%"effort":%' GROUP BY key`,
    runs_pinned: `SELECT 'pinned' AS status, count(*) AS n FROM runs WHERE pinned LIKE '%"effort":"none"%'`,
    runs_failure: `SELECT 'failure' AS status, count(*) AS n FROM runs WHERE failure LIKE '%"effort":"none"%'`,
    runs_thread_snapshot: `SELECT 'thread_snapshot' AS status, count(*) AS n FROM runs WHERE thread_snapshot LIKE '%"effort":"none"%'`,
    runs_initial_thread: `SELECT 'initial_thread' AS status, count(*) AS n FROM runs WHERE initial_thread LIKE '%"effort":"none"%'`,
    run_events: `SELECT type AS status, count(*) AS n FROM run_events WHERE payload LIKE '%"effort":"none"%' GROUP BY type`,
    harness_sessions: `SELECT 'effort none' AS status, count(*) AS n FROM harness_sessions WHERE effort = 'none'`,
    webhook_receipts: `SELECT status, count(*) AS n FROM webhook_receipts WHERE intent LIKE '%"effort":"none"%' GROUP BY status`,
    event_receipts: `SELECT status, count(*) AS n FROM event_receipts WHERE intent LIKE '%"effort":"none"%' GROUP BY status`,
  }))
    inventory[place] = (await sql(query)).rows.map((r) => `${r.status}: ${r.n}`);
  rec.log('P inventory of stored efforts (rows holding effort none)', inventory);

  // ---------------- H: minimal in the run-history places only ----------------
  const N = `'"effort":"none"'`;
  const M = `'"effort":"minimal"'`;
  for (const statement of [
    `UPDATE runs SET pinned = replace(pinned, ${N}, ${M}), failure = replace(failure, ${N}, ${M}), initial_thread = replace(initial_thread, ${N}, ${M}), thread_snapshot = replace(thread_snapshot, ${N}, ${M})`,
    `UPDATE run_events SET payload = replace(payload, ${N}, ${M})`,
    `UPDATE harness_sessions SET effort = 'minimal' WHERE effort = 'none'`,
    `UPDATE webhook_receipts SET intent = replace(intent, ${N}, ${M})`,
    `UPDATE event_receipts SET intent = replace(intent, ${N}, ${M})`,
  ])
    await sql(statement);
  const foundHistory = (await sql(SELECT)).rows.map((r) => `${r.place} ${r.ref}`);
  g = await start('history-minimal');
  const historyReads = g.failedStart === undefined ? await reads(g) : { startup: 'refused' };
  rec.observe('H-1 run-history minimal only: startup and the reads that meet it', historyReads);
  rec.check(
    'H-2 the SELECT finds every run-history place: runs, run_events (5 types), harness_sessions, both receipts',
    ['runs ', 'run_events ', 'harness_sessions ', 'webhook_receipts ', 'event_receipts '].every((p) => foundHistory.some((f) => f.startsWith(p))) &&
      ['run.queued', 'harness.session', 'run.failed', 'run.resumed', 'decision.made'].every((t) => foundHistory.some((f) => f.startsWith('run_events ') && f.endsWith(` ${t}`))),
    foundHistory,
  );
  if (g.failedStart === undefined) rec.check('H-3 gateway drains to exit 0', (await stop(g)) === 0);

  // ---------------- F: minimal in every place; the hand statements fix all ----------------
  await sql(`UPDATE loop_versions SET definition = replace(replace(definition, ${N}, ${M}), '"effort":{"mode":"explicit","value":"none"}', '"effort":{"mode":"explicit","value":"minimal"}') WHERE status <> 'snapshot'`);
  await L.withDb(dir, (db) =>
    db.batch(
      [
        'DROP TRIGGER loop_versions_snapshot_immutable',
        `UPDATE loop_versions SET definition = replace(definition, ${N}, ${M}) WHERE status = 'snapshot'`,
        TRIGGER,
      ],
      'write',
    ),
  );
  await sql(`UPDATE settings SET value = replace(value, ${N}, ${M})`);
  await sql(`INSERT INTO model_catalog (harness, model, source, display_name, efforts, default_effort, enabled) VALUES ('codex', 'gpt-5-handadded', 'harness', 'GPT-5 hand-added', '["minimal","low","medium","high"]', 'minimal', 1)`);
  const foundAll = (await sql(SELECT)).rows.map((r) => `${r.place} ${r.ref}`);
  const places = [...new Set(foundAll.map((f) => f.split(' ')[0]))];
  rec.check(
    'F-1 the SELECT finds all eight places',
    ['loop_versions', 'settings', 'model_catalog', 'runs', 'run_events', 'harness_sessions', 'webhook_receipts', 'event_receipts'].every((p) => places.includes(p)),
    { places, rows: foundAll.length, found: foundAll },
  );
  g = await start('all-minimal');
  rec.check('F-2 startup refuses the store (a loop version names minimal)', g.failedStart?.includes('is not a valid definition') && g.exitCode() === 1, g.failedStart?.split(/\r?\n/).find((l) => l.includes('Reason:')));
  await stop(g);
  const affected = [];
  for (const statement of FIX) affected.push((await sql(statement)).rowsAffected);
  const snapshotAffected = await L.withDb(dir, async (db) => (await db.batch(SNAPSHOT_FIX, 'write'))[1].rowsAffected);
  const left = (await sql(SELECT)).rows.length;
  const trigger = (await sql("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'loop_versions_snapshot_immutable'")).rows[0]?.sql;
  rec.check(
    'F-3 each hand statement changes rows, the snapshot transaction restores the trigger, and the SELECT is empty',
    affected.every((n) => n > 0) && snapshotAffected > 0 && left === 0 && trigger === TRIGGER,
    { affected: Object.fromEntries(FIX.map((s, i) => [s.split(' ')[1], affected[i]])), snapshotAffected, left, triggerRestored: trigger === TRIGGER },
  );
  g = await start('fixed');
  const fixedReads = g.failedStart === undefined ? await reads(g) : { startup: g.failedStart };
  for (const k of ['A', 'B', 'C']) fixedReads[`efforts ${k}`] = effortsIn(await L.events(g.call, runs[k]));
  fixedReads.settings = (await g.call('/settings')).json;
  fixedReads.catalog = (await g.call('/model-catalog')).json.items?.find((i) => i.model === 'gpt-5-handadded')?.efforts;
  fixedReads.loops = await Promise.all(['A', 'B', 'C', 'S'].map(async (k) => (await g.call(`/loops/${ids[k]}`)).status));
  rec.check(
    'F-4 after the hand fix every read is 200, the history reads effort none, and re-sent event and webhook behave as before',
    g.failedStart === undefined &&
      ['A', 'B', 'C', 'S'].every((k) => fixedReads[`run ${k}`] === 200 && fixedReads[`events ${k}`].status === 200) &&
      fixedReads['observation A'] === 200 &&
      fixedReads['observation C'] === 200 &&
      fixedReads['thread C'] === 200 &&
      fixedReads['GET /runs'] === 200 &&
      fixedReads['event re-sent'].status === produced['event re-sent'].status &&
      fixedReads['webhook re-sent'].status === produced['webhook re-sent'].status &&
      fixedReads.loops.every((s) => s === 200) &&
      !JSON.stringify(fixedReads).includes('minimal'),
    fixedReads,
  );
  rec.check('F-5 gateway drains to exit 0', (await stop(g)) === 0);
} catch (error) {
  rec.check('history completed without exception', false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish({ store: dir, ids });
}
