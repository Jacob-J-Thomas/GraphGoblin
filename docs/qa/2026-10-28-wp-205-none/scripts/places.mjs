// WP-205 QA and review round 1: the path-scoped hand correction (effort-sql.mjs) on one disposable
// store (%TEMP%\gg-205-places-*, port 6300), the built WP-205 head and the controlled fake
// Codex/Claude CLI (%TEMP%\gg-205-tools\fake, compiled from
// docs/qa/2026-10-28-wp-205-qa/scripts/fake-cli.cs.txt). No real provider turn.
//
//   P  produce, through the public API, a row of every typed effort place at effort none, plus
//      authored JSON that holds {"effort":"minimal"} outside any typed path: a loop variable's
//      schema default, a prompt, run input, an event payload. The SELECT finds nothing.
//   H  write minimal into the typed run-history paths only: startup succeeds; every read that meets
//      one fails; the SELECT lists each row.
//   F  write minimal into the definition, owner-default and catalog paths too: the SELECT lists all
//      eight places, startup refuses; the hand statements restore every row to exactly its state
//      before H (authored content included), every read is 200 and the SELECT is empty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';
import { FIX, SELECT, SNAPSHOT_FIX, SNAPSHOT_TRIGGER, recipe } from './effort-sql.mjs';

const rec = new L.Recorder('round1/places');
fs.writeFileSync(path.join(L.OUT, 'round1', 'hand-fix.sql.txt'), recipe());
const dir = L.makeStore('places');
const cli = path.join(dir, 'fake-cli');
fs.mkdirSync(cli);
for (const name of ['codex.exe', 'claude.exe'])
  fs.copyFileSync(path.join(os.tmpdir(), 'gg-205-tools', 'fake', name), path.join(cli, name));
const env = { GG_CODEX_BINARY: path.join(cli, 'codex.exe'), GG_CLAUDE_BINARY: path.join(cli, 'claude.exe') };
const mode = (value) => fs.writeFileSync(path.join(cli, 'codex-mode.txt'), value);
const spec = (events, exit) => {
  fs.writeFileSync(path.join(cli, 'spec-events.txt'), events.map((e) => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(cli, 'spec-stderr.txt'), '');
  fs.writeFileSync(path.join(cli, 'spec-exit.txt'), String(exit));
  mode('spec');
};
const requests = () => {
  const file = path.join(cli, 'requests.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const gateways = [];
const start = async (label) => {
  const g = await L.startGateway({ dir, port: 6300, label, env, rec });
  gateways.push(g);
  return g;
};
const stop = async (g) => {
  const code = g.failedStart === undefined ? await g.stop() : g.exitCode();
  g.copyLog(`round1/places-${g.label}-gateway.log.txt`);
  return code;
};
const sql = (statement, args = []) => L.withDb(dir, async (db) => db.execute({ sql: statement, args }));
const select = async () => (await sql(SELECT)).rows.map((r) => `${r.place} ${r.ref}`);

const AUTHORED = { effort: 'minimal' };
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
    prompt: { template: 'Reply with READY. Authored text: {"effort":"minimal"}' },
  },
});
const hold = { id: 'hold', kind: 'wait', label: 'Hold', ui: { x: 500, y: 80 }, config: { mode: 'input', prompt: 'QA gate' } };
const resumeLoop = (name) => ({
  ...L.loop(name, [infer('w1', 'fresh', 260), hold, infer('w2', 'resume-previous', 740)], [
    L.edge('e1', 'start', 'w1'),
    L.edge('e2', 'w1', 'hold'),
    L.edge('e3', 'hold', 'w2'),
    L.edge('e4', 'w2', 'done'),
  ]),
  // Authored JSON that names effort minimal outside any reasoning-effort path (review finding 2).
  variables: { payload: { type: 'object', default: AUTHORED } },
});
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

/** Every row of the places the recipe may change, keyed by table and primary key. */
async function rows() {
  const out = {};
  const put = (key, value) => (out[key] = value);
  for (const r of (await sql('SELECT id, status, definition FROM loop_versions')).rows) put(`loop_versions ${r.id} ${r.status}`, r.definition);
  for (const r of (await sql('SELECT owner_id, key, value FROM settings')).rows) put(`settings ${r.owner_id} ${r.key}`, r.value);
  for (const r of (await sql('SELECT harness, model, efforts, default_effort FROM model_catalog')).rows) put(`model_catalog ${r.harness}/${r.model}`, `${r.efforts} ${r.default_effort}`);
  for (const r of (await sql('SELECT id, pinned, failure, initial_thread, thread_snapshot FROM runs')).rows)
    for (const c of ['pinned', 'failure', 'initial_thread', 'thread_snapshot']) put(`runs ${r.id} ${c}`, r[c]);
  for (const r of (await sql('SELECT run_id, seq, type, payload FROM run_events')).rows) put(`run_events ${r.run_id}#${r.seq} ${r.type}`, r.payload);
  for (const r of (await sql('SELECT run_id, node_id, attempt, effort FROM harness_sessions')).rows) put(`harness_sessions ${r.run_id}/${r.node_id}/${r.attempt}`, r.effort);
  for (const t of ['webhook_receipts', 'event_receipts'])
    for (const r of (await sql(`SELECT id, intent FROM ${t}`)).rows) put(`${t} ${r.id}`, r.intent);
  return out;
}
const differences = (a, b) => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => a[k] !== b[k]);
};

const ids = {};
const runs = {};
try {
  // ---------------- P ----------------
  let g = await start('produce');
  mode('success');
  const put = await g.call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'none' } } } } });
  ids.A = await L.publishLoop(g.call, resumeLoop('R1 A recovered'));
  ids.B = await L.publishLoop(g.call, resumeLoop('R1 B missing session'));
  ids.C = await L.publishLoop(g.call, L.single('R1 C llm decision', L.llmDecisionNode('work', { model: 'gpt-6-luna', effort: 'none' })));
  for (const k of ['A', 'B']) {
    const r = await g.call(`/loops/${ids[k]}/runs`, { method: 'POST', body: { input: { authored: AUTHORED } } });
    runs[k] = r.json.run.id;
    runs[`${k}wait`] = (await L.waitRun(g.call, runs[k], ['waiting', 'failed', 'succeeded'], 60_000)).waiting?.waitId;
  }
  spec(
    [
      { type: 'error', message: 'thread not found: qa-205' },
      { type: 'turn.failed', error: { message: 'thread not found: qa-205' } },
    ],
    1,
  );
  const failed = {};
  for (const k of ['A', 'B']) {
    await g.call(`/runs/${runs[k]}/input`, { method: 'POST', body: { waitId: runs[`${k}wait`], input: AUTHORED } });
    failed[k] = await L.waitRun(g.call, runs[k], ['failed', 'succeeded'], 60_000);
  }
  spec(
    [
      { type: 'thread.started', thread_id: 'qa-205-decision' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'qa', type: 'agent_message', text: JSON.stringify({ route: 'finish', confidence: 0.9, reasoning: 'QA fixture' }) } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ],
    0,
  );
  runs.C = (await g.call(`/loops/${ids.C}/runs`, { method: 'POST', body: { input: null } })).json.run.id;
  const cDone = await L.waitRun(g.call, runs.C, ['failed', 'succeeded'], 60_000);
  mode('success');
  const failureSeq = (await L.events(g.call, runs.A)).find((e) => e.type === 'run.failed')?.seq;
  const recovered = await g.call(`/runs/${runs.A}/recover-session`, { method: 'POST', body: { nodeId: 'w2', failureSeq } });
  const aDone = await L.waitRun(g.call, runs.A, ['failed', 'succeeded'], 60_000);
  ids.E = await L.publishLoop(g.call, withTrigger('R1 E event', { type: 'event', eventType: 'qa-205' }));
  const event = { loopId: ids.E, type: 'qa-205', payload: { authored: AUTHORED }, dedupeKey: 'qa-205-k1' };
  const e1 = await g.call('/events', { method: 'POST', body: event });
  ids.W = await L.publishLoop(g.call, withTrigger('R1 W webhook', { type: 'webhook' }));
  const hook = (await g.call(`/loops/${ids.W}/triggers`)).json.webhooks[0].path;
  const w1 = await g.call(hook, { method: 'POST', body: { authored: AUTHORED } });
  const s = await L.createLoop(g.call, withTrigger('R1 S snapshot', { type: 'manual' }, { defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'none' } } } }));
  ids.S = s.json.loop.id;
  const sDraft = (await g.call(`/loops/${ids.S}`)).json.loop.draftVersionId;
  runs.S = (await g.call(`/loops/${ids.S}/runs`, { method: 'POST', body: { input: null, versionId: sDraft, allowDraft: true } })).json?.run?.id;
  await L.sleep(1500);
  rec.check(
    'P-1 the fixtures exist: A and B missing session (B stays failed), C decided, A recovered fresh, event and webhook admitted, a draft snapshot run',
    put.status === 200 &&
      ['A', 'B'].every((k) => failed[k].failure?.missingSession?.effort === 'none') &&
      cDone.status === 'succeeded' &&
      recovered.status === 200 &&
      aDone.status === 'succeeded' &&
      e1.status === 202 &&
      w1.status === 202 &&
      (await g.call(`/runs/${runs.S}`)).json?.status === 'succeeded',
    { B: failed.B.failure?.code, C: cDone.status, recover: recovered.status, A: aDone.status, event: e1.status, webhook: w1.status },
  );
  const reads = async (gw) => {
    const out = {};
    for (const k of ['A', 'B', 'C', 'S']) {
      out[`run ${k}`] = (await gw.call(`/runs/${runs[k]}`)).status;
      out[`events ${k}`] = (await gw.call(`/runs/${runs[k]}/events?after=0&limit=1000`)).status;
      out[`thread ${k}`] = (await gw.call(`/runs/${runs[k]}/thread`)).status;
    }
    out['observation A'] = (await gw.call(`/runs/${runs.A}/observation`)).status;
    out['observation C'] = (await gw.call(`/runs/${runs.C}/observation`)).status;
    out['GET /runs'] = (await gw.call('/runs')).status;
    out['GET /settings'] = (await gw.call('/settings')).status;
    out['GET /model-catalog'] = (await gw.call('/model-catalog')).status;
    for (const k of ['A', 'B', 'C', 'S']) out[`loop ${k}`] = (await gw.call(`/loops/${ids[k]}`)).status;
    return out;
  };
  const produced = await reads(g);
  rec.check('P-2 every read is 200', Object.values(produced).every((v) => v === 200), produced);
  rec.check('P-3 no real provider: every turn reached the fake CLI', requests().length === 6, requests().map((r) => ({ effort: r.effort, resume: r.resume, mode: r.mode })));
  rec.check('P-4 gateway drains to exit 0', (await stop(g)) === 0);
  const before = await rows();
  const authoredRows = Object.entries(before).filter(([, v]) => String(v).includes('"effort":"minimal"')).map(([k]) => k);
  const falsePositives = await select();
  rec.check(
    'P-5 authored JSON holds {"effort":"minimal"} in loop variables, run input, threads, events and receipts, and the SELECT finds none of it',
    falsePositives.length === 0 &&
      ['loop_versions ', 'runs ', 'run_events ', 'event_receipts ', 'webhook_receipts '].every((p) => authoredRows.some((k) => k.startsWith(p))),
    { selectRows: falsePositives, authoredRows },
  );

  // ---------------- H: minimal on the typed run-history paths only ----------------
  // Written the way a build before #205 stored it: the same JSON with the old effort string.
  const N = `'"effort":"none"'`;
  const M = `'"effort":"minimal"'`;
  const typedEvents = `('run.queued', 'run.failed', 'run.resumed', 'harness.session', 'decision.made')`;
  for (const statement of [
    `UPDATE runs SET pinned = replace(pinned, ${N}, ${M}), failure = replace(failure, ${N}, ${M})`,
    `UPDATE run_events SET payload = replace(payload, ${N}, ${M}) WHERE type IN ${typedEvents}`,
    `UPDATE harness_sessions SET effort = 'minimal' WHERE effort = 'none'`,
    `UPDATE webhook_receipts SET intent = replace(intent, ${N}, ${M})`,
    `UPDATE event_receipts SET intent = replace(intent, ${N}, ${M})`,
  ])
    await sql(statement);
  const historyFound = await select();
  g = await start('history-minimal');
  const historyReads = g.failedStart === undefined ? await reads(g) : { startup: 'refused' };
  rec.observe('H-1 typed run-history minimal only: the server starts; the reads that meet it', historyReads);
  rec.check(
    'H-2 the SELECT lists runs (pinned, failure), run_events of all five typed kinds, harness_sessions and both receipts',
    ['run.queued', 'run.failed', 'run.resumed', 'harness.session', 'decision.made'].every((t) => historyFound.some((f) => f.startsWith('run_events ') && f.endsWith(` ${t}`))) &&
      ['runs ', 'harness_sessions ', 'webhook_receipts ', 'event_receipts '].every((p) => historyFound.some((f) => f.startsWith(p))) &&
      !historyFound.some((f) => f.includes('node.finished')),
    historyFound,
  );
  if (g.failedStart === undefined) rec.check('H-3 gateway drains to exit 0', (await stop(g)) === 0);

  // ---------------- F: minimal on every typed path; the recipe restores every row ----------------
  await sql(`UPDATE loop_versions SET definition = replace(replace(definition, ${N}, ${M}), '"effort":{"mode":"explicit","value":"none"}', '"effort":{"mode":"explicit","value":"minimal"}') WHERE status <> 'snapshot'`);
  await L.withDb(dir, (db) =>
    db.batch(['DROP TRIGGER loop_versions_snapshot_immutable', `UPDATE loop_versions SET definition = replace(definition, ${N}, ${M}) WHERE status = 'snapshot'`, SNAPSHOT_TRIGGER], 'write'),
  );
  await sql(`UPDATE settings SET value = replace(value, ${N}, ${M}) WHERE key = 'defaults'`);
  await sql(`INSERT INTO model_catalog (harness, model, source, display_name, efforts, default_effort, enabled) VALUES ('codex', 'gpt-5-handadded', 'harness', 'GPT-5 hand-added', '["minimal","low","medium","high"]', 'minimal', 1)`);
  before['model_catalog codex/gpt-5-handadded'] = '["none","low","medium","high"] none';
  const allFound = await select();
  const places = [...new Set(allFound.map((f) => f.split(' ')[0]))];
  rec.check(
    'F-1 the SELECT lists all eight places, the snapshot included',
    ['loop_versions', 'settings', 'model_catalog', 'runs', 'run_events', 'harness_sessions', 'webhook_receipts', 'event_receipts'].every((p) => places.includes(p)) &&
      allFound.some((f) => f.startsWith('loop_versions ') && f.endsWith(' snapshot')),
    { places, rows: allFound.length, found: allFound },
  );
  g = await start('all-minimal');
  rec.check('F-2 startup refuses the store, naming a loop version', g.failedStart?.includes('is not a valid definition') && g.exitCode() === 1, g.failedStart?.split(/\r?\n/).find((l) => l.includes('Reason:')));
  await stop(g);
  const affected = [];
  for (const statement of FIX) affected.push((await sql(statement)).rowsAffected);
  const snapshotAffected = await L.withDb(dir, async (db) => (await db.batch(SNAPSHOT_FIX, 'write'))[1].rowsAffected);
  const left = await select();
  const trigger = (await sql("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'loop_versions_snapshot_immutable'")).rows[0]?.sql;
  const after = await rows();
  const changed = differences(before, after);
  rec.check(
    'F-3 each statement changes rows; afterwards every row equals its state before H byte for byte, authored {"effort":"minimal"} included; the SELECT is empty; the trigger is restored',
    affected.every((n) => n > 0) && snapshotAffected === 1 && left.length === 0 && trigger === SNAPSHOT_TRIGGER && changed.length === 0,
    {
      affected: Object.fromEntries(FIX.map((statement, i) => [statement.split(' ')[1], affected[i]])),
      snapshotAffected,
      left,
      triggerRestored: trigger === SNAPSHOT_TRIGGER,
      rowsCompared: Object.keys(after).length,
      differing: changed,
    },
  );
  g = await start('fixed');
  const fixedReads = g.failedStart === undefined ? await reads(g) : { startup: g.failedStart };
  const loopA = g.failedStart === undefined ? (await g.call(`/loops/${ids.A}`)).json : undefined;
  const runA = g.failedStart === undefined ? (await g.call(`/runs/${runs.A}/thread`)).json : undefined;
  rec.check(
    'F-4 after the correction every read is 200, and the authored variable default and run input still say effort minimal',
    Object.values(fixedReads).every((v) => v === 200) &&
      JSON.stringify(loopA?.current?.definition?.variables) === JSON.stringify({ payload: { type: 'object', default: AUTHORED } }) &&
      JSON.stringify(runA).includes('"authored":{"effort":"minimal"}'),
    { reads: fixedReads, variables: loopA?.current?.definition?.variables },
  );
  rec.check('F-5 gateway drains to exit 0', (await stop(g)) === 0);
} catch (error) {
  rec.check('places completed without exception', false, String(error?.stack ?? error));
} finally {
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish({ store: dir, ids, runs });
}
